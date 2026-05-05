// Self-contained tests for wallRules.js — no DB, no test framework.
// Run: node src/wallRules.test.js
import assert from 'node:assert/strict';
import {
  computeWallMaterials,
  computeProjectMaterials,
  sumMaterials,
  resolveProjectSettings,
  SECTIONS,
  SECTION_ORDER,
  INSULATION_TYPES,
  SILVERBOARD_TYPES,
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
test('SECTIONS contains all 7 expected subsection labels', () => {
  assert.equal(SECTIONS.EXTERIOR_WALLS,      'First Floor — Exterior Walls');
  assert.equal(SECTIONS.INSULATION,          'First Floor — Insulation');
  assert.equal(SECTIONS.EXTERIOR_INSULATION, 'Exterior Insulation');
  assert.equal(SECTIONS.INTERIOR_WALLS,      'First Floor — Interior Walls');
  assert.equal(SECTIONS.WINDOWS,             'First Floor — Windows');
  assert.equal(SECTIONS.DOORS,               'First Floor — Doors');
  assert.equal(SECTIONS.FINISHINGS,          'First Floor — Finishings');
});
test('SECTION_ORDER matches: Ext Walls → Insul → Ext Insul → Int Walls → Windows → Doors → Finishings', () => {
  assert.deepEqual(SECTION_ORDER, [
    SECTIONS.EXTERIOR_WALLS,
    SECTIONS.INSULATION,
    SECTIONS.EXTERIOR_INSULATION,
    SECTIONS.INTERIOR_WALLS,
    SECTIONS.WINDOWS,
    SECTIONS.DOORS,
    SECTIONS.FINISHINGS,
  ]);
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
test('Silverboard lands in "Exterior Insulation"', () => {
  const items = sumMaterials(computeWallMaterials({
    x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0,
  }, baseSettings));
  assert.ok(findRow(items, SECTIONS.EXTERIOR_INSULATION, 'SILVERBOARD GRAPHITE 4X8 1" R5'));
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
test('All drywall lands in "First Floor — Finishings" (exterior face + interior both faces)', () => {
  const ext = { id: 1, x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0 };
  const int = { id: 2, x1:0,y1:0,x2:'12',y2:0, wall_type:'interior_2x4', height:null, extra_corner_studs:0 };
  const all = [
    ...computeWallMaterials(ext, baseSettings),
    ...computeWallMaterials(int, baseSettings),
  ];
  const items = sumMaterials(all);
  // No drywall row in Exterior Walls or Interior Walls
  assert.equal(findRow(items, SECTIONS.EXTERIOR_WALLS, '4 X 12 - 1/2 DRYWALL'), undefined);
  assert.equal(findRow(items, SECTIONS.INTERIOR_WALLS, '4 X 12 - 1/2 DRYWALL'), undefined);
  // Drywall row exists in Finishings
  assert.ok(findRow(items, SECTIONS.FINISHINGS, '4 X 12 - 1/2 DRYWALL'));
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

console.log('\n=== Silverboard ===');
const ext24 = { x1:0,y1:0,x2:'24',y2:0, wall_type:'exterior_2x6', height:null, extra_corner_studs:0 };
test('Silverboard 1" R5 (default): 8 sheets (ceil(216/32)=7 ×1.10 = 7.7 → 8)', () => {
  const items = sumMaterials(computeWallMaterials(ext24, baseSettings));
  const r = findRow(items, SECTIONS.EXTERIOR_INSULATION, 'SILVERBOARD GRAPHITE 4X8 1" R5');
  assert.equal(r.quantity, 8);
});
test('Silverboard "none" omits the row entirely', () => {
  const s = resolveProjectSettings({ ...PG_PROJECT, silverboard_type: 'none' }, PG_GLOBAL);
  const items = sumMaterials(computeWallMaterials(ext24, s));
  assert.equal(items.find((r) => r.section === SECTIONS.EXTERIOR_INSULATION), undefined);
});
test('Silverboard absent on interior walls', () => {
  const interior = { x1:0,y1:0,x2:'12',y2:0, wall_type:'interior_2x4', height:null, extra_corner_studs:0 };
  const items = sumMaterials(computeWallMaterials(interior, baseSettings));
  assert.equal(items.find((r) => r.section === SECTIONS.EXTERIOR_INSULATION), undefined);
});

console.log('\n=== Opening area deductions ===');
const window36x48 = { wall_id: 1, type: 'window', rough_opening_width: '36', rough_opening_height: '48' };
const door36x83  = { wall_id: 1, type: 'door',   rough_opening_width: '36', rough_opening_height: '83' };

test('Sheathing deducts opening area: ceil(183.25/32)=6 ×1.10 = 6.6 → 7', () => {
  const items = sumMaterials(computeWallMaterials(ext24, baseSettings, [window36x48, door36x83]));
  assert.equal(findRow(items, SECTIONS.EXTERIOR_WALLS, '4 X 8 - 7/16 ORIENTED STRAND BOARD').quantity, 7);
});
test('Drywall deducts opening area: ceil(183.25/48)=4 ×1.10 = 4.4 → 5 (in Finishings)', () => {
  const items = sumMaterials(computeWallMaterials(ext24, baseSettings, [window36x48, door36x83]));
  assert.equal(findRow(items, SECTIONS.FINISHINGS, '4 X 12 - 1/2 DRYWALL').quantity, 5);
});
test('Silverboard deducts opening area → 7', () => {
  const items = sumMaterials(computeWallMaterials(ext24, baseSettings, [window36x48, door36x83]));
  assert.equal(findRow(items, SECTIONS.EXTERIOR_INSULATION, 'SILVERBOARD GRAPHITE 4X8 1" R5').quantity, 7);
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
  [SECTIONS.EXTERIOR_INSULATION, 'Exterior Insulation', 'SILVERBOARD GRAPHITE 4X8 1" R5', 20],
  [SECTIONS.FINISHINGS,     'Drywall',      '4 X 12 - 1/2 DRYWALL', 14],
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
test('interior-only: drywall in Finishings (both faces)', () => {
  // 12*9*2/48 = 4.5 → 5 ×1.10 = 5.5 → ceil 6
  const r = findRow(intRolled, SECTIONS.FINISHINGS, '4 X 12 - 1/2 DRYWALL');
  assert.equal(r.quantity, 6);
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

console.log(`\nResult: ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
