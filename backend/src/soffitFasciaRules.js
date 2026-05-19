// AUTO-calculation module: Soffit & Fascia.
// Pure deterministic. No eavestrough (separate trade — explicitly excluded).
// Sub-fascia uses the existing 2 X 4 X 16 PREMIUM SPRUCE SKU; the other
// names are placeholders seeded by migrate.js.

import { SOLO_SECTIONS } from './wallRules.js';

export const SECTION_SOFFIT_FASCIA = SOLO_SECTIONS.SOFFIT_FASCIA;

export const CATEGORIES = {
  SOFFIT:      'Soffit',
  SOFFIT_TRIM: 'Soffit Trim',
  FASCIA:      'Fascia',
  SUB_FASCIA:  'Sub-Fascia',
};
export const CATEGORY_ORDER = [
  CATEGORIES.SOFFIT,
  CATEGORIES.SOFFIT_TRIM,
  CATEGORIES.FASCIA,
  CATEGORIES.SUB_FASCIA,
];

const NAMES = {
  SOFFIT_PANEL: 'ALUMINUM VENTED SOFFIT WHITE 100SF/SQ',
  J_CHANNEL:    'J-CHANNEL ALUMINUM 12FT',
  F_CHANNEL:    'F-CHANNEL ALUMINUM 12FT',
  SOFFIT_NAILS: 'SOFFIT NAILS 1-1/4IN WHITE LB',
  FASCIA_6IN:   '6IN ALUMINUM FASCIA WHITE 10FT',
  // Sub-fascia reuses the existing 2x4x16 SPF SKU (no placeholder needed).
  SUB_FASCIA:   '2 X 4 X 16 PREMIUM SPRUCE',
};

const SOFFIT_SQ_SF        = 100;
const TRIM_PIECE_LF       = 12;
const FASCIA_PIECE_LF     = 10;
const SUB_FASCIA_PIECE_LF = 16;
const NAILS_LF_PER_LB     = 50;

/**
 * Compute soffit & fascia materials.
 *   geometry: { eave_lf, rake_lf, avg_overhang_ft }
 *   settings: ignored today (no waste factors specified)
 *
 * Returns: array of { section, category, name, unit, quantity }
 */
export function computeSoffitFasciaMaterials(geometry, settings = {}) {
  const g = geometry || {};
  const eaveLf      = Number(g.eave_lf) || 0;
  const rakeLf      = Number(g.rake_lf) || 0;
  const overhangFt  = Number(g.avg_overhang_ft) || 0;
  if (eaveLf <= 0 && rakeLf <= 0) return [];

  const section = SECTION_SOFFIT_FASCIA;
  const items = [];
  const add = (category, name, unit, quantity) => {
    if (!(quantity > 0)) return;
    items.push({ section, category, name, unit, quantity });
  };

  // Soffit panel — area = eave LF × overhang depth, in 100sf "squares".
  add(CATEGORIES.SOFFIT, NAMES.SOFFIT_PANEL, 'SQ',
    (eaveLf * overhangFt) / SOFFIT_SQ_SF);

  // J-channel and F-channel — one piece per 12ft of eave each.
  add(CATEGORIES.SOFFIT_TRIM, NAMES.J_CHANNEL, 'EA', eaveLf / TRIM_PIECE_LF);
  add(CATEGORIES.SOFFIT_TRIM, NAMES.F_CHANNEL, 'EA', eaveLf / TRIM_PIECE_LF);
  add(CATEGORIES.SOFFIT_TRIM, NAMES.SOFFIT_NAILS, 'LB', eaveLf / NAILS_LF_PER_LB);

  // Fascia covers eaves + rakes; 10ft pieces.
  add(CATEGORIES.FASCIA, NAMES.FASCIA_6IN, 'EA',
    (eaveLf + rakeLf) / FASCIA_PIECE_LF);

  // Sub-fascia (wood backer) covers eaves + rakes; 16ft pieces.
  add(CATEGORIES.SUB_FASCIA, NAMES.SUB_FASCIA, 'EA',
    (eaveLf + rakeLf) / SUB_FASCIA_PIECE_LF);

  return items;
}
