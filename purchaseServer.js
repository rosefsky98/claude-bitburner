/** @param {NS} ns **/
export async function main(ns) {
  const flags = ns.flags([
    ["ram", 1048576],          // GB
    ["prefix", "pserv"],       // név prefix
  ]);

  const ram = Number(flags.ram);
  if (!Number.isFinite(ram) || ram <= 0) {
    ns.tprint(`HIBA: Érvénytelen --ram érték: ${flags.ram}`);
    ns.tprint(`Példa: run ${ns.getScriptName()} --ram 65536`);
    return;
  }

  // Bitburnerben a pserv RAM általában 2 hatványa; ezt érdemes ellenőrizni
  if ((ram & (ram - 1)) !== 0) {
    ns.tprint(`HIBA: A --ram érték legyen 2 hatványa (pl. 8192, 16384, 65536, 1048576). Kaptam: ${ram}`);
    return;
  }

  const cost = ns.getPurchasedServerCost(ram);
  const currentMoney = ns.getServerMoneyAvailable("home");

  const currentServers = ns.getPurchasedServers();
  const maxServers = ns.getPurchasedServerLimit();

  // 1) limit
  if (currentServers.length >= maxServers) {
    ns.tprint(`HIBA: Nem vehetsz több szervert. Elérted a limitet (${maxServers} db).`);
    return;
  }

  // 2) pénz
  if (currentMoney < cost) {
    ns.tprint(`HIBA: Nincs elég pénzed.`);
    ns.tprint(`Szükséges: ${ns.formatNumber(cost)}`);
    ns.tprint(`Jelenlegi: ${ns.formatNumber(currentMoney)}`);
    return;
  }

  // 3) név generálás: pserv-<ram>-<index>
  const base = `${flags.prefix}-${ram}`;
  let idx = 0;

  // keressünk szabad indexet (ha töröltél közben szervereket, lehet lyuk)
  const existing = new Set(currentServers);
  while (existing.has(`${base}-${idx}`)) idx++;

  const hostname = `${base}-${idx}`;
  const newServer = ns.purchaseServer(hostname, ram);

  if (newServer) {
    ns.tprint(`SIKER: Sikeresen megvásároltad a szervert: ${newServer} (${ram}GB)`);
  } else {
    ns.tprint("VÁRATLAN HIBA: Nem sikerült a vásárlás.");
  }
}
