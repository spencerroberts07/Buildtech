// Self-contained tests for wallRules.js — no DB, no test framework.
// Run: node src/wallRules.test.js
import assert from 'node:assert/strict';
import {
  computeWallMaterials,
  sumMaterials,
  wallLengthFt,
  resolveProjectSettings,
} from './wallRules.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${e.message}`);
    failed++;
  }
}

const closeTo = (actual, expected, tol = 1e-9) =>
  Math.abs(actual - expected) <= tol;

const assertClose = (actual, expected, label, tol) => {
  if (!closeTo(actual, expected, tol)) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
};

// Settings simulating what pg returns from the DB (NUMERIC as strings).
const PG_GLOBAL = {
  default_wall_height: '9',
  exterior_sheathing: '7/16_osb',
  roof_sheathing: '1/2_csp',
  drywall: '1/2_drywall',
  stud_spacing: '16',
  corner_style: '3_stud',
};
const PG_PROJECT_NO_OVERRIDES = {
  default_wall_height: null,
  exterior_sheathing: null,
  roof_sheathing: null,
  drywall: null,
  stud_spacing: null,
  corner_style: null,
  scale_ft_per_grid: '1',
};

console.log('\n=== resolveProjectSettings ===');
test('coerces NUMERIC strings to numbers', () => {
  const r = resolveProjectSettings(PG_PROJECT_NO_OVERRIDES, PG_GLOBAL);
  assert.equal(typeof r.wallHeight, 'number');
  assert.equal(r.wallHeight, 9);
  assert.equal(typeof r.studSpacing, 'number');
  assert.equal(r.studSpacing, 16);
  assert.equal(typeof r.scaleFtPerGrid, 'number');
  assert.equal(r.scaleFtPerGrid, 1);
});

test('project override beats global', () => {
  const proj = { ...PG_PROJECT_NO_OVERRIDES, default_wall_height: '10', drywall: '5/8_drywall' };
  const r = resolveProjectSettings(proj, PG_GLOBAL);
  assert.equal(r.wallHeight, 10);
  assert.equal(r.drywall, '5/8_drywall');
  assert.equal(r.exteriorSheathing, '7/16_osb'); // unaffected
});

test('falls back to hard defaults if both null', () => {
  const r = resolveProjectSettings({}, {});
  assert.equal(r.wallHeight, 9);
  assert.equal(r.exteriorSheathing, '7/16_osb');
  assert.equal(r.drywall, '1/2_drywall');
  assert.equal(r.studSpacing, 16);
});

console.log('\n=== wallLengthFt ===');
test('horizontal 24-grid wall at scale 1 = 24ft', () => {
  assert.equal(wallLengthFt({ x1: '0', y1: '0', x2: '24', y2: '0' }, 1), 24);
});
test('diagonal 3-4-5 at scale 2 = 10ft', () => {
  assert.equal(wallLengthFt({ x1: 0, y1: 0, x2: 3, y2: 4 }, 2), 10);
});
test('coerces string coords from pg', () => {
  assert.equal(wallLengthFt({ x1: '0', y1: '0', x2: '12', y2: '0' }, '1'), 12);
});

console.log('\n=== Worked example: 24ft x 9ft exterior 2x6 wall ===');
const baseSettings = resolveProjectSettings(PG_PROJECT_NO_OVERRIDES, PG_GLOBAL);
const ext24 = {
  x1: '0', y1: '0', x2: '24', y2: '0',
  height: null, wall_type: 'exterior_2x6',
  sheathing_override: null, drywall_override: null,
  extra_corner_studs: 0,
};
const ext24Items = computeWallMaterials(ext24, baseSettings);
const ext24Rolled = sumMaterials(ext24Items);
const find = (rows, name) => rows.find((r) => r.name === name);

test('19 studs of 2x6x104⅝', () => {
  const r = find(ext24Rolled, '2x6x104⅝ SPF stud');
  assert.ok(r, 'stud row missing');
  assert.equal(r.quantity, 19);
  assert.equal(r.unit, 'each');
});
test('plates rolled up: bottom 2.10 + top 3.15 = 5.25 of 2x6x16 SPF plate', () => {
  const r = find(ext24Rolled, '2x6x16 SPF plate');
  assertClose(r.quantity, 5.25, '2x6x16 plate qty');
});
test('OSB sheathing: 7 sheets × 1.10 = 7.70', () => {
  const r = find(ext24Rolled, '7/16 OSB sheathing 4x8');
  assertClose(r.quantity, 7.7, 'sheathing qty');
});
test('Housewrap: 216 × 1.10 = 237.6 sf', () => {
  const r = find(ext24Rolled, 'Housewrap');
  assertClose(r.quantity, 237.6, 'housewrap qty');
});
test('Insulation: 216 sf, no waste', () => {
  const r = find(ext24Rolled, 'R20 batt insulation');
  assert.equal(r.quantity, 216);
});
test('Drywall (interior face): 7 sheets × 1.10 = 7.70', () => {
  const r = find(ext24Rolled, '1/2 drywall 4x8');
  assertClose(r.quantity, 7.7, 'drywall qty');
});

console.log('\n=== Element overrides ===');
test('per-wall drywall override beats project/global', () => {
  const w = { ...ext24, drywall_override: '5/8_drywall' };
  const rolled = sumMaterials(computeWallMaterials(w, baseSettings));
  assert.ok(find(rolled, '5/8 drywall 4x8'), 'expected 5/8 drywall row');
  assert.equal(find(rolled, '1/2 drywall 4x8'), undefined);
});
test('per-wall height override (10ft) bumps precut to 116⅝', () => {
  const w = { ...ext24, height: '10' };
  const rolled = sumMaterials(computeWallMaterials(w, baseSettings));
  assert.ok(find(rolled, '2x6x116⅝ SPF stud'));
});
test('extra_corner_studs increments stud count by exact integer', () => {
  const w = { ...ext24, extra_corner_studs: 4 };
  const rolled = sumMaterials(computeWallMaterials(w, baseSettings));
  assert.equal(find(rolled, '2x6x104⅝ SPF stud').quantity, 23);
});
test('custom height 8.5ft rounds UP to 104⅝ precut (next size up)', () => {
  const w = { ...ext24, height: '8.5' };
  const rolled = sumMaterials(computeWallMaterials(w, baseSettings));
  assert.ok(find(rolled, '2x6x104⅝ SPF stud'));
});
test('8ft wall uses 92⅝ precut', () => {
  const w = { ...ext24, height: '8' };
  const rolled = sumMaterials(computeWallMaterials(w, baseSettings));
  assert.ok(find(rolled, '2x6x92⅝ SPF stud'));
});

console.log('\n=== Interior 2x4 wall: 12ft x 9ft ===');
const int12 = {
  x1: 0, y1: 0, x2: '12', y2: 0,
  height: null, wall_type: 'interior_2x4',
  sheathing_override: null, drywall_override: null,
  extra_corner_studs: 0,
};
const int12Rolled = sumMaterials(computeWallMaterials(int12, baseSettings));

test('interior 2x4: 10 studs of 2x4x104⅝', () => {
  const r = find(int12Rolled, '2x4x104⅝ SPF stud');
  assert.equal(r.quantity, 10);
});
test('interior 2x4: plates 1.05 + 2.10 = 3.15 of 2x4x16 SPF plate', () => {
  const r = find(int12Rolled, '2x4x16 SPF plate');
  assertClose(r.quantity, 3.15, 'plate qty');
});
test('interior 2x4: drywall both faces = ceil(216/32)*1.10 = 7.70', () => {
  const r = find(int12Rolled, '1/2 drywall 4x8');
  assertClose(r.quantity, 7.7, 'drywall qty');
});
test('interior 2x4 has no sheathing/housewrap/insulation', () => {
  assert.equal(find(int12Rolled, '7/16 OSB sheathing 4x8'), undefined);
  assert.equal(find(int12Rolled, 'Housewrap'), undefined);
  assert.equal(find(int12Rolled, 'R20 batt insulation'), undefined);
});

console.log('\n=== Interior 2x6 wall: 12ft x 9ft ===');
const int12_6 = { ...int12, wall_type: 'interior_2x6' };
const int12_6Rolled = sumMaterials(computeWallMaterials(int12_6, baseSettings));
test('interior 2x6 uses 2x6 lumber, same drywall behavior', () => {
  assert.ok(find(int12_6Rolled, '2x6x104⅝ SPF stud'));
  assert.ok(find(int12_6Rolled, '2x6x16 SPF plate'));
  assert.equal(find(int12_6Rolled, '2x4x16 SPF plate'), undefined);
});

console.log('\n=== Project settings override propagation ===');
test('project override of stud_spacing changes stud count', () => {
  const proj = { ...PG_PROJECT_NO_OVERRIDES, stud_spacing: '24' };
  const settings = resolveProjectSettings(proj, PG_GLOBAL);
  const rolled = sumMaterials(computeWallMaterials(ext24, settings));
  // ceil(24*12/24) + 1 = 12 + 1 = 13
  assert.equal(find(rolled, '2x6x104⅝ SPF stud').quantity, 13);
});
test('project override of exterior_sheathing flows through', () => {
  const proj = { ...PG_PROJECT_NO_OVERRIDES, exterior_sheathing: '5/8_osb' };
  const settings = resolveProjectSettings(proj, PG_GLOBAL);
  const rolled = sumMaterials(computeWallMaterials(ext24, settings));
  assert.ok(find(rolled, '5/8 OSB sheathing 4x8'));
  assert.equal(find(rolled, '7/16 OSB sheathing 4x8'), undefined);
});

console.log('\n=== Cross-wall rollup (sumMaterials) ===');
test('summing two identical exterior 2x6 walls doubles each line', () => {
  const both = sumMaterials([
    ...computeWallMaterials(ext24, baseSettings),
    ...computeWallMaterials(ext24, baseSettings),
  ]);
  assert.equal(find(both, '2x6x104⅝ SPF stud').quantity, 38);
  assertClose(find(both, '2x6x16 SPF plate').quantity, 10.5, 'plate doubled');
  assertClose(find(both, 'Housewrap').quantity, 475.2, 'housewrap doubled');
});

console.log(`\nResult: ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
