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
    S.terrainMat.dispose();
    S.renderer.dispose();
    S = null;
  }

  // Placeholders that later tasks replace.
  function rebuildMap() {
    if (!S) return;
    const st = S.getState() || {};
    disposeTerrain();
    indexState(st);
    for (let cr = 0; cr < S.chunksY; cr++) for (let cq = 0; cq < S.chunksX; cq++) rebuildChunk(cq, cr);
    buildWater();
    buildRivers();
    requestRender();
  }

  // Terrain changed on one tile (improvement built, feature removed, city
  // founded): rebuild only the chunk that owns it. Fog never calls this.
  function rebuildTile(q, r) {
    if (!S) return;
    indexState(S.getState());
    if (!tileAt(q, r)) return;
    rebuildChunk(Math.floor(q / CHUNK), Math.floor(r / CHUNK));
    requestRender();
  }
  function syncState() { requestRender(); }
  function setSelection(sel) { if (S) S.selection = sel; requestRender(); }
  function playAnimation(anim) { if (S && anim) { S.anims.push(anim); requestRender(); } }

  window.R3D = { init, rebuildMap, rebuildTile, syncState, setSelection, playAnimation, panToHex, centerOn,
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
    riverSegmentsOn: (q, r) => (S ? (S.riverOwners.get(r * S.cols + q) || 0) : 0),
  };
})();
