/**
 * SERVER PURCHASER
 * Automatikusan vásárol és frissít privát szervereket
 * 
 * Használat: run server-buyer.js [--ram 8] [--max 25]
 */

/** Formázott pénzösszeg */
function formatMoney(n) {
    if (n >= 1e12) return (n / 1e12).toFixed(2) + "t";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "b";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "m";
    if (n >= 1e3) return (n / 1e3).toFixed(2) + "k";
    return n.toFixed(2);
}

/** Formázott RAM */
function formatRam(gb) {
    if (gb >= 1024 * 1024) return (gb / (1024 * 1024)).toFixed(0) + "PB";
    if (gb >= 1024) return (gb / 1024).toFixed(0) + "TB";
    return gb.toFixed(0) + "GB";
}

/** @param {NS} ns */
export async function main(ns) {
    ns.disableLog("ALL");
    ns.tail();
    
    const flags = ns.flags([
        ["ram", 0],         // Kezdő RAM (0 = automatikus)
        ["max", 25],        // Maximum szerverek száma
        ["continuous", true],
        ["interval", 10000],
        ["upgrade", true],  // Automatikus upgrade
        ["prefix", "pserv-"],
    ]);
    
    const maxServers = Math.min(flags.max, ns.getPurchasedServerLimit());
    const maxRam = ns.getPurchasedServerMaxRam();
    
    ns.print("╔═══════════════════════════════════════════════════════════╗");
    ns.print("║              🖥️  SERVER PURCHASER 🖥️                       ║");
    ns.print("╠═══════════════════════════════════════════════════════════╣");
    ns.print(`║ Max szerverek: ${maxServers}`.padEnd(60) + "║");
    ns.print(`║ Max RAM/szerver: ${formatRam(maxRam)}`.padEnd(60) + "║");
    ns.print("╚═══════════════════════════════════════════════════════════╝");
    
    // Worker scriptek amiket telepíteni kell
    const scripts = [
        "/batch/hack.js",
        "/batch/grow.js",
        "/batch/weaken.js",
    ];
    
    do {
        const currentMoney = ns.getPlayer().money;
        const ownedServers = ns.getPurchasedServers();
        
        // Határozd meg a jelenlegi minimum RAM-ot a szervereink között
        let minOwnedRam = maxRam;
        for (const server of ownedServers) {
            const ram = ns.getServerMaxRam(server);
            if (ram < minOwnedRam) minOwnedRam = ram;
        }
        
        // Ha nincs még szerverünk, kezdjünk kicsivel
        if (ownedServers.length === 0) minOwnedRam = 8;
        
        // Válassz RAM méretet - a megadott vagy automatikus
        let targetRam = flags.ram > 0 ? flags.ram : minOwnedRam;
        
        // Upgrade logika: ha van elég pénzünk, nagyobb RAM-mal vásároljunk
        if (flags.upgrade && ownedServers.length >= maxServers) {
            // Minden szerver megvan, próbáljunk upgrade-elni
            let upgradeRam = targetRam * 2;
            while (upgradeRam <= maxRam) {
                const upgradeCost = ns.getPurchasedServerCost(upgradeRam);
                if (currentMoney >= upgradeCost * 2) { // Legyen elég tartalék
                    targetRam = upgradeRam;
                }
                upgradeRam *= 2;
            }
        }
        
        const serverCost = ns.getPurchasedServerCost(targetRam);
        
        // Státusz kiírás
        ns.print("");
        ns.print(`📊 Szerverek: ${ownedServers.length}/${maxServers}`);
        ns.print(`💰 Pénz: ${formatMoney(currentMoney)}`);
        ns.print(`🎯 Cél RAM: ${formatRam(targetRam)}`);
        ns.print(`💵 Szerver ár: ${formatMoney(serverCost)}`);
        
        // Vásárlás vagy upgrade
        if (ownedServers.length < maxServers && currentMoney >= serverCost) {
            // Új szerver vásárlása
            const serverName = `${flags.prefix}${ownedServers.length}`;
            const newServer = ns.purchaseServer(serverName, targetRam);
            
            if (newServer) {
                ns.print(`SUCCESS Új szerver: ${newServer} (${formatRam(targetRam)})`);
                
                // Scriptek telepítése
                await ns.scp(scripts, newServer, "home");
            }
        } else if (flags.upgrade && ownedServers.length >= maxServers && currentMoney >= serverCost) {
            // Legkisebb szerver upgrade-je
            let smallestServer = null;
            let smallestRam = Infinity;
            
            for (const server of ownedServers) {
                const ram = ns.getServerMaxRam(server);
                if (ram < smallestRam && ram < targetRam) {
                    smallestRam = ram;
                    smallestServer = server;
                }
            }
            
            if (smallestServer && targetRam > smallestRam) {
                // Töröljük és újravásároljuk nagyobb RAM-mal
                ns.killall(smallestServer);
                ns.deleteServer(smallestServer);
                
                const newServer = ns.purchaseServer(smallestServer, targetRam);
                if (newServer) {
                    ns.print(`SUCCESS Upgrade: ${smallestServer} ${formatRam(smallestRam)} -> ${formatRam(targetRam)}`);
                    await ns.scp(scripts, newServer, "home");
                }
            }
        }
        
        // Összesítés
        let totalRam = 0;
        for (const server of ns.getPurchasedServers()) {
            totalRam += ns.getServerMaxRam(server);
        }
        ns.print(`📦 Összes RAM: ${formatRam(totalRam)}`);
        
        if (flags.continuous) {
            await ns.sleep(flags.interval);
        }
        
    } while (flags.continuous);
}
