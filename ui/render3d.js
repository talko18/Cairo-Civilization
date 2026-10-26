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
    };
    controls.addEventListener('change', requestRender);
    S.onResize = () => resize();
    window.addEventListener('resize', S.onResize);
    resize();
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
    // controls.update() returns true while damping/pan is still moving.
    const moved = S.controls.update();
    if (moved) clampCamera();
    if (S.needsRender || live || moved) {
      S.needsRender = false;
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
    S.renderer.dispose();
    S = null;
  }

  // Placeholders that later tasks replace.
  function rebuildMap() { requestRender(); }
  function syncState() { requestRender(); }
  function setSelection(sel) { if (S) S.selection = sel; requestRender(); }
  function playAnimation(anim) { if (S && anim) { S.anims.push(anim); requestRender(); } }

  window.R3D = { init, rebuildMap, syncState, setSelection, playAnimation, panToHex, centerOn,
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
  };
})();
