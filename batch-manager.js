/**
 * BITBURNER BATCH FARMING SYSTEM
 * Fő vezérlő script - HWGW batch stratégia
 * 
 * Használat: run batch-manager.js [target] [--auto]
 * --auto: automatikusan kiválasztja a legjobb célpontot
 */

// ==================== KONFIGURÁCIÓ ====================
const CONFIG = {
    // Batch időzítés
    batchDelay: 200,           // ms késleltetés műveletek között
    cycleDelay: 50,            // ms késleltetés batch-ek között
    maxBatchesPerCycle: 1000,  // Max párhuzamos batch
    
    // Hack százalék - mennyi pénzt lopunk egy hack-kel
    hackPercent: 0.25,         // 25% - ez egy jó egyensúly
    
    // Worker scriptek
    hackScript: "/batch/hack.js",
    growScript: "/batch/grow.js",
    weakenScript: "/batch/weaken.js",
    
    // RAM költségek (Bitburner alapértékek)
    hackRam: 1.70,
    growRam: 1.75,
    weakenRam: 1.75,
    
    // Prep beállítások
    prepWeakenScript: "/batch/weaken.js",
    prepGrowScript: "/batch/grow.js",
    
    // Frissítési gyakoriság
    statusUpdateInterval: 2000, // ms
    
    // Biztonsági margó
    securityMargin: 0.5,
    moneyMargin: 0.99,
};

// ==================== UTILITY FÜGGVÉNYEK ====================

/** Formázott pénzösszeg */
function formatMoney(n) {
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

/** Formázott RAM */
function formatRam(gb) {
    if (gb >= 1024) return (gb / 1024).toFixed(2) + "TB";
    return gb.toFixed(2) + "GB";
}

/** Összes rootolt szerver lekérése */
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

/** Rootolható szerverek rootolása */
function rootServers(ns) {
    const servers = getAllServers(ns);
    const tools = [
        { file: "BruteSSH.exe", fn: ns.brutessh },
        { file: "FTPCrack.exe", fn: ns.ftpcrack },
        { file: "relaySMTP.exe", fn: ns.relaysmtp },
        { file: "HTTPWorm.exe", fn: ns.httpworm },
        { file: "SQLInject.exe", fn: ns.sqlinject },
    ];
    
    const availableTools = tools.filter(t => ns.fileExists(t.file, "home"));
    let rooted = 0;
    
    for (const server of servers) {
        if (ns.hasRootAccess(server)) continue;
        
        const portsRequired = ns.getServerNumPortsRequired(server);
        if (availableTools.length >= portsRequired) {
            for (const tool of availableTools) {
                try { tool.fn(server); } catch {}
            }
            try {
                ns.nuke(server);
                rooted++;
            } catch {}
        }
    }
    
    return rooted;
}

/** Worker scriptek másolása szerverekre */
async function deployScripts(ns) {
    const servers = getAllServers(ns).filter(s => ns.hasRootAccess(s) && s !== "home");
    const scripts = [CONFIG.hackScript, CONFIG.growScript, CONFIG.weakenScript];
    
    for (const server of servers) {
        await ns.scp(scripts, server, "home");
    }
}

/** Legjobb célpont megtalálása */
function findBestTarget(ns, player) {
    const servers = getAllServers(ns);
    let bestTarget = null;
    let bestScore = 0;
    
    for (const server of servers) {
        // Kihagyjuk a nem hackelhető szervereket
        if (server === "home" || server.startsWith("pserv-") || server.startsWith("hacknet-")) continue;
        if (!ns.hasRootAccess(server)) continue;
        if (ns.getServerRequiredHackingLevel(server) > player.skills.hacking) continue;
        if (ns.getServerMaxMoney(server) <= 0) continue;
        
        const maxMoney = ns.getServerMaxMoney(server);
        const minSecurity = ns.getServerMinSecurityLevel(server);
        const hackChance = ns.hackAnalyzeChance(server);
        const hackTime = ns.getHackTime(server);
        const growthRate = ns.getServerGrowth(server);
        
        // Pontszámítás: pénz * esély * növekedés / idő / security
        const score = (maxMoney * hackChance * growthRate) / (hackTime * minSecurity);
        
        if (score > bestScore) {
            bestScore = score;
            bestTarget = server;
        }
    }
    
    return bestTarget;
}

/** Szerver előkészítése (prep) - security és money */
async function prepareServer(ns, target) {
    const minSecurity = ns.getServerMinSecurityLevel(target);
    const maxMoney = ns.getServerMaxMoney(target);
    
    while (true) {
        const currentSecurity = ns.getServerSecurityLevel(target);
        const currentMoney = ns.getServerMoneyAvailable(target);
        
        const needWeaken = currentSecurity > minSecurity + CONFIG.securityMargin;
        const needGrow = currentMoney < maxMoney * CONFIG.moneyMargin;
        
        if (!needWeaken && !needGrow) {
            ns.print("SUCCESS Server előkészítve: " + target);
            return true;
        }
        
        // Elérhető RAM kiszámítása
        const servers = getAllServers(ns).filter(s => ns.hasRootAccess(s));
        let totalRam = 0;
        
        for (const server of servers) {
            const maxRam = ns.getServerMaxRam(server);
            const usedRam = ns.getServerUsedRam(server);
            const available = maxRam - usedRam;
            
            // Home-on hagyjunk helyet
            const reservedRam = server === "home" ? 32 : 0;
            totalRam += Math.max(0, available - reservedRam);
        }
        
        // Prioritás: először weaken, aztán grow
        if (needWeaken) {
            const securityDiff = currentSecurity - minSecurity;
            const weakenThreads = Math.ceil(securityDiff / 0.05);
            const threadsToRun = Math.min(weakenThreads, Math.floor(totalRam / CONFIG.weakenRam));
            
            if (threadsToRun > 0) {
                distributeThreads(ns, CONFIG.weakenScript, target, threadsToRun, 0);
                ns.print(`PREP Weaken: ${threadsToRun} thread (security: ${currentSecurity.toFixed(2)} -> ${minSecurity.toFixed(2)})`);
            }
        } else if (needGrow) {
            const growthNeeded = maxMoney / Math.max(1, currentMoney);
            const growThreads = Math.ceil(ns.growthAnalyze(target, growthNeeded));
            const threadsToRun = Math.min(growThreads, Math.floor(totalRam / CONFIG.growRam));
            
            if (threadsToRun > 0) {
                distributeThreads(ns, CONFIG.growScript, target, threadsToRun, 0);
                ns.print(`PREP Grow: ${threadsToRun} thread (money: ${formatMoney(currentMoney)} -> ${formatMoney(maxMoney)})`);
            }
        }
        
        // Várunk a műveletek befejezésére
        const weakenTime = ns.getWeakenTime(target);
        await ns.sleep(weakenTime + 500);
    }
}

/** Thread-ek elosztása szervereken */
function distributeThreads(ns, script, target, totalThreads, delay = 0) {
    const servers = getAllServers(ns).filter(s => ns.hasRootAccess(s));
    let remainingThreads = totalThreads;
    const scriptRam = ns.getScriptRam(script);
    
    // Rendezés RAM szerint (csökkenő)
    servers.sort((a, b) => {
        const aRam = ns.getServerMaxRam(a) - ns.getServerUsedRam(a);
        const bRam = ns.getServerMaxRam(b) - ns.getServerUsedRam(b);
        return bRam - aRam;
    });
    
    for (const server of servers) {
        if (remainingThreads <= 0) break;
        
        const maxRam = ns.getServerMaxRam(server);
        const usedRam = ns.getServerUsedRam(server);
        const reservedRam = server === "home" ? 32 : 0;
        const availableRam = maxRam - usedRam - reservedRam;
        
        const maxThreads = Math.floor(availableRam / scriptRam);
        const threads = Math.min(maxThreads, remainingThreads);
        
        if (threads > 0) {
            const pid = ns.exec(script, server, threads, target, delay, Date.now() + Math.random());
            if (pid > 0) {
                remainingThreads -= threads;
            }
        }
    }
    
    return totalThreads - remainingThreads;
}

/** Batch számítások */
function calculateBatch(ns, target) {
    const player = ns.getPlayer();
    const server = ns.getServer(target);
    
    // Formulas API használata ha elérhető
    let hackTime, growTime, weakenTime;
    let hackPercent, growthAmount;
    
    try {
        // Próbáljuk a Formulas API-t
        server.hackDifficulty = server.minDifficulty;
        server.moneyAvailable = server.moneyMax;
        
        hackTime = ns.formulas.hacking.hackTime(server, player);
        growTime = ns.formulas.hacking.growTime(server, player);
        weakenTime = ns.formulas.hacking.weakTime(server, player);
        hackPercent = ns.formulas.hacking.hackPercent(server, player);
        growthAmount = ns.formulas.hacking.growPercent(server, 1, player);
    } catch {
        // Fallback standard függvényekre
        hackTime = ns.getHackTime(target);
        growTime = ns.getGrowTime(target);
        weakenTime = ns.getWeakenTime(target);
        hackPercent = ns.hackAnalyze(target);
        growthAmount = 1 + (ns.getServerGrowth(target) / 100);
    }
    
    const maxMoney = ns.getServerMaxMoney(target);
    
    // Hack thread-ek számítása
    const hackThreads = Math.max(1, Math.floor(CONFIG.hackPercent / hackPercent));
    const actualHackPercent = hackPercent * hackThreads;
    const moneyStolen = maxMoney * actualHackPercent;
    
    // Grow thread-ek számítása (visszanövesztjük az ellopott pénzt)
    const growthMultiplier = 1 / (1 - actualHackPercent);
    const growThreads = Math.ceil(ns.growthAnalyze(target, growthMultiplier, ns.getServer("home").cpuCores));
    
    // Weaken thread-ek számítása
    const hackSecurityIncrease = 0.002 * hackThreads;
    const growSecurityIncrease = 0.004 * growThreads;
    const weakenEffect = 0.05;
    
    const weaken1Threads = Math.ceil(hackSecurityIncrease / weakenEffect);
    const weaken2Threads = Math.ceil(growSecurityIncrease / weakenEffect);
    
    // RAM számítás
    const batchRam = 
        hackThreads * CONFIG.hackRam +
        growThreads * CONFIG.growRam +
        weaken1Threads * CONFIG.weakenRam +
        weaken2Threads * CONFIG.weakenRam;
    
    return {
        hackThreads,
        growThreads,
        weaken1Threads,
        weaken2Threads,
        hackTime,
        growTime,
        weakenTime,
        moneyStolen,
        batchRam,
        hackPercent: actualHackPercent
    };
}

/** Elérhető RAM kiszámítása */
function getAvailableRam(ns) {
    const servers = getAllServers(ns).filter(s => ns.hasRootAccess(s));
    let totalRam = 0;
    
    for (const server of servers) {
        const maxRam = ns.getServerMaxRam(server);
        const usedRam = ns.getServerUsedRam(server);
        const reservedRam = server === "home" ? 64 : 0;
        totalRam += Math.max(0, maxRam - usedRam - reservedRam);
    }
    
    return totalRam;
}

/** Egyetlen batch futtatása */
function runBatch(ns, target, batch, batchId) {
    const { hackThreads, growThreads, weaken1Threads, weaken2Threads, hackTime, growTime, weakenTime } = batch;
    const delay = CONFIG.batchDelay;
    
    // Időzítés számítása - minden művelet a megfelelő sorrendben érkezzen be
    // Sorrend: Hack -> Weaken1 -> Grow -> Weaken2
    // Mind a weakenTime körül fejeződik be, megfelelő késleltetéssel
    
    const hackDelay = weakenTime - hackTime - delay * 3;
    const weaken1Delay = 0;
    const growDelay = weakenTime - growTime - delay;
    const weaken2Delay = delay * 2;
    
    const uid = `${Date.now()}-${batchId}`;
    
    // Hack
    if (hackThreads > 0) {
        distributeThreads(ns, CONFIG.hackScript, target, hackThreads, hackDelay);
    }
    
    // Weaken1 (hack után)
    if (weaken1Threads > 0) {
        distributeThreads(ns, CONFIG.weakenScript, target, weaken1Threads, weaken1Delay);
    }
    
    // Grow
    if (growThreads > 0) {
        distributeThreads(ns, CONFIG.growScript, target, growThreads, growDelay);
    }
    
    // Weaken2 (grow után)
    if (weaken2Threads > 0) {
        distributeThreads(ns, CONFIG.weakenScript, target, weaken2Threads, weaken2Delay);
    }
    
    return true;
}

/** Statisztikák megjelenítése */
function displayStats(ns, target, batch, batchCount, startTime, startMoney) {
    const currentMoney = ns.getPlayer().money;
    const moneyGained = currentMoney - startMoney;
    const runtime = Date.now() - startTime;
    const moneyPerSec = moneyGained / (runtime / 1000);
    
    const currentSecurity = ns.getServerSecurityLevel(target);
    const minSecurity = ns.getServerMinSecurityLevel(target);
    const currentServerMoney = ns.getServerMoneyAvailable(target);
    const maxServerMoney = ns.getServerMaxMoney(target);
    
    ns.clearLog();
    ns.print("╔════════════════════════════════════════════════════════════╗");
    ns.print("║          🚀 BATCH FARMING SYSTEM 🚀                        ║");
    ns.print("╠════════════════════════════════════════════════════════════╣");
    ns.print(`║ 🎯 Célpont:     ${target.padEnd(42)}║`);
    ns.print(`║ ⏱️  Futásidő:    ${formatTime(runtime).padEnd(42)}║`);
    ns.print("╠════════════════════════════════════════════════════════════╣");
    ns.print(`║ 💰 Összesen:    ${formatMoney(moneyGained).padEnd(42)}║`);
    ns.print(`║ 📈 $/sec:       ${formatMoney(moneyPerSec).padEnd(42)}║`);
    ns.print(`║ 📦 Batch-ek:    ${batchCount.toString().padEnd(42)}║`);
    ns.print("╠════════════════════════════════════════════════════════════╣");
    ns.print(`║ 🔐 Security:    ${currentSecurity.toFixed(2)} / ${minSecurity.toFixed(2)}`.padEnd(62) + "║");
    ns.print(`║ 💵 Pénz:        ${formatMoney(currentServerMoney)} / ${formatMoney(maxServerMoney)}`.padEnd(62) + "║");
    ns.print("╠════════════════════════════════════════════════════════════╣");
    ns.print(`║ 🔧 H:${batch.hackThreads} W1:${batch.weaken1Threads} G:${batch.growThreads} W2:${batch.weaken2Threads}`.padEnd(62) + "║");
    ns.print(`║ 💾 Batch RAM:   ${formatRam(batch.batchRam).padEnd(42)}║`);
    ns.print(`║ ⚡ Hack%:       ${(batch.hackPercent * 100).toFixed(1)}%`.padEnd(62) + "║");
    ns.print("╚════════════════════════════════════════════════════════════╝");
}

// ==================== FŐ PROGRAM ====================
/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.tail();
    
    const flags = ns.flags([
        ["auto", false],
        ["target", ""],
        ["prep", true],
    ]);
    
    // Rootolás
    const rooted = rootServers(ns);
    if (rooted > 0) {
        ns.print(`INFO ${rooted} új szerver rootolva`);
    }
    
    // Scriptek telepítése
    await deployScripts(ns);
    
    // Célpont meghatározása
    let target = flags.target || ns.args[0];
    const player = ns.getPlayer();
    
    if (!target || flags.auto) {
        target = findBestTarget(ns, player);
        if (!target) {
            ns.print("ERROR Nem található megfelelő célpont!");
            return;
        }
        ns.print(`INFO Automatikusan kiválasztott célpont: ${target}`);
    }
    
    // Ellenőrzés
    if (!ns.hasRootAccess(target)) {
        ns.print(`ERROR Nincs root hozzáférés: ${target}`);
        return;
    }
    
    // Szerver előkészítése
    if (flags.prep) {
        ns.print(`INFO Szerver előkészítése: ${target}`);
        await prepareServer(ns, target);
    }
    
    // Batch számítások
    const batch = calculateBatch(ns, target);
    
    ns.print("INFO Batch konfiguráció:");
    ns.print(`  Hack: ${batch.hackThreads} thread (${(batch.hackPercent * 100).toFixed(1)}%)`);
    ns.print(`  Weaken1: ${batch.weaken1Threads} thread`);
    ns.print(`  Grow: ${batch.growThreads} thread`);
    ns.print(`  Weaken2: ${batch.weaken2Threads} thread`);
    ns.print(`  RAM/batch: ${formatRam(batch.batchRam)}`);
    ns.print(`  Pénz/batch: ${formatMoney(batch.moneyStolen)}`);
    
    // Fő ciklus
    const startTime = Date.now();
    const startMoney = player.money;
    let batchCount = 0;
    let lastStatusUpdate = 0;
    
    while (true) {
        // Ellenőrizzük, hogy a szerver jó állapotban van-e
        const currentSecurity = ns.getServerSecurityLevel(target);
        const minSecurity = ns.getServerMinSecurityLevel(target);
        const currentMoney = ns.getServerMoneyAvailable(target);
        const maxMoney = ns.getServerMaxMoney(target);
        
        // Ha eltér a kívánt állapottól, újra prep
        if (currentSecurity > minSecurity + 5 || currentMoney < maxMoney * 0.5) {
            ns.print("WARN Szerver állapot romlott, újra előkészítés...");
            await prepareServer(ns, target);
            continue;
        }
        
        // RAM ellenőrzés
        const availableRam = getAvailableRam(ns);
        const batchesToRun = Math.min(
            Math.floor(availableRam / batch.batchRam),
            CONFIG.maxBatchesPerCycle
        );
        
        if (batchesToRun > 0) {
            for (let i = 0; i < batchesToRun; i++) {
                runBatch(ns, target, batch, batchCount + i);
            }
            batchCount += batchesToRun;
        }
        
        // Statisztikák megjelenítése
        if (Date.now() - lastStatusUpdate > CONFIG.statusUpdateInterval) {
            displayStats(ns, target, batch, batchCount, startTime, startMoney);
            lastStatusUpdate = Date.now();
        }
        
        // Batch időzítés - várunk a következő ciklusig
        const cycleDuration = batch.weakenTime + CONFIG.batchDelay * 4 + CONFIG.cycleDelay;
        await ns.sleep(Math.max(cycleDuration, 1000));
    }
}
