// Pure deterministic rules engine for wall takeoff.
// pg returns NUMERIC columns as strings — every numeric value coming from the
// database goes through num() before any arithmetic.
// All FINAL quantities are rounded up to whole units (sumMaterials applies ceil)
// because lumberyards don't sell half a board.

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// ---------- sections (floor-prefixed subsections) ----------
export const SECTIONS = {
  EXTERIOR_WALLS:      'First Floor — Exterior Walls',
  INSULATION:          'First Floor — Insulation',
  EXTERIOR_INSULATION: 'Exterior Insulation',
  INTERIOR_WALLS:      'First Floor — Interior Walls',
  WINDOWS:             'First Floor — Windows',
  DOORS:               'First Floor — Doors',
  FINISHINGS:          'First Floor — Finishings',
};

export const SECTION_ORDER = [
  SECTIONS.EXTERIOR_WALLS,
  SECTIONS.INSULATION,
  SECTIONS.EXTERIOR_INSULATION,
  SECTIONS.INTERIOR_WALLS,
  SECTIONS.WINDOWS,
  SECTIONS.DOORS,
  SECTIONS.FINISHINGS,
];

export function sectionRank(section) {
  if (!section) return SECTION_ORDER.length + 1;
  const i = SECTION_ORDER.indexOf(section);
  return i === -1 ? SECTION_ORDER.length : i;
}

// Per-item category labels (sub-classification within a section).
export const CATEGORIES = {
  BOTTOM_PLATE: 'Bottom Plate',
  TOP_PLATE: 'Top Plate',
  STUDS: 'Studs',
  SHEATHING: 'Sheathing',
  BUILDING_WRAP: 'Building Wrap',
  BUILDING_WRAP_TAPE: 'Building Wrap Tape',
  SILL_GASKET: 'Sill Gasket',
  WALL_BRACING: 'Wall Bracing',
  INSULATION: 'Insulation',
  EXTERIOR_INSULATION: 'Exterior Insulation',
  PLATE_POLY: 'Plate Poly',
  HEADER: 'Header',
  JACK_STUDS: 'Jack Studs',
  SHIMS: 'Shims',
  DRYWALL: 'Drywall',
};
export const CATEGORY_ORDER = [
  CATEGORIES.BOTTOM_PLATE,
  CATEGORIES.TOP_PLATE,
  CATEGORIES.STUDS,
  CATEGORIES.HEADER,
  CATEGORIES.JACK_STUDS,
  CATEGORIES.SHIMS,
  CATEGORIES.SHEATHING,
  CATEGORIES.EXTERIOR_INSULATION,
  CATEGORIES.BUILDING_WRAP,
  CATEGORIES.BUILDING_WRAP_TAPE,
  CATEGORIES.SILL_GASKET,
  CATEGORIES.WALL_BRACING,
  CATEGORIES.INSULATION,
  CATEGORIES.PLATE_POLY,
  CATEGORIES.DRYWALL,
];
export function categoryRank(category) {
  if (!category) return CATEGORY_ORDER.length + 1;
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

// ---------- insulation table ----------
export const INSULATION_TYPES = {
  pink_r12_15: { name: 'R12-15 FIBREGLASS INSUL.',           coverage_sf: 97.9,  group: 'Pink Fibreglass' },
  pink_r12_23: { name: 'R12-23 FIBREGLASS INSUL.',           coverage_sf: 150.1, group: 'Pink Fibreglass' },
  pink_r14_15: { name: 'R14-15 FIBREGLASS INSUL.',           coverage_sf: 78.3,  group: 'Pink Fibreglass' },
  pink_r20_15: { name: 'R20-15 FIBREGLASS INSUL.',           coverage_sf: 78.3,  group: 'Pink Fibreglass' },
  pink_r20_23: { name: 'R20-23 FIBREGLASS INSUL.',           coverage_sf: 120.1, group: 'Pink Fibreglass' },
  pink_r22_15: { name: 'R22-15 FIBREGLASS INSUL. 49.0 SQ FT', coverage_sf: 49.0, group: 'Pink Fibreglass' },
  pink_r22_23: { name: 'R22-23 FIBREGLASS INSUL.',           coverage_sf: 75.1,  group: 'Pink Fibreglass' },
  pink_r24_15: { name: 'R24-15 FIBREGLASS INSUL.',           coverage_sf: 33.7,  group: 'Pink Fibreglass' },
  pink_r24_23: { name: 'R24-23 FIBREGLASS INSUL.',           coverage_sf: 52.0,  group: 'Pink Fibreglass' },
  pink_r28_15: { name: 'R28-15 FIBREGLASS INSUL.',           coverage_sf: 50.0,  group: 'Pink Fibreglass' },
  pink_r28_16: { name: 'R28-16 FIBREGLASS INSUL.',           coverage_sf: 53.3,  group: 'Pink Fibreglass' },
  pink_r28_19: { name: 'R28-19 FIBREGLASS INSUL.',           coverage_sf: 63.4,  group: 'Pink Fibreglass' },
  pink_r28_24: { name: 'R28-24 FIBREGLASS INSUL.',           coverage_sf: 80.0,  group: 'Pink Fibreglass' },
  pink_r31_24: { name: 'R31-24 FIBREGLASS INSUL.',           coverage_sf: 64.0,  group: 'Pink Fibreglass' },
  pink_r35_16: { name: 'R35-16 FIBREGLASS INSUL.',           coverage_sf: 37.3,  group: 'Pink Fibreglass' },
  pink_r40_16: { name: 'R40-16 FIBREGLASS INSUL.',           coverage_sf: 32.0,  group: 'Pink Fibreglass' },
  pink_r40_24: { name: 'R40-24 FIBREGLASS INSUL.',           coverage_sf: 48.0,  group: 'Pink Fibreglass' },
  rockwool_r14_15: { name: 'ROCKWOOL R14-15 COMFORTBATT', coverage_sf: 59.7, group: 'Rockwool' },
  rockwool_r14_23: { name: 'ROCKWOOL R14-23 COMFORTBATT', coverage_sf: 60.1, group: 'Rockwool' },
  rockwool_r22_15: { name: 'ROCKWOOL R22-15 COMFORTBATT', coverage_sf: 39.8, group: 'Rockwool' },
  rockwool_r22_23: { name: 'ROCKWOOL R22-23 COMFORTBATT', coverage_sf: 37.5, group: 'Rockwool' },
  rockwool_sns_15: { name: 'ROCKWOOL SAFE N SOUND 3X15', coverage_sf: 59.7, group: 'Rockwool' },
};
export const DEFAULT_INSULATION_KEY = 'pink_r22_15';

// ---------- silverboard table ----------
export const SILVERBOARD_TYPES = {
  silverboard_1:  { name: 'SILVERBOARD GRAPHITE 4X8 1" R5' },
  silverboard_15: { name: 'SILVERBOARD GRAPHITE 4X8 1.5" R7.5' },
  silverboard_2:  { name: 'SILVERBOARD GRAPHITE 4X8 2" R10' },
};
export const DEFAULT_SILVERBOARD_KEY = 'silverboard_1';
const SILVERBOARD_SHEET_AREA_SF = 32;

// ---------- canonical SKUs ----------
const HOUSEWRAP_NAME = "9'X100' TYPAR HOUSEWRAP";
const WRAP_TAPE_NAME = 'TAPE,SHEATHING PLY RED 60MMX55M';
const DRYWALL_NAME = '4 X 12 - 1/2 DRYWALL';
const OSB_NAME = '4 X 8 - 7/16 ORIENTED STRAND BOARD';
const SILL_GASKET_NAME = 'GASKET,SILL 3/16 WHITE 5.5X82';
const BRACING_NAME = '2 X 4 X 16 PREMIUM SPRUCE';
const PLATE_POLY_NAME = '12 X 300FT CLEAR POLY';
const HEADER_LUMBER_NAME = '2 X 10 X 16 PREMIUM SPRUCE';
const SHIMS_NAME = 'SHIMS 10/10 BAG OF 60';

function sheetAreaFromName(name) {
  const m = /^(\d+)\s*X\s*(\d+)/i.exec(name);
  if (!m) throw new Error(`Cannot derive sheet area from material name: ${name}`);
  return Number(m[1]) * Number(m[2]);
}

const PLATE_BOARD_LENGTH_FT = 16;
const PLATE_WASTE = 0.05;
const SHEET_WASTE = 0.10;

const HOUSEWRAP_ROLL_LF = 100;
const SILL_GASKET_ROLL_LF = 82;
const BRACING_LF_PER_BRACE = 8;
const SHIMS_PER_OPENING = 6;
const SHIMS_PER_BAG = 60;
const HEADER_BEARING_FT = 0.5;

const PRECUT_LADDER = [
  { maxHeightFt: 8,  label: '92-5/8' },
  { maxHeightFt: 9,  label: '104-5/8' },
  { maxHeightFt: 10, label: '116-5/8' },
];
function precutForHeight(heightFt) {
  for (const r of PRECUT_LADDER) if (heightFt <= r.maxHeightFt) return r.label;
  return PRECUT_LADDER[PRECUT_LADDER.length - 1].label;
}

function lumberDimFor(wallType) {
  if (wallType === 'exterior_2x6' || wallType === 'interior_2x6') return '2 X 6';
  if (wallType === 'interior_2x4') return '2 X 4';
  throw new Error(`Unknown wall_type: ${wallType}`);
}

const EXTERIOR_TYPES = new Set(['exterior_2x6']);
const INTERIOR_TYPES = new Set(['interior_2x4', 'interior_2x6']);

function openingAreaSf(opening) {
  return (Number(opening.rough_opening_width) / 12) * (Number(opening.rough_opening_height) / 12);
}

// ---------- geometry ----------
export function wallLengthFt(wall, scaleFtPerGrid) {
  const x1 = num(wall.x1) ?? 0;
  const y1 = num(wall.y1) ?? 0;
  const x2 = num(wall.x2) ?? 0;
  const y2 = num(wall.y2) ?? 0;
  const scale = num(scaleFtPerGrid) ?? 1;
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) * scale;
}
function wallHeightFt(wall, settings) {
  return num(wall.height) ?? num(settings.wallHeight) ?? 9;
}

// ---------- settings resolver ----------
export function resolveProjectSettings(projectRow, globalRow) {
  const g = globalRow || {};
  const p = projectRow || {};
  return {
    wallHeight:        num(p.default_wall_height) ?? num(g.default_wall_height) ?? 9,
    exteriorSheathing: p.exterior_sheathing || g.exterior_sheathing || '7/16_osb',
    roofSheathing:     p.roof_sheathing || g.roof_sheathing || '1/2_csp',
    drywall:           p.drywall || g.drywall || '1/2_drywall',
    studSpacing:       num(p.stud_spacing) ?? num(g.stud_spacing) ?? 16,
    cornerStyle:       p.corner_style || g.corner_style || '3_stud',
    scaleFtPerGrid:    num(p.scale_ft_per_grid) ?? 1,
    insulationType:    p.insulation_type || DEFAULT_INSULATION_KEY,
    silverboardType:   p.silverboard_type || DEFAULT_SILVERBOARD_KEY,
  };
}

// ---------- per-wall items ----------
export function computeWallMaterials(wall, settings, wallOpenings = []) {
  const lengthFt = wallLengthFt(wall, settings.scaleFtPerGrid);
  if (lengthFt <= 0) return [];

  const heightFt = wallHeightFt(wall, settings);
  const studSpacing = num(settings.studSpacing) ?? 16;
  const extraCorner = Number(wall.extra_corner_studs ?? 0) || 0;
  const wallType = wall.wall_type;
  const lumberDim = lumberDimFor(wallType);
  const precut = precutForHeight(heightFt);
  const wallArea = lengthFt * heightFt;

  const openingArea = wallOpenings.reduce((sum, o) => sum + openingAreaSf(o), 0);
  const netArea = Math.max(0, wallArea - openingArea);

  const isExterior = EXTERIOR_TYPES.has(wallType);
  const wallSection = isExterior ? SECTIONS.EXTERIOR_WALLS : SECTIONS.INTERIOR_WALLS;

  const items = [];

  items.push({
    section: wallSection, category: CATEGORIES.BOTTOM_PLATE,
    name: `${lumberDim} X 16 PREMIUM SPRUCE`,
    unit: 'each',
    quantity: Math.ceil(lengthFt / PLATE_BOARD_LENGTH_FT) * (1 + PLATE_WASTE),
  });
  items.push({
    section: wallSection, category: CATEGORIES.TOP_PLATE,
    name: `${lumberDim} X 16 PREMIUM SPRUCE`,
    unit: 'each',
    quantity: Math.ceil((lengthFt * 2) / PLATE_BOARD_LENGTH_FT) * (1 + PLATE_WASTE),
  });

  const studCount = Math.ceil((lengthFt * 12) / studSpacing) + 1 + extraCorner;
  items.push({
    section: wallSection, category: CATEGORIES.STUDS,
    name: `${lumberDim} X ${precut} PREMIUM SPRUCE`,
    unit: 'each',
    quantity: studCount,
  });

  if (isExterior) {
    items.push({
      section: SECTIONS.EXTERIOR_WALLS, category: CATEGORIES.SHEATHING,
      name: OSB_NAME,
      unit: 'sheet',
      quantity: Math.ceil(netArea / sheetAreaFromName(OSB_NAME)) * (1 + SHEET_WASTE),
    });
    if (settings.silverboardType && settings.silverboardType !== 'none') {
      const sb = SILVERBOARD_TYPES[settings.silverboardType];
      if (!sb) throw new Error(`Unknown silverboard_type: ${settings.silverboardType}`);
      items.push({
        section: SECTIONS.EXTERIOR_INSULATION, category: CATEGORIES.EXTERIOR_INSULATION,
        name: sb.name,
        unit: 'EA',
        quantity: Math.ceil(netArea / SILVERBOARD_SHEET_AREA_SF) * (1 + SHEET_WASTE),
      });
    }
    items.push({
      section: SECTIONS.FINISHINGS, category: CATEGORIES.DRYWALL,
      name: DRYWALL_NAME,
      unit: 'sheet',
      quantity: Math.ceil(netArea / sheetAreaFromName(DRYWALL_NAME)) * (1 + SHEET_WASTE),
    });
  } else {
    items.push({
      section: SECTIONS.FINISHINGS, category: CATEGORIES.DRYWALL,
      name: DRYWALL_NAME,
      unit: 'sheet',
      quantity: Math.ceil((netArea * 2) / sheetAreaFromName(DRYWALL_NAME)) * (1 + SHEET_WASTE),
    });
  }

  return items;
}

// ---------- project-level rollups ----------
export function computeProjectMaterials(walls, settings, openings = []) {
  let totalExteriorLf = 0;
  let totalExteriorArea = 0;
  let hasInterior = false;
  const wallById = new Map(walls.map((w) => [w.id, w]));

  for (const w of walls) {
    const lengthFt = wallLengthFt(w, settings.scaleFtPerGrid);
    if (lengthFt <= 0) continue;
    if (EXTERIOR_TYPES.has(w.wall_type)) {
      totalExteriorLf += lengthFt;
      totalExteriorArea += lengthFt * wallHeightFt(w, settings);
    } else if (INTERIOR_TYPES.has(w.wall_type)) {
      hasInterior = true;
    }
  }

  let exteriorOpeningArea = 0;
  for (const o of openings) {
    const w = wallById.get(o.wall_id);
    if (w && EXTERIOR_TYPES.has(w.wall_type)) exteriorOpeningArea += openingAreaSf(o);
  }
  const netInsulationArea = Math.max(0, totalExteriorArea - exteriorOpeningArea);

  const items = [];

  if (totalExteriorLf > 0) {
    const wrapRolls = Math.ceil(totalExteriorLf / HOUSEWRAP_ROLL_LF);
    items.push({ section: SECTIONS.EXTERIOR_WALLS, category: CATEGORIES.BUILDING_WRAP,
      name: HOUSEWRAP_NAME, unit: 'RL', quantity: wrapRolls });
    items.push({ section: SECTIONS.EXTERIOR_WALLS, category: CATEGORIES.BUILDING_WRAP_TAPE,
      name: WRAP_TAPE_NAME, unit: 'RL', quantity: Math.ceil(wrapRolls / 2) });
    items.push({ section: SECTIONS.EXTERIOR_WALLS, category: CATEGORIES.SILL_GASKET,
      name: SILL_GASKET_NAME, unit: 'RL', quantity: Math.ceil(totalExteriorLf / SILL_GASKET_ROLL_LF) });
    items.push({ section: SECTIONS.EXTERIOR_WALLS, category: CATEGORIES.WALL_BRACING,
      name: BRACING_NAME, unit: 'EA', quantity: Math.ceil(totalExteriorLf / BRACING_LF_PER_BRACE) });
  }

  if (netInsulationArea > 0) {
    const key = settings.insulationType || DEFAULT_INSULATION_KEY;
    const spec = INSULATION_TYPES[key];
    if (!spec) throw new Error(`Unknown insulation type: ${key}`);
    items.push({
      section: SECTIONS.INSULATION, category: CATEGORIES.INSULATION,
      name: spec.name,
      unit: 'EA',
      quantity: Math.ceil(netInsulationArea / spec.coverage_sf),
    });
  }

  if (hasInterior) {
    items.push({ section: SECTIONS.INTERIOR_WALLS, category: CATEGORIES.PLATE_POLY,
      name: PLATE_POLY_NAME, unit: 'RL', quantity: 1 });
  }

  for (const o of openings) {
    const sec = o.type === 'door' ? SECTIONS.DOORS : SECTIONS.WINDOWS;
    const widthFt = Number(o.rough_opening_width) / 12;
    const heightFt = Number(o.rough_opening_height) / 12;
    const headerBoards = Math.max(1, Math.ceil((widthFt + HEADER_BEARING_FT) / 16 * 2));
    items.push({ section: sec, category: CATEGORIES.HEADER,
      name: HEADER_LUMBER_NAME, unit: 'each', quantity: headerBoards });

    const heightRoundedFt = Math.round(heightFt);
    const wt = o.wall_type;
    const jackDim =
      wt === 'exterior_2x6' || wt === 'interior_2x6' ? '2 X 6'
      : wt === 'interior_2x4' ? '2 X 4'
      : '2 X 6';
    items.push({
      section: sec, category: CATEGORIES.JACK_STUDS,
      name: `${jackDim} X ${heightRoundedFt}FT PREMIUM SPRUCE`,
      unit: 'each',
      quantity: 2,
    });
  }

  if (openings.length > 0) {
    const shimBags = Math.max(1, Math.ceil((openings.length * SHIMS_PER_OPENING) / SHIMS_PER_BAG));
    items.push({
      section: SECTIONS.WINDOWS, category: CATEGORIES.SHIMS,
      name: SHIMS_NAME,
      unit: 'BAG',
      quantity: shimBags,
    });
  }

  return items;
}

// ---------- rollup ----------
export function sumMaterials(items) {
  const map = new Map();
  for (const it of items) {
    const key = `${it.section || ''}|${it.category || ''}|${it.name}|${it.unit}`;
    const cur = map.get(key);
    if (cur) cur.quantity += it.quantity;
    else map.set(key, {
      section: it.section || null,
      category: it.category || null,
      name: it.name,
      unit: it.unit,
      quantity: it.quantity,
    });
  }
  return Array.from(map.values())
    .map((r) => ({ ...r, quantity: Math.ceil(r.quantity) }))
    .sort((a, b) => {
      const ra = sectionRank(a.section);
      const rb = sectionRank(b.section);
      if (ra !== rb) return ra - rb;
      const ca = categoryRank(a.category);
      const cb = categoryRank(b.category);
      if (ca !== cb) return ca - cb;
      return a.name.localeCompare(b.name);
    });
}
