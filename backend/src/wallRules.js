// Pure deterministic rules engine for wall takeoff.
// pg returns NUMERIC columns as strings — every numeric value coming from the
// database goes through num() before any arithmetic.

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// Available stud precuts. Spec: 8' → 92⅝, 9' → 104⅝, 10' → 116⅝.
// Custom heights round UP to the next available size.
const PRECUT_LADDER = [
  { maxHeightFt: 8, label: '92⅝' },
  { maxHeightFt: 9, label: '104⅝' },
  { maxHeightFt: 10, label: '116⅝' },
];

function precutForHeight(heightFt) {
  for (const rung of PRECUT_LADDER) {
    if (heightFt <= rung.maxHeightFt) return rung.label;
  }
  // >10' is out of scope for precut studs; cap at the largest precut.
  return PRECUT_LADDER[PRECUT_LADDER.length - 1].label;
}

const SHEATHING_NAMES = {
  '7/16_osb': '7/16 OSB sheathing 4x8',
  '1/2_osb': '1/2 OSB sheathing 4x8',
  '1/2_csp': '1/2 CSP sheathing 4x8',
  '5/8_osb': '5/8 OSB sheathing 4x8',
};
const DRYWALL_NAMES = {
  '1/2_drywall': '1/2 drywall 4x8',
  '5/8_drywall': '5/8 drywall 4x8',
};

function sheathingMaterialName(token) {
  return SHEATHING_NAMES[token] || `${String(token).replace(/_/g, ' ')} sheathing 4x8`;
}
function drywallMaterialName(token) {
  return DRYWALL_NAMES[token] || `${String(token).replace(/_/g, ' ')} 4x8`;
}

const PLATE_BOARD_LENGTH_FT = 16;
const PLATE_WASTE = 0.05;
const SHEET_AREA_SF = 32; // 4×8
const SHEET_WASTE = 0.10;
const HOUSEWRAP_WASTE = 0.10;

function lumberDimFor(wallType) {
  if (wallType === 'exterior_2x6' || wallType === 'interior_2x6') return '2x6';
  if (wallType === 'interior_2x4') return '2x4';
  throw new Error(`Unknown wall_type: ${wallType}`);
}

export function wallLengthFt(wall, scaleFtPerGrid) {
  const x1 = num(wall.x1) ?? 0;
  const y1 = num(wall.y1) ?? 0;
  const x2 = num(wall.x2) ?? 0;
  const y2 = num(wall.y2) ?? 0;
  const scale = num(scaleFtPerGrid) ?? 1;
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) * scale;
}

/**
 * Merge global settings (id=1) with project-level overrides into a numeric-clean object.
 * Element-level overrides (per-wall sheathing/drywall/height) are applied inside computeWallMaterials.
 */
export function resolveProjectSettings(projectRow, globalRow) {
  const g = globalRow || {};
  const p = projectRow || {};
  return {
    wallHeight:
      num(p.default_wall_height) ?? num(g.default_wall_height) ?? 9,
    exteriorSheathing:
      p.exterior_sheathing || g.exterior_sheathing || '7/16_osb',
    roofSheathing:
      p.roof_sheathing || g.roof_sheathing || '1/2_csp',
    drywall:
      p.drywall || g.drywall || '1/2_drywall',
    studSpacing:
      num(p.stud_spacing) ?? num(g.stud_spacing) ?? 16,
    cornerStyle:
      p.corner_style || g.corner_style || '3_stud',
    scaleFtPerGrid:
      num(p.scale_ft_per_grid) ?? 1,
  };
}

/**
 * Compute material line items for a single wall.
 *
 * @param wall { x1,y1,x2,y2 NUMERIC, height NUMERIC|null, wall_type, sheathing_override, drywall_override, extra_corner_studs }
 * @param resolvedSettings output of resolveProjectSettings (already number-coerced)
 * @returns Array<{name, unit, quantity}>
 */
export function computeWallMaterials(wall, resolvedSettings) {
  const lengthFt = wallLengthFt(wall, resolvedSettings.scaleFtPerGrid);
  if (lengthFt <= 0) return [];

  const heightFt = num(wall.height) ?? num(resolvedSettings.wallHeight) ?? 9;
  const studSpacing = num(resolvedSettings.studSpacing) ?? 16;
  const extraCorner = Number(wall.extra_corner_studs ?? 0) || 0;
  const sheathingToken = wall.sheathing_override || resolvedSettings.exteriorSheathing;
  const drywallToken = wall.drywall_override || resolvedSettings.drywall;
  const wallType = wall.wall_type;
  const lumberDim = lumberDimFor(wallType);
  const precut = precutForHeight(heightFt);
  const wallArea = lengthFt * heightFt;

  const items = [];

  // Studs
  const studCount = Math.ceil((lengthFt * 12) / studSpacing) + 1 + extraCorner;
  items.push({
    name: `${lumberDim}x${precut} SPF stud`,
    unit: 'each',
    quantity: studCount,
  });

  // Bottom plate (single)
  items.push({
    name: `${lumberDim}x16 SPF plate`,
    unit: 'each',
    quantity: Math.ceil(lengthFt / PLATE_BOARD_LENGTH_FT) * (1 + PLATE_WASTE),
  });

  // Top plate (doubled)
  items.push({
    name: `${lumberDim}x16 SPF plate`,
    unit: 'each',
    quantity: Math.ceil((lengthFt * 2) / PLATE_BOARD_LENGTH_FT) * (1 + PLATE_WASTE),
  });

  if (wallType === 'exterior_2x6') {
    items.push({
      name: sheathingMaterialName(sheathingToken),
      unit: 'sheet',
      quantity: Math.ceil(wallArea / SHEET_AREA_SF) * (1 + SHEET_WASTE),
    });
    items.push({
      name: 'Housewrap',
      unit: 'sf',
      quantity: wallArea * (1 + HOUSEWRAP_WASTE),
    });
    items.push({
      name: 'R20 batt insulation',
      unit: 'sf',
      quantity: wallArea,
    });
    // Drywall, interior face only
    items.push({
      name: drywallMaterialName(drywallToken),
      unit: 'sheet',
      quantity: Math.ceil(wallArea / SHEET_AREA_SF) * (1 + SHEET_WASTE),
    });
  } else {
    // Interior walls — drywall both faces, no sheathing/wrap/insulation
    items.push({
      name: drywallMaterialName(drywallToken),
      unit: 'sheet',
      quantity: Math.ceil((wallArea * 2) / SHEET_AREA_SF) * (1 + SHEET_WASTE),
    });
  }

  return items;
}

/**
 * Sum a list of {name, unit, quantity} into one entry per (name, unit).
 * Used both within a single wall (plates merge) and across walls in a project.
 */
export function sumMaterials(items) {
  const map = new Map();
  for (const it of items) {
    const key = `${it.name}|${it.unit}`;
    const cur = map.get(key);
    if (cur) cur.quantity += it.quantity;
    else map.set(key, { name: it.name, unit: it.unit, quantity: it.quantity });
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}
