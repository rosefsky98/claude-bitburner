/** @param {NS} ns **/
export async function main(ns) {
  const flags = ns.flags([
    ["target", 508],      // cél hacking level
    ["sampleMs", 5000],   // mérési ablak (ms)
    ["samples", 3],       // ennyi mintát átlagol
    ["tail", true],
  ]);

  ns.disableLog("ALL");
  if (flags.tail) ns.ui.openTail();

  const targetLvl = Number(ns.args[0] ?? flags.target);
  const sampleMs = Math.max(500, Number(flags.sampleMs) || 5000);
  const samples = Math.max(1, Math.floor(Number(flags.samples) || 3));

  if (!Number.isFinite(targetLvl) || targetLvl <= 1) {
    ns.tprint("ERROR: Adj meg érvényes cél szintet, pl: run timeToHackLevelAuto.js 508");
    return;
  }

  if (!ns.formulas?.skills?.calculateExp) {
    ns.tprint("ERROR: Nincs formulas API. (Formulas.exe szükséges)");
    return;
  }

  const p = ns.getPlayer();
  const hackLvlNow = ns.getHackingLevel();

  // Mult verziók között eltérhet, ezért több fallback:
  const hackMult =
    p.hacking_mult ??
    p.mults?.hacking ??
    p.mults?.hacking_exp ??
    1;

  // Exp mező is változhat verziók között
  const getHackExp = () => {
    const pp = ns.getPlayer();
    return (
      pp.hacking_exp ??
      pp.exp?.hacking ??
      0
    );
  };

  if (hackLvlNow >= targetLvl) {
    ns.tprint(`Már megvan: current=${hackLvlNow} target=${targetLvl}`);
    return;
  }

  // XP/sec mérés: több minta, átlag
  let totalRate = 0;
  let valid = 0;

  ns.print(`[Measure] sampling ${samples}x${sampleMs}ms... (közben fusson valami, ami hack XP-t ad)`);

  for (let i = 0; i < samples; i++) {
    const e1 = getHackExp();
    const t1 = Date.now();

    await ns.sleep(sampleMs);

    const e2 = getHackExp();
    const t2 = Date.now();

    const dt = Math.max(1, (t2 - t1) / 1000);
    const de = Math.max(0, e2 - e1);
    const rate = de / dt;

    if (Number.isFinite(rate) && rate > 0) {
      totalRate += rate;
      valid++;
    }

    ns.print(`[Measure] #${i + 1}: +${ns.formatNumber(de)} XP / ${dt.toFixed(2)}s => ${ns.formatNumber(rate)} XP/s`);
  }

  const xpPerSec = valid > 0 ? (totalRate / valid) : 0;

  const curExp = getHackExp();
  const targetExp = ns.formulas.skills.calculateExp(targetLvl, hackMult);
  const remainingExp = Math.max(0, targetExp - curExp);

  ns.tprint(`Current hack level: ${hackLvlNow}`);
  ns.tprint(`Target hack level:  ${targetLvl}`);
  ns.tprint(`Hacking mult:       ${hackMult}`);
  ns.tprint(`Current exp:        ${ns.formatNumber(curExp)} XP`);
  ns.tprint(`Target exp:         ${ns.formatNumber(targetExp)} XP`);
  ns.tprint(`Remaining exp:      ${ns.formatNumber(remainingExp)} XP`);

  if (xpPerSec <= 0) {
    ns.tprint(`XP/sec: 0 (nem mért növekedést). Indíts hack/grow/weaken-t, aztán futtasd újra.`);
    return;
  }

  const secs = remainingExp / xpPerSec;
  ns.tprint(`Measured rate:      ${ns.formatNumber(xpPerSec)} XP/s`);
  ns.tprint(`ETA to ${targetLvl}: ${ns.tFormat(secs * 1000)}`);
}
