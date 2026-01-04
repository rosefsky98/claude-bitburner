/** xpFleet.js
 * XP-focused HGW fleet (with reliable --noHome).
 * - Picks best XP/s target (Formulas if available)
 * - Deploys hack/grow/weaken workers across rooted servers
 * - Workers never idle: if their primary job isn't needed, they hack for XP
 *
 * Usage:
 *   run xpFleet.js --tail
 *   run xpFleet.js --tail --noHome
 *   run xpFleet.js --target joesguns --tail --noHome
 */

/** @param {NS} ns **/
export async function main(ns) {
  const FLAGS = ns.flags([
    // Network / deploy
    ["depth", 25],
    ["refreshMs", 15000],
    ["tail", true],
    ["quiet", false],

    // Home usage (presence-based)
    ["noHome", false],
    ["homeReserve", 32],
    ["reserve", 0],
    ["threadsCap", 0], // per-runner cap (0 = unlimited)

    // Target selection
    ["target", ""], // if set, force this
    ["top", 10],
    ["onlyRootedTargets", true],
    ["onlyHackableTargets", true],
    ["excludePurchasedTargets", true],
    ["minChance", 0.55],
    ["minMaxMoney", 1e6],

    // XP farming behavior
    ["secBuffer", 0.25],
    ["moneyFrac", 0.07],

    // Baseline role shares (normalized)
    ["hackShare", 0.85],
    ["growShare", 0.05],
    ["weakenShare", 0.10],

    // Redeploy control
    ["redeployDelta", 0.15],
    ["forceRedeploy", false],

    // Formulas
    ["useFormulas", true],
  ]);

  ns.disableLog("ALL");
  if (FLAGS.tail) {
    try { ns.ui.openTail(); } catch { try { ns.tail(); } catch {} }
  }

  const includeHome = !FLAGS.noHome;

  const W_HACK = "/temp/xp-hack.js";
  const W_GROW = "/temp/xp-grow.js";
  const W_WEAK = "/temp/xp-weaken.js";

  // ---------- Worker sources ----------
  // Hack worker: hack normally; if target state is bad, help fix it (never idle)
  const SRC_HACK = `/** @param {NS} ns **/
export async function main(ns) {
  const [target, secBufferStr, moneyFracStr, minChanceStr] = ns.args;
  const t = String(target);
  const secBuffer = Number(secBufferStr ?? 0.25);
  const moneyFrac = Number(moneyFracStr ?? 0.07);
  const minChance = Number(minChanceStr ?? 0.55);

  ns.disableLog("ALL");

  while (true) {
    const sec = ns.getServerSecurityLevel(t);
    const min = ns.getServerMinSecurityLevel(t);
    const money = ns.getServerMoneyAvailable(t);
    const max = ns.getServerMaxMoney(t);
    const chance = ns.hackAnalyzeChance(t);

    // Never idle: if conditions are bad, fix them; else hack for fastest XP/s.
    if (sec > min + secBuffer * 2 || chance < minChance) {
      await ns.weaken(t);
      continue;
    }
    if (max > 0 && money < max * moneyFrac * 0.5) {
      await ns.grow(t);
      continue;
    }
    await ns.hack(t);
  }
}
`;

  // Grow worker: grow only if needed; otherwise hack (never idle)
  const SRC_GROW = `/** @param {NS} ns **/
export async function main(ns) {
  const [target, secBufferStr, moneyFracStr] = ns.args;
  const t = String(target);
  const secBuffer = Number(secBufferStr ?? 0.25);
  const moneyFrac = Number(moneyFracStr ?? 0.07);

  ns.disableLog("ALL");

  while (true) {
    const sec = ns.getServerSecurityLevel(t);
    const min = ns.getServerMinSecurityLevel(t);
    const money = ns.getServerMoneyAvailable(t);
    const max = ns.getServerMaxMoney(t);

    if (sec > min + secBuffer) {
      await ns.weaken(t);
      continue;
    }
    if (max > 0 && money < max * moneyFrac) {
      await ns.grow(t);
      continue;
    }
    // no grow needed -> hack for XP
    await ns.hack(t);
  }
}
`;

  // Weaken worker: weaken if needed; otherwise hack (never idle)
  const SRC_WEAK = `/** @param {NS} ns **/
export async function main(ns) {
  const [target, secBufferStr] = ns.args;
  const t = String(target);
  const secBuffer = Number(secBufferStr ?? 0.25);

  ns.disableLog("ALL");

  while (true) {
    const sec = ns.getServerSecurityLevel(t);
    const min = ns.getServerMinSecurityLevel(t);
    if (sec > min + secBuffer) {
      await ns.weaken(t);
    } else {
      await ns.hack(t);
    }
  }
}
`;

  // Ensure workers exist on home
  await ensureFile(ns, W_HACK, SRC_HACK);
  await ensureFile(ns, W_GROW, SRC_GROW);
  await ensureFile(ns, W_WEAK, SRC_WEAK);

  const ramHack = ns.getScriptRam(W_HACK, "home");
  const ramGrow = ns.getScriptRam(W_GROW, "home");
  const ramWeak = ns.getScriptRam(W_WEAK, "home");

  if (!(ramHack > 0 && ramGrow > 0 && ramWeak > 0)) {
    ns.tprint(`HIBA: worker RAM értékek: hack=${ramHack}, grow=${ramGrow}, weak=${ramWeak}`);
    return;
  }

  const purchased = new Set(ns.getPurchasedServers());

  // Formulas detection: do NOT rely on fileExists; just check API availability.
  const hasFormulas =
    !!(FLAGS.useFormulas &&
      ns.formulas?.hacking &&
      typeof ns.formulas.hacking.hackTime === "function" &&
      typeof ns.formulas.hacking.hackChance === "function" &&
      typeof ns.formulas.hacking.hackExp === "function");

  const fmt = (n) => ns.formatNumber(n, 2);

  function scanAll(start = "home", maxDepth = 25) {
    const seen = new Set([start]);
    const q = [{ h: start, d: 0 }];
    while (q.length) {
      const { h, d } = q.shift();
      if (d >= maxDepth) continue;
      for (const n of ns.scan(h)) {
        if (!seen.has(n)) {
          seen.add(n);
          q.push({ h: n, d: d + 1 });
        }
      }
    }
    return [...seen];
  }

  function reserveFor(host) {
    if (host === "home") return Number(FLAGS.homeReserve) || 0;
    return Number(FLAGS.reserve) || 0;
  }

  function freeRam(host) {
    const max = ns.getServerMaxRam(host);
    const used = ns.getServerUsedRam(host);
    return Math.max(0, max - used - reserveFor(host));
  }

  function isRunner(host) {
    if (host === "home" && !includeHome) return false;
    return ns.hasRootAccess(host) && ns.getServerMaxRam(host) > 0;
  }

  function isValidTarget(host) {
    if (!ns.serverExists(host)) return false;
    if (host === "home") return false;
    if (host === "w0r1d_d43m0n") return false;
    if (FLAGS.excludePurchasedTargets && purchased.has(host)) return false;

    const s = ns.getServer(host);

    if ((s.moneyMax || 0) < Number(FLAGS.minMaxMoney || 0)) return false;
    if (FLAGS.onlyRootedTargets && !ns.hasRootAccess(host)) return false;
    if (FLAGS.onlyHackableTargets && ns.getHackingLevel() < (s.requiredHackingSkill || 0)) return false;

    const chance = ns.hackAnalyzeChance(host);
    if (chance < Number(FLAGS.minChance || 0)) return false;

    return true;
  }

  function xpScorePerSec(host) {
    // If Formulas is available: true XP/s ranking.
    if (hasFormulas) {
      try {
        const p = ns.getPlayer();
        const s = ns.getServer(host);
        s.hackDifficulty = s.minDifficulty;
        s.moneyAvailable = s.moneyMax;

        const tHack = ns.formulas.hacking.hackTime(s, p);
        const cHack = ns.formulas.hacking.hackChance(s, p);
        const eHack = ns.formulas.hacking.hackExp(s, p); // per thread

        return (eHack * cHack) / Math.max(1, tHack);
      } catch {
        // fall through to approximation
      }
    }

    // Fallback approximation: assume EXP per action ~constant, rank by chance / hackTime.
    const c = ns.hackAnalyzeChance(host);
    const t = Math.max(1, ns.getHackTime(host));
    return c / t;
  }

  function pickTarget(allHosts) {
    const forced = String(FLAGS.target || "").trim();
    if (forced) return forced;

    const candidates = allHosts.filter(isValidTarget);
    if (candidates.length === 0) return "";

    candidates.sort((a, b) => xpScorePerSec(b) - xpScorePerSec(a));

    const topN = Math.max(0, Math.floor(Number(FLAGS.top) || 0));
    if (!FLAGS.quiet && topN > 0) {
      const lines = [];
      for (let i = 0; i < Math.min(topN, candidates.length); i++) {
        const h = candidates[i];
        lines.push(
          `${i + 1}. ${h}  score=${fmt(xpScorePerSec(h))}  chance=${(ns.hackAnalyzeChance(h) * 100).toFixed(1)}%  hackTime=${Math.round(ns.getHackTime(h))}ms`
        );
      }
      ns.print("Top XP targets:\n" + lines.join("\n"));
    }
    return candidates[0];
  }

  function normalizeShares(h, g, w) {
    const hh = Math.max(0, Number(h) || 0);
    const gg = Math.max(0, Number(g) || 0);
    const ww = Math.max(0, Number(w) || 0);
    const sum = hh + gg + ww;
    if (sum <= 0) return { h: 0.85, g: 0.05, w: 0.10 };
    return { h: hh / sum, g: gg / sum, w: ww / sum };
  }

  function dynamicShares(target) {
    const base = normalizeShares(FLAGS.hackShare, FLAGS.growShare, FLAGS.weakenShare);

    const sec = ns.getServerSecurityLevel(target);
    const min = ns.getServerMinSecurityLevel(target);
    const money = ns.getServerMoneyAvailable(target);
    const max = ns.getServerMaxMoney(target);
    const chance = ns.hackAnalyzeChance(target);

    const secDiff = sec - min;
    const moneyRatio = (max > 0) ? (money / max) : 1;

    let h = base.h, g = base.g, w = base.w;

    // security/chance issues -> more weaken
    if (secDiff > Number(FLAGS.secBuffer) || chance < Number(FLAGS.minChance)) {
      w = Math.min(0.60, w + 0.20);
      h = Math.max(0.30, h - 0.15);
    }

    // money low -> more grow
    if (moneyRatio < Number(FLAGS.moneyFrac)) {
      g = Math.min(0.35, g + 0.20);
      h = Math.max(0.30, h - 0.10);
    }

    return normalizeShares(h, g, w);
  }

  function binaryFitThreads(free, share, rH, rG, rW) {
    let lo = 0;
    let hi = Math.floor(free / Math.min(rH, rG, rW));
    hi = Math.max(0, hi);

    const threadsCap = Math.max(0, Math.floor(Number(FLAGS.threadsCap) || 0));
    if (threadsCap > 0) hi = Math.min(hi, threadsCap);

    function ramFor(T) {
      const tH = Math.max(0, Math.round(T * share.h));
      const tG = Math.max(0, Math.round(T * share.g));
      const tW = Math.max(0, T - tH - tG);
      return tH * rH + tG * rG + tW * rW;
    }

    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (ramFor(mid) <= free) lo = mid;
      else hi = mid - 1;
    }

    const T = lo;
    let tH = Math.max(0, Math.round(T * share.h));
    let tG = Math.max(0, Math.round(T * share.g));
    let tW = Math.max(0, T - tH - tG);

    // Ensure at least 1 weaken if any threads exist (helps stability)
    if (T > 0 && tW === 0) {
      if (tH > 0) { tH--; tW++; }
      else if (tG > 0) { tG--; tW++; }
    }

    return { tH, tG, tW };
  }

  function sameArgs(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (String(a[i]) !== String(b[i])) return false;
    }
    return true;
  }

  function needsRedeploy(host, desired) {
    if (FLAGS.forceRedeploy) return true;

    const procs = ns.ps(host);
    const want = [
      { file: W_HACK, threads: desired.tH, args: desired.argsHack },
      { file: W_GROW, threads: desired.tG, args: desired.argsGrow },
      { file: W_WEAK, threads: desired.tW, args: desired.argsWeak },
    ];

    const delta = Math.max(0, Number(FLAGS.redeployDelta) || 0);

    for (const w of want) {
      const p = procs.find(x => x.filename === w.file);
      if (!p) return true;
      if (!sameArgs(p.args, w.args)) return true;

      const denom = Math.max(1, w.threads);
      const diff = Math.abs((p.threads || 0) - w.threads) / denom;
      if (diff > delta) return true;
    }
    return false;
  }

  async function scpWorkers(host) {
    if (host === "home") return;
    await ns.scp([W_HACK, W_GROW, W_WEAK], host, "home");
  }

  function killWorkers(host) {
    ns.scriptKill(W_HACK, host);
    ns.scriptKill(W_GROW, host);
    ns.scriptKill(W_WEAK, host);
  }

  function startWorkers(host, desired) {
    if (desired.tW > 0) ns.exec(W_WEAK, host, desired.tW, ...desired.argsWeak);
    if (desired.tG > 0) ns.exec(W_GROW, host, desired.tG, ...desired.argsGrow);
    if (desired.tH > 0) ns.exec(W_HACK, host, desired.tH, ...desired.argsHack);
  }

  // ---------- Main loop ----------
  let lastTarget = "";
  while (true) {
    const all = scanAll("home", Number(FLAGS.depth) || 25);

    const target = pickTarget(all);
    if (!target) {
      ns.tprint("HIBA: Nem találtam XP targetet a szűrőkkel. Engedj lejjebb minChance/minMaxMoney-t vagy adj meg --target-et.");
      return;
    }

    if (target !== lastTarget && !FLAGS.quiet) {
      ns.tprint(`XP target: ${target} | formulas=${hasFormulas}`);
      lastTarget = target;
    }

    const share = dynamicShares(target);

    const runners = all.filter(isRunner);

    // copy workers
    for (const h of runners) await scpWorkers(h);

    let startedHosts = 0;
    let totalThreads = 0;

    for (const h of runners) {
      const fr = freeRam(h);
      if (fr < Math.min(ramHack, ramGrow, ramWeak)) continue;

      const { tH, tG, tW } = binaryFitThreads(fr, share, ramHack, ramGrow, ramWeak);
      const T = tH + tG + tW;
      if (T <= 0) continue;

      const desired = {
        tH, tG, tW,
        argsHack: [target, String(FLAGS.secBuffer), String(FLAGS.moneyFrac), String(FLAGS.minChance)],
        argsGrow: [target, String(FLAGS.secBuffer), String(FLAGS.moneyFrac)],
        argsWeak: [target, String(FLAGS.secBuffer)],
      };

      if (needsRedeploy(h, desired)) {
        killWorkers(h);
        startWorkers(h, desired);
      }

      startedHosts++;
      totalThreads += T;
    }

    if (!FLAGS.quiet) {
      ns.print(`Runners=${startedHosts}/${runners.length} | totalThreads=${totalThreads} | shares: H=${(share.h*100).toFixed(0)}% G=${(share.g*100).toFixed(0)}% W=${(share.w*100).toFixed(0)}%`);
    }

    await ns.sleep(Number(FLAGS.refreshMs) || 15000);
  }
}

async function ensureFile(ns, path, content) {
  const exists = ns.fileExists(path, "home");
  if (exists) {
    try {
      const cur = ns.read(path);
      if (String(cur) === String(content)) return;
    } catch {}
  }
  await ns.write(path, content, "w");
}
