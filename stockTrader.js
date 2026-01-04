/** stockTrader_v1_fixed.js
 * Fix: openLongPositions (Held count) is now recalculated AFTER sells, so the script
 * can open new positions in the same cycle (no “I’m full” bug after liquidations).
 *
 * Long-only (short flags kept for future, but shorts are not executed in this version).
 *
 * @param {NS} ns
 */
export async function main(ns) {
  const FLAGS = ns.flags([
    ["interval", 6000],
    ["reserve", 0],
    ["maxSpendFrac", 0.995],
    ["maxPositions", 20],
    ["maxPerSymbolFrac", 0.25],
    ["minTradeValue", 25_000_000], // avoid tiny churn (fees/spread)
    ["buyLong", 0.60],
    ["sellLong", 0.55],
    ["buyShort", 0.40],    // (unused here)
    ["coverShort", 0.45],  // (unused here)
    ["noShorts", false],   // (unused here)
    ["quiet", false],
  ]);

  // --- Compatibility wrappers (old vs new API) ---
  const getSymbols = () =>
    (ns.stock.getSymbols ? ns.stock.getSymbols() : ns.stock.getStockSymbols());

  const getForecast = (sym) =>
    (ns.stock.getForecast ? ns.stock.getForecast(sym)
      : (ns.stock.getStockForecast ? ns.stock.getStockForecast(sym) : 0.5));

  const getVolatility = (sym) =>
    (ns.stock.getVolatility ? ns.stock.getVolatility(sym) : 0);

  const getPosition = (sym) => ns.stock.getPosition(sym); // [longShares,longAvg,shortShares,shortAvg] (modern)

  const buyLong = (sym, shares) =>
    (ns.stock.buyStock ? ns.stock.buyStock(sym, shares) : ns.stock.buy(sym, shares));

  const sellLong = (sym, shares) =>
    (ns.stock.sellStock ? ns.stock.sellStock(sym, shares) : ns.stock.sell(sym, shares));

  const bid = (sym) => ns.stock.getBidPrice(sym);
  const ask = (sym) => ns.stock.getAskPrice(sym);
  const maxShares = (sym) => ns.stock.getMaxShares(sym);

  const fmt = (n) => (ns.formatNumber ? ns.formatNumber(n, 2) : ns.nFormat(n, "0.00a"));

  ns.disableLog("ALL");

  // --- 4S checks (only if functions exist in your version) ---
  if (typeof ns.stock.has4SDataTIXAPI === "function" && !ns.stock.has4SDataTIXAPI()) {
    ns.tprint("Nincs 4S Market Data TIX API (has4SDataTIXAPI=false). Forecast trading vakon veszélyes -> kilépés.");
    return;
  }
  if (typeof ns.stock.has4SData === "function" && !ns.stock.has4SData()) {
    ns.tprint("Nincs 4S Market Data (has4SData=false). Forecast trading vakon veszélyes -> kilépés.");
    return;
  }

  function calcEquityAndHeld(symbols) {
    let cash = ns.getPlayer().money;
    let equity = cash;
    let held = 0;

    for (const sym of symbols) {
      const pos = getPosition(sym);
      const longShares = pos[0] || 0;
      if (longShares > 0) {
        held++;
        equity += longShares * bid(sym); // realizable value (approx)
      }
    }
    return { cash, equity, held };
  }

  while (true) {
    const symbols = getSymbols();

    // 1) Build ranking table (edge * vol)
    const rows = symbols
      .map((sym) => {
        const f = getForecast(sym);
        const v = getVolatility(sym);
        const edge = Math.abs(f - 0.5);
        const score = edge * (v > 0 ? v : 0.000001); // avoid all-zero
        return { sym, f, v, edge, score };
      })
      .sort((a, b) => b.score - a.score);

    // 2) SELL on real sell signal (no rebalance churn)
    let sells = 0;
    for (const { sym, f } of rows) {
      const pos = getPosition(sym);
      const longShares = pos[0] || 0;
      if (longShares > 0 && f < FLAGS.sellLong) {
        sellLong(sym, longShares);
        sells++;
      }
    }

    // 3) Recompute (FIX): held count & equity AFTER sells
    const { equity, held: openLongPositions } = calcEquityAndHeld(symbols);

    // 4) Deployable budget from equity (stable)
    const deployable = Math.max(0, (equity - FLAGS.reserve) * FLAGS.maxSpendFrac);

    // 5) Candidates for LONG (up to maxPositions)
    const candidates = [];
    for (const r of rows) {
      if (candidates.length >= FLAGS.maxPositions) break;
      if (r.f >= FLAGS.buyLong) candidates.push(r);
    }

    const weightSum = candidates.reduce((s, r) => s + (r.score || 0), 0) || 1;

    // 6) BUY / TOP-UP: only increase towards target allocation (no downscaling)
    let buys = 0;
    let heldNow = openLongPositions;

    for (const r of candidates) {
      const sym = r.sym;
      const pos = getPosition(sym);
      const longShares = pos[0] || 0;

      const isNew = longShares <= 0;
      if (isNew && heldNow >= FLAGS.maxPositions) continue;

      const targetValueRaw = deployable * ((r.score || 0) / weightSum);
      const targetValue = Math.min(targetValueRaw, deployable * FLAGS.maxPerSymbolFrac);

      const pxBuy = ask(sym);
      const curValue = longShares * bid(sym);

      const gap = targetValue - curValue;
      if (gap < FLAGS.minTradeValue) continue;

      const desiredShares = Math.floor(targetValue / pxBuy);
      const cap = maxShares(sym);
      const clampedDesired = Math.max(0, Math.min(desiredShares, cap));
      if (clampedDesired <= longShares) continue;

      const delta = clampedDesired - longShares;
      const estCost = delta * pxBuy;
      if (estCost < FLAGS.minTradeValue) continue;

      const maxAffordable = Math.floor((ns.getPlayer().money - FLAGS.reserve) / pxBuy);
      const sharesToBuy = Math.max(0, Math.min(delta, maxAffordable));
      if (sharesToBuy <= 0) continue;

      const spent = sharesToBuy * pxBuy;
      if (spent < FLAGS.minTradeValue) continue;

      const res = buyLong(sym, sharesToBuy);
      if (res > 0) {
        buys++;
        if (isNew) heldNow++;
      }
    }

    if (!FLAGS.quiet) {
      ns.print(
        `Cash=${fmt(ns.getPlayer().money)} | Equity≈${fmt(equity)} | Deployable≈${fmt(deployable)} | ` +
        `Candidates=${candidates.length} | Held=${heldNow} | Buys=${buys} | Sells=${sells} | Shorts=false`
      );
    }

    await ns.sleep(FLAGS.interval);
  }
}
