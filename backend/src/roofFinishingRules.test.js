// Self-contained tests for roofFinishingRules.js — no DB, no test framework.
// Run: node src/roofFinishingRules.test.js
import assert from 'node:assert/strict';
import { sumMaterials, SOLO_SECTIONS } from './wallRules.js';
import {
  computeRoofFinishingMaterials,
  CATEGORIES,
  SECTION_ROOF_FINISHING,
  DEFAULT_ROOF_FINISHING_WASTE,
} from './roofFinishingRules.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); failed++; }
}
const findRow = (rows, category) => rows.find((r) => r.category === category);

// Simple 10x12m rectangle, 5:12 pitch.
// Footprint = ~10.97 * ~14.63 * 3.28084^2 ≈ 1722 ft² is wrong-conversion;
// use direct ft inputs instead so the test is readable:
// 32ft x 40ft = 1280 sf footprint, surface area ≈ 1280 * 1.083 = 1386 sf.
// Gable roof: eaves on two long sides (40ft × 2 = 80ft), rakes on two short
// sides (~17.3ft slope × 2 = ~34.6ft, but we use horizontal for simplicity),
// ridge = 40ft, no hips, no valleys.
const baseGeom = {
  total_roof_area: 1386,
  total_eave_lf:   80,
  total_rake_lf:   34.6,
  total_ridge_lf:  40,
  total_hip_lf:    0,
  total_valley_lf: 0,
};

console.log('\n=== Section + category labels ===');
test('Section label matches SOLO_SECTIONS', () => {
  assert.equal(SECTION_ROOF_FINISHING, SOLO_SECTIONS.ROOF_FINISHING);
});
test('All emitted rows live in Roof Finishing section', () => {
  const rows = computeRoofFinishingMaterials(baseGeom, {});
  for (const r of rows) assert.equal(r.section, SECTION_ROOF_FINISHING);
});

console.log('\n=== Default rectangle gable roof ===');
test('Ice & water = eaves × 3ft / 200sf-per-roll', () => {
  const rows = sumMaterials(computeRoofFinishingMaterials(baseGeom, {}));
  const r = findRow(rows, CATEGORIES.ICE_WATER);
  // 80 × 3 / 200 = 1.2 → ceil 2
  assert.equal(r.quantity, 2);
  assert.equal(r.unit, 'RL');
});
test('Underlayment = (area − eave band) / 1000', () => {
  const rows = sumMaterials(computeRoofFinishingMaterials(baseGeom, {}));
  const r = findRow(rows, CATEGORIES.UNDERLAYMENT);
  // (1386 − 240) / 1000 = 1.146 → ceil 2
  assert.equal(r.quantity, 2);
});
test('Starter = (eaves + rakes) / 123', () => {
  const rows = sumMaterials(computeRoofFinishingMaterials(baseGeom, {}));
  const r = findRow(rows, CATEGORIES.STARTER);
  // (80 + 34.6) / 123 ≈ 0.93 → ceil 1
  assert.equal(r.quantity, 1);
});
test('Shingles = area / 33 × (1 + 10% default waste)', () => {
  const rows = sumMaterials(computeRoofFinishingMaterials(baseGeom, {}));
  const r = findRow(rows, CATEGORIES.SHINGLES);
  // 1386 / 33 × 1.10 = 46.2 → ceil 47
  assert.equal(r.quantity, 47);
});
test('Hip & ridge cap = (hip + ridge) / 36.5', () => {
  const rows = sumMaterials(computeRoofFinishingMaterials(baseGeom, {}));
  const r = findRow(rows, CATEGORIES.HIP_RIDGE);
  // (0 + 40) / 36.5 ≈ 1.096 → ceil 2
  assert.equal(r.quantity, 2);
});
test('Drip edge = (eaves + rakes) / 10', () => {
  const rows = sumMaterials(computeRoofFinishingMaterials(baseGeom, {}));
  const r = findRow(rows, CATEGORIES.DRIP_EDGE);
  // (80 + 34.6) / 10 = 11.46 → ceil 12
  assert.equal(r.quantity, 12);
});
test('Roofing nails = area / 100 lb', () => {
  const rows = sumMaterials(computeRoofFinishingMaterials(baseGeom, {}));
  const r = findRow(rows, CATEGORIES.FASTENERS);
  // 1386 / 100 = 13.86 → ceil 14
  assert.equal(r.quantity, 14);
});

console.log('\n=== Edge cases ===');
test('No valleys → valley flashing row not emitted', () => {
  const rows = computeRoofFinishingMaterials(baseGeom, {});
  assert.equal(findRow(rows, CATEGORIES.VALLEY), undefined);
});
test('No hip edges → hip & ridge cap = ridge only', () => {
  const rows = sumMaterials(computeRoofFinishingMaterials({ ...baseGeom, total_ridge_lf: 36.5 }, {}));
  const r = findRow(rows, CATEGORIES.HIP_RIDGE);
  // 36.5 / 36.5 = 1 → ceil 1
  assert.equal(r.quantity, 1);
});
test('Hip-only roof produces hip+ridge cap row from hip alone', () => {
  const rows = sumMaterials(computeRoofFinishingMaterials({
    ...baseGeom, total_ridge_lf: 0, total_hip_lf: 73,
  }, {}));
  const r = findRow(rows, CATEGORIES.HIP_RIDGE);
  // 73 / 36.5 = 2 → ceil 2
  assert.equal(r.quantity, 2);
});
test('Zero area + zero eaves → returns []', () => {
  const rows = computeRoofFinishingMaterials({
    total_roof_area: 0, total_eave_lf: 0, total_rake_lf: 0,
    total_ridge_lf: 0, total_hip_lf: 0, total_valley_lf: 0,
  }, {});
  assert.deepEqual(rows, []);
});
test('Valley row present when valley_lf > 0', () => {
  const rows = sumMaterials(computeRoofFinishingMaterials(
    { ...baseGeom, total_valley_lf: 18 }, {},
  ));
  const r = findRow(rows, CATEGORIES.VALLEY);
  // 18 / 10 = 1.8 → ceil 2
  assert.equal(r.quantity, 2);
});

console.log('\n=== Waste factor override ===');
test('Custom shingles waste overrides default', () => {
  const rows = sumMaterials(computeRoofFinishingMaterials(baseGeom, {
    wasteFactors: { roof_shingles: 0.20 },
  }));
  const r = findRow(rows, CATEGORIES.SHINGLES);
  // 1386 / 33 × 1.20 = 50.4 → ceil 51
  assert.equal(r.quantity, 51);
});
test('Default shingle waste = 10%', () => {
  assert.equal(DEFAULT_ROOF_FINISHING_WASTE.shingles, 0.10);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
