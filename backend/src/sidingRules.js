// AUTO-calculation module: Siding.
// Pure deterministic. Geometry inputs are pre-aggregated in
// materialListBuilder.js (perimeter × height × all floors, openings
// summed, outside-corner count derived from polygon, gable areas from
// roof_section_edges where end_type='gable').

import { SOLO_SECTIONS } from './wallRules.js';

export const SECTION_SIDING = SOLO_SECTIONS.SIDING;

export const CATEGORIES = {
  SIDING:      'Siding',
  ACCESSORIES: 'Siding Accessories',
};
export const CATEGORY_ORDER = [
  CATEGORIES.SIDING,
  CATEGORIES.ACCESSORIES,
];

export const DEFAULT_SIDING_WASTE = { siding: 0.10, gable: 0.10 };

export function sdw(settings, key) {
  // Key naming follows the wasteFactors namespacing convention used
  // elsewhere ('siding' / 'siding_gable'). Falls back to defaults when
  // the system_settings key is missing.
  const fullKey = key === 'gable' ? 'siding_gable' : 'siding';
  return settings?.wasteFactors?.[fullKey] ?? DEFAULT_SIDING_WASTE[key];
}

const NAMES = {
  DUTCH_LAP:        'VINYL SIDING D4.5 DUTCH LAP 100SF/SQ',
  GABLE_SIDING:     'VINYL GABLE SIDING D4.5 100SF/SQ',
  STARTER:          'VINYL SIDING STARTER STRIP 12FT',
  J_CHANNEL:        'VINYL SIDING J-CHANNEL 5/8IN 12FT',
  OUTSIDE_CORNER:   'VINYL SIDING OUTSIDE CORNER 3IN 10FT',
  DRIP_CAP:         'VINYL SIDING DRIP CAP 10FT',
  UNDERSILL_TRIM:   'VINYL SIDING UNDERSILL TRIM 10FT',
  NAILS:            'ALUMINUM SIDING NAILS 1-3/4IN LB',
};

const SQ_SF             = 100;
const STARTER_PIECE_LF  = 12;
const J_CHANNEL_PIECE_LF = 12;
const CORNER_PIECE_LF   = 10;
const DRIP_CAP_PIECE_LF = 10;
const UNDERSILL_PIECE_LF = 10;
const NAILS_LB_PER_100_SF = 1;

/**
 * Compute siding materials.
 *   geometry: {
 *     wall_perimeter_ft,
 *     wall_height_ft,
 *     opening_areas_sf,
 *     outside_corner_count,
 *     gable_areas_sf,
 *     all_opening_widths_lf,
 *     window_widths_lf,
 *     all_opening_perimeter_lf
 *   }
 *   settings: { wasteFactors: { siding, siding_gable } }
 *
 * Returns: array of { section, category, name, unit, quantity }.
 */
export function computeSidingMaterials(geometry, settings = {}) {
  const g = geometry || {};
  const perimeterFt        = Number(g.wall_perimeter_ft)        || 0;
  const heightFt           = Number(g.wall_height_ft)           || 0;
  const openingAreasSf     = Number(g.opening_areas_sf)         || 0;
  const cornerCount        = Number(g.outside_corner_count)     || 0;
  const gableAreasSf       = Number(g.gable_areas_sf)           || 0;
  const allOpeningWidthsLf = Number(g.all_opening_widths_lf)    || 0;
  const windowWidthsLf     = Number(g.window_widths_lf)         || 0;
  const allOpeningPerimLf  = Number(g.all_opening_perimeter_lf) || 0;

  const grossWallSf = perimeterFt * heightFt;
  const netWallSf   = Math.max(0, grossWallSf - openingAreasSf);
  if (grossWallSf <= 0 && gableAreasSf <= 0) return [];

  const section = SECTION_SIDING;
  const items = [];
  const add = (category, name, unit, quantity) => {
    if (!(quantity > 0)) return;
    items.push({ section, category, name, unit, quantity });
  };

  // Field siding — net wall area in 100sf "squares", waste applied.
  add(CATEGORIES.SIDING, NAMES.DUTCH_LAP, 'SQ',
    (netWallSf / SQ_SF) * (1 + sdw(settings, 'siding')));

  // Gable siding — separate SKU, separate waste factor.
  add(CATEGORIES.SIDING, NAMES.GABLE_SIDING, 'SQ',
    (gableAreasSf / SQ_SF) * (1 + sdw(settings, 'gable')));

  // Starter strip — once around the perimeter.
  add(CATEGORIES.ACCESSORIES, NAMES.STARTER, 'EA',
    perimeterFt / STARTER_PIECE_LF);

  // J-channel — perimeter + opening perimeters, +10% for cuts/overlaps.
  add(CATEGORIES.ACCESSORIES, NAMES.J_CHANNEL, 'EA',
    ((allOpeningPerimLf + perimeterFt) * 1.10) / J_CHANNEL_PIECE_LF);

  // Outside corners — one stack per corner × wall height, /10ft pieces.
  add(CATEGORIES.ACCESSORIES, NAMES.OUTSIDE_CORNER, 'EA',
    (cornerCount * heightFt) / CORNER_PIECE_LF);

  // Drip cap — above each opening (door + window heads).
  add(CATEGORIES.ACCESSORIES, NAMES.DRIP_CAP, 'EA',
    allOpeningWidthsLf / DRIP_CAP_PIECE_LF);

  // Undersill trim — under each window (windows only).
  add(CATEGORIES.ACCESSORIES, NAMES.UNDERSILL_TRIM, 'EA',
    windowWidthsLf / UNDERSILL_PIECE_LF);

  // Nails — 1lb per 100sf of total (wall + gable) area.
  add(CATEGORIES.ACCESSORIES, NAMES.NAILS, 'LB',
    ((grossWallSf + gableAreasSf) * NAILS_LB_PER_100_SF) / 100);

  return items;
}
