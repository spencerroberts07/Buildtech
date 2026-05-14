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
test('post count: ceil(16/8) + 1 = 3 (4x4 PT posts)', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.POSTS_AND_BEAMS && /^4 X 4 X \d+ PRESSURE TREATED$/.test(x.name));
  assert.ok(r, 'expected 4x4 post row');
  assert.equal(r.quantity, 3);
});
test('deck blocks: 1 per post = 3', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.FOOTINGS && /DECK BLOCK/.test(x.name));
  assert.equal(r.quantity, 3);
});
test('joists: ceil(12 × 12 / 16) + 1 = 10 (2x8 PT @ 12ft)', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.JOISTS && x.name === '2 X 8 X 12 PRESSURE TREATED');
  assert.ok(r, 'expected 2 X 8 X 12 PT joist row');
  assert.equal(r.quantity, 10);
});
test('ledger: 1 × 16ft 2x8 PT (16ft of ledger fits one 16ft board)', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.LEDGER && x.name === '2 X 8 X 16 PRESSURE TREATED');
  assert.equal(r.quantity, 1);
});
test('ledger flashing: 16 LF', () => {
  const r = findRow(rectItems, (x) => /LEDGER FLASHING/.test(x.name));
  assert.equal(r.quantity, 16);
});
test('beam: 1 × 16ft × 2 plies = 2 boards (2x10 PT)', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.POSTS_AND_BEAMS && x.name === '2 X 10 X 16 PRESSURE TREATED');
  assert.equal(r.quantity, 2);
});
test('decking boards: ceil(12 / 0.469) = 26 × 16ft each (5/4 X 6 PT)', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.DECKING && x.name === '5/4 X 6 X 16 PT DECK BOARD');
  assert.equal(r.quantity, 26);
});
test('railing balusters: ceil(40 × 12 / 4.5) = 107', () => {
  // railing_lf = 16 (rim, opposite ledger) + 12 + 12 (two sides) = 40
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.RAILING && /BALUSTER/.test(x.name));
  assert.equal(r.quantity, 107);
});
test('railing posts: ceil(40 / 6) + 1 = 8 (4x4 PT, 6ft length covers 3ft + 1.5ft)', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.RAILING && /^4 X 4 X \d+ PRESSURE TREATED$/.test(x.name));
  assert.ok(r, 'expected railing 4x4 post row');
  // post length round-up = roundUpLumberLength(3 + 1.5) = 8 (since 4.5 ≤ 8).
  assert.equal(r.name, '4 X 4 X 8 PRESSURE TREATED');
  assert.equal(r.quantity, 8);
});
test('no stair rows when deckStairs is empty', () => {
  const stairRows = rectItems.filter((x) => x.category === DECK_CATEGORIES.STAIRS);
  assert.equal(stairRows.length, 0);
});
test('joist hangers: 1 per joist (ledger side) = 10', () => {
  const r = findRow(rectItems, (x) =>
    x.category === DECK_CATEGORIES.HARDWARE && /JOIST HANGER/.test(x.name));
  assert.equal(r.quantity, 10);
});

// ---------- Test 2: same deck + one 36"-wide staircase ----------
console.log('\n=== Same deck + 1 staircase, 36" wide, 3ft height ===');

const stairs = [{ width_ft: 3.0, edge_index: 2, position_fraction: 0.5, tread_material: '5/4x6' }];
const stairItemsRaw = computeDeckMaterials(rectDeck, stairs, NO_WASTE);
const stairItems = sumMaterials(stairItemsRaw);

test('num_steps: ceil(3 × 12 / 7) = 6 → 6-step pre-cut stringer × 2 (width = 36")', () => {
  const r = findRow(stairItems, (x) =>
    x.category === DECK_CATEGORIES.STAIRS && /PRE-CUT STRINGER 6-STEP/.test(x.name));
  assert.ok(r, 'expected pre-cut 6-step stringer row');
  assert.equal(r.quantity, 2);
});
test('risers: 6 × 2x8 PT (one per step)', () => {
  const r = findRow(stairItems, (x) =>
    x.category === DECK_CATEGORIES.STAIRS && /^2 X 8 X \d+ PRESSURE TREATED$/.test(x.name));
  assert.ok(r);
  assert.equal(r.quantity, 6);
});
test('treads: 12 × 5/4x6 PT deck boards (2 per step × 6)', () => {
  const r = findRow(stairItems, (x) =>
    x.category === DECK_CATEGORIES.STAIRS && /^5\/4 X 6 X \d+ PT DECK BOARD$/.test(x.name));
  assert.equal(r.quantity, 12);
});
test('stair landing pad: 3 concrete bags per staircase', () => {
  // The deck itself uses deck_block footings (0 concrete bags), so the
  // stair landing pad is the only source of CONCRETE MIX rows.
  const r = findRow(stairItems, (x) =>
    x.category === DECK_CATEGORIES.FOOTINGS && /CONCRETE MIX/.test(x.name));
  assert.equal(r.quantity, 3);
});
test('stair brackets: 2 × stringer_count = 4', () => {
  const r = findRow(stairItems, (x) => /STAIR ANGLE BRACKET/.test(x.name));
  assert.equal(r.quantity, 4);
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

test('L-shape area = 20×12 − 8×8 = 176 sf (deck blocks reflect post count from 20ft ledger)', () => {
  // beam_lf = 20, ceil(20/8) + 1 = 4 posts → 4 deck blocks
  const r = findRow(lItems, (x) =>
    x.category === DECK_CATEGORIES.FOOTINGS && /DECK BLOCK/.test(x.name));
  assert.equal(r.quantity, 4);
});
test('L-shape: 20ft ledger covered by 2 × 16ft 2x8 PT (ceil(20/16))', () => {
  const r = findRow(lItems, (x) =>
    x.category === DECK_CATEGORIES.LEDGER && x.name === '2 X 8 X 16 PRESSURE TREATED');
  // Ledger + possible rim/blocking with same name sum into one row; filter
  // by category to isolate the ledger contribution.
  assert.equal(r.quantity, 2);
});
test('L-shape: beam = ceil(20/16) × 2 plies = 4 boards (2x10 PT 16ft)', () => {
  const r = findRow(lItems, (x) =>
    x.category === DECK_CATEGORIES.POSTS_AND_BEAMS && x.name === '2 X 10 X 16 PRESSURE TREATED');
  assert.equal(r.quantity, 4);
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
