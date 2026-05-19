// AUTO-calculation module: Floor System.
// Pure deterministic. Returns [] for slab foundation. Joist length comes
// from the polygon's bounding-box short dimension, joist count from the
// long dimension. Centre Beam is an engineered placeholder row carrying
// an engineer_review flag for the UI to surface a ⚠️ badge.
//
// Subfloor OSB + adhesive are already AUTO from materialListBuilder.js's
// existing floor section — this module deliberately does NOT emit them
// (avoids double-counting).

import { SOLO_SECTIONS } from './wallRules.js';

export const SECTION_FLOOR_SYSTEM = SOLO_SECTIONS.FLOOR_SYSTEM;

export const CATEGORIES = {
  RIM_JOIST:      'Rim Joist',
  FLOOR_JOISTS:   'Floor Joists',
  BLOCKING:       'Blocking',
  RIM_INSULATION: 'Rim Insulation',
  JOIST_TAPE:     'Joist Tape',
  CENTRE_BEAM:    'Centre Beam',
};
export const CATEGORY_ORDER = [
  CATEGORIES.RIM_JOIST,
  CATEGORIES.FLOOR_JOISTS,
  CATEGORIES.BLOCKING,
  CATEGORIES.RIM_INSULATION,
  CATEGORIES.JOIST_TAPE,
  CATEGORIES.CENTRE_BEAM,
];

export const DEFAULT_FLOOR_WASTE = { framing: 0.05 };

export function ffw(settings, key) {
  return settings?.wasteFactors?.[`floor_${key}`] ?? DEFAULT_FLOOR_WASTE[key];
}

// Joist depth in inches (used for rim-insulation area calc).
const JOIST_DEPTH = { '2x8': 7.25, '2x10': 9.25, '2x12': 11.25 };

// Standard lumber ladder (ft). Duplicated locally rather than imported from
// deckRules.js to keep this module self-contained — same convention as
// wallRules.js / deckRules.js using their own copies.
const STD_LUMBER_LENGTHS = [8, 10, 12, 14, 16];
function roundUpLumberLength(ft) {
  for (const L of STD_LUMBER_LENGTHS) if (ft <= L + 1e-9) return L;
  return 16; // longer pieces still order as 16ft; framer cuts to fit
}

// Lumber name builder — matches deckRules.js ptLumberName() output exactly.
function ptLumberName(size, lengthFt) {
  // size = '2x8' / '2x10' / '2x12'
  const [w, h] = size.split('x');
  return `${w} X ${h} X ${lengthFt} PRESSURE TREATED`;
}

const RIM_INSULATION_NAME = 'R20 SPACESAVER RIM JOIST INSULATION BAG';
const JOIST_TAPE_NAME     = 'PROTECTO WRAP JOIST TAPE 2.5IN ROLL';
const CENTRE_BEAM_NAME    = 'CENTRE BEAM — VERIFY SIZE WITH ENGINEER';

const RIM_INS_BAG_LF       = 75;
const JOIST_TAPE_ROLL_LF   = 75;
const RIM_JOIST_PIECE_LF   = 16;

/**
 * Compute floor-system materials.
 *   floorGeometry: {
 *     floor_area_sf,      — from floors.floor_area_sf or .auto_floor_area_sf
 *     floor_perimeter_ft, — derived from polygon × scale in materialListBuilder
 *     floor_polygon,      — raw grid-unit corners (array of {x, y})
 *     joist_size,         — '2x8' | '2x10' | '2x12'
 *     joist_spacing_in,   — integer (16 default)
 *     foundation_type,    — 'basement' | 'crawl_space' | 'slab'
 *     scaleFtPerGrid      — grid → ft multiplier
 *   }
 *   settings: { wasteFactors: { floor_framing } }
 *
 * Returns: array of { section, category, name, unit, quantity, [engineer_review] }
 * Centre Beam row carries engineer_review:true; the material list UI uses
 * this to surface a "verify with engineer" badge.
 */
export function computeFloorSystemMaterials(floorGeometry, settings = {}) {
  const g = floorGeometry || {};
  const foundationType = g.foundation_type || 'basement';
  if (foundationType === 'slab') return [];

  const polygon = Array.isArray(g.floor_polygon) ? g.floor_polygon : [];
  if (polygon.length < 3) return [];

  const scale = Number(g.scaleFtPerGrid) || 1;
  const perimeterFt = Number(g.floor_perimeter_ft) || 0;
  const joistSize = g.joist_size || '2x8';
  if (!JOIST_DEPTH[joistSize]) {
    throw new Error(`Unknown joist_size: ${joistSize}`);
  }
  const joistSpacingIn = Number(g.joist_spacing_in) || 16;

  // Bounding box → span (short dim) and run (long dim) in feet.
  const xs = polygon.map((c) => Number(c.x));
  const ys = polygon.map((c) => Number(c.y));
  const rawWidth = (Math.max(...xs) - Math.min(...xs)) * scale;
  const rawDepth = (Math.max(...ys) - Math.min(...ys)) * scale;
  const spanFt = Math.min(rawWidth, rawDepth);
  const runFt  = Math.max(rawWidth, rawDepth);
  if (spanFt <= 0 || runFt <= 0) return [];

  const joistLengthFt = roundUpLumberLength(spanFt);
  const joistCount = Math.ceil((runFt * 12) / joistSpacingIn) + 1;

  const section = SECTION_FLOOR_SYSTEM;
  const items = [];
  const add = (category, name, unit, quantity, extra = null) => {
    if (!(quantity > 0)) return;
    const row = { section, category, name, unit, quantity };
    if (extra) Object.assign(row, extra);
    items.push(row);
  };

  const framingWaste = ffw(settings, 'framing');

  // Rim joist — perimeter / 16ft pieces.
  if (perimeterFt > 0) {
    add(CATEGORIES.RIM_JOIST, ptLumberName(joistSize, RIM_JOIST_PIECE_LF), 'EA',
      perimeterFt / RIM_JOIST_PIECE_LF);
  }

  // Floor joists — count × waste applied.
  add(CATEGORIES.FLOOR_JOISTS, ptLumberName(joistSize, joistLengthFt), 'EA',
    joistCount * (1 + framingWaste));

  // Blocking — only for spans > 8ft. One row midspan, 16ft pieces.
  if (spanFt > 8) {
    add(CATEGORIES.BLOCKING, ptLumberName(joistSize, RIM_JOIST_PIECE_LF), 'EA',
      runFt / RIM_JOIST_PIECE_LF);
  }

  // Rim insulation — perimeter × joist depth → SF → bags @ 75LF coverage.
  if (perimeterFt > 0) {
    const depthFt = JOIST_DEPTH[joistSize] / 12;
    add(CATEGORIES.RIM_INSULATION, RIM_INSULATION_NAME, 'BAG',
      (perimeterFt * depthFt) / RIM_INS_BAG_LF);
  }

  // Joist tape — covers top of every joist run + the rim perimeter.
  add(CATEGORIES.JOIST_TAPE, JOIST_TAPE_NAME, 'RL',
    (joistCount * spanFt) / JOIST_TAPE_ROLL_LF);

  // Centre beam — engineered placeholder; quantity in LF = span (short dim).
  // engineer_review flag tells the material list UI to badge this row.
  add(CATEGORIES.CENTRE_BEAM, CENTRE_BEAM_NAME, 'LF', spanFt,
    { engineer_review: true });

  return items;
}
