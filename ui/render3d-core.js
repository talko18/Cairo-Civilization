// Cairo Civ — 3D renderer core (pure logic, no three.js dependency).
// Loads in the browser as window.R3DCore and in Node via module.exports.
// World units: one hex has circumradius 1. Flat-top hexes, odd-q offset
// coordinates, odd columns shifted DOWN. Corner 0 is due east and corners
// advance clockwise on screen (x grows east, z grows south, down the map), so
// corner->corner (i -> i+1) runs on the lower-right side first. Edges are NOT
// named by corner index: edge d is the one shared with neighbour direction d
// (0 = upper-right, 1 = top, 2 = upper-left, 3 = lower-left, 4 = bottom,
// 5 = lower-right), and it spans corners (5-d) and (6-d)%6.
(function () {
  'use strict';
  const SQ3 = Math.sqrt(3);

  function hexCenter(q, r) {
    return { x: q * 1.5, z: r * SQ3 + ((q & 1) ? SQ3 / 2 : 0) };
  }

  function hexCorner(i, s) {
    if (s === undefined) s = 1;
    const a = i * Math.PI / 3;
    return [s * Math.cos(a), s * Math.sin(a)];
  }

  // Ported verbatim from index.html (EDGE_NEIGHBOR_EVEN / EDGE_NEIGHBOR_ODD).
  // Indexed by neighbour direction d (0-5); the labels name a direction on
  // screen, not a corner index. Each entry is the [dq, dr] offset of the
  // neighbor across that edge.
  const EDGE_NEIGHBOR_EVEN = [
    [+1, -1], // dir 0: upper-right
    [ 0, -1], // dir 1: top
    [-1, -1], // dir 2: upper-left
    [-1,  0], // dir 3: lower-left
    [ 0, +1], // dir 4: bottom
    [+1,  0], // dir 5: lower-right
  ];
  const EDGE_NEIGHBOR_ODD = [
    [+1,  0], // dir 0: upper-right
    [ 0, -1], // dir 1: top
    [-1,  0], // dir 2: upper-left
    [-1, +1], // dir 3: lower-left
    [ 0, +1], // dir 4: bottom
    [+1, +1], // dir 5: lower-right
  ];

  function neighbor(q, r, edge) {
    const off = (q % 2 === 0) ? EDGE_NEIGHBOR_EVEN[edge] : EDGE_NEIGHBOR_ODD[edge];
    return [q + off[0], r + off[1]];
  }

  function hexDist(q1, r1, q2, r2) {
    const ar1 = r1 - Math.floor(q1 / 2);
    const ar2 = r2 - Math.floor(q2 / 2);
    const dq = q2 - q1, dr = ar2 - ar1;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
  }

  function worldToHex(x, z, cols, rows) {
    const c0 = Math.round(x / 1.5);
    let best = null, bd = Infinity;
    for (let dc = -1; dc <= 1; dc++) {
      const q = c0 + dc;
      const shift = (q & 1) ? SQ3 / 2 : 0;
      const r0 = Math.round((z - shift) / SQ3);
      for (let dr = -1; dr <= 1; dr++) {
        const r = r0 + dr;
        const c = hexCenter(q, r);
        const d = (x - c.x) * (x - c.x) + (z - c.z) * (z - c.z);
        if (d < bd) { bd = d; best = { q, r }; }
      }
    }
    if (!best || best.q < 0 || best.q >= cols || best.r < 0 || best.r >= rows) return null;
    if (bd > SQ3 * SQ3) return null;
    return best;
  }

  // ---- Terrain model (ported from the approved civ3d prototype) ----
  const AP = SQ3 / 2; // apothem of a unit-circumradius hex
  const isWater = (t) => t <= 1;
  const isHills = (t) => t === 3 || t === 5 || t === 7 || t === 9 || t === 11;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  function hash2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y) {
    return (vnoise(x, y) * 0.5 + vnoise(x * 2.03, y * 2.03) * 0.25 + vnoise(x * 4.1, y * 4.1) * 0.125) / 0.875;
  }
  function smooth(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }

  function tileBase(tile) {
    const t = tile.terrain;
    return t === 0 ? -0.35 : t === 1 ? 0.0 : 0.25;
  }
  function tileAmp(tile) {
    const t = tile.terrain;
    return t === 0 ? 0.2 : t === 1 ? 0.08 : isHills(t) ? 0.34 : t === 12 ? 0.3
      : (t === 6 || t === 7) ? 0.07 : 0.06;
  }

  // Distance from a local point to the edge shared with neighbour direction d.
  // Direction d (0=upper-right ... 5=lower-right, z down) has its outward
  // normal at angle (330 - 60d) degrees.
  function dirNormal(d) {
    const a = (330 - 60 * d) * Math.PI / 180;
    return [Math.cos(a), Math.sin(a)];
  }
  const DIR_N = [0, 1, 2, 3, 4, 5].map(dirNormal);
  function edgeDist(lx, lz, d) { return AP - (lx * DIR_N[d][0] + lz * DIR_N[d][1]); }

  function heightAt(tile, x, z) {
    const c = hexCenter(tile.q, tile.r), lx = x - c.x, lz = z - c.z, t = tile.terrain;
    let ed = 9;
    for (let d = 0; d < 6; d++) ed = Math.min(ed, edgeDist(lx, lz, d));
    const fall = smooth(0, 0.55, Math.max(0, ed));
    const n = fbm(x * 1.25 + 11.3, z * 1.25 + 4.7), amp = tileAmp(tile);
    let h;
    if (isHills(t)) h = amp * fall * (0.55 * Math.max(0, 1 - Math.hypot(lx, lz) / 0.95) + 0.6 * n);
    else if (t === 12) h = amp * fall * (0.4 + 0.6 * n);
    else if (isWater(t)) h = amp * fall * (n - 0.55);
    else h = amp * fall * (n - 0.35);
    if (t === 6 || t === 7) h += 0.025 * fall * Math.sin(x * 7 + z * 2.5 + n * 3);
    if (tile.feature === 4) h -= 0.09 * smooth(0.36, 0, Math.hypot(lx, lz));
    // A city stands here: level the ground so buildings sit flat. Real tiles
    // carry no such field (cities live in the city list), so the caller passes
    // a COPY of the tile with hasCity set. Never write it onto shared state.
    if (tile.hasCity) h *= 0.2;
    return tileBase(tile) + h;
  }

  function hex2rgb(h) {
    return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  }
  const BASE = ['#1c4d70', '#4bb0a3', '#6ea84a', '#62994a', '#b3aa5a', '#a39b50', '#e2c47e',
    '#d4b06a', '#8e9b7c', '#7f8c6f', '#e9eef2', '#dbe3ea', '#8b8577'].map(hex2rgb);
  const SAND = hex2rgb('#e4d19a'), SEASAND = hex2rgb('#d1c48a');
  const K = {};
  for (const h of ['#4f8a36', '#c9bd6a', '#fff8e6', '#8a7f5c', '#2f5f2a', '#4b6e33', '#56704a', '#6fae4a']) K[h] = hex2rgb(h);

  function lerpC(c, o, f) { for (let i = 0; i < 3; i++) c[i] += (o[i] - c[i]) * f; }

  function colorAt(tile, x, z, h, tileLookup) {
    const ctr = hexCenter(tile.q, tile.r), lx = x - ctr.x, lz = z - ctr.z, t = tile.terrain;
    const b = BASE[t] || BASE[12];
    const m = 0.86 + 0.26 * fbm(x * 3.3 + 2, z * 3.3 + 9);
    const c = [b[0] * m, b[1] * m, b[2] * m];
    if ((t === 2 || t === 3) && fbm(x * 6, z * 6) > 0.64) lerpC(c, K['#4f8a36'], 0.5);
    if ((t === 4 || t === 5) && fbm(x * 5 + 3, z * 5) > 0.66) lerpC(c, K['#c9bd6a'], 0.5);
    if (isHills(t)) {
      const rel = (h - tileBase(tile)) / tileAmp(tile);
      lerpC(c, K['#fff8e6'], Math.max(0, rel - 0.25) * 0.14);
      if ((t === 3 || t === 5) && rel > 0.6) lerpC(c, K['#8a7f5c'], 0.3);
    }
    if (tile.feature === 2) lerpC(c, K['#2f5f2a'], 0.45);
    if (tile.feature === 1) lerpC(c, K['#4b6e33'], 0.25);
    if (tile.feature === 3) lerpC(c, K['#56704a'], 0.45);
    if (tile.feature === 4) {
      const d = Math.hypot(lx, lz);
      if (d < 0.65) lerpC(c, K['#6fae4a'], (1 - d / 0.65) * 0.9);
    }
    for (let d = 0; d < 6; d++) {
      const [nq, nr] = neighbor(tile.q, tile.r, d);
      const nb = tileLookup ? tileLookup(nq, nr) : null, ed = edgeDist(lx, lz, d);
      const nbt = nb ? nb.terrain : -1;
      if (!isWater(t)) {
        if (!nb || isWater(nbt)) { if (ed < 0.22) lerpC(c, SAND, (1 - ed / 0.22) * 0.85); }
        else if (nbt !== t && ed < 0.4) lerpC(c, BASE[nbt] || BASE[12], (1 - ed / 0.4) * 0.45);
      } else if (t === 1) {
        if (nb && !isWater(nbt) && ed < 0.38) lerpC(c, SEASAND, (1 - ed / 0.38) * 0.8);
        else if ((!nb || nbt === 0) && ed < 0.4) lerpC(c, BASE[0], (1 - ed / 0.4) * 0.5);
      } else if (nb && nbt === 1 && ed < 0.4) lerpC(c, BASE[1], (1 - ed / 0.4) * 0.45);
    }
    return { r: clamp01(c[0]), g: clamp01(c[1]), b: clamp01(c[2]) };
  }

  // Pure function of the tile: the Task 8 fog shell must call this too.
  function subdivisions(tile) {
    const t = tile.terrain;
    return t === 0 ? 2 : isWater(t) ? 3 : (tile.feature || isHills(t) || t === 12) ? 5 : 4;
  }

  // Bit d of the mask = edge shared with neighbour direction d, which spans
  // corners (5-d) and (6-d)%6. (Do NOT use corners d..d+1.)
  function riverEdges(tile) {
    const mask = tile.riverEdges | 0, c = hexCenter(tile.q, tile.r), out = [];
    for (let d = 0; d < 6; d++) {
      if (!(mask & (1 << d))) continue;
      const [x1, z1] = hexCorner(5 - d), [x2, z2] = hexCorner((6 - d) % 6);
      out.push({ edge: d, x1: c.x + x1, z1: c.z + z1, x2: c.x + x2, z2: c.z + z2 });
    }
    return out;
  }

  // ---- Fog ----
  const FOG = { VISIBLE: 0, REMEMBERED: 1, UNSEEN: 2 };

  // Tiles carry no fog fields; the game keeps Sets of indices, so callers
  // pass plain booleans.
  function fogOf(explored, visible, fogEnabled) {
    if (!fogEnabled) return FOG.VISIBLE;
    if (visible) return FOG.VISIBLE;
    if (explored) return FOG.REMEMBERED;
    return FOG.UNSEEN;
  }

  // The single gate every reveal passes through (tooltip, labels, yields).
  // Fails closed: any fog value other than VISIBLE or REMEMBERED is UNSEEN.
  function tileFacts(tile, fog) {
    const hidden = { terrain: null, feature: null, resource: null,
      improvement: null, city: null, units: [] };
    if (!tile || (fog !== FOG.VISIBLE && fog !== FOG.REMEMBERED)) return hidden;
    if (fog === FOG.REMEMBERED) {
      // Remembered ground: the land and what was built, never live state.
      // A city is reduced to identity fields; hp/production would be stale
      // or current secrets.
      const c = tile.city;
      return { terrain: tile.terrain, feature: tile.feature, resource: tile.resource,
        improvement: tile.improvement,
        city: c ? { name: c.name, q: c.q, r: c.r, ownerPlayer: c.ownerPlayer,
          owner: c.owner, isCapital: c.isCapital } : null,
        units: [] };
    }
    return { terrain: tile.terrain, feature: tile.feature, resource: tile.resource,
      improvement: tile.improvement, city: tile.city || null,
      units: Array.isArray(tile.units) ? tile.units.slice() : [] };
  }

  // ---- Overlays and camera ----
  const OV = { move: 0x4fc3f7, atk: 0xe53935, rng: 0xff9800, work: 0x66bb6a,
    lock: 0x3498db, dim: 0x000000, hover: 0xffffff };

  // One entry per tile, highest-priority category wins. Every tile passes
  // through fogAt: lighting an unexplored tile would reveal that ground exists.
  function overlayList(sel, fogAt) {
    if (!sel || !sel.kind) return [];
    const cats = [['attackTiles', OV.atk], ['rangedTiles', OV.rng], ['moveTiles', OV.move],
      ['lockedTiles', OV.lock], ['workedTiles', OV.work], ['dimTiles', OV.dim]];
    const seen = new Set(), out = [];
    for (const [key, color] of cats) {
      const tiles = sel[key];
      if (!Array.isArray(tiles)) continue;
      for (const t of tiles) {
        const k = t.q + ',' + t.r;
        if (seen.has(k) || fogAt(t.q, t.r) === FOG.UNSEEN) continue;
        seen.add(k);
        out.push({ q: t.q, r: t.r, color });
      }
    }
    return out;
  }

  // Keep the orbit target over the map plus a margin so coasts stay reachable.
  function clampTarget(x, z, cols, rows) {
    const M = 6;
    const maxX = (cols - 1) * 1.5, maxZ = rows * SQ3;
    return { x: Math.min(maxX + M, Math.max(-M, x)), z: Math.min(maxZ + M, Math.max(-M, z)) };
  }

  // ---- Game constants shared with the page ----
  // The single copy of the tile-yield rules and production costs. index.html
  // and render3d.js both read these, so the pills on the map and the numbers
  // in the tooltip cannot drift apart. Mirrors city.cairo / constants.cairo.
  const PROD_ITEM_COST = {
    1: 80, 2: 50, 3: 30, 4: 40, 5: 35, 6: 60,
    64: 60, 65: 65, 66: 80, 67: 90, 68: 100, 69: 90, 70: 80, 71: 150,
  };
  const FOOD_BY_TERRAIN = [1, 1, 2, 2, 1, 1, 0, 0, 1, 1, 0, 0, 0];   // Ocean..Mountain
  const PROD_BY_TERRAIN = [0, 0, 0, 1, 1, 2, 0, 1, 0, 1, 0, 1, 0];
  const GOLD_BY_TERRAIN = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  // Works on a tile or on the facts the fog gate returns: both carry terrain,
  // feature, resource and improvement. isCenter applies the city-centre floor.
  function tileYield(f, isCenter) {
    const t = f.terrain;
    let food = FOOD_BY_TERRAIN[t] || 0, prod = PROD_BY_TERRAIN[t] || 0, gold = GOLD_BY_TERRAIN[t] || 0;
    if (f.feature === 1) prod += 1;                                  // woods
    const res = f.resource;
    if (res === 1 || res === 2 || res === 3 || res === 5) food += 1; // wheat, rice, cattle, fish
    else if (res === 4 || res === 7 || res === 6) prod += 1;         // stone, iron, horses
    else if (res === 8) gold += 3;                                   // silver
    else if (res === 9 || res === 10) gold += 2;                     // silk, dyes
    const imp = f.improvement | 0;
    if (imp === 1) food += 1; else if (imp >= 2 && imp <= 5) prod += 1;
    if (isCenter) { if (food < 2) food = 2; if (prod < 1) prod = 1; }
    return { food, prod, gold };
  }

  const api = { PROD_ITEM_COST, tileYield, hexCenter, hexCorner, neighbor, hexDist, worldToHex,
    tileBase, tileAmp, heightAt, colorAt, subdivisions, riverEdges,
    FOG, fogOf, tileFacts, OV, overlayList, clampTarget };
  if (typeof window !== 'undefined') window.R3DCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
