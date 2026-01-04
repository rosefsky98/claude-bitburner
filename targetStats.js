/** @param {NS} ns */
export async function main(ns) {
  const flags = ns.flags([
    ["depth", 10],          // mint a scan-analyze 3
    ["all", false],        // ha true: depth limit nélkül (mindent)
    ["sort", "reqHack"],     // depth | maxMoney | reqHack | chance
    ["desc", false],       // fordított rendezés
    ["onlyRooted", false], // csak feltört
    ["onlyHackable", false], // csak amihez elég a hacking szinted
    ["noHome", false],     // home kihagyása
  ]);

  const depthLimit = flags.all ? Infinity : Number(flags.depth);
  const me = ns.getHackingLevel();

  // BFS felfedezés depth-ig
  const { nodes, depthMap } = bfs(ns, "home", depthLimit);

  // Gyűjtés + szűrés
  let rows = [];
  for (const host of nodes) {
    if (flags.noHome && host === "home") continue;

    const s = ns.getServer(host);
    const rooted = ns.hasRootAccess(host);
    const reqHack = ns.getServerRequiredHackingLevel(host);

    if (flags.onlyRooted && !rooted) continue;
    if (flags.onlyHackable && reqHack > me) continue;

    const maxMoney = ns.getServerMaxMoney(host);
    const moneyNow = ns.getServerMoneyAvailable(host);
    const growth = ns.getServerGrowth(host);

    const minSec = ns.getServerMinSecurityLevel(host);
    const secNow = ns.getServerSecurityLevel(host);

    const chance = ns.hackAnalyzeChance(host);
    const hackTime = ns.getHackTime(host);

    const portsReq = ns.getServerNumPortsRequired(host);
    const maxRam = ns.getServerMaxRam(host);

    rows.push({
      host,
      depth: depthMap.get(host) ?? 999,
      rooted,
      backdoor: Boolean(s.backdoorInstalled),
      reqHack,
      portsReq,
      maxRam,
      moneyNow,
      maxMoney,
      growth,
      secNow,
      minSec,
      chance,
      hackTime,
    });
  }

  // Rendezés
  rows.sort((a, b) => {
    const key = String(flags.sort);
    let va, vb;

    if (key === "maxMoney") { va = a.maxMoney; vb = b.maxMoney; }
    else if (key === "reqHack") { va = a.reqHack; vb = b.reqHack; }
    else if (key === "chance") { va = a.chance; vb = b.chance; }
    else { va = a.depth; vb = b.depth; } // depth default

    const diff = va - vb;
    return flags.desc ? -diff : diff;
  });

  ns.tprint(`Hacking level: ${me} | Depth limit: ${flags.all ? "ALL" : depthLimit} | Talált: ${rows.length}`);

  for (const r of rows) {
    const rootStr = r.rooted ? "Y" : "N";
    const bdStr = r.backdoor ? "Y" : "N";

    const moneyStr = r.maxMoney > 0
      ? `${ns.formatNumber(r.moneyNow)}/${ns.formatNumber(r.maxMoney)}`
      : `0/0`;

    ns.tprint(
      `${String(r.depth).padStart(2, " ")} | ${r.host.padEnd(18, " ")} ` +
      `root=${rootStr} bd=${bdStr} ` +
      `req=${String(r.reqHack).padStart(3, " ")} ports=${r.portsReq} ` +
      `ram=${r.maxRam.toFixed(2)} ` +
      `$=${moneyStr} g=${String(r.growth).padStart(4, " ")} ` +
      `sec=${r.secNow.toFixed(2)}/${r.minSec.toFixed(0)} ` +
      `ch=${(r.chance * 100).toFixed(1)}% ` +
      `hack=${ns.tFormat(r.hackTime)}`
    );
  }
}

function bfs(ns, start, depthLimit) {
  const queue = [{ host: start, depth: 0 }];
  const visited = new Set([start]);
  const depthMap = new Map([[start, 0]]);
  const nodes = [start];

  while (queue.length) {
    const { host, depth } = queue.shift();
    if (depth >= depthLimit) continue;

    for (const next of ns.scan(host)) {
      if (visited.has(next)) continue;
      visited.add(next);
      depthMap.set(next, depth + 1);
      nodes.push(next);
      queue.push({ host: next, depth: depth + 1 });
    }
  }
  return { nodes, depthMap };
}
