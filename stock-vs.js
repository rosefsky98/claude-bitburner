/** @param {NS} ns */
export async function main(ns) {
    // Verify 4S access
    if (!ns.stock.has4SData()) {
        ns.tprint("ERROR: 4S Market Data not available!");
        return;
    }

    // API compatibility wrappers
    const buyLong = (sym, shares) =>
        (ns.stock.buyStock ? ns.stock.buyStock(sym, shares) : ns.stock.buy(sym, shares));

    const sellLong = (sym, shares) =>
        (ns.stock.sellStock ? ns.stock.sellStock(sym, shares) : ns.stock.sell(sym, shares));

    const FLAGS = {
        interval: 3000,           // Check every 3 seconds
        maxSpendFrac: 0.9,        // Use up to 90% of cash
        maxPositions: 20,         // Max concurrent positions
        buyThreshold: 0.60,       // Buy when forecast >= 60%
        sellThreshold: 0.50,      // Sell when forecast < 50%
        volatilityLimit: 0.20,    // Max volatility for buy
        minTradeValue: 50_000_000, // Min $50M per trade (avoid churn)
        quiet: false
    };

    const symbols = ns.stock.getSymbols();

    function getPortfolioStats(syms) {
        let equity = ns.getPlayer().money;
        let positions = 0;

        for (const sym of syms) {
            const [shares] = ns.stock.getPosition(sym);
            if (shares > 0) {
                positions++;
                equity += shares * ns.stock.getBidPrice(sym);
            }
        }
        return { equity, positions, cash: ns.getPlayer().money };
    }

    ns.disableLog("ALL");

    while (true) {
        const stats = getPortfolioStats(symbols);

        // Sort by forecast (strongest first)
        const ranked = symbols
            .map((sym) => ({
                sym,
                forecast: ns.stock.getForecast(sym),
                volatility: ns.stock.getVolatility(sym),
                bid: ns.stock.getBidPrice(sym),
                ask: ns.stock.getAskPrice(sym),
                shares: ns.stock.getPosition(sym)[0],
                maxShares: ns.stock.getMaxShares(sym)
            }))
            .filter(s => s.maxShares > 0)
            .sort((a, b) => b.forecast - a.forecast);

        // SELL phase (liquidate weak positions)
        for (const stock of ranked) {
            if (stock.shares > 0 && stock.forecast < FLAGS.sellThreshold) {
                sellLong(stock.sym, stock.shares);
                if (!FLAGS.quiet) {
                    ns.print(
                        `SELL ${stock.sym}: ${stock.shares} shares @ ${ns.formatNumber(stock.bid)} ` +
                        `(forecast: ${(stock.forecast * 100).toFixed(1)}%)`
                    );
                }
            }
        }

        // BUY phase (open new positions)
        const updatedStats = getPortfolioStats(symbols);
        let spendBudget = updatedStats.cash * FLAGS.maxSpendFrac;

        for (const stock of ranked) {
            if (updatedStats.positions >= FLAGS.maxPositions) break;
            if (stock.shares > 0) continue; // Already holding
            if (stock.forecast < FLAGS.buyThreshold) continue;
            if (stock.volatility > FLAGS.volatilityLimit) continue;

            const tradeValue = Math.min(
                spendBudget,
                stock.maxShares * stock.ask
            );

            if (tradeValue < FLAGS.minTradeValue) continue;

            const sharesToBuy = Math.floor(tradeValue / stock.ask);
            if (sharesToBuy <= 0) continue;

            buyLong(stock.sym, sharesToBuy);
            if (!FLAGS.quiet) {
                ns.print(
                    `BUY ${stock.sym}: ${sharesToBuy} shares @ ${ns.formatNumber(stock.ask)} ` +
                    `(forecast: ${(stock.forecast * 100).toFixed(1)}%, vol: ${(stock.volatility * 100).toFixed(1)}%)`
                );
            }

            spendBudget -= sharesToBuy * stock.ask;
            updatedStats.positions++;
        }

        if (!FLAGS.quiet) {
            const current = getPortfolioStats(symbols);
            ns.print(
                `Portfolio: ${current.positions} positions | ` +
                `Equity: ${ns.formatNumber(current.equity)} | ` +
                `Cash: ${ns.formatNumber(current.cash)}`
            );
        }

        await ns.sleep(FLAGS.interval);
    }
}