/** @param {NS} ns **/
export async function main(ns) {
  const F = ns.flags([
    // Deploy/network
    ["depth", 25],
    ["includeHome", true],
    ["homeReserve", 32],
    ["reserve", 0],
    ["killOld", true],
    ["threadsCap", 0],        // 0 = max; különben limit / host
    ["jitterMs", 3000],       // indulási jitter a workernek

    // Target
    ["auto", true],
    ["target", ""],           // ha megadod, ez lesz (auto felülírva)
    ["requireRootTarget", true],
    ["excludePurchasedTargets", true],

    // Worker behavior
    ["secBuffer", 0.25],
    ["moneyFrac", 0.10],
    ["minChance", 0.50],

    // Filenames
    ["worker", "xpfarm-worker.js"],

    // Logging
    ["quiet", false],
  ]);

  const WORKER = String(F.worker);
  const hasFormulas = !!(ns.formulas && ns.formulas.hacking);

  const asBool = (v) => v === true || v === "true" || v === 1 || v === "1";
  for (const k of ["includeHome","killOld","auto","requireRootTarget","excludePurchasedTargets","quiet"]) {
    F[k] = asBool(F[k]);
  }

  const purchased = new Set(ns.getPurchasedServers());

  function reserveFor(host) {
    let r = Number(F.reserve) || 0;
    if (host === "home") r = Math.max(r, Number(F.homeReserve) || 0);
    return Math.max(0, r);
  }

  function freeRam(host) {
    const max = ns.getServerMaxRam(host);
    const used = ns.getServerUsedRam(host);
    return Math.max(0, max - used - reserveFor(host));
  }

  function scanAll(depth) {
    const seen = new Set(["home"]);
    const q = [{ h: "home", d: 0 }];
    while (q.length) {
      const { h, d } = q.shift();
      if (d >= depth) continue;
      for (const n of ns.scan(h)) {
        if (!seen.has(n)) {
          seen.add(n);
          q.push({ h: n, d: d + 1 });
        }
      }
    }
    return [...seen];
  }

  function isRunner(host) {
    if (!F.includeHome && host === "home") return false;
    return ns.hasRootAccess(host) && ns.getServerMaxRam(host) > 0;
  }

  // ---- Safe formulas calls (feature detect + try/catch) ----
  function safeFormula(fnName, serverObj, playerObj, fallbackFn) {
    try {
      const fn = ns.formulas?.hacking?.[fnName];
      if (typeof fn === "function") return fn(serverObj, playerObj);
    } catch {}
    return fallbackFn();
  }

  function scoreTarget(host) {
    const req = ns.getServerRequiredHackingLevel(host);
    const my = ns.getHackingLevel();
    if (req > my) return -1;

    const maxMoney = ns.getServerMaxMoney(host);
    if (!maxMoney || maxMoney <= 0) return -1;

    if (F.excludePurchasedTargets && purchased.has(host)) return -1;
    if (F.requireRootTarget && !ns.hasRootAccess(host)) return -1;

    const chance = ns.hackAnalyzeChance(host);
    if (chance <= 0.01) return -1;

    // Scoring: expected hack XP / second at "ideal" state (min sec, max money)
    if (hasFormulas) {
      const s = ns.getServer(host);
      const p = ns.getPlayer();

      // “idealize” server state
      s.hackDifficulty = s.minDifficulty;
      s.moneyAvailable = s.moneyMax;

      const tHack = safeFormula(
        "hackTime",
        s, p,
        () => ns.getHackTime(host)
      );

      const expHack = safeFormula(
        "hackExp",
        s, p,
        () => ns.hackAnalyzeExp(host)
      );

      const c = safeFormula(
        "hackChance",
        s, p,
        () => ns.hackAnalyzeChance(host)
      );

      return (expHack * c) / Math.max(1, tHack);
    }

    // Fallback (no formulas)
    const tHack = ns.getHackTime(host);
    const expHack = ns.hackAnalyzeExp(host);
    return (expHack * chance) / Math.max(1, tHack);
  }

  function pickBestTarget(candidates) {
    let best = null;
    let bestScore = -1;
    for (const h of candidates) {
      const sc = scoreTarget(h);
      if (sc > bestScore) {
        bestScore = sc;
        best = h;
      }
    }
    return { best, bestScore };
  }

  // ---- main ----
  if (!ns.fileExists(WORKER, "home")) {
    ns.tprint(`HIBA: hiányzik a worker: ${WORKER}`);
    return;
  }

  const all = scanAll(Number(F.depth) || 25);
  const runners = all.filter(isRunner);

  // choose target
  let target = String(F.target || "").trim();
  if (!target) {
    if (!F.auto) {
      ns.tprint(`HIBA: nincs --target és --auto false`);
      return;
    }
    const candidates = all.filter(h => h !== "home");
    const { best, bestScore } = pickBestTarget(candidates);
    if (!best) {
      ns.tprint(`HIBA: nem találtam értelmes XP targetet a szűrőkkel.`);
      return;
    }
    target = best;
    if (!F.quiet) ns.tprint(`XP target (auto): ${target} | score=${bestScore}`);
  } else {
    if (!ns.serverExists(target)) {
      ns.tprint(`HIBA: target nem létezik: ${target}`);
      return;
    }
  }

  // SCP worker everywhere
  for (const h of runners) {
    if (h === "home") continue;
    await ns.scp(WORKER, h, "home");
  }

  const ramPerThread = ns.getScriptRam(WORKER, "home");
  if (!(ramPerThread > 0)) {
    ns.tprint(`HIBA: worker RAM = 0? (${WORKER})`);
    return;
  }

  let launched = 0;
  let totalThreads = 0;

  for (const h of runners) {
    if (F.killOld) ns.scriptKill(WORKER, h);

    const fr = freeRam(h);
    let th = Math.floor(fr / ramPerThread);
    if (Number(F.threadsCap) > 0) th = Math.min(th, Number(F.threadsCap));

    if (th <= 0) continue;

    const jitter = Math.floor(Math.random() * Math.max(0, Number(F.jitterMs) || 0));

    const pid = ns.exec(
      WORKER, h, th,
      "--target", target,
      "--secBuffer", String(F.secBuffer),
      "--moneyFrac", String(F.moneyFrac),
      "--minChance", String(F.minChance),
      "--initialDelay", String(jitter)
    );

    if (pid !== 0) {
      launched++;
      totalThreads += th;
    }
  }

  ns.tprint(`XP farm deploy kész. Target=${target} | runners=${runners.length} | started=${launched} | totalThreads=${totalThreads}`);
  ns.tprint(`Tip: ha a sec nagyon elszáll / idő nő: adj --threadsCap 500 vagy növeld --jitterMs értékét.`);
}
