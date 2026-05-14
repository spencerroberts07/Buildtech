// Pure deterministic rules engine for deck takeoff.
// Mirrors wallRules.js: pure functions, no DB. All quantities here are
// produced as raw (possibly fractional) values; the materialListBuilder.js
// rollup calls sumMaterials() which applies the final Math.ceil.

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

export const DECK_SECTION = 'Deck';
export const DECK_CATEGORIES = {
  FOOTINGS:        'Footings',
  POSTS_AND_BEAMS: 'Posts & Beams',
  LEDGER:          'Ledger',
  JOISTS:          'Joists & Framing',
  DECKING:         'Decking',
  FASCIA:          'Fascia',
  RAILING:         'Railing',
  STAIRS:          'Stairs',
  HARDWARE:        'Hardware',
  FASTENERS:       'Fasteners',
};
export const DECK_CATEGORY_ORDER = [
  DECK_CATEGORIES.FOOTINGS,
  DECK_CATEGORIES.POSTS_AND_BEAMS,
  DECK_CATEGORIES.LEDGER,
  DECK_CATEGORIES.JOISTS,
  DECK_CATEGORIES.DECKING,
  DECK_CATEGORIES.FASCIA,
  DECK_CATEGORIES.RAILING,
  DECK_CATEGORIES.STAIRS,
  DECK_CATEGORIES.HARDWARE,
  DECK_CATEGORIES.FASTENERS,
];

// Waste factor defaults. The materialListBuilder loads these from
// system_settings (deck_waste_decking, deck_waste_framing, deck_waste_concrete)
// and passes them on `projectSettings.wasteFactors`.
export const DEFAULT_DECK_WASTE = {
  decking:  0.10,
  framing:  0.05,
  concrete: 0.05,
};

function dwf(settings, key) {
  return settings?.wasteFactors?.[`deck_${key}`] ?? DEFAULT_DECK_WASTE[key];
}

// ---------- geometry ----------
function distance(a, b) {
  return Math.hypot(Number(b.x) - Number(a.x), Number(b.y) - Number(a.y));
}
function polygonArea(corners) {
  if (!Array.isArray(corners) || corners.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < corners.length; i++) {
    const p = corners[i], q = corners[(i + 1) % corners.length];
    a += Number(p.x) * Number(q.y) - Number(q.x) * Number(p.y);
  }
  return Math.abs(a) / 2;
}
function edgeLength(corners, idx, scale) {
  const a = corners[idx];
  const b = corners[(idx + 1) % corners.length];
  return distance(a, b) * scale;
}
function perimeter(corners, scale) {
  let p = 0;
  for (let i = 0; i < corners.length; i++) p += edgeLength(corners, i, scale);
  return p;
}

// Round up to nearest standard lumber length (in ft).
const STD_LUMBER_LENGTHS = [8, 10, 12, 14, 16];
function roundUpLumberLength(ft) {
  for (const L of STD_LUMBER_LENGTHS) if (ft <= L + 1e-9) return L;
  return 16; // longer pieces still order as 16ft; framer cuts to fit
}
function roundUpDeckBoardLength(ft) {
  // Deck boards come in 8/10/12/16 ft. No 14ft option in most yards.
  if (ft <= 8 + 1e-9)  return 8;
  if (ft <= 10 + 1e-9) return 10;
  if (ft <= 12 + 1e-9) return 12;
  return 16;
}

// ---------- lumber name builders ----------
// Naming follows the warehouse convention "2 X 6 X 16 ..." that wallRules
// uses, so the rules-engine → sku_catalog match key resolves the same way.
// Pressure-treated deck stock is tagged " PT" so the catalog can carry a
// separate row from premium spruce.
function ptLumberName(size, lengthFt) {
  const [w, h] = size.split('x');
  return `${w} X ${h} X ${lengthFt} PRESSURE TREATED`;
}
function ptDeckBoardName(size, lengthFt) {
  // 5/4x6 deck boards keep the fraction in the name. 2x6 boards use the
  // normal 2 X 6 form so they roll up with framing of the same size when
  // chosen as the deck surface.
  if (size === '5/4x6') return `5/4 X 6 X ${lengthFt} PT DECK BOARD`;
  const [w, h] = size.split('x');
  return `${w} X ${h} X ${lengthFt} PRESSURE TREATED`;
}
function postCapName(postSize) {
  return `POST CAP ${postSize.toUpperCase()}`;
}
function postBaseName(postSize) {
  return `POST BASE ${postSize.toUpperCase()}`;
}
function joistHangerName(joistSize) {
  return `JOIST HANGER ${joistSize.toUpperCase()}`;
}

// Sheathing-style fixed SKU names.
const DECK_BLOCK_NAME       = 'DECK BLOCK PRE-CAST CONCRETE';
const SONOTUBE_NAME         = 'SONOTUBE 8" CONCRETE FORM (LF)';
const BIGFOOT_NAME          = 'BIGFOOT FOOTING FORM BF20';
const CONCRETE_BAG_NAME     = 'CONCRETE MIX 60LB BAG';
const GRAVEL_BAG_NAME       = 'GRAVEL 3/4" CLEAR 30KG BAG';
const LAG_BOLT_NAME         = 'LAG BOLT 1/2" X 4" HDG';
const LAG_WASHER_NAME       = 'LAG WASHER 1/2" HDG';
const CARRIAGE_BOLT_6_NAME  = 'CARRIAGE BOLT 1/2" X 6" HDG';
const CARRIAGE_BOLT_5_NAME  = 'CARRIAGE BOLT 1/2" X 5" HDG';
const FLAT_WASHER_NAME      = 'FLAT WASHER 1/2" HDG';
const HEX_NUT_NAME          = 'HEX NUT 1/2" HDG';
const STRUCT_SCREW_NAME     = 'STRUCTURAL SCREW 1/4" X 4"';
const LEDGER_FLASHING_NAME  = 'LEDGER FLASHING ALUMINUM (LF)';
const JOIST_HANGER_NAILS    = 'JOIST HANGER NAILS 1-1/2" (LB)';
const HURRICANE_TIE_NAME    = 'TIE,HURRICANE 18GA ZMAX H1Z';
const JOIST_TAPE_NAME       = 'JOIST TAPE 1-5/8" X 75FT';
const DECK_SCREWS_350       = 'DECK SCREWS 2-1/2" SQUARE 350/BX';
const RAILING_SCREWS_BX     = 'WOOD SCREWS 2-1/2" SQUARE 350/BX';
const BALUSTER_NAME         = '2 X 2 X 36 PT BALUSTER';
const STAIR_BRACKET_NAME    = 'STAIR ANGLE BRACKET HDG';
const STAIR_PRECUT_NAME     = (steps) => `PRE-CUT STRINGER ${steps}-STEP PT`;
const ALUMINUM_RAILING_PKG  = 'ALUMINUM RAILING PACKAGE';
const COMPOSITE_PKG_NAME    = 'COMPOSITE DECKING PACKAGE';

// ---------- main compute ----------
/**
 * Compute deck material rows.
 *   deck:           a decks-table row (corners + settings)
 *   deckStairs:     deck_stairs rows for this deck (may be [])
 *   projectSettings: { scale_ft_per_grid, wasteFactors }
 *
 * Returns: array of { section, category, name, unit, quantity }
 * Quantities are raw (may be fractional including waste); sumMaterials()
 * downstream rounds up to whole units.
 *
 * The `sectionLabel` option overrides the default 'Deck' section name so
 * multi-deck projects can disambiguate ("Deck — Front", "Deck — Back").
 */
export function computeDeckMaterials(deck, deckStairs = [], projectSettings = {}, options = {}) {
  if (!deck) return [];
  const corners = Array.isArray(deck.corners) ? deck.corners : [];
  if (corners.length < 3) return [];

  const scale = num(projectSettings?.scaleFtPerGrid) ?? num(projectSettings?.scale_ft_per_grid) ?? 1;
  const section = options.sectionLabel || DECK_SECTION;

  // --- geometry ---
  const deckHeightFt   = num(deck.deck_height_ft) ?? 3.0;
  const joistSize      = deck.joist_size || '2x8';
  const joistSpacingIn = num(deck.joist_spacing_inches) ?? 16;
  const beamSize       = deck.beam_size || '2x10';
  const beamPly        = num(deck.beam_ply) ?? 2;
  const postSize       = deck.post_size || '4x4';
  const postSpacingFt  = num(deck.post_spacing_ft) ?? 8.0;
  const footingType    = deck.footing_type || 'deck_block';
  const deckingSize    = deck.decking_size || '5/4x6';
  const deckingPattern = deck.decking_pattern || 'perpendicular';
  const includeRailing = deck.include_railing !== false && !deck.composite_package /* composite carries its own railing — wood railing math still applies if user opted in */;
  const railingType    = deck.railing_type || 'wood';
  const railingPostSpacing = num(deck.railing_post_spacing_ft) ?? 6.0;
  const includeFascia  = deck.fascia_board !== false;
  const compositePackage = !!deck.composite_package;

  // Ledger edges = attached_wall_edge entries (array of edge indices).
  // Non-ledger edges carry rim joists + railing.
  const attached = Array.isArray(deck.attached_wall_edge)
    ? deck.attached_wall_edge.map((i) => Number(i))
    : [];
  const isLedgerEdge = (i) => attached.includes(i);
  const railingSides = Array.isArray(deck.railing_sides)
    ? deck.railing_sides.map((i) => Number(i))
    : null; // null = all non-ledger sides

  const deckArea = polygonArea(corners) * (scale * scale);
  const deckPerimeter = perimeter(corners, scale);
  let ledgerLf = 0;
  let freePerimeterLf = 0;
  let railingLf = 0;
  for (let i = 0; i < corners.length; i++) {
    const L = edgeLength(corners, i, scale);
    if (isLedgerEdge(i)) {
      ledgerLf += L;
    } else {
      freePerimeterLf += L;
      const railed = railingSides ? railingSides.includes(i) : true;
      if (railed) railingLf += L;
    }
  }

  // Effective beam length = ledger length (beam runs parallel at distance).
  // For L-shapes with two non-collinear ledger edges this is approximate;
  // good enough for an estimate.
  const beamLf = ledgerLf > 0 ? ledgerLf : (deckArea > 0 ? Math.sqrt(deckArea) : 0);
  // Deck depth = area / beam-line length (approximation for non-rectangular).
  const deckDepthFt = beamLf > 0 ? (deckArea / beamLf) : 0;
  const deckWidthFt = beamLf; // parallel to ledger

  const items = [];
  const add = (category, name, unit, quantity) => {
    if (!(quantity > 0)) return;
    items.push({ section, category, name, unit, quantity });
  };

  // ---------- posts ----------
  const postsAlongBeam = Math.max(2, Math.ceil(beamLf / postSpacingFt) + 1);
  const totalPosts = postsAlongBeam; // L-shape corner posts handled by adding
                                      // an extra ledger run; out of scope here.

  // ---------- footings ----------
  if (footingType === 'deck_block') {
    add(DECK_CATEGORIES.FOOTINGS, DECK_BLOCK_NAME, 'EA', totalPosts);
  } else if (footingType === 'sonotube') {
    add(DECK_CATEGORIES.FOOTINGS, SONOTUBE_NAME, 'LF', totalPosts * 4.5);
    add(DECK_CATEGORIES.FOOTINGS, BIGFOOT_NAME, 'EA', totalPosts);
    add(DECK_CATEGORIES.FOOTINGS, CONCRETE_BAG_NAME, 'BAG', totalPosts * 4 * (1 + dwf(projectSettings, 'concrete')));
    add(DECK_CATEGORIES.FOOTINGS, GRAVEL_BAG_NAME, 'BAG', totalPosts);
    add(DECK_CATEGORIES.FOOTINGS, postBaseName(postSize), 'EA', totalPosts);
  } else if (footingType === 'poured') {
    add(DECK_CATEGORIES.FOOTINGS, CONCRETE_BAG_NAME, 'BAG', totalPosts * 5 * (1 + dwf(projectSettings, 'concrete')));
    add(DECK_CATEGORIES.FOOTINGS, GRAVEL_BAG_NAME, 'BAG', totalPosts);
    add(DECK_CATEGORIES.FOOTINGS, postBaseName(postSize), 'EA', totalPosts);
  }

  // ---------- posts (lumber) ----------
  const embed = footingType === 'deck_block' ? 0.5 : 1.0;
  const postLenFt = deckHeightFt + embed;
  const postLenStd = roundUpLumberLength(postLenFt);
  add(DECK_CATEGORIES.POSTS_AND_BEAMS, ptLumberName(postSize, postLenStd), 'EA', totalPosts);
  add(DECK_CATEGORIES.HARDWARE, postCapName(postSize), 'EA', totalPosts);
  add(DECK_CATEGORIES.FASTENERS, STRUCT_SCREW_NAME, 'EA', totalPosts * 2);

  // ---------- ledger ----------
  if (ledgerLf > 0) {
    const ledgerBoards = Math.ceil(ledgerLf / 16);
    add(DECK_CATEGORIES.LEDGER, ptLumberName(joistSize, 16), 'EA', ledgerBoards);
    // Lag bolts: 16" o.c., two rows staggered.
    const lagsPerRow = Math.ceil(ledgerLf * 12 / 16);
    add(DECK_CATEGORIES.FASTENERS, LAG_BOLT_NAME, 'EA', lagsPerRow * 2);
    add(DECK_CATEGORIES.FASTENERS, LAG_WASHER_NAME, 'EA', lagsPerRow * 2);
    add(DECK_CATEGORIES.LEDGER, LEDGER_FLASHING_NAME, 'LF', ledgerLf);
  }

  // ---------- beam ----------
  if (beamLf > 0) {
    const beamBoards = Math.ceil(beamLf / 16) * beamPly;
    add(DECK_CATEGORIES.POSTS_AND_BEAMS, ptLumberName(beamSize, 16), 'EA', beamBoards);
    const beamBolts = Math.ceil(beamLf / 2) * beamPly;
    add(DECK_CATEGORIES.FASTENERS, CARRIAGE_BOLT_6_NAME, 'EA', beamBolts);
    add(DECK_CATEGORIES.FASTENERS, FLAT_WASHER_NAME, 'EA', beamBolts * 2);
    add(DECK_CATEGORIES.FASTENERS, HEX_NUT_NAME, 'EA', beamBolts);
  }

  // ---------- joists ----------
  // Spec formula: ceil(deck_depth_ft × 12 / joist_spacing_inches) + 1 per bay.
  // Joist length = round up deck_depth (the perpendicular span between
  // ledger and beam line). For the 16×12 test: 12 × 12 / 16 = 9 → +1 = 10.
  const joistCount = beamLf > 0
    ? (Math.ceil(deckDepthFt * 12 / joistSpacingIn) + 1)
    : 0;
  const joistLenStd = roundUpLumberLength(deckDepthFt);
  if (joistCount > 0) {
    add(
      DECK_CATEGORIES.JOISTS,
      ptLumberName(joistSize, joistLenStd),
      'EA',
      joistCount * (1 + dwf(projectSettings, 'framing'))
    );
  }
  // Rim joists run the full free perimeter (around all non-ledger edges).
  if (freePerimeterLf > 0) {
    const rimBoards = Math.ceil(freePerimeterLf / 16);
    add(DECK_CATEGORIES.JOISTS, ptLumberName(joistSize, 16), 'EA', rimBoards);
  }
  // Mid-span blocking row when deck depth > 8ft.
  if (deckDepthFt > 8 && deckWidthFt > 0) {
    const blockingBoards = Math.ceil(deckWidthFt / 16);
    add(DECK_CATEGORIES.JOISTS, ptLumberName(joistSize, 16), 'EA', blockingBoards);
  }
  // Joist hangers (ledger side only; beam side sits on top).
  if (joistCount > 0 && ledgerLf > 0) {
    add(DECK_CATEGORIES.HARDWARE, joistHangerName(joistSize), 'EA', joistCount);
    add(DECK_CATEGORIES.FASTENERS, JOIST_HANGER_NAILS, 'LB', Math.ceil(joistCount * 8 / 100));
  }
  if (joistCount > 0) {
    add(DECK_CATEGORIES.HARDWARE, HURRICANE_TIE_NAME, 'EA', joistCount);
    // Joist tape rolls @ 75LF each, covering joist + ledger + rim tops.
    const tapeLf = joistCount * joistLenStd + ledgerLf + freePerimeterLf;
    add(DECK_CATEGORIES.HARDWARE, JOIST_TAPE_NAME, 'RL', Math.ceil(tapeLf / 75));
  }

  // ---------- decking ----------
  if (compositePackage) {
    add(DECK_CATEGORIES.DECKING, COMPOSITE_PKG_NAME, 'SF', deckArea);
  } else if (deckArea > 0) {
    const boardWidthFt = 5.5 / 12;
    const boardGapFt   = 0.125 / 12;
    const effWidth = boardWidthFt + boardGapFt;
    let boardsNeeded, boardLenStd, boardName;
    if (deckingPattern === 'parallel') {
      boardsNeeded = Math.ceil(deckWidthFt / effWidth);
      const eachLen = Math.ceil(deckDepthFt / 16) * 16 >= deckDepthFt ? roundUpDeckBoardLength(deckDepthFt) : 16;
      boardLenStd = eachLen;
      const piecesPerRow = Math.ceil(deckDepthFt / boardLenStd);
      boardsNeeded = boardsNeeded * piecesPerRow;
      boardName = ptDeckBoardName(deckingSize, boardLenStd);
    } else if (deckingPattern === 'boxed') {
      // Border (2 rows around perimeter) + perpendicular field inside.
      const borderRows = 2;
      const fieldWidth = Math.max(0, deckWidthFt - borderRows * 2 * boardWidthFt);
      const fieldDepth = Math.max(0, deckDepthFt - borderRows * 2 * boardWidthFt);
      const fieldBoards = fieldDepth > 0 && fieldWidth > 0
        ? Math.ceil(fieldDepth / effWidth) * Math.ceil(fieldWidth / 16)
        : 0;
      const borderBoards = Math.ceil(deckPerimeter * borderRows / 16);
      boardsNeeded = fieldBoards + borderBoards;
      boardLenStd = 16;
      boardName = ptDeckBoardName(deckingSize, 16);
      // Boxed pattern carries higher waste from extra cuts.
      boardsNeeded = boardsNeeded * (1 + 0.15);
    } else {
      // perpendicular (default)
      boardsNeeded = Math.ceil(deckDepthFt / effWidth);
      boardLenStd = roundUpDeckBoardLength(deckWidthFt);
      const piecesPerRow = Math.ceil(deckWidthFt / boardLenStd);
      boardsNeeded = boardsNeeded * piecesPerRow;
      boardName = ptDeckBoardName(deckingSize, boardLenStd);
    }
    add(
      DECK_CATEGORIES.DECKING,
      boardName,
      'EA',
      boardsNeeded * (1 + dwf(projectSettings, 'decking'))
    );
    // Deck screws — ~350 per 100sf, packaged 350/box.
    const totalScrews = Math.ceil(deckArea / 100 * 350);
    add(DECK_CATEGORIES.FASTENERS, DECK_SCREWS_350, 'BX', Math.ceil(totalScrews / 350));
  }

  // ---------- fascia ----------
  if (includeFascia && freePerimeterLf > 0) {
    const fasciaBoards = Math.ceil(freePerimeterLf / 16);
    add(DECK_CATEGORIES.FASCIA, ptDeckBoardName(deckingSize, 16), 'EA', fasciaBoards);
  }

  // ---------- railing ----------
  // Railing is required when guardrail height kicks in (>2ft above grade).
  // The DB column include_railing also drives this; we trust the deck row.
  const wantRailing = (deck.include_railing !== false) || deckHeightFt > 2;
  if (wantRailing && railingLf > 0) {
    if (railingType === 'aluminum') {
      add(DECK_CATEGORIES.RAILING, ALUMINUM_RAILING_PKG, 'LF', railingLf);
    } else {
      const railingPosts = Math.ceil(railingLf / railingPostSpacing) + 1;
      const railingPostLen = roundUpLumberLength(deckHeightFt + 1.5);
      add(DECK_CATEGORIES.RAILING, ptLumberName(postSize, railingPostLen), 'EA', railingPosts);
      const top2x4Boards    = Math.ceil(railingLf / 16);
      const topCap2x4Boards = Math.ceil(railingLf / 16);
      const bot2x4Boards    = Math.ceil(railingLf / 16);
      add(DECK_CATEGORIES.RAILING, ptLumberName('2x4', 16), 'EA', top2x4Boards + topCap2x4Boards + bot2x4Boards);
      // Balusters at 4.5" spacing centre-to-centre (4" clear + 0.5" baluster).
      // Framing waste (typically +10%) handles extra cuts on long runs.
      const balusters = Math.ceil(railingLf * 12 / 4.5) * (1 + dwf(projectSettings, 'framing'));
      add(DECK_CATEGORIES.RAILING, BALUSTER_NAME, 'EA', balusters);
      const railingScrews = Math.ceil(railingLf * 20);
      add(DECK_CATEGORIES.FASTENERS, RAILING_SCREWS_BX, 'BX', Math.ceil(railingScrews / 350));
      add(DECK_CATEGORIES.HARDWARE, postBaseName(postSize), 'EA', railingPosts);
    }
  }

  // ---------- stairs ----------
  const stdSteps = Math.max(1, Math.ceil(deckHeightFt * 12 / 7));
  for (const stair of (deckStairs || [])) {
    const widthFt = num(stair.width_ft) ?? 3.0;
    const numSteps = num(stair.num_steps) ?? stdSteps;
    const treadMat = stair.tread_material || deckingSize;
    const stringerCount = widthFt <= 3.0 ? 2 : 3;
    if (numSteps <= 6) {
      add(DECK_CATEGORIES.STAIRS, STAIR_PRECUT_NAME(numSteps), 'EA', stringerCount);
    } else {
      const runFt = numSteps * 11 / 12;
      const stringerLenRaw = Math.sqrt(runFt * runFt + deckHeightFt * deckHeightFt) + 1;
      const stringerLenStd = Math.ceil(stringerLenRaw / 2) * 2;
      add(DECK_CATEGORIES.STAIRS, ptLumberName('2x12', stringerLenStd), 'EA', stringerCount);
    }
    // Risers — 2x8 PT, one board per step, length = stair width rounded up.
    const riserLenStd = roundUpLumberLength(Math.max(widthFt, 4));
    add(DECK_CATEGORIES.STAIRS, ptLumberName('2x8', riserLenStd), 'EA', numSteps);
    // Treads — two boards per step, length = stair width.
    const treadLenStd = roundUpLumberLength(Math.max(widthFt, 8));
    add(DECK_CATEGORIES.STAIRS, ptDeckBoardName(treadMat, treadLenStd), 'EA', numSteps * 2);
    // Landing pad — 3 bags concrete per staircase.
    add(DECK_CATEGORIES.FOOTINGS, CONCRETE_BAG_NAME, 'BAG', 3);
    // Stringer attachment brackets — two per stringer (top).
    add(DECK_CATEGORIES.HARDWARE, STAIR_BRACKET_NAME, 'EA', stringerCount * 2);
  }

  return items;
}

// Convenience: detect which polygon edges of a deck coincide with edges of a
// floor plan polygon (within tol ft). Used by the API + the canvas tool when a
// new deck is drawn so attached_wall_edge can be populated automatically.
export function detectLedgerEdges(deckCorners, houseCorners, tolFt = 0.5, scale = 1) {
  if (!Array.isArray(deckCorners) || deckCorners.length < 3) return [];
  if (!Array.isArray(houseCorners) || houseCorners.length < 3) return [];
  const out = [];
  for (let i = 0; i < deckCorners.length; i++) {
    const a = deckCorners[i];
    const b = deckCorners[(i + 1) % deckCorners.length];
    if (edgeNearAny(a, b, houseCorners, tolFt / scale)) out.push(i);
  }
  return out;
}
function edgeNearAny(a, b, polygon, tolWorld) {
  for (let j = 0; j < polygon.length; j++) {
    const c = polygon[j];
    const d = polygon[(j + 1) % polygon.length];
    if (segmentsCoincident(a, b, c, d, tolWorld)) return true;
  }
  return false;
}
function segmentsCoincident(a, b, c, d, tol) {
  // Both endpoints of (a,b) must fall on segment (c,d) within `tol`, AND the
  // two segments must be roughly parallel. Distance from each endpoint to the
  // line through (c,d) is checked.
  const da = distPointToSegment(a, c, d);
  const db = distPointToSegment(b, c, d);
  if (da > tol || db > tol) return false;
  return true;
}
function distPointToSegment(p, a, b) {
  const ax = Number(a.x), ay = Number(a.y);
  const bx = Number(b.x), by = Number(b.y);
  const px = Number(p.x), py = Number(p.y);
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
