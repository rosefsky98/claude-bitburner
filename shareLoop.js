/** @param {NS} ns **/
export async function main(ns) {
  // folyamatos share() - ez fogyasztja a RAM-ot és rep-et ad a factionökhöz
  while (true) {
    await ns.share();
    await ns.sleep(1);
  }
}
