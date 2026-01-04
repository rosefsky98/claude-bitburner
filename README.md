# 🚀 Bitburner Batch Farming System

Egy erőteljes, optimalizált HWGW batch farming rendszer a Bitburner játékhoz.

## 📁 Fájlstruktúra

```
/
├── startup.js           # Mindent elindít egyszerre
├── batch-manager.js     # Fő vezérlő script
├── analyze-targets.js   # Célpont elemző
├── auto-root.js         # Automatikus rootolás
├── server-buyer.js      # Szerver vásárló/upgradelő
└── batch/
    ├── hack.js          # Hack worker
    ├── grow.js          # Grow worker
    └── weaken.js        # Weaken worker
```

## 🎮 Gyors Indítás

### Legegyszerűbb módszer:
```
run startup.js
```

Ez automatikusan:
1. Rootol minden elérhető szervert
2. Elemzi és kiválasztja a legjobb célpontot
3. Elindítja a szerver vásárlót
4. Elindítja a batch farmert

### Specifikus célpont:
```
run startup.js n00dles
```

## 📖 Részletes Használat

### Batch Manager
```
run batch-manager.js [target] [--auto] [--prep]
```

Opciók:
- `target`: Konkrét célpont megadása (pl. `foodnstuff`)
- `--auto`: Automatikus legjobb célpont kiválasztás
- `--prep`: Szerver előkészítése (alapértelmezetten be van kapcsolva)

Példák:
```
run batch-manager.js --auto          # Automatikus célpont
run batch-manager.js joesguns        # Specifikus célpont
run batch-manager.js n00dles --prep  # Előkészítéssel
```

### Target Analyzer
```
run analyze-targets.js [--detailed] [--top N]
```

Elemzi az összes szervert és rangsorolja őket profitabilitás szerint.

Opciók:
- `--detailed`: Részletes információk
- `--top N`: Top N célpont megjelenítése (alapértelmezett: 15)

### Auto-Root
```
run auto-root.js [--continuous] [--interval N]
```

Automatikusan rootol minden elérhető szervert.

Opciók:
- `--continuous`: Folyamatosan fut és ellenőrzi az új szervereket
- `--interval N`: Ellenőrzési intervallum ms-ban (alapértelmezett: 60000)

### Server Buyer
```
run server-buyer.js [--ram N] [--max N] [--upgrade]
```

Automatikusan vásárol és frissít szervereket.

Opciók:
- `--ram N`: Kezdő RAM méret (0 = automatikus)
- `--max N`: Maximum szerverek száma (alapértelmezett: 25)
- `--upgrade`: Automatikus upgrade (alapértelmezetten be van kapcsolva)
- `--continuous`: Folyamatos futás

## ⚙️ Konfiguráció

A `batch-manager.js` elején található `CONFIG` objektumban módosíthatod:

```javascript
const CONFIG = {
    batchDelay: 200,        // Késleltetés műveletek között (ms)
    cycleDelay: 50,         // Késleltetés batch-ek között (ms)
    hackPercent: 0.25,      // Mennyi pénzt lopunk (25%)
    // ...
};
```

### Ajánlott hackPercent értékek:
- **Kezdő (kis RAM)**: 0.10 - 0.15
- **Közepes**: 0.20 - 0.30
- **Haladó (sok RAM)**: 0.40 - 0.50

## 🔧 Működési Elv

### HWGW Batch Stratégia

Minden "batch" 4 műveletből áll, amelyek precízen időzítve érkeznek be:

1. **H**ack - Pénzt lop a szerverről
2. **W**eaken1 - Visszaállítja a hack okozta security növekedést
3. **G**row - Visszanöveszti az ellopott pénzt
4. **W**eaken2 - Visszaállítja a grow okozta security növekedést

```
Idő -->
|----Hack----|
|------Weaken1------|
|----Grow----|
|------Weaken2------|
              ^ ^ ^ ^
              H W G W  (beérkezési sorrend)
```

### Előkészítés (Prep)

A batch manager először "előkészíti" a célszervert:
- Security → minimum szintre csökkenti
- Money → maximum szintre növeli

Ez biztosítja a maximális hatékonyságot.

## 📊 Monitorozás

A batch manager automatikusan megnyit egy log ablakot részletes statisztikákkal:
- Célpont információk
- Pénz/másodperc
- Futtatott batch-ek száma
- Szerver állapot

Manuális megnyitás:
```
tail batch-manager.js
```

## 🎯 Célpont Kiválasztási Algoritmus

A rendszer a következő szempontokat veszi figyelembe:
- Maximum pénz
- Hack esély
- Növekedési ráta
- Hack idő
- Minimum security

A legjobb célpont általában:
- Közepes-magas max pénz
- Alacsony security
- Megfelelő hack szint

## 💡 Tippek

1. **Korai játék**: Használj `n00dles` vagy `foodnstuff` célpontot
2. **Közép játék**: `joesguns`, `harakiri-sushi`, `hong-fang-tea`
3. **Késői játék**: `ecorp`, `megacorp` (Formulas API-val)

4. **RAM bővítés**: A server-buyer automatikusan frissít, de manuálisan is vásárolhatsz nagyobb szervereket

5. **Több célpont**: Futtathatsz több batch-manager-t különböző célpontokra

## ⚠️ Hibakezelés

Ha a rendszer leáll vagy hibázik:
1. `kill batch-manager.js` - Megállítja a batch managert
2. `killall` - Megállít minden scriptet
3. `run startup.js` - Újraindítja a rendszert

## 🔄 Frissítések

A scriptek automatikusan:
- Rootolják az új szervereket
- Telepítik a worker scripteket
- Adaptálódnak a változó körülményekhez

---

Készítette: Claude AI
Verzió: 1.0.0
