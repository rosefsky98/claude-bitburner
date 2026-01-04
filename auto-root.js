/**
 * AUTO-ROOTER
 * Automatikusan rootol minden elérhető szervert
 * 
 * Használat: run auto-root.js [--continuous]
 */

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
    
    const flags = ns.flags([
        ["continuous", false],
        ["interval", 60000],
    ]);
    
    const tools = [
        { file: "BruteSSH.exe", fn: ns.brutessh, name: "BruteSSH" },
        { file: "FTPCrack.exe", fn: ns.ftpcrack, name: "FTPCrack" },
        { file: "relaySMTP.exe", fn: ns.relaysmtp, name: "relaySMTP" },
        { file: "HTTPWorm.exe", fn: ns.httpworm, name: "HTTPWorm" },
        { file: "SQLInject.exe", fn: ns.sqlinject, name: "SQLInject" },
    ];
    
    const availableTools = tools.filter(t => ns.fileExists(t.file, "home"));
    
    ns.print(`INFO Elérhető eszközök: ${availableTools.length}/5`);
    for (const tool of availableTools) {
        ns.print(`  ✅ ${tool.name}`);
    }
    
    do {
        const servers = getAllServers(ns);
        let rooted = 0;
        let alreadyRooted = 0;
        let failed = 0;
        
        for (const server of servers) {
            if (server === "home") continue;
            
            if (ns.hasRootAccess(server)) {
                alreadyRooted++;
                continue;
            }
            
            const portsRequired = ns.getServerNumPortsRequired(server);
            
            if (availableTools.length >= portsRequired) {
                // Portok megnyitása
                for (const tool of availableTools) {
                    try {
                        tool.fn(server);
                    } catch {}
                }
                
                // NUKE
                try {
                    ns.nuke(server);
                    ns.print(`SUCCESS Rootolva: ${server}`);
                    rooted++;
                } catch (e) {
                    ns.print(`WARN Nem sikerült: ${server} - ${e}`);
                    failed++;
                }
            } else {
                failed++;
            }
        }
        
        ns.print("");
        ns.print("╔═══════════════════════════════════════╗");
        ns.print("║         ROOT STATUS SUMMARY           ║");
        ns.print("╠═══════════════════════════════════════╣");
        ns.print(`║ Összes szerver:    ${servers.length.toString().padEnd(17)}║`);
        ns.print(`║ Már rootolt:       ${alreadyRooted.toString().padEnd(17)}║`);
        ns.print(`║ Most rootolt:      ${rooted.toString().padEnd(17)}║`);
        ns.print(`║ Nem elérhető:      ${failed.toString().padEnd(17)}║`);
        ns.print(`║ Eszközök:          ${availableTools.length}/5`.padEnd(40) + "║");
        ns.print("╚═══════════════════════════════════════╝");
        
        if (flags.continuous) {
            ns.print(`INFO Következő ellenőrzés ${flags.interval / 1000} másodperc múlva...`);
            await ns.sleep(flags.interval);
        }
        
    } while (flags.continuous);
}
