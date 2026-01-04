/** cc-daemon.js
 * Auto-scan and solve Coding Contracts across the network.
 *
 * Run:
 *   run cc-daemon.js --tail --interval 240000 --depth 25 --verbose true
 */

/** @param {NS} ns **/
export async function main(ns) {
  const FLAGS = ns.flags([
    ["interval", 240000], // 4 minutes
    ["depth", 25],
    ["tail", true],
    ["verbose", true],
    ["dry", false],       // if true: don't attempt, only print what would be done
  ]);

  ns.disableLog("ALL");
  if (FLAGS.tail) { try { ns.ui.openTail(); } catch {} }

  const seenSolved = new Set(); // avoid re-attempt spam (successful ones)
  const seenUnsupported = new Set(); // track unsupported types (for summary)

  // ---------- Network scan ----------
  function scanAll(start = "home", maxDepth = 25) {
    const seen = new Set([start]);
    const q = [{ h: start, d: 0 }];
    let qi = 0;
    while (qi < q.length) {
      const { h, d } = q[qi++];
      if (d >= maxDepth) continue;
      for (const n of ns.scan(h)) {
        if (!seen.has(n)) {
          seen.add(n);
          q.push({ h: n, d: d + 1 });
        }
      }
    }
    return [...seen];
  }

  // ---------- Solvers ----------
  function solve(type, data) {
    switch (type) {
      // ---- Stock Traders ----
      case "Algorithmic Stock Trader I": return stockTraderK(1, data);
      case "Algorithmic Stock Trader II": return stockTraderK(999999, data); // unlimited
      case "Algorithmic Stock Trader III": return stockTraderK(2, data);
      case "Algorithmic Stock Trader IV": {
        const k = data[0];
        const prices = data[1];
        return stockTraderK(k, prices);
      }

      // ---- Grid paths ----
      case "Unique Paths in a Grid I": {
        const [rows, cols] = data;
        return uniquePathsI(rows, cols);
      }
      case "Unique Paths in a Grid II": return uniquePathsII(data);
      case "Shortest Path in a Grid": return shortestPathGrid(data);
      case "Minimum Path Sum in a Grid": return minPathGrid(data);

      // ---- Triangle ----
      case "Minimum Path Sum in a Triangle": return minPathTriangle(data);

      // ---- Spiral ----
      case "Spiralize Matrix": return spiralize(data);

      // ---- Merge intervals ----
      case "Merge Overlapping Intervals": return mergeIntervals(data);

      // ---- Jumping ----
      case "Array Jumping Game": return canReachEnd(data) ? 1 : 0;
      case "Array Jumping Game II": return minJumps(data);

      // ---- Graph coloring ----
      case "Proper 2-Coloring of a Graph": return twoColoring(data);

      // ---- Parentheses sanitize ----
      case "Sanitize Parentheses in Expression": return sanitizeParens(data);

      // ---- Ciphers ----
      case "Encryption I: Caesar Cipher": return caesarCipher(data[0], data[1]);
      case "Encryption II: Vigenère Cipher": return vigenereCipher(data[0], data[1]);

      // ---- Compression ----
      case "Compression I: RLE Compression": return rleCompress(data);
      case "Compression II: LZ Decompression": return lzDecompress(data);
      case "Compression III: LZ Compression": return lzCompress(data);


      // ---- Other common ----
      case "Generate IP Addresses": return generateIP(data);
      case "Find All Valid Math Expressions": return findAllExpressions(data[0], data[1]);
      case "HammingCodes: Encoded Binary to Integer": return hammingDecodeToInt(data);
      case "Subarray with Maximum Sum": return maxSubarraySum(data);
      case "Total Ways to Sum": return totalWaysToSum(data);
      case "Total Ways to Sum II": return totalWaysToSumII(data);
      case "Find Largest Prime Factor": return largestPrimeFactor(data);

      default:
        return null;
    }
  }

  // ------------------ Implementations ------------------

  // Stock trader with at most k transactions
  function stockTraderK(k, prices) {
    if (!prices || prices.length === 0) return 0;
    const n = prices.length;
    if (k <= 0) return 0;

    // If k is large, it's equivalent to unlimited transactions
    if (k >= Math.floor(n / 2)) {
      let prof = 0;
      for (let i = 1; i < n; i++) {
        if (prices[i] > prices[i - 1]) prof += prices[i] - prices[i - 1];
      }
      return prof;
    }

    // DP: hold[t], cash[t]
    const hold = Array(k + 1).fill(-Infinity);
    const cash = Array(k + 1).fill(0);

    for (const p of prices) {
      for (let t = 1; t <= k; t++) {
        hold[t] = Math.max(hold[t], cash[t - 1] - p);
        cash[t] = Math.max(cash[t], hold[t] + p);
      }
    }
    return cash[k];
  }

  function uniquePathsI(r, c) {
    // combinatorics: C((r-1)+(c-1), r-1)
    const n = (r - 1) + (c - 1);
    const k = Math.min(r - 1, c - 1);
    let res = 1;
    for (let i = 1; i <= k; i++) {
      res = (res * (n - k + i)) / i;
    }
    return Math.round(res);
  }

  function uniquePathsII(grid) {
    const R = grid.length;
    const C = grid[0].length;
    const dp = Array(C).fill(0);
    dp[0] = grid[0][0] === 1 ? 0 : 1;
    for (let i = 0; i < R; i++) {
      for (let j = 0; j < C; j++) {
        if (grid[i][j] === 1) dp[j] = 0;
        else if (j > 0) dp[j] += dp[j - 1];
      }
    }
    return dp[C - 1];
  }

  function shortestPathGrid(grid) {
    const R = grid.length;
    const C = grid[0].length;
    if (grid[0][0] === 1 || grid[R - 1][C - 1] === 1) return "";

    const idx = (r, c) => r * C + c;

    const q = [];
    let qi = 0;
    const start = idx(0, 0);
    const goal = idx(R - 1, C - 1);

    const prev = Array(R * C).fill(-1);
    const prevMove = Array(R * C).fill(""); // move used to reach node

    prev[start] = start;
    q.push(start);

    const dirs = [
      [-1, 0, "U"],
      [ 1, 0, "D"],
      [ 0,-1, "L"],
      [ 0, 1, "R"],
    ];

    while (qi < q.length) {
      const cur = q[qi++];
      if (cur === goal) break;
      const r = Math.floor(cur / C);
      const c = cur % C;

      for (const [dr, dc, ch] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
        if (grid[nr][nc] === 1) continue;
        const ni = idx(nr, nc);
        if (prev[ni] !== -1) continue;
        prev[ni] = cur;
        prevMove[ni] = ch;
        q.push(ni);
      }
    }

    if (prev[goal] === -1) return "";

    // reconstruct
    let out = "";
    let cur = goal;
    while (cur !== start) {
      out = prevMove[cur] + out;
      cur = prev[cur];
    }
    return out;
  }

  function minPathGrid(grid) {
    const R = grid.length, C = grid[0].length;
    const dp = Array(C).fill(Infinity);
    dp[0] = grid[0][0];
    for (let j = 1; j < C; j++) dp[j] = dp[j - 1] + grid[0][j];
    for (let i = 1; i < R; i++) {
      dp[0] = dp[0] + grid[i][0];
      for (let j = 1; j < C; j++) {
        dp[j] = Math.min(dp[j], dp[j - 1]) + grid[i][j];
      }
    }
    return dp[C - 1];
  }

  function minPathTriangle(tri) {
    const dp = tri[tri.length - 1].slice();
    for (let i = tri.length - 2; i >= 0; i--) {
      for (let j = 0; j < tri[i].length; j++) {
        dp[j] = tri[i][j] + Math.min(dp[j], dp[j + 1]);
      }
    }
    return dp[0];
  }

  function spiralize(mat) {
    const res = [];
    let top = 0, bot = mat.length - 1;
    let left = 0, right = mat[0].length - 1;
    while (top <= bot && left <= right) {
      for (let j = left; j <= right; j++) res.push(mat[top][j]);
      top++;
      for (let i = top; i <= bot; i++) res.push(mat[i][right]);
      right--;
      if (top <= bot) {
        for (let j = right; j >= left; j--) res.push(mat[bot][j]);
        bot--;
      }
      if (left <= right) {
        for (let i = bot; i >= top; i--) res.push(mat[i][left]);
        left++;
      }
    }
    return res;
  }

  function mergeIntervals(intervals) {
    intervals.sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const [s, e] of intervals) {
      if (!out.length || s > out[out.length - 1][1]) out.push([s, e]);
      else out[out.length - 1][1] = Math.max(out[out.length - 1][1], e);
    }
    return out;
  }

  function canReachEnd(arr) {
    let far = 0;
    for (let i = 0; i < arr.length; i++) {
      if (i > far) return false;
      far = Math.max(far, i + arr[i]);
      if (far >= arr.length - 1) return true;
    }
    return true;
  }

  function minJumps(arr) {
    if (arr.length <= 1) return 0;
    if (arr[0] === 0) return 0;
    let jumps = 0, curEnd = 0, far = 0;
    for (let i = 0; i < arr.length - 1; i++) {
      far = Math.max(far, i + arr[i]);
      if (i === curEnd) {
        jumps++;
        curEnd = far;
        if (curEnd >= arr.length - 1) return jumps;
      }
    }
    return 0;
  }

  function twoColoring(data) {
    const n = data[0];
    const edges = data[1];
    const g = Array.from({ length: n }, () => []);
    for (const [u, v] of edges) {
      g[u].push(v);
      g[v].push(u);
    }
    const color = Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      if (color[i] !== -1) continue;
      color[i] = 0;
      const q = [i];
      let qi = 0;
      while (qi < q.length) {
        const u = q[qi++];
        for (const v of g[u]) {
          if (color[v] === -1) {
            color[v] = 1 - color[u];
            q.push(v);
          } else if (color[v] === color[u]) {
            return []; // impossible
          }
        }
      }
    }
    return color;
  }

  function sanitizeParens(s) {
    const isValid = (str) => {
      let bal = 0;
      for (const ch of str) {
        if (ch === "(") bal++;
        else if (ch === ")") {
          bal--;
          if (bal < 0) return false;
        }
      }
      return bal === 0;
    };

    const res = [];
    const visited = new Set([s]);
    let q = [s];
    let found = false;

    while (q.length && !found) {
      const next = [];
      for (const cur of q) {
        if (isValid(cur)) {
          res.push(cur);
          found = true;
        }
        if (found) continue;
        for (let i = 0; i < cur.length; i++) {
          const ch = cur[i];
          if (ch !== "(" && ch !== ")") continue;
          const cand = cur.slice(0, i) + cur.slice(i + 1);
          if (!visited.has(cand)) {
            visited.add(cand);
            next.push(cand);
          }
        }
      }
      q = next;
    }
    return res.length ? res : [""];
  }

  function caesarCipher(text, shift) {
    const A = "A".charCodeAt(0);
    const mod = (x, m) => ((x % m) + m) % m;
    shift = shift % 26;
    let out = "";
    for (const ch of text) {
      if (ch === " ") { out += " "; continue; }
      const code = ch.charCodeAt(0) - A;
      out += String.fromCharCode(A + mod(code - shift, 26));
    }
    return out;
  }

  function vigenereCipher(plain, key) {
    const A = "A".charCodeAt(0);
    let out = "";
    let ki = 0;
    for (const ch of plain) {
      const p = ch.charCodeAt(0) - A;
      const k = key[ki % key.length].charCodeAt(0) - A;
      out += String.fromCharCode(A + ((p + k) % 26));
      ki++;
    }
    return out;
  }

  function rleCompress(s) {
    let out = "";
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      let j = i;
      while (j < s.length && s[j] === ch) j++;
      let run = j - i;
      while (run > 9) {
        out += `9${ch}`;
        run -= 9;
      }
      out += `${run}${ch}`;
      i = j;
    }
    return out;
  }

  // Compression II: LZ Decompression
  // Format alternates: literal chunk then backref chunk, etc.
  // Each chunk starts with length L (digit 0-9). If L==0 => empty chunk, just toggles type.
  // Literal: next L chars appended.
  // Backref: next digit X (1-9) is offset, copy L chars from out[-X] forward (overlap allowed).
  function lzDecompress(s) {
    let out = "";
    let i = 0;
    let literal = true;
    while (i < s.length) {
      const L = parseInt(s[i], 10);
      i++;
      if (Number.isNaN(L)) return ""; // malformed
      if (L === 0) { literal = !literal; continue; }

      if (literal) {
        out += s.slice(i, i + L);
        i += L;
      } else {
        const X = parseInt(s[i], 10);
        i++;
        for (let k = 0; k < L; k++) {
          const from = out.length - X;
          out += out[from];
        }
      }
      literal = !literal;
    }
    return out;
  }

  // Compression III: LZ Compression
// A Compression II-vel azonos formátumot állít elő:
// - Chunkok váltakoznak: literal, backref, literal, backref... (kezdetben literal)
// - Minden chunk elején egy hossz digit (0-9)
// - Literal chunk: L + következő L karakter
// - Backref chunk: L + offset digit (1-9), majd L karakter másolása out[-offset]-től (átfedés engedett)
// - L=0: üres chunk, csak típust vált (egy "0" karakter az outputban)
function lzCompress(input) {
  const s = String(input);
  const n = s.length;

  // Állapot: (i, mode) ahol i = elkészült output hossza (0..n),
  // mode: 0 => következő chunk LITERAL, 1 => következő chunk BACKREF
  const id = (i, mode) => i * 2 + mode;
  const V = (n + 1) * 2;

  const dist = Array(V).fill(Infinity);
  const prev = Array(V).fill(-1);
  const prevChunk = Array(V).fill("");
  const used = Array(V).fill(false);

  const start = id(0, 0);
  dist[start] = 0;

  function relax(to, chunk, cost, from) {
    const nd = dist[from] + cost;
    if (nd < dist[to]) {
      dist[to] = nd;
      prev[to] = from;
      prevChunk[to] = chunk;
    }
  }

  // Naiv Dijkstra (V kicsi, így bőven jó)
  for (let iter = 0; iter < V; iter++) {
    let v = -1;
    let best = Infinity;
    for (let j = 0; j < V; j++) {
      if (!used[j] && dist[j] < best) {
        best = dist[j];
        v = j;
      }
    }
    if (v === -1) break;
    used[v] = true;

    const i = Math.floor(v / 2);
    const mode = v % 2;

    // Mindig engedjük a 0-hosszú chunkot a típust váltáshoz
    relax(id(i, 1 - mode), "0", 1, v);

    // Ha már a végén vagyunk, nem érdemes tovább “termelni”
    if (i === n) continue;

    if (mode === 0) {
      // LITERAL: "L" + s[i..i+L)
      for (let L = 1; L <= 9; L++) {
        if (i + L > n) break;
        const chunk = String(L) + s.slice(i, i + L);
        relax(id(i + L, 1), chunk, 1 + L, v);
      }
    } else {
      // BACKREF: "L" + "X" (1..9), feltétel: a következő L karakter előállítható offset X-szel
      for (let L = 1; L <= 9; L++) {
        if (i + L > n) break;
        for (let X = 1; X <= 9; X++) {
          if (i < X) continue;

          let ok = true;
          for (let k = 0; k < L; k++) {
            // Átfedés engedett: ez a feltétel elég (a string saját “önreferenciáját” is kezeli)
            if (s[i + k] !== s[i + k - X]) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;

          const chunk = String(L) + String(X);
          relax(id(i + L, 0), chunk, 2, v);
        }
      }
    }
  }

  const end0 = id(n, 0);
  const end1 = id(n, 1);
  let end = dist[end0] <= dist[end1] ? end0 : end1;

  // visszafejtés
  const parts = [];
  while (end !== start && end !== -1) {
    parts.push(prevChunk[end]);
    end = prev[end];
  }
  parts.reverse();
  return parts.join("");
}


  function generateIP(digits) {
    const res = [];
    const s = String(digits);

    function validOctet(str) {
      if (str.length === 0 || str.length > 3) return false;
      if (str.length > 1 && str[0] === "0") return false;
      const n = Number(str);
      return n >= 0 && n <= 255;
    }

    function dfs(i, parts, path) {
      if (parts === 4) {
        if (i === s.length) res.push(path.join("."));
        return;
      }
      // pruning: remaining chars must fit remaining parts
      const rem = s.length - i;
      const minNeed = (4 - parts) * 1;
      const maxNeed = (4 - parts) * 3;
      if (rem < minNeed || rem > maxNeed) return;

      for (let len = 1; len <= 3; len++) {
        if (i + len > s.length) break;
        const seg = s.slice(i, i + len);
        if (!validOctet(seg)) continue;
        path.push(seg);
        dfs(i + len, parts + 1, path);
        path.pop();
      }
    }

    dfs(0, 0, []);
    return res;
  }

  // Find All Valid Math Expressions (+ - *) to reach target, respecting precedence
  function findAllExpressions(digits, target) {
    const s = String(digits);
    const T = BigInt(target);
    const out = [];

    function dfs(pos, expr, value, lastMul) {
      if (pos === s.length) {
        if (value === T) out.push(expr);
        return;
      }
      for (let len = 1; len <= s.length - pos; len++) {
        const part = s.slice(pos, pos + len);
        if (part.length > 1 && part[0] === "0") break; // no leading zeros
        const cur = BigInt(part);

        if (pos === 0) {
          dfs(pos + len, part, cur, cur);
        } else {
          dfs(pos + len, `${expr}+${part}`, value + cur, cur);
          dfs(pos + len, `${expr}-${part}`, value - cur, -cur);
          // multiplication: roll back lastMul then add lastMul*cur
          dfs(pos + len, `${expr}*${part}`, value - lastMul + (lastMul * cur), lastMul * cur);
        }
      }
    }

    dfs(0, "", 0n, 0n);
    return out;
  }

  // Extended Hamming: Encoded Binary to Integer
  function hammingDecodeToInt(binStr) {
    const bits = String(binStr).split("").map(c => (c === "1" ? 1 : 0));
    const n = bits.length;

    const isPowerOfTwo = (x) => x > 0 && (x & (x - 1)) === 0;

    function parityCheck(p) {
      // returns true if parity is EVEN (passes), false if ODD (fails)
      if (p === 0) {
        let ones = 0;
        for (let i = 0; i < n; i++) ones += bits[i];
        return (ones % 2) === 0;
      }
      let ones = 0;
      // alternately take p bits, skip p bits, starting at index p
      for (let i = p; i < n; i += 2 * p) {
        for (let j = i; j < i + p && j < n; j++) ones += bits[j];
      }
      return (ones % 2) === 0;
    }

    let syndrome = 0;
    for (let p = 1; p < n; p <<= 1) {
      if (!parityCheck(p)) syndrome += p;
    }
    const overallOk = parityCheck(0);

    // Correct single-bit error if indicated
    if (syndrome === 0 && !overallOk) {
      // error in overall parity bit
      bits[0] ^= 1;
    } else if (syndrome !== 0 && !overallOk) {
      // error at syndrome position
      if (syndrome >= 0 && syndrome < n) bits[syndrome] ^= 1;
    } else {
      // syndrome!=0 && overallOk -> likely multi-bit; contract usually won't give it
      // do nothing
    }

    // Extract data bits (exclude index 0 and powers of two)
    let data = "";
    for (let i = 0; i < n; i++) {
      if (i === 0) continue;
      if (isPowerOfTwo(i)) continue;
      data += bits[i] ? "1" : "0";
    }

    // data bits are MSB first
    return parseInt(data || "0", 2);
  }

  function maxSubarraySum(arr) {
    let best = -Infinity;
    let cur = 0;
    for (const x of arr) {
      cur = Math.max(x, cur + x);
      best = Math.max(best, cur);
    }
    return best;
  }

  // Total Ways to Sum: number of partitions excluding the trivial [n]
  function totalWaysToSum(n) {
    const N = Number(n);
    const dp = Array(N + 1).fill(0);
    dp[0] = 1;
    for (let coin = 1; coin <= N - 1; coin++) {
      for (let i = coin; i <= N; i++) {
        dp[i] += dp[i - coin];
      }
    }
    return dp[N];
  }

  // Total Ways to Sum II: data = [n, [nums]]
  function totalWaysToSumII(data) {
    const N = Number(data[0]);
    const nums = data[1].slice().sort((a, b) => a - b);
    const dp = Array(N + 1).fill(0);
    dp[0] = 1;
    for (const coin of nums) {
      for (let i = coin; i <= N; i++) {
        dp[i] += dp[i - coin];
      }
    }
    return dp[N];
  }

  function largestPrimeFactor(n) {
    let x = Number(n);
    if (x < 2) return x;
    let p = 2;
    let last = 1;
    while (p * p <= x) {
      while (x % p === 0) {
        last = p;
        x = Math.floor(x / p);
      }
      p = (p === 2) ? 3 : p + 2;
    }
    if (x > 1) last = x;
    return last;
  }

  // ---------- Main loop ----------
  while (true) {
    const hosts = scanAll("home", FLAGS.depth);

    let found = 0, attempted = 0, solved = 0, skipped = 0, unsupported = 0, failed = 0;

    for (const h of hosts) {
      const files = ns.ls(h, ".cct");
      if (!files.length) continue;

      for (const file of files) {
        found++;
        const key = `${h}:${file}`;
        if (seenSolved.has(key)) { skipped++; continue; }

        const type = ns.codingcontract.getContractType(file, h);
        const data = ns.codingcontract.getData(file, h);
        const tries = ns.codingcontract.getNumTriesRemaining(file, h);

        const ans = solve(type, data);
        if (ans === null || ans === undefined) {
          unsupported++;
          seenUnsupported.add(type);
          if (FLAGS.verbose) ns.print(`[UNSUPPORTED] ${h} ${file} | ${type} | tries=${tries}`);
          continue;
        }

        attempted++;
        if (FLAGS.dry) {
          if (FLAGS.verbose) ns.print(`[DRY] Would attempt ${h} ${file} | ${type} | ans=${JSON.stringify(ans)}`);
          continue;
        }

        const result = ns.codingcontract.attempt(ans, file, h, { returnReward: true });
        if (result && typeof result === "string" && result.length > 0) {
          solved++;
          seenSolved.add(key);
          ns.tprint(`[SOLVED] ${h} ${file} | ${type} | reward: ${result}`);
        } else {
          failed++;
          const left = ns.codingcontract.getNumTriesRemaining(file, h);
          ns.tprint(`[FAIL] ${h} ${file} | ${type} | triesLeft=${left} | ans=${JSON.stringify(ans)}`);
        }

        await ns.sleep(25);
      }
    }

    const unsupportedList = [...seenUnsupported].slice(0, 10).join(" | ");
    ns.print(
      `cc-daemon | hosts=${hosts.length} | found=${found} | attempted=${attempted} | solved=${solved} | ` +
      `unsupported=${unsupported} | failed=${failed} | next=${Math.floor(FLAGS.interval / 60000)}m` +
      (seenUnsupported.size ? ` | unsupportedTypes(sample)=${unsupportedList}` : "")
    );

    await ns.sleep(FLAGS.interval);
  }
}
