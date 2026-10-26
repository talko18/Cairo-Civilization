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
  const RIVER_W = 0.14;          // ribbon width in world units
  const AMBIENT_MS = 50;         // idle water tick (~20 fps); most frames stay unrendered
  const SKIRT_LAND = [0x6e / 255, 0x57 / 255, 0x3c / 255];
  const SKIRT_SEA = [0x16 / 255, 0x3a / 255, 0x52 / 255];

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
      const yb = nb ? nbBase - 0.05 : -1.2;
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
      p[i + 1] = 0.022 * Math.sin(x * 1.6 + t * 1.3) + 0.016 * Math.sin(z * 2.1 - t * 1.1 + x * 0.4);
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
      fogAt: opts.fogAt || (() => 2),   // stored for later tasks; unused for now
      onTileClick: opts.onTileClick || null,
      onTileHover: opts.onTileHover || null,
      needsRender: true, frames: 0, raf: 0, fly: null, anims: [],
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
    S.raf = requestAnimationFrame(loop);
    return true;
  }

  function loop(now) {
    if (!S) return;
    S.raf = requestAnimationFrame(loop);
    let live = false;
    if (S.fly) {
      const f = S.fly, k = Math.min(1, (now - f.t0) / f.dur), e = k * k * (3 - 2 * k);
      applyTarget(f.fx + (f.tx - f.fx) * e, f.fz + (f.tz - f.fz) * e);
      if (k >= 1) S.fly = null;
      live = true;
    }
    if (S.anims.length) {
      // One misbehaving animation must never stop the renderer: drop it and log.
      S.anims = S.anims.filter((a) => {
        try { return typeof a.tick === 'function' ? a.tick(now) !== false : false; }
        catch (err) { console.error('R3D animation threw and was dropped:', err); return false; }
      });
      live = true;
    }
    // Water drifts at a low ambient rate so an idle map still breathes without
    // redrawing every frame; any frame drawn for another reason advances it too.
    if (!reducedMotion && now - S.lastAmbient >= AMBIENT_MS) S.needsRender = true;
    // controls.update() returns true while damping/pan is still moving.
    const moved = S.controls.update();
    if (moved) clampCamera();
    if (S.needsRender || live || moved) {
      S.needsRender = false;
      S.lastAmbient = now;
      animateSurfaces(now);
      S.renderer.render(S.scene, S.camera);
      S.frames++;
    }
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
    S.controls.dispose();
    disposeTerrain();
    disposeScenery();
    for (const g of Object.values(S.sceneryGeo)) g.dispose();
    S.terrainMat.dispose();
    S.renderer.dispose();
    S = null;
  }

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
    requestRender();
  }
  function syncState() { requestRender(); }
  function setSelection(sel) { if (S) S.selection = sel; requestRender(); }
  function playAnimation(anim) { if (S && anim) { S.anims.push(anim); requestRender(); } }

  window.R3D = { init, rebuildMap, rebuildTile, syncState, setSelection, playAnimation, registerFogHideable, applyFogToScenery, panToHex, centerOn,
    getCameraView, setQuality, resize, requestRender, dispose };

  window.__r3d = {
    drawCalls: () => (S ? S.renderer.info.render.calls : 0),
    triangles: () => (S ? S.renderer.info.render.triangles : 0),
    sceneCount: () => { let n = 0; if (S) S.scene.traverse(() => { n++; }); return n; },
    labelCount: () => 0,
    frames: () => (S ? S.frames : 0),
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
  };
})();
