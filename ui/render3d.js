// Cairo Civ — 3D renderer. Bootstrap: scene, camera, lights, controls, WebGL
// guard and a dirty-flag render loop. Later tasks fill in terrain, units, etc.
(function () {
  'use strict';
  const C = window.R3DCore;

  let S = null;            // live session; null before init / after dispose
  let reducedMotion = false;
  try { reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* ignore */ }

  const FOV = 38;
  const MAX_POLAR = 1.3;   // radians from straight up; < PI/2 keeps the camera above ground

  function mapMid(cols, rows) {
    const c = C.hexCenter(cols - 1, rows - 1);
    return { x: ((cols - 1) * 1.5) / 2, z: c.z / 2 };
  }


  // ---- Terrain: merged chunks, water plane, river ribbons ----
  const CHUNK = 4;               // tiles per chunk side
  const WATER_LEVEL = 0.15;      // above coast floor (0.0), below land (0.25)
  // Wave amplitudes used by updateWater. Their sum is the highest crest the
  // sea ever reaches, which is what anything riding on the water must clear.
  const WAVE_A = 0.022, WAVE_B = 0.016, WAVE_CREST = WAVE_A + WAVE_B;
  const RIVER_W = 0.14;          // ribbon width in world units
  const AMBIENT_MS = 50;         // idle water tick (~20 fps); most frames stay unrendered
  const SKIRT_LAND = [0x6e / 255, 0x57 / 255, 0x3c / 255];
  const SKIRT_SEA = [0x16 / 255, 0x3a / 255, 0x52 / 255];
  // How far the terrain's own skirt hangs: to SKIRT_EDGE_Y where the map ends,
  // and SKIRT_STEP under the lower neighbour's base inland. The fog shell
  // reads SKIRT_EDGE_Y so its skirt cannot stop short of this cliff.
  const SKIRT_EDGE_Y = -1.2, SKIRT_STEP = 0.05;

  const tileAt = (q, r) => (q < 0 || r < 0 || q >= S.cols || r >= S.rows) ? null : (S.tileIdx.get(r * S.cols + q) || null);
  const chunkKey = (q, r) => Math.floor(r / CHUNK) * S.chunksX + Math.floor(q / CHUNK);

  // Re-read tiles and cities from the live state. The app replaces every tile
  // object on each refresh, so cached objects go stale; this runs on every
  // rebuild. Cities live in players[].cities, not on tiles, so the renderer
  // keeps its own Set of city tile indices and never writes into game state.
  function indexState(state) {
    S.tileIdx = new Map();
    for (const t of ((state && state.tiles) || [])) S.tileIdx.set(t.r * S.cols + t.q, t);
    S.cityTiles = new Set();
    const lists = [];
    if (state && Array.isArray(state.cities)) lists.push(state.cities);
    if (state && Array.isArray(state.players)) for (const p of state.players) if (p && Array.isArray(p.cities)) lists.push(p.cities);
    for (const l of lists) for (const c of l) S.cityTiles.add(c.r * S.cols + c.q);
  }

  // Append one tile's top surface and skirts. Only terrain-derived inputs are
  // read (heightAt/colorAt/neighbour terrain): no fog, no territory. Returns
  // the vertex range so a later task can cull or recolour per tile.
  function tileGeometryInto(src, pos, col) {
    // heightAt reads hasCity from its argument: give it a private copy so the
    // shared state object is never touched.
    const tile = Object.assign({}, src, { hasCity: S.cityTiles.has(src.r * S.cols + src.q) });
    const start = pos.length / 3;
    const lookup = tileAt;
    const cen = C.hexCenter(tile.q, tile.r);
    const N = C.subdivisions(tile);
    const v3 = (lx, lz) => { const x = cen.x + lx, z = cen.z + lz; return [x, C.heightAt(tile, x, z), z]; };
    const push = (a, b, c) => {
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      const o = ny < 0 ? [a, c, b] : [a, b, c];
      const k = C.colorAt(tile, (a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3, (a[1] + b[1] + c[1]) / 3, lookup);
      for (const p of o) { pos.push(p[0], p[1], p[2]); col.push(k.r, k.g, k.b); }
    };
    for (let e = 0; e < 6; e++) {
      const A = C.hexCorner(e), B = C.hexCorner((e + 1) % 6);
      const P = (i, j) => v3((A[0] * i + B[0] * j) / N, (A[1] * i + B[1] * j) / N);
      for (let i = 0; i < N; i++) for (let j = 0; j < N - i; j++) {
        push(P(i, j), P(i + 1, j), P(i, j + 1));
        if (j < N - 1 - i) push(P(i + 1, j), P(i + 1, j + 1), P(i, j + 1));
      }
    }
    // Heights are NOT continuous across terrain changes (ocean -0.35, land
    // 0.25): each tile ends at its own tileBase on every edge. A skirt closes
    // the step only where the neighbour is lower or the map ends.
    const base = C.tileBase(tile), sk = tile.terrain <= 1 ? SKIRT_SEA : SKIRT_LAND;
    for (let d = 0; d < 6; d++) {
      const [nq, nr] = C.neighbor(tile.q, tile.r, d), nb = tileAt(nq, nr);
      const nbBase = nb ? C.tileBase(nb) : null;
      if (nb && nbBase >= base - 0.001) continue;
      const yb = nb ? nbBase - SKIRT_STEP : SKIRT_EDGE_Y;
      const [ax, az] = C.hexCorner(5 - d), [bx, bz] = C.hexCorner((6 - d) % 6);
      const x1 = cen.x + ax, z1 = cen.z + az, x2 = cen.x + bx, z2 = cen.z + bz;
      const ox = (ax + bx) / 2, oz = (az + bz) / 2;     // outward direction
      const q = [[x1, base, z1], [x2, base, z2], [x2, yb, z2], [x1, yb, z1]];
      const tri = (a, b, c, shade) => {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const nx = uy * vz - uz * vy, nz = ux * vy - uy * vx;
        const o = (nx * ox + nz * oz > 0) ? [a, b, c] : [a, c, b];
        for (const p of o) { pos.push(p[0], p[1], p[2]); col.push(sk[0] * shade, sk[1] * shade, sk[2] * shade); }
      };
      tri(q[0], q[1], q[2], 1); tri(q[0], q[2], q[3], 0.75);
    }
    return { start, count: pos.length / 3 - start };
  }

  function buildChunk(cq, cr) {
    const pos = [], col = [], ranges = new Map();
    for (let r = cr * CHUNK; r < Math.min(S.rows, (cr + 1) * CHUNK); r++)
      for (let q = cq * CHUNK; q < Math.min(S.cols, (cq + 1) * CHUNK); q++) {
        const t = tileAt(q, r);
        if (t) ranges.set(r * S.cols + q, tileGeometryInto(t, pos, col));
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return { g, ranges };
  }

  function rebuildChunk(cq, cr) {
    const key = cr * S.chunksX + cq, built = buildChunk(cq, cr);
    let ch = S.chunks[key];
    if (!ch) {
      const mesh = new THREE.Mesh(built.g, S.terrainMat);
      mesh.castShadow = true; mesh.receiveShadow = true;   // frustumCulled stays true
      S.scene.add(mesh);
      ch = S.chunks[key] = { mesh, version: 0, ranges: null, cq, cr };
    } else {
      ch.mesh.geometry.dispose();
      ch.mesh.geometry = built.g;
    }
    ch.ranges = built.ranges;   // tile index -> {start,count} vertex range
    ch.version++;
  }

  function buildWater() {
    const W = S.cols * 1.5 + 16, H = S.rows * Math.sqrt(3) + 16;
    const geo = new THREE.PlaneGeometry(W, H, Math.round(W * 1.5), Math.round(H * 1.5)).rotateX(-Math.PI / 2);
    const base = Float32Array.from(geo.attributes.position.array);
    // depthWrite: false is load-bearing. The sea sits above the seabed and
    // draws BEFORE the fog shell (renderOrder 0 vs 6); a depth-writing sea
    // makes the shell fail the depth test over unexplored ocean and the seabed
    // shows through (leak 11, measured at 225k pixels at the map rim).
    const mat = new THREE.MeshStandardMaterial({ color: '#2b86b6', transparent: true, opacity: 0.74,
      roughness: 0.12, metalness: 0.15, flatShading: true, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    const mid = mapMid(S.cols, S.rows);
    mesh.position.set(mid.x, WATER_LEVEL, mid.z);
    mesh.receiveShadow = true;
    S.scene.add(mesh);
    S.water = { mesh, geo, base, mat };
    updateWater(0);
  }

  function updateWater(t) {
    const w = S.water; if (!w) return;
    const p = w.geo.attributes.position.array, b = w.base;
    for (let i = 0; i < p.length; i += 3) {
      const x = b[i], z = b[i + 2];
      p[i + 1] = WAVE_A * Math.sin(x * 1.6 + t * 1.3) + WAVE_B * Math.sin(z * 2.1 - t * 1.1 + x * 0.4);
    }
    w.geo.attributes.position.needsUpdate = true;
  }

  function riverTexture() {
    const cv = document.createElement('canvas'); cv.width = 32; cv.height = 128;
    const g = cv.getContext('2d');
    for (let x = 0; x < 32; x++) {            // alpha falls off toward both banks
      const e = Math.sin((x + 0.5) / 32 * Math.PI);
      g.fillStyle = 'rgba(70,160,210,' + (0.15 + 0.75 * Math.min(1, e * 1.6)).toFixed(3) + ')';
      g.fillRect(x, 0, 1, 128);
    }
    g.fillStyle = 'rgba(230,246,255,0.55)';   // streaks that make the scroll visible
    for (let i = 0; i < 9; i++) g.fillRect(8 + ((i * 7) % 16), (i * 29) % 128, 2, 16);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // One merged ribbon mesh for every river on the map. Segments come from
  // riverEdges (already in world space, on the correct corners). An edge is
  // stored on both tiles that share it; geometry is deduped, ownership is not.
  function buildRivers() {
    const segs = new Map();   // dedupe key -> {seg, y, owners:Set}
    for (const t of S.tileIdx.values()) {
      if (!t.riverEdges) continue;
      for (const sg of C.riverEdges(t)) {
        const a = sg.x1.toFixed(3) + ',' + sg.z1.toFixed(3), b = sg.x2.toFixed(3) + ',' + sg.z2.toFixed(3);
        const key = a < b ? a + '|' + b : b + '|' + a;
        let e = segs.get(key);
        if (!e) {
          const [nq, nr] = C.neighbor(t.q, t.r, sg.edge), nb = tileAt(nq, nr);
          const y = Math.max(C.tileBase(t), nb ? C.tileBase(nb) : -9) + 0.03;
          e = { seg: sg, y, owners: new Set() };
          segs.set(key, e);
        }
        e.owners.add(t.r * S.cols + t.q);
      }
    }
    S.riverOwners = new Map(); S.riverSegs = [];
    if (!segs.size) return;
    const pos = [], uv = [], idx = [];
    let n = 0, vi = 0;
    for (const e of segs.values()) {
      const sg = e.seg;
      let dx = sg.x2 - sg.x1, dz = sg.z2 - sg.z1;
      const len = Math.hypot(dx, dz); dx /= len; dz /= len;
      const ex = dx * RIVER_W / 2, ez = dz * RIVER_W / 2;     // extend ends to cover corner joints
      const nx = -dz * RIVER_W / 2, nz = dx * RIVER_W / 2;
      const x1 = sg.x1 - ex, z1 = sg.z1 - ez, x2 = sg.x2 + ex, z2 = sg.z2 + ez;
      const y = e.y + (n++ % 8) * 0.0004;                     // break coplanar ties at overlaps
      pos.push(x1 - nx, y, z1 - nz, x1 + nx, y, z1 + nz, x2 + nx, y, z2 + nz, x2 - nx, y, z2 - nz);
      const v = (len + RIVER_W) * 2.2;
      uv.push(0, 0, 1, 0, 1, v, 0, v);
      idx.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);       // CCW seen from above
      vi += 4;
      S.riverSegs.push({ owners: e.owners, vi: vi - 4 });
      for (const o of e.owners) S.riverOwners.set(o, (S.riverOwners.get(o) || 0) + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const tex = riverTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false,
      roughness: 0.2, metalness: 0.1, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    S.scene.add(mesh);
    S.river = { mesh, geo: g, mat, tex };
  }

  function disposeTerrain() {
    for (const ch of S.chunks) if (ch) { S.scene.remove(ch.mesh); ch.mesh.geometry.dispose(); }
    S.chunks = [];
    if (S.water) { S.scene.remove(S.water.mesh); S.water.geo.dispose(); S.water.mat.dispose(); S.water = null; }
    if (S.river) { S.scene.remove(S.river.mesh); S.river.geo.dispose(); S.river.mat.dispose(); S.river.tex.dispose(); S.river = null; }
  }

  // Scrolling and waves; called only when a frame is about to be drawn.
  function animateSurfaces(now) {
    const t = now / 1000;
    updateWater(t);
    if (S.river) S.river.tex.offset.y = -t * 0.35;
  }


  // ---- Scenery: features, peaks, resources, improvements ----
  // Every prop is an instance in a bucket keyed (shape, colour): one draw call
  // per bucket however many trees stand in it. Each InstancedMesh remembers
  // the tile of every instance and a copy of its base matrices, so fog can
  // hide and restore single instances without rebuilding anything.
  const SCENERY_SEED = 77215;
  const PINE = ['#2f5d34', '#356b3a', '#2a5230'], LEAF = ['#5d9a3c', '#6aa845', '#4f8a34'], JUNGLE = ['#2e6a2c', '#3c7b33', '#285e2a'];
  const TUFT = ['#5f9440', '#6e9e44', '#8c9a46'], REED = ['#7c8a3c', '#8f9a48', '#6a7a34'], BLOOM = ['#c0566b', '#7a5ec0', '#d98a3a'];
  const PROP_SHAPES = new Set(['tuft', 'reed', 'rock']);
  const APOTHEM = Math.sqrt(3) / 2;
  const isWaterT = (t) => t <= 1;
  const isHillsT = (t) => t === 3 || t === 5 || t === 7 || t === 9 || t === 11;

  function makeSceneryGeo() {
    const G = THREE, T = (g, x, y, z) => g.translate(x, y, z);
    return {
      trunk: T(new G.CylinderGeometry(0.014, 0.022, 0.12, 5), 0, 0.06, 0),
      cone1: T(new G.ConeGeometry(0.11, 0.2, 7), 0, 0.18, 0),
      cone2: T(new G.ConeGeometry(0.08, 0.16, 7), 0, 0.28, 0),
      blob: T(new G.IcosahedronGeometry(0.11, 0), 0, 0.2, 0),
      blob2: T(new G.IcosahedronGeometry(0.08, 0), 0.05, 0.27, 0.02),
      jtrunk: T(new G.CylinderGeometry(0.014, 0.022, 0.2, 5), 0, 0.1, 0),
      rock: new G.DodecahedronGeometry(0.04, 0),
      tuft: new G.IcosahedronGeometry(0.055, 0),
      reed: T(new G.CylinderGeometry(0.004, 0.005, 0.09, 3), 0, 0.045, 0),
      peak: new G.ConeGeometry(0.5, 1.4, 7),
      snow: T(new G.ConeGeometry(0.19, 0.42, 7), 0, 0.5, 0),
      wheat: T(new G.ConeGeometry(0.028, 0.1, 4), 0, 0.05, 0),
      rice: T(new G.CylinderGeometry(0.006, 0.008, 0.08, 3), 0, 0.04, 0),
      beast: T(new G.BoxGeometry(0.07, 0.055, 0.13), 0, 0.055, 0),
      ore: new G.DodecahedronGeometry(0.042, 0),
      gem: new G.OctahedronGeometry(0.034, 0),
      fish: new G.ConeGeometry(0.03, 0.07, 3).rotateX(-Math.PI / 2),
      bush: T(new G.IcosahedronGeometry(0.055, 0), 0, 0.05, 0),
      bloom: T(new G.IcosahedronGeometry(0.026, 0), 0, 0.06, 0),
      row: new G.BoxGeometry(0.3, 0.014, 0.04),
      stalk: T(new G.ConeGeometry(0.012, 0.05, 4), 0, 0.03, 0),
      post: T(new G.BoxGeometry(0.016, 0.075, 0.016), 0, 0.038, 0),
      beam: new G.BoxGeometry(0.18, 0.016, 0.016),
      shaft: T(new G.BoxGeometry(0.15, 0.11, 0.08), 0, 0.055, 0),
      slab: T(new G.BoxGeometry(0.1, 0.03, 0.07), 0, 0.015, 0),
      log: new G.CylinderGeometry(0.02, 0.02, 0.14, 6).rotateZ(Math.PI / 2),
    };
  }

  // Which shapes draw each resource and improvement. Presence of an entry is
  // what hasResourceArt / hasImprovementArt report; the placement code below
  // consumes the same tables, so an entry here cannot silently go unused.
  const RESOURCE_ART = {
    1: { shape: 'wheat', colors: ['#e2c35a'] },
    2: { shape: 'rice', colors: ['#8fbf5a'], multi: 4 },
    3: { shape: 'beast', colors: ['#efe9dd'] },
    4: { shape: 'ore', colors: ['#a9a69d'] },
    5: { shape: 'fish', colors: ['#6fc6d8'], water: true },
    6: { shape: 'beast', colors: ['#7a4e2c'] },
    7: { shape: 'ore', colors: ['#6b6b72'] },
    8: { shape: 'gem', colors: ['#d8dbe0'] },
    9: { shape: 'bush', colors: ['#b9d16a'] },
    10: { shape: 'bloom', colors: BLOOM, pick: true },
  };
  const IMPROVEMENT_ART = { 1: ['row', 'stalk'], 2: ['shaft', 'post', 'beam'], 3: ['slab'], 4: ['post'], 5: ['log'] };

  function sceneryRng(idx) {      // mulberry32, one stream per tile: order-independent and reload-stable
    let a = (Math.imul(idx + 1, 0x9E3779B1) ^ SCENERY_SEED) | 0;
    const f = () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    return f;
  }

  // Rejection-sample points inside a hex, clear of its edges and each other.
  // avoid entries are [lx, lz, radius]. Returns world-space {x, y, z}.
  function scatter(tile, cen, rnd, count, minD, maxR, pad, avoid) {
    maxR = maxR === undefined ? 0.78 : maxR; pad = pad === undefined ? 0.1 : pad; avoid = avoid || [];
    const pts = [];
    for (let tries = 0; pts.length < count && tries < 300; tries++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * maxR, lx = Math.cos(a) * d, lz = Math.sin(a) * d;
      let ok = true;
      for (let e = 0; e < 6 && ok; e++) {       // edge normals sit at 30 + 60e degrees
        const ang = (30 + 60 * e) * Math.PI / 180;
        if (APOTHEM - (lx * Math.cos(ang) + lz * Math.sin(ang)) < pad) ok = false;
      }
      for (const p of pts.concat(avoid)) if (ok && Math.hypot(p[0] - lx, p[1] - lz) < (p[2] || minD)) ok = false;
      if (ok) pts.push([lx, lz]);
    }
    return pts.map(([lx, lz]) => ({ lx, lz, x: cen.x + lx, z: cen.z + lz, y: C.heightAt(tile, cen.x + lx, cen.z + lz) }));
  }

  function buildScenery() {
    const buckets = new Map();
    let key = 0;
    const inst = (shape, color, x, y, z, s, ry, sy, rx) => {
      const k = shape + '|' + color;
      let b = buckets.get(k);
      if (!b) buckets.set(k, b = { shape, color, list: [] });
      b.list.push({ x, y, z, s, ry: ry || 0, sy: sy || s, rx: rx || 0, tile: key });
    };
    const tree = (p, s, ry, rnd, kind) => {
      inst('trunk', '#6b4a2e', p.x, p.y - 0.01, p.z, s, ry);
      if (kind === 'pine' || (kind === 'mixed' && rnd() < 0.6)) {
        const c = rnd.pick(PINE); inst('cone1', c, p.x, p.y - 0.01, p.z, s, ry); inst('cone2', c, p.x, p.y - 0.01, p.z, s, ry);
      } else { const c = rnd.pick(LEAF); inst('blob', c, p.x, p.y - 0.01, p.z, s, ry); inst('blob2', c, p.x, p.y - 0.01, p.z, s, ry); }
    };
    const tiles = Array.from(S.tileIdx.values()).sort((a, b) => (a.r * S.cols + a.q) - (b.r * S.cols + b.q));
    for (const t of tiles) {
      key = t.r * S.cols + t.q;
      if (S.cityTiles.has(key)) continue;           // cities clear their own ground
      const rnd = sceneryRng(key), cen = C.hexCenter(t.q, t.r), tt = t.terrain, f = t.feature | 0;
      const sc = (n, d, mr, pad, av) => scatter(t, cen, rnd, n, d, mr, pad, av);
      if (!isWaterT(tt)) {
        if (f === 1) sc(9, 0.19).forEach((p) => { const s = 0.85 + rnd() * 0.5, ry = rnd() * 6; tree(p, s, ry, rnd, 'mixed'); });
        if (f === 2) sc(11, 0.17).forEach((p) => {
          const s = 0.9 + rnd() * 0.5, ry = rnd() * 6, c = rnd.pick(JUNGLE);
          inst('jtrunk', '#6b4a2e', p.x, p.y - 0.01, p.z, s, ry); inst('blob', c, p.x, p.y + 0.06, p.z, s, ry); inst('blob2', c, p.x, p.y + 0.08, p.z, s, ry);
        });
        if (f === 3) sc(10, 0.12, 0.75, 0.08).forEach((p) => {
          for (let k = 0; k < 4; k++) inst('reed', rnd.pick(REED), p.x + (rnd() - 0.5) * 0.05, p.y, p.z + (rnd() - 0.5) * 0.05, 0.8 + rnd() * 0.5, rnd() * 6);
        });
        if (f === 4) sc(4, 0.2, 0.5, 0.1, [[0, 0, 0.33]]).forEach((p) => {
          const s = 1.1;
          inst('jtrunk', '#8a6a44', p.x, p.y - 0.01, p.z, s, rnd() * 6); inst('blob', '#4f9a3a', p.x, p.y + 0.08, p.z, s, rnd() * 6);
        });
        if (!f && tt >= 2 && tt <= 5) sc(3, 0.28, 0.7, 0.14).forEach((p) => inst('tuft', rnd.pick(TUFT), p.x, p.y, p.z, 0.8 + rnd() * 0.5, rnd() * 6, 0.5));
        if (!f && (tt === 6 || tt === 7 || tt === 12)) sc(3, 0.3, 0.7, 0.14).forEach((p) => inst('rock', tt === 12 ? '#9a978f' : '#b89a68', p.x, p.y + 0.01, p.z, 0.7 + rnd() * 0.7, rnd() * 6));
        if (tt === 8 || tt === 9) sc(3, 0.3, 0.7, 0.14).forEach((p) => { const s = 0.6 + rnd() * 0.3; tree(p, s, rnd() * 6, rnd, 'pine'); });
        if (tt === 12) {
          [[0, -0.1, 0.5, 1.0], [-0.36, 0.24, 0.33, 0.62], [0.36, 0.24, 0.35, 0.7]].forEach(([dx, dz, rr, hh]) => {
            const x = cen.x + dx, z = cen.z + dz, y = C.heightAt(t, x, z), ry = rnd() * 6;
            inst('peak', '#857e70', x, y + hh * 1.4 / 2 - 0.06, z, rr / 0.5, ry, hh);
            if (hh > 0.8) inst('snow', '#f2f5f7', x, y + hh * 1.4 / 2 - 0.06, z, rr / 0.5 * 0.9, 0, hh);
          });
        }
      }
      // Resource art (fish floats on the sea surface, everything else on the ground).
      const res = RESOURCE_ART[t.resource | 0];
      if (res) {
        const wet = res.water && isWaterT(tt);
        sc(wet ? 3 : 4, wet ? 0.2 : 0.18, 0.6, 0.15).forEach((p) => {
          const s = 0.85 + rnd() * 0.5, ry = rnd() * 6, c = res.pick ? rnd.pick(res.colors) : res.colors[0];
          if (res.multi) for (let k = 0; k < res.multi; k++) inst(res.shape, c, p.x + (rnd() - 0.5) * 0.06, p.y, p.z + (rnd() - 0.5) * 0.06, s, ry);
          else inst(res.shape, c, p.x, wet ? WATER_LEVEL + 0.01 : p.y, p.z, s, ry);
        });
      }
      const imp = t.improvement | 0;
      if (imp >= 1 && imp <= 5 && !isWaterT(tt) && tt !== 12) {
        const cy = C.heightAt(t, cen.x, cen.z), c = { x: cen.x, y: cy, z: cen.z };
        if (imp === 1) {
          for (let i = -1; i <= 1; i++) {
            const z = cen.z + i * 0.22, y = C.heightAt(t, cen.x, z);
            inst('row', i % 2 ? '#a89a3a' : '#dcbc4c', cen.x, y + 0.005, z, 1, 0.2);
            for (let j = 0; j < 3; j++) inst('stalk', '#e2c35a', cen.x + (j - 1) * 0.1, y + 0.01, z, 1, 0);
          }
        } else if (imp === 2) {
          inst('shaft', '#1c1712', c.x, c.y, c.z, 1, rnd() * 6);
          inst('post', '#7a5634', c.x - 0.085, c.y, c.z + 0.05, 1.6, 0);
          inst('post', '#7a5634', c.x + 0.085, c.y, c.z + 0.05, 1.6, 0);
          inst('beam', '#7a5634', c.x, c.y + 0.125, c.z + 0.05, 1, 0);
        } else if (imp === 3) {
          sc(5, 0.14, 0.5, 0.18).forEach((p) => inst('slab', '#b6b2a8', p.x, p.y, p.z, 0.9 + rnd() * 0.5, rnd() * 6));
        } else if (imp === 4) {
          for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3, x = cen.x + Math.cos(a) * 0.42, z = cen.z + Math.sin(a) * 0.42;
            inst('post', '#8a6a44', x, C.heightAt(t, x, z), z, 1, a);
          }
        } else {
          sc(3, 0.2, 0.5, 0.18).forEach((p) => {
            for (let k = 0; k < 3; k++) inst('log', '#8a6040', p.x, p.y + 0.02 + (k === 2 ? 0.034 : 0), p.z + (k === 2 ? 0 : (k - 0.5) * 0.042), 1, p.x);
          });
        }
      }
    }
    const meshes = [], dummy = new THREE.Object3D();
    for (const b of buckets.values()) {
      let mat = S.sceneryMats.get(b.color);
      if (!mat) S.sceneryMats.set(b.color, mat = new THREE.MeshStandardMaterial({ color: b.color, flatShading: true, roughness: 0.85, metalness: 0 }));
      const m = new THREE.InstancedMesh(S.sceneryGeo[b.shape], mat, b.list.length);
      m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;   // instances span the map; per-mesh bounds would be useless
      b.list.forEach((e, i) => {
        dummy.position.set(e.x, e.y, e.z); dummy.rotation.set(e.rx, e.ry, 0); dummy.scale.set(e.s, e.sy, e.s);
        dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix);
      });
      m.instanceMatrix.needsUpdate = true;
      m.userData.shape = b.shape;
      registerFogHideable(m, b.list.map((e) => e.tile));
      S.scene.add(m);
      meshes.push(m);
    }
    S.scenery = meshes;
    if (S.sceneryHide) applyFogToScenery();
  }

  // tileList[i] is the tile index (r * cols + q) instance i stands on. The
  // base matrices are copied so a hidden instance can be restored exactly.
  function registerFogHideable(mesh, tileList) {
    if (!mesh || !mesh.instanceMatrix || !tileList || tileList.length !== mesh.count)
      throw new Error('registerFogHideable: need an InstancedMesh and one tile per instance');
    mesh.userData.tiles = tileList.slice();
    mesh.userData.baseMat = new Float32Array(mesh.instanceMatrix.array);
    if (S) S.fogHideable.push(mesh);
  }

  // hide(q, r) -> true hides everything standing on that tile. Passing a rule
  // sets it and it is remembered across scenery rebuilds; calling with no
  // argument re-applies the current rule (no rule means everything shows).
  // Nothing calls this on its own: the fog task owns the rule.
  function applyFogToScenery(hide) {
    if (!S) return;
    if (typeof hide === 'function') S.sceneryHide = hide;
    const rule = S.sceneryHide, memo = new Map();   // one rule call per tile, not per instance
    for (const m of S.fogHideable) {
      const tl = m.userData.tiles, base = m.userData.baseMat, arr = m.instanceMatrix.array;
      for (let i = 0; i < tl.length; i++) {
        let hidden = false;
        if (rule) {
          hidden = memo.get(tl[i]);
          if (hidden === undefined) memo.set(tl[i], hidden = !!rule(tl[i] % S.cols, Math.floor(tl[i] / S.cols)));
        }
        const o = i * 16;
        if (hidden) { for (let k = 0; k < 16; k++) arr[o + k] = 0; arr[o + 15] = 1; }
        else for (let k = 0; k < 16; k++) arr[o + k] = base[o + k];
      }
      m.instanceMatrix.needsUpdate = true;
    }
    requestRender();
  }

  function disposeScenery() {
    for (const m of S.scenery) { S.scene.remove(m); m.dispose(); }
    S.scenery = []; S.fogHideable = [];
    for (const mat of S.sceneryMats.values()) mat.dispose();
    S.sceneryMats = new Map();
  }

  // Test-only readers over the real built instances.
  function eachInstance(fn) {
    for (const m of S.scenery) {
      const tl = m.userData.tiles, base = m.userData.baseMat, arr = m.instanceMatrix.array;
      for (let i = 0; i < m.count; i++) fn(m, i, tl[i], base, arr);
    }
  }
  const RES_SHAPES = new Set(Object.values(RESOURCE_ART).map((a) => a.shape));
  const IMP_SHAPES = new Set([].concat(...Object.values(IMPROVEMENT_ART)));

  // ---- Fog of war ----
  // Decision 12. In 2D a dark hex hides everything in it; in 3D it hides
  // nothing. Terrain has height, so a hill rises straight through a flat sheet
  // and shows both its shape and its colour — and its colour is its terrain
  // type. Fog is therefore a SHELL over the ground, built from the same
  // triangles at the same C.subdivisions(tile), lifted just clear of it, with
  // a skirt hanging off the rim to close the slot that lift leaves. Two
  // shells, one per fog state, so a tile is covered by exactly one of them;
  // two draw calls for the whole map.
  //
  // Built once. A fog change collapses or restores one tile's vertex range in
  // the existing buffer and touches only tiles whose state changed — fog moves
  // on nearly every unit step, so it must never rebuild geometry (Decision 9).
  // Only a TERRAIN change rebuilds the shell.
  const FOG_BIAS = 0.045;     // lift above the surface; much less and it z-fights
  const FOG_SKIRT = 1.0;      // least the rim wall hangs down behind the shell
  // ...but never above the terrain's own cliff. Where the map ends, the ground
  // drops to SKIRT_EDGE_Y, which is deeper than FOG_SKIRT reaches from a rim
  // at sea level: the fog skirt stopped short and half a unit of unexplored
  // coastline stood below it, telling the player where land ended and sea
  // began. Both numbers come from the same constant so they cannot drift.
  const FOG_SKIRT_FLOOR = SKIRT_EDGE_Y - 0.1;
  const FOG_REMEMBERED_COLOR = 0x0d1a2c, FOG_UNSEEN_COLOR = 0x05070d;

  // Transparent layers do not write depth, so sitting physically lower than
  // the fog does not put a layer behind it: draw order alone decides.
  // Unexplored fog draws after every overlay, ring and highlight as a
  // backstop; remembered fog draws before them so range highlights stay
  // readable on ground the player has already seen. Later layers take their
  // order from this table (and must stay below fogUnseen).
  // 'labels' is a reserved slot, not a layer: labels are DOM elements over the
  // canvas (Decision 5). It is here so nothing else claims 5.
  // Cities and units sit BELOW fogRemembered on purpose: with no depth writes,
  // draw order alone decides, and the remembered fog must be drawn over them.
  const RENDER_ORDER = { terrain: 0, grid: 1, territory: 1, borders: 1,
    cities: 1.2, unitDiscs: 1.25, unitRings: 1.3, units: 1.4, fogRemembered: 2,
    overlays: 3, rings: 4, fx: 4.5, labels: 5, fogUnseen: 6 };

  // The surface the player actually sees, which is not always the terrain
  // mesh: on water tiles the mesh is the seabed, well below the water plane,
  // so a shell built from it sits UNDER the sea and leaves unexplored ocean
  // and coast in plain view. Water clamps to just above the highest crest.
  function surfaceY(tile, x, z, lift) {
    let y = C.heightAt(tile, x, z);
    if (tile.terrain <= 1) y = Math.max(y, WATER_LEVEL + WAVE_CREST);
    return y + lift;
  }
  const fogSurfaceY = (tile, x, z) => surfaceY(tile, x, z, FOG_BIAS);

  // The same wedge triangles tileGeometryInto builds, at the same subdivision
  // level, plus a rim skirt. Winding is irrelevant: the shells are DoubleSide.
  function fogTileInto(src, pos) {
    // heightAt reads hasCity from its argument: a private copy, never the
    // shared tile, and the same copy the ground was built from so the shell
    // follows a city's levelled ground instead of floating over it.
    const tile = Object.assign({}, src, { hasCity: S.cityTiles.has(src.r * S.cols + src.q) });
    const cen = C.hexCenter(tile.q, tile.r), N = C.subdivisions(tile);
    const start = pos.length / 3;
    const v = (lx, lz) => { const x = cen.x + lx, z = cen.z + lz; pos.push(x, fogSurfaceY(tile, x, z), z); };
    for (let e = 0; e < 6; e++) {
      const A = C.hexCorner(e), B = C.hexCorner((e + 1) % 6);
      const P = (i, j) => [(A[0] * i + B[0] * j) / N, (A[1] * i + B[1] * j) / N];
      for (let i = 0; i < N; i++) for (let j = 0; j < N - i; j++) {
        const a = P(i, j), b = P(i + 1, j), c = P(i, j + 1);
        v(a[0], a[1]); v(b[0], b[1]); v(c[0], c[1]);
        if (j < N - 1 - i) { const d = P(i + 1, j + 1); v(b[0], b[1]); v(d[0], d[1]); v(c[0], c[1]); }
      }
    }
    const topCount = pos.length / 3 - start;
    // The lift leaves a slot around the rim that a low camera looks straight
    // into — at coasts it showed the yellow beach around every unexplored
    // tile. A wall hanging off the rim closes it; inland it is buried in the
    // neighbouring ground, at a coast or cliff it reads as the edge of the
    // unknown.
    for (let e = 0; e < 6; e++) {
      const A = C.hexCorner(e), B = C.hexCorner((e + 1) % 6);
      const ax = cen.x + A[0], az = cen.z + A[1], ay = fogSurfaceY(tile, ax, az);
      const bx = cen.x + B[0], bz = cen.z + B[1], by = fogSurfaceY(tile, bx, bz);
      const ya = Math.min(ay - FOG_SKIRT, FOG_SKIRT_FLOOR), yb = Math.min(by - FOG_SKIRT, FOG_SKIRT_FLOOR);
      pos.push(ax, ay, az, bx, by, bz, bx, yb, bz);
      pos.push(ax, ay, az, bx, yb, bz, ax, ya, az);
    }
    return { start, count: pos.length / 3 - start, topCount };
  }

  function buildFogShell() {
    disposeFog();
    const pos = [], ranges = new Map();
    const tiles = Array.from(S.tileIdx.values()).sort((a, b) => (a.r * S.cols + a.q) - (b.r * S.cols + b.q));
    for (const t of tiles) ranges.set(t.r * S.cols + t.q, fogTileInto(t, pos));
    const base = Float32Array.from(pos);
    const layer = (color, opacity, order, name) => {
      const g = new THREE.BufferGeometry();
      // Starts fully collapsed: nothing is hidden until the fog says so.
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(base.length), 3));
      // The rim skirt shares its plane with the terrain skirt Task 6 hangs off
      // the same two corners, and a coplanar surface drawn later loses the
      // depth test in patches: at an unexplored coast the brown cliff showed
      // straight through the fog. The offset biases the fog's depth toward the
      // camera so it always wins where the two planes meet. It writes no
      // depth, so nothing else is affected.
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity,
        depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;      // collapsed tiles sit at the origin and ruin the bounds
      mesh.raycast = () => {};         // picking must reach the ground through the fog
      mesh.renderOrder = order;
      S.scene.add(mesh);
      S.layers[name] = mesh;
      return { mesh, mat, geo: g, attr: g.attributes.position, arr: g.attributes.position.array };
    };
    S.fog = { base, ranges, writes: 0,
      state: new Int8Array(S.cols * S.rows).fill(-1),   // -1: nothing written yet
      remembered: layer(FOG_REMEMBERED_COLOR, 0.6, RENDER_ORDER.fogRemembered, 'fogRemembered'),
      unseen: layer(FOG_UNSEEN_COLOR, 0.995, RENDER_ORDER.fogUnseen, 'fogUnseen') };
  }

  function disposeFog() {
    if (!S || !S.fog) return;
    for (const k of ['remembered', 'unseen']) {
      const l = S.fog[k];
      S.scene.remove(l.mesh); l.geo.dispose(); l.mat.dispose();
    }
    delete S.layers.fogRemembered; delete S.layers.fogUnseen;
    S.fog = null;
  }

  // Raise or collapse one tile's range of one shell. Restoring copies the
  // built surface back float for float; collapsing zeroes it, which leaves
  // degenerate triangles at the origin that draw nothing.
  function writeShell(layer, rg, on) {
    const o = rg.start * 3, n = rg.count * 3;
    if (on) layer.arr.set(S.fog.base.subarray(o, o + n), o);
    else layer.arr.fill(0, o, o + n);
  }

  // The gate every fog decision passes through. Fails closed: a lookup that
  // returns anything unexpected is treated as never explored.
  function fogStateAt(q, r) {
    const v = S ? S.fogAt(q, r) : C.FOG.UNSEEN;
    if (v === C.FOG.VISIBLE) return C.FOG.VISIBLE;
    if (v === C.FOG.REMEMBERED) return C.FOG.REMEMBERED;
    return C.FOG.UNSEEN;
  }

  // One stable reference, so refreshFog can tell its own rule from another's.
  function fogHidesScenery(q, r) { return fogStateAt(q, r) === C.FOG.UNSEEN; }

  // Writes the shells to match the current fog. Returns how many tiles moved.
  function applyFogShell() {
    const f = S.fog;
    let changed = 0;
    for (const [idx, rg] of f.ranges) {
      const q = idx % S.cols, r = (idx - q) / S.cols, v = fogStateAt(q, r);
      if (f.state[idx] === v) continue;
      f.state[idx] = v;
      writeShell(f.remembered, rg, v === C.FOG.REMEMBERED);
      writeShell(f.unseen, rg, v === C.FOG.UNSEEN);
      f.writes++;
      changed++;
    }
    if (changed) { f.remembered.attr.needsUpdate = true; f.unseen.attr.needsUpdate = true; }
    return changed;
  }

  // One tile's ground changed shape (a city founded, a feature cleared), so
  // the shell over it is stale. Patch that tile's vertices in place while it
  // still has the same number of them — a full rebuild is a whole-map height
  // pass (~230k vertices, measured at ~65ms). Clearing a feature changes the
  // tile's subdivision level, and then its range changes length and only a
  // rebuild will do.
  function refreshFogTile(q, r) {
    if (!S) return;
    const t = S.fog && tileAt(q, r), rg = S.fog && S.fog.ranges.get(r * S.cols + q);
    const pos = [];
    if (!t || !rg || fogTileInto(t, pos).count !== rg.count) {
      buildFogShell();
    } else {
      S.fog.base.set(pos, rg.start * 3);
      const v = S.fog.state[r * S.cols + q];
      writeShell(S.fog.remembered, rg, v === C.FOG.REMEMBERED);
      writeShell(S.fog.unseen, rg, v === C.FOG.UNSEEN);
      S.fog.remembered.attr.needsUpdate = true;
      S.fog.unseen.attr.needsUpdate = true;
    }
    applyFogShell();
  }

  // Fog changed (a unit moved, a turn resolved, the fog toggle flipped).
  function refreshFog() {
    if (!S || !S.fog) return;
    const changed = applyFogShell();
    // Fog hides objects, not just ground: trees, rocks and improvements stand
    // straight up through a ground layer unless their instances are culled.
    if (changed || S.sceneryHide !== fogHidesScenery) applyFogToScenery(fogHidesScenery);
    S.hoverTile = null;      // the tooltip must re-read its tile under the new fog
    if (changed) { updateMarks(); updatePieces(); requestRender(); }
  }

  // Test-only reader over the live buffer: 'live' means this tile's range
  // matches the built surface float for float, 'collapsed' means every float
  // is zero. Anything else ('mixed') is a half-written shell, which would
  // leave the tile partly uncovered.
  function fogShellState(layer, q, r) {
    const f = S && S.fog, l = f && f[layer], rg = f && f.ranges.get(r * S.cols + q);
    if (!l || !rg) return 'none';
    const o = rg.start * 3, n = rg.count * 3;
    let live = true, collapsed = true;
    for (let i = o; i < o + n; i++) {
      if (l.arr[i] !== f.base[i]) live = false;
      if (l.arr[i] !== 0) collapsed = false;
      if (!live && !collapsed) return 'mixed';
    }
    return live ? 'live' : 'collapsed';
  }

  function fogRange(q, r) { return (S && S.fog) ? (S.fog.ranges.get(r * S.cols + q) || null) : null; }

  // ---- Marks: hex edges, tile overlays, territory, selection and hover rings ----
  // Everything here sits above the ground, so every layer is transparent and
  // writes no depth (an opaque layer would draw in the opaque pass and pass the
  // depth test against the fog shell 0.045 over the ground: leak 3). Ordering
  // comes from RENDER_ORDER and stays below fogUnseen. Anything that could
  // tell the player what a tile holds is ALSO filtered through fogStateAt, so
  // ordering is never the only thing between the player and unexplored ground.
  //
  // Geometry rule: every mark that covers ground is built from the SAME
  // triangles as the ground and the fog shell, lifted by less than the shell's
  // own 0.045 (surfaceY). It therefore lies under the shell at every point and
  // never pokes past the shell's silhouette on a hill. A flat disc at the
  // tile's crest did exactly that.
  const GRID_NEAR = 14, GRID_FAR = 56, GRID_MAX = 0.5;   // camera distance at which the lines start/finish fading
  const GRID_W = 0.035, BORDER_W = 0.09, RING_W = 0.07, HOVER_W = 0.04;
  const LIFT = { grid: 0.02, border: 0.025, territory: 0.01, overlay: 0.02, ring: 0.025 };
  const TERRITORY_FILL = [0x3498db, 0xe74c3c], TERRITORY_FALLBACK = 0xffffff;
  const BORDER_COLOR = [0x3498db, 0xe74c3c];
  const SELECT_COLOR = 0xfff3b0;
  const MARK_NAMES = ['grid', 'territory', 'borders', 'overlays', 'selRing', 'hoverRing'];

  const waterTop = () => WATER_LEVEL + WAVE_CREST;
  const tileCopy = (src) => Object.assign({}, src, { hasCity: S.cityTiles.has(src.r * S.cols + src.q) });
  const edgeBase = (t) => (t.terrain <= 1 ? Math.max(C.tileBase(t), waterTop()) : C.tileBase(t));

  // A flat quad along one segment. noExt keeps it inside the segment's ends.
  function ribbonInto(pos, idx, x1, z1, x2, z2, y, w, noExt) {
    let dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    const ex = noExt ? 0 : dx * w / 2, ez = noExt ? 0 : dz * w / 2, nx = -dz * w / 2, nz = dx * w / 2;
    const a = x1 - ex, b = z1 - ez, c = x2 + ex, d = z2 + ez, vi = pos.length / 3;
    pos.push(a - nx, y, b - nz, a + nx, y, b + nz, c + nx, y, d + nz, c - nx, y, d - nz);
    idx.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
  }

  // The tile's own ground triangles (same wedges, same subdivision as the fog
  // shell), lifted by `lift`, in one flat colour.
  function surfaceInto(src, pos, col, rgb, lift) {
    const tile = tileCopy(src), cen = C.hexCenter(tile.q, tile.r), N = C.subdivisions(tile);
    const start = pos.length / 3;
    const v = (lx, lz) => { const x = cen.x + lx, z = cen.z + lz; pos.push(x, surfaceY(tile, x, z, lift), z); col.push(rgb.r, rgb.g, rgb.b); };
    for (let e = 0; e < 6; e++) {
      const A = C.hexCorner(e), B = C.hexCorner((e + 1) % 6);
      const P = (i, j) => [(A[0] * i + B[0] * j) / N, (A[1] * i + B[1] * j) / N];
      for (let i = 0; i < N; i++) for (let j = 0; j < N - i; j++) {
        const a = P(i, j), b = P(i + 1, j), c = P(i, j + 1);
        v(a[0], a[1]); v(b[0], b[1]); v(c[0], c[1]);
        if (j < N - 1 - i) { const d = P(i + 1, j + 1); v(b[0], b[1]); v(d[0], d[1]); v(c[0], c[1]); }
      }
    }
    return pos.length / 3 - start;
  }

  // A strip along hex edge A-B between two scales of the hex, every vertex on
  // the tile's own ground so it hugs slopes and stays inside the tile.
  function stripInto(pos, idx, src, e, f0, f1, lift) {
    const tile = tileCopy(src), cen = C.hexCenter(tile.q, tile.r);
    const A = C.hexCorner(e), B = C.hexCorner((e + 1) % 6), K = 4;
    for (let i = 0; i <= K; i++) {
      const t = i / K, px = A[0] + (B[0] - A[0]) * t, pz = A[1] + (B[1] - A[1]) * t;
      for (const f of [f0, f1]) { const x = cen.x + px * f, z = cen.z + pz * f; pos.push(x, surfaceY(tile, x, z, lift), z); }
      if (i) { const v = pos.length / 3 - 4; idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
    }
  }
  const inset = (w) => w / APOTHEM;       // scale change that moves an edge inward by w

  function markMaterial(opts) {
    return new THREE.MeshBasicMaterial(Object.assign({ transparent: true, depthWrite: false,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }, opts));
  }
  function markMesh(name, order, mat) {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    mesh.frustumCulled = false; mesh.raycast = () => {}; mesh.renderOrder = order; mesh.visible = false;
    S.scene.add(mesh); S.layers[name] = mesh;
    return mesh;
  }
  // Swap in new geometry. A layer with nothing to draw is not drawn at all.
  function setMark(name, pos, idx, col) {
    const M = S.marks, mesh = M[name], old = mesh.geometry, g = new THREE.BufferGeometry();
    if (pos.length) {
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      if (idx) g.setIndex(idx);
    }
    mesh.geometry = g; old.dispose();
    M.has[name] = pos.length > 0;
    applyMarkVisibility(name);
  }
  function applyMarkVisibility(name) { const M = S.marks; M[name].visible = !!M.has[name] && !M.hidden.has(name); }

  function buildMarks() {
    disposeMarks();
    const M = S.marks = { has: {}, hidden: new Set(), gridEdges: new Set(), gridSegments: 0, lit: [],
      litRanges: [], territoryCount: 0, borderSegments: 0, terrSig: null, selTile: null, hoverTileMark: null };
    M.grid = markMesh('grid', RENDER_ORDER.grid, markMaterial({ color: 0x0a1418, opacity: GRID_MAX }));
    M.territory = markMesh('territory', RENDER_ORDER.territory, markMaterial({ vertexColors: true, opacity: 0.16 }));
    M.borders = markMesh('borders', RENDER_ORDER.borders, markMaterial({ vertexColors: true, opacity: 0.85 }));
    M.overlays = markMesh('overlays', RENDER_ORDER.overlays, markMaterial({ vertexColors: true, opacity: 0.42 }));
    M.selRing = markMesh('selRing', RENDER_ORDER.rings, markMaterial({ color: SELECT_COLOR, opacity: 0.95 }));
    M.hoverRing = markMesh('hoverRing', RENDER_ORDER.rings, markMaterial({ color: C.OV.hover, opacity: 0.8 }));
    buildGrid();
    updateMarks();
  }

  function disposeMarks() {
    if (!S || !S.marks) return;
    for (const k of MARK_NAMES) {
      const m = S.marks[k];
      S.scene.remove(m); m.geometry.dispose(); m.material.dispose();
      delete S.layers[k];
    }
    S.marks = null;
  }

  // Terrain-driven: one merged ribbon along every hex edge that borders land,
  // shared edges drawn once. Edges between two water tiles are left out, so
  // open ocean stays clean (Decision 11). On the map perimeter the ribbon is
  // pulled inside the hex so it never hangs past the rim.
  function buildGrid() {
    const pos = [], idx = [], seen = new Set(), edges = S.marks.gridEdges;
    edges.clear();
    for (const t of S.tileIdx.values()) {
      const cen = C.hexCenter(t.q, t.r);
      for (let d = 0; d < 6; d++) {
        const [nq, nr] = C.neighbor(t.q, t.r, d), nb = tileAt(nq, nr);
        if (t.terrain <= 1 && (!nb || nb.terrain <= 1)) continue;
        const a = t.r * S.cols + t.q, b = nb ? nr * S.cols + nq : -1;
        const key = Math.min(a, b) + '|' + Math.max(a, b);
        if (seen.has(key)) continue;
        seen.add(key); edges.add(key);
        const A = C.hexCorner(5 - d), B = C.hexCorner((6 - d) % 6), f = nb ? 1 : 1 - inset(GRID_W / 2);
        ribbonInto(pos, idx, cen.x + A[0] * f, cen.z + A[1] * f, cen.x + B[0] * f, cen.z + B[1] * f,
          Math.max(edgeBase(t), nb ? edgeBase(nb) : -9) + LIFT.grid, GRID_W, !nb);
      }
    }
    S.marks.gridSegments = idx.length / 6;
    setMark('grid', pos, idx, null);
  }

  // Lines fade as the camera pulls back so a whole-map view is not a wire mesh.
  function updateGridFade() {
    if (!S || !S.marks) return;
    const d = S.camera.position.distanceTo(S.controls.target);
    S.marks.grid.material.opacity = GRID_MAX * (1 - Math.min(1, Math.max(0, (d - GRID_NEAR) / (GRID_FAR - GRID_NEAR))));
  }

  function ringInto(q, r, w, pos, idx) {
    const t = tileAt(q, r);
    for (let e = 0; e < 6; e++) stripInto(pos, idx, t, e, 0.92, 0.92 - inset(w), LIFT.ring);
  }
  // A ring is a hint at what is on a tile; unexplored ground gets none.
  function ringTile(name, q, r, w) {
    const ok = Number.isInteger(q) && Number.isInteger(r) && tileAt(q, r) && (S.unfiltered || fogStateAt(q, r) !== C.FOG.UNSEEN);
    const pos = [], idx = [];
    if (ok) ringInto(q, r, w, pos, idx);
    setMark(name, pos, idx, null);
    return ok ? { q, r } : null;
  }

  // State- and fog-driven: territory fill and borders, the overlays, the two
  // rings. Territory is the big one, so it is rebuilt only when its inputs
  // (which tiles, which owners, which edges) actually changed.
  function updateMarks() {
    if (!S || !S.marks) return;
    const M = S.marks, gate = S.unfiltered ? () => C.FOG.VISIBLE : fogStateAt;
    const ownerOf = (t) => (t && t.ownerCity > 0 ? t.ownerPlayer : -1);
    const owned = [], edgeList = [];
    for (const t of S.tileIdx.values()) {
      const p = ownerOf(t);
      if (p < 0 || gate(t.q, t.r) === C.FOG.UNSEEN) continue;
      owned.push(t);
      for (let d = 0; d < 6; d++) {
        const [nq, nr] = C.neighbor(t.q, t.r, d), nb = tileAt(nq, nr);
        // An unexplored neighbour always gets a border. Leaving it out when
        // the owner matches would tell the player the unscouted tile is theirs.
        if (nb && ownerOf(nb) === p && gate(nq, nr) !== C.FOG.UNSEEN) continue;
        edgeList.push([t, d, p]);
      }
    }
    const sig = owned.map((t) => t.q + ',' + t.r + ',' + ownerOf(t)).join(';') + '#' + edgeList.map((e) => e[0].q + ',' + e[0].r + ',' + e[1]).join(';');
    if (sig !== M.terrSig) {
      M.terrSig = sig;
      const tp = [], tc = [], c = new THREE.Color();
      for (const t of owned) {
        c.setHex(TERRITORY_FILL[ownerOf(t)] !== undefined ? TERRITORY_FILL[ownerOf(t)] : TERRITORY_FALLBACK);
        surfaceInto(t, tp, tc, c, LIFT.territory);
      }
      M.territoryCount = owned.length;
      setMark('territory', tp, null, tc);
      const bp = [], bi = [], bc = [];
      for (const [t, d, p] of edgeList) {
        const n0 = bp.length / 3;
        stripInto(bp, bi, t, 5 - d, 1, 1 - inset(BORDER_W), LIFT.border);
        c.setHex(BORDER_COLOR[p] !== undefined ? BORDER_COLOR[p] : TERRITORY_FALLBACK);
        for (let i = n0; i < bp.length / 3; i++) bc.push(c.r, c.g, c.b);
      }
      M.borderSegments = edgeList.length;
      setMark('borders', bp, bi, bc);
    }

    // Overlays: straight from overlayList, which drops every unexplored tile.
    const lit = C.overlayList(S.selection, gate), op = [], oc = [], c2 = new THREE.Color();
    M.litRanges = [];
    for (const o of lit) {
      const t = tileAt(o.q, o.r);
      if (!t) continue;
      const start = op.length / 3;
      surfaceInto(t, op, oc, c2.setHex(o.color), LIFT.overlay);
      M.litRanges.push({ start, count: op.length / 3 - start, q: o.q, r: o.r });
    }
    M.lit = lit;
    setMark('overlays', op, null, oc);

    const sel = S.selection;
    M.selTile = sel && sel.kind ? ringTile('selRing', sel.q, sel.r, RING_W) : ringTile('selRing', null, null, RING_W);
    M.hoverTileMark = S.hover ? ringTile('hoverRing', S.hover.q, S.hover.r, HOVER_W) : ringTile('hoverRing', null, null, HOVER_W);
    requestRender();
  }

  // Centre of a layer's real vertices, so a test can see where it was drawn.
  function ringCentre(mesh) {
    const p = mesh.geometry.attributes.position;
    if (!p || !p.count) return null;
    let x = 0, z = 0;
    for (let i = 0; i < p.count; i++) { x += p.getX(i); z += p.getZ(i); }
    return { x: x / p.count, z: z / p.count };
  }

  // Draw calls the renderer itself reports for the named mark layers: a frame
  // is rendered with everything else hidden and info.render.calls is read.
  function layerDrawCalls(names) {
    if (!S || !S.marks) return -1;
    const keep = names.map((n) => S.marks[n]), saved = S.scene.children.map((o) => [o, o.visible]);
    for (const [o] of saved) if (keep.indexOf(o) < 0) o.visible = false;
    try { S.renderer.render(S.scene, S.camera); return S.renderer.info.render.calls; }
    finally { for (const [o, v] of saved) o.visible = v; }
  }

  function visibleChunkCount() {
    if (!S) return 0;
    S.camera.updateMatrixWorld();
    const f = new THREE.Frustum(), m = new THREE.Matrix4();
    m.multiplyMatrices(S.camera.projectionMatrix, S.camera.matrixWorldInverse);
    f.setFromProjectionMatrix(m);
    let n = 0;
    for (const ch of S.chunks) if (ch && f.intersectsObject(ch.mesh)) n++;
    return n;
  }

  function init(opts) {
    opts = opts || {};
    if (typeof THREE === 'undefined' || typeof THREE.OrbitControls !== 'function' || !opts.canvas) return false;
    // Create the renderer BEFORE touching any live session so a failed init
    // (no WebGL) leaves a running renderer untouched.
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (e) {
      return false;
    }
    if (!renderer.getContext()) return false;
    if (S) dispose();

    const state0 = (opts.getState && opts.getState()) || {};
    const cols = state0.cols || 32, rows = state0.rows || 20;
    const mid = mapMid(cols, rows);

    renderer.setPixelRatio(1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xc9dbe2, 34, 85);
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 260);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.2;
    controls.maxDistance = 90;
    controls.maxPolarAngle = MAX_POLAR;
    // Left-drag pans the map, right-drag rotates (three.js defaults are the reverse).
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    controls.screenSpacePanning = false;
    controls.panSpeed = 1.1;
    camera.position.set(mid.x - 2, 7, mid.z + 18);
    controls.target.set(mid.x - 2, 0.3, mid.z + 5);
    camera.lookAt(controls.target);     // aimed from the first instant, not only after the first frame

    scene.add(new THREE.HemisphereLight(0xd8ecff, 0x6b5a3a, 0.5));
    const sun = new THREE.DirectionalLight(0xfff0d4, 0.92);
    sun.position.set(mid.x - 20, 34, mid.z + 16);
    sun.target.position.set(mid.x, 0, mid.z);
    scene.add(sun, sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 28, bottom: -28, near: 1, far: 90 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;

    S = {
      canvas: opts.canvas, renderer, scene, camera, controls, sun, cols, rows,
      getState: opts.getState || (() => null),
      // fogAt(q, r) -> 0 visible | 1 remembered | 2 unexplored. The default
      // fails closed: a renderer wired up without it shows an unexplored map,
      // which is loud, rather than the whole board, which is a silent leak.
      fogAt: opts.fogAt || (() => C.FOG.UNSEEN),
      onTileClick: opts.onTileClick || null,
      onTileHover: opts.onTileHover || null,
      keys: new Set(), wasd: opts.wasd === true, keyT: 0, drag: null, hoverHex: null, input: null,
      needsRender: true, frames: 0, raf: 0, fly: null, anims: [], hoverTile: null, fx: null, fxCount: 0, flashNext: 0, fxT: null,
      labelRoot: opts.labels || document.getElementById('labels') || null, amenityOf: opts.amenityOf || null,
      labels: new Map(), yieldTiles: [], vw: 0, vh: 0,
      fog: null, layers: {}, marks: null, pieces: null, unfiltered: false, selection: null, hover: null,
      quality: { shadows: true, props: true, fullRes: false },
      tileIdx: new Map(), cityTiles: new Set(), chunks: [], chunksX: Math.ceil(cols / CHUNK), chunksY: Math.ceil(rows / CHUNK),
      scenery: [], fogHideable: [], sceneryMats: new Map(), sceneryGeo: makeSceneryGeo(), sceneryHide: null,
      water: null, river: null, riverOwners: new Map(), lastAmbient: 0,
      terrainMat: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 }),
    };
    controls.addEventListener('change', requestRender);
    S.onResize = () => resize();
    window.addEventListener('resize', S.onResize);
    resize();
    rebuildMap();
    bindInput(opts.mapArea || document.getElementById('map-area') || opts.canvas);
    S.raf = requestAnimationFrame(loop);
    return true;
  }

  function loop(now) {
    if (!S) return;
    S.raf = requestAnimationFrame(loop);
    step(now);
  }

  // One pass of the loop body. Returns true when it drew a frame. Split out so
  // a test can drive it with its own clock instead of racing the wall clock.
  function step(now) {
    let live = false;
    if (S.fly) {
      const f = S.fly, k = Math.min(1, (now - f.t0) / f.dur), e = k * k * (3 - 2 * k);
      applyTarget(f.fx + (f.tx - f.fx) * e, f.fz + (f.tz - f.fz) * e);
      if (k >= 1) S.fly = null;
      live = true;
    }
    if (S.anims.length) {
      // One misbehaving animation must never stop the renderer: drop it and
      // log. A dropped animation is also disposed, so its meshes, DOM text
      // and any unit it displaced are put back; nothing is left behind.
      S.anims = S.anims.filter((a) => {
        let keep = false;
        try { keep = typeof a.tick === 'function' ? a.tick(S.fxT !== null ? S.fxT : performance.now()) !== false : false; }
        catch (err) { console.error('R3D animation threw and was dropped:', err); }
        if (!keep) dropAnim(a);
        return keep;
      });
      live = true;
    }
    // Water drifts at a low ambient rate so an idle map still breathes without
    // redrawing every frame; any frame drawn for another reason advances it too.
    if (!reducedMotion && now - S.lastAmbient >= AMBIENT_MS) S.needsRender = true;
    if (S.keys.size) { keyPan(now); live = true; } else S.keyT = 0;
    // controls.update() returns true while damping/pan is still moving.
    const moved = S.controls.update();
    if (moved) clampCamera();
    if (S.needsRender || live || moved) {
      S.needsRender = false;
      S.lastAmbient = now;
      animateSurfaces(now);
      updateGridFade();
      S.renderer.render(S.scene, S.camera);
      S.frames++;
      positionLabels();
      return true;
    }
    return false;
  }

  // Shift target and camera together so the view keeps its shape.
  function applyTarget(x, z) {
    const t = S.controls.target, c = C.clampTarget(x, z, S.cols, S.rows);
    S.camera.position.x += c.x - t.x;
    S.camera.position.z += c.z - t.z;
    t.x = c.x; t.z = c.z;
    S.needsRender = true;
  }

  function clampCamera() {
    const t = S.controls.target, c = C.clampTarget(t.x, t.z, S.cols, S.rows);
    if (c.x !== t.x || c.z !== t.z) applyTarget(c.x, c.z);
  }

  function resize() {
    if (!S) return;
    const cv = S.canvas;
    const w = cv.clientWidth || cv.width || 800, h = cv.clientHeight || cv.height || 500;
    S.renderer.setPixelRatio(S.quality.fullRes ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    S.renderer.setSize(w, h, false);
    S.camera.aspect = w / h;
    S.camera.updateProjectionMatrix();
    S.vw = w; S.vh = h;      // the only place labels read layout: never per frame
    S.needsRender = true;
  }

  function requestRender() { if (S) S.needsRender = true; }

  function panToHex(q, r) {
    if (!S) return;
    const p = C.hexCenter(q, r), t = S.controls.target;
    if (reducedMotion) { applyTarget(p.x, p.z); return; }
    S.fly = { t0: performance.now(), dur: 350, fx: t.x, fz: t.z, tx: p.x, tz: p.z };
    S.needsRender = true;
  }

  function centerOn(q, r) {
    if (!S) return;
    const p = C.hexCenter(q, r);
    S.fly = null;
    applyTarget(p.x, p.z);
  }

  function getCameraView() {
    if (!S) return { x: 0, z: 0, span: 0 };
    const d = S.camera.position.distanceTo(S.controls.target);
    return { x: S.controls.target.x, z: S.controls.target.z,
             span: 2 * d * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * S.camera.aspect };
  }


  // ---- Picking, pointer input and camera keys ----
  // Every tile lookup the picker makes goes through probeTile, so a test can
  // prove picking is maths plus a handful of candidates, never a scan.
  let probes = 0;
  const probeTile = (q, r) => { probes++; return tileAt(q, r); };
  const pickRay = new THREE.Raycaster();
  const PICK_TOP = 1.0, PICK_BOTTOM = -0.6, PICK_STEP = 0.1, PICK_REACH = 0.03;   // brackets heightAt over every terrain type

  // Screen (client) pixels -> {q, r} | null. Intersect the view ray with a
  // ground plane, ask the core which hex that lands in, then re-intersect at
  // the height of that tile: hills stand up to a hex above y=0, so one flat
  // plane alone picks the neighbour behind them. Outside the canvas, above the
  // horizon, or beyond the grid there is nothing to pick: null, never a throw.
  function pickHex(sx, sy) {
    if (!S || !Number.isFinite(sx) || !Number.isFinite(sy)) return null;
    const rc = S.canvas.getBoundingClientRect();
    if (!(rc.width > 0 && rc.height > 0)) return null;
    const nx = ((sx - rc.left) / rc.width) * 2 - 1, ny = -((sy - rc.top) / rc.height) * 2 + 1;
    if (nx < -1 || nx > 1 || ny < -1 || ny > 1) return null;
    S.camera.updateMatrixWorld(true);
    pickRay.setFromCamera({ x: nx, y: ny }, S.camera);
    const o = pickRay.ray.origin, d = pickRay.ray.direction;
    if (!(d.y < -1e-6)) return null;                       // sky
    // March down through horizontal planes spanning the terrain's height
    // range until the ray is below the ground, then bisect between the last
    // plane above it and the first below. One flat plane would pick the
    // wrong hex behind any hill. Tiles seen are cached per pick, so the probe
    // count is the number of distinct tiles the ray crosses, a handful.
    const seen = new Map();
    const probe = (x, z) => {
      const hex = C.worldToHex(x, z, S.cols, S.rows);
      if (!hex) return null;
      const k = hex.r * S.cols + hex.q;
      if (!seen.has(k)) seen.set(k, probeTile(hex.q, hex.r));
      const tile = seen.get(k);
      return tile ? { hex, below: (y) => C.heightAt(tileCopy(tile), x, z) >= y } : null;
    };
    // Step along the ray, not down it: a grazing ray covers a lot of ground per
    // 0.1 of height, so each step is capped in both height and horizontal reach.
    const hs = Math.hypot(d.x, d.z);
    const tTop = Math.max(0, (PICK_TOP - o.y) / d.y), tBot = (PICK_BOTTOM - o.y) / d.y;
    if (!(tBot > tTop)) return null;
    const dt = Math.min(PICK_STEP / -d.y, PICK_REACH / Math.max(hs, 1e-9));
    const at = (t) => ({ x: o.x + d.x * t, z: o.z + d.z * t, y: o.y + d.y * t });
    let prev = tTop, hit = null;
    for (let t = tTop; !hit; t += dt) {
      const last = t + dt >= tBot;
      if (last) t = tBot;
      const p = at(t), pr = probe(p.x, p.z);
      if (pr && (last || pr.below(p.y))) hit = { t, pr };
      else if (last) break;
      else prev = t;
    }
    if (!hit) return null;
    let lo = prev, hi = hit.t, best = hit.pr.hex;
    for (let i = 0; i < 6; i++) {
      const t = (lo + hi) / 2, p = at(t), pr = probe(p.x, p.z);
      if (!pr) break;
      if (pr.below(p.y)) { hi = t; best = pr.hex; } else lo = t;
    }
    return { q: best.q, r: best.r };
  }

  // What the game may show for a tile. The tile is assembled here (real tiles
  // carry no city or units field) from copies, then passed through the single
  // fog gate: callers never see the raw tile.
  function factsAt(q, r) {
    const tile = tileAt(q, r);
    if (!tile) return C.tileFacts(null, C.FOG.UNSEEN);
    const st = S.getState() || {}, copy = (o) => JSON.parse(JSON.stringify(o));
    let city = null; const units = [];
    (Array.isArray(st.players) ? st.players : []).forEach((pl, p) => {
      for (const c of ((pl && pl.cities) || [])) if (c.q === q && c.r === r) city = Object.assign(copy(c), { ownerPlayer: p, owner: p });
      for (const u of ((pl && pl.units) || [])) if (u.q === q && u.r === r && u.hp > 0) units.push(Object.assign(copy(u), { player: p }));
    });
    return C.tileFacts(Object.assign({}, tile, { city, units }), fogStateAt(q, r));
  }

  const fire = (fn, ...args) => { if (typeof fn !== 'function') return; try { fn(...args); } catch (err) { console.error('R3D callback threw:', err); } };
  const DRAG_PX = 4;       // same drag-versus-click threshold the 2D map used

  function bindInput(area) {
    const I = S.input = { area, on: [] };
    const add = (target, type, fn, opt) => { target.addEventListener(type, fn, opt); I.on.push([target, type, fn, opt]); };
    add(area, 'mousedown', (e) => {
      if (e.button !== 0) return;
      S.drag = { x: e.clientX, y: e.clientY, moved: false };
    });
    add(window, 'mousemove', (e) => {
      if (S.drag) {
        if (Math.abs(e.clientX - S.drag.x) + Math.abs(e.clientY - S.drag.y) > DRAG_PX) S.drag.moved = true;
        return;
      }
      // Only the map itself: a panel floating over it must not pick the ground underneath.
      if (!(e.target instanceof Node) || !area.contains(e.target)) { hoverOff(); return; }
      const hex = pickHex(e.clientX, e.clientY);
      if (!hex) { hoverOff(); return; }
      if (!S.hoverHex || S.hoverHex.q !== hex.q || S.hoverHex.r !== hex.r) { S.hoverHex = hex; setHover(hex.q, hex.r); }
      fire(S.onTileHover, hex, factsAt(hex.q, hex.r), { x: e.clientX, y: e.clientY });
    });
    add(area, 'mouseleave', () => { hoverOff(); });
    add(window, 'mouseup', (e) => {
      if (e.button !== 0) return;     // another button's release is not the end of this gesture
      const d = S.drag; S.drag = null;
      if (!d || d.moved) return;
      const hex = pickHex(e.clientX, e.clientY);
      if (hex) fire(S.onTileClick, hex);
    });
    // Arrows pan. WASD is opt-in: the game binds A (attack) and S (skip).
    const KEYS = { ArrowUp: 'f', ArrowDown: 'b', ArrowLeft: 'l', ArrowRight: 'r' };
    if (S.wasd) Object.assign(KEYS, { w: 'f', s: 'b', a: 'l', d: 'r', W: 'f', S: 'b', A: 'l', D: 'r' });
    // Capture phase, and the event is claimed outright: another pan handler on
    // document must not also move the map on the same keypress.
    add(window, 'keydown', (e) => {
      const k = KEYS[e.key];
      if (!k || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && t.nodeType === 1 && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      S.keys.add(k); requestRender();
      e.preventDefault(); e.stopImmediatePropagation();
    }, true);
    add(window, 'keyup', (e) => { const k = KEYS[e.key]; if (k) S.keys.delete(k); });
    add(window, 'blur', () => { S.keys.clear(); S.drag = null; });
  }

  function hoverOff() {
    if (!S || !S.hoverHex) return;
    S.hoverHex = null; setHover(null, null);
    fire(S.onTileHover, null, null, null);
  }

  function unbindInput() {
    if (!S || !S.input) return;
    for (const [t, type, fn, opt] of S.input.on) t.removeEventListener(type, fn, opt);
    S.input = null; S.keys.clear(); S.drag = null;
  }

  // Held keys pan along the ground, at a speed that follows how far out the
  // camera is. Every shift goes through applyTarget, hence clampTarget.
  function keyPan(now) {
    const dt = S.keyT ? Math.min(0.1, Math.max(0, (now - S.keyT) / 1000)) : 0;
    S.keyT = now;
    if (!dt) return;
    const fwd = new THREE.Vector3().subVectors(S.controls.target, S.camera.position); fwd.y = 0;
    if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const sp = S.camera.position.distanceTo(S.controls.target) * 0.9 * dt, v = new THREE.Vector3();
    if (S.keys.has('f')) v.addScaledVector(fwd, sp);
    if (S.keys.has('b')) v.addScaledVector(fwd, -sp);
    if (S.keys.has('r')) v.addScaledVector(right, sp);
    if (S.keys.has('l')) v.addScaledVector(right, -sp);
    const t = S.controls.target;
    applyTarget(t.x + v.x, t.z + v.z);
  }

  function setQuality(q) {
    if (!S || !q) return;
    Object.assign(S.quality, q);
    S.renderer.shadowMap.enabled = !!S.quality.shadows;
    S.sun.castShadow = !!S.quality.shadows;
    S.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    resize();
  }

  function dispose() {
    if (!S) return;
    cancelAnimationFrame(S.raf);
    window.removeEventListener('resize', S.onResize);
    unbindInput();
    S.controls.dispose();
    disposeTerrain();
    disposeScenery();
    disposeFog();
    disposeMarks();
    disposePieces();
    for (const a of S.anims) dropAnim(a);
    S.anims = [];
    disposeFxKit();
    clearLabels();
    for (const g of Object.values(S.sceneryGeo)) g.dispose();
    S.terrainMat.dispose();
    S.renderer.dispose();
    S = null;
  }

  // ---- Units and cities ----
  // The approved art, baked. Every figure, wagon, ox, house and wall is a
  // primitive placed by a transform; bakeParts() merges the lot into ONE
  // vertex-coloured geometry per (unit type, owner) and one per city, so a
  // squad of three is a single instance and a city is a single draw call.
  //
  // These are ABOVE the ground, so by the rule that cost Task 8 a fix round
  // they are transparent and write no depth, and draw before the remembered
  // fog (renderOrder below it) so the fog dims what it covers. Without depth
  // writes a model cannot sort itself: parts are added far-to-near for the
  // default camera, and every unit faces the default camera (+z, small yaw).
  // Fog is also a FILTER: a unit is drawn only on a currently visible tile
  // (remembered ground must not show who stands there now); a city stays on
  // remembered ground and is hidden only on unexplored ground.
  const OWNER_HEX = ['#3498db', '#e74c3c'], OWNER_FALLBACK = '#bdc3c7';
  const ownerHex = (p) => OWNER_HEX[p] || OWNER_FALLBACK;
  const UNIT_SCALE = 1.3, UNIT_TYPE_COUNT = 6;
  const SKINS = ['#c99a6e', '#b9875c', '#a8754c', '#d2a57a'];
  const PIECE_LIFT = { ring: 0.02, sink: 0.012 };
  const RING_R0 = 0.36, RING_R1 = 0.42;
  const WALLS_BIT = 4;       // bit 2 of city.buildings

  function rngOf(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Tiny scene-graph DSL for the art: P() is a coloured primitive, grp() a
  // transform node. bakeParts() flattens the tree.
  const grp = (x, y, z) => { const g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); return g; };
  function P(geo, hex, x, y, z, dbl) {
    const m = new THREE.Mesh(geo);
    m.position.set(x || 0, y || 0, z || 0);
    m.userData.hex = hex; m.userData.dbl = !!dbl;
    return m;
  }
  const tc = new THREE.Color();
  function bakeParts(root, soup) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      const p = g.attributes.position.array, n = g.attributes.normal.array;
      tc.set(o.userData.hex);
      const push = (i, flip) => {
        soup.pos.push(p[i], p[i + 1], p[i + 2]);
        soup.nor.push(flip ? -n[i] : n[i], flip ? -n[i + 1] : n[i + 1], flip ? -n[i + 2] : n[i + 2]);
        soup.col.push(tc.r, tc.g, tc.b);
      };
      for (let t = 0; t < p.length; t += 9) {
        push(t, false); push(t + 3, false); push(t + 6, false);
        // An open shell (canopy, cloak, flag) is seen from both sides: add the
        // reverse winding rather than turning DoubleSide on for everything.
        if (o.userData.dbl) { push(t, true); push(t + 6, true); push(t + 3, true); }
      }
      g.dispose();
    });
  }
  const newSoup = () => ({ pos: [], nor: [], col: [] });
  function soupGeometry(soup) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(soup.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(soup.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(soup.col, 3));
    g.computeBoundingSphere();
    return g;
  }

  // ---- figures (geometry and proportions from the approved prototype) ----
  function figure(o, rng) {
    const g = grp(), skin = SKINS[Math.floor(rng() * SKINS.length)], pants = o.pants || '#5a4630';
    const legs = [-1, 1].map((s) => {
      const l = grp(s * 0.022, 0.11, 0);
      l.add(P(new THREE.BoxGeometry(0.034, 0.11, 0.04).translate(0, -0.055, 0), pants)); g.add(l); return l;
    });
    g.add(P(new THREE.CylinderGeometry(0.046, 0.062, 0.12, 7), o.tunic, 0, 0.17, 0),
          P(new THREE.CylinderGeometry(0.064, 0.064, 0.016, 7), '#4a3420', 0, 0.124, 0));
    const head = P(new THREE.IcosahedronGeometry(0.043, 1), skin, 0, 0.27, 0); g.add(head);
    const arms = [-1, 1].map((s) => {
      const a = grp(s * 0.068, 0.215, 0);
      a.add(P(new THREE.BoxGeometry(0.026, 0.1, 0.03).translate(0, -0.05, 0), o.tunic),
            P(new THREE.IcosahedronGeometry(0.017, 0), skin, 0, -0.105, 0));
      g.add(a); return a;
    });
    return { g, legs, arms, head };
  }
  function warriorFig(c, rng) {
    const f = figure({ tunic: c }, rng);
    f.head.add(P(new THREE.SphereGeometry(0.049, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), '#8a6a3a', 0, 0.006, 0));
    const club = grp(0, -0.105, 0); club.rotation.x = -1.25;
    club.add(P(new THREE.CylinderGeometry(0.022, 0.011, 0.16, 6).translate(0, 0.07, 0), '#6b4a2e'),
             P(new THREE.DodecahedronGeometry(0.016, 0), '#5a3d24', 0.012, 0.14, 0));
    f.arms[0].add(club); f.arms[0].rotation.x = -0.5;
    const sh = grp(0.025, -0.07, 0.03);
    sh.add(P(new THREE.CylinderGeometry(0.072, 0.072, 0.014, 12).rotateX(Math.PI / 2), c),
           P(new THREE.TorusGeometry(0.072, 0.007, 4, 14), '#6b4a2e', 0, 0, 0.002),
           P(new THREE.IcosahedronGeometry(0.016, 0), '#c9a24a', 0, 0, 0.01));
    f.arms[1].add(sh); f.arms[1].rotation.x = -0.9;
    return f;
  }
  function slingerFig(c, rng) {
    const f = figure({ tunic: '#c8b48a', pants: '#6a5638' }, rng);
    f.g.add(P(new THREE.CylinderGeometry(0.064, 0.05, 0.04, 7), c, 0, 0.2, 0));
    f.head.add(P(new THREE.TorusGeometry(0.044, 0.008, 4, 12).rotateX(Math.PI / 2), c, 0, 0.015, 0),
               P(new THREE.SphereGeometry(0.046, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2.4), '#2a1d14', 0, 0.008, -0.004));
    f.arms[0].rotation.x = -2.75;
    const sp = grp(0, -0.12, 0);
    sp.add(P(new THREE.CylinderGeometry(0.0025, 0.0025, 0.11, 3).rotateZ(Math.PI / 2).translate(0.055, 0, 0), '#d8c8a0'),
           P(new THREE.IcosahedronGeometry(0.012, 0), '#777777', 0.11, 0, 0));
    f.arms[0].add(sp);
    f.g.add(P(new THREE.BoxGeometry(0.04, 0.04, 0.03), '#7a5634', 0.07, 0.12, 0.02));   // pouch of stones
    return f;
  }
  function archerFig(c, rng) {
    const f = figure({ tunic: c, pants: '#4a3c2a' }, rng);
    f.head.add(P(new THREE.ConeGeometry(0.056, 0.1, 7), '#3f5a35', 0, 0.04, -0.006));
    const bow = grp(0, -0.11, 0);
    const arc = P(new THREE.TorusGeometry(0.105, 0.0055, 4, 14, Math.PI), '#7a5232'); arc.rotation.set(0, Math.PI / 2, Math.PI / 2);
    bow.add(arc, P(new THREE.CylinderGeometry(0.0015, 0.0015, 0.21, 3), '#efe6cf'));
    bow.rotation.x = Math.PI / 2;
    f.arms[1].add(bow); f.arms[1].rotation.x = -1.3; f.arms[0].rotation.x = -1.2; f.arms[0].rotation.z = -0.3;
    const q = grp(-0.03, 0.22, -0.06); q.rotation.x = -0.35;
    q.add(P(new THREE.CylinderGeometry(0.022, 0.018, 0.13, 6), '#7a5634'));
    for (let i = 0; i < 3; i++) q.add(P(new THREE.BoxGeometry(0.008, 0.03, 0.002), '#e8e0d0', (i - 1) * 0.01, 0.08, 0));
    f.g.add(q);
    return f;
  }
  function scoutFig(c, rng) {
    const f = figure({ tunic: c, pants: '#5a4a30' }, rng);
    f.g.add(P(new THREE.ConeGeometry(0.08, 0.19, 8, 1, true), '#6a5a3a', 0, 0.18, -0.018, true));    // cloak
    f.head.add(P(new THREE.CylinderGeometry(0.07, 0.07, 0.008, 12), '#5a4630', 0, 0.03, 0),
               P(new THREE.CylinderGeometry(0.034, 0.04, 0.045, 8), '#5a4630', 0, 0.055, 0));
    const fe = P(new THREE.BoxGeometry(0.006, 0.06, 0.012), '#d34a2a', 0.035, 0.07, -0.01); fe.rotation.z = -0.5; f.head.add(fe);
    f.arms[0].add(P(new THREE.CylinderGeometry(0.005, 0.006, 0.36, 4), '#7a5634', 0, -0.06, 0));       // staff
    return f;
  }
  function builderFig(c, rng) {
    const f = figure({ tunic: c, pants: '#7a6448' }, rng);
    f.head.add(P(new THREE.ConeGeometry(0.08, 0.04, 10), '#d8be7a', 0, 0.04, 0));                      // sun hat
    const hm = grp(0, -0.105, 0); hm.rotation.x = -1.4;
    hm.add(P(new THREE.CylinderGeometry(0.005, 0.005, 0.11, 4).translate(0, 0.05, 0), '#7a5634'),
           P(new THREE.BoxGeometry(0.045, 0.022, 0.022), '#666666', 0, 0.1, 0));
    f.arms[0].add(hm);
    return f;
  }
  function quadruped(o, rng) {
    const g = grp(), dark = o.dark || '#3a2a1c';
    g.add(P(new THREE.BoxGeometry(o.w, o.h, o.l), o.color, 0, o.legH + o.h / 2, 0));
    const lg = new THREE.BoxGeometry(o.lw, o.legH, o.lw).translate(0, -o.legH / 2, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const l = grp(sx * (o.w / 2 - o.lw / 2), o.legH, sz * (o.l / 2 - o.lw)); l.add(P(lg, dark)); g.add(l);
    }
    const head = grp(0, o.legH + o.h * (o.neck ? 1.1 : 0.7), o.l / 2 + (o.neck ? 0.015 : 0));
    if (o.neck) { const n = P(new THREE.BoxGeometry(o.w * 0.6, o.h * 1.1, o.h * 0.6), o.color); n.rotation.x = 0.6; head.add(n); }
    head.add(P(new THREE.BoxGeometry(o.w * 0.62, o.h * 0.62, o.h * 0.9), o.color, 0, o.neck ? 0.035 : 0, o.h * 0.4));
    if (o.horns) for (const s of [-1, 1]) { const hn = P(new THREE.ConeGeometry(0.006, 0.03, 4), '#eee4cc', s * 0.022, o.h * 0.35, o.h * 0.25); hn.rotation.z = -s * 1.1; head.add(hn); }
    if (o.ears) for (const s of [-1, 1]) head.add(P(new THREE.ConeGeometry(0.008, 0.02, 4), dark, s * 0.012, o.h * 0.45, o.h * 0.3));
    const tail = P(new THREE.BoxGeometry(0.008, o.h * 0.9, 0.008), dark, 0, o.legH + o.h * 0.55, -o.l / 2 - 0.004); tail.rotation.x = 0.3; g.add(tail);
    g.add(head);
    return g;
  }
  function flagPart(hex, w, h, x, y, z) {
    const geo = new THREE.PlaneGeometry(w, h, 8, 2).translate(w / 2, 0, 0), pa = geo.attributes.position;
    for (let i = 0; i < pa.count; i++) { const u = pa.getX(i) / w; pa.setZ(i, Math.sin(u * Math.PI * 2.2) * w * 0.12 * u); }
    geo.computeVertexNormals();
    return P(geo, hex, x, y, z, true);
  }
  function settlerGroup(c, rng) {
    const g = grp(), wood = '#7a5232';
    const wagon = grp(0, 0, -0.08); g.add(wagon);
    wagon.add(P(new THREE.BoxGeometry(0.13, 0.05, 0.24), wood, 0, 0.075, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) wagon.add(P(new THREE.CylinderGeometry(0.045, 0.045, 0.014, 10).rotateZ(Math.PI / 2), '#4a3422', sx * 0.074, 0.045, sz * 0.08));
    wagon.add(P(new THREE.BoxGeometry(0.01, 0.01, 0.18), wood, 0, 0.05, 0.2));                         // drawbar
    wagon.add(P(new THREE.CylinderGeometry(0.072, 0.072, 0.22, 8, 1, true, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), '#efe6cf', 0, 0.1, 0, true));
    wagon.add(P(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 4), '#4a3a2a', -0.05, 0.2, -0.1), flagPart(c, 0.08, 0.05, -0.05, 0.27, -0.1));
    const ox = quadruped({ color: '#c9b48e', dark: '#4a3826', w: 0.07, h: 0.07, l: 0.15, legH: 0.055, lw: 0.017, horns: true }, rng);
    ox.position.z = 0.27; g.add(ox);
    const man = figure({ tunic: c, pants: '#5a4630' }, rng); man.g.position.set(0.12, 0, 0.16);
    man.g.add(P(new THREE.BoxGeometry(0.05, 0.06, 0.035), '#a08060', 0, 0.18, -0.05));                // bundle
    g.add(man.g);
    return g;
  }
  const dogGroup = (rng) => quadruped({ color: '#8a6a45', dark: '#4a3826', w: 0.035, h: 0.04, l: 0.09, legH: 0.04, lw: 0.012, ears: true }, rng);

  // Back figures first: with no depth writes, draw order is the only sort.
  const FORM = [[-0.13, -0.08], [0.13, -0.08], [0, 0.11]];
  function buildUnitArt(type, owner) {
    const rng = rngOf(9001 + type * 31 + owner * 7), c = ownerHex(owner), root = grp();
    if (type === 3 || type === 4 || type === 5) {
      const mk = type === 3 ? warriorFig : type === 4 ? slingerFig : archerFig;
      for (const [x, z] of FORM) { const f = mk(c, rng); f.g.position.set(x, 0, z); root.add(f.g); }
    } else if (type === 1) {
      const logs = grp(0.13, 0, 0.02);
      for (let i = 0; i < 3; i++) logs.add(P(new THREE.CylinderGeometry(0.018, 0.018, 0.13, 6).rotateZ(Math.PI / 2), '#8a6040', 0, 0.018 + (i === 2 ? 0.03 : 0), i === 2 ? 0 : (i - 0.5) * 0.038));
      root.add(logs, P(new THREE.BoxGeometry(0.016, 0.07, 0.016), '#7a5a36', 0, 0.035, -0.1));
      const f = builderFig(c, rng); f.g.position.set(-0.04, 0, 0.04); root.add(f.g);
    } else if (type === 2) {
      const d = dogGroup(rng); d.position.set(0.12, 0, -0.04); root.add(d);
      const f = scoutFig(c, rng); f.g.position.set(-0.03, 0, 0.04); root.add(f.g);
    } else if (type === 0) {
      root.add(settlerGroup(c, rng));
    } else return null;
    const soup = newSoup(); bakeParts(root, soup);
    return soupGeometry(soup);
  }

  // ---- ground-hugging helpers ----
  // A band of ring from r0 to r1 around (cx, cz), every vertex on the tile's
  // own ground (surfaceY) so it follows slopes and sits under the fog shell.
  function groundRingInto(pos, col, tile, cx, cz, r0, r1, rgb, lift, segs) {
    const v = (a, r) => { const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; pos.push(x, surfaceY(tile, x, z, lift), z); col.push(rgb.r, rgb.g, rgb.b); };
    for (let i = 0; i < segs; i++) {
      const a0 = i / segs * Math.PI * 2, a1 = (i + 1) / segs * Math.PI * 2;
      v(a0, r0); v(a1, r0); v(a0, r1); v(a1, r0); v(a1, r1); v(a0, r1);
    }
  }
  const unitYaw = (p, id) => -0.35 + (((id * 37 + p * 17) % 7) / 6) * 0.7;
  const tileKey = (q, r) => r * S.cols + q;

  // ---- cities ----
  const cityTierOf = (pop) => (pop >= 6 ? 2 : pop >= 3 ? 1 : 0);
  function cityGeometry(c, owner, tile) {
    const cen = C.hexCenter(c.q, c.r), t = tileCopy(tile), col = ownerHex(owner);
    const gy = (lx, lz) => C.heightAt(t, cen.x + lx, cen.z + lz);
    const tier = cityTierOf(c.population | 0), walls = !!((c.buildings | 0) & WALLS_BIT);
    const rng = rngOf(((c.q * 73856093) ^ (c.r * 19349663) ^ 0x5bd1e995) >>> 0);
    const roofs = owner === 0 ? ['#456ea8', '#3d6296', '#5079b0'] : owner === 1 ? ['#b5523b', '#a4472f', '#bf5e43'] : ['#8a8a8a', '#7a7a7a'];
    const wallsC = ['#e6d5b3', '#d9c49b', '#efe3c8', '#cdb28a'], pick = (a) => a[Math.floor(rng() * a.length)];
    const items = [];    // {z, node}: drawn back to front
    // palace, bigger with the city
    const pal = grp(0, gy(0, -0.05) + 0.012, -0.05);
    pal.add(P(new THREE.BoxGeometry(0.32, 0.1, 0.28), '#e8dcc0', 0, 0.05, 0));
    if (tier >= 1) {
      pal.add(P(new THREE.BoxGeometry(0.24, 0.08, 0.2), '#ddcfae', 0, 0.14, 0), P(new THREE.BoxGeometry(0.15, 0.07, 0.12), '#d2c29c', 0, 0.215, 0),
              P(new THREE.BoxGeometry(0.06, 0.012, 0.06), '#e2bf6a', 0, 0.256, 0));
      for (let i = -1; i <= 1; i++) pal.add(P(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 6), '#f2e8d2', i * 0.06, 0.05, 0.15));
      const ob = grp(0.24, 0, 0.12);
      ob.add(P(new THREE.BoxGeometry(0.035, 0.32, 0.035), '#e3d6b8', 0, 0.16, 0), P(new THREE.ConeGeometry(0.026, 0.05, 4).rotateY(Math.PI / 4), '#e2bf6a', 0, 0.345, 0));
      pal.add(ob);
    } else {
      pal.add(P(new THREE.BoxGeometry(0.2, 0.06, 0.16), '#ddcfae', 0, 0.13, 0), P(new THREE.BoxGeometry(0.22, 0.02, 0.18), '#d2c29c', 0, 0.17, 0));
    }
    if (tier >= 2) {
      for (const sx of [-1, 1]) pal.add(P(new THREE.BoxGeometry(0.1, 0.09, 0.2), '#e0d3b4', sx * 0.2, 0.045, -0.02), P(new THREE.BoxGeometry(0.12, 0.015, 0.22), '#cdbb94', sx * 0.2, 0.097, -0.02));
      const ob2 = grp(-0.24, 0, 0.12);
      ob2.add(P(new THREE.BoxGeometry(0.03, 0.26, 0.03), '#e3d6b8', 0, 0.13, 0), P(new THREE.ConeGeometry(0.022, 0.045, 4).rotateY(Math.PI / 4), '#e2bf6a', 0, 0.282, 0));
      pal.add(ob2);
    }
    pal.add(P(new THREE.CylinderGeometry(0.005, 0.005, 0.34, 5), '#4a3a2a', -0.12, 0.34, 0), flagPart(col, 0.14, 0.09, -0.12, 0.48, 0));
    items.push({ z: -0.05, node: pal });
    // houses: the first N points of one seeded sequence, so a city that grows
    // keeps the houses it had
    const want = Math.min(22, 2 + (c.population | 0) * 2), avoid = [[0, -0.05, 0.3], [0.24, 0.07, 0.12], [-0.24, 0.07, 0.12]], pts = [];
    for (let tries = 0; pts.length < want && tries < 900; tries++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * 0.6, lx = Math.cos(a) * d, lz = Math.sin(a) * d;
      if (pts.concat(avoid).some((q) => Math.hypot(q[0] - lx, q[1] - lz) < (q[2] || 0.17))) continue;
      pts.push([lx, lz]);
    }
    for (const [lx, lz] of pts) {
      const w = 0.1 + rng() * 0.06, d = 0.09 + rng() * 0.05, h = 0.06 + rng() * 0.05, hg = grp(lx, gy(lx, lz) + 0.005, lz);
      hg.rotation.y = rng() * Math.PI;
      hg.add(P(new THREE.BoxGeometry(w, h, d), pick(wallsC), 0, h / 2, 0));
      if (rng() < 0.7) { const rf = P(new THREE.ConeGeometry(Math.max(w, d) * 0.74, 0.06, 4).rotateY(Math.PI / 4), pick(roofs), 0, h + 0.03, 0); rf.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d)); hg.add(rf); }
      else hg.add(P(new THREE.BoxGeometry(w * 1.05, 0.012, d * 1.05), pick(roofs), 0, h + 0.006, 0), P(new THREE.BoxGeometry(w * 0.4, 0.03, d * 0.4), pick(wallsC), w * 0.2, h + 0.02, 0));
      items.push({ z: lz, node: hg });
    }
    // walls and towers on the six edges
    if (walls) {
      for (let e = 0; e < 6; e++) {
        const A = C.hexCorner(e, 0.82), B = C.hexCorner((e + 1) % 6, 0.82), mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2;
        // the foot is taken from the lowest ground along the wall, then sunk a
        // little, so a wall on a slope never hangs in the air
        const gm = Math.min(gy(A[0], A[1]), gy(B[0], B[1]), gy(mx, mz));
        const len = Math.hypot(B[0] - A[0], B[1] - A[1]), seg = P(new THREE.BoxGeometry(len + 0.024, 0.14, 0.04), '#cbb995', mx, gm + 0.04, mz);
        seg.rotation.y = -Math.atan2(B[1] - A[1], B[0] - A[0]);
        items.push({ z: mz, node: seg, wall: true });
        const tw = grp(A[0], gy(A[0], A[1]), A[1]);
        tw.add(P(new THREE.CylinderGeometry(0.04, 0.046, 0.19, 7), '#cbb995', 0, 0.065, 0), P(new THREE.ConeGeometry(0.055, 0.07, 7), col, 0, 0.175, 0));
        items.push({ z: A[1], node: tw, wall: true });
      }
    }
    items.sort((a, b) => a.z - b.z);
    // the plaza is the floor: drawn first, on the ground it covers
    const soup = newSoup(), floor = [];
    const R = [0, 0.28, 0.56, 0.84], SEG = 18;
    for (let k = 0; k < 3; k++) for (let i = 0; i < SEG; i++) {
      const a0 = i / SEG * Math.PI * 2, a1 = (i + 1) / SEG * Math.PI * 2;
      const v = (a, r) => { const x = Math.cos(a) * r, z = Math.sin(a) * r; floor.push(x, gy(x, z) + 0.012, z); };
      v(a0, R[k]); v(a1, R[k]); v(a0, R[k + 1]); v(a1, R[k]); v(a1, R[k + 1]); v(a0, R[k + 1]);
    }
    tc.set('#bba57d');
    for (let i = 0; i < floor.length; i += 3) { soup.pos.push(floor[i], floor[i + 1], floor[i + 2]); soup.nor.push(0, 1, 0); soup.col.push(tc.r, tc.g, tc.b); }
    const floorVerts = soup.pos.length / 3;
    let wallVerts = 0;
    for (const it of items) {
      const before = soup.pos.length;
      bakeParts(it.node, soup);
      if (it.wall) wallVerts += (soup.pos.length - before) / 3;
    }
    return { geo: soupGeometry(soup), tier, walls: wallVerts > 0, wallVerts, floorVerts, houses: pts.length };
  }

  // ---- the live set ----
  function pieceMaterial() {
    return new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0,
      transparent: true, depthWrite: false });
  }
  // Units are OPAQUE: a unit is culled outright (not merely covered) wherever
  // its tile is not VISIBLE, so it is never present where fog must hide it,
  // and opaque is the only way a model can sort itself. The cull always reads
  // the real fog (the test bypass does not reach units). Cities are the
  // opposite: they stay on remembered ground where the fog shell must dim
  // them, so they stay transparent with no depth write.
  function unitMaterial() {
    return new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0,
      transparent: false, depthWrite: true });
  }
  function buildPieces() {
    disposePieces();
    S.pieces = { mat: pieceMaterial(), unitMat: unitMaterial(), art: new Map(), meshes: new Map(), cities: new Map(), placed: new Map(),
      rings: null, discs: null, hidden: new Set(), count: 0 };
    const pc = S.pieces;
    pc.rings = new THREE.Mesh(new THREE.BufferGeometry(), markMaterial({ vertexColors: true, opacity: 0.85 }));
    pc.discs = new THREE.Mesh(new THREE.BufferGeometry(), markMaterial({ vertexColors: true, opacity: 0.16 }));
    for (const [m, order, name] of [[pc.discs, RENDER_ORDER.unitDiscs, 'unitDiscs'], [pc.rings, RENDER_ORDER.unitRings, 'unitRings']]) {
      m.frustumCulled = false; m.raycast = () => {}; m.renderOrder = order; m.visible = false;
      S.scene.add(m); S.layers[name] = m;
    }
    updatePieces();
  }
  function disposePieces() {
    const pc = S && S.pieces;
    if (!pc) return;
    for (const e of pc.meshes.values()) { S.scene.remove(e.mesh); e.mesh.dispose(); }
    for (const [k, e] of pc.cities) { S.scene.remove(e.mesh); e.mesh.geometry.dispose(); delete S.layers['city' + k]; }
    for (const k of pc.meshes.keys()) delete S.layers['units' + k];
    for (const g of pc.art.values()) if (g) g.dispose();
    for (const m of [pc.rings, pc.discs]) { S.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    delete S.layers.unitRings; delete S.layers.unitDiscs;
    pc.mat.dispose(); pc.unitMat.dispose();
    S.pieces = null;
  }
  function unitArt(type, owner) {
    const pc = S.pieces, k = type + ':' + owner;
    if (!pc.art.has(k)) pc.art.set(k, buildUnitArt(type, owner));
    return pc.art.get(k);
  }
  function unitMesh(type, owner, need) {
    const pc = S.pieces, k = type + ':' + owner;
    let e = pc.meshes.get(k);
    if (e && e.cap >= need) return e;
    const cap = Math.max(8, need * 2), geo = unitArt(type, owner);
    const mesh = new THREE.InstancedMesh(geo, pc.unitMat, cap);
    mesh.frustumCulled = false; mesh.raycast = () => {}; mesh.renderOrder = RENDER_ORDER.units; mesh.count = 0; mesh.visible = false;
    mesh.userData.type = type; mesh.userData.owner = owner; mesh.userData.fogCulled = true;
    S.scene.add(mesh);
    if (e) { S.scene.remove(e.mesh); e.mesh.dispose(); }
    e = { mesh, cap, type, owner }; pc.meshes.set(k, e); S.layers['units' + k] = mesh;
    return e;
  }
  const gateOf = () => (S.unfiltered ? () => C.FOG.VISIBLE : fogStateAt);

  // Reconcile the drawn units and cities with the live state. Reads the state;
  // writes only renderer-owned objects. Called on every sync and fog change.
  function updatePieces() {
    if (!S || !S.pieces) return;
    const pc = S.pieces, st = S.getState() || {}, gate = gateOf(), unitGate = fogStateAt;
    const players = Array.isArray(st.players) ? st.players : [];
    const lists = new Map(), onTile = new Map(), ringPos = [], ringCol = [], discPos = [], discCol = [];
    pc.placed.clear(); pc.count = 0;
    const rgb = new THREE.Color();
    players.forEach((pl, p) => {
      for (const u of ((pl && pl.units) || [])) {
        if (!u || (u.hp !== undefined && u.hp <= 0) || !(u.unitType >= 0 && u.unitType < UNIT_TYPE_COUNT)) continue;
        const tile = tileAt(u.q, u.r);
        if (!tile || unitGate(u.q, u.r) !== C.FOG.VISIBLE) continue;
        const tk = tileKey(u.q, u.r), n = onTile.get(tk) || 0; onTile.set(tk, n + 1);
        const cen = C.hexCenter(u.q, u.r), a = (n - 1) * 2.4 + 0.5;
        const x = cen.x + (n ? Math.cos(a) * 0.34 : 0), z = cen.z + (n ? Math.sin(a) * 0.34 : 0);
        const y = surfaceY(tileCopy(tile), x, z, 0) - PIECE_LIFT.sink;
        const k = u.unitType + ':' + p;
        if (!lists.has(k)) lists.set(k, []);
        lists.get(k).push({ p, id: u.id, x, y, z, u });
        rgb.set(ownerHex(p));
        const t2 = tileCopy(tile);
        groundRingInto(ringPos, ringCol, t2, x, z, RING_R0, RING_R1, rgb, PIECE_LIFT.ring, 28);
        groundRingInto(discPos, discCol, t2, x, z, 0, RING_R0 * 0.34, rgb, PIECE_LIFT.ring, 14);
        groundRingInto(discPos, discCol, t2, x, z, RING_R0 * 0.34, RING_R0 * 0.67, rgb, PIECE_LIFT.ring, 20);
        groundRingInto(discPos, discCol, t2, x, z, RING_R0 * 0.67, RING_R0, rgb, PIECE_LIFT.ring, 28);
      }
    });
    const dummy = new THREE.Object3D();
    for (const e of pc.meshes.values()) { e.mesh.count = 0; e.mesh.visible = false; }
    for (const [k, list] of lists) {
      const [type, owner] = k.split(':').map(Number), e = unitMesh(type, owner, list.length);
      list.forEach((it, i) => {
        dummy.position.set(it.x, it.y, it.z); dummy.rotation.set(0, unitYaw(it.p, it.id), 0); dummy.scale.setScalar(UNIT_SCALE);
        dummy.updateMatrix(); e.mesh.setMatrixAt(i, dummy.matrix);
        pc.placed.set(it.p + ':' + it.id, { mesh: e.mesh, index: i, type, owner, q: it.u.q, r: it.u.r, x: it.x, y: it.y, z: it.z, u: it.u, p: it.p });
      });
      e.mesh.count = list.length; e.mesh.instanceMatrix.needsUpdate = true;
      e.mesh.visible = !pc.hidden.has('units'); pc.count += list.length;
    }
    for (const m of [[pc.rings, ringPos, ringCol], [pc.discs, discPos, discCol]]) {
      const g = new THREE.BufferGeometry(), old = m[0].geometry;
      if (m[1].length) { g.setAttribute('position', new THREE.Float32BufferAttribute(m[1], 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(m[2], 3)); }
      m[0].geometry = g; old.dispose();
      m[0].visible = m[1].length > 0 && !pc.hidden.has('rings');
    }
    // cities: stay on remembered ground, gone from unexplored ground
    const seen = new Set();
    players.forEach((pl, p) => {
      for (const c of ((pl && pl.cities) || [])) {
        const tile = c && tileAt(c.q, c.r);
        if (!tile) continue;
        const key = p + ':' + c.id; seen.add(key);
        const sig = [p, c.q, c.r, cityTierOf(c.population | 0), c.population | 0, ((c.buildings | 0) & WALLS_BIT) ? 1 : 0, tile.terrain, tile.feature].join('|');
        let e = pc.cities.get(key);
        if (!e || e.sig !== sig) {
          const built = cityGeometry(c, p, tile);
          if (!e) {
            const mesh = new THREE.Mesh(built.geo, pc.mat);
            mesh.raycast = () => {}; mesh.renderOrder = RENDER_ORDER.cities;
            const cen = C.hexCenter(c.q, c.r); mesh.position.set(cen.x, 0, cen.z);
            S.scene.add(mesh); e = { mesh }; pc.cities.set(key, e); S.layers['city' + key] = mesh;
          } else { e.mesh.geometry.dispose(); e.mesh.geometry = built.geo; }
          Object.assign(e, built, { sig, q: c.q, r: c.r, p });
          delete e.geo;
        }
        e.mesh.visible = gate(c.q, c.r) !== C.FOG.UNSEEN && !pc.hidden.has('cities');
      }
    });
    for (const [key, e] of pc.cities) if (!seen.has(key)) { S.scene.remove(e.mesh); e.mesh.geometry.dispose(); pc.cities.delete(key); delete S.layers['city' + key]; }
    updateLabels();
  }
  const cityAt = (q, r) => { if (S && S.pieces) for (const e of S.pieces.cities.values()) if (e.q === q && e.r === r) return e; return null; };
  function geoSignature(g) {
    if (!g) return '';
    const p = g.attributes.position.array;
    let h = 0;
    for (let i = 0; i < p.length; i++) h = (Math.imul(h, 31) + Math.round(p[i] * 10000)) | 0;
    return p.length / 3 + ':' + h;
  }
  function pieceDrawCalls() {
    if (!S || !S.pieces) return -1;
    const pc = S.pieces, keep = new Set([pc.rings, pc.discs]);
    for (const e of pc.meshes.values()) keep.add(e.mesh);
    for (const e of pc.cities.values()) keep.add(e.mesh);
    const saved = S.scene.children.map((o) => [o, o.visible]);
    for (const [o] of saved) if (!keep.has(o)) o.visible = false;
    try { S.renderer.render(S.scene, S.camera); return S.renderer.info.render.calls; }
    finally { for (const [o, v] of saved) o.visible = v; }
  }
  const PIECE_READERS = {
    // Instances actually submitted to the GPU across every unit mesh.
    unitInstancesDrawn: () => { let n = 0; if (S && S.pieces) for (const e of S.pieces.meshes.values()) if (e.mesh.visible) n += e.mesh.count; return n; },
    fogCulledMeshes: () => { let n = 0; if (S) S.scene.traverse((x) => { if (x.userData && x.userData.fogCulled === true) n++; }); return n; },
    unitMeshCount: () => (S && S.pieces ? S.pieces.count : 0),
    pieceDrawCalls,
    hasUnitArt: (t) => !!(S && S.pieces && t >= 0 && t < UNIT_TYPE_COUNT && unitArt(t, 0) && unitArt(t, 0).attributes.position.count > 0),
    unitArtSignature: (t) => (S && S.pieces && t >= 0 && t < UNIT_TYPE_COUNT ? geoSignature(unitArt(t, 0)) : ''),
    // lowest and highest vertex of a built unit model, in its own space
    unitArtRange: (t) => {
      const g = S && S.pieces && unitArt(t, 0), p = g && g.attributes.position;
      if (!p) return null;
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < p.count; i++) { min = Math.min(min, p.getY(i)); max = Math.max(max, p.getY(i)); }
      return { min, max };
    },
    // Where the unit really is: the instance matrix of the mesh drawing it.
    unitPlacement: (player, id) => {
      const e = S && S.pieces && S.pieces.placed.get(player + ':' + id);
      if (!e || !e.mesh.visible || e.mesh.parent !== S.scene || e.index >= e.mesh.count) return null;
      const m = e.mesh.instanceMatrix.array, i = e.index * 16;
      return { x: m[i + 12], y: m[i + 13], z: m[i + 14], type: e.type, owner: e.owner, sig: geoSignature(e.mesh.geometry) };
    },
    unitVisible: (player, id) => !!PIECE_READERS.unitPlacement(player, id),
    cityTier: (q, r) => { const e = cityAt(q, r); return e ? e.tier : -1; },
    cityHasWalls: (q, r) => { const e = cityAt(q, r); return !!e && e.walls; },
    cityVertexCount: (q, r) => { const e = cityAt(q, r); return e ? e.mesh.geometry.attributes.position.count : -1; },
    cityHouses: (q, r) => { const e = cityAt(q, r); return e ? e.houses : -1; },
    cityVisible: (q, r) => { const e = cityAt(q, r); return !!e && e.mesh.visible && e.mesh.parent === S.scene; },
    // lowest vertex of a built city, in world space: nothing may sink or float
    cityYRange: (q, r) => {
      const e = cityAt(q, r), p = e && e.mesh.geometry.attributes.position;
      if (!p) return null;
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < p.count; i++) { min = Math.min(min, p.getY(i)); max = Math.max(max, p.getY(i)); }
      return { min, max };
    },
    ringRange: () => {
      if (!S || !S.pieces) return null;
      const p = S.pieces.rings.geometry.attributes.position;
      if (!p) return { min: NaN, max: NaN, count: 0 };
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < p.count; i++) { min = Math.min(min, p.getY(i)); max = Math.max(max, p.getY(i)); }
      return { min, max, count: p.count };
    },
    // Test-only layer switch for pixel diffs: 'units' | 'cities' | 'rings'.
    setPiecesVisible: (b, name) => {
      if (!S || !S.pieces) return;
      const pc = S.pieces;
      for (const k of (name ? [name] : ['units', 'cities', 'rings'])) { if (b) pc.hidden.delete(k); else pc.hidden.add(k); }
      updatePieces(); requestRender();
    },
  };

  // Placeholders that later tasks replace.
  function rebuildMap() {
    if (!S) return;
    const st = S.getState() || {};
    disposeTerrain();
    disposeScenery();
    indexState(st);
    for (let cr = 0; cr < S.chunksY; cr++) for (let cq = 0; cq < S.chunksX; cq++) rebuildChunk(cq, cr);
    buildWater();
    buildRivers();
    buildScenery();
    buildFogShell();
    refreshFog();
    buildMarks();
    buildPieces();
    requestRender();
  }

  // Terrain changed on one tile (improvement built, feature removed, city
  // founded): rebuild only the chunk that owns it. Fog never calls this.
  function rebuildTile(q, r) {
    if (!S) return;
    indexState(S.getState());
    if (!tileAt(q, r)) return;
    rebuildChunk(Math.floor(q / CHUNK), Math.floor(r / CHUNK));
    // Scatter is seeded per tile, so a full scenery rebuild reproduces every
    // untouched tile exactly and only the changed tile's props differ.
    disposeScenery();
    buildScenery();
    // The ground this tile's shell was built from just changed shape, so the
    // shell has to follow it. buildScenery has already re-applied the current
    // scenery rule, so this path deliberately does not touch it.
    refreshFogTile(q, r);
    if (S.marks) { buildGrid(); updateMarks(); }
    updatePieces();
    requestRender();
  }

  // ---- Labels: DOM, never 3D text ----
  // Names, HP bars, city banners and yield pills are elements in a
  // pointer-events:none overlay. updateLabels() (called from updatePieces, so
  // from every state sync and fog change) owns their LIFECYCLE: it creates what
  // the state shows and REMOVES what it no longer shows. positionLabels()
  // (after every drawn frame) only moves them, writing transforms and never
  // reading layout, so a frame costs no forced reflow however many labels exist.
  // Every reveal goes through tileFacts: a label is never built from a raw tile.
  const LABEL_FAR_UNITS = 32, LABEL_FAR_YIELDS = 26;     // camera distance past which they would only clutter
  const LBL_UNIT_NAMES = ['Settler', 'Builder', 'Scout', 'Warrior', 'Slinger', 'Archer'];
  const AMENITY_CLS = ['ecstatic', 'happy', 'content', 'displeased', 'unhappy', 'unrest'];
  const PROD_COST = { 1: 80, 2: 50, 3: 30, 4: 40, 5: 35, 6: 60, 64: 60, 65: 65, 66: 80, 67: 90, 68: 100, 69: 90, 70: 80, 71: 150 };
  // Mirrors computeTileYield / computeCityCenterYield in index.html.
  function yieldOfFacts(f, isCenter) {
    const t = f.terrain;
    let food = [1, 1, 2, 2, 1, 1, 0, 0, 1, 1, 0, 0, 0][t] || 0, prod = [0, 0, 0, 1, 1, 2, 0, 1, 0, 1, 0, 1, 0][t] || 0, gold = t === 1 ? 1 : 0;
    if (f.feature === 1) prod += 1;
    const res = f.resource;
    if (res === 1 || res === 2 || res === 3 || res === 5) food += 1;
    else if (res === 4 || res === 7 || res === 6) prod += 1;
    else if (res === 8) gold += 3;
    else if (res === 9 || res === 10) gold += 2;
    const imp = f.improvement | 0;
    if (imp === 1) food += 1; else if (imp >= 2 && imp <= 5) prod += 1;
    if (isCenter) { if (food < 2) food = 2; if (prod < 1) prod = 1; }
    return { food, prod, gold };
  }
  const hpColor = (pct) => (pct > 0.5 ? '#66bb6a' : pct > 0.25 ? '#ff9800' : '#e74c3c');

  function mkEl(tag, cls, parent) { const e = document.createElement(tag); e.className = cls; if (parent) parent.appendChild(e); return e; }
  function setText(e, v) { if (e.textContent !== v) e.textContent = v; }
  function setBar(bar, pct, color) {
    const w = Math.round(Math.max(0, Math.min(1, pct)) * 100) + '%';
    if (bar.style.width !== w) bar.style.width = w;
    if (color && bar.style.background !== color) bar.style.background = color;
  }
  function labelEntry(key, kind, build) {
    let L = S.labels.get(key);
    if (!L) {
      const el = mkEl('div', 'lbl lbl-' + kind);
      L = { key, kind, el, parts: build(el), wx: 0, wy: 0, wz: 0, far: 0, last: '' };
      S.labelRoot.appendChild(el); S.labels.set(key, L);
    }
    return L;
  }
  function removeLabel(L) { if (L.el.parentNode) L.el.parentNode.removeChild(L.el); S.labels.delete(L.key); }
  function clearLabels() { if (S) { for (const L of [...S.labels.values()]) removeLabel(L); } }
  function setLabelClass(L, cls) { const c = 'lbl lbl-' + L.kind + ' ' + cls; if (L.el.className !== c) L.el.className = c; }

  function updateLabels() {
    if (!S || !S.labelRoot || !S.pieces) return;
    const st = S.getState() || {}, players = Array.isArray(st.players) ? st.players : [];
    const live = new Set();
    // units: only what tileFacts says stands on a currently visible tile
    for (const [pk, pl] of S.pieces.placed) {
      const u = pl.u, tile = tileAt(u.q, u.r);
      if (!tile) continue;
      const facts = C.tileFacts(Object.assign({}, tile, { city: null, units: [u] }), fogStateAt(u.q, u.r));
      if (facts.units.length !== 1) continue;
      const key = 'unit:' + pk; live.add(key);
      const L = labelEntry(key, 'unit', (el) => ({ nm: mkEl('span', 'nm', el), hp: mkEl('span', 'hpbar', el) }));
      L.parts.hpi = L.parts.hpi || mkEl('i', '', L.parts.hp);
      setLabelClass(L, 'p' + pl.p);
      setText(L.parts.nm, LBL_UNIT_NAMES[u.unitType] || 'Unit');
      const damaged = u.hp < 100 && u.hp > 0;
      L.parts.hp.style.display = damaged ? '' : 'none';
      if (damaged) setBar(L.parts.hpi, u.hp / 100, hpColor(u.hp / 100));
      L.wx = pl.x; L.wy = pl.y + 0.95; L.wz = pl.z; L.far = LABEL_FAR_UNITS;
    }
    // cities: stay on remembered ground, but only as identity
    players.forEach((pl, p) => {
      for (const c of ((pl && pl.cities) || [])) {
        const tile = c && tileAt(c.q, c.r);
        if (!tile) continue;
        const fog = fogStateAt(c.q, c.r);
        const facts = C.tileFacts(Object.assign({}, tile, { city: Object.assign({}, c, { ownerPlayer: p, owner: p }), units: [] }), fog);
        const fc = facts.city;
        if (!fc) continue;
        const full = fog === C.FOG.VISIBLE;
        const key = 'city:' + p + ':' + c.id; live.add(key);
        const L = labelEntry(key, 'city', (el) => {
          const pop = mkEl('span', 'pop', el), nm = mkEl('span', 'nm', el), am = mkEl('span', 'am', el);
          const bars = mkEl('span', 'bars', el), prod = mkEl('span', 'bar prod', bars), hp = mkEl('span', 'bar hp', bars);
          return { pop, nm, am, bars, prod, prodi: mkEl('i', '', prod), hp, hpi: mkEl('i', '', hp) };
        });
        const sel = S.selection && S.selection.kind === 'city' && S.selection.q === c.q && S.selection.r === c.r;
        setLabelClass(L, 'p' + p + (sel ? ' sel' : '') + (full ? '' : ' mem'));
        setText(L.parts.nm, fc.name + (fc.isCapital ? ' ★' : ''));
        L.parts.pop.style.display = full ? '' : 'none';
        L.parts.bars.style.display = full ? '' : 'none';
        L.parts.am.style.display = 'none';
        if (full) {
          setText(L.parts.pop, String(fc.population | 0));
          const cost = PROD_COST[fc.production] || 0;
          L.parts.prod.style.display = cost > 0 ? '' : 'none';
          if (cost > 0) setBar(L.parts.prodi, (fc.prodStockpile || 0) / cost, '#ff9800');
          const dmg = fc.hp < 200;
          L.parts.hp.style.display = dmg ? '' : 'none';
          if (dmg) setBar(L.parts.hpi, fc.hp / 200, hpColor(fc.hp / 200));
          let cls = '';
          try { cls = S.amenityOf ? S.amenityOf(fc, p) : ''; } catch (e) { cls = ''; }
          L.parts.am.style.display = AMENITY_CLS.includes(cls) ? '' : 'none';
          L.parts.am.className = 'am am-' + cls;
        }
        const cen = C.hexCenter(c.q, c.r);
        L.wx = cen.x; L.wz = cen.z; L.wy = surfaceY(tileCopy(tile), cen.x, cen.z, 0) + 1.25; L.far = 0;
      }
    });
    // yield pills: terrain is read from tileFacts, so an unexplored tile has none
    for (const yt of S.yieldTiles) {
      const tile = tileAt(yt.q, yt.r);
      if (!tile) continue;
      const facts = C.tileFacts(Object.assign({}, tile, { city: null, units: [] }), fogStateAt(yt.q, yt.r));
      if (facts.terrain === null) continue;
      const y = yieldOfFacts(facts, !!yt.isCenter), parts = [];
      if (y.food) parts.push([y.food + 'F', 'f']);
      if (y.prod) parts.push([y.prod + 'P', 'p']);
      if (y.gold) parts.push([y.gold + 'G', 'g']);
      if (!parts.length) continue;
      const key = 'yield:' + yt.q + ',' + yt.r; live.add(key);
      const L = labelEntry(key, 'yield', () => ({}));
      const txt = parts.map((x) => x[0]).join(' ') + (yt.locked ? ' \u{1F512}' : '');
      setLabelClass(L, yt.locked ? 'locked' : '');
      if (L.parts.txt !== txt) { L.el.textContent = ''; for (const [t, k] of parts) mkEl('b', 'y' + k, L.el).textContent = t; if (yt.locked) mkEl('u', 'lock', L.el).textContent = '\u{1F512}'; L.parts.txt = txt; }
      const cen = C.hexCenter(yt.q, yt.r);
      L.wx = cen.x; L.wz = cen.z; L.wy = surfaceY(tileCopy(tile), cen.x, cen.z, 0) + 0.05; L.far = LABEL_FAR_YIELDS;
    }
    for (const L of [...S.labels.values()]) if (!live.has(L.key)) removeLabel(L);   // lifecycle: gone from the state, gone from the DOM
    positionLabels();
  }

  const _lv = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;
  function positionLabels() {
    if (!S || !S.labelRoot || !S.vw) return;
    S.camera.updateMatrixWorld();
    const dist = S.camera.position.distanceTo(S.controls.target), w = S.vw, h = S.vh;
    for (const L of S.labels.values()) {
      let on = !(L.far && dist > L.far), tx = 0, ty = 0;
      if (on) {
        _lv.set(L.wx, L.wy, L.wz).project(S.camera);
        tx = (_lv.x * 0.5 + 0.5) * w; ty = (-_lv.y * 0.5 + 0.5) * h;
        on = _lv.z > -1 && _lv.z < 1 && tx > -60 && tx < w + 60 && ty > -30 && ty < h + 30;
      }
      const v = on ? 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px) translate(-50%,-100%)' : '';
      if (v === L.last) continue;
      L.last = v; L.on = on;
      if (on) { L.el.style.transform = v; L.el.style.visibility = 'visible'; } else L.el.style.visibility = 'hidden';
    }
  }
  function setYieldTiles(tiles) {
    if (!S) return;
    S.yieldTiles = Array.isArray(tiles) ? tiles.filter((t) => t && Number.isInteger(t.q) && Number.isInteger(t.r)).map((t) => ({ q: t.q, r: t.r, locked: !!t.locked, isCenter: !!t.isCenter })) : [];
    updateLabels(); requestRender();
  }
  const labelFor = (kind, id, player) => {
    if (!S) return null;
    const L = S.labels.get(kind + ':' + (kind === 'yield' ? id : (player === undefined ? '0' : player) + ':' + id));
    return L ? L.el : null;
  };

  // State changed: fog is derived from it, so re-read it here too rather than
  // trusting every call site to remember.
  // Ownership lives on tiles, so a state refresh re-reads the marks too.
  function syncState() { if (S) indexState(S.getState()); refreshFog(); updateMarks(); updatePieces(); requestRender(); }
  function setSelection(sel) { if (S) { S.selection = sel || null; updateMarks(); updateLabels(); } }
  function setHover(q, r) { if (S) { S.hover = Number.isInteger(q) && Number.isInteger(r) ? { q, r } : null; updateMarks(); } }

  // ---- Animations ----
  // Every animation takes HEX coordinates and is converted here; nothing is
  // captured in pixels. One list (S.anims) is driven by the render loop. Each
  // record owns whatever it adds (scene meshes, a DOM element, a nudge on a
  // unit instance) and removes it in dispose(), which runs on completion AND
  // when a tick throws, so a dropped animation leaves nothing behind.
  //
  // Meshes are effects above the ground, so by the fog invariant they are all
  // transparent with no depth write and a renderOrder below fogUnseen: the
  // unexplored shell draws over them. Geometry and materials are shared by
  // every particle; fading steps through a few pre-built opacity levels.
  const FX_DEFAULT_MS = { unitWalk: 350, dustParticle: 500, meleeCharge: 600, clashSparks: 500, unitShake: 400,
    floatingText: 1000, screenFlash: 260, archerFire: 300, projectile: 500, rangedImpact: 400, cityFound: 600 };
  const FX_MAX_OBJECTS = 120;          // hard cap on live effect meshes (each is a draw call)
  const FLASH_PEAK = 0.22;             // modest: a flash is a cue, not a strobe
  const FLASH_COOLDOWN_MS = 800;
  const FX_FADE = [0.9, 0.62, 0.36, 0.14];
  let _fxDummy = null;

  function fxKit() {
    if (S.fx) return S.fx;
    const G = THREE;
    const fade = (color, depthTest) => FX_FADE.map((o) => new G.MeshBasicMaterial({ color, transparent: true, opacity: o, depthWrite: false, depthTest, side: G.DoubleSide }));
    const ring = new G.RingGeometry(0.72, 1, 28); ring.rotateX(-Math.PI / 2);
    const arrow = new G.ConeGeometry(0.018, 0.34, 5); arrow.rotateX(Math.PI / 2);   // tip along +z
    S.fx = {
      geo: { puff: new G.IcosahedronGeometry(0.05, 0), spark: new G.TetrahedronGeometry(0.03, 0), ring, arrow },
      mats: { dust: fade('#c9b690', true), spark: fade('#ffd45a', true), ringHit: fade('#ff9a3c', false), ringFound: fade('#ffd54f', false),
        arrow: [new G.MeshBasicMaterial({ color: '#8a6238', transparent: true, opacity: 1, depthWrite: false })] },
    };
    return S.fx;
  }
  function disposeFxKit() {
    if (!S || !S.fx) return;
    for (const g of Object.values(S.fx.geo)) g.dispose();
    for (const set of Object.values(S.fx.mats)) for (const m of set) m.dispose();
    S.fx = null;
  }
  const fadeMat = (set, k) => set[Math.max(0, Math.min(set.length - 1, Math.floor(k * set.length)))];

  function fxMesh(A, geo, mat, x, y, z) {
    if (S.fxCount >= FX_MAX_OBJECTS) return null;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.renderOrder = RENDER_ORDER.fx; m.raycast = () => {};
    S.scene.add(m); A.objs.push(m); S.fxCount++;
    return m;
  }
  function dropAnim(a) {
    if (typeof a.dispose !== 'function') return;
    try { a.dispose(); } catch (err) { console.error('R3D animation cleanup threw:', err); }
  }

  const hexPt = (q, r) => {
    const c = C.hexCenter(q, r), t = tileAt(q, r);
    return { x: c.x, z: c.z, y: t ? surfaceY(tileCopy(t), c.x, c.z, 0) : 0.25 };
  };
  const hexSeen = (q, r) => Number.isInteger(q) && Number.isInteger(r) && !!tileAt(q, r) && fogStateAt(q, r) === C.FOG.VISIBLE;

  // Units are instances: offset one instance matrix, never the state. The
  // base position is the one updatePieces recorded, so a nudge of (0,0,0) is
  // an exact restore, and a rebuild by updatePieces resets it anyway.
  function pieceKeyAt(q, r, p, id) {
    if (!S.pieces) return null;
    if (p !== undefined && id !== undefined && S.pieces.placed.has(p + ':' + id)) return p + ':' + id;
    for (const [k, pl] of S.pieces.placed) if (pl.q === q && pl.r === r) return k;
    return null;
  }
  function nudgePiece(key, dx, dy, dz) {
    const pl = key && S.pieces && S.pieces.placed.get(key);
    if (!pl) return;
    const d = _fxDummy || (_fxDummy = new THREE.Object3D());
    d.position.set(pl.x + dx, pl.y + dy, pl.z + dz); d.rotation.set(0, unitYaw(pl.p, pl.u.id), 0); d.scale.setScalar(UNIT_SCALE);
    d.updateMatrix(); pl.mesh.setMatrixAt(pl.index, d.matrix); pl.mesh.instanceMatrix.needsUpdate = true;
  }

  // A cloud of small meshes with ballistic motion, shrinking as it fades.
  function burst(A, origin, n, set, speed, rise, gravity, geo) {
    const parts = [];
    for (let i = 0; i < n; i++) {
      const m = fxMesh(A, geo, set[0], origin.x, origin.y, origin.z);
      if (!m) break;
      const ang = Math.random() * Math.PI * 2, sp = speed * (0.5 + Math.random() * 0.7);
      parts.push({ m, vx: Math.cos(ang) * sp, vz: Math.sin(ang) * sp, vy: rise * (0.6 + Math.random() * 0.8) });
    }
    return (k, sec) => {
      for (const p of parts) {
        p.m.position.set(origin.x + p.vx * sec, origin.y + p.vy * sec - gravity * sec * sec, origin.z + p.vz * sec);
        p.m.scale.setScalar(Math.max(0.05, 1 - k * 0.75)); p.m.material = fadeMat(set, k);
      }
    };
  }

  const sanitizeColor = (c) => (typeof c === 'string' && /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(c) ? c : '#ffffff');
  const FLASH_RGB = /^\d{1,3},\d{1,3},\d{1,3}$/;

  // Each builder fills in init (first active tick), update(k, sec) and
  // cleanup; returning false rejects the animation.
  const FX = {
    unitWalk(a, A) {
      const from = hexPt(a.q, a.r), to = hexPt(a.toQ, a.toR); let key = null;
      A.update = (k) => {
        key = key || pieceKeyAt(a.toQ, a.toR, a.player, a.unitId);
        const e = k * k * (3 - 2 * k), rest = 1 - e;
        nudgePiece(key, (from.x - to.x) * rest, (from.y - to.y) * rest + Math.abs(Math.sin(k * Math.PI * 3)) * 0.035 * rest, (from.z - to.z) * rest);
      };
      A.cleanup = () => nudgePiece(key, 0, 0, 0);
    },
    dustParticle(a, A) {
      const o = hexPt(a.q, a.r); let m = null;
      A.init = () => { const kit = fxKit(); m = fxMesh(A, kit.geo.puff, kit.mats.dust[0], o.x + (Math.random() - 0.5) * 0.18, o.y + 0.06, o.z + (Math.random() - 0.5) * 0.18); };
      A.update = (k) => { if (!m) return; m.position.y = o.y + 0.06 + k * 0.22; m.scale.setScalar(1 + k * 1.4); m.material = fadeMat(S.fx.mats.dust, k); };
    },
    meleeCharge(a, A) {
      if (reducedMotion) return false;
      const from = hexPt(a.q, a.r), to = hexPt(a.toQ, a.toR); let key = null;
      const ease = (t) => 1 - Math.pow(1 - t, 3);
      A.update = (k) => {
        key = key || pieceKeyAt(a.q, a.r, a.player, a.unitId);
        // charge, hold at the clash, recoil
        const amp = k < 0.35 ? ease(k / 0.35) : k < 0.5 ? 1 : 1 - ease((k - 0.5) / 0.5);
        nudgePiece(key, (to.x - from.x) * 0.6 * amp, 0, (to.z - from.z) * 0.6 * amp);
      };
      A.cleanup = () => nudgePiece(key, 0, 0, 0);
    },
    clashSparks(a, A) {
      const f = hexPt(a.q, a.r), t = Number.isInteger(a.toQ) && Number.isInteger(a.toR) ? hexPt(a.toQ, a.toR) : f; let step = null;
      A.init = () => { const kit = fxKit(); step = burst(A, { x: (f.x + t.x) / 2, y: (f.y + t.y) / 2 + 0.3, z: (f.z + t.z) / 2 }, 8, kit.mats.spark, 0.7, 0.9, 3.5, kit.geo.spark); };
      A.update = (k, sec) => { if (step) step(k, sec); };
    },
    unitShake(a, A) {
      if (reducedMotion) return false;
      let key = null;
      A.update = (k) => { key = key || pieceKeyAt(a.q, a.r, a.player, a.unitId); nudgePiece(key, Math.sin(k * 40) * 0.05 * (1 - k), 0, 0); };
      A.cleanup = () => nudgePiece(key, 0, 0, 0);
    },
    archerFire(a, A) {
      const from = hexPt(a.q, a.r), to = hexPt(a.toQ, a.toR); let key = null;
      const dx = from.x - to.x, dz = from.z - to.z, len = Math.hypot(dx, dz) || 1;
      A.update = (k) => { key = key || pieceKeyAt(a.q, a.r, a.player, a.unitId); const s = Math.sin(Math.PI * k) * 0.06; nudgePiece(key, dx / len * s, 0, dz / len * s); };
      A.cleanup = () => nudgePiece(key, 0, 0, 0);
    },
    projectile(a, A) {
      const n = Math.max(1, Math.min(6, a.count | 0 || 1)), STAG = 80;
      const from = hexPt(a.q, a.r), to = hexPt(a.toQ, a.toR), arrows = [];
      A.dur += STAG * (n - 1);
      const dist = Math.hypot(to.x - from.x, to.z - from.z), h = 0.35 + dist * 0.12, p = new THREE.Vector3(), nx = new THREE.Vector3();
      A.init = () => {
        const kit = fxKit();
        for (let i = 0; i < n; i++) {
          const jx = n > 1 ? (Math.random() - 0.5) * 0.24 : 0, jz = n > 1 ? (Math.random() - 0.5) * 0.24 : 0;
          const m = fxMesh(A, kit.geo.arrow, kit.mats.arrow[0], from.x, from.y + 0.3, from.z);
          if (m) { m.visible = false; arrows.push({ m, i, ex: to.x + jx, ez: to.z + jz }); }
        }
      };
      const at = (ar, t, out) => {
        out.set(from.x + (ar.ex - from.x) * t, from.y + 0.3 + (to.y + 0.05 - from.y - 0.3) * t + Math.sin(Math.PI * t) * h, from.z + (ar.ez - from.z) * t);
      };
      A.update = (k) => {
        const ms = k * A.dur;
        for (const ar of arrows) {
          const t = (ms - ar.i * STAG) / (A.dur - STAG * (n - 1));
          ar.m.visible = t > 0 && t < 1;
          if (!ar.m.visible) continue;
          at(ar, t, p); ar.m.position.copy(p); at(ar, Math.min(1, t + 0.03), nx); ar.m.lookAt(nx);
        }
      };
    },
    rangedImpact(a, A) {
      const o = hexPt(a.q, a.r); let ring = null, step = null;
      A.init = () => {
        const kit = fxKit();
        ring = fxMesh(A, kit.geo.ring, kit.mats.ringHit[0], o.x, o.y + 0.08, o.z);
        step = burst(A, { x: o.x, y: o.y + 0.1, z: o.z }, 4, kit.mats.dust, 0.25, 0.4, 0.6, kit.geo.puff);
      };
      A.update = (k, sec) => { if (ring) { ring.scale.setScalar(0.1 + k * 0.4); ring.material = fadeMat(S.fx.mats.ringHit, k); } if (step) step(k, sec); };
    },
    cityFound(a, A) {
      const o = hexPt(a.q, a.r); let ring = null, step = null;
      A.init = () => {
        const kit = fxKit();
        ring = fxMesh(A, kit.geo.ring, kit.mats.ringFound[0], o.x, o.y + 0.08, o.z);
        step = burst(A, { x: o.x, y: o.y + 0.1, z: o.z }, 10, kit.mats.spark, 0.3, 0.8, -0.4, kit.geo.spark);
      };
      A.update = (k, sec) => { if (ring) { ring.scale.setScalar(0.2 + k * 0.9); ring.material = fadeMat(S.fx.mats.ringFound, k); } if (step) step(k, sec); };
    },
    floatingText(a, A) {
      if (!S.labelRoot || typeof a.text !== 'string') return false;
      const o = hexPt(a.q, a.r), text = a.text.slice(0, 40), color = sanitizeColor(a.color); let el = null;
      A.init = () => {
        // Created HIDDEN. It is revealed only once it has a real screen
        // position, so a fight off-screen never leaves text piled at 0,0.
        el = document.createElement('div'); el.className = 'fx-float'; el.textContent = text;
        Object.assign(el.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none', whiteSpace: 'nowrap', visibility: 'hidden',
          font: '700 14px sans-serif', color, textShadow: '0 1px 2px #000, 0 0 3px #000' });
        S.labelRoot.appendChild(el);
      };
      A.update = (k) => {
        if (!el) return;
        let on = false, tx = 0, ty = 0;
        if (S.vw && fogStateAt(a.q, a.r) === C.FOG.VISIBLE) {     // text over unexplored ground would leak what happened there
          S.camera.updateMatrixWorld();
          _lv.set(o.x, o.y + 0.9 + k * 0.7, o.z).project(S.camera);
          tx = (_lv.x * 0.5 + 0.5) * S.vw; ty = (-_lv.y * 0.5 + 0.5) * S.vh;
          on = _lv.z > -1 && _lv.z < 1 && tx > -60 && tx < S.vw + 60 && ty > -30 && ty < S.vh + 30;
        }
        if (on) {
          el.style.transform = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px) translate(-50%,-100%)';
          el.style.opacity = String(k < 0.25 ? 1 : 1 - (k - 0.25) / 0.75);
          el.style.visibility = 'visible';
        } else { el.style.visibility = 'hidden'; el.style.transform = ''; }
      };
      A.cleanup = () => { if (el && el.parentNode) el.parentNode.removeChild(el); el = null; };
    },
    screenFlash(a, A) {
      // One at a time, a cooldown between flashes, a low peak, and none at all
      // under reduced motion: overlapping flashes read as a strobe. The
      // one-alive check is NOT redundant with the cooldown: a stalled loop can
      // let any wall-clock cooldown lapse before a queued flash has started.
      const now = performance.now();
      if (reducedMotion || now < S.flashNext || S.anims.some((x) => x.type === 'screenFlash')) return false;
      const rgb = FLASH_RGB.test(a.color) ? a.color : '231,76,60'; let el = null;
      A.init = () => {
        const rc = S.canvas.getBoundingClientRect();
        el = document.createElement('div'); el.className = 'fx-flash';
        Object.assign(el.style, { position: 'fixed', left: rc.left + 'px', top: rc.top + 'px', width: rc.width + 'px', height: rc.height + 'px',
          pointerEvents: 'none', zIndex: '40', background: 'rgb(' + rgb + ')', opacity: '0' });
        document.body.appendChild(el);
      };
      A.update = (k) => { if (reducedMotion) { A.stop = true; return; } if (el) el.style.opacity = String(FLASH_PEAK * (k < 0.35 ? k / 0.35 : (1 - k) / 0.65)); };
      // The cooldown runs from the flash's real end (or drop), so a stalled
      // loop cannot let it expire before the flash has even started.
      A.cleanup = () => { S.flashNext = performance.now() + FLASH_COOLDOWN_MS; if (el && el.parentNode) el.parentNode.removeChild(el); el = null; };
    },
  };
  const FX_NEEDS_PAIR = new Set(['unitWalk', 'meleeCharge', 'archerFire', 'projectile']);

  // Returns true when an animation was accepted. Ignored without effect when
  // it is malformed, off the map, or nowhere near ground the player can see.
  function playAnimation(anim) {
    if (!S || !anim || typeof anim !== 'object') return false;
    const build = typeof anim.type === 'string' && Object.hasOwn(FX, anim.type) ? FX[anim.type] : null;
    if (!build) {
      // a bare {tick, dispose?} record: the loop's own contract
      if (typeof anim.tick === 'function') { S.anims.push(anim); requestRender(); return true; }
      return false;
    }
    let gate = null;
    if (anim.type !== 'screenFlash') {
      if (!Number.isInteger(anim.q) || !Number.isInteger(anim.r) || !tileAt(anim.q, anim.r)) return false;
      const pair = Number.isInteger(anim.toQ) && Number.isInteger(anim.toR) && !!tileAt(anim.toQ, anim.toR);
      if (FX_NEEDS_PAIR.has(anim.type) && !pair) return false;
      // Both ends must be in sight: an arrow leaving unexplored ground would
      // say a unit stands there. Re-checked every tick, ground can go dark.
      gate = [[anim.q, anim.r]];
      if (pair && (FX_NEEDS_PAIR.has(anim.type) || anim.type === 'clashSparks')) gate.push([anim.toQ, anim.toR]);
      if (!gate.every(([a, b]) => hexSeen(a, b))) return false;
    }
    const delay = Number.isFinite(anim.delay) ? Math.max(0, Math.min(5000, anim.delay)) : 0;
    const dur = Number.isFinite(anim.duration) && anim.duration > 0 ? Math.min(5000, anim.duration) : FX_DEFAULT_MS[anim.type];
    const A = { type: anim.type, t0: null, delay, dur, objs: [], started: false, init: null, update: null, cleanup: null };
    A.tick = (now) => {
      // Anchored on the first tick. Animations run on performance.now(), not
      // the rAF timestamp: that one can lag and then jump a whole burst ahead.
      if (A.t0 === null) A.t0 = now + A.delay;
      if (now < A.t0) return true;
      if (!A.started) { A.started = true; if (A.init) A.init(); }
      const k = Math.min(1, (now - A.t0) / A.dur);
      if (gate && A.type !== 'floatingText') {
        const ok = gate.every(([a, b]) => hexSeen(a, b));
        for (const m of A.objs) m.visible = ok;
        if (!ok) return k < 1;
      }
      if (A.update) A.update(k, (k * A.dur) / 1000);
      return !A.stop && k < 1;
    };
    A.dispose = () => {
      for (const m of A.objs) S.scene.remove(m);
      S.fxCount = Math.max(0, S.fxCount - A.objs.length); A.objs = [];
      if (A.cleanup) A.cleanup();
    };
    if (build(anim, A) === false) return false;
    S.anims.push(A); requestRender();
    return true;
  }

  // fogAt is the renderer's own gate on top of the game's lookup: every layer
  // that could reveal game state filters through it, as well as sitting under
  // the unexplored shell. Ordering alone is not enough and filtering alone is
  // not enough — a leak needs both to fail.
  window.R3D = { init, rebuildMap, rebuildTile, syncState, setYieldTiles, setSelection, setHover, playAnimation, registerFogHideable, applyFogToScenery,
    refreshFog, fogAt: (q, r) => (S ? fogStateAt(q, r) : C.FOG.UNSEEN), panToHex, centerOn,
    hexAtScreen: pickHex, getCameraView, setQuality, resize, requestRender, dispose };

  window.__r3d = {
    drawCalls: () => (S ? S.renderer.info.render.calls : 0),
    triangles: () => (S ? S.renderer.info.render.triangles : 0),
    sceneCount: () => { let n = 0; if (S) S.scene.traverse(() => { n++; }); return n; },
    // labels: DOM elements held (lifecycle) vs those currently shown (camera/distance/screen)
    labelElements: () => (S ? S.labels.size : 0),
    labelCount: () => (S ? [...S.labels.values()].filter((L) => L.on).length : 0),
    expectedLabelCount: () => {
      if (!S) return 0;
      const st = S.getState() || {}; let n = 0;
      (st.players || []).forEach((pl, p) => {
        for (const u of (pl.units || [])) if (u.hp > 0 && fogStateAt(u.q, u.r) === C.FOG.VISIBLE) n++;
        for (const c of (pl.cities || [])) if (fogStateAt(c.q, c.r) !== C.FOG.UNSEEN) n++;
      });
      return n + [...S.labels.keys()].filter((k) => k.startsWith('yield:')).length;
    },
    labelFor: (kind, id, player) => labelFor(kind, id, player),
    yieldLabelOn: (q, r) => labelFor('yield', q + ',' + r),
    labelsInDom: () => (S && S.labelRoot ? S.labelRoot.querySelectorAll('.lbl').length : 0),
    frames: () => (S ? S.frames : 0),
    tileProbes: () => probes,
    camera: () => (S ? S.camera : null),
    hoverFacts: (q, r) => (S ? factsAt(q, r) : null),
    mouseButtons: () => (S ? S.controls.mouseButtons : null),
    // Client pixels of a tile's surface centre: lets a test aim at a known tile.
    project: (q, r) => {
      if (!S || !tileAt(q, r)) return null;
      const c = C.hexCenter(q, r), tile = tileCopy(tileAt(q, r));
      S.camera.updateMatrixWorld(true);
      const v = new THREE.Vector3(c.x, C.heightAt(tile, c.x, c.z), c.z).project(S.camera), rc = S.canvas.getBoundingClientRect();
      return { x: rc.left + (v.x + 1) / 2 * rc.width, y: rc.top + (1 - v.y) / 2 * rc.height };
    },
    // Shift the orbit target in world units, through the same clamp as every pan.
    panBy: (dx, dz) => { if (S) applyTarget(S.controls.target.x + dx, S.controls.target.z + dz); },
    canvasWidth: () => (S ? S.renderer.domElement.width : 0),
    setCameraDistance: (d) => {
      if (!S) return;
      const t = S.controls.target, dir = S.camera.position.clone().sub(t).normalize();
      S.camera.position.copy(t).addScaledVector(dir, d);
      S.controls.update();
      requestRender();
    },
    setReducedMotion: (b) => { reducedMotion = !!b; },
    animCount: () => (S ? S.anims.length : 0),
    liveAnimations: () => (S ? S.anims.length : 0),
    anims: () => (S ? S.anims : []),
    liveFlashes: () => (S ? S.anims.filter((a) => a.type === 'screenFlash').length : 0),
    flashPeak: () => FLASH_PEAK,
    clearFlash: () => { if (S) { S.anims.filter((a) => a.type === 'screenFlash').forEach(dropAnim); S.anims = S.anims.filter((a) => a.type !== 'screenFlash'); S.flashNext = 0; } },
    // Floating texts shown without a screen position (the 0,0 pile-up bug).
    strayLabels: () => (S && S.labelRoot ? [...S.labelRoot.querySelectorAll('.fx-float')].filter((e) => e.style.visibility !== 'hidden' && !e.style.transform).length : 0),
    fxMeshes: () => { const out = []; if (S) S.scene.traverse((x) => { if (x.isMesh && x.renderOrder === RENDER_ORDER.fx) out.push(x); }); return out; },
    fxLimit: () => FX_MAX_OBJECTS,
    fxMaterials: () => (S && S.fx ? new Set([].concat(...Object.values(S.fx.mats))) : new Set()),
    // How far a unit's instance sits from the spot updatePieces gave it.
    pieceOffset: (p, id) => {
      const pl = S && S.pieces && S.pieces.placed.get(p + ':' + id);
      if (!pl) return null;
      const m = new THREE.Matrix4(); pl.mesh.getMatrixAt(pl.index, m);
      const v = new THREE.Vector3().setFromMatrixPosition(m);
      return { dx: v.x - pl.x, dy: v.y - pl.y, dz: v.z - pl.z };
    },
    controls: () => (S ? S.controls : null),
    chunkCount: () => (S ? S.chunks.filter(Boolean).length : 0),
    visibleChunks: visibleChunkCount,
    chunkVersion: (q, r) => { const ch = S && tileAt(q, r) && S.chunks[chunkKey(q, r)]; return ch ? ch.version : -1; },
    waterLevel: () => (S && S.water ? S.water.mesh.position.y : NaN),
    riverDrawCalls: () => (S && S.river ? 1 : 0),
    // Real built geometry, for assertions that must not trust the bookkeeping.
    tileYRange: (q, r) => {
      const ch = S && tileAt(q, r) && S.chunks[chunkKey(q, r)], rg = ch && ch.ranges.get(r * S.cols + q);
      if (!rg) return null;
      const p = ch.mesh.geometry.attributes.position; let min = Infinity, max = -Infinity;
      for (let i = rg.start; i < rg.start + rg.count; i++) { const y = p.getY(i); if (y < min) min = y; if (y > max) max = y; }
      return { min, max };
    },
    riverQuads: (q, r) => {
      if (!S || !S.river) return [];
      const p = S.river.geo.attributes.position, k = r * S.cols + q, out = [];
      for (const sg of S.riverSegs) if (sg.owners.has(k)) {
        const quad = []; for (let i = 0; i < 4; i++) quad.push([p.getX(sg.vi + i), p.getZ(sg.vi + i)]);
        out.push(quad);
      }
      return out;
    },

    // ---- scenery readers (real built instances, not bookkeeping) ----
    hasResourceArt: (res) => !!RESOURCE_ART[res] && !!(S && S.sceneryGeo[RESOURCE_ART[res].shape]) && RES_SHAPES.has(RESOURCE_ART[res].shape),
    hasImprovementArt: (imp) => !!IMPROVEMENT_ART[imp] && IMPROVEMENT_ART[imp].every((sh) => !!(S && S.sceneryGeo[sh])),
    sceneryMeshCount: () => (S ? S.scenery.length : 0),
    instanceCount: () => { let n = 0; if (S) for (const m of S.scenery) n += m.count; return n; },
    instancesWithoutTile: () => {
      let bad = 0;
      if (!S) return -1;
      for (const m of S.scenery) {
        const tl = m.userData.tiles, base = m.userData.baseMat;
        if (!tl || tl.length !== m.count || !base || base.length !== m.count * 16) { bad += m.count; continue; }
        for (let i = 0; i < m.count; i++) if (!Number.isInteger(tl[i]) || tl[i] < 0 || tl[i] >= S.cols * S.rows) bad++;
      }
      return bad;
    },
    instancesOnTile: (q, r) => { let n = 0; if (S) eachInstance((m, i, t) => { if (t === r * S.cols + q) n++; }); return n; },
    visibleInstancesOnTile: (q, r) => {
      let n = 0;
      if (S) eachInstance((m, i, t, base, arr) => { if (t === r * S.cols + q && arr[i * 16] !== 0) n++; });
      return n;
    },
    resourceInstancesOn: (q, r) => { let n = 0; if (S) eachInstance((m, i, t) => { if (t === r * S.cols + q && RES_SHAPES.has(m.userData.shape) && !PROP_SHAPES.has(m.userData.shape)) n++; }); return n; },
    improvementInstancesOn: (q, r) => { let n = 0; if (S) eachInstance((m, i, t) => { if (t === r * S.cols + q && IMP_SHAPES.has(m.userData.shape)) n++; }); return n; },
    // Count instances far from the live ground surface.
    // Number of matrix floats that differ from the base copy (0 = fully restored).
    matrixFloatsDifferingFromBase: () => {
      let n = 0;
      if (S) for (const m of S.scenery) { const a = m.instanceMatrix.array, b = m.userData.baseMat; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; }
      return n;
    },
    // Instances on a tile whose matrix is exactly the hidden form (15 zeros, w = 1).
    hiddenInstancesOnTile: (q, r) => {
      let n = 0;
      if (S) eachInstance((m, i, t, base, arr) => {
        if (t !== r * S.cols + q) return;
        let z = true; for (let k = 0; k < 15; k++) if (arr[i * 16 + k] !== 0) z = false;
        if (z && arr[i * 16 + 15] === 1) n++;
      });
      return n;
    },
    instancesOfShapeOnTile: (q, r, shape) => { let n = 0; if (S) eachInstance((m, i, t) => { if (t === r * S.cols + q && m.userData.shape === shape) n++; }); return n; },
    // Largest distance between any prop's base and the live ground, per kind.
    maxGroundGap: (peaks) => {
      let mx = 0;
      if (S) eachInstance((m, i, t, base) => {
        const pk = m.userData.shape === 'peak' || m.userData.shape === 'snow';
        if (pk !== !!peaks) return;
        const x = base[i * 16 + 12], y = base[i * 16 + 13], z = base[i * 16 + 14], tile = S.tileIdx.get(t);
        let g = C.heightAt(tile, x, z);
        if (isWaterT(tile.terrain)) g = Math.max(g, WATER_LEVEL);
        mx = Math.max(mx, Math.abs(y - g));
      });
      return mx;
    },
    sharedMeshes: (q1, r1, q2, r2) => {
      let n = 0;
      if (S) for (const m of S.scenery) {
        const tl = m.userData.tiles;
        if (tl.includes(r1 * S.cols + q1) && tl.includes(r2 * S.cols + q2)) n++;
      }
      return n;
    },
    propsOffGround: () => {
      let bad = 0;
      if (!S) return -1;
      eachInstance((m, i, t, base) => {
        const x = base[i * 16 + 12], y = base[i * 16 + 13], z = base[i * 16 + 14], tile = S.tileIdx.get(t);
        let g = C.heightAt(tile, x, z);
        if (isWaterT(tile.terrain)) g = Math.max(g, WATER_LEVEL);
        const lim = (m.userData.shape === 'peak' || m.userData.shape === 'snow') ? 0.9 : 0.25;
        if (Math.abs(y - g) > lim) bad++;
      });
      return bad;
    },
    // Order-sensitive digest of every instance matrix and tile; 0 when empty.
    sceneryHash: () => {
      let h = 0;
      if (S) for (const m of S.scenery) {
        const b = m.userData.baseMat, tl = m.userData.tiles;
        for (let i = 0; i < b.length; i++) h = (Math.imul(h, 31) + Math.round(b[i] * 1000)) | 0;
        for (let i = 0; i < tl.length; i++) h = (Math.imul(h, 31) + tl[i]) | 0;
      }
      return h;
    },
    riverSegmentsOn: (q, r) => (S ? (S.riverOwners.get(r * S.cols + q) || 0) : 0),


    // ---- marks readers (the real built layers) ----
    gridDrawCalls: () => layerDrawCalls(['grid']),
    overlayDrawCalls: () => layerDrawCalls(['overlays']),
    markDrawCalls: () => layerDrawCalls(MARK_NAMES),
    ...PIECE_READERS,
    gridOpacity: () => (S && S.marks ? S.marks.grid.material.opacity : NaN),
    gridSegments: () => (S && S.marks ? S.marks.gridSegments : -1),
    gridHasEdge: (q1, r1, q2, r2) => {
      if (!S || !S.marks) return false;
      const a = r1 * S.cols + q1, b = tileAt(q2, r2) ? r2 * S.cols + q2 : -1;
      return S.marks.gridEdges.has(Math.min(a, b) + '|' + Math.max(a, b));
    },
    litTiles: () => (S && S.marks ? S.marks.litRanges.length : -1),
    // Each lit tile read back from the real vertex and colour buffers: centre
    // of its triangles, highest vertex, and colour.
    litList: () => {
      if (!S || !S.marks) return [];
      const g = S.marks.overlays.geometry, p = g.attributes.position, k = g.attributes.color, out = [];
      if (!p) return out;
      for (const rg of S.marks.litRanges) {
        let x = 0, z = 0, y = -Infinity;
        for (let i = rg.start; i < rg.start + rg.count; i++) { x += p.getX(i); z += p.getZ(i); y = Math.max(y, p.getY(i)); }
        const c = new THREE.Color(k.getX(rg.start), k.getY(rg.start), k.getZ(rg.start));
        out.push({ x: x / rg.count, z: z / rg.count, y, color: c.getHex() });
      }
      return out;
    },
    territoryTiles: () => (S && S.marks ? S.marks.territoryCount : -1),
    borderSegments: () => (S && S.marks ? S.marks.borderSegments : -1),
    ringCentre: (which) => (S && S.marks ? ringCentre(S.marks[which === 'hover' ? 'hoverRing' : 'selRing']) : null),
    // Lowest and highest vertex y of a mark layer, from the real buffer.
    markYRange: (name) => {
      const p = S && S.marks && S.marks[name].geometry.attributes.position;
      if (!p) return null;
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < p.count; i++) { min = Math.min(min, p.getY(i)); max = Math.max(max, p.getY(i)); }
      return { min, max };
    },
    // Show or hide one mark layer (or all of them with no name).
    setMarksVisible: (b, name) => {
      if (!S || !S.marks) return;
      for (const k of (name ? [name] : MARK_NAMES)) { if (b) S.marks.hidden.delete(k); else S.marks.hidden.add(k); applyMarkVisibility(k); }
      requestRender();
    },
    // One pass of the render loop with a caller-supplied clock.
    step: (now) => (S ? step(now) : false),
    // Same, with the animation clock pinned to t as well.
    stepFx: (t) => { if (!S) return false; S.fxT = t; try { return step(t); } finally { S.fxT = null; S.lastAmbient = 0; } },
    resetAmbientClock: () => { if (S) S.lastAmbient = 0; },

    // ---- fog readers (the real built buffers, not bookkeeping) ----
    tileInfo: (q, r) => {
      const t = S && tileAt(q, r);
      return t ? { q, r, terrain: t.terrain, base: C.tileBase(t), water: t.terrain <= 1,
        subdivisions: C.subdivisions(t), hasCity: S.cityTiles.has(r * S.cols + q) } : null;
    },
    fogOf: (q, r) => (S ? fogStateAt(q, r) : -1),
    fogWrites: () => (S && S.fog ? S.fog.writes : -1),
    fogDrawCalls: () => (S && S.fog ? ['remembered', 'unseen'].filter((k) => S.fog[k].mesh.parent === S.scene).length : 0),
    fogGeometryKey: () => (S && S.fog ? S.fog.remembered.geo.uuid + '|' + S.fog.unseen.geo.uuid + '|' + S.fog.base.length : ''),
    renderOrderOf: (name) => {
      const live = S && S.layers[name];      // the real mesh once its task builds it
      return live ? live.renderOrder : (name in RENDER_ORDER ? RENDER_ORDER[name] : NaN);
    },
    drawablesAtOrAboveUnseenFog: () => {
      if (!S || !S.fog) return -1;
      const top = S.fog.unseen.mesh;
      let n = 0;
      S.scene.traverse((x) => {
        if (x !== top && (x.isMesh || x.isLine || x.isPoints || x.isSprite) && x.renderOrder >= top.renderOrder) n++;
      });
      return n;
    },
    fogShellState,
    fogShellCovers: (q, r) => fogShellState('remembered', q, r) === 'live' || fogShellState('unseen', q, r) === 'live',
    fogShellVertices: (q, r, part) => {
      const rg = fogRange(q, r);
      if (!rg) return [];
      const b = S.fog.base, out = [];
      const from = part === 'skirt' ? rg.start + rg.topCount : rg.start;
      const to = part === 'top' ? rg.start + rg.topCount : rg.start + rg.count;
      for (let i = from; i < to; i++) out.push([b[i * 3], b[i * 3 + 1], b[i * 3 + 2]]);
      return out;
    },
    fogShellTopTriangles: (q, r) => { const rg = fogRange(q, r); return rg ? rg.topCount / 3 : -1; },
    fogShellMinY: (q, r) => {
      const rg = fogRange(q, r);
      if (!rg) return NaN;
      const b = S.fog.base;
      let min = Infinity;
      for (let i = rg.start; i < rg.start + rg.count; i++) min = Math.min(min, b[i * 3 + 1]);
      return min;
    },
    // 'centre' takes the vertex nearest the hex centre (which the fan always
    // has), 'rim' the farthest; both from the top surface only.
    fogShellHeightAt: (q, r, where) => {
      const rg = fogRange(q, r);
      if (!rg) return NaN;
      const c = C.hexCenter(q, r), b = S.fog.base, rim = where === 'rim';
      let y = NaN, bd = rim ? -1 : Infinity;
      for (let i = rg.start; i < rg.start + rg.topCount; i++) {
        const d = Math.hypot(b[i * 3] - c.x, b[i * 3 + 2] - c.z);
        if (rim ? d > bd : d < bd) { bd = d; y = b[i * 3 + 1]; }
      }
      return y;
    },
    terrainSkirtFloor: () => SKIRT_EDGE_Y,
    // Every drawable above the terrain band (renderOrder > 0) must be
    // transparent and must not write depth. renderOrder only sorts
    // transparent objects against each other: an OPAQUE overlay draws in the
    // opaque pass, writes depth, and — since the shell floats a mere 0.045
    // over the ground — passes the depth test and shows straight through the
    // fog, whatever its renderOrder says. That was leak 3.
    depthWritingLayersAboveTerrain: () => {
      if (!S) return -1;
      let n = 0;
      S.scene.traverse((x) => {
        if (!(x.isMesh || x.isLine || x.isPoints || x.isSprite) || x.renderOrder <= 0) return;
        // Either the layer is see-through and writes no depth (fog covers it),
        // or it is culled by fog outright (units: proven by instance counts).
        // A flag alone proves nothing: it must be a real unit mesh, owned by
        // the unit cull (type set, registered in S.pieces.meshes).
        if (x.userData && x.userData.fogCulled === true && x.userData.type !== undefined && S.pieces
            && [...S.pieces.meshes.values()].some((e) => e.mesh === x)) return;
        for (const m of [].concat(x.material)) if (m && (m.depthWrite !== false || m.transparent !== true)) n++;
      });
      return n;
    },
    // Test-only camera placement: aim at a tile, orbit to (dist, polar, az).
    lookAt: (q, r, dist, polar, az, ty) => {
      if (!S) return;
      const c = C.hexCenter(q, r), t = S.controls.target;
      t.set(c.x, ty === undefined ? 0.2 : ty, c.z);
      S.camera.position.set(c.x + dist * Math.sin(polar) * Math.sin(az),
        t.y + dist * Math.cos(polar), c.z + dist * Math.sin(polar) * Math.cos(az));
      S.controls.update();
      requestRender();
    },
    setWaterVisible: (b) => { if (S && S.water) { S.water.mesh.visible = !!b; requestRender(); } },
    setTerrainVisible: (b) => {
      if (!S) return;
      // The ground stays in the scene, still writing depth, and only stops
      // writing colour. Hiding it outright also removes the depth test that
      // keeps the fog shell's far-side faces from being drawn, so the frame
      // changes for reasons that have nothing to do with the ground showing.
      const meshes = S.chunks.filter(Boolean).map((ch) => ch.mesh);
      if (S.river) meshes.push(S.river.mesh);
      for (const m of meshes) for (const mat of [].concat(m.material)) { mat.colorWrite = !!b; }
      requestRender();
    },
    // Draws a frame and reads it back before it is presented, so assertions
    // can look at pixels. Rows run bottom-up, RGBA. No assertion can see a
    // leak the geometry allows but the depth test hides, so some have to.
    renderAndSample: (x, y, w, h) => {
      if (!S) return null;
      updateGridFade();
      S.renderer.render(S.scene, S.camera);
      const gl = S.renderer.getContext(), px = new Uint8Array(w * h * 4);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    },
    visibleInstancesOn: (q, r) => {
      let n = 0;
      if (S) eachInstance((m, i, t, base, arr) => { if (t === r * S.cols + q && arr[i * 16] !== 0) n++; });
      return n;
    },
  };
  // The fog filter bypass exists only so pixel tests can prove the draw order
  // and transparency hold on their own. It is not part of the page's surface:
  // it is defined only when the test harness has declared itself first.
  if (window.R3D_TEST === true) {
    window.__r3d.setMarksUnfiltered = (b) => { if (S) { S.unfiltered = !!b; updateMarks(); updatePieces(); } };
  }
})();
