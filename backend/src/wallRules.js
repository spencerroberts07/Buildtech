// Pure deterministic rules engine for wall takeoff.
// pg returns NUMERIC columns as strings — every numeric value coming from the
// database goes through num() before any arithmetic.
// All FINAL quantities are rounded up to whole units (sumMaterials applies ceil)
// because lumberyards don't sell half a board.

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// ---------- sections (level-prefixed subsections) ----------
export const LEVELS = {
  FOUNDATION: 'foundation',
  FLOOR1: 'floor1',
  FLOOR2: 'floor2',
  ROOF: 'roof',
};
export const LEVEL_LABELS = {
  foundation: 'Foundation',
  floor1: 'Floor 1',
  floor2: 'Floor 2',
  roof: 'Roof',
};
const BASE_SECTIONS = {
  EXTERIOR_WALLS: 'Exterior Walls',
  INSULATION: 'Insulation',
  INTERIOR_WALLS: 'Interior Walls',
  WINDOWS: 'Windows',
  DOORS: 'Doors',
  FINISHINGS: 'Finishings',
  FLOOR: 'Floor',
};
const SOLO_SECTIONS = {
  EXTERIOR_INSULATION: 'Exterior Insulation',
  ROOF: 'Roof',
  PACKAGES: 'Packages',
};

export function sectionFor(baseKey, level = LEVELS.FLOOR1) {
  if (baseKey === 'EXTERIOR_INSULATION') return SOLO_SECTIONS.EXTERIOR_INSULATION;
  if (baseKey === 'ROOF') return SOLO_SECTIONS.ROOF;
  if (baseKey === 'PACKAGES') return SOLO_SECTIONS.PACKAGES;
  const base = BASE_SECTIONS[baseKey];
  if (!base) throw new Error(`Unknown base section: ${baseKey}`);
  const lvl = LEVEL_LABELS[level] || LEVEL_LABELS.floor1;
  return `${lvl} — ${base}`;
}

// Backward-compatible flat constants (default to Floor 1 — used by existing tests).
export const SECTIONS = {
  EXTERIOR_WALLS:      sectionFor('EXTERIOR_WALLS', LEVELS.FLOOR1),
  INSULATION:          sectionFor('INSULATION', LEVELS.FLOOR1),
  EXTERIOR_INSULATION: SOLO_SECTIONS.EXTERIOR_INSULATION,
  INTERIOR_WALLS:      sectionFor('INTERIOR_WALLS', LEVELS.FLOOR1),
  WINDOWS:             sectionFor('WINDOWS', LEVELS.FLOOR1),
  DOORS:               sectionFor('DOORS', LEVELS.FLOOR1),
  FINISHINGS:          sectionFor('FINISHINGS', LEVELS.FLOOR1),
  ROOF:                SOLO_SECTIONS.ROOF,
};

// Section order: every level's sections in order, then no-prefix solos.
function buildSectionOrder() {
  const out = [];
  for (const level of [LEVELS.FOUNDATION, LEVELS.FLOOR1, LEVELS.FLOOR2]) {
    out.push(
      sectionFor('EXTERIOR_WALLS', level),
      sectionFor('INSULATION', level),
      sectionFor('INTERIOR_WALLS', level),
      sectionFor('WINDOWS', level),
      sectionFor('DOORS', level),
      sectionFor('FINISHINGS', level),
      sectionFor('FLOOR', level),
    );
  }
  out.push(SOLO_SECTIONS.ROOF);
  out.push(SOLO_SECTIONS.EXTERIOR_INSULATION);
  out.push(SOLO_SECTIONS.PACKAGES);
  return out;
}
export const SECTION_ORDER = buildSectionOrder();

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
  VAPOUR_BARRIER: 'Vapour Barrier',
  EXTERIOR_INSULATION: 'Exterior Insulation',
  PLATE_POLY: 'Plate Poly',
  HEADER: 'Header',
  JACK_STUDS: 'Jack Studs',
  SHIMS: 'Shims',
  DRYWALL: 'Drywall',
  SUBFLOOR: 'Subfloor',
  SUBFLOOR_ADHESIVE: 'Subfloor Adhesive',
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
  CATEGORIES.VAPOUR_BARRIER,
  CATEGORIES.PLATE_POLY,
  CATEGORIES.DRYWALL,
  CATEGORIES.SUBFLOOR,
  CATEGORIES.SUBFLOOR_ADHESIVE,
  'Hardware',
  'Blocking',
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
const SILL_GASKET_55_NAME = 'GASKET,SILL 3/16 WHITE 5.5X82';
const SILL_GASKET_35_NAME = 'GASKET,SILL 3/16 WHITE 3.5X82';
const BRACING_NAME = '2 X 4 X 16 PREMIUM SPRUCE';
const PLATE_POLY_NAME = '12 X 300FT CLEAR POLY';
const HEADER_LUMBER_NAME = '2 X 10 X 16 PREMIUM SPRUCE';
const SHIMS_NAME = 'SHIMS 10/10 BAG OF 60';
const VAPOUR_BARRIER_NAME = "VAPOUR BARRIER 6M X1500 8'6\"";
const VAPOUR_BARRIER_ROLL_SF = 1500;
const VAPOUR_BARRIER_WASTE = 0.05;

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
export function resolveProjectSettings(projectRow, globalRow, level = LEVELS.FLOOR1) {
  const g = globalRow || {};
  const p = projectRow || {};
  // Per-level wall height default. Foundation has no default (per-wall only);
  // Floor 1 → project.default_wall_height; Floor 2 → project.floor2_wall_height.
  let levelHeight = null;
  if (level === LEVELS.FLOOR2) {
    levelHeight = num(p.floor2_wall_height) ?? 9;
  } else if (level === LEVELS.FLOOR1) {
    levelHeight = num(p.default_wall_height) ?? num(g.default_wall_height) ?? 9;
  } else {
    // Foundation/roof: no level default; per-wall only
    levelHeight = num(p.default_wall_height) ?? num(g.default_wall_height) ?? 9;
  }
  return {
    wallHeight:        levelHeight,
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
export function computeWallMaterials(wall, settings, wallOpenings = [], level = LEVELS.FLOOR1) {
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
  const wallSection = isExterior
    ? sectionFor('EXTERIOR_WALLS', level)
    : sectionFor('INTERIOR_WALLS', level);
  const finishingsSection = sectionFor('FINISHINGS', level);

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
      section: wallSection, category: CATEGORIES.SHEATHING,
      name: OSB_NAME,
      unit: 'sheet',
      quantity: Math.ceil(netArea / sheetAreaFromName(OSB_NAME)) * (1 + SHEET_WASTE),
    });
    if (settings.silverboardType && settings.silverboardType !== 'none') {
      const sb = SILVERBOARD_TYPES[settings.silverboardType];
      if (!sb) throw new Error(`Unknown silverboard_type: ${settings.silverboardType}`);
      items.push({
        section: SOLO_SECTIONS.EXTERIOR_INSULATION, category: CATEGORIES.EXTERIOR_INSULATION,
        name: sb.name,
        unit: 'EA',
        quantity: Math.ceil(netArea / SILVERBOARD_SHEET_AREA_SF) * (1 + SHEET_WASTE),
      });
    }
    items.push({
      section: finishingsSection, category: CATEGORIES.DRYWALL,
      name: DRYWALL_NAME,
      unit: 'sheet',
      quantity: Math.ceil(netArea / sheetAreaFromName(DRYWALL_NAME)) * (1 + SHEET_WASTE),
    });
  } else {
    items.push({
      section: finishingsSection, category: CATEGORIES.DRYWALL,
      name: DRYWALL_NAME,
      unit: 'sheet',
      quantity: Math.ceil((netArea * 2) / sheetAreaFromName(DRYWALL_NAME)) * (1 + SHEET_WASTE),
    });
  }

  return items;
}

// ---------- project-level rollups ----------
export function computeProjectMaterials(walls, settings, openings = [], level = LEVELS.FLOOR1) {
  let totalExteriorLf = 0;
  let totalExteriorArea = 0;
  let hasInterior = false;
  // Sill gasket buckets — by SKU + section. Exterior 2x6 always sits on concrete.
  // Interior walls produce gasket only when on_concrete=true.
  let extLf55 = 0;     // exterior_2x6 → 5.5x82 in Exterior Walls
  let intLf35 = 0;     // interior_2x4 + on_concrete → 3.5x82 in Interior Walls
  let intLf55 = 0;     // interior_2x6 + on_concrete → 5.5x82 in Interior Walls
  const wallById = new Map(walls.map((w) => [w.id, w]));

  for (const w of walls) {
    const lengthFt = wallLengthFt(w, settings.scaleFtPerGrid);
    if (lengthFt <= 0) continue;
    if (EXTERIOR_TYPES.has(w.wall_type)) {
      totalExteriorLf += lengthFt;
      totalExteriorArea += lengthFt * wallHeightFt(w, settings);
      extLf55 += lengthFt;
    } else if (INTERIOR_TYPES.has(w.wall_type)) {
      hasInterior = true;
      if (w.on_concrete) {
        if (w.wall_type === 'interior_2x4') intLf35 += lengthFt;
        else if (w.wall_type === 'interior_2x6') intLf55 += lengthFt;
      }
    }
  }

  let exteriorOpeningArea = 0;
  for (const o of openings) {
    const w = wallById.get(o.wall_id);
    if (w && EXTERIOR_TYPES.has(w.wall_type)) exteriorOpeningArea += openingAreaSf(o);
  }
  const netInsulationArea = Math.max(0, totalExteriorArea - exteriorOpeningArea);

  const items = [];
  const extSection = sectionFor('EXTERIOR_WALLS', level);
  const intSection = sectionFor('INTERIOR_WALLS', level);
  const insSection = sectionFor('INSULATION', level);
  const winSection = sectionFor('WINDOWS', level);
  const doorSection = sectionFor('DOORS', level);

  if (totalExteriorLf > 0) {
    const wrapRolls = Math.ceil(totalExteriorLf / HOUSEWRAP_ROLL_LF);
    items.push({ section: extSection, category: CATEGORIES.BUILDING_WRAP,
      name: HOUSEWRAP_NAME, unit: 'RL', quantity: wrapRolls });
    items.push({ section: extSection, category: CATEGORIES.BUILDING_WRAP_TAPE,
      name: WRAP_TAPE_NAME, unit: 'RL', quantity: Math.ceil(wrapRolls / 2) });
    items.push({ section: extSection, category: CATEGORIES.WALL_BRACING,
      name: BRACING_NAME, unit: 'EA', quantity: Math.ceil(totalExteriorLf / BRACING_LF_PER_BRACE) });
  }

  // Sill gasket — bucketed by SKU + section so material list keeps section breakdown
  // while POS export later collapses identical SKUs across sections.
  if (extLf55 > 0) {
    items.push({ section: extSection, category: CATEGORIES.SILL_GASKET,
      name: SILL_GASKET_55_NAME, unit: 'RL', quantity: Math.ceil(extLf55 / SILL_GASKET_ROLL_LF) });
  }
  if (intLf35 > 0) {
    items.push({ section: intSection, category: CATEGORIES.SILL_GASKET,
      name: SILL_GASKET_35_NAME, unit: 'RL', quantity: Math.ceil(intLf35 / SILL_GASKET_ROLL_LF) });
  }
  if (intLf55 > 0) {
    items.push({ section: intSection, category: CATEGORIES.SILL_GASKET,
      name: SILL_GASKET_55_NAME, unit: 'RL', quantity: Math.ceil(intLf55 / SILL_GASKET_ROLL_LF) });
  }

  if (netInsulationArea > 0) {
    const key = settings.insulationType || DEFAULT_INSULATION_KEY;
    const spec = INSULATION_TYPES[key];
    if (!spec) throw new Error(`Unknown insulation type: ${key}`);
    items.push({
      section: insSection, category: CATEGORIES.INSULATION,
      name: spec.name,
      unit: 'EA',
      quantity: Math.ceil(netInsulationArea / spec.coverage_sf),
    });
    // Vapour barrier (wall poly over insulation) — same net area used for batt insulation.
    items.push({
      section: insSection, category: CATEGORIES.VAPOUR_BARRIER,
      name: VAPOUR_BARRIER_NAME,
      unit: 'RL',
      quantity: Math.ceil((netInsulationArea * (1 + VAPOUR_BARRIER_WASTE)) / VAPOUR_BARRIER_ROLL_SF),
    });
  }

  if (hasInterior) {
    items.push({ section: intSection, category: CATEGORIES.PLATE_POLY,
      name: PLATE_POLY_NAME, unit: 'RL', quantity: 1 });
  }

  for (const o of openings) {
    const sec = o.type === 'door' ? doorSection : winSection;
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
      section: winSection, category: CATEGORIES.SHIMS,
      name: SHIMS_NAME,
      unit: 'BAG',
      quantity: shimBags,
    });
  }

  return items;
}

// ---------- floor plan (polygon) ----------
/**
 * Build synthetic wall rows from a closed polygon of corners.
 * Each edge i goes from corners[i] → corners[(i+1) % corners.length].
 * floorPlanWalls is the list of floor_plan_walls rows; the row matching
 * `wall_index === i` provides wall_type/height/overrides; missing rows fall back
 * to defaults (exterior_2x6, no overrides).
 *
 * Returns: { walls, openingsByWallId } shaped so the existing computeWallMaterials
 * + computeProjectMaterials pipeline can be reused unchanged.
 */
export function buildFloorPlanWalls(corners, floorPlanWalls) {
  if (!Array.isArray(corners) || corners.length < 3) return [];
  const wallByIndex = new Map(
    (floorPlanWalls || []).map((w) => [Number(w.wall_index), w])
  );
  const out = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const fpWall = wallByIndex.get(i) || {};
    out.push({
      // Use fp wall id as the synthetic id so opening lookups work
      id: fpWall.id != null ? fpWall.id : `fp-${i}`,
      wall_index: i,
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      wall_type: fpWall.wall_type || 'exterior_2x6',
      height: fpWall.height != null ? fpWall.height : null,
      sheathing_override: fpWall.sheathing_override ?? null,
      drywall_override: fpWall.drywall_override ?? null,
      extra_corner_studs: 0,
      on_concrete: !!fpWall.on_concrete,
    });
  }
  return out;
}

/**
 * Compute the full materials list for a closed-polygon floor plan.
 * Wraps the existing wall + project pipelines.
 */
export function computeFloorPlanMaterials(corners, floorPlanWalls, settings, openings = [], level = LEVELS.FLOOR1) {
  const walls = buildFloorPlanWalls(corners, floorPlanWalls);
  if (walls.length === 0) return [];

  const openingsByWallId = new Map();
  for (const o of openings) {
    const key = o.floor_plan_wall_id;
    if (key == null) continue;
    if (!openingsByWallId.has(key)) openingsByWallId.set(key, []);
    openingsByWallId.get(key).push(o);
  }

  const enrichedOpenings = openings.map((o) => {
    const w = walls.find((x) => x.id === o.floor_plan_wall_id);
    return { ...o, wall_id: o.floor_plan_wall_id, wall_type: w?.wall_type };
  });

  const items = [];
  for (const w of walls) {
    items.push(...computeWallMaterials(w, settings, openingsByWallId.get(w.id) || [], level));
  }
  items.push(...computeProjectMaterials(walls, settings, enrichedOpenings, level));
  return items;
}

// ---------- roof ----------
export const ROOF_PITCH_MULTIPLIER = {
  '4:12':  Math.sqrt(1 + (4 / 12) ** 2),
  '6:12':  Math.sqrt(1 + (6 / 12) ** 2),
  '8:12':  Math.sqrt(1 + (8 / 12) ** 2),
  '10:12': Math.sqrt(1 + (10 / 12) ** 2),
  '12:12': Math.sqrt(2),
};
export const ROOF_SHEATHING_NAMES = {
  plywood_1_2_csp: '4 X 8 - 1/2 CSP PLYWOOD',
  osb_7_16:        '4 X 8 - 7/16 ORIENTED STRAND BOARD',
  plywood_5_8:     '4 X 8 - 5/8 PLYWOOD',
};
const HCLIP_NAME = 'H-CLIPS ROOF 250/BOX 20GA 1/2';
const HCLIP_PER_BOX = 250;
const HCLIP_WASTE = 0.05;
const HURRICANE_TIE_NAME = 'HURRICANE TIE H2.5A';
const ROOF_BLOCKING_NAME = '2 X 6 X 16 PREMIUM SPRUCE';

/**
 * Compute roof material rows: sheathing, H-clips, blocking, hurricane ties.
 * roofRecord: { width_ft, depth_ft, pitch, sheathing_type, rafter_spacing }
 * Per spec: roof_area = width × depth × pitch_multiplier × 2 (both sides).
 */
export function computeRoofMaterials(roofRecord) {
  if (!roofRecord) return [];
  const w = num(roofRecord.width_ft) ?? 0;
  const d = num(roofRecord.depth_ft) ?? 0;
  if (w <= 0 || d <= 0) return [];
  const pitch = roofRecord.pitch || '6:12';
  const mult = ROOF_PITCH_MULTIPLIER[pitch];
  if (!mult) throw new Error(`Unknown roof pitch: ${pitch}`);
  const sheathingKey = roofRecord.sheathing_type || 'plywood_1_2_csp';
  const sheathingName = ROOF_SHEATHING_NAMES[sheathingKey];
  if (!sheathingName) throw new Error(`Unknown roof sheathing type: ${sheathingKey}`);
  const spacing = roofRecord.rafter_spacing || '24_oc';
  const spacingInches = spacing === '16_oc' ? 16 : 24;
  const clipsPerSheet = spacing === '16_oc' ? 3 : 2;

  const roofArea = w * d * mult * 2;
  const sheets = Math.ceil(roofArea / 32) * (1 + SHEET_WASTE);
  // For H-clips, compute clip count from CEIL'd sheet count (whole sheets only).
  const wholeSheets = Math.ceil(sheets - 1e-9);
  const hclipBoxes = Math.ceil((wholeSheets * clipsPerSheet * (1 + HCLIP_WASTE)) / HCLIP_PER_BOX);

  // Perimeter & blocking & hurricane ties
  const perimeter = 2 * (w + d);
  // Blocking: one 2 X 6 X 16 board yields ~6-8 short blocks for 24" / 16" spacing → covers
  // ~12 ft of perimeter for 24" oc, ~8 ft for 16" oc. Approximation.
  const blockingFtPerBoard = spacing === '16_oc' ? 8 : 12;
  const blockingBoards = Math.ceil(perimeter / blockingFtPerBoard);
  // Hurricane ties: 1 per rafter location
  const hurricaneTies = Math.ceil(perimeter / (spacingInches / 12));

  return [
    { section: SOLO_SECTIONS.ROOF, category: CATEGORIES.SHEATHING,
      name: sheathingName, unit: 'EA', quantity: sheets },
    { section: SOLO_SECTIONS.ROOF, category: 'Hardware',
      name: HCLIP_NAME, unit: 'BX', quantity: hclipBoxes },
    { section: SOLO_SECTIONS.ROOF, category: 'Blocking',
      name: ROOF_BLOCKING_NAME, unit: 'EA', quantity: blockingBoards },
    { section: SOLO_SECTIONS.ROOF, category: 'Hardware',
      name: HURRICANE_TIE_NAME, unit: 'EA', quantity: hurricaneTies },
  ];
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
  // Subtract a tiny epsilon before ceil to absorb IEEE-754 noise from summing
  // waste-adjusted floats (e.g. 7.7+3.3+7.7+3.3 = 22.000000000000004 → ceil 23).
  // Real fractional waste is always >> 1e-9.
  return Array.from(map.values())
    .map((r) => ({ ...r, quantity: Math.max(0, Math.ceil(r.quantity - 1e-9)) }))
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
