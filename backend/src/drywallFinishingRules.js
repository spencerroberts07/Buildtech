// AUTO-calculation module: Drywall Finishing.
// Pure deterministic. Inputs are pre-aggregated totals from
// materialListBuilder.js (which already accumulates wall+ceiling drywall
// SF from the existing wallRules output, and counts outside corners +
// interior-wall T-junctions against the floor polygon).
//
// Wall drywall SF is derived inside this module from
//   wall_drywall_sf = total_drywall_sf − ceiling_area_sf
// so callers only need to pass the running totals.

import { SOLO_SECTIONS } from './wallRules.js';

export const SECTION_DRYWALL_FINISHING = SOLO_SECTIONS.DRYWALL_FINISHING;

export const CATEGORIES = {
  CORNER_BEAD:    'Corner Bead',
  TAPE_COMPOUND:  'Tape & Compound',
  FASTENERS:      'Drywall Fasteners',
  PRIMER_PAINT:   'Primer & Paint',
  STRAPPING:      'Ceiling Strapping',
};
export const CATEGORY_ORDER = [
  CATEGORIES.CORNER_BEAD,
  CATEGORIES.TAPE_COMPOUND,
  CATEGORIES.FASTENERS,
  CATEGORIES.PRIMER_PAINT,
  CATEGORIES.STRAPPING,
];

const NAMES = {
  CORNER_BEAD:     'METAL CORNER BEAD 1-1/4IN X 8FT',
  PAPER_TAPE:      'PAPER JOINT TAPE 2IN X 500FT ROLL',
  JOINT_COMPOUND:  'JOINT COMPOUND ALL-PURPOSE 17L PAIL',
  SCREWS_COARSE:   'DRYWALL SCREWS 1-5/8IN COARSE LB',
  SCREWS_FINE:     'DRYWALL SCREWS 1-1/4IN FINE LB',
  PRIMER:          'DRYWALL PRIMER SEALER LATEX 18.9L',
  CEILING_PAINT:   'CEILING PAINT FLAT WHITE 18.9L',
  WALL_PAINT:      'WALL PAINT LATEX WHITE 18.9L',
  // Strapping reuses an existing seeded SKU. Description in the catalog
  // uses the " - 16" separator form (not " X 16"), so this string differs
  // from the lumber convention used elsewhere — verified against
  // SKU_CATALOG_SEED line "1 X 4 - 16 SPRUCE STRAPPING".
  STRAPPING:       '1 X 4 - 16 SPRUCE STRAPPING',
};

const CORNER_BEAD_PIECE_LF   = 8;
const TAPE_ROLL_LF           = 500;
const COMPOUND_SF_PER_PAIL   = 600;
const SCREWS_COARSE_SF_PER_LB = 55;
const SCREWS_FINE_SF_PER_LB  = 75;
const PRIMER_SF_PER_PAIL     = 400;
const CEILING_PAINT_SF_PER_PAIL = 400;
const WALL_PAINT_SF_PER_PAIL = 350;
const STRAPPING_PIECE_LF     = 16;
const STRAPPING_LF_PER_SF    = 0.75; // 16" o.c. strapping → 0.75 LF per SF of ceiling

/**
 * Compute drywall finishing materials.
 *   geometry: {
 *     total_drywall_sf,              — wall SF + ceiling SF (already aggregated)
 *     ceiling_area_sf,
 *     wall_height_ft,
 *     outside_corner_count,
 *     interior_wall_junction_count   — count of T-junctions between
 *                                      interior walls and exterior walls
 *   }
 *   settings: unused today
 *
 * Returns: array of { section, category, name, unit, quantity }.
 */
export function computeDrywallFinishingMaterials(geometry, settings = {}) {
  const g = geometry || {};
  const totalDrywallSf = Number(g.total_drywall_sf) || 0;
  const ceilingSf      = Number(g.ceiling_area_sf)  || 0;
  const wallHeightFt   = Number(g.wall_height_ft)   || 0;
  const outsideCorners = Number(g.outside_corner_count) || 0;
  const intJunctions   = Number(g.interior_wall_junction_count) || 0;
  if (totalDrywallSf <= 0) return [];

  const wallDrywallSf = Math.max(0, totalDrywallSf - ceilingSf);
  const totalCornerLf = (outsideCorners + intJunctions) * wallHeightFt;

  const section = SECTION_DRYWALL_FINISHING;
  const items = [];
  const add = (category, name, unit, quantity) => {
    if (!(quantity > 0)) return;
    items.push({ section, category, name, unit, quantity });
  };

  // Corner bead — 8ft pieces per LF of corner.
  add(CATEGORIES.CORNER_BEAD, NAMES.CORNER_BEAD, 'EA',
    totalCornerLf / CORNER_BEAD_PIECE_LF);

  // Paper tape + joint compound — both scale with total drywall SF.
  add(CATEGORIES.TAPE_COMPOUND, NAMES.PAPER_TAPE, 'RL',
    totalDrywallSf / TAPE_ROLL_LF);
  add(CATEGORIES.TAPE_COMPOUND, NAMES.JOINT_COMPOUND, 'PL',
    totalDrywallSf / COMPOUND_SF_PER_PAIL);

  // Drywall screws — coarse on walls (into studs), fine on ceiling (into joists).
  add(CATEGORIES.FASTENERS, NAMES.SCREWS_COARSE, 'LB',
    wallDrywallSf / SCREWS_COARSE_SF_PER_LB);
  add(CATEGORIES.FASTENERS, NAMES.SCREWS_FINE, 'LB',
    ceilingSf / SCREWS_FINE_SF_PER_LB);

  // Primer & paint.
  add(CATEGORIES.PRIMER_PAINT, NAMES.PRIMER, 'PL',
    totalDrywallSf / PRIMER_SF_PER_PAIL);
  add(CATEGORIES.PRIMER_PAINT, NAMES.CEILING_PAINT, 'PL',
    ceilingSf / CEILING_PAINT_SF_PER_PAIL);
  add(CATEGORIES.PRIMER_PAINT, NAMES.WALL_PAINT, 'PL',
    wallDrywallSf / WALL_PAINT_SF_PER_PAIL);

  // Ceiling strapping — 16" o.c. → 0.75 LF per SF of ceiling, /16ft pieces.
  add(CATEGORIES.STRAPPING, NAMES.STRAPPING, 'EA',
    (ceilingSf * STRAPPING_LF_PER_SF) / STRAPPING_PIECE_LF);

  return items;
}
