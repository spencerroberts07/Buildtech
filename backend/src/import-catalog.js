// One-time import script for the warehouse SKU catalog.
// Reads two fixed-width report dumps and merges them into sku_catalog_full,
// then syncs pricing back into the curated sku_catalog by item_number.
//
// Usage:
//   node src/import-catalog.js <valuation-file> <pricebook-file>
//   node src/import-catalog.js --dry-run <valuation-file> <pricebook-file>
//
// The files do not require a .txt extension — pass any path.

import fs from 'fs';
import readline from 'readline';
import { pool } from './db.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fileArgs = args.filter((a) => !a.startsWith('--'));

if (fileArgs.length !== 2) {
  console.error('Usage: node src/import-catalog.js [--dry-run] <valuation-file> <pricebook-file>');
  process.exit(1);
}

const [costPath, pricePath] = fileArgs;

// --- Parsers ---------------------------------------------------------------

// Cost file (Item Valuation Report) row layout:
//   ITEM CATALOG DESCRIPTION TYPE QUAN-ON-HAND UNITS-ON-HAND UNIT AVG-COST AVG-VAL LAST-COST LAST-VAL
// Strategy: tokenize on whitespace; find the ALL-CAPS unit token (EA, RL, BX, etc.);
// description = tokens between catalog and unit, with trailing pure-numeric tokens
// stripped (those are the type/quan/units columns). First decimal after unit = avg cost.
function parseCostLine(line) {
  if (!/^\d{8}/.test(line)) return null;
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 5) return null;
  const item = tokens[0].replace(/^0+/, '') || '0';
  const catalog = tokens[1];

  let unitIdx = -1;
  for (let i = 2; i < tokens.length; i++) {
    if (/^[A-Z]{2,4}$/.test(tokens[i])) { unitIdx = i; break; }
  }
  if (unitIdx === -1) return null;

  const unit = tokens[unitIdx];
  const descTokens = tokens.slice(2, unitIdx);
  while (descTokens.length > 0 && /^-?\d+(\.\d+)?$/.test(descTokens[descTokens.length - 1])) {
    descTokens.pop();
  }
  const description = descTokens.join(' ');
  const cost = parseFloat(tokens[unitIdx + 1]);
  if (Number.isNaN(cost) || !description) return null;
  return { item, catalog, description, unit, cost };
}

// Pricebook row layout:
//   ITEM CATALOG DESCRIPTION UNIT PRICE1 PRICE2 PRICE3 PRICE4
// Strategy: tokenize; last 4 tokens are prices, 5th-from-last is unit, in between is description.
function parsePriceLine(line) {
  if (!/^\d{8}/.test(line)) return null;
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 7) return null;

  const N = tokens.length;
  const p4 = parseFloat(tokens[N - 1]);
  const p3 = parseFloat(tokens[N - 2]);
  const p2 = parseFloat(tokens[N - 3]);
  const p1 = parseFloat(tokens[N - 4]);
  const unit = tokens[N - 5];

  if ([p1, p2, p3, p4].some((p) => Number.isNaN(p))) return null;
  if (!/^[A-Z]{2,4}$/.test(unit)) return null;

  const item = tokens[0].replace(/^0+/, '') || '0';
  const catalog = tokens[1];
  const description = tokens.slice(2, N - 5).join(' ');
  if (!description) return null;
  return { item, catalog, description, unit, price1: p1, price2: p2, price3: p3, price4: p4 };
}

// GROUP: / SECTION: header lines from the pricebook. Returns the trimmed value or null.
function parseGroupLine(line) {
  const m = line.match(/^GROUP:\s*(.+?)\s*$/);
  return m ? m[1].trim() : null;
}
function parseSectionLine(line) {
  const m = line.match(/^SECTION:\s*(.+?)\s*$/);
  return m ? m[1].trim() : null;
}

// --- Read files ------------------------------------------------------------

async function readLines(path, onLine) {
  const stream = fs.createReadStream(path, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    onLine(line);
  }
}

async function parseCostFile(path) {
  console.log(`Parsing cost file: ${path}`);
  const map = new Map();
  let lines = 0;
  let parsed = 0;
  let skipped = 0;
  await readLines(path, (line) => {
    lines++;
    const row = parseCostLine(line);
    if (!row) { skipped++; return; }
    map.set(row.item, row);
    parsed++;
    if (parsed % 25000 === 0) console.log(`  cost: ${parsed} parsed (${lines} lines scanned)`);
  });
  console.log(`Cost file: ${parsed} valid rows / ${lines} lines (${skipped} skipped/headers)`);
  return map;
}

async function parsePriceFile(path) {
  console.log(`Parsing price file: ${path}`);
  const map = new Map();
  let lines = 0;
  let parsed = 0;
  let skipped = 0;
  let currentGroup = null;
  let currentSection = null;
  await readLines(path, (line) => {
    lines++;
    const g = parseGroupLine(line);
    if (g !== null) { currentGroup = g; return; }
    const s = parseSectionLine(line);
    if (s !== null) { currentSection = s; return; }
    const row = parsePriceLine(line);
    if (!row) { skipped++; return; }
    row.product_group = currentGroup;
    row.product_section = currentSection;
    map.set(row.item, row);
    parsed++;
    if (parsed % 25000 === 0) console.log(`  price: ${parsed} parsed (${lines} lines scanned)`);
  });
  console.log(`Price file: ${parsed} valid rows / ${lines} lines (${skipped} skipped/headers)`);
  return map;
}

// --- Merge + write ---------------------------------------------------------

function mergeRows(costMap, priceMap) {
  // Price file is primary (it has the canonical description/unit/prices).
  // Cost file fills in cost. Items present only in cost file still get a row.
  const merged = new Map();
  for (const [item, p] of priceMap) {
    const c = costMap.get(item);
    merged.set(item, {
      item_number: item,
      catalog_number: p.catalog || null,
      description: p.description,
      unit: p.unit,
      cost: c?.cost ?? null,
      price1: p.price1, price2: p.price2, price3: p.price3, price4: p.price4,
      product_group: p.product_group,
      product_section: p.product_section,
    });
  }
  for (const [item, c] of costMap) {
    if (merged.has(item)) continue;
    merged.set(item, {
      item_number: item,
      catalog_number: c.catalog || null,
      description: c.description,
      unit: c.unit,
      cost: c.cost,
      price1: null, price2: null, price3: null, price4: null,
      product_group: null,
      product_section: null,
    });
  }
  return merged;
}

async function upsertBatch(rows) {
  // Build a single multi-row INSERT with ON CONFLICT DO UPDATE.
  const cols = [
    'item_number', 'catalog_number', 'description', 'unit',
    'cost', 'price1', 'price2', 'price3', 'price4',
    'product_group', 'product_section',
  ];
  const placeholders = [];
  const values = [];
  let p = 1;
  for (const r of rows) {
    const phs = cols.map(() => `$${p++}`);
    placeholders.push(`(${phs.join(',')})`);
    values.push(
      r.item_number, r.catalog_number, r.description, r.unit,
      r.cost, r.price1, r.price2, r.price3, r.price4,
      r.product_group, r.product_section,
    );
  }
  const sql = `
    INSERT INTO sku_catalog_full (${cols.join(',')})
    VALUES ${placeholders.join(',')}
    ON CONFLICT (item_number) DO UPDATE SET
      catalog_number = EXCLUDED.catalog_number,
      description = EXCLUDED.description,
      unit = EXCLUDED.unit,
      cost = EXCLUDED.cost,
      price1 = EXCLUDED.price1,
      price2 = EXCLUDED.price2,
      price3 = EXCLUDED.price3,
      price4 = EXCLUDED.price4,
      product_group = EXCLUDED.product_group,
      product_section = EXCLUDED.product_section,
      updated_at = NOW()
  `;
  await pool.query(sql, values);
}

async function syncToCuratedCatalog() {
  const result = await pool.query(`
    UPDATE sku_catalog sc
    SET
      cost = scf.cost,
      price1 = scf.price1,
      price2 = scf.price2,
      price3 = scf.price3,
      price4 = scf.price4
    FROM sku_catalog_full scf
    WHERE sc.item_number = scf.item_number
      AND (scf.cost IS NOT NULL OR scf.price1 IS NOT NULL)
  `);
  return result.rowCount;
}

async function findUnmatched() {
  // sku_catalog rows whose item_number didn't match anything in sku_catalog_full.
  const matched = await pool.query(`
    SELECT sc.item_number, sc.description
    FROM sku_catalog sc
    WHERE sc.item_number IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM sku_catalog_full scf WHERE scf.item_number = sc.item_number
      )
  `);
  const noItemNumber = await pool.query(`
    SELECT description FROM sku_catalog WHERE item_number IS NULL
  `);
  return { unmatched: matched.rows, noItemNumber: noItemNumber.rows };
}

// --- Main ------------------------------------------------------------------

async function main() {
  const t0 = Date.now();
  const costMap = await parseCostFile(costPath);
  const priceMap = await parsePriceFile(pricePath);
  const merged = mergeRows(costMap, priceMap);
  console.log(`Merged: ${merged.size} unique items`);

  if (dryRun) {
    console.log('DRY RUN — skipping DB writes');
    const sample = [...merged.values()].slice(0, 5);
    console.log('Sample rows:');
    for (const r of sample) console.log(JSON.stringify(r));
    await pool.end();
    return;
  }

  const all = [...merged.values()];
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < all.length; i += BATCH) {
    await upsertBatch(all.slice(i, i + BATCH));
    written += Math.min(BATCH, all.length - i);
    if (written % 5000 < BATCH) console.log(`Processed ${written} rows...`);
  }
  console.log(`Inserted/updated ${written} rows in sku_catalog_full`);

  const synced = await syncToCuratedCatalog();
  console.log(`Synced pricing onto ${synced} sku_catalog rows`);

  const { unmatched, noItemNumber } = await findUnmatched();
  if (unmatched.length > 0) {
    console.log(`\nUnmatched sku_catalog rows (have item_number but no match in import):`);
    for (const r of unmatched) console.log(`  ${r.item_number}  ${r.description}`);
  } else {
    console.log('All sku_catalog rows with item_number matched.');
  }
  if (noItemNumber.length > 0) {
    console.log(`\nsku_catalog rows with NULL item_number (cannot match by item):`);
    for (const r of noItemNumber) console.log(`  - ${r.description}`);
  }

  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await pool.end();
}

main().catch((e) => {
  console.error('Import failed:', e);
  process.exit(1);
});
