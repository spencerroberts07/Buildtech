// Self-contained tests for sidingRules.js. Run: node src/sidingRules.test.js
import assert from 'node:assert/strict';
import { sumMaterials, SOLO_SECTIONS } from './wallRules.js';
import {
  computeSidingMaterials,
  CATEGORIES,
  SECTION_SIDING,
  DEFAULT_SIDING_WASTE,
} from './sidingRules.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); failed++; }
}
const findRow = (rows, name) => rows.find((r) => r.name === name);

// Reference geometry: 32x40 rectangle, 8ft walls, 4 outside corners,
// 4 windows (1m × 1.2m ≈ 3.28 × 3.94 ft → openingArea 12.92sf each → 51.7sf),
// 2 ext doors (0.9m × 2.1m ≈ 2.95 × 6.89 ft → openingArea 20.33sf each →
// 40.66sf). Total opening area ≈ 92.36sf.
// Perimeter = 144 ft. Wall area = 1152 sf. Net = 1059.64 sf.
// All opening widths: 4×3.28 + 2×2.95 = 19.02 ft.
// Window widths: 13.12 ft. All opening perimeters: 4×(2×3.28+2×3.94) +
//   2×(2×2.95+2×6.89) = 4×14.44 + 2×19.68 = 57.76 + 39.36 = 97.12 ft.
const baseGeom = {
  wall_perimeter_ft:       144,
  wall_height_ft:          8,
  opening_areas_sf:        92.36,
  outside_corner_count:    4,
  gable_areas_sf:          0,
  all_opening_widths_lf:   19.02,
  window_widths_lf:        13.12,
  all_opening_perimeter_lf: 97.12,
};

console.log('\n=== Section + structure ===');
test('Section matches SOLO_SECTIONS', () => {
  assert.equal(SECTION_SIDING, SOLO_SECTIONS.SIDING);
});
test('Default waste = 10% / 10%', () => {
  assert.equal(DEFAULT_SIDING_WASTE.siding, 0.10);
  assert.equal(DEFAULT_SIDING_WASTE.gable, 0.10);
});

console.log('\n=== Reference rectangle ===');
test('Field siding = (gross − openings) / 100 × 1.10', () => {
  const rows = sumMaterials(computeSidingMaterials(baseGeom, {}));
  const r = findRow(rows, 'VINYL SIDING D4.5 DUTCH LAP 100SF/SQ');
  // (1152 − 92.36) / 100 × 1.10 = 11.656 → ceil 12
  assert.equal(r.quantity, 12);
  assert.equal(r.unit, 'SQ');
});
test('Gable siding row absent when gable area = 0', () => {
  const rows = computeSidingMaterials(baseGeom, {});
  assert.equal(findRow(rows, 'VINYL GABLE SIDING D4.5 100SF/SQ'), undefined);
});
test('Starter = perimeter / 12', () => {
  const rows = sumMaterials(computeSidingMaterials(baseGeom, {}));
  const r = findRow(rows, 'VINYL SIDING STARTER STRIP 12FT');
  // 144 / 12 = 12
  assert.equal(r.quantity, 12);
});
test('J-channel = (opening perim + perim) × 1.10 / 12', () => {
  const rows = sumMaterials(computeSidingMaterials(baseGeom, {}));
  const r = findRow(rows, 'VINYL SIDING J-CHANNEL 5/8IN 12FT');
  // (97.12 + 144) × 1.10 / 12 = 22.10 → ceil 23
  assert.equal(r.quantity, 23);
});
test('Outside corners = (corner_count × height) / 10', () => {
  const rows = sumMaterials(computeSidingMaterials(baseGeom, {}));
  const r = findRow(rows, 'VINYL SIDING OUTSIDE CORNER 3IN 10FT');
  // (4 × 8) / 10 = 3.2 → ceil 4
  assert.equal(r.quantity, 4);
});
test('Drip cap = all_opening_widths / 10', () => {
  const rows = sumMaterials(computeSidingMaterials(baseGeom, {}));
  const r = findRow(rows, 'VINYL SIDING DRIP CAP 10FT');
  // 19.02 / 10 = 1.902 → ceil 2
  assert.equal(r.quantity, 2);
});
test('Undersill trim = window_widths / 10', () => {
  const rows = sumMaterials(computeSidingMaterials(baseGeom, {}));
  const r = findRow(rows, 'VINYL SIDING UNDERSILL TRIM 10FT');
  // 13.12 / 10 = 1.312 → ceil 2
  assert.equal(r.quantity, 2);
});
test('Nails = (gross wall + gable area) / 100 lb', () => {
  const rows = sumMaterials(computeSidingMaterials(baseGeom, {}));
  const r = findRow(rows, 'ALUMINUM SIDING NAILS 1-3/4IN LB');
  // 1152 / 100 = 11.52 → ceil 12
  assert.equal(r.quantity, 12);
});

console.log('\n=== Gable inclusion ===');
test('Gable area pushes gable siding row + adds to nail count', () => {
  const rows = sumMaterials(computeSidingMaterials(
    { ...baseGeom, gable_areas_sf: 90 }, {},
  ));
  const gable = findRow(rows, 'VINYL GABLE SIDING D4.5 100SF/SQ');
  // 90 / 100 × 1.10 = 0.99 → ceil 1
  assert.equal(gable.quantity, 1);
  const nails = findRow(rows, 'ALUMINUM SIDING NAILS 1-3/4IN LB');
  // (1152 + 90) / 100 = 12.42 → ceil 13
  assert.equal(nails.quantity, 13);
});

console.log('\n=== Multi-storey aggregation (geometry consumers job) ===');
test('Multi-storey: caller sums perimeter×height across floors', () => {
  // The rules engine doesn't know about floors — it just consumes the
  // already-summed geometry. Simulate floor1 (144ft × 9ft) + floor2
  // (144ft × 9ft) by passing wall_height_ft so the gross area covers both.
  // Easier: just call twice and sum the SQ row.
  const sf1 = sumMaterials(computeSidingMaterials({ ...baseGeom, wall_height_ft: 9 }, {}));
  const sf2 = sumMaterials(computeSidingMaterials({ ...baseGeom, wall_height_ft: 9 }, {}));
  const r1 = findRow(sf1, 'VINYL SIDING D4.5 DUTCH LAP 100SF/SQ');
  const r2 = findRow(sf2, 'VINYL SIDING D4.5 DUTCH LAP 100SF/SQ');
  // (144×9 − 92.36) / 100 × 1.10 = 13.24 → ceil 14, times two = 28
  assert.equal(r1.quantity, 14);
  assert.equal(r1.quantity + r2.quantity, 28);
});

console.log('\n=== Edge cases ===');
test('Zero perimeter + zero gable → []', () => {
  const rows = computeSidingMaterials({
    wall_perimeter_ft: 0, wall_height_ft: 8, opening_areas_sf: 0,
    outside_corner_count: 0, gable_areas_sf: 0,
    all_opening_widths_lf: 0, window_widths_lf: 0, all_opening_perimeter_lf: 0,
  }, {});
  assert.deepEqual(rows, []);
});
test('Custom waste overrides default', () => {
  const rows = sumMaterials(computeSidingMaterials(baseGeom, {
    wasteFactors: { siding: 0.20 },
  }));
  const r = findRow(rows, 'VINYL SIDING D4.5 DUTCH LAP 100SF/SQ');
  // (1152 − 92.36) / 100 × 1.20 = 12.716 → ceil 13
  assert.equal(r.quantity, 13);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
