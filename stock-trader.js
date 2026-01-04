/** @param {NS} ns **/
export async function main(ns) {
  ns.disableLog("ALL");

  // --- Flag parser (biztos bool/number kezelés) ---
  const flags = ns.flags([
    ["interval", 2000],        // ms
    ["reserve", 200e9],        // ennyit nem költünk el (200b)
    ["maxPositions", 1],       // egyszerre hány nyitott pozíció (long+short) lehet
    ["entry", 0.60],           // long belépés: forecast >= entry
    ["exit", 0.57],            // long kilépés: forecast <= exit
    ["maxSpreadPct", 0.03],    // spread szűrés vásárlásnál (0.03 = 3%)

    ["buyLimitFrac", 0.25],    // maxShares limitből mennyit engedünk venni (0.25 = 25%)
    ["maxSpendFrac", 0.30],    // budgetből max mennyit költsön egy vétel (0.30 = 30%)

    ["enableShort", false],    // shortolás (alapból OFF)
    ["shortEntry", 0.40],      // short belépés: forecast <= shortEntry
    ["shortExit", 0.43],       // short kilépés: forecast >= shortExit

    ["confirm", true],         // kérdezzen-e buy/sell előtt
    ["dry", false],            // ha true, nem tradel, csak logol
    ["once", false],           // ha true, egy ciklust fut és kilép
    ["tail", true],            // nyisson-e tail ablakot
    ["top", 8],                // logban mennyi jelöltet mutasson
  ]);

  function toBool(v) {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") return v.toLowerCase() === "true";
    return Boolean(v);
  }
  function toNum(v, def) {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  }

  const interval = toNum(flags.interval, 2000);
  const reserve = toNum(flags.reserve, 200e9);
  const maxPositions = Math.max(0, Math.floor(toNum(flags.maxPositions, 1)));

  const entry = toNum(flags.entry, 0.60);
  const exit = toNum(flags.exit, 0.57);
  const maxSpreadPct = toNum(flags.maxSpreadPct, 0.03);

  const buyLimitFrac = clamp01(toNum(flags.buyLimitFrac, 0.25));
  const maxSpendFrac = clamp01(toNum(flags.maxSpendFrac, 0.30));

  const enableShort = toBool(flags.enableShort);
  const shortEntry = toNum(flags.shortEntry, 0.40);
  const shortExit = toNum(flags.shortExit, 0.43);

  const confirm = toBool(flags.confirm);
  const dry = toBool(flags.dry);
  const once = toBool(flags.once);
  const topN = Math.max(0, Math.floor(toNum(flags.top, 8)));

  if (toBool(flags.tail)) ns.tail();

  // --- Main loop ---
  while (true) {
    ns.clearLog();

    const cash = ns.getServerMoneyAvailable("home");
    const budget = Math.max(0, cash - reserve);

    const symbols = ns.stock.getSymbols();

    // 1) Betöltjük a piac + pozíciók adatait
    const rows = symbols.map(sym => {
      const f = ns.stock.getForecast(sym);
      const vol = ns.stock.getVolatility(sym);

      const ask = ns.stock.getAskPrice(sym);
      const bid = ns.stock.getBidPrice(sym);

      const spreadPct = (ask > 0) ? ((ask - bid) / ask) : 1;

      const [longShares, longAvg, shortShares, shortAvg] = ns.stock.getPosition(sym);
      const maxShares = ns.stock.getMaxShares(sym);

      return { sym, f, vol, ask, bid, spreadPct, longShares, longAvg, shortShares, shortAvg, maxShares };
    });

    // 2) Meglévő pozíciók kezelése (SELL szabályok)
    const longPositions = rows.filter(r => r.longShares > 0);
    const shortPositions = rows.filter(r => r.shortShares > 0);

    let actions = 0;

    // 2A) Long pozíciók: kilépés ha forecast <= exit
    for (const p of longPositions) {
      if (p.f > exit) continue;

      const estProceeds = p.bid * p.longShares;
      const estCost = p.longAvg * p.longShares;
      const estPnL = estProceeds - estCost;

      ns.print(`[SELL-LONG jel] ${p.sym} f=${p.f.toFixed(3)} <= exit=${exit.toFixed(3)} | shares=${fmt(p.longShares)} | estPnL=$${ns.formatNumber(estPnL)}`);

      if (dry) continue;

      if (confirm) {
        const ok = await ns.prompt(`SELL LONG: ${p.sym}\nShares: ${fmt(p.longShares)}\nForecast: ${p.f.toFixed(3)} (<= ${exit.toFixed(3)})\nEladjam?`);
        if (!ok) continue;
      }

      ns.stock.sellStock(p.sym, p.longShares);
      actions++;
    }

    // 2B) Short pozíciók: kilépés ha forecast >= shortExit
    if (enableShort) {
      for (const p of shortPositions) {
        if (p.f < shortExit) continue;

        ns.print(`[CLOSE-SHORT jel] ${p.sym} f=${p.f.toFixed(3)} >= shortExit=${shortExit.toFixed(3)} | shares=${fmt(p.shortShares)}`);

        if (dry) continue;

        if (confirm) {
          const ok = await ns.prompt(`CLOSE SHORT: ${p.sym}\nShares: ${fmt(p.shortShares)}\nForecast: ${p.f.toFixed(3)} (>= ${shortExit.toFixed(3)})\nZárjam?`);
          if (!ok) continue;
        }

        ns.stock.sellShort(p.sym, p.shortShares);
        actions++;
      }
    }

    // 3) Ha van még hely új pozícióra, akkor belépés (BUY)
    const openPositionsCount = longPositions.length + (enableShort ? shortPositions.length : 0);

    // Friss budget, mert lehet, hogy eladtunk
    const cash2 = ns.getServerMoneyAvailable("home");
    const budget2 = Math.max(0, cash2 - reserve);

    // Log fej
    ns.print(`Cash: $${ns.formatNumber(cash2)} | Reserve: $${ns.formatNumber(reserve)} | Budget: $${ns.formatNumber(budget2)} | Dry: ${dry} | Confirm: ${confirm}`);
    ns.print(`Long entry>=${entry.toFixed(3)} exit<=${exit.toFixed(3)} | Spread<=${(maxSpreadPct*100).toFixed(2)}% | maxPos=${maxPositions} | actions=${actions}`);
    if (enableShort) ns.print(`Short entry<=${shortEntry.toFixed(3)} exit>=${shortExit.toFixed(3)}`);

    // Jelöltek listázása (top N)
    const longCandidates = rows
      .filter(r => r.longShares === 0 && r.shortShares === 0)
      .filter(r => r.f >= entry)
      .filter(r => r.spreadPct <= maxSpreadPct)
      .sort((a, b) => b.f - a.f);

    if (topN > 0) {
      ns.print("");
      ns.print(`Top LONG jelöltek (max ${topN}):`);
      for (const r of longCandidates.slice(0, topN)) {
        ns.print(`  ${r.sym} f=${r.f.toFixed(3)} vol=${r.vol.toFixed(4)} ask=${ns.formatNumber(r.ask)} spread=${(r.spreadPct*100).toFixed(2)}%`);
      }
    }

    if (openPositionsCount < maxPositions) {
      // 3A) Long belépés (ha van jelölt)
      const bestLong = longCandidates[0] ?? null;

      if (bestLong) {
        // Mennyi fér bele (limit + pénz + saját "óvatossági" cap)
        const usedShares = bestLong.longShares + bestLong.shortShares; // 0 itt
        const remainingShares = Math.max(0, bestLong.maxShares - usedShares);

        const perTradeBudget = Math.floor(budget2 * maxSpendFrac);
        const sharesByMoney = Math.floor(perTradeBudget / bestLong.ask);

        const capByLimitFrac = Math.floor(bestLong.maxShares * buyLimitFrac);

        const sharesToBuy = Math.min(remainingShares, sharesByMoney, capByLimitFrac);

        if (sharesToBuy > 0) {
          ns.print("");
          ns.print(`[BUY-LONG jel] ${bestLong.sym} f=${bestLong.f.toFixed(3)} | buyShares=${fmt(sharesToBuy)} | estCost=$${ns.formatNumber(sharesToBuy * bestLong.ask)} (budgetCap=$${ns.formatNumber(perTradeBudget)})`);

          if (!dry) {
            if (confirm) {
              const ok = await ns.prompt(
                `BUY LONG: ${bestLong.sym}\nShares: ${fmt(sharesToBuy)}\nForecast: ${bestLong.f.toFixed(3)} (>= ${entry.toFixed(3)})\nAsk: ${ns.formatNumber(bestLong.ask)}\nSpread: ${(bestLong.spreadPct*100).toFixed(2)}%\nMegveszem?`
              );
              if (ok) {
                ns.stock.buyStock(bestLong.sym, sharesToBuy);
                actions++;
              }
            } else {
              ns.stock.buyStock(bestLong.sym, sharesToBuy);
              actions++;
            }
          }
        } else {
          ns.print(`[BUY-LONG skip] ${bestLong.sym} jel van, de 0 darabot tudnánk venni (cap/limit/budget miatt).`);
        }
      } else if (enableShort) {
        // 3B) Short belépés (opcionális)
        const shortCandidates = rows
          .filter(r => r.longShares === 0 && r.shortShares === 0)
          .filter(r => r.f <= shortEntry)
          .filter(r => r.spreadPct <= maxSpreadPct)
          .sort((a, b) => a.f - b.f);

        const bestShort = shortCandidates[0] ?? null;

        if (bestShort) {
          const remainingShares = bestShort.maxShares; // 0 pozinál
          const perTradeBudget = Math.floor(budget2 * maxSpendFrac);
          const sharesByMoney = Math.floor(perTradeBudget / bestShort.ask);
          const capByLimitFrac = Math.floor(bestShort.maxShares * buyLimitFrac);
          const sharesToShort = Math.min(remainingShares, sharesByMoney, capByLimitFrac);

          if (sharesToShort > 0) {
            ns.print("");
            ns.print(`[OPEN-SHORT jel] ${bestShort.sym} f=${bestShort.f.toFixed(3)} | shortShares=${fmt(sharesToShort)}`);

            if (!dry) {
              if (confirm) {
                const ok = await ns.prompt(
                  `OPEN SHORT: ${bestShort.sym}\nShares: ${fmt(sharesToShort)}\nForecast: ${bestShort.f.toFixed(3)} (<= ${shortEntry.toFixed(3)})\nAsk: ${ns.formatNumber(bestShort.ask)}\nMegnyissam?`
                );
                if (ok) {
                  ns.stock.buyShort(bestShort.sym, sharesToShort);
                  actions++;
                }
              } else {
                ns.stock.buyShort(bestShort.sym, sharesToShort);
                actions++;
              }
            }
          } else {
            ns.print(`[OPEN-SHORT skip] ${bestShort.sym} jel van, de 0 darabot tudnánk shortolni (cap/limit/budget miatt).`);
          }
        }
      }
    } else {
      ns.print("");
      ns.print(`Pozíció limit tele (${openPositionsCount}/${maxPositions}). Most nem nyitunk újat.`);
    }

    if (once) break;
    await ns.sleep(interval);
  }
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function fmt(n) {
  // gyors, emberi darabszám
  if (n >= 1e9) return (n / 1e9).toFixed(3) + "b";
  if (n >= 1e6) return (n / 1e6).toFixed(3) + "m";
  if (n >= 1e3) return (n / 1e3).toFixed(3) + "k";
  return String(n);
}
