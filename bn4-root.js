// bn4-root-backdoor-daemon.js
// Auto-root + auto-backdoor (BN4 Singularity). 3-4 percenként újraszkennel, rootol amit tud, backdooroz amit tud.
// Használat (BN4-ben):
//   run bn4-root-backdoor-daemon.js --tail --interval 240000 --depth 30
//
// Megjegyzés: backdoorozás közben a script "elfoglalt", mert az installBackdoor() időigényes.
// Ha ezt nem akarod, futtasd külön a rootolót és backdoorozót (de itt egyben van, ahogy kérted).

/** @param {NS} ns **/
export async function main(ns) {
  const FLAGS = ns.flags([
    ["interval", 240000],  // 4 perc
    ["depth", 30],
    ["tail", true],
    ["includePurchased", false], // pserv-eket is kezelje-e (root/backdoor értelmetlen)
    ["verbose", true],
  ]);

  ns.disableLog("ALL");
  if (FLAGS.tail) {
    try { ns.ui.openTail(); } catch {}
  }

  const isPserv = (h) => h.startsWith("pserv-");
  const isSkippable = (h) => {
    if (h === "home") return true;
    if (h === "darkweb") return true;
    if (!FLAGS.includePurchased && isPserv(h)) return true;
    return false;
  };

  function scanAll(start = "home", maxDepth = 30) {
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

  function findPath(target) {
    const start = "home";
    const q = [start];
    const prev = new Map([[start, null]]);
    while (q.length) {
      const cur = q.shift();
      if (cur === target) break;
      for (const n of ns.scan(cur)) {
        if (!prev.has(n)) {
          prev.set(n, cur);
          q.push(n);
        }
      }
    }
    if (!prev.has(target)) return null;
    const path = [];
    let cur = target;
    while (cur !== null) {
      path.push(cur);
      cur = prev.get(cur) ?? null;
    }
    path.reverse();
    return path; // ["home", ..., target]
  }

  function haveProg(name) {
    return ns.fileExists(name, "home");
  }

  function tryRoot(host) {
    // már rootolt?
    if (ns.hasRootAccess(host)) return { ok: true, changed: false, msg: "already-root" };

    // portnyitók (csak ami megvan)
    let opened = 0;
    try { if (haveProg("BruteSSH.exe")) { ns.brutessh(host); opened++; } } catch {}
    try { if (haveProg("FTPCrack.exe")) { ns.ftpcrack(host); opened++; } } catch {}
    try { if (haveProg("relaySMTP.exe")) { ns.relaysmtp(host); opened++; } } catch {}
    try { if (haveProg("HTTPWorm.exe")) { ns.httpworm(host); opened++; } } catch {}
    try { if (haveProg("SQLInject.exe")) { ns.sqlinject(host); opened++; } } catch {}

    const reqPorts = ns.getServerNumPortsRequired(host);
    if (opened < reqPorts) {
      return { ok: false, changed: false, msg: `ports ${opened}/${reqPorts}` };
    }

    try {
      ns.nuke(host);
      return { ok: ns.hasRootAccess(host), changed: ns.hasRootAccess(host), msg: "nuked" };
    } catch (e) {
      return { ok: false, changed: false, msg: `nuke-fail` };
    }
  }

  async function tryBackdoor(host) {
    const s = ns.getServer(host);
    if (!ns.hasRootAccess(host)) return { ok: false, changed: false, msg: "no-root" };
    if (s.backdoorInstalled) return { ok: true, changed: false, msg: "already-bd" };

    const myHack = ns.getPlayer().skills.hacking;
    if (myHack < s.requiredHackingSkill) return { ok: false, changed: false, msg: `hack ${myHack}/${s.requiredHackingSkill}` };

    const path = findPath(host);
    if (!path) return { ok: false, changed: false, msg: "no-path" };

    // connect chain
    ns.singularity.connect("home");
    for (let i = 1; i < path.length; i++) {
      const ok = ns.singularity.connect(path[i]);
      if (!ok) {
        ns.singularity.connect("home");
        return { ok: false, changed: false, msg: "connect-fail" };
      }
    }

    if (FLAGS.verbose) ns.print(`[BD-START] ${host} | path=${path.join(" -> ")}`);
    await ns.singularity.installBackdoor();
    ns.singularity.connect("home");

    const after = ns.getServer(host);
    return { ok: after.backdoorInstalled, changed: after.backdoorInstalled, msg: after.backdoorInstalled ? "bd-done" : "bd-fail" };
  }

  function fmtMs(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}m ${r}s`;
  }

  while (true) {
    const startTs = Date.now();
    const servers = scanAll("home", FLAGS.depth).filter(h => !isSkippable(h));

    // Root pass
    let rootNew = 0, rootSkip = 0, rootFail = 0;
    for (const h of servers) {
      const before = ns.hasRootAccess(h);
      const res = tryRoot(h);
      const after = ns.hasRootAccess(h);

      if (after && !before) {
        rootNew++;
        if (FLAGS.verbose) ns.print(`[ROOT] ${h} (${res.msg})`);
      } else if (after) {
        rootSkip++;
      } else {
        rootFail++;
        if (FLAGS.verbose) ns.print(`[NO-ROOT] ${h} (${res.msg})`);
      }
    }

    // Backdoor pass (csak rootoltak)
    let bdNew = 0, bdSkip = 0, bdFail = 0;

    for (const h of servers) {
      const s = ns.getServer(h);
      if (!ns.hasRootAccess(h)) { bdFail++; continue; }
      if (s.backdoorInstalled) { bdSkip++; continue; }

      const r = await tryBackdoor(h);
      if (r.changed) bdNew++;
      else if (r.ok) bdSkip++;
      else bdFail++;

      // kis szünet, hogy UI/engine ne akadjon
      await ns.sleep(150);
    }

    const took = Date.now() - startTs;
    ns.print(
      `bn4-root-bd | scanned=${servers.length} | newRoot=${rootNew} | newBD=${bdNew} | ` +
      `rootFail=${rootFail} | bdRemain=${bdFail} | cycle=${fmtMs(took)} | nextIn=${fmtMs(FLAGS.interval)}`
    );

    await ns.sleep(FLAGS.interval);
  }
}
