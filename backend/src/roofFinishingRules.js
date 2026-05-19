// AUTO-calculation module: Roof Finishing.
// Pure deterministic rules engine — zero DB access, no pg imports.
// Inputs are pre-aggregated by materialListBuilder.js (which calls
// roofSectionGeometry + valleyBetween from wallRules.js to build the
// totals object). Quantities are raw (waste baked in where applicable);
// sumMaterials() downstream rounds up to whole units.

import { SOLO_SECTIONS } from './wallRules.js';

// Section label — re-exported from wallRules so sectionRank() and this
// module stay in lockstep (no separate string literal that could drift).
export const SECTION_ROOF_FINISHING = SOLO_SECTIONS.ROOF_FINISHING;

export const CATEGORIES = {
  ICE_WATER:        'Ice & Water Shield',
  UNDERLAYMENT:     'Underlayment',
  STARTER:          'Starter Strip',
  SHINGLES:         'Shingles',
  HIP_RIDGE:        'Hip & Ridge Cap',
  DRIP_EDGE:        'Drip Edge',
  VALLEY:           'Valley Flashing',
  FASTENERS:        'Roofing Fasteners',
};
export const CATEGORY_ORDER = [
  CATEGORIES.ICE_WATER,
  CATEGORIES.UNDERLAYMENT,
  CATEGORIES.STARTER,
  CATEGORIES.SHINGLES,
  CATEGORIES.HIP_RIDGE,
  CATEGORIES.DRIP_EDGE,
  CATEGORIES.VALLEY,
  CATEGORIES.FASTENERS,
];

export const DEFAULT_ROOF_FINISHING_WASTE = { shingles: 0.10 };

export function rfw(settings, key) {
  return settings?.wasteFactors?.[`roof_${key}`] ?? DEFAULT_ROOF_FINISHING_WASTE[key];
}

// Canonical name strings — match sku_catalog.description exactly. Seeded
// as placeholder rows by migrate.js (seedAutoModulePlaceholders).
const NAMES = {
  ICE_WATER:    'IKO STORMSHIELD ICE & WATER 36IN X 65.6FT ROLL',
  UNDERLAYMENT: 'IKO STORMTITE UNDERLAYMENT 1000SF ROLL',
  STARTER:      'IKO LEADING EDGE PLUS STARTER STRIP 123LF',
  SHINGLES:     'IKO CAMBRIDGE SHINGLES 33SF/BDL',
  HIP_RIDGE:    'IKO HIP & RIDGE CAP 36.5LF/BDL',
  DRIP_EDGE:    'ALUMINUM DRIP EDGE 10FT',
  VALLEY:       'W-METAL VALLEY FLASHING 10FT',
  FASTENERS:    'ROOFING NAILS 1-1/4IN GALV COIL',
};

const ICE_WATER_ROLL_SF       = 200;
const UNDERLAYMENT_ROLL_SF    = 1000;
const STARTER_BUNDLE_LF       = 123;
const SHINGLE_BUNDLE_SF       = 33;
const HIP_RIDGE_BUNDLE_LF     = 36.5;
const DRIP_EDGE_PIECE_LF      = 10;
const VALLEY_FLASHING_PIECE_LF = 10;
const ICE_WATER_EAVE_BAND_FT  = 3;   // first 3ft from eave gets ice & water
const NAILS_LB_PER_100_SF     = 1;   // 1lb per 100sf coverage

/**
 * Compute roof finishing materials.
 *   geometry: {
 *     total_roof_area:  pitched/surface area (SF) — sum of per-section
 *                       surfaceArea (footprint × pitch multiplier).
 *     total_eave_lf,
 *     total_rake_lf,
 *     total_ridge_lf,
 *     total_hip_lf,
 *     total_valley_lf
 *   }
 *   settings: { wasteFactors: { roof_shingles: 0.10 } }
 *
 * Returns: array of { section, category, name, unit, quantity }
 * Quantities are raw (Math.ceil happens in sumMaterials downstream).
 */
export function computeRoofFinishingMaterials(geometry, settings = {}) {
  const g = geometry || {};
  const totalArea    = Number(g.total_roof_area)  || 0;
  const totalEaveLf  = Number(g.total_eave_lf)    || 0;
  const totalRakeLf  = Number(g.total_rake_lf)    || 0;
  const totalRidgeLf = Number(g.total_ridge_lf)   || 0;
  const totalHipLf   = Number(g.total_hip_lf)     || 0;
  const totalValleyLf = Number(g.total_valley_lf) || 0;
  if (totalArea <= 0 && totalEaveLf <= 0) return [];

  const section = SECTION_ROOF_FINISHING;
  const items = [];
  const add = (category, name, unit, quantity) => {
    if (!(quantity > 0)) return;
    items.push({ section, category, name, unit, quantity });
  };

  // Ice & Water — 3ft strip along eaves only.
  add(CATEGORIES.ICE_WATER, NAMES.ICE_WATER, 'RL',
    (totalEaveLf * ICE_WATER_EAVE_BAND_FT) / ICE_WATER_ROLL_SF);

  // Underlayment — total roof area minus the ice & water band.
  const underlaymentSf = totalArea - (totalEaveLf * ICE_WATER_EAVE_BAND_FT);
  add(CATEGORIES.UNDERLAYMENT, NAMES.UNDERLAYMENT, 'RL',
    underlaymentSf / UNDERLAYMENT_ROLL_SF);

  // Starter strip — eaves + rakes.
  add(CATEGORIES.STARTER, NAMES.STARTER, 'BDL',
    (totalEaveLf + totalRakeLf) / STARTER_BUNDLE_LF);

  // Shingles — single default SKU; estimator swaps colour via substitution.
  add(CATEGORIES.SHINGLES, NAMES.SHINGLES, 'BDL',
    (totalArea / SHINGLE_BUNDLE_SF) * (1 + rfw(settings, 'shingles')));

  // Hip & ridge cap — covers both hip and ridge linear feet.
  add(CATEGORIES.HIP_RIDGE, NAMES.HIP_RIDGE, 'BDL',
    (totalHipLf + totalRidgeLf) / HIP_RIDGE_BUNDLE_LF);

  // Drip edge — eaves + rakes.
  add(CATEGORIES.DRIP_EDGE, NAMES.DRIP_EDGE, 'EA',
    (totalEaveLf + totalRakeLf) / DRIP_EDGE_PIECE_LF);

  // Valley flashing — only valleys.
  add(CATEGORIES.VALLEY, NAMES.VALLEY, 'EA',
    totalValleyLf / VALLEY_FLASHING_PIECE_LF);

  // Roofing nails — 1lb per 100 SF of roof area.
  add(CATEGORIES.FASTENERS, NAMES.FASTENERS, 'LB',
    (totalArea * NAILS_LB_PER_100_SF) / 100);

  return items;
}
