// Cairo Civ — 3D renderer core (pure logic, no three.js dependency).
// Loads in the browser as window.R3DCore and in Node via module.exports.
// World units: one hex has circumradius 1. Flat-top hexes, odd-q offset
// coordinates, odd columns shifted DOWN. Vertex 0 is due east; edge i runs
// from vertex i to vertex (i+1)%6. x grows east, z grows south (down the map).
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
  // Indexed by edge (0-5): edge i connects vertex i to vertex (i+1)%6.
  // Each entry is the [dq, dr] offset of the neighbor across that edge.
  const EDGE_NEIGHBOR_EVEN = [
    [+1, -1], // edge 0 (v0->v1): upper-right
    [ 0, -1], // edge 1 (v1->v2): top
    [-1, -1], // edge 2 (v2->v3): upper-left
    [-1,  0], // edge 3 (v3->v4): lower-left
    [ 0, +1], // edge 4 (v4->v5): bottom
    [+1,  0], // edge 5 (v5->v0): lower-right
  ];
  const EDGE_NEIGHBOR_ODD = [
    [+1,  0], // edge 0 (v0->v1): upper-right
    [ 0, -1], // edge 1 (v1->v2): top
    [-1,  0], // edge 2 (v2->v3): upper-left
    [-1, +1], // edge 3 (v3->v4): lower-left
    [ 0, +1], // edge 4 (v4->v5): bottom
    [+1, +1], // edge 5 (v5->v0): lower-right
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

  const api = { hexCenter, hexCorner, neighbor, hexDist, worldToHex };
  if (typeof window !== 'undefined') window.R3DCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
