/** buy-nfg.js
 *  Buys NeuroFlux Governor repeatedly while you can afford it.
 *  Optional: donate to meet rep requirement (requires Singularity + enough favor).
 *
 *  Usage examples:
 *    run buy-nfg.js
 *    run buy-nfg.js --faction Daedalus --reserve 5e9
 *    run buy-nfg.js --donate true --donateChunk 1e9
 */

/** @param {NS} ns **/
export async function main(ns) {
  const AUG = "NeuroFlux Governor";

  const F = ns.flags([
    ["faction", ""],          // e.g. "Daedalus"; empty = auto-pick
    ["reserve", 0],           // keep this money unspent
    ["max", 0],               // max NFG purchases this run (0 = unlimited)
    ["donate", false],         // donate to meet rep requirement if possible
    ["donateFavorReq", 150],  // BN3 is 75, default is 150; override if needed
    ["donateChunk", 1e9],     // donate in chunks
    ["sleepMs", 50],          // small delay between loops
    ["verbose", true],
  ]);

  // ---- Guard: requires Singularity API ----
  if (!ns.singularity?.purchaseAugmentation || !ns.singularity?.getAugmentationPrice) {
    ns.tprint("HIBA: Ehhez Singularity API kell (SF4 / BN4 vagy megfelelő hozzáférés).");
    return;
  }

  const reserve = Math.max(0, Number(F.reserve) || 0);
  const maxPurch = Math.max(0, Number(F.max) || 0);
  const donateEnabled = F.donate === true || F.donate === "true";
  const donateFavorReq = Math.max(0, Number(F.donateFavorReq) || 150);
  const donateChunk = Math.max(1, Number(F.donateChunk) || 1e9);
  const sleepMs = Math.max(0, Number(F.sleepMs) || 0);
  const verbose = F.verbose === true || F.verbose === "true";

  const player = ns.getPlayer();
  const myFactions = player.factions ?? [];

  function hasAugInFaction(fac) {
    try {
      return ns.singularity.getAugmentationsFromFaction(fac).includes(AUG);
    } catch {
      return false;
    }
  }

  function pickFactionAuto() {
    const candidates = myFactions.filter(hasAugInFaction);
    if (candidates.length === 0) return "";

    // Prefer a faction where we already meet rep req; otherwise prefer one with highest rep,
    // and (if donate enabled) prefer donate-unlocked factions.
    let best = candidates[0];
    let bestScore = -Infinity;

    for (const fac of candidates) {
      const rep = ns.singularity.getFactionRep(fac);
      const favor = ns.singularity.getFactionFavor(fac);

      const repReq = ns.singularity.getAugmentationRepReq(AUG);
      // NOTE: RepReq is global for the augmentation name; for NFG it effectively increases with each purchase,
      // and the API returns the current requirement.

      const repGap = repReq - rep; // <=0 means ok
      const donateOk = donateEnabled && favor >= donateFavorReq;

      // score: prioritize rep-ok; then donate-ok; then higher rep
      const score =
        (repGap <= 0 ? 1e12 : 0) +
        (donateOk ? 1e9 : 0) +
        rep;

      if (score > bestScore) {
        bestScore = score;
        best = fac;
      }
    }
    return best;
  }

  let faction = String(F.faction || "").trim();
  if (!faction) faction = pickFactionAuto();

  if (!faction) {
    ns.tprint(`HIBA: Nem találtam olyan factiont a listádban, ami árulja a(z) ${AUG}-t.`);
    ns.tprint(`Tip: lépj be egy endgame factionbe (pl. Daedalus/Illuminati/Covenant), majd futtasd újra.`);
    return;
  }

  if (!myFactions.includes(faction)) {
    ns.tprint(`HIBA: Nem vagy tagja ennek a factionnek: ${faction}`);
    ns.tprint(`Tagjaid: ${myFactions.join(", ") || "(nincs)"}`);
    return;
  }

  if (!hasAugInFaction(faction)) {
    ns.tprint(`HIBA: ${faction} nem listázza a(z) ${AUG}-t (legalábbis a Singularity szerint).`);
    return;
  }

  const startMoney = ns.getServerMoneyAvailable("home");
  let bought = 0;

  function canDonateHere() {
    const favor = ns.singularity.getFactionFavor(faction);
    return donateEnabled && favor >= donateFavorReq;
  }

  if (verbose) {
    ns.tprint(`NFG buy script | faction=${faction} | donate=${donateEnabled} (favor>=${donateFavorReq}) | reserve=${formatMoney(ns, reserve)}`);
  }

  // ---- Main loop ----
  while (true) {
    if (maxPurch > 0 && bought >= maxPurch) break;

    const money = ns.getServerMoneyAvailable("home");
    const price = ns.singularity.getAugmentationPrice(AUG);
    const repReq = ns.singularity.getAugmentationRepReq(AUG);
    const rep = ns.singularity.getFactionRep(faction);

    if (money - reserve < price) {
      if (verbose) ns.tprint(`Stop: nincs elég pénz. Money=${formatMoney(ns, money)} Price=${formatMoney(ns, price)} Reserve=${formatMoney(ns, reserve)}`);
      break;
    }

    // Ensure rep requirement
    if (rep < repReq) {
      if (!canDonateHere()) {
        if (verbose) {
          ns.tprint(`Stop: nincs elég reput és nem tudok donate-olni itt. rep=${rep.toFixed(0)} / req=${repReq.toFixed(0)} | favor=${ns.singularity.getFactionFavor(faction)}`);
        }
        break;
      }

      // Donate in chunks until rep >= req or money constraint hits
      let safety = 0;
      while (ns.singularity.getFactionRep(faction) < ns.singularity.getAugmentationRepReq(AUG)) {
        const m = ns.getServerMoneyAvailable("home");
        const p = ns.singularity.getAugmentationPrice(AUG);

        const headroom = m - reserve - p;
        if (headroom <= 0) break;

        const amt = Math.min(donateChunk, headroom);
        const ok = ns.singularity.donateToFaction(faction, amt);
        if (!ok) break;

        safety++;
        if (safety > 2000) break; // hard stop against infinite loops
        if (sleepMs) await ns.sleep(sleepMs);
      }

      // Re-check rep after donations
      const repAfter = ns.singularity.getFactionRep(faction);
      const reqAfter = ns.singularity.getAugmentationRepReq(AUG);
      if (repAfter < reqAfter) {
        if (verbose) ns.tprint(`Stop: donate után sincs elég rep. rep=${repAfter.toFixed(0)} / req=${reqAfter.toFixed(0)}`);
        break;
      }
    }

    // Purchase
    const ok = ns.singularity.purchaseAugmentation(faction, AUG);
    if (!ok) {
      if (verbose) ns.tprint(`Stop: purchaseAugmentation failed (pénz/rep/egyéb).`);
      break;
    }

    bought++;
    if (verbose) {
      const moneyLeft = ns.getServerMoneyAvailable("home");
      const nextPrice = ns.singularity.getAugmentationPrice(AUG);
      ns.tprint(`Véve: NFG x${bought} | maradék=${formatMoney(ns, moneyLeft)} | nextPrice=${formatMoney(ns, nextPrice)}`);
    }

    if (sleepMs) await ns.sleep(sleepMs);
  }

  const endMoney = ns.getServerMoneyAvailable("home");
  ns.tprint(`Kész. Vett NFG: ${bought} db | Pénz: ${formatMoney(ns, startMoney)} → ${formatMoney(ns, endMoney)} | faction=${faction}`);
}

function formatMoney(ns, n) {
  try { return ns.formatNumber(n, 2); } catch { return String(n); }
}
