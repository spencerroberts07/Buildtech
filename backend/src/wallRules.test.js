// Self-contained tests for wallRules.js — no DB, no test framework.
// Run: node src/wallRules.test.js
import assert from 'node:assert/strict';
import {
  computeWallMaterials,
  computeProjectMaterials,
  computeFloorPlanMaterials,
  computeRoofMaterials,
  buildFloorPlanWalls,
  sumMaterials,
  resolveProjectSettings,
  sectionFor,
  SECTIONS,
  SECTION_ORDER,
  LEVELS,
  INSULATION_TYPES,
  SILVERBOARD_TYPES,
  ROOF_PITCH_MULTIPLIER,
} from './wallRules.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); failed++; }
}
const findRow = (rows, section, name) =>
  rows.find((r) => r.section === section && r.name === name);

const PG_GLOBAL = {
  default_wall_height: '9', exterior_sheathing: '7/16_osb', roof_sheathing: '1/2_csp',
  drywall: '1/2_drywall', stud_spacing: '16', corner_style: '3_stud',
};
const PG_PROJECT = {
  default_wall_height: null, exterior_sheathing: null, roof_sheathing: null,
  drywall: null, stud_spacing: null, corner_style: null,
  scale_ft_per_grid: '1', insulation_type: null, silverboard_type: null,
};
const baseSettings = resolveProjectSettings(PG_PROJECT, PG_GLOBAL);

console.log('\n=== resolveProjectSettings ===');
test('default silverboard key', () => assert.equal(baseSettings.silverboardType, 'silverboard_1'));
test('default insulation key', () => assert.equal(baseSettings.insulationType, 'pink_r22_15'));
test('silverboard project override', () => {
  const r = resolveProjectSettings({ ...PG_PROJECT, silverboard_type: 'silverboard_2' }, PG_GLOBAL);
  assert.equal(r.silverboardType, 'silverboard_2');
});

console.log('\n=== Section names match the spec exactly ===');
test('SECTIONS pins to Floor 1 prefix labels', () => {
  assert.equal(SECTIONS.EXTERIOR_WALLS,      'Floor 1 — Exterior Walls');
  assert.equal(SECTIONS.INSULATION,          'Floor 1 — Insulation');
  assert.equal(SECTIONS.EXTERIOR_INSULATION, 'Exterior Insulation');
  assert.equal(SECTIONS.INTERIOR_WALLS,      'Floor 1 — Interior Walls');
  assert.equal(SECTIONS.WINDOWS,             'Floor 1 — Windows');
  assert.equal(SECTIONS.DOORS,               'Floor 1 — Doors');
  assert.equal(SECTIONS.FINISHINGS,          'Floor 1 — Finishings');
});
test('SECTION_ORDER includes all level groupings then solo sections', () => {
  // Floor 1 sections all present in correct order relative to each other
  const idx = (s) => SECTION_ORDER.indexOf(s);
  assert.ok(idx(SECTIONS.EXTERIOR_WALLS) < idx(SECTIONS.INSULATION));
  assert.ok(idx(SECTIONS.INSULATION) < idx(SECTIONS.INTERIOR_WALLS));
  assert.ok(idx(SECTIONS.INTERIOR_WALLS) < idx(SECTIONS.WINDOWS));
  assert.ok(idx(SECTIONS.WINDOWS) < idx(SECTIONS.DOORS));
  assert.ok(idx(SECTIONS.DOORS) < idx(SECTIONS.FINISHINGS));
});

console.log('\n=== Round-up: lumberyards do not sell partial units ===');
test('Single 24ft exterior 2x6: bottom plate row 2.10 → 3', () => {
  const items = sumMaterials(computeWallMaterials({
    x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0,
  }, baseSettings));
  const r = items.find((x) => x.category === 'Bottom Plate' && x.name === '2 X 6 X 16 PREMIUM SPRUCE');
  assert.equal(r.quantity, 3);
});
test('Single 24ft exterior 2x6: top plate row 3.15 → 4', () => {
  const items = sumMaterials(computeWallMaterials({
    x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0,
  }, baseSettings));
  const r = items.find((x) => x.category === 'Top Plate' && x.name === '2 X 6 X 16 PREMIUM SPRUCE');
  assert.equal(r.quantity, 4);
});
test('3 walls (24/20/16): bottom plates sum then ceil = 6', () => {
  const walls = ['24','20','16'].map((L) => ({
    x1:0,y1:0,x2:L,y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0,
  }));
  const all = [];
  for (const w of walls) all.push(...computeWallMaterials(w, baseSettings));
  const rolled = sumMaterials(all);
  // 2.10+2.10+1.05 = 5.25 → ceil 6
  const r = rolled.find((x) => x.category === 'Bottom Plate' && x.name === '2 X 6 X 16 PREMIUM SPRUCE');
  assert.equal(r.quantity, 6);
});
test('3 walls (24/20/16): top plates sum then ceil = 9', () => {
  const walls = ['24','20','16'].map((L) => ({
    x1:0,y1:0,x2:L,y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0,
  }));
  const all = [];
  for (const w of walls) all.push(...computeWallMaterials(w, baseSettings));
  const rolled = sumMaterials(all);
  // 3.15+3.15+2.10 = 8.40 → ceil 9
  const r = rolled.find((x) => x.category === 'Top Plate' && x.name === '2 X 6 X 16 PREMIUM SPRUCE');
  assert.equal(r.quantity, 9);
});
test('Studs land in Exterior Walls section', () => {
  const items = sumMaterials(computeWallMaterials({
    x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0,
  }, baseSettings));
  assert.equal(findRow(items, SECTIONS.EXTERIOR_WALLS, '2 X 6 X 104-5/8 PREMIUM SPRUCE').quantity, 19);
});

console.log('\n=== Section assignments ===');
test('Exterior wall framing materials land in "First Floor — Exterior Walls"', () => {
  const items = sumMaterials(computeWallMaterials({
    x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0,
  }, baseSettings));
  assert.ok(findRow(items, SECTIONS.EXTERIOR_WALLS, '2 X 6 X 16 PREMIUM SPRUCE'));
  assert.ok(findRow(items, SECTIONS.EXTERIOR_WALLS, '2 X 6 X 104-5/8 PREMIUM SPRUCE'));
  assert.ok(findRow(items, SECTIONS.EXTERIOR_WALLS, '4 X 8 - 7/16 ORIENTED STRAND BOARD'));
});
test('Project-level housewrap/tape/gasket/bracing land in "First Floor — Exterior Walls"', () => {
  const wall = { id: 1, x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0 };
  const items = sumMaterials(computeProjectMaterials([wall], baseSettings));
  assert.ok(findRow(items, SECTIONS.EXTERIOR_WALLS, "9'X100' TYPAR HOUSEWRAP"));
  assert.ok(findRow(items, SECTIONS.EXTERIOR_WALLS, 'TAPE,SHEATHING PLY RED 60MMX55M'));
  assert.ok(findRow(items, SECTIONS.EXTERIOR_WALLS, 'GASKET,SILL 3/16 WHITE 5.5X82'));
  assert.ok(findRow(items, SECTIONS.EXTERIOR_WALLS, '2 X 4 X 16 PREMIUM SPRUCE'));
});
test('Batt insulation lands in "First Floor — Insulation"', () => {
  const wall = { id: 1, x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0 };
  const items = sumMaterials(computeProjectMaterials([wall], baseSettings));
  assert.ok(findRow(items, SECTIONS.INSULATION, 'R22-15 FIBREGLASS INSUL. 49.0 SQ FT'));
});
test('Vapour barrier lands in "First Floor — Insulation"', () => {
  const wall = { id: 1, x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0 };
  const items = sumMaterials(computeProjectMaterials([wall], baseSettings));
  const row = findRow(items, SECTIONS.INSULATION, 'VAPOUR BARRIER 6M X1500 8\'6"');
  assert.ok(row, 'vapour barrier row missing');
  assert.equal(row.unit, 'RL');
  // 24 × 9 = 216 sf × 1.05 = 226.8 / 1500 = 0.151 → ceil 1
  assert.equal(row.quantity, 1);
});
test('Silverboard lands in the Exterior Walls section (no longer a standalone section)', () => {
  const items = sumMaterials(computeWallMaterials({
    x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0,
  }, baseSettings));
  assert.ok(findRow(items, SECTIONS.EXTERIOR_WALLS, 'SILVERBOARD GRAPHITE 4X8 1" R5'));
});
test('Interior wall framing lands in "First Floor — Interior Walls"', () => {
  const items = sumMaterials(computeWallMaterials({
    x1:0,y1:0,x2:'12',y2:0, wall_type:'interior_2x4', height:null, extra_corner_studs:0,
  }, baseSettings));
  assert.ok(findRow(items, SECTIONS.INTERIOR_WALLS, '2 X 4 X 16 PREMIUM SPRUCE'));
  assert.ok(findRow(items, SECTIONS.INTERIOR_WALLS, '2 X 4 X 104-5/8 PREMIUM SPRUCE'));
});
test('Plate poly lands in "First Floor — Interior Walls"', () => {
  const wall = { id: 1, x1:0,y1:0,x2:'12',y2:0, wall_type:'interior_2x4', height:null, extra_corner_studs:0 };
  const items = sumMaterials(computeProjectMaterials([wall], baseSettings));
  assert.ok(findRow(items, SECTIONS.INTERIOR_WALLS, '12 X 300FT CLEAR POLY'));
});
test('All wall drywall lands in "First Floor — Finishings" — height-specific sheet (4x9 for 9ft walls)', () => {
  const ext = { id: 1, x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0 };
  const int = { id: 2, x1:0,y1:0,x2:'12',y2:0, wall_type:'interior_2x4', height:null, extra_corner_studs:0 };
  const all = [
    ...computeWallMaterials(ext, baseSettings),
    ...computeWallMaterials(int, baseSettings),
  ];
  const items = sumMaterials(all);
  // No wall drywall row in Exterior Walls or Interior Walls (lands in Finishings)
  assert.equal(findRow(items, SECTIONS.EXTERIOR_WALLS, '4 X 9 - 1/2" DRYWALL'), undefined);
  assert.equal(findRow(items, SECTIONS.INTERIOR_WALLS, '4 X 9 - 1/2" DRYWALL'), undefined);
  // Wall drywall row exists in Finishings with the new category label
  const r = findRow(items, SECTIONS.FINISHINGS, '4 X 9 - 1/2" DRYWALL');
  assert.ok(r, 'expected wall drywall row in Finishings');
  assert.equal(r.category, 'Wall Drywall');
});
test('Window header + jacks land in "First Floor — Windows"', () => {
  const wall = { id: 1, x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0 };
  const opens = [{ wall_id: 1, type: 'window', rough_opening_width: '36', rough_opening_height: '48', wall_type: 'exterior_2x6' }];
  const items = sumMaterials(computeProjectMaterials([wall], baseSettings, opens));
  assert.ok(findRow(items, SECTIONS.WINDOWS, '2 X 10 X 16 PREMIUM SPRUCE'));
  assert.ok(findRow(items, SECTIONS.WINDOWS, '2 X 6 X 4FT PREMIUM SPRUCE'));
});
test('Door header + jacks land in "First Floor — Doors"', () => {
  const wall = { id: 1, x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0 };
  const opens = [{ wall_id: 1, type: 'door', rough_opening_width: '36', rough_opening_height: '83', wall_type: 'exterior_2x6' }];
  const items = sumMaterials(computeProjectMaterials([wall], baseSettings, opens));
  assert.ok(findRow(items, SECTIONS.DOORS, '2 X 10 X 16 PREMIUM SPRUCE'));
  assert.ok(findRow(items, SECTIONS.DOORS, '2 X 6 X 7FT PREMIUM SPRUCE'));
});
test('Shims always land in "First Floor — Windows" regardless of openings', () => {
  const wall = { id: 1, x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0 };
  const winOnly = sumMaterials(computeProjectMaterials([wall], baseSettings,
    [{ wall_id: 1, type: 'window', rough_opening_width: '36', rough_opening_height: '48', wall_type: 'exterior_2x6' }]));
  const doorOnly = sumMaterials(computeProjectMaterials([wall], baseSettings,
    [{ wall_id: 1, type: 'door', rough_opening_width: '36', rough_opening_height: '83', wall_type: 'exterior_2x6' }]));
  const both = sumMaterials(computeProjectMaterials([wall], baseSettings, [
    { wall_id: 1, type: 'window', rough_opening_width: '36', rough_opening_height: '48', wall_type: 'exterior_2x6' },
    { wall_id: 1, type: 'door', rough_opening_width: '36', rough_opening_height: '83', wall_type: 'exterior_2x6' },
  ]));
  assert.ok(findRow(winOnly, SECTIONS.WINDOWS, 'SHIMS 10/10 BAG OF 60'));
  assert.ok(findRow(doorOnly, SECTIONS.WINDOWS, 'SHIMS 10/10 BAG OF 60'));
  assert.ok(findRow(both, SECTIONS.WINDOWS, 'SHIMS 10/10 BAG OF 60'));
});

console.log('\n=== Wall drywall — height-driven sheet picker ===');
test('8ft wall → 4x8 drywall', () => {
  const w8 = { x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:'8', extra_corner_studs:0 };
  const items = sumMaterials(computeWallMaterials(w8, baseSettings));
  // 24*8 = 192 sf / 32 sf = 6 ×1.10 = 6.6 → 7
  const r = findRow(items, SECTIONS.FINISHINGS, '4 X 8 - 1/2" DRYWALL');
  assert.ok(r, '4x8 drywall row missing'); assert.equal(r.quantity, 7);
});
test('9ft wall → 4x9 drywall', () => {
  const items = sumMaterials(computeWallMaterials({
    x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0,
  }, baseSettings));
  assert.ok(findRow(items, SECTIONS.FINISHINGS, '4 X 9 - 1/2" DRYWALL'));
});
test('10ft wall → 4x10 drywall', () => {
  const w10 = { x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:'10', extra_corner_studs:0 };
  const items = sumMaterials(computeWallMaterials(w10, baseSettings));
  assert.ok(findRow(items, SECTIONS.FINISHINGS, '4 X 10 - 1/2" DRYWALL'));
});

console.log('\n=== Waste factors are parameterizable ===');
test('Lumber waste factor override flows into plate quantities', () => {
  const wall = { x1:0,y1:0,x2:'80',y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0 };
  // baseline: 80 / 16 = 5 boards, × 1.05 = 5.25 → ceil 6
  const baseline = sumMaterials(computeWallMaterials(wall, baseSettings));
  const baseQty = findRow(baseline, SECTIONS.EXTERIOR_WALLS, '2 X 6 X 16 PREMIUM SPRUCE').quantity;
  // override 10% lumber waste: 5 × 1.10 = 5.5 → ceil 6 (same after ceil; bump to 200ft to differentiate)
  const longWall = { ...wall, x2: '200' };
  const settingsHi = { ...baseSettings, wasteFactors: { lumber: 0.20 } };
  const settingsLo = { ...baseSettings, wasteFactors: { lumber: 0.00 } };
  // 200/16=12.5 → ceil 13. Lo: 13×1.00=13. Hi: 13×1.20=15.6 → ceil 16.
  const lo = sumMaterials(computeWallMaterials(longWall, settingsLo));
  const hi = sumMaterials(computeWallMaterials(longWall, settingsHi));
  const loQty = findRow(lo, SECTIONS.EXTERIOR_WALLS, '2 X 6 X 16 PREMIUM SPRUCE').quantity;
  const hiQty = findRow(hi, SECTIONS.EXTERIOR_WALLS, '2 X 6 X 16 PREMIUM SPRUCE').quantity;
  assert.ok(hiQty > loQty, `expected higher waste to give more boards: hi=${hiQty}, lo=${loQty}`);
  assert.ok(baseQty >= 6); // sanity
});

console.log('\n=== Sill gasket per-wall-type bucketing ===');
test('Interior 2x4 wall NOT on concrete: no sill gasket row', () => {
  const wall = { id: 1, x1:0,y1:0,x2:'12',y2:0, wall_type:'interior_2x4', height:null, extra_corner_studs:0, on_concrete: false };
  const items = sumMaterials(computeProjectMaterials([wall], baseSettings));
  assert.equal(items.find((r) => r.category === 'Sill Gasket'), undefined);
});
test('Interior 2x4 wall on concrete: 3.5x82 gasket in Interior Walls', () => {
  const wall = { id: 1, x1:0,y1:0,x2:'12',y2:0, wall_type:'interior_2x4', height:null, extra_corner_studs:0, on_concrete: true };
  const items = sumMaterials(computeProjectMaterials([wall], baseSettings));
  const row = findRow(items, SECTIONS.INTERIOR_WALLS, 'GASKET,SILL 3/16 WHITE 3.5X82');
  assert.ok(row, '3.5x82 gasket missing');
  assert.equal(row.quantity, 1);
});
test('Interior 2x6 wall on concrete: 5.5x82 gasket in Interior Walls', () => {
  const wall = { id: 1, x1:0,y1:0,x2:'12',y2:0, wall_type:'interior_2x6', height:null, extra_corner_studs:0, on_concrete: true };
  const items = sumMaterials(computeProjectMaterials([wall], baseSettings));
  const row = findRow(items, SECTIONS.INTERIOR_WALLS, 'GASKET,SILL 3/16 WHITE 5.5X82');
  assert.ok(row, '5.5x82 gasket on interior_2x6 missing');
});
test('Exterior gasket and interior 2x6 gasket are separate rows (same SKU, different sections)', () => {
  const ext = { id: 1, x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0 };
  const int = { id: 2, x1:0,y1:0,x2:'12',y2:0, wall_type:'interior_2x6', height:null, extra_corner_studs:0, on_concrete: true };
  const items = sumMaterials(computeProjectMaterials([ext, int], baseSettings));
  const extRow = items.find((r) => r.section === SECTIONS.EXTERIOR_WALLS && r.name === 'GASKET,SILL 3/16 WHITE 5.5X82');
  const intRow = items.find((r) => r.section === SECTIONS.INTERIOR_WALLS && r.name === 'GASKET,SILL 3/16 WHITE 5.5X82');
  assert.ok(extRow, 'exterior 5.5x82 gasket row missing');
  assert.ok(intRow, 'interior 5.5x82 gasket row missing');
});

console.log('\n=== Silverboard ===');
const ext24 = { x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0 };
test('Silverboard 1" R5 (default): 8 sheets — now in Exterior Walls section', () => {
  const items = sumMaterials(computeWallMaterials(ext24, baseSettings));
  const r = findRow(items, SECTIONS.EXTERIOR_WALLS, 'SILVERBOARD GRAPHITE 4X8 1" R5');
  assert.equal(r.quantity, 8);
});
test('Silverboard "none" omits the row entirely', () => {
  const s = resolveProjectSettings({ ...PG_PROJECT, silverboard_type: 'none' }, PG_GLOBAL);
  const items = sumMaterials(computeWallMaterials(ext24, s));
  assert.equal(items.find((r) => r.name === 'SILVERBOARD GRAPHITE 4X8 1" R5'), undefined);
});
test('Silverboard absent on interior walls', () => {
  const interior = { x1:0,y1:0,x2:'12',y2:0, wall_type:'interior_2x4', height:null, extra_corner_studs:0 };
  const items = sumMaterials(computeWallMaterials(interior, baseSettings));
  assert.equal(items.find((r) => r.name === 'SILVERBOARD GRAPHITE 4X8 1" R5'), undefined);
});

console.log('\n=== Opening area deductions ===');
const window36x48 = { wall_id: 1, type: 'window', rough_opening_width: '36', rough_opening_height: '48' };
const door36x83  = { wall_id: 1, type: 'door',   rough_opening_width: '36', rough_opening_height: '83' };

test('Sheathing deducts opening area: ceil(183.25/32)=6 ×1.10 = 6.6 → 7', () => {
  const items = sumMaterials(computeWallMaterials(ext24, baseSettings, [window36x48, door36x83]));
  assert.equal(findRow(items, SECTIONS.EXTERIOR_WALLS, '4 X 8 - 7/16 ORIENTED STRAND BOARD').quantity, 7);
});
test('Wall drywall (4x9) deducts opening area: ceil(183.25/36)=6 ×1.10 = 6.6 → 7 (in Finishings)', () => {
  const items = sumMaterials(computeWallMaterials(ext24, baseSettings, [window36x48, door36x83]));
  assert.equal(findRow(items, SECTIONS.FINISHINGS, '4 X 9 - 1/2" DRYWALL').quantity, 7);
});
test('Silverboard deducts opening area → 7 (in Exterior Walls)', () => {
  const items = sumMaterials(computeWallMaterials(ext24, baseSettings, [window36x48, door36x83]));
  assert.equal(findRow(items, SECTIONS.EXTERIOR_WALLS, 'SILVERBOARD GRAPHITE 4X8 1" R5').quantity, 7);
});
test('Studs/plates NOT affected by openings', () => {
  const without = sumMaterials(computeWallMaterials(ext24, baseSettings));
  const withOps = sumMaterials(computeWallMaterials(ext24, baseSettings, [window36x48, door36x83]));
  assert.equal(
    findRow(without, SECTIONS.EXTERIOR_WALLS, '2 X 6 X 104-5/8 PREMIUM SPRUCE').quantity,
    findRow(withOps, SECTIONS.EXTERIOR_WALLS, '2 X 6 X 104-5/8 PREMIUM SPRUCE').quantity,
  );
});
test('Opening deduction clamped at 0', () => {
  const giant = { ...window36x48, rough_opening_width: '999', rough_opening_height: '999' };
  const items = sumMaterials(computeWallMaterials(ext24, baseSettings, [giant]));
  assert.equal(findRow(items, SECTIONS.EXTERIOR_WALLS, '4 X 8 - 7/16 ORIENTED STRAND BOARD').quantity, 0);
});

console.log('\n=== Insulation deduction (project-level) ===');
test('Insulation deducts exterior opening area: net 183.25 sf → 4 bags', () => {
  const walls = [{ id: 1, ...ext24 }];
  const opens = [
    { ...window36x48, wall_id: 1, wall_type: 'exterior_2x6' },
    { ...door36x83, wall_id: 1, wall_type: 'exterior_2x6' },
  ];
  const items = sumMaterials(computeProjectMaterials(walls, baseSettings, opens));
  assert.equal(findRow(items, SECTIONS.INSULATION, 'R22-15 FIBREGLASS INSUL. 49.0 SQ FT').quantity, 4);
});
test('Openings on interior walls do NOT reduce exterior insulation', () => {
  const walls = [
    { id: 1, ...ext24 },
    { id: 2, x1:0,y1:0,x2:'10',y2:0, wall_type:'interior_2x4', height:null, extra_corner_studs:0 },
  ];
  const opens = [{ ...window36x48, wall_id: 2, wall_type: 'interior_2x4' }];
  const items = sumMaterials(computeProjectMaterials(walls, baseSettings, opens));
  // 24×9 = 216 sf full, ceil(216/49) = 5
  assert.equal(findRow(items, SECTIONS.INSULATION, 'R22-15 FIBREGLASS INSUL. 49.0 SQ FT').quantity, 5);
});

console.log('\n=== Headers (Windows / Doors sections) ===');
test('Window header: 1 board (in Windows)', () => {
  const items = sumMaterials(computeProjectMaterials(
    [{ id: 1, ...ext24 }], baseSettings,
    [{ ...window36x48, wall_type: 'exterior_2x6' }],
  ));
  assert.equal(findRow(items, SECTIONS.WINDOWS, '2 X 10 X 16 PREMIUM SPRUCE').quantity, 1);
});
test('Door header: 1 board (in Doors)', () => {
  const items = sumMaterials(computeProjectMaterials(
    [{ id: 1, ...ext24 }], baseSettings,
    [{ ...door36x83, wall_type: 'exterior_2x6' }],
  ));
  assert.equal(findRow(items, SECTIONS.DOORS, '2 X 10 X 16 PREMIUM SPRUCE').quantity, 1);
});
test('Window jack studs: 48"/12=4ft → 2 X 6 X 4FT, qty 2', () => {
  const items = sumMaterials(computeProjectMaterials(
    [{ id: 1, ...ext24 }], baseSettings,
    [{ ...window36x48, wall_type: 'exterior_2x6' }],
  ));
  assert.equal(findRow(items, SECTIONS.WINDOWS, '2 X 6 X 4FT PREMIUM SPRUCE').quantity, 2);
});
test('Door jack studs: 83"/12=6.92 → 7ft, 2 X 6 X 7FT, qty 2', () => {
  const items = sumMaterials(computeProjectMaterials(
    [{ id: 1, ...ext24 }], baseSettings,
    [{ ...door36x83, wall_type: 'exterior_2x6' }],
  ));
  assert.equal(findRow(items, SECTIONS.DOORS, '2 X 6 X 7FT PREMIUM SPRUCE').quantity, 2);
});
test('Interior 2x4 wall opening: jack stud uses 2 X 4', () => {
  const intWall = { id: 1, x1:0,y1:0,x2:'12',y2:0, wall_type:'interior_2x4', height:null, extra_corner_studs:0 };
  const items = sumMaterials(computeProjectMaterials(
    [intWall], baseSettings,
    [{ ...window36x48, wall_id: 1, wall_type: 'interior_2x4' }],
  ));
  assert.ok(findRow(items, SECTIONS.WINDOWS, '2 X 4 X 4FT PREMIUM SPRUCE'));
});
test('Interior 2x6 wall opening: jack stud uses 2 X 6', () => {
  const intWall = { id: 1, x1:0,y1:0,x2:'12',y2:0, wall_type:'interior_2x6', height:null, extra_corner_studs:0 };
  const items = sumMaterials(computeProjectMaterials(
    [intWall], baseSettings,
    [{ ...window36x48, wall_id: 1, wall_type: 'interior_2x6' }],
  ));
  assert.ok(findRow(items, SECTIONS.WINDOWS, '2 X 6 X 4FT PREMIUM SPRUCE'));
});

console.log('\n=== Shims ===');
test('1+1 openings → 1 BAG in Windows', () => {
  const items = sumMaterials(computeProjectMaterials(
    [{ id: 1, ...ext24 }], baseSettings,
    [
      { ...window36x48, wall_type: 'exterior_2x6' },
      { ...door36x83, wall_type: 'exterior_2x6' },
    ],
  ));
  const r = findRow(items, SECTIONS.WINDOWS, 'SHIMS 10/10 BAG OF 60');
  assert.equal(r.quantity, 1); assert.equal(r.unit, 'BAG');
});
test('3 openings = 18 shims → 1 bag', () => {
  const opens = Array(3).fill(0).map(() => ({ ...window36x48, wall_type: 'exterior_2x6' }));
  const items = sumMaterials(computeProjectMaterials([{ id: 1, ...ext24 }], baseSettings, opens));
  assert.equal(findRow(items, SECTIONS.WINDOWS, 'SHIMS 10/10 BAG OF 60').quantity, 1);
});
test('11 openings = 66 shims → 2 bags', () => {
  const opens = Array(11).fill(0).map(() => ({ ...window36x48, wall_type: 'exterior_2x6' }));
  const items = sumMaterials(computeProjectMaterials([{ id: 1, ...ext24 }], baseSettings, opens));
  assert.equal(findRow(items, SECTIONS.WINDOWS, 'SHIMS 10/10 BAG OF 60').quantity, 2);
});
test('Doors-only: shims still go in Windows section', () => {
  const items = sumMaterials(computeProjectMaterials(
    [{ id: 1, ...ext24 }], baseSettings,
    [{ ...door36x83, wall_type: 'exterior_2x6' }],
  ));
  assert.ok(findRow(items, SECTIONS.WINDOWS, 'SHIMS 10/10 BAG OF 60'));
});
test('Zero openings: no shims row', () => {
  const items = sumMaterials(computeProjectMaterials([{ id: 1, ...ext24 }], baseSettings, []));
  assert.equal(items.find((r) => r.name === 'SHIMS 10/10 BAG OF 60'), undefined);
});

console.log('\n=== 3-wall worked example: 24 + 20 + 16 ft exterior 2x6, default settings ===');
const walls3 = ['24','20','16'].map((L, i) => ({
  id: i + 1, x1:0,y1:0,x2:L,y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0,
}));
const all3 = [];
for (const w of walls3) all3.push(...computeWallMaterials(w, baseSettings));
all3.push(...computeProjectMaterials(walls3, baseSettings));
const rolled3 = sumMaterials(all3);

// Now plates split by category — Bottom Plate and Top Plate are distinct rows.
const expected3 = [
  [SECTIONS.EXTERIOR_WALLS, 'Bottom Plate', '2 X 6 X 16 PREMIUM SPRUCE', 6],   // 5.25 → 6
  [SECTIONS.EXTERIOR_WALLS, 'Top Plate',    '2 X 6 X 16 PREMIUM SPRUCE', 9],   // 8.40 → 9
  [SECTIONS.EXTERIOR_WALLS, 'Studs',        '2 X 6 X 104-5/8 PREMIUM SPRUCE', 48],
  [SECTIONS.EXTERIOR_WALLS, 'Sheathing',    '4 X 8 - 7/16 ORIENTED STRAND BOARD', 20],
  [SECTIONS.EXTERIOR_WALLS, 'Building Wrap', "9'X100' TYPAR HOUSEWRAP", 1],
  [SECTIONS.EXTERIOR_WALLS, 'Building Wrap Tape', 'TAPE,SHEATHING PLY RED 60MMX55M', 1],
  [SECTIONS.EXTERIOR_WALLS, 'Sill Gasket', 'GASKET,SILL 3/16 WHITE 5.5X82', 1],
  [SECTIONS.EXTERIOR_WALLS, 'Wall Bracing', '2 X 4 X 16 PREMIUM SPRUCE', 8],
  [SECTIONS.INSULATION,     'Insulation',   'R22-15 FIBREGLASS INSUL. 49.0 SQ FT', 12],
  [SECTIONS.EXTERIOR_WALLS, 'Exterior Insulation', 'SILVERBOARD GRAPHITE 4X8 1" R5', 20],
  [SECTIONS.FINISHINGS,     'Wall Drywall', '4 X 9 - 1/2" DRYWALL', 17],
];
for (const [section, category, name, qty] of expected3) {
  test(`${section} / ${category} / ${name} = ${qty}`, () => {
    const r = rolled3.find((x) => x.section === section && x.category === category && x.name === name);
    assert.ok(r, 'row missing');
    assert.equal(r.quantity, qty);
  });
}
test('3-wall example: no Windows / Doors / Interior Walls subsections', () => {
  for (const sec of [SECTIONS.WINDOWS, SECTIONS.DOORS, SECTIONS.INTERIOR_WALLS]) {
    assert.equal(rolled3.find((r) => r.section === sec), undefined, sec);
  }
});

console.log('\n=== Interior-only project ===');
const interior12 = {
  id: 1, x1:0,y1:0,x2:'12',y2:0, wall_type:'interior_2x4', height:null, extra_corner_studs:0,
};
const intItems = [
  ...computeWallMaterials(interior12, baseSettings),
  ...computeProjectMaterials([interior12], baseSettings),
];
const intRolled = sumMaterials(intItems);
test('interior-only: 2x4 bottom plate row = 2 (1.05 → 2)', () => {
  const r = intRolled.find((x) => x.category === 'Bottom Plate' && x.name === '2 X 4 X 16 PREMIUM SPRUCE');
  assert.equal(r.quantity, 2);
});
test('interior-only: 2x4 top plate row = 3 (2.10 → 3)', () => {
  const r = intRolled.find((x) => x.category === 'Top Plate' && x.name === '2 X 4 X 16 PREMIUM SPRUCE');
  assert.equal(r.quantity, 3);
});
test('interior-only: 2x4 studs in Interior Walls', () => {
  assert.equal(findRow(intRolled, SECTIONS.INTERIOR_WALLS, '2 X 4 X 104-5/8 PREMIUM SPRUCE').quantity, 10);
});
test('interior-only: wall drywall (4x9) in Finishings (both faces)', () => {
  // 12*9*2 = 216 sf / 36 sf-per-sheet = 6 ×1.10 = 6.6 → ceil 7
  const r = findRow(intRolled, SECTIONS.FINISHINGS, '4 X 9 - 1/2" DRYWALL');
  assert.equal(r.quantity, 7);
});
test('interior-only: plate poly in Interior Walls', () => {
  assert.ok(findRow(intRolled, SECTIONS.INTERIOR_WALLS, '12 X 300FT CLEAR POLY'));
});
test('interior-only: no Exterior Walls / Insulation / Exterior Insulation rows', () => {
  for (const sec of [SECTIONS.EXTERIOR_WALLS, SECTIONS.INSULATION, SECTIONS.EXTERIOR_INSULATION]) {
    assert.equal(intRolled.find((r) => r.section === sec), undefined, sec);
  }
});

console.log('\n=== Tables sanity ===');
test('all 22 insulation keys present', () => {
  const expected = [
    'pink_r12_15','pink_r12_23','pink_r14_15','pink_r20_15','pink_r20_23',
    'pink_r22_15','pink_r22_23','pink_r24_15','pink_r24_23','pink_r28_15',
    'pink_r28_16','pink_r28_19','pink_r28_24','pink_r31_24','pink_r35_16',
    'pink_r40_16','pink_r40_24','rockwool_r14_15','rockwool_r14_23',
    'rockwool_r22_15','rockwool_r22_23','rockwool_sns_15',
  ];
  for (const k of expected) assert.ok(INSULATION_TYPES[k], `missing key: ${k}`);
});
test('all 3 silverboard keys present', () => {
  for (const k of ['silverboard_1', 'silverboard_15', 'silverboard_2']) {
    assert.ok(SILVERBOARD_TYPES[k], `missing key: ${k}`);
  }
});

console.log('\n=== Empty / zero-length walls ===');
test('zero-length wall produces no items', () => {
  const w = { x1:'5', y1:'5', x2:'5', y2:'5', wall_type:'exterior_2x6', height:null, extra_corner_studs:0 };
  assert.equal(computeWallMaterials(w, baseSettings).length, 0);
});
test('empty walls list produces no project items', () => {
  assert.equal(computeProjectMaterials([], baseSettings).length, 0);
});

console.log('\n=== Floor plan polygon ===');
test('buildFloorPlanWalls: rectangle 24×30 produces 4 walls with correct edge lengths', () => {
  const corners = [{x:0,y:0},{x:24,y:0},{x:24,y:30},{x:0,y:30}];
  const walls = buildFloorPlanWalls(corners, []);
  assert.equal(walls.length, 4);
  // Edge 0: (0,0)→(24,0) length 24
  // Edge 1: (24,0)→(24,30) length 30
  // Edge 2: (24,30)→(0,30) length 24
  // Edge 3: (0,30)→(0,0) length 30
  const lens = walls.map((w) => Math.sqrt((w.x2-w.x1)**2 + (w.y2-w.y1)**2));
  assert.deepEqual(lens, [24, 30, 24, 30]);
  // All default to exterior_2x6
  for (const w of walls) assert.equal(w.wall_type, 'exterior_2x6');
});
test('buildFloorPlanWalls: empty/insufficient corners returns []', () => {
  assert.deepEqual(buildFloorPlanWalls([], []), []);
  assert.deepEqual(buildFloorPlanWalls([{x:0,y:0}], []), []);
  assert.deepEqual(buildFloorPlanWalls([{x:0,y:0},{x:1,y:0}], []), []);
});
test('buildFloorPlanWalls: per-edge wall_type override flows from floor_plan_walls', () => {
  const corners = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
  const fpWalls = [
    { id: 1, wall_index: 0, wall_type: 'exterior_2x6' },
    { id: 2, wall_index: 1, wall_type: 'interior_2x4' },
    { id: 3, wall_index: 2, wall_type: 'exterior_2x6' },
    { id: 4, wall_index: 3, wall_type: 'interior_2x6' },
  ];
  const walls = buildFloorPlanWalls(corners, fpWalls);
  assert.equal(walls[0].wall_type, 'exterior_2x6');
  assert.equal(walls[1].wall_type, 'interior_2x4');
  assert.equal(walls[2].wall_type, 'exterior_2x6');
  assert.equal(walls[3].wall_type, 'interior_2x6');
});

console.log('\n=== 24×30 rectangle floor plan worked example ===');
const rectCorners = [{x:0,y:0},{x:24,y:0},{x:24,y:30},{x:0,y:30}];
const rectFpWalls = [
  { id: 1, wall_index: 0, wall_type: 'exterior_2x6' },
  { id: 2, wall_index: 1, wall_type: 'exterior_2x6' },
  { id: 3, wall_index: 2, wall_type: 'exterior_2x6' },
  { id: 4, wall_index: 3, wall_type: 'exterior_2x6' },
];
const rectItems = computeFloorPlanMaterials(rectCorners, rectFpWalls, baseSettings, []);
const rectRolled = sumMaterials(rectItems);

const expectedRect = [
  [SECTIONS.EXTERIOR_WALLS, 'Bottom Plate', '2 X 6 X 16 PREMIUM SPRUCE', 9],
  [SECTIONS.EXTERIOR_WALLS, 'Top Plate',    '2 X 6 X 16 PREMIUM SPRUCE', 15],
  [SECTIONS.EXTERIOR_WALLS, 'Studs',        '2 X 6 X 104-5/8 PREMIUM SPRUCE', 86],
  [SECTIONS.EXTERIOR_WALLS, 'Sheathing',    '4 X 8 - 7/16 ORIENTED STRAND BOARD', 36],
  [SECTIONS.EXTERIOR_WALLS, 'Building Wrap', "9'X100' TYPAR HOUSEWRAP", 2],
  [SECTIONS.EXTERIOR_WALLS, 'Building Wrap Tape', 'TAPE,SHEATHING PLY RED 60MMX55M', 1],
  [SECTIONS.EXTERIOR_WALLS, 'Sill Gasket', 'GASKET,SILL 3/16 WHITE 5.5X82', 2],
  [SECTIONS.EXTERIOR_WALLS, 'Wall Bracing', '2 X 4 X 16 PREMIUM SPRUCE', 14],
  [SECTIONS.INSULATION,     'Insulation',   'R22-15 FIBREGLASS INSUL. 49.0 SQ FT', 20],
  [SECTIONS.EXTERIOR_WALLS, 'Exterior Insulation', 'SILVERBOARD GRAPHITE 4X8 1" R5', 36],
  [SECTIONS.FINISHINGS,     'Wall Drywall', '4 X 9 - 1/2" DRYWALL', 31],
];
for (const [section, category, name, qty] of expectedRect) {
  test(`rectangle ${category} / ${name} = ${qty}`, () => {
    const r = rectRolled.find((x) => x.section === section && x.category === category && x.name === name);
    assert.ok(r, `row missing: ${section} / ${category} / ${name}`);
    assert.equal(r.quantity, qty);
  });
}

console.log('\n=== L-shape floor plan (6 corners) ===');
test('L-shape produces 6 walls with correct edge lengths', () => {
  // L-shape: (0,0)→(20,0)→(20,10)→(10,10)→(10,20)→(0,20)→back to (0,0)
  const corners = [
    {x:0,y:0},{x:20,y:0},{x:20,y:10},
    {x:10,y:10},{x:10,y:20},{x:0,y:20},
  ];
  const walls = buildFloorPlanWalls(corners, []);
  assert.equal(walls.length, 6);
  const lens = walls.map((w) => Math.round(Math.sqrt((w.x2-w.x1)**2 + (w.y2-w.y1)**2)));
  assert.deepEqual(lens, [20, 10, 10, 10, 10, 20]);
  // Total perimeter = 80 lf
});

console.log('\n=== Corner drag invariance ===');
test('moving one corner changes only the two adjacent edge lengths', () => {
  const before = buildFloorPlanWalls(
    [{x:0,y:0},{x:24,y:0},{x:24,y:30},{x:0,y:30}], [],
  );
  // Move ONLY corner 1 from (24,0) to (30,0); corner 2 stays at (24,30)
  const after = buildFloorPlanWalls(
    [{x:0,y:0},{x:30,y:0},{x:24,y:30},{x:0,y:30}], [],
  );
  const lenOf = (w) => Math.sqrt((w.x2-w.x1)**2 + (w.y2-w.y1)**2);
  // Edge 0: was 24 (0,0→24,0), now 30 (0,0→30,0)
  assert.equal(lenOf(before[0]), 24);
  assert.equal(lenOf(after[0]), 30);
  // Edge 1: was 30 (24,0→24,30), now sqrt(36+900)=30.59 (30,0→24,30)
  assert.ok(Math.abs(lenOf(after[1]) - Math.sqrt(36 + 900)) < 1e-9);
  // Edges 2 and 3 untouched
  assert.equal(lenOf(before[2]), lenOf(after[2]));
  assert.equal(lenOf(before[3]), lenOf(after[3]));
});

console.log('\n=== Openings tied to floor_plan_wall_id ===');
test('opening with floor_plan_wall_id deducts area from its edge', () => {
  const corners = [{x:0,y:0},{x:24,y:0},{x:24,y:9},{x:0,y:9}];
  const fpWalls = [
    { id: 100, wall_index: 0, wall_type: 'exterior_2x6' },
    { id: 101, wall_index: 1, wall_type: 'exterior_2x6' },
    { id: 102, wall_index: 2, wall_type: 'exterior_2x6' },
    { id: 103, wall_index: 3, wall_type: 'exterior_2x6' },
  ];
  // Opening on edge 0 (the 24ft wall, but height = 9 from corners y-extent? No — height comes from settings)
  // Actually edges in this rectangle have computed length-by-distance: edge 0 = 24, edge 1 = 9, edge 2 = 24, edge 3 = 9.
  // Wall height is 9ft (default).
  // Edge 0 area = 24×9 = 216 sf. Opening 36×48 (12 sf) on edge 0 → net 204 sf for sheathing on that edge.
  const opens = [
    { id: 1, floor_plan_wall_id: 100, type: 'window', rough_opening_width: 36, rough_opening_height: 48 },
  ];
  const items = computeFloorPlanMaterials(corners, fpWalls, baseSettings, opens);
  const rolled = sumMaterials(items);
  // Sheathing across all 4 walls: 24×9, 9×9, 24×9, 9×9 = 216+81+216+81 = 594 sf gross
  //   Edge 0 (with deduction): ceil((216-12)/32)*1.10 = ceil(204/32)=7 ×1.10 = 7.7
  //   Edge 1: ceil(81/32)=3 ×1.10 = 3.3
  //   Edge 2: ceil(216/32)=7 ×1.10 = 7.7
  //   Edge 3: ceil(81/32)=3 ×1.10 = 3.3
  //   Total: 22.0 → ceil 22
  const r = rolled.find((x) => x.category === 'Sheathing');
  assert.equal(r.quantity, 22);
});

console.log('\n=== Multi-storey: section labels ===');
test('Default level is Floor 1; SECTIONS pin to Floor 1', () => {
  assert.equal(SECTIONS.EXTERIOR_WALLS, 'Floor 1 — Exterior Walls');
  assert.equal(SECTIONS.FINISHINGS, 'Floor 1 — Finishings');
});
test('sectionFor produces level-prefixed labels', () => {
  assert.equal(sectionFor('EXTERIOR_WALLS', 'foundation'), 'Foundation — Exterior Walls');
  assert.equal(sectionFor('EXTERIOR_WALLS', 'floor1'), 'Floor 1 — Exterior Walls');
  assert.equal(sectionFor('EXTERIOR_WALLS', 'floor2'), 'Floor 2 — Exterior Walls');
  assert.equal(sectionFor('EXTERIOR_INSULATION', 'floor2'), 'Exterior Insulation');
  assert.equal(sectionFor('ROOF', 'roof'), 'Roof');
});
test('SECTION_ORDER places Foundation before Floor 1 before Floor 2', () => {
  const i1 = SECTION_ORDER.indexOf('Foundation — Exterior Walls');
  const i2 = SECTION_ORDER.indexOf('Floor 1 — Exterior Walls');
  const i3 = SECTION_ORDER.indexOf('Floor 2 — Exterior Walls');
  const iRoof = SECTION_ORDER.indexOf('Roof');
  assert.ok(i1 >= 0 && i2 > i1 && i3 > i2);
  assert.ok(iRoof > i3);
  // The standalone "Exterior Insulation" section was removed (silverboard now in
  // per-level Exterior Walls section).
  assert.equal(SECTION_ORDER.indexOf('Exterior Insulation'), -1);
});

console.log('\n=== Multi-storey: per-level materials ===');
test('Floor 2 wall materials use Floor 2 — prefix', () => {
  const proj = { ...PG_PROJECT, floor2_wall_height: '8' };
  const settings = resolveProjectSettings(proj, PG_GLOBAL, 'floor2');
  assert.equal(settings.wallHeight, 8);
  const wall = { x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0 };
  const items = sumMaterials(computeWallMaterials(wall, settings, [], 'floor2'));
  // Plates land in Floor 2 — Exterior Walls
  assert.ok(items.find((r) => r.section === 'Floor 2 — Exterior Walls' && r.category === 'Bottom Plate'));
  // Studs use 92-5/8 precut for 8ft wall
  const studs = items.find((r) => r.category === 'Studs');
  assert.equal(studs.name, '2 X 6 X 92-5/8 PREMIUM SPRUCE');
  assert.equal(studs.section, 'Floor 2 — Exterior Walls');
});
test('Floor 1 + Floor 2 stacked rectangles produce per-level prefixes (no merging)', () => {
  const corners = [{x:0,y:0},{x:24,y:0},{x:24,y:30},{x:0,y:30}];
  const fpWalls = [
    { id: 1, wall_index: 0, wall_type: 'exterior_2x6' },
    { id: 2, wall_index: 1, wall_type: 'exterior_2x6' },
    { id: 3, wall_index: 2, wall_type: 'exterior_2x6' },
    { id: 4, wall_index: 3, wall_type: 'exterior_2x6' },
  ];
  const settings1 = resolveProjectSettings(PG_PROJECT, PG_GLOBAL, 'floor1');
  const items1 = computeFloorPlanMaterials(corners, fpWalls, settings1, [], 'floor1');
  const fpWalls2 = [
    { id: 5, wall_index: 0, wall_type: 'exterior_2x6' },
    { id: 6, wall_index: 1, wall_type: 'exterior_2x6' },
    { id: 7, wall_index: 2, wall_type: 'exterior_2x6' },
    { id: 8, wall_index: 3, wall_type: 'exterior_2x6' },
  ];
  const settings2 = resolveProjectSettings({ ...PG_PROJECT, floor2_wall_height: '8' }, PG_GLOBAL, 'floor2');
  const items2 = computeFloorPlanMaterials(corners, fpWalls2, settings2, [], 'floor2');
  const rolled = sumMaterials([...items1, ...items2]);
  // Both levels' housewrap appear as separate rows (per-level rollup, M1)
  const f1Wrap = rolled.find((r) => r.section === 'Floor 1 — Exterior Walls' && r.name === "9'X100' TYPAR HOUSEWRAP");
  const f2Wrap = rolled.find((r) => r.section === 'Floor 2 — Exterior Walls' && r.name === "9'X100' TYPAR HOUSEWRAP");
  assert.ok(f1Wrap); assert.ok(f2Wrap);
  // Floor 2 studs are 92-5/8 (different SKU from Floor 1)
  assert.ok(rolled.find((r) => r.section === 'Floor 2 — Exterior Walls' && r.name === '2 X 6 X 92-5/8 PREMIUM SPRUCE'));
  assert.ok(rolled.find((r) => r.section === 'Floor 1 — Exterior Walls' && r.name === '2 X 6 X 104-5/8 PREMIUM SPRUCE'));
  // Silverboard now lives in the per-level Exterior Walls section, so it splits.
  const allSilver = rolled.filter((r) => r.name === 'SILVERBOARD GRAPHITE 4X8 1" R5');
  assert.equal(allSilver.length, 2);
  const f1Silver = allSilver.find((r) => r.section === 'Floor 1 — Exterior Walls');
  const f2Silver = allSilver.find((r) => r.section === 'Floor 2 — Exterior Walls');
  assert.ok(f1Silver, 'expected silverboard in Floor 1 Exterior Walls');
  assert.ok(f2Silver, 'expected silverboard in Floor 2 Exterior Walls');
});

console.log('\n=== Roof materials (Session 3) ===');
test('Pitch multipliers match spec: 6:12 ≈ 1.118', () => {
  assert.ok(Math.abs(ROOF_PITCH_MULTIPLIER['6:12'] - Math.sqrt(1 + 0.25)) < 1e-9);
});
test('40×50 roof, 6:12 pitch, 24" oc, 1/2 CSP plywood: ~154 sheets, 2 boxes H-clips', () => {
  const items = computeRoofMaterials({
    width_ft: 40, depth_ft: 50, pitch: '6:12',
    sheathing_type: 'plywood_1_2_csp', rafter_spacing: '24_oc',
  });
  const rolled = sumMaterials(items);
  // Roof area = 40 × 50 × 1.118... × 2 = ~4472 sf
  // ceil(4472/32) = 140, × 1.10 = 154 sheets
  const sheath = rolled.find((r) => r.category === 'Sheathing' && r.name === '4 X 8 - 1/2 STD.SPRUCE PLYWOOD');
  assert.equal(sheath.quantity, 154);
  // H-clips: 140 × 2 × 1.05 = 294 / 250 = ceil(1.176) = 2 boxes
  const clips = rolled.find((r) => r.name === 'CLPS,ROOF 250/BOX 20GA 1/2"');
  assert.equal(clips.quantity, 2);
  assert.equal(clips.unit, 'BX');
  // Hurricane ties: perimeter 180, spacing 2 → 90 ties
  const ties = rolled.find((r) => r.name === 'TIE,HURRICANE 18GA ZMAX H1Z');
  assert.equal(ties.quantity, 90);
  // Blocking: 180/12 = 15 boards
  const block = rolled.find((r) => r.name === '2 X 6 X 16 PREMIUM SPRUCE' && r.category === 'Blocking');
  assert.equal(block.quantity, 15);
});
test('All roof rows land in section "Roof" (no level prefix)', () => {
  const items = computeRoofMaterials({
    width_ft: 40, depth_ft: 50, pitch: '6:12',
    sheathing_type: 'plywood_1_2_csp', rafter_spacing: '24_oc',
  });
  for (const it of items) assert.equal(it.section, 'Roof');
});
test('Empty roof returns []', () => {
  assert.deepEqual(computeRoofMaterials(null), []);
  assert.deepEqual(computeRoofMaterials({ width_ft: 0, depth_ft: 50 }), []);
});
test('16" oc spacing yields 3 clips per sheet (more H-clips, more blocking)', () => {
  const items = computeRoofMaterials({
    width_ft: 40, depth_ft: 50, pitch: '6:12',
    sheathing_type: 'osb_7_16', rafter_spacing: '16_oc',
  });
  const rolled = sumMaterials(items);
  // 140 sheets × 3 × 1.05 = 441 / 250 = 2 boxes
  const clips = rolled.find((r) => r.name === 'CLPS,ROOF 250/BOX 20GA 1/2"');
  assert.equal(clips.quantity, 2);
  // Hurricane ties: 180/(16/12) = 180 × 0.75 = 135 ties
  const ties = rolled.find((r) => r.name === 'TIE,HURRICANE 18GA ZMAX H1Z');
  assert.equal(ties.quantity, 135);
});

console.log(`\nResult: ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
