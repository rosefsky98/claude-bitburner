/** @param {NS} ns **/
export async function main(ns) {
  const F = ns.flags([
    // Network
    ["depth", 25],
    ["includeHome", true],
    ["homeReserve", 32],
    ["reserve", 0],
    ["refreshMs", 15000],

    // Target selection
    ["maxTargets", 3],
    ["minChance", 0.65],
    ["minMaxMoney", 1e8],
    ["onlyRootedTargets", false], // NOTE: targethez nem kell root; ez csak szűrés
    ["onlyHackableTargets", true],
    ["excludePurchasedTargets", true],
    ["target", ""], // ha megadod, csak ezt használja

    // Strategy
    ["hackFrac", 0.08],
    ["moneyKeep", 0.85],
    ["moneyPrep", 1.00],
    ["secBuf", 0.0],

    // Timing
    ["gap", 200],
    ["batchInterval", 450],
    ["tick", 200],

    // Caps (kontrollált pipeline)
    ["perTargetCap", 60],
    ["globalCap", 0],            // DEPRECATED: nem használjuk, csak kompatibilitás
    ["maxLaunchPerTick", 10],     // batch-ek / tick
    ["maxExecPerTick", 200],      // ns.exec hívások / tick (black screen ellen)

    // Drift (stabilitás)
    ["driftSec", 3.0],
    ["driftMoney", 0.82],
    ["driftConfirm", 3],
    ["driftEmaAlpha", 0.35],      // 0..1, nagyobb = gyorsabban reagál

    // UI/log
    ["tail", true],
    ["quiet", false],
    ["logEveryMs", 3000],
  ]);

  // ---------- flag normalization (Bitburner ns.flags() néha "false" stringet ad) ----------
  const asBool = (v) => v === true || v === "true" || v === 1 || v === "1";
  const asNum = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };

  for (const k of ["includeHome","onlyRootedTargets","onlyHackableTargets","excludePurchasedTargets","tail","quiet"]) {
    if (k in F) F[k] = asBool(F[k]);
  }
  for (const k of ["depth","homeReserve","reserve","refreshMs","maxTargets","minChance","minMaxMoney","hackFrac","moneyKeep","moneyPrep",
                   "secBuf","gap","batchInterval","tick","perTargetCap","globalCap","maxLaunchPerTick","maxExecPerTick",
                   "driftSec","driftMoney","driftConfirm","driftEmaAlpha","logEveryMs"]) {
    if (k in F) F[k] = asNum(F[k], F[k]);
  }

  // ---------- scripts ----------
  const S = { H: "bb-hack.js", G: "bb-grow.js", W: "bb-weaken.js" };

  // Tail
  if (F.tail) {
    if (ns.ui?.openTail) ns.ui.openTail();
    else ns.tail();
  }

  // logs
  ns.disableLog("sleep");
  ns.disableLog("scan");
  ns.disableLog("scp");
  ns.disableLog("getServerUsedRam");
  ns.disableLog("getServerMaxRam");
  ns.disableLog("getServerMoneyAvailable");
  ns.disableLog("getServerSecurityLevel");
  ns.disableLog("getHackTime");
  ns.disableLog("getGrowTime");
  ns.disableLog("getWeakenTime");
  ns.disableLog("getServerMinSecurityLevel");
  ns.disableLog("getServerMaxMoney");
  ns.disableLog("exec");
  ns.disableLog("kill");
  ns.disableLog("ps");
  ns.disableLog("getServerRequiredHackingLevel");

  // Verify helper scripts exist
  const ramH = ns.getScriptRam(S.H, "home");
  const ramG = ns.getScriptRam(S.G, "home");
  const ramW = ns.getScriptRam(S.W, "home");
  if (!(ramH > 0 && ramG > 0 && ramW > 0)) {
    ns.tprint("HIBA: bb-hack.js / bb-grow.js / bb-weaken.js hiányzik vagy 0 RAM.");
    return;
  }

  // ---------- helpers ----------
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

  function purchasedSet() {
    return new Set(ns.getPurchasedServers());
  }

  function reserveFor(host) {
    let r = asNum(F.reserve, 0);
    if (host === "home") r = Math.max(r, asNum(F.homeReserve, 0));
    return Math.max(0, r);
  }

  function freeRam(host) {
    const max = ns.getServerMaxRam(host);
    const used = ns.getServerUsedRam(host);
    return Math.max(0, max - used - reserveFor(host));
  }

  function isRunner(host) {
    return ns.hasRootAccess(host) && ns.getServerMaxRam(host) > 0;
  }

  async function ensureScriptsOn(runners) {
    const files = [S.H, S.G, S.W];
    for (const h of runners) {
      if (h === "home") continue;
      let need = false;
      for (const f of files) {
        if (!ns.fileExists(f, h)) { need = true; break; }
      }
      if (need) await ns.scp(files, h, "home");
    }
  }

  function getTimes(target) {
    return {
      tH: Math.max(1, ns.getHackTime(target)),
      tG: Math.max(1, ns.getGrowTime(target)),
      tW: Math.max(1, ns.getWeakenTime(target)),
    };
  }

  function hackPctPerThread(target) {
    return Math.max(0.0000001, ns.hackAnalyze(target));
  }

  function growThreads(target, startMoney, goalMoney) {
    startMoney = Math.max(1, startMoney);
    goalMoney = Math.max(1, goalMoney);
    if (goalMoney <= startMoney) return 0;
    const mult = goalMoney / startMoney;
    return Math.max(1, Math.ceil(ns.growthAnalyze(target, mult, 1)));
  }

  function weakenThreadsFor(secIncrease) {
    const per = Math.max(0.000001, ns.weakenAnalyze(1, 1));
    return Math.max(1, Math.ceil(secIncrease / per));
  }

  function scoreTargets(allHosts) {
    const pserv = purchasedSet();
    const myHack = ns.getHackingLevel();
    const out = [];
    for (const h of allHosts) {
      if (h === "home") continue;
      if (F.excludePurchasedTargets && pserv.has(h)) continue;
      if (F.onlyRootedTargets && !ns.hasRootAccess(h)) continue;

      const maxMoney = ns.getServerMaxMoney(h);
      if (!maxMoney || maxMoney < F.minMaxMoney) continue;

      const req = ns.getServerRequiredHackingLevel(h);
      if (F.onlyHackableTargets && req > myHack) continue;

      const chance = Math.max(0, Math.min(1, ns.hackAnalyzeChance(h)));
      if (chance < F.minChance) continue;

      const { tW } = getTimes(h);
      const pct = hackPctPerThread(h);
      const score = (maxMoney * pct * chance) / tW;
      out.push({ host: h, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  function killOurTargetScripts(runners, target) {
    const names = new Set([S.H, S.G, S.W]);
    for (const h of runners) {
      for (const p of ns.ps(h)) {
        if (names.has(p.filename) && String(p.args?.[0]) === String(target)) {
          try { ns.kill(p.pid, h); } catch {}
        }
      }
    }
  }

  // ---- Atomic plan allocation (pack on biggest hosts, minimal split) ----
  function planAlloc(tasks, runners) {
    const freeMap = new Map();
    for (const h of runners) {
      const fr = freeRam(h);
      if (fr > 0) freeMap.set(h, fr);
    }

    const sorted = [...tasks]
      .filter(t => t.threads > 0)
      .sort((a, b) => (b.threads * b.ramPerThread) - (a.threads * a.ramPerThread));

    const plan = [];
    for (const t of sorted) {
      let left = t.threads;

      while (left > 0) {
        let bestHost = null;
        let bestFree = 0;
        for (const [h, f] of freeMap.entries()) {
          if (f > bestFree) { bestFree = f; bestHost = h; }
        }
        if (!bestHost) return null;

        const can = Math.floor(bestFree / t.ramPerThread);
        if (can <= 0) { freeMap.delete(bestHost); continue; }

        const use = Math.min(can, left);
        freeMap.set(bestHost, bestFree - use * t.ramPerThread);

        plan.push({ host: bestHost, script: t.script, threads: use, target: t.target, delay: t.delay });
        left -= use;
      }
    }
    return plan;
  }

  function execPlanAtomic(plan) {
    const started = [];
    for (const a of plan) {
      const pid = ns.exec(a.script, a.host, a.threads, a.target, a.delay);
      if (pid === 0) {
        for (const p of started) { try { ns.kill(p.pid, p.host); } catch {} }
        return false;
      }
      started.push({ host: a.host, pid });
    }
    return true;
  }

  // ---------- state per target ----------
  const st = new Map();
  function state(host) {
    if (!st.has(host)) {
      st.set(host, {
        mode: "prep",
        prepUntil: 0,
        anchorEnd: 0,
        inflightEnds: [],
        driftStreak: 0,
        emaMoneyRatio: 1.0,
        emaSecDelta: 0.0,
        cooldownUntil: 0,
        totalBatches: 0,
      });
    }
    return st.get(host);
  }

  // ---------- main loop ----------
  let allHosts = [];
  let runners = [];
  let targets = [];
  let lastRefresh = 0;
  let lastLog = 0;

  const skip = {
    prepWait: 0,
    capTarget: 0,
    ram: 0,
    planFail: 0,
    execFail: 0,
    noTargets: 0,
    cooldown: 0,
    driftReset: 0,
  };
  let totalExecCalls = 0;
  let totalBatches = 0;

  const maxExecPerTick = () => (F.maxExecPerTick > 0 ? F.maxExecPerTick : Infinity);
  const maxLaunchPerTick = () => (F.maxLaunchPerTick > 0 ? F.maxLaunchPerTick : Infinity);

  while (true) {
    const now = Date.now();

    // refresh
    if (lastRefresh === 0 || now - lastRefresh >= F.refreshMs) {
      allHosts = scanAll(F.depth);
      runners = allHosts
        .filter(h => (F.includeHome ? true : h !== "home"))
        .filter(isRunner);

      await ensureScriptsOn(runners);

      if (String(F.target || "").trim()) {
        const tgt = String(F.target).trim();
        targets = [{ host: tgt, score: 1 }];
        state(tgt);
      } else {
        const ranked = scoreTargets(allHosts);
        targets = ranked.slice(0, Math.max(1, Math.floor(F.maxTargets)));
        for (const t of targets) state(t.host);
      }

      lastRefresh = now;
      for (const k of Object.keys(skip)) skip[k] = 0;
      totalExecCalls = 0;
      totalBatches = 0;
    }

    if (targets.length === 0) {
      skip.noTargets++;
      await ns.sleep(Math.max(50, F.tick));
      continue;
    }

    // prune inflight
    for (const t of targets) {
      const s = state(t.host);
      while (s.inflightEnds.length && s.inflightEnds[0] <= now) s.inflightEnds.shift();
    }

    // scheduling budgets
    let launchedBatches = 0;
    let execBudget = maxExecPerTick();

    for (const t of targets) {
      if (launchedBatches >= maxLaunchPerTick()) break;
      if (execBudget <= 0) break;

      const target = t.host;
      const s = state(target);

      const maxMoney = ns.getServerMaxMoney(target);
      const moneyGoal = Math.max(1, maxMoney * F.moneyPrep);
      const minSec = ns.getServerMinSecurityLevel(target) + F.secBuf;

      const curMoney = ns.getServerMoneyAvailable(target);
      const curSec = ns.getServerSecurityLevel(target);

      const moneyRatio = moneyGoal > 0 ? curMoney / moneyGoal : 1;
      const secDelta = curSec - minSec;

      // EMA update
      const a = Math.min(1, Math.max(0, F.driftEmaAlpha));
      s.emaMoneyRatio = (1 - a) * s.emaMoneyRatio + a * moneyRatio;
      s.emaSecDelta = (1 - a) * s.emaSecDelta + a * secDelta;

      // cooldown after drift reset
      if (now < s.cooldownUntil) { skip.cooldown++; continue; }

      // drift check: csak batch alatt és csak ha van inflight
      const driftActive = (s.mode === "batch" && s.inflightEnds.length > 0);
      const driftMoneyOn = (F.driftMoney > 0);
      const driftSecOn = (F.driftSec > 0);

      const drift =
        driftActive && (
          (driftSecOn && s.emaSecDelta > F.driftSec) ||
          (driftMoneyOn && s.emaMoneyRatio < F.driftMoney)
        );

      s.driftStreak = drift ? (s.driftStreak + 1) : 0;

      if (s.driftStreak >= Math.max(1, Math.floor(F.driftConfirm))) {
        s.driftStreak = 0;
        skip.driftReset++;

        killOurTargetScripts(runners, target);
        s.inflightEnds.length = 0;
        s.anchorEnd = 0;
        s.mode = "prep";

        const { tW } = getTimes(target);
        s.prepUntil = now + Math.min(2000, tW * 0.25);
        s.cooldownUntil = now + Math.min(5000, tW * 0.35);
        continue;
      }

      // per-target cap
      if (s.inflightEnds.length >= Math.max(1, Math.floor(F.perTargetCap))) { skip.capTarget++; continue; }

      // ---------- PREP mode ----------
      if (s.mode === "prep") {
        if (now < s.prepUntil) { skip.prepWait++; continue; }

        const needSec = curSec > minSec + 0.50;
        const needMoney = curMoney < moneyGoal * 0.97;

        if (!needSec && !needMoney) {
          s.mode = "batch";
          s.anchorEnd = 0;
          s.prepUntil = 0;
          s.emaMoneyRatio = moneyRatio;
          s.emaSecDelta = secDelta;
          continue;
        }

        const { tG, tW } = getTimes(target);
        const secNeed = Math.max(0, curSec - minSec);

        if (needSec && !needMoney) {
          const wT = weakenThreadsFor(secNeed);
          const tasks = [{ script: S.W, threads: wT, delay: 0, ramPerThread: ramW, target }];
          const plan = planAlloc(tasks, runners);
          if (!plan) { skip.ram++; s.prepUntil = now + 500; continue; }
          if (plan.length > execBudget) { skip.planFail++; s.prepUntil = now + 500; continue; }
          if (!execPlanAtomic(plan)) { skip.execFail++; s.prepUntil = now + 500; continue; }
          totalExecCalls += plan.length;
          execBudget -= plan.length;
          s.prepUntil = now + tW + 250;
          continue;
        }

        // needMoney: grow + weaken (fix: weaken számolja a meglévő sec túllövést is)
        const start = Math.max(1, curMoney);
        const gT = growThreads(target, start, moneyGoal);
        const wT = weakenThreadsFor(secNeed + gT * 0.004);

        const tasks = [
          { script: S.G, threads: gT, delay: 0, ramPerThread: ramG, target },
          { script: S.W, threads: wT, delay: 0, ramPerThread: ramW, target },
        ];

        const plan = planAlloc(tasks, runners);
        if (!plan) { skip.ram++; s.prepUntil = now + 500; continue; }
        if (plan.length > execBudget) { skip.planFail++; s.prepUntil = now + 500; continue; }
        if (!execPlanAtomic(plan)) { skip.execFail++; s.prepUntil = now + 500; continue; }

        totalExecCalls += plan.length;
        execBudget -= plan.length;
        s.prepUntil = now + Math.max(tG, tW) + 250;
        continue;
      }

      // ---------- BATCH mode ----------
      const { tH, tG, tW } = getTimes(target);
      const gap = Math.max(50, Math.floor(F.gap));
      const interval = Math.max(gap, Math.floor(F.batchInterval));

      const pct = hackPctPerThread(target);
      const desired = Math.min(F.hackFrac, 1 - F.moneyKeep);
      const hT = Math.max(1, Math.ceil(desired / pct));
      const actualFrac = Math.min(0.95, hT * pct);

      const moneyAfterHack = Math.max(1, moneyGoal * (1 - actualFrac));
      const gT = growThreads(target, moneyAfterHack, moneyGoal);

      const w1T = weakenThreadsFor(hT * 0.002);
      const w2T = weakenThreadsFor(gT * 0.004);

      const ramPerBatch = hT * ramH + gT * ramG + (w1T + w2T) * ramW;
      const totalFree = runners.reduce((acc, h) => acc + freeRam(h), 0);
      if (totalFree < ramPerBatch) { skip.ram++; continue; }

      const leadMin = Math.max(
        tH,
        tW - gap,
        tG - 2 * gap,
        tW - 3 * gap
      ) + 200;

      if (s.anchorEnd === 0) s.anchorEnd = now + leadMin;
      if (s.anchorEnd < now + leadMin) s.anchorEnd = now + leadMin;

      const endH  = s.anchorEnd;
      const endW1 = endH + gap;
      const endG  = endH + 2 * gap;
      const endW2 = endH + 3 * gap;

      const dH  = Math.max(0, Math.floor(endH  - now - tH));
      const dW1 = Math.max(0, Math.floor(endW1 - now - tW));
      const dG  = Math.max(0, Math.floor(endG  - now - tG));
      const dW2 = Math.max(0, Math.floor(endW2 - now - tW));

      const tasks = [
        { script: S.W, threads: w1T, delay: dW1, ramPerThread: ramW, target },
        { script: S.H, threads: hT,  delay: dH,  ramPerThread: ramH, target },
        { script: S.G, threads: gT,  delay: dG,  ramPerThread: ramG, target },
        { script: S.W, threads: w2T, delay: dW2, ramPerThread: ramW, target },
      ];

      const plan = planAlloc(tasks, runners);
      if (!plan) { skip.planFail++; continue; }
      if (plan.length > execBudget) { skip.planFail++; continue; }

      const ok = execPlanAtomic(plan);
      if (!ok) { skip.execFail++; continue; }

      totalExecCalls += plan.length;
      execBudget -= plan.length;
      totalBatches += 1;
      s.totalBatches += 1;

      s.inflightEnds.push(endW2 + 50);
      s.anchorEnd += interval;
      launchedBatches += 1;
    }

    // log
    if (!F.quiet && (lastLog === 0 || now - lastLog >= F.logEveryMs)) {
      ns.clearLog();
      const inflightTotal = (() => {
        let n = 0;
        for (const tt of targets) n += state(tt.host).inflightEnds.length;
        return n;
      })();

      ns.print(`bb-manager | targets=${targets.length} | runners=${runners.length} | inflightBatches=${inflightTotal} | totalBatches=${totalBatches} | execCalls=${totalExecCalls}`);
      ns.print(`skip: prepWait=${skip.prepWait} capT=${skip.capTarget} ram=${skip.ram} planFail=${skip.planFail} execFail=${skip.execFail} cooldown=${skip.cooldown} driftReset=${skip.driftReset}`);

      for (const tt of targets) {
        const host = tt.host;
        const s = state(host);
        const maxMoney = ns.getServerMaxMoney(host);
        const curMoney = ns.getServerMoneyAvailable(host);
        const minSec = ns.getServerMinSecurityLevel(host) + F.secBuf;
        const curSec = ns.getServerSecurityLevel(host);

        const mPct = maxMoney > 0 ? (curMoney / maxMoney) * 100 : 0;
        const secD = curSec - minSec;

        const anchorIn = s.anchorEnd > 0 ? Math.max(0, Math.floor(s.anchorEnd - now)) : 0;
        const prepIn = Math.max(0, Math.floor(s.prepUntil - now));

        ns.print(`${host} | mode=${s.mode} | inFlight=${s.inflightEnds.length} | $=${mPct.toFixed(1)}% | secΔ=${secD.toFixed(2)} | ema$=${s.emaMoneyRatio.toFixed(2)} | emaSecΔ=${s.emaSecDelta.toFixed(2)} | drift=${s.driftStreak}/${Math.floor(F.driftConfirm)} | next=${anchorIn}ms | prep=${prepIn}ms`);
      }
      lastLog = now;
    }

    await ns.sleep(Math.max(50, F.tick));
  }
}
