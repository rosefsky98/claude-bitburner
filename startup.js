/**
 * STARTUP SCRIPT
 * Egy paranccsal elindítja az egész batch farming rendszert
 * 
 * Használat: run startup.js [target]
 */

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.tprint("╔═══════════════════════════════════════════════════════════════╗");
    ns.tprint("║        🚀 BATCH FARMING SYSTEM STARTUP 🚀                     ║");
    ns.tprint("╚═══════════════════════════════════════════════════════════════╝");
    
    const target = ns.args[0] || "";
    
    // 1. Auto-root futtatása
    ns.tprint("INFO [1/4] Szerverek rootolása...");
    ns.run("auto-root.js");
    await ns.sleep(2000);
    
    // 2. Target elemzés
    ns.tprint("INFO [2/4] Célpont elemzése...");
    const analyzerPid = ns.run("analyze-targets.js");
    await ns.sleep(3000);
    
    // 3. Server buyer indítása (háttérben)
    ns.tprint("INFO [3/4] Szerver vásárló indítása...");
    ns.run("server-buyer.js", 1, "--continuous", "--interval", "30000");
    await ns.sleep(1000);
    
    // 4. Batch manager indítása
    ns.tprint("INFO [4/4] Batch manager indítása...");
    if (target) {
        ns.run("batch-manager.js", 1, target);
    } else {
        ns.run("batch-manager.js", 1, "--auto");
    }
    
    ns.tprint("");
    ns.tprint("SUCCESS Minden elindítva! Nézd meg a batch-manager logját a részletekért.");
    ns.tprint("INFO    Használd a 'tail batch-manager.js' parancsot a monitorozáshoz.");
}
