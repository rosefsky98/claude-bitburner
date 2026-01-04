/**
 * TARGET ANALYZER
 * Elemzi és rangsorolja a szervereket farming szempontból
 * 
 * Használat: run analyze-targets.js [--detailed]
 */

/** Formázott pénzösszeg */
function formatMoney(n) {
    if (n >= 1e15) return (n / 1e15).toFixed(2) + "q";
    if (n >= 1e12) return (n / 1e12).toFixed(2) + "t";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "b";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "m";
    if (n >= 1e3) return (n / 1e3).toFixed(2) + "k";
    return n.toFixed(2);
}

/** Formázott idő */
function formatTime(ms) {
    if (ms < 1000) return ms.toFixed(0) + "ms";
    if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
    if (ms < 3600000) return (ms / 60000).toFixed(1) + "m";
    return (ms / 3600000).toFixed(1) + "h";
}

/** Összes szerver lekérése */
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

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.tail();
    
    const flags = ns.flags([
        ["detailed", false],
        ["top", 15],
    ]);
    
    const player = ns.getPlayer();
    const servers = getAllServers(ns);
    const targets = [];
    
    for (const server of servers) {
        // Kihagyjuk a nem hackelhető szervereket
        if (server === "home" || server.startsWith("pserv-") || server.startsWith("hacknet-")) continue;
        
        const maxMoney = ns.getServerMaxMoney(server);
        if (maxMoney <= 0) continue;
        
        const requiredLevel = ns.getServerRequiredHackingLevel(server);
        const requiredPorts = ns.getServerNumPortsRequired(server);
        const hasRoot = ns.hasRootAccess(server);
        const canHack = requiredLevel <= player.skills.hacking;
        
        const minSecurity = ns.getServerMinSecurityLevel(server);
        const currentSecurity = ns.getServerSecurityLevel(server);
        const currentMoney = ns.getServerMoneyAvailable(server);
        const growthRate = ns.getServerGrowth(server);
        
        let hackTime = Infinity;
        let hackChance = 0;
        let hackPercent = 0;
        
        if (hasRoot && canHack) {
            hackTime = ns.getHackTime(server);
            hackChance = ns.hackAnalyzeChance(server);
            hackPercent = ns.hackAnalyze(server);
        }
        
        // Pontszámítás
        // Magas pénz, magas esély, magas növekedés, alacsony idő és security = jó
        let score = 0;
        if (hasRoot && canHack && hackTime > 0) {
            score = (maxMoney * hackChance * growthRate) / (hackTime * minSecurity);
            
            // Bonus ha már jó állapotban van
            if (currentSecurity <= minSecurity * 1.1) score *= 1.2;
            if (currentMoney >= maxMoney * 0.9) score *= 1.1;
        }
        
        targets.push({
            name: server,
            maxMoney,
            currentMoney,
            minSecurity,
            currentSecurity,
            growthRate,
            hackTime,
            hackChance,
            hackPercent,
            requiredLevel,
            requiredPorts,
            hasRoot,
            canHack,
            score,
            // Becsült profit per másodperc
            profitPerSec: hasRoot && canHack ? (maxMoney * hackPercent * hackChance * 0.25) / (hackTime / 1000) : 0
        });
    }
    
    // Rendezés pontszám szerint
    targets.sort((a, b) => b.score - a.score);
    
    // Megjelenítés
    ns.print("╔════════════════════════════════════════════════════════════════════════════════╗");
    ns.print("║                        🎯 TARGET ANALYSIS REPORT 🎯                            ║");
    ns.print("╠════════════════════════════════════════════════════════════════════════════════╣");
    ns.print(`║ Hacking Level: ${player.skills.hacking}`.padEnd(82) + "║");
    ns.print(`║ Elemzett szerverek: ${targets.length}`.padEnd(82) + "║");
    ns.print("╠════════════════════════════════════════════════════════════════════════════════╣");
    
    const topTargets = targets.slice(0, flags.top);
    
    ns.print("║ #   Server                 MaxMoney    Sec    Growth  HackTime  Status  Score ║");
    ns.print("╠════════════════════════════════════════════════════════════════════════════════╣");
    
    for (let i = 0; i < topTargets.length; i++) {
        const t = topTargets[i];
        const rank = (i + 1).toString().padEnd(3);
        const name = t.name.substring(0, 20).padEnd(20);
        const money = formatMoney(t.maxMoney).padEnd(10);
        const sec = t.minSecurity.toFixed(0).padEnd(6);
        const growth = t.growthRate.toString().padEnd(7);
        const time = t.canHack && t.hasRoot ? formatTime(t.hackTime).padEnd(9) : "N/A".padEnd(9);
        
        let status = "";
        if (!t.hasRoot) status = "🔒";
        else if (!t.canHack) status = "📈" + t.requiredLevel;
        else status = "✅";
        status = status.padEnd(7);
        
        const score = t.score > 0 ? t.score.toExponential(1).padEnd(9) : "0".padEnd(9);
        
        ns.print(`║ ${rank} ${name} ${money} ${sec} ${growth} ${time} ${status} ${score}║`);
    }
    
    ns.print("╠════════════════════════════════════════════════════════════════════════════════╣");
    
    // Legjobb célpont részletei
    const best = topTargets.find(t => t.hasRoot && t.canHack);
    if (best) {
        ns.print("║ 🏆 AJÁNLOTT CÉLPONT:".padEnd(82) + "║");
        ns.print(`║    ${best.name}`.padEnd(82) + "║");
        ns.print(`║    Max pénz: ${formatMoney(best.maxMoney)}`.padEnd(82) + "║");
        ns.print(`║    Hack esély: ${(best.hackChance * 100).toFixed(1)}%`.padEnd(82) + "║");
        ns.print(`║    Hack %: ${(best.hackPercent * 100).toFixed(4)}%`.padEnd(82) + "║");
        ns.print(`║    Becsült profit: ${formatMoney(best.profitPerSec)}/sec`.padEnd(82) + "║");
        ns.print("║".padEnd(82) + "║");
        ns.print(`║    Futtatás: run batch-manager.js ${best.name}`.padEnd(82) + "║");
    }
    
    ns.print("╚════════════════════════════════════════════════════════════════════════════════╝");
    
    // Részletes mód
    if (flags.detailed && best) {
        ns.print("");
        ns.print("╔════════════════════════════════════════════════════════════════════════════════╗");
        ns.print("║                          📊 RÉSZLETES ELEMZÉS 📊                               ║");
        ns.print("╠════════════════════════════════════════════════════════════════════════════════╣");
        
        for (const t of topTargets.slice(0, 5)) {
            if (!t.hasRoot || !t.canHack) continue;
            
            ns.print(`║ ${t.name}`.padEnd(82) + "║");
            ns.print(`║   Állapot: Security ${t.currentSecurity.toFixed(2)}/${t.minSecurity.toFixed(2)} | Money ${formatMoney(t.currentMoney)}/${formatMoney(t.maxMoney)}`.padEnd(82) + "║");
            ns.print(`║   Hack: ${formatTime(t.hackTime)} | Chance: ${(t.hackChance*100).toFixed(1)}% | Per hack: ${(t.hackPercent*100).toFixed(4)}%`.padEnd(82) + "║");
            ns.print(`║   Growth: ${t.growthRate} | Required ports: ${t.requiredPorts}`.padEnd(82) + "║");
            ns.print("║".padEnd(82) + "║");
        }
        
        ns.print("╚════════════════════════════════════════════════════════════════════════════════╝");
    }
    
    return best ? best.name : null;
}
