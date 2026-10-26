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
