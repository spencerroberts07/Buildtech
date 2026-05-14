// Self-contained tests for deckRules.js — same pattern as wallRules.test.js.
// Run: node src/deckRules.test.js
import assert from 'node:assert/strict';
import { computeDeckMaterials, DECK_CATEGORIES, detectLedgerEdges } from './deckRules.js';
import { sumMaterials } from './wallRules.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); failed++; }
}
const findRow = (rows, predicate) => rows.find(predicate);
const findRows = (rows, predicate) => rows.filter(predicate);

// Disable waste so the spec's pre-waste numbers match directly.
const NO_WASTE = { wasteFactors: { deck_decking: 0, deck_framing: 0, deck_concrete: 0 }, scaleFtPerGrid: 1 };

// ---------- Test 1: 16ft × 12ft rectangle ----------
console.log('\n=== 16x12 rectangle deck, 3ft height, deck blocks, 2x8 @ 16", 4x4 posts @ 8ft, 5/4x6 perp, wood railing ===');

const rectDeck = {
  corners: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 12 }, { x: 0, y: 12 }],
  attached_wall_edge: [0],
  deck_height_ft: 3.0,
  joist_size: '2x8',
  joist_spacing_inches: 16,
  beam_ply: 2,
  beam_size: '2x10',
  post_size: '4x4',
  post_spacing_ft: 8.0,
  footing_type: 'deck_block',
  decking_size: '5/4x6',
  decking_pattern: 'perpendicular',
  include_railing: true,
  railing_type: 'wood',
  railing_post_spacing_ft: 6.0,
  fascia_board: true,
  composite_package: false,
};
const rectItemsRaw = computeDeckMaterials(rectDeck, [], NO_WASTE);
const rectItems = sumMaterials(rectItemsRaw);

test('all rows land in the Deck section', () => {
  for (const r of rectItems) assert.equal(r.section, 'Deck');
});
test('post count: ceil(16/8) + 1 = 3 (4x4 PT posts, "Posts" category)', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.POSTS && /^4 X 4 X \d+ PRESSURE TREATED$/.test(x.name));
  assert.ok(r, 'expected 4x4 post row in Posts category');
  assert.equal(r.quantity, 3);
});
test('deck blocks: 1 per post = 3 ("Footings — Deck Blocks")', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.FOOTINGS_DECK_BLOCKS && /DECK BLOCK/.test(x.name));
  assert.equal(r.quantity, 3);
});
test('joists: ceil(16 × 12 / 16) + 1 = 13 (2x8 PT @ 12ft, uses deck_width)', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.JOISTS && x.name === '2 X 8 X 12 PRESSURE TREATED');
  assert.ok(r, 'expected 2 X 8 X 12 PT joist row');
  assert.equal(r.quantity, 13);
});
test('joist hangers: equal joist_count = 13 ("Joist Hangers" category)', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.JOIST_HANGERS && /JOIST HANGER/.test(x.name));
  assert.equal(r.quantity, 13);
});
test('no hurricane ties anywhere in deck output', () => {
  const hits = findRows(rectItems, (x) => /HURRICANE/.test(x.name));
  assert.equal(hits.length, 0, 'hurricane ties should not appear on a deck');
});
test('ledger: 1 × 16ft 2x8 PT ("Ledger" category, ceil(16/16)=1)', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.LEDGER && x.name === '2 X 8 X 16 PRESSURE TREATED');
  assert.equal(r.quantity, 1);
});
test('rim joists: ceil(40/16) = 3 × 2x8x16 PT ("Rim Joists" category)', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.RIM_JOISTS && x.name === '2 X 8 X 16 PRESSURE TREATED');
  assert.equal(r.quantity, 3);
});
test('blocking: 12ft depth > 8 → 1 row of 2x8x16 ("Blocking" category)', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.BLOCKING && x.name === '2 X 8 X 16 PRESSURE TREATED');
  assert.equal(r.quantity, 1);
});
test('ledger flashing: 16 LF ("Ledger Hardware")', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.LEDGER_HARDWARE && /LEDGER FLASHING/.test(x.name));
  assert.equal(r.quantity, 16);
});
test('beam: ceil(16/16) × 2 plies × 1 beam = 2 boards ("Beam" category)', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.BEAM && x.name === '2 X 10 X 16 PRESSURE TREATED');
  assert.equal(r.quantity, 2);
});
test('post caps: 1 per post = 3 ("Post Caps" category)', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.POST_CAPS && /POST CAP/.test(x.name));
  assert.equal(r.quantity, 3);
});
test('deck blocks do not get post bases (integrated pocket)', () => {
  const rows = findRows(rectItems, (x) => x.category === DECK_CATEGORIES.POST_BASES);
  assert.equal(rows.length, 0);
});
test('decking boards: ceil(12 / 0.469) = 26 × 16ft each ("Decking Boards")', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.DECKING_BOARDS && x.name === '5/4 X 6 X 16 PT DECK BOARD');
  assert.equal(r.quantity, 26);
});
test('deck screws: joist_count × boards_needed × 2 = 13 × 26 × 2 = 676 → 1 box (1750/BX)', () => {
  // Single deck-screw row in "Deck Fasteners" only; railing hardware row
  // is separate and lives under "Railing — Hardware".
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.DECK_FASTENERS && /DECK SCREWS/.test(x.name));
  assert.ok(r, 'expected a single deck screws row in Deck Fasteners');
  assert.match(r.name, /1750\/BX/);
  assert.equal(r.quantity, 1);
});
test('railing balusters: ceil(40 × 12 / 4.5) = 107 ("Railing — Balusters")', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.RAILING_BALUSTERS && /BALUSTER/.test(x.name));
  assert.equal(r.quantity, 107);
});
test('railing posts: ceil(40 / 6) + 1 = 8, 4x4x8 PT ("Railing — Posts")', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.RAILING_POSTS && /^4 X 4 X \d+ PRESSURE TREATED$/.test(x.name));
  assert.ok(r);
  assert.equal(r.name, '4 X 4 X 8 PRESSURE TREATED');
  assert.equal(r.quantity, 8);
});
test('railing 2x4 runs: 3 separate categories (top rail / top cap / bottom rail), each ceil(40/16)=3', () => {
  const top    = findRow(rectItems, (x) => x.category === DECK_CATEGORIES.RAILING_TOP_RAIL);
  const cap    = findRow(rectItems, (x) => x.category === DECK_CATEGORIES.RAILING_TOP_CAP);
  const bottom = findRow(rectItems, (x) => x.category === DECK_CATEGORIES.RAILING_BOTTOM_RAIL);
  assert.ok(top && cap && bottom, 'expected all three railing 2x4 categories');
  assert.equal(top.quantity, 3);
  assert.equal(cap.quantity, 3);
  assert.equal(bottom.quantity, 3);
});
test('no stair rows when deckStairs is empty', () => {
  const stairRows = rectItems.filter((x) => /^Stairs — /.test(x.category || ''));
  assert.equal(stairRows.length, 0);
});

// ---------- Test 2: same deck + one 36"-wide staircase ----------
console.log('\n=== Same deck + 1 staircase, 36" wide, 3ft height ===');

const stairs = [{ width_ft: 3.0, edge_index: 2, position_fraction: 0.5, tread_material: '5/4x6' }];
const stairItemsRaw = computeDeckMaterials(rectDeck, stairs, NO_WASTE);
const stairItems = sumMaterials(stairItemsRaw);

test('num_steps: ceil(3 × 12 / 7) = 6 → 6-step pre-cut stringer × 2 ("Stairs — Stringers")', () => {
  const r = findRow(stairItems, (x) =>
    x.category === DECK_CATEGORIES.STAIRS_STRINGERS && /PRE-CUT STRINGER 6-STEP/.test(x.name));
  assert.ok(r, 'expected pre-cut 6-step stringer row');
  assert.equal(r.quantity, 2);
});
test('risers: 6 × 2x8 PT, one per step ("Stairs — Risers")', () => {
  const r = findRow(stairItems, (x) =>
    x.category === DECK_CATEGORIES.STAIRS_RISERS && /^2 X 8 X \d+ PRESSURE TREATED$/.test(x.name));
  assert.ok(r);
  assert.equal(r.quantity, 6);
});
test('treads: 12 × 5/4x6 PT, 2 per step × 6 ("Stairs — Treads")', () => {
  const r = findRow(stairItems, (x) =>
    x.category === DECK_CATEGORIES.STAIRS_TREADS && /^5\/4 X 6 X \d+ PT DECK BOARD$/.test(x.name));
  assert.equal(r.quantity, 12);
});
test('stair landing pad: 3 concrete bags ("Stairs — Hardware")', () => {
  const r = findRow(stairItems, (x) =>
    x.category === DECK_CATEGORIES.STAIRS_HARDWARE && /CONCRETE MIX/.test(x.name));
  assert.equal(r.quantity, 3);
});
test('stair brackets: 2 × stringer_count = 4 ("Stairs — Hardware")', () => {
  const r = findRow(stairItems, (x) =>
    x.category === DECK_CATEGORIES.STAIRS_HARDWARE && /STAIR ANGLE BRACKET/.test(x.name));
  assert.equal(r.quantity, 4);
});
test('joist count unchanged when adding stairs (still 13)', () => {
  const r = findRow(stairItems, (x) =>
    x.category === DECK_CATEGORIES.JOISTS && x.name === '2 X 8 X 12 PRESSURE TREATED');
  assert.equal(r.quantity, 13);
});

// ---------- Test 3: L-shaped 20x12 with 8x8 cutout ----------
console.log('\n=== L-shaped 20×12 deck with 8×8 cutout (area = 176 sf) ===');

// Polygon: 20×12 rectangle with the upper-right 8×8 corner removed.
// Corners (CCW):
//   (0,0) → (20,0) → (20,4) → (12,4) → (12,12) → (0,12)
// Ledger is the long 20ft edge (edge index 0).
const lDeck = {
  corners: [
    { x: 0, y: 0 }, { x: 20, y: 0 },
    { x: 20, y: 4 }, { x: 12, y: 4 },
    { x: 12, y: 12 }, { x: 0, y: 12 },
  ],
  attached_wall_edge: [0],
  deck_height_ft: 3.0,
  joist_size: '2x8',
  joist_spacing_inches: 16,
  beam_ply: 2,
  beam_size: '2x10',
  post_size: '4x4',
  post_spacing_ft: 8.0,
  footing_type: 'deck_block',
  decking_size: '5/4x6',
  decking_pattern: 'perpendicular',
  include_railing: true,
  railing_type: 'wood',
  railing_post_spacing_ft: 6.0,
  fascia_board: true,
};
const lItemsRaw = computeDeckMaterials(lDeck, [], NO_WASTE);
const lItems = sumMaterials(lItemsRaw);

test('L-shape posts: 4 (ceil(20/8) + 1) → 4 deck blocks', () => {
  const r = findRow(lItems, (x) =>
    x.category === DECK_CATEGORIES.FOOTINGS_DECK_BLOCKS && /DECK BLOCK/.test(x.name));
  assert.equal(r.quantity, 4);
});
test('L-shape joists: ceil(20 × 12 / 16) + 1 = 16 (uses deck_width, not depth)', () => {
  // deck_width = 20 (ledger), so joist_count uses width.
  // joist_length = round-up(deck_depth) = round-up(176/20=8.8) = 10ft.
  const r = findRow(lItems, (x) =>
    x.category === DECK_CATEGORIES.JOISTS && x.name === '2 X 8 X 10 PRESSURE TREATED');
  assert.ok(r, 'expected 2 X 8 X 10 PT joist row (depth 8.8 rounds up to 10ft)');
  assert.equal(r.quantity, 16);
});
test('L-shape ledger: 20ft covered by ceil(20/16) = 2 × 16ft 2x8 PT ("Ledger" only)', () => {
  const r = findRow(lItems, (x) =>
    x.category === DECK_CATEGORIES.LEDGER && x.name === '2 X 8 X 16 PRESSURE TREATED');
  assert.equal(r.quantity, 2);
});
test('L-shape beam: ceil(20/16) × 2 plies × 1 beam = 4 boards (2x10 PT 16ft)', () => {
  // depth 8.8 < 2 × post_spacing (16), so still 1 beam.
  const r = findRow(lItems, (x) =>
    x.category === DECK_CATEGORIES.BEAM && x.name === '2 X 10 X 16 PRESSURE TREATED');
  assert.equal(r.quantity, 4);
});
test('L-shape: no hurricane ties', () => {
  const hits = findRows(lItems, (x) => /HURRICANE/.test(x.name));
  assert.equal(hits.length, 0);
});

// ---------- detectLedgerEdges ----------
console.log('\n=== detectLedgerEdges helper ===');
test('detects edge that runs along house wall', () => {
  // House polygon: 30 × 30 box. Deck sits against the bottom wall (y=0).
  const house = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }];
  // Deck corners (0,0)→(16,0) overlap the bottom wall of the house.
  const deck = [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: -12 }, { x: 0, y: -12 }];
  const ledger = detectLedgerEdges(deck, house, 0.5, 1);
  assert.deepEqual(ledger, [0]);
});
test('returns [] when deck is fully detached from house', () => {
  const house = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }];
  // Deck 5ft away from house — no edge coincides.
  const deck = [{ x: 0, y: -5 }, { x: 10, y: -5 }, { x: 10, y: -15 }, { x: 0, y: -15 }];
  const ledger = detectLedgerEdges(deck, house, 0.5, 1);
  assert.deepEqual(ledger, []);
});

// ---------- report ----------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
