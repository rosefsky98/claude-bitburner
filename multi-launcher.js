/** @param {NS} ns **/
export async function main(ns) {
  ns.disableLog("ALL");

  const flags = ns.flags([
    ["targetCount", 3],     // <-- EZ VOLT ["n", 3]
    ["prep", false],
    ["hackFrac", 0.10],
    ["reserveHomeRam", 32],
    ["maxBatches", 30],
    ["batchDelay", 200],
    ["cycleDelay", 50],
  ]);

  const targets = pickTopTargets(ns, flags.targetCount);
  if (targets.length === 0) {
    ns.tprint("Nincs megfelelő target (root + maxMoney + elég hacking).");
    return;
  }

  ns.tprint(`Indítok ${targets.length} targetet: ${targets.join(", ")}`);

  for (const t of targets) {
    const pid = ns.run(
      "batch-manager.js",
      1,
      t
    );

    ns.tprint(`${pid ? "OK" : "FAIL"} batch-manager -> ${t}`);
    await ns.sleep(200);
  }
}

function pickTopTargets(ns, targetCount) {
  const servers = scanAll(ns, "home")
    .filter(s => s !== "home")
    .filter(s => ns.hasRootAccess(s))
    .filter(s => ns.getServerMaxMoney(s) > 0)
    .filter(s => ns.getHackingLevel() >= ns.getServerRequiredHackingLevel(s));

  const scored = servers
    .map(host => ({ host, score: scoreHost(ns, host) }))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, targetCount).map(x => x.host);
}

function scoreHost(ns, host) {
  const maxMoney = ns.getServerMaxMoney(host);
  const wt = ns.getWeakenTime(host);
  const minSec = ns.getServerMinSecurityLevel(host);
  const growth = ns.getServerGrowth(host);

  return (maxMoney / Math.max(wt, 1)) * (1 + growth / 100) / (1 + minSec / 100);
}

function scanAll(ns, start) {
  const visited = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const h = queue.shift();
    for (const n of ns.scan(h)) {
      if (!visited.has(n)) {
        visited.add(n);
        queue.push(n);
      }
    }
  }
  return [...visited];
}
