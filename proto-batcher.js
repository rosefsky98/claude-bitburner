/**
 * PROTO-BATCHER
 * Egyszerűbb, kevesebb RAM-ot igénylő batch rendszer
 * Ideális korai játékhoz vagy kis home RAM-mal
 * 
 * Használat: run proto-batcher.js [target]
 */

/** Formázott pénz */
function formatMoney(n) {
    if (n >= 1e12) return (n / 1e12).toFixed(2) + "t";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "b";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "m";
    if (n >= 1e3) return (n / 1e3).toFixed(2) + "k";
    return n.toFixed(2);
}

/** Összes szerver */
function getAllServers(ns) {
    const servers = new Set(["home"]);
    const queue = ["home"];
    while (queue.length > 0) {
        const current = queue.shift();
        for (const neighbor of ns.scan(current)) {
            if (!servers.has(neighbor)) {
                servers.add(neighbor);
                queue.push(neighbor);
            }
        }
    }
    return [...servers];
}

/** Rootolás */
function rootAll(ns) {
    const tools = [
        { file: "BruteSSH.exe", fn: ns.brutessh },
        { file: "FTPCrack.exe", fn: ns.ftpcrack },
        { file: "relaySMTP.exe", fn: ns.relaysmtp },
        { file: "HTTPWorm.exe", fn: ns.httpworm },
        { file: "SQLInject.exe", fn: ns.sqlinject },
    ];
    const available = tools.filter(t => ns.fileExists(t.file, "home"));
    
    for (const server of getAllServers(ns)) {
        if (ns.hasRootAccess(server)) continue;
        if (available.length >= ns.getServerNumPortsRequired(server)) {
            for (const t of available) try { t.fn(server); } catch {}
            try { ns.nuke(server); } catch {}
        }
    }
}

/** Legjobb célpont */
function findTarget(ns) {
    const player = ns.getPlayer();
    let best = null;
    let bestScore = 0;
    
    for (const server of getAllServers(ns)) {
        if (!ns.hasRootAccess(server)) continue;
        if (ns.getServerMaxMoney(server) <= 0) continue;
        if (ns.getServerRequiredHackingLevel(server) > player.skills.hacking) continue;
        
        const score = ns.getServerMaxMoney(server) / ns.getServerMinSecurityLevel(server);
        if (score > bestScore) {
            bestScore = score;
            best = server;
        }
    }
    return best;
}

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.tail();
    
    // Rootolás
    rootAll(ns);
    
    // Célpont
    const target = ns.args[0] || findTarget(ns);
    if (!target) {
        ns.print("ERROR Nincs elérhető célpont!");
        return;
    }
    
    ns.print(`INFO Célpont: ${target}`);
    
    const minSec = ns.getServerMinSecurityLevel(target);
    const maxMoney = ns.getServerMaxMoney(target);
    
    // Fő ciklus
    const startMoney = ns.getPlayer().money;
    const startTime = Date.now();
    
    while (true) {
        const sec = ns.getServerSecurityLevel(target);
        const money = ns.getServerMoneyAvailable(target);
        
        // Döntés: weaken, grow, vagy hack
        if (sec > minSec + 5) {
            // Security túl magas -> weaken
            ns.print("🔓 Weaken...");
            await ns.weaken(target);
        } else if (money < maxMoney * 0.75) {
            // Pénz túl alacsony -> grow
            ns.print("📈 Grow...");
            await ns.grow(target);
        } else {
            // Minden rendben -> hack!
            const stolen = await ns.hack(target);
            if (stolen > 0) {
                ns.print(`💰 Hack: ${formatMoney(stolen)}`);
            }
        }
        
        // Statisztikák
        const elapsed = (Date.now() - startTime) / 1000;
        const earned = ns.getPlayer().money - startMoney;
        const rate = earned / elapsed;
        
        ns.print(`📊 ${formatMoney(earned)} (${formatMoney(rate)}/s)`);
    }
}
