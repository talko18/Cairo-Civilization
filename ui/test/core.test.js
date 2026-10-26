const test = require('node:test');
const assert = require('node:assert');
const C = require('../render3d-core.js');
const SQ3 = Math.sqrt(3);

test('hexCenter places even and odd columns', () => {
  assert.deepStrictEqual(C.hexCenter(0, 0), {x: 0, z: 0});
  assert.deepStrictEqual(C.hexCenter(2, 1), {x: 3, z: SQ3});
  // odd columns shift DOWN by half a hex height
  assert.deepStrictEqual(C.hexCenter(1, 0), {x: 1.5, z: SQ3 / 2});
});

test('hexCorner 0 is due east', () => {
  const [x, z] = C.hexCorner(0);
  assert.ok(Math.abs(x - 1) < 1e-9);
  assert.ok(Math.abs(z) < 1e-9);
});

test('neighbor tables match the contract edge order', () => {
  // edge 0 = upper-right, edge 3 = lower-left, from index.html:1365
  assert.deepStrictEqual(C.neighbor(2, 2, 0), [3, 1]);
  assert.deepStrictEqual(C.neighbor(3, 2, 0), [4, 2]);
  assert.deepStrictEqual(C.neighbor(2, 2, 3), [1, 2]);
});

test('neighbor is reversible across the shared edge', () => {
  for (let e = 0; e < 6; e++) {
    const [nq, nr] = C.neighbor(4, 4, e);
    assert.deepStrictEqual(C.neighbor(nq, nr, (e + 3) % 6), [4, 4]);
  }
});

test('hexDist matches offset-coordinate distance', () => {
  assert.strictEqual(C.hexDist(0, 0, 0, 0), 0);
  assert.strictEqual(C.hexDist(2, 2, 3, 2), 1);
  assert.strictEqual(C.hexDist(0, 0, 4, 0), 4);
});

test('worldToHex inverts hexCenter for every tile', () => {
  for (let q = 0; q < 32; q++) for (let r = 0; r < 20; r++) {
    const c = C.hexCenter(q, r);
    assert.deepStrictEqual(C.worldToHex(c.x, c.z, 32, 20), {q, r});
  }
});

test('worldToHex returns null outside the grid', () => {
  assert.strictEqual(C.worldToHex(-50, -50, 32, 20), null);
  assert.strictEqual(C.worldToHex(1000, 1000, 32, 20), null);
});

test('water sits below land and hills rise highest', () => {
  const ocean = {terrain: 0}, grass = {terrain: 2}, hills = {terrain: 3};
  assert.ok(C.tileBase(ocean) < C.tileBase(grass));
  assert.ok(C.tileAmp(hills) > C.tileAmp(grass));
});

test('heightAt returns exactly tileBase at every hex corner', () => {
  // the elevation falloff reaches zero at tile edges - the fog shell and the
  // chunk seams both depend on this
  const t = {terrain: 3, q: 4, r: 4};
  const c = C.hexCenter(4, 4);
  for (let i = 0; i < 6; i++) {
    const [dx, dz] = C.hexCorner(i);
    const h = C.heightAt(t, c.x + dx, c.z + dz);
    assert.ok(Math.abs(h - C.tileBase(t)) < 1e-6, `corner ${i} was ${h}`);
  }
});

test('a hill is higher at its centre than at its rim', () => {
  const t = {terrain: 3, q: 4, r: 4};
  const c = C.hexCenter(4, 4);
  assert.ok(C.heightAt(t, c.x, c.z) > C.heightAt(t, c.x + 0.9, c.z));
});

test('colorAt returns channels in 0..1', () => {
  const t = {terrain: 2, q: 1, r: 1};
  const c = C.hexCenter(1, 1);
  const col = C.colorAt(t, c.x, c.z, 0.25, () => null);
  for (const k of ['r', 'g', 'b']) {
    assert.ok(col[k] >= 0 && col[k] <= 1, `${k} out of range: ${col[k]}`);
  }
});

test('land next to water gets a beach tint', () => {
  const grass = {terrain: 2, q: 1, r: 1}, ocean = {terrain: 0, q: 2, r: 1};
  const c = C.hexCenter(1, 1);
  const lookup = (q, r) => (q === 2 && r === 1 ? ocean : null);
  const [dx, dz] = C.hexCorner(0);
  const edge = C.colorAt(grass, c.x + dx * 0.95, c.z + dz * 0.95, 0.25, lookup);
  const mid = C.colorAt(grass, c.x, c.z, 0.25, lookup);
  assert.ok(edge.r > mid.r, 'tile edge next to ocean should be sandier');
});

test('subdivisions are coarser for ocean than for hills', () => {
  assert.ok(C.subdivisions({terrain: 0}) < C.subdivisions({terrain: 3}));
});

test('river edge d lands on the edge shared with neighbour d', () => {
  // src/hex.cairo:12-19 defines direction d (0=upper-right ... 5=lower-right)
  // and generate_rivers builds the mask from direction_between, so bit d means
  // "the edge shared with neighbour d". Geometrically that edge spans corners
  // (5-d) and (6-d)%6. Getting this wrong rotates every river on the map.
  // NOTE: drawMap in ui/index.html draws corners d..d+1, which is one position
  // off. That is a pre-existing bug and is deliberately not ported.
  const t = {terrain: 2, q: 4, r: 4, riverEdges: 0b000001};
  const segs = C.riverEdges(t);
  assert.strictEqual(segs.length, 1);
  assert.strictEqual(segs[0].edge, 0);
  const c = C.hexCenter(4, 4), [ax, az] = C.hexCorner(5), [bx, bz] = C.hexCorner(0);
  assert.ok(Math.abs(segs[0].x1 - (c.x + ax)) < 1e-9);
  assert.ok(Math.abs(segs[0].z1 - (c.z + az)) < 1e-9);
  assert.ok(Math.abs(segs[0].x2 - (c.x + bx)) < 1e-9);
  assert.ok(Math.abs(segs[0].z2 - (c.z + bz)) < 1e-9);
});

test('a river edge is the same two world points from either tile', () => {
  // the property that makes a river continuous: tile A's edge d and the
  // neighbour's edge (d+3)%6 must be one physical segment
  const key = (s) => [s.x1, s.z1, s.x2, s.z2].map(v => v.toFixed(6)).sort().join('|');
  for (let d = 0; d < 6; d++) {
    const [nq, nr] = C.neighbor(4, 4, d);
    const a = C.riverEdges({q: 4, r: 4, riverEdges: 1 << d})[0];
    const b = C.riverEdges({q: nq, r: nr, riverEdges: 1 << ((d + 3) % 6)})[0];
    assert.strictEqual(key(a), key(b), `edge ${d} must be shared with neighbour ${d}`);
  }
});

test('riverEdges returns one segment per set bit, none when clear', () => {
  assert.deepStrictEqual(C.riverEdges({q: 1, r: 1, riverEdges: 0}), []);
  assert.strictEqual(C.riverEdges({q: 1, r: 1, riverEdges: 0b101010}).length, 3);
  assert.deepStrictEqual(C.riverEdges({q: 1, r: 1, riverEdges: 0b010100})
    .map(s => s.edge), [2, 4]);
});

test('fogOf maps explored and visible flags to the three states', () => {
  assert.strictEqual(C.fogOf(true, true, true), C.FOG.VISIBLE);
  assert.strictEqual(C.fogOf(true, false, true), C.FOG.REMEMBERED);
  assert.strictEqual(C.fogOf(false, false, true), C.FOG.UNSEEN);
});

test('fog disabled makes everything visible', () => {
  assert.strictEqual(C.fogOf(false, false, false), C.FOG.VISIBLE);
});

test('tileFacts hides everything on an unseen tile', () => {
  const t = {terrain: 3, feature: 1, resource: 7, improvement: 2,
             city: {name: 'Thebes'}, units: [{unitType: 3}]};
  const f = C.tileFacts(t, C.FOG.UNSEEN);
  assert.strictEqual(f.terrain, null);
  assert.strictEqual(f.resource, null);
  assert.strictEqual(f.city, null);
  assert.deepStrictEqual(f.units, []);
});

test('tileFacts remembers the land but not who stands on it', () => {
  const t = {terrain: 3, feature: 1, resource: 7, improvement: 2,
             city: {name: 'Thebes'}, units: [{unitType: 3}]};
  const f = C.tileFacts(t, C.FOG.REMEMBERED);
  assert.strictEqual(f.terrain, 3);
  assert.strictEqual(f.improvement, 2);
  assert.ok(f.city, 'a remembered city stays on the map');
  assert.deepStrictEqual(f.units, [], 'units must not show on remembered ground');
});

test('tileFacts shows everything on a visible tile', () => {
  const t = {terrain: 3, feature: 1, resource: 7, improvement: 2,
             city: null, units: [{unitType: 3}]};
  const f = C.tileFacts(t, C.FOG.VISIBLE);
  assert.strictEqual(f.terrain, 3);
  assert.strictEqual(f.units.length, 1);
});

const allVisible = () => C.FOG.VISIBLE;

test('overlayList colours each selection category', () => {
  const list = C.overlayList({kind: 'unit', q: 4, r: 4,
    moveTiles: [{q: 5, r: 4}], attackTiles: [{q: 6, r: 4}],
    rangedTiles: [], workedTiles: [], lockedTiles: []}, allVisible);
  assert.strictEqual(list.find(o => o.q === 5).color, C.OV.move);
  assert.strictEqual(list.find(o => o.q === 6).color, C.OV.atk);
});

test('an overlay never lights an unexplored tile', () => {
  // lighting unknown ground gives away that the ground is there
  const fogAt = (q) => (q === 5 ? C.FOG.UNSEEN : C.FOG.VISIBLE);
  const list = C.overlayList({kind: 'unit', q: 4, r: 4,
    moveTiles: [{q: 5, r: 4}, {q: 3, r: 4}], attackTiles: [],
    rangedTiles: [], workedTiles: [], lockedTiles: []}, fogAt);
  assert.strictEqual(list.filter(o => o.q === 5).length, 0);
  assert.strictEqual(list.filter(o => o.q === 3).length, 1);
});

test('remembered tiles still take overlays', () => {
  // you can plan a move onto ground you have seen before
  const list = C.overlayList({kind: 'unit', q: 4, r: 4,
    moveTiles: [{q: 5, r: 4}], attackTiles: [], rangedTiles: [],
    workedTiles: [], lockedTiles: []}, () => C.FOG.REMEMBERED);
  assert.strictEqual(list.length, 1);
});

test('no selection means no overlays', () => {
  assert.deepStrictEqual(C.overlayList({kind: null}, allVisible), []);
});

test('clampTarget keeps the camera over the map', () => {
  const far = C.clampTarget(-999, -999, 32, 20);
  assert.ok(far.x > -20 && far.z > -20);
  const mid = C.clampTarget(10, 10, 32, 20);
  assert.deepStrictEqual(mid, {x: 10, z: 10});
});

test('tileFacts on an unseen tile nulls every field of the contract', () => {
  const t = {terrain: 3, feature: 1, resource: 7, improvement: 2,
             city: {name: 'Thebes'}, units: [{unitType: 3}]};
  const f = C.tileFacts(t, C.FOG.UNSEEN);
  assert.deepStrictEqual(f, {terrain: null, feature: null, resource: null,
    improvement: null, city: null, units: []});
});

test('a remembered city is stripped to identity fields', () => {
  const t = {terrain: 3, city: {name: 'Thebes', q: 4, r: 4, ownerPlayer: 1,
    isCapital: 1, hp: 77, currentProduction: 66, population: 5, buildings: 3,
    foodStockpile: 9, productionStockpile: 8}, units: []};
  const f = C.tileFacts(t, C.FOG.REMEMBERED);
  assert.strictEqual(f.city.name, 'Thebes');
  for (const k of ['hp', 'currentProduction', 'population', 'buildings',
    'foodStockpile', 'productionStockpile']) {
    assert.ok(!(k in f.city) || f.city[k] === undefined, `${k} must not survive`);
  }
});

test('tileFacts fails closed on bad fog and missing tiles', () => {
  const t = {terrain: 3, feature: 1, resource: 7, improvement: 2,
             city: {name: 'Thebes'}, units: [{unitType: 3}]};
  const none = {terrain: null, feature: null, resource: null,
    improvement: null, city: null, units: []};
  assert.deepStrictEqual(C.tileFacts(t, undefined), none);
  assert.deepStrictEqual(C.tileFacts(t, null), none);
  assert.deepStrictEqual(C.tileFacts(t, 99), none);
  assert.deepStrictEqual(C.tileFacts(null, C.FOG.VISIBLE), none);
});

test('every overlay category skips an unseen tile', () => {
  const cats = ['moveTiles', 'attackTiles', 'rangedTiles', 'workedTiles', 'lockedTiles'];
  for (const cat of cats) {
    const sel = {kind: 'unit', q: 4, r: 4, moveTiles: [], attackTiles: [],
      rangedTiles: [], workedTiles: [], lockedTiles: []};
    sel[cat] = [{q: 5, r: 4}, {q: 3, r: 4}];
    const list = C.overlayList(sel,
      (q) => (q === 5 ? C.FOG.UNSEEN : C.FOG.VISIBLE));
    assert.strictEqual(list.filter(o => o.q === 5).length, 0, `${cat} lit unseen ground`);
    assert.strictEqual(list.filter(o => o.q === 3).length, 1, `${cat} lost a visible tile`);
  }
});

test('a city tile is flattened to a fifth of its elevation', () => {
  const t = {terrain: 3, q: 4, r: 4}, c = C.hexCenter(4, 4);
  const x = c.x + 0.2, z = c.z + 0.1, base = C.tileBase(t);
  const raw = C.heightAt(t, x, z) - base;
  assert.ok(Math.abs(raw) > 0.05, 'fixture point must have real relief');
  const flat = C.heightAt({...t, hasCity: true}, x, z) - base;
  assert.ok(Math.abs(flat - raw * 0.2) < 1e-9, `flat ${flat} vs ${raw * 0.2}`);
  // still exactly tileBase at corners, so seams are unaffected
  const [dx, dz] = C.hexCorner(2);
  assert.ok(Math.abs(C.heightAt({...t, hasCity: true}, c.x + dx, c.z + dz) - base) < 1e-6);
  // without the flag nothing changes
  assert.strictEqual(C.heightAt({...t, hasCity: false}, x, z), C.heightAt(t, x, z));
});
