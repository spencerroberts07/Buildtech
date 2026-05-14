// Pure deterministic rules engine for deck takeoff.
// Mirrors wallRules.js: pure functions, no DB. All quantities here are
// produced as raw (possibly fractional) values; the materialListBuilder.js
// rollup calls sumMaterials() which applies the final Math.ceil.

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

export const DECK_SECTION = 'Deck';

// Category labels are exact strings so the material list renders the
// breakdown the user expects (Posts vs Post Caps vs Beam, etc.) rather
// than collapsing every framing row under a single "Posts & Beams" bucket.
// Footing label is dynamic to surface the footing type chosen.
export const DECK_CATEGORIES = {
  FOOTINGS_DECK_BLOCKS: 'Footings — Deck Blocks',
  FOOTINGS_SONOTUBE:    'Footings — Sonotube',
  FOOTINGS_CONCRETE:    'Footings — Concrete',
  POSTS:                'Posts',
  POST_CAPS:            'Post Caps',
  POST_BASES:           'Post Bases',
  BEAM:                 'Beam',
  BEAM_HARDWARE:        'Beam Hardware',
  LEDGER:               'Ledger',
  LEDGER_HARDWARE:      'Ledger Hardware',
  JOISTS:               'Joists',
  RIM_JOISTS:           'Rim Joists',
  BLOCKING:             'Blocking',
  JOIST_HANGERS:        'Joist Hangers',
  JOIST_HARDWARE:       'Joist Hardware',
  DECKING_BOARDS:       'Decking Boards',
  FASCIA_BOARDS:        'Fascia Boards',
  DECK_FASTENERS:       'Deck Fasteners',
  RAILING_POSTS:        'Railing — Posts',
  RAILING_TOP_RAIL:     'Railing — Top Rail',
  RAILING_TOP_CAP:      'Railing — Top Cap',
  RAILING_BOTTOM_RAIL:  'Railing — Bottom Rail',
  RAILING_BALUSTERS:    'Railing — Balusters',
  RAILING_HARDWARE:     'Railing — Hardware',
  RAILING_ALUMINUM:     'Railing — Aluminum Package',
  STAIRS_STRINGERS:     'Stairs — Stringers',
  STAIRS_RISERS:        'Stairs — Risers',
  STAIRS_TREADS:        'Stairs — Treads',
  STAIRS_HARDWARE:      'Stairs — Hardware',
};
export const DECK_CATEGORY_ORDER = [
  DECK_CATEGORIES.FOOTINGS_DECK_BLOCKS,
  DECK_CATEGORIES.FOOTINGS_SONOTUBE,
  DECK_CATEGORIES.FOOTINGS_CONCRETE,
  DECK_CATEGORIES.POSTS,
  DECK_CATEGORIES.POST_CAPS,
  DECK_CATEGORIES.POST_BASES,
  DECK_CATEGORIES.BEAM,
  DECK_CATEGORIES.BEAM_HARDWARE,
  DECK_CATEGORIES.LEDGER,
  DECK_CATEGORIES.LEDGER_HARDWARE,
  DECK_CATEGORIES.JOISTS,
  DECK_CATEGORIES.RIM_JOISTS,
  DECK_CATEGORIES.BLOCKING,
  DECK_CATEGORIES.JOIST_HANGERS,
  DECK_CATEGORIES.JOIST_HARDWARE,
  DECK_CATEGORIES.DECKING_BOARDS,
  DECK_CATEGORIES.FASCIA_BOARDS,
  DECK_CATEGORIES.DECK_FASTENERS,
  DECK_CATEGORIES.RAILING_POSTS,
  DECK_CATEGORIES.RAILING_TOP_RAIL,
  DECK_CATEGORIES.RAILING_TOP_CAP,
  DECK_CATEGORIES.RAILING_BOTTOM_RAIL,
  DECK_CATEGORIES.RAILING_BALUSTERS,
  DECK_CATEGORIES.RAILING_HARDWARE,
  DECK_CATEGORIES.RAILING_ALUMINUM,
  DECK_CATEGORIES.STAIRS_STRINGERS,
  DECK_CATEGORIES.STAIRS_RISERS,
  DECK_CATEGORIES.STAIRS_TREADS,
  DECK_CATEGORIES.STAIRS_HARDWARE,
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
const FLAT_WASHER_NAME      = 'FLAT WASHER 1/2" HDG';
const HEX_NUT_NAME          = 'HEX NUT 1/2" HDG';
const STRUCT_SCREW_NAME     = 'STRUCTURAL SCREW 1/4" X 4"';
const LEDGER_FLASHING_NAME  = 'LEDGER FLASHING ALUMINUM (LF)';
const JOIST_HANGER_NAILS    = 'JOIST HANGER NAILS 1-1/2" (LB)';
const JOIST_TAPE_NAME       = 'JOIST TAPE 1-5/8" X 75FT';
// Deck screws come in a 5lb box (1750 ct). 350ct boxes are too small for
// real deck work — using them inflates SKU counts on every project.
const DECK_SCREWS_NAME      = 'DECK SCREWS 2-1/2" SQUARE 1750/BX';
const DECK_SCREWS_PER_BOX   = 1750;
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

  // Deck width = parallel to the ledger (= the ledger run length).
  // Deck depth = perpendicular distance from ledger to far edge, derived
  // from area / width. Both are approximations for non-rectangular shapes
  // — adequate for an estimate.
  const deckWidthFt = ledgerLf > 0 ? ledgerLf : (deckArea > 0 ? Math.sqrt(deckArea) : 0);
  const deckDepthFt = deckWidthFt > 0 ? (deckArea / deckWidthFt) : 0;

  // Beam placement / count:
  //   depth ≤ post_spacing      → 1 beam at the outer rim (acts as a
  //                                doubled-up rim/beam supported by posts)
  //   post_spacing < depth ≤ 2× → 1 beam at post_spacing from the ledger,
  //                                outer portion cantilevers (≤ 2ft on 2x8)
  //   depth > 2× post_spacing   → 2 beams (one at post_spacing, one at 2×)
  // Beam length per beam is always = deckWidthFt; the count is what scales
  // with depth, and posts scale 1:1 with beams.
  const beamCount = deckDepthFt > 2 * postSpacingFt ? 2 : 1;
  const beamLfPerBeam = deckWidthFt;

  const items = [];
  const add = (category, name, unit, quantity) => {
    if (!(quantity > 0)) return;
    items.push({ section, category, name, unit, quantity });
  };

  // ---------- posts ----------
  const postsPerBeam = Math.max(2, Math.ceil(beamLfPerBeam / postSpacingFt) + 1);
  const totalPosts = postsPerBeam * beamCount;

  // ---------- footings ----------
  if (footingType === 'deck_block') {
    add(DECK_CATEGORIES.FOOTINGS_DECK_BLOCKS, DECK_BLOCK_NAME, 'EA', totalPosts);
  } else if (footingType === 'sonotube') {
    add(DECK_CATEGORIES.FOOTINGS_SONOTUBE, SONOTUBE_NAME, 'LF', totalPosts * 4.5);
    add(DECK_CATEGORIES.FOOTINGS_SONOTUBE, BIGFOOT_NAME, 'EA', totalPosts);
    add(DECK_CATEGORIES.FOOTINGS_SONOTUBE, CONCRETE_BAG_NAME, 'BAG', totalPosts * 4 * (1 + dwf(projectSettings, 'concrete')));
    add(DECK_CATEGORIES.FOOTINGS_SONOTUBE, GRAVEL_BAG_NAME, 'BAG', totalPosts);
  } else if (footingType === 'poured') {
    add(DECK_CATEGORIES.FOOTINGS_CONCRETE, CONCRETE_BAG_NAME, 'BAG', totalPosts * 5 * (1 + dwf(projectSettings, 'concrete')));
    add(DECK_CATEGORIES.FOOTINGS_CONCRETE, GRAVEL_BAG_NAME, 'BAG', totalPosts);
  }

  // ---------- posts (lumber + hardware) ----------
  const embed = footingType === 'deck_block' ? 0.5 : 1.0;
  const postLenFt = deckHeightFt + embed;
  const postLenStd = roundUpLumberLength(postLenFt);
  add(DECK_CATEGORIES.POSTS, ptLumberName(postSize, postLenStd), 'EA', totalPosts);
  add(DECK_CATEGORIES.POST_CAPS, postCapName(postSize), 'EA', totalPosts);
  // Post bases are required for poured / sonotube footings only — deck
  // blocks have an integrated pocket that holds the post directly.
  if (footingType === 'sonotube' || footingType === 'poured') {
    add(DECK_CATEGORIES.POST_BASES, postBaseName(postSize), 'EA', totalPosts);
  }

  // ---------- ledger ----------
  if (ledgerLf > 0) {
    const ledgerBoards = Math.ceil(ledgerLf / 16);
    add(DECK_CATEGORIES.LEDGER, ptLumberName(joistSize, 16), 'EA', ledgerBoards);
    // Lag bolts: 16" o.c., two rows staggered.
    const lagsPerRow = Math.ceil(ledgerLf * 12 / 16);
    add(DECK_CATEGORIES.LEDGER_HARDWARE, LAG_BOLT_NAME, 'EA', lagsPerRow * 2);
    add(DECK_CATEGORIES.LEDGER_HARDWARE, LAG_WASHER_NAME, 'EA', lagsPerRow * 2);
    add(DECK_CATEGORIES.LEDGER_HARDWARE, LEDGER_FLASHING_NAME, 'LF', ledgerLf);
  }

  // ---------- beam ----------
  // Built-up beam: ceil(length/16) boards × beam_ply × beam_count. Beam
  // hardware (carriage bolts/washers/nuts + post-to-beam structural
  // screws) scales the same way.
  if (beamLfPerBeam > 0) {
    const beamBoards = Math.ceil(beamLfPerBeam / 16) * beamPly * beamCount;
    add(DECK_CATEGORIES.BEAM, ptLumberName(beamSize, 16), 'EA', beamBoards);
    const beamBolts = Math.ceil(beamLfPerBeam / 2) * beamPly * beamCount;
    add(DECK_CATEGORIES.BEAM_HARDWARE, CARRIAGE_BOLT_6_NAME, 'EA', beamBolts);
    add(DECK_CATEGORIES.BEAM_HARDWARE, FLAT_WASHER_NAME, 'EA', beamBolts * 2);
    add(DECK_CATEGORIES.BEAM_HARDWARE, HEX_NUT_NAME, 'EA', beamBolts);
    // Structural screws fasten post cap to beam (2 per post).
    add(DECK_CATEGORIES.BEAM_HARDWARE, STRUCT_SCREW_NAME, 'EA', totalPosts * 2);
  }

  // ---------- joists ----------
  // Joists run PERPENDICULAR to the ledger:
  //   joist LENGTH = deck_depth  (spans from ledger to beam/outer rim)
  //   joist COUNT  = ceil(deck_width × 12 / spacing) + 1  (one at each
  //                                                        spacing along
  //                                                        the ledger, plus
  //                                                        the end joist)
  const joistCount = deckWidthFt > 0
    ? (Math.ceil(deckWidthFt * 12 / joistSpacingIn) + 1)
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
    add(DECK_CATEGORIES.RIM_JOISTS, ptLumberName(joistSize, 16), 'EA', rimBoards);
  }
  // Mid-span blocking row only when deck depth exceeds 8ft. Shallower
  // decks don't need blocking (joists span without lateral support).
  if (deckDepthFt > 8 && deckWidthFt > 0) {
    const blockingBoards = Math.ceil(deckWidthFt / 16);
    add(DECK_CATEGORIES.BLOCKING, ptLumberName(joistSize, 16), 'EA', blockingBoards);
  }
  // Joist hangers (ledger side only; beam side sits on top of beam).
  // One hanger per joist, regardless of beam direction.
  if (joistCount > 0 && ledgerLf > 0) {
    add(DECK_CATEGORIES.JOIST_HANGERS, joistHangerName(joistSize), 'EA', joistCount);
    add(DECK_CATEGORIES.JOIST_HARDWARE, JOIST_HANGER_NAILS, 'LB', Math.ceil(joistCount * 8 / 100));
  }
  if (joistCount > 0) {
    // Joist tape rolls @ 75LF each, covering joist + ledger + rim tops.
    const tapeLf = joistCount * joistLenStd + ledgerLf + freePerimeterLf;
    add(DECK_CATEGORIES.JOIST_HARDWARE, JOIST_TAPE_NAME, 'RL', Math.ceil(tapeLf / 75));
  }

  // ---------- decking ----------
  // Track boards_needed at outer scope so the deck-screw calculation can
  // reuse it. boardsNeededForScrews = the perpendicular row count (used
  // even for parallel/boxed patterns — the screw count is dominated by
  // joist crossings, which is the same regardless of pattern).
  let boardsNeededForScrews = 0;
  if (compositePackage) {
    add(DECK_CATEGORIES.DECKING_BOARDS, COMPOSITE_PKG_NAME, 'SF', deckArea);
  } else if (deckArea > 0) {
    const boardWidthFt = 5.5 / 12;
    const boardGapFt   = 0.125 / 12;
    const effWidth = boardWidthFt + boardGapFt;
    let boardsNeeded, boardLenStd, boardName;
    // boards_needed (perpendicular row count) used by both the decking
    // count and the deck-screw count.
    boardsNeededForScrews = Math.ceil(deckDepthFt / effWidth);
    if (deckingPattern === 'parallel') {
      const rowCount = Math.ceil(deckWidthFt / effWidth);
      boardLenStd = roundUpDeckBoardLength(deckDepthFt);
      const piecesPerRow = Math.ceil(deckDepthFt / boardLenStd);
      boardsNeeded = rowCount * piecesPerRow;
      boardName = ptDeckBoardName(deckingSize, boardLenStd);
    } else if (deckingPattern === 'boxed') {
      const borderRows = 2;
      const fieldWidth = Math.max(0, deckWidthFt - borderRows * 2 * boardWidthFt);
      const fieldDepth = Math.max(0, deckDepthFt - borderRows * 2 * boardWidthFt);
      const fieldBoards = fieldDepth > 0 && fieldWidth > 0
        ? Math.ceil(fieldDepth / effWidth) * Math.ceil(fieldWidth / 16)
        : 0;
      const borderBoards = Math.ceil(deckPerimeter * borderRows / 16);
      boardsNeeded = (fieldBoards + borderBoards) * (1 + 0.15); // extra cuts
      boardLenStd = 16;
      boardName = ptDeckBoardName(deckingSize, 16);
    } else {
      // perpendicular (default)
      const rowCount = boardsNeededForScrews;
      boardLenStd = roundUpDeckBoardLength(deckWidthFt);
      const piecesPerRow = Math.ceil(deckWidthFt / boardLenStd);
      boardsNeeded = rowCount * piecesPerRow;
      boardName = ptDeckBoardName(deckingSize, boardLenStd);
    }
    add(
      DECK_CATEGORIES.DECKING_BOARDS,
      boardName,
      'EA',
      boardsNeeded * (1 + dwf(projectSettings, 'decking'))
    );
  }

  // ---------- fascia ----------
  if (includeFascia && freePerimeterLf > 0) {
    const fasciaBoards = Math.ceil(freePerimeterLf / 16);
    add(DECK_CATEGORIES.FASCIA_BOARDS, ptDeckBoardName(deckingSize, 16), 'EA', fasciaBoards);
  }

  // ---------- deck screws ----------
  // 2 screws per board per joist crossing. boardsNeededForScrews is the
  // count of decking boards spanning the deck depth (one for each row of
  // boards across the width). Single line item; box size = 1750.
  if (joistCount > 0 && boardsNeededForScrews > 0) {
    const totalScrews = joistCount * boardsNeededForScrews * 2;
    add(DECK_CATEGORIES.DECK_FASTENERS, DECK_SCREWS_NAME, 'BX', Math.ceil(totalScrews / DECK_SCREWS_PER_BOX));
  }

  // ---------- railing ----------
  // Railing is required when guardrail height kicks in (>2ft above grade).
  // The DB column include_railing also drives this; we trust the deck row.
  const wantRailing = (deck.include_railing !== false) || deckHeightFt > 2;
  if (wantRailing && railingLf > 0) {
    if (railingType === 'aluminum') {
      add(DECK_CATEGORIES.RAILING_ALUMINUM, ALUMINUM_RAILING_PKG, 'LF', railingLf);
    } else {
      const railingPosts = Math.ceil(railingLf / railingPostSpacing) + 1;
      const railingPostLen = roundUpLumberLength(deckHeightFt + 1.5);
      add(DECK_CATEGORIES.RAILING_POSTS, ptLumberName(postSize, railingPostLen), 'EA', railingPosts);
      // Three 2x4 PT runs along the railing: top rail (face), top cap
      // (flat), bottom rail (face). Each is split into its own line so
      // the takeoff makes the breakdown explicit.
      const railingRunBoards = Math.ceil(railingLf / 16);
      add(DECK_CATEGORIES.RAILING_TOP_RAIL,    ptLumberName('2x4', 16), 'EA', railingRunBoards);
      add(DECK_CATEGORIES.RAILING_TOP_CAP,     ptLumberName('2x4', 16), 'EA', railingRunBoards);
      add(DECK_CATEGORIES.RAILING_BOTTOM_RAIL, ptLumberName('2x4', 16), 'EA', railingRunBoards);
      // Balusters at 4.5" spacing centre-to-centre (4" clear + 0.5" baluster).
      // Framing waste handles extra cuts on long runs.
      const balusters = Math.ceil(railingLf * 12 / 4.5) * (1 + dwf(projectSettings, 'framing'));
      add(DECK_CATEGORIES.RAILING_BALUSTERS, BALUSTER_NAME, 'EA', balusters);
      // Railing hardware: post bases + screws (reuses the same deck-screw
      // SKU so the warehouse pulls from one bin).
      add(DECK_CATEGORIES.RAILING_HARDWARE, postBaseName(postSize), 'EA', railingPosts);
      const railingScrews = Math.ceil(railingLf * 20);
      add(DECK_CATEGORIES.RAILING_HARDWARE, DECK_SCREWS_NAME, 'BX', Math.ceil(railingScrews / DECK_SCREWS_PER_BOX));
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
      add(DECK_CATEGORIES.STAIRS_STRINGERS, STAIR_PRECUT_NAME(numSteps), 'EA', stringerCount);
    } else {
      const runFt = numSteps * 11 / 12;
      const stringerLenRaw = Math.sqrt(runFt * runFt + deckHeightFt * deckHeightFt) + 1;
      const stringerLenStd = Math.ceil(stringerLenRaw / 2) * 2;
      add(DECK_CATEGORIES.STAIRS_STRINGERS, ptLumberName('2x12', stringerLenStd), 'EA', stringerCount);
    }
    // Risers — 2x8 PT, one board per step, length = stair width rounded up.
    const riserLenStd = roundUpLumberLength(Math.max(widthFt, 4));
    add(DECK_CATEGORIES.STAIRS_RISERS, ptLumberName('2x8', riserLenStd), 'EA', numSteps);
    // Treads — two boards per step, length = stair width.
    const treadLenStd = roundUpLumberLength(Math.max(widthFt, 8));
    add(DECK_CATEGORIES.STAIRS_TREADS, ptDeckBoardName(treadMat, treadLenStd), 'EA', numSteps * 2);
    // Stairs hardware: angle brackets + landing-pad concrete bags.
    add(DECK_CATEGORIES.STAIRS_HARDWARE, STAIR_BRACKET_NAME, 'EA', stringerCount * 2);
    add(DECK_CATEGORIES.STAIRS_HARDWARE, CONCRETE_BAG_NAME, 'BAG', 3);
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
