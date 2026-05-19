// Self-contained tests for floorSystemRules.js. Run: node src/floorSystemRules.test.js
import assert from 'node:assert/strict';
import { sumMaterials, SOLO_SECTIONS } from './wallRules.js';
import {
  computeFloorSystemMaterials,
  CATEGORIES,
  SECTION_FLOOR_SYSTEM,
} from './floorSystemRules.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); failed++; }
}
const findRow = (rows, category) => rows.find((r) => r.category === category);
const findRowByName = (rows, name) => rows.find((r) => r.name === name);

// 32 × 40 rectangle, 1 ft per grid unit. Polygon corners in grid units.
const polygon32x40 = [
  { x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 40 }, { x: 0, y: 40 },
];
const baseGeom = {
  floor_area_sf:      1280,
  floor_perimeter_ft: 144,
  floor_polygon:      polygon32x40,
  joist_size:         '2x8',
  joist_spacing_in:   16,
  foundation_type:    'basement',
  scaleFtPerGrid:     1,
};

console.log('\n=== Section + structure ===');
test('Section matches SOLO_SECTIONS', () => {
  assert.equal(SECTION_FLOOR_SYSTEM, SOLO_SECTIONS.FLOOR_SYSTEM);
});
test('Slab foundation → []', () => {
  const rows = computeFloorSystemMaterials({ ...baseGeom, foundation_type: 'slab' }, {});
  assert.deepEqual(rows, []);
});
test('Empty polygon → []', () => {
  const rows = computeFloorSystemMaterials({ ...baseGeom, floor_polygon: [] }, {});
  assert.deepEqual(rows, []);
});
test('Crawl space behaves like basement', () => {
  const rows = computeFloorSystemMaterials({ ...baseGeom, foundation_type: 'crawl_space' }, {});
  assert.ok(rows.length > 0);
});

console.log('\n=== Reference 32x40 basement floor (2x8 @ 16" o.c.) ===');
test('Rim joist = perimeter / 16, lumber name 2 X 8 X 16 PRESSURE TREATED', () => {
  const rows = sumMaterials(computeFloorSystemMaterials(baseGeom, {}));
  const r = findRow(rows, CATEGORIES.RIM_JOIST);
  // 144 / 16 = 9 → ceil 9
  assert.equal(r.quantity, 9);
  assert.equal(r.name, '2 X 8 X 16 PRESSURE TREATED');
});
test('Floor joists: count = ceil(40 × 12 / 16) + 1 = 31, × 1.05 waste → 33', () => {
  const rows = sumMaterials(computeFloorSystemMaterials(baseGeom, {}));
  const r = findRow(rows, CATEGORIES.FLOOR_JOISTS);
  // 31 × 1.05 = 32.55 → ceil 33
  assert.equal(r.quantity, 33);
  // Span 32ft caps at 16ft (longest stock length) — framer cuts to fit.
  assert.equal(r.name, '2 X 8 X 16 PRESSURE TREATED');
});

console.log('\n=== Verifying joist length rounding ===');
// Span = min(32, 40) = 32. roundUpLumberLength(32) = 16 (caps at 16).
// So joist name is "2 X 8 X 16 PRESSURE TREATED". Update test above.
test('Joist length caps at 16ft for spans > 16 (framer cuts to fit)', () => {
  const rows = sumMaterials(computeFloorSystemMaterials(baseGeom, {}));
  const r = findRow(rows, CATEGORIES.FLOOR_JOISTS);
  assert.equal(r.name, '2 X 8 X 16 PRESSURE TREATED');
});

console.log('\n=== Span / run derivation ===');
test('Bounding-box span = short dim, run = long dim', () => {
  // 32 wide × 40 deep: span = 32, run = 40 → joist count = ceil(40×12/16)+1 = 31
  // 40 wide × 32 deep: span = 32, run = 40 — same result.
  const rotated = [
    { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 32 }, { x: 0, y: 32 },
  ];
  const a = sumMaterials(computeFloorSystemMaterials(baseGeom, {}));
  const b = sumMaterials(computeFloorSystemMaterials({ ...baseGeom, floor_polygon: rotated }, {}));
  const ra = findRow(a, CATEGORIES.FLOOR_JOISTS);
  const rb = findRow(b, CATEGORIES.FLOOR_JOISTS);
  assert.equal(ra.quantity, rb.quantity);
});
test('20ft × 20ft span (< 16ft min dim test)', () => {
  const poly = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 20 }, { x: 0, y: 20 }];
  const rows = sumMaterials(computeFloorSystemMaterials({
    ...baseGeom, floor_polygon: poly, floor_perimeter_ft: 64, floor_area_sf: 240,
  }, {}));
  const joists = findRow(rows, CATEGORIES.FLOOR_JOISTS);
  // span = 12, run = 20 → joist length rounds up to 12, count = ceil(20×12/16)+1 = 16
  // 16 × 1.05 = 16.8 → ceil 17
  assert.equal(joists.quantity, 17);
  assert.equal(joists.name, '2 X 8 X 12 PRESSURE TREATED');
});

console.log('\n=== Mid-span blocking ===');
test('Span > 8ft → blocking row present', () => {
  const rows = sumMaterials(computeFloorSystemMaterials(baseGeom, {}));
  // run = 40, blocking = 40 / 16 = 2.5 → ceil 3
  const r = findRow(rows, CATEGORIES.BLOCKING);
  assert.equal(r.quantity, 3);
});
test('Span ≤ 8ft → no blocking row', () => {
  const poly = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 20 }, { x: 0, y: 20 }];
  const rows = computeFloorSystemMaterials({ ...baseGeom, floor_polygon: poly }, {});
  // span = 6, no blocking
  assert.equal(findRow(rows, CATEGORIES.BLOCKING), undefined);
});

console.log('\n=== Rim insulation ===');
test('Rim insulation = (perimeter × depth_ft) / 75', () => {
  const rows = sumMaterials(computeFloorSystemMaterials(baseGeom, {}));
  const r = findRow(rows, CATEGORIES.RIM_INSULATION);
  // 144 × (7.25/12) / 75 = 1.16 → ceil 2
  assert.equal(r.quantity, 2);
  assert.equal(r.unit, 'BAG');
});

console.log('\n=== Joist tape ===');
test('Joist tape = (joist_count × span) / 75', () => {
  const rows = sumMaterials(computeFloorSystemMaterials(baseGeom, {}));
  const r = findRow(rows, CATEGORIES.JOIST_TAPE);
  // 31 × 32 / 75 = 13.23 → ceil 14
  assert.equal(r.quantity, 14);
});

console.log('\n=== Centre beam (engineer_review flag) ===');
test('Centre beam row carries engineer_review:true', () => {
  // Test raw output (pre-sumMaterials, which drops the flag).
  const rows = computeFloorSystemMaterials(baseGeom, {});
  const r = findRowByName(rows, 'CENTRE BEAM — VERIFY SIZE WITH ENGINEER');
  assert.equal(r.engineer_review, true);
  assert.equal(r.quantity, 32); // span_ft
  assert.equal(r.unit, 'LF');
});

console.log('\n=== Joist size variations ===');
test('2x10 joists emit 2 X 10 X 16 PRESSURE TREATED name', () => {
  const rows = sumMaterials(computeFloorSystemMaterials({ ...baseGeom, joist_size: '2x10' }, {}));
  const r = findRow(rows, CATEGORIES.FLOOR_JOISTS);
  assert.equal(r.name, '2 X 10 X 16 PRESSURE TREATED');
});
test('2x12 joists emit 2 X 12 X 16 PRESSURE TREATED name', () => {
  const rows = sumMaterials(computeFloorSystemMaterials({ ...baseGeom, joist_size: '2x12' }, {}));
  const r = findRow(rows, CATEGORIES.FLOOR_JOISTS);
  assert.equal(r.name, '2 X 12 X 16 PRESSURE TREATED');
});
test('Unknown joist size throws', () => {
  assert.throws(() => computeFloorSystemMaterials({ ...baseGeom, joist_size: '2x6' }, {}));
});

console.log('\n=== Waste factor override ===');
test('Custom floor_framing waste overrides default', () => {
  const rows = sumMaterials(computeFloorSystemMaterials(baseGeom, {
    wasteFactors: { floor_framing: 0.15 },
  }));
  const r = findRow(rows, CATEGORIES.FLOOR_JOISTS);
  // 31 × 1.15 = 35.65 → ceil 36
  assert.equal(r.quantity, 36);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
