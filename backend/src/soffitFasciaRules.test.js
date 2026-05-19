// Self-contained tests for soffitFasciaRules.js. Run: node src/soffitFasciaRules.test.js
import assert from 'node:assert/strict';
import { sumMaterials, SOLO_SECTIONS } from './wallRules.js';
import {
  computeSoffitFasciaMaterials,
  CATEGORIES,
  SECTION_SOFFIT_FASCIA,
} from './soffitFasciaRules.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); failed++; }
}
const findRow = (rows, category, name) =>
  rows.find((r) => r.category === category && (name == null || r.name === name));

// 32x40 gable rectangle: eaves = 80ft (two 40ft sides), rakes = ~34.6ft
// slope (using horizontal projection of 32 ÷ 2 × 2 for both gables here =
// 32, but with avg_overhang we set 1.5ft).
const baseGeom = { eave_lf: 80, rake_lf: 34.6, avg_overhang_ft: 1.5 };

console.log('\n=== Section + structure ===');
test('Section matches SOLO_SECTIONS', () => {
  assert.equal(SECTION_SOFFIT_FASCIA, SOLO_SECTIONS.SOFFIT_FASCIA);
});
test('Sub-fascia row uses existing 2x4x16 SKU', () => {
  const rows = computeSoffitFasciaMaterials(baseGeom, {});
  const r = findRow(rows, CATEGORIES.SUB_FASCIA);
  assert.equal(r.name, '2 X 4 X 16 PREMIUM SPRUCE');
});

console.log('\n=== Rectangle gable roof ===');
test('Soffit panel SQ = (eaves × overhang) / 100', () => {
  const rows = sumMaterials(computeSoffitFasciaMaterials(baseGeom, {}));
  const r = findRow(rows, CATEGORIES.SOFFIT);
  // (80 × 1.5) / 100 = 1.2 → ceil 2
  assert.equal(r.quantity, 2);
  assert.equal(r.unit, 'SQ');
});
test('J-channel = eaves / 12', () => {
  const rows = sumMaterials(computeSoffitFasciaMaterials(baseGeom, {}));
  const r = findRow(rows, CATEGORIES.SOFFIT_TRIM, 'J-CHANNEL ALUMINUM 12FT');
  // 80 / 12 = 6.67 → ceil 7
  assert.equal(r.quantity, 7);
});
test('F-channel = eaves / 12', () => {
  const rows = sumMaterials(computeSoffitFasciaMaterials(baseGeom, {}));
  const r = findRow(rows, CATEGORIES.SOFFIT_TRIM, 'F-CHANNEL ALUMINUM 12FT');
  assert.equal(r.quantity, 7);
});
test('Soffit nails = eaves / 50 lb', () => {
  const rows = sumMaterials(computeSoffitFasciaMaterials(baseGeom, {}));
  const r = findRow(rows, CATEGORIES.SOFFIT_TRIM, 'SOFFIT NAILS 1-1/4IN WHITE LB');
  // 80 / 50 = 1.6 → ceil 2
  assert.equal(r.quantity, 2);
});
test('Fascia = (eaves + rakes) / 10', () => {
  const rows = sumMaterials(computeSoffitFasciaMaterials(baseGeom, {}));
  const r = findRow(rows, CATEGORIES.FASCIA);
  // (80 + 34.6) / 10 = 11.46 → ceil 12
  assert.equal(r.quantity, 12);
});
test('Sub-fascia = (eaves + rakes) / 16', () => {
  const rows = sumMaterials(computeSoffitFasciaMaterials(baseGeom, {}));
  const r = findRow(rows, CATEGORIES.SUB_FASCIA);
  // (80 + 34.6) / 16 ≈ 7.16 → ceil 8
  assert.equal(r.quantity, 8);
});

console.log('\n=== Edge cases ===');
test('Zero eaves + zero rakes → []', () => {
  const rows = computeSoffitFasciaMaterials({ eave_lf: 0, rake_lf: 0, avg_overhang_ft: 1.5 }, {});
  assert.deepEqual(rows, []);
});
test('Zero overhang → no soffit panel row', () => {
  const rows = computeSoffitFasciaMaterials({ ...baseGeom, avg_overhang_ft: 0 }, {});
  assert.equal(findRow(rows, CATEGORIES.SOFFIT), undefined);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
