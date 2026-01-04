# 🚀 Bitburner Batch Farming Toolkit

    This repository contains a collection of scripts and helpers for running HWGW-style batch farms, managing servers, and experimenting with stock/XP automation in Bitburner.

    ## Quick overview

    Top-level scripts and their purposes:

    ```
    analyze-targets.js    - Scan servers and rank targets by profitability
    auto-root.js          - Attempt to root all reachable servers (with optional continuous mode)
    batch-manager.js      - Main HWGW batch orchestrator (prep + schedule batches)
    startup.js            - Convenience script to start the whole system
    server-buyer.js       - Buy/upgrade player servers automatically
    purchaseServer.js     - Helper: purchase a single server (used by server-buyer)
    multi-launcher.js     - Helper to launch many worker scripts across servers
    proto-batcher.js      - Alternative/simpler batcher for testing
    analyze-targets.js    - Target analytics and reporting
    batch/                - Worker scripts run by the batch manager
        ├─ hack.js           - Worker that performs hack() on target
        ├─ grow.js           - Worker that performs grow() on target
        └─ weaken.js         - Worker that performs weaken() on target

    bb-*                  - Experimental BB (batch/bot) variants
    stock-trader.js       - Minimal stock forecast lister (diagnostic)
    stockTrader.js        - Full-featured stock trading bot (4S-aware)
    stock-vs.js           - 4S-optimized stock trader (long-only)
    targetStats.js        - Utilities to gather and persist target stats
    timeToLevel.js        - Estimate time to reach hacking level thresholds
    xpfarm-deploy.js      - Deploy XP-farming workers across servers
    xpfarm-worker.js      - Single XP-farm worker script
    xpFleet.js            - Manage a fleet of XP workers
    bn4-root.js           - 4S / BitNode helper for advanced rooting (experimental)
    buy-nfg.js            - Buy NFG (Netscript functions) or related items (helper)
    cct-solver.js         - Crack-Coder-Tool solver helper (utilities)
    shareLoop.js          - Simple share() loop helper for faction rep
    README.md             - This file
    ```

    ## Quick start

    Run the all-in-one startup (recommended):

    ```text
    run startup.js
    ```

    Start a single batch manager for a specific target:

    ```text
    run batch-manager.js foodnstuff
    ```

    Or let it auto-select the best target:

    ```text
    run batch-manager.js --auto
    ```

    ## Scripts: Short descriptions & usage

    - analyze-targets.js: Scans servers and prints a ranked list. Useful flags: `--detailed`, `--top N`.
    - auto-root.js: Tries to gain root on servers using available exploits. Flags: `--continuous`, `--interval N`.
    - batch-manager.js: The main batch orchestration script (prep, schedule, monitor). Options: `target`, `--auto`, `--prep`, `--quiet`.
    - startup.js: Starts auto-root, server buyer, and batch-manager(s) as a convenience wrapper.
    - server-buyer.js / purchaseServer.js: Buy and upgrade purchased servers automatically. Flags: `--ram N`, `--max N`, `--upgrade`, `--continuous`.
    - multi-launcher.js: Distribute worker scripts to many purchased/owned servers.
    - proto-batcher.js: Simpler prototype batcher for testing timing and scheduling logic.
    - batch/hack.js, batch/grow.js, batch/weaken.js: Worker scripts invoked by `batch-manager.js` to perform HWGW cycles.
    - bb-* scripts: Alternate/beta batch manager and worker variants (keep separate for testing).
    - stock-trader.js: Small diagnostic script that lists stock symbols and their forecasts.
    - stockTrader.js: Robust stock trading bot with compatibility for older/newer Bitburner APIs and 4S checks.
    - stock-vs.js: A 4S-optimized long-only trader (uses 4S market data, respects volatility and position caps).
    - targetStats.js: Collects and reports per-target metrics used by the batch manager.
    - timeToLevel.js: Estimate hours/minutes to next hacking level based on current XP gains.
    - xpfarm-deploy.js / xpfarm-worker.js / xpFleet.js: Helpers to deploy and manage XP farming workers across servers.
    - bn4-root.js, buy-nfg.js, cct-solver.js, shareLoop.js: Utility scripts for niche tasks (rooting, purchases, CCT solving, share loop).

    ## Configuration

    Most tuning parameters live at the top of `batch-manager.js` (or `CONFIG` in that file). Common knobs:

    - `batchDelay` / `cycleDelay` — timing between operations and batches
    - `hackPercent` — fraction of server money to hack per batch
    - `maxPositions` / `minTradeValue` — in stock traders, control risk and trade size

    Adjust conservatively and test on small targets before scaling.

    ## Troubleshooting

    - If scripts crash with API errors, your Bitburner version may use older/newer stock APIs — check `stockTrader.js` and `stock-vs.js` for compatibility wrappers (`buyStock`/`buy`).
    - Make sure you have 4S Market Data before running 4S-optimized stock scripts (`stock-vs.js`, `stockTrader.js`).
    - Use `tail <script>` to inspect logs and `kill <script>` / `killall` to stop scripts when experimenting.

    ## Tips

    - Start with a single `batch-manager.js` on a small target and observe timings.
    - Use `analyze-targets.js` to pick good targets early in the game.
    - Let `server-buyer.js` manage purchased servers to free up manual management.

    ---

    Maintainer: Claude AI (adapted by repository owner)
    Version: 1.1 — improved script catalog and usage notes
    ```
Idő -->
