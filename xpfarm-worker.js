/** @param {NS} ns **/
export async function main(ns) {
  const F = ns.flags([
    ["target", "joesguns"],
    ["secBuffer", 0.25],     // minSec + ennyi felett weaken
    ["moneyFrac", 0.10],     // maxMoney * ennyi alatt grow (XP-hez legyen alacsony!)
    ["minChance", 0.50],     // ha túl alacsony a siker: inkább weaken
    ["initialDelay", 0],     // ms, deploy script tölti
  ]);

  const t = String(F.target);
  ns.disableLog("ALL");

  if (!ns.serverExists(t)) {
    ns.tprint(`HIBA: target nem létezik: ${t}`);
    return;
  }

  const initialDelay = Math.max(0, Number(F.initialDelay) || 0);
  if (initialDelay > 0) await ns.sleep(initialDelay);

  while (true) {
    const sec = ns.getServerSecurityLevel(t);
    const min = ns.getServerMinSecurityLevel(t);
    const money = ns.getServerMoneyAvailable(t);
    const max = ns.getServerMaxMoney(t);
    const chance = ns.hackAnalyzeChance(t);

    // 1) Security kontroll
    if (sec > min + Number(F.secBuffer) || chance < Number(F.minChance)) {
      await ns.weaken(t);
      continue;
    }

    // 2) Pénz csak annyira kell, hogy legyen mit hackelni (XP-hez nem kell 95%-on tartani)
    if (max > 0 && money < max * Number(F.moneyFrac)) {
      await ns.grow(t);
      continue;
    }

    // 3) XP/s miatt: hack (általában a leggyorsabb művelet)
    await ns.hack(t);
  }
}
