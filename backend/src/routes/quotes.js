import { Router } from 'express';
import { query, pool } from '../db.js';
import { computeProjectMaterialList } from '../materialListBuilder.js';

const router = Router();

const PRICE_LEVEL_FIELDS = { 1: 'price1', 2: 'price2', 3: 'price3', 4: 'price4' };
const TAX_RATE_DEFAULT = 0.13;

// --- Helpers ---------------------------------------------------------------

async function generateQuoteNumber(client) {
  // Q-YYYY-NNNN, counter stored in system_settings keyed by year.
  const year = new Date().getFullYear();
  const key = `quote_counter_${year}`;
  // Lock the counter row (or insert it) under FOR UPDATE so concurrent quote
  // creates don't race.
  await client.query(
    `INSERT INTO system_settings (key, value) VALUES ($1, '0')
     ON CONFLICT (key) DO NOTHING`,
    [key]
  );
  const sel = await client.query(
    'SELECT value FROM system_settings WHERE key = $1 FOR UPDATE',
    [key]
  );
  const next = (parseInt(sel.rows[0].value, 10) || 0) + 1;
  await client.query(
    'UPDATE system_settings SET value = $1, updated_at = NOW() WHERE key = $2',
    [String(next), key]
  );
  return `Q-${year}-${String(next).padStart(4, '0')}`;
}

// Look up cost/price for a single material-list row. Tries:
//  1. sku_catalog by item_number → catalog_number → exact LOWER(description)
//  2. sku_catalog_full by item_number → catalog_number → exact LOWER(description)
// Returns { cost, price1..4, item_number, catalog_number, unit } or empty fields.
async function lookupPricing(row, skuCurated, skuFull) {
  const item = row.item_number ? String(row.item_number) : null;
  const catalog = row.catalog_number ? String(row.catalog_number) : null;
  const desc = (row.material_name || '').trim().toLowerCase();

  function pick(map) {
    let m = null;
    if (item && map.byItem.has(item)) m = map.byItem.get(item);
    else if (catalog && map.byCatalog.has(catalog)) m = map.byCatalog.get(catalog);
    else if (desc && map.byDesc.has(desc)) m = map.byDesc.get(desc);
    return m;
  }

  let m = pick(skuCurated);
  if (m && (m.cost != null || m.price1 != null)) {
    return {
      cost: m.cost, price1: m.price1, price2: m.price2, price3: m.price3, price4: m.price4,
      item_number: m.item_number || row.item_number,
      catalog_number: m.catalog_number || row.catalog_number,
      unit: m.unit || row.material_unit,
    };
  }
  m = pick(skuFull);
  if (m) {
    return {
      cost: m.cost, price1: m.price1, price2: m.price2, price3: m.price3, price4: m.price4,
      item_number: m.item_number || row.item_number,
      catalog_number: m.catalog_number || row.catalog_number,
      unit: m.unit || row.material_unit,
    };
  }
  return {
    cost: null, price1: null, price2: null, price3: null, price4: null,
    item_number: row.item_number, catalog_number: row.catalog_number,
    unit: row.material_unit,
  };
}

async function buildLookupMaps() {
  const curated = (await query(`
    SELECT item_number, catalog_number, description, NULL AS unit,
           cost, price1, price2, price3, price4
    FROM sku_catalog
  `)).rows;
  const full = (await query(`
    SELECT item_number, catalog_number, description, unit,
           cost, price1, price2, price3, price4
    FROM sku_catalog_full
  `)).rows;
  const toMap = (rows) => {
    const byItem = new Map(), byCatalog = new Map(), byDesc = new Map();
    for (const r of rows) {
      if (r.item_number) byItem.set(String(r.item_number), r);
      if (r.catalog_number) byCatalog.set(String(r.catalog_number), r);
      if (r.description) byDesc.set(r.description.trim().toLowerCase(), r);
    }
    return { byItem, byCatalog, byDesc };
  };
  return { curated: toMap(curated), full: toMap(full) };
}

function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function recomputeQuoteTotals(lineItems, taxRate) {
  let subtotal = 0;
  let totalCost = 0;
  for (const li of lineItems) {
    if (li.line_price != null) subtotal += Number(li.line_price);
    if (li.line_cost != null) totalCost += Number(li.line_cost);
  }
  const taxAmount = subtotal * Number(taxRate || TAX_RATE_DEFAULT);
  const total = subtotal + taxAmount;
  const grossProfit = subtotal - totalCost;
  const marginPct = subtotal > 0 ? (grossProfit / subtotal) * 100 : null;
  return { subtotal, taxAmount, total, totalCost, grossProfit, marginPct };
}

// Build a fresh set of line items for a project + price level.
async function buildLineItemsForProject(projectId, priceLevel) {
  const matRows = await computeProjectMaterialList(projectId, { includeDeleted: false });
  if (matRows === null) throw new Error('project not found');
  const maps = await buildLookupMaps();
  const priceField = PRICE_LEVEL_FIELDS[priceLevel] || 'price1';

  const items = [];
  let sortOrder = 0;
  for (const r of matRows) {
    if (r.is_package) {
      items.push({
        section: r.section,
        category: r.category,
        item_number: null,
        catalog_number: null,
        description: r.material_name,
        quantity: Number(r.total_quantity),
        unit: r.material_unit,
        unit_cost: null,
        base_unit_price: null,
        unit_price: null,
        line_cost: null,
        line_price: null,
        margin_pct: null,
        price_overridden: false,
        is_package: true,
        sort_order: sortOrder++,
      });
      continue;
    }
    const lookup = await lookupPricing(r, maps.curated, maps.full);
    const qty = Number(r.total_quantity);
    const unitCost = num(lookup.cost);
    const baseUnit = num(lookup[priceField]);
    const unitPrice = baseUnit;
    const lineCost = unitCost != null ? qty * unitCost : null;
    const linePrice = unitPrice != null ? qty * unitPrice : null;
    const marginPct = (linePrice && lineCost != null && linePrice > 0)
      ? ((linePrice - lineCost) / linePrice) * 100 : null;
    items.push({
      section: r.section,
      category: r.category,
      item_number: lookup.item_number,
      catalog_number: lookup.catalog_number,
      description: r.material_name,
      quantity: qty,
      unit: lookup.unit || r.material_unit,
      unit_cost: unitCost,
      base_unit_price: baseUnit,
      unit_price: unitPrice,
      line_cost: lineCost,
      line_price: linePrice,
      margin_pct: marginPct,
      price_overridden: false,
      is_package: false,
      sort_order: sortOrder++,
    });
  }
  return items;
}

async function insertQuoteLineItems(client, quoteId, items) {
  if (items.length === 0) return;
  // Multi-row insert
  const cols = [
    'quote_id', 'section', 'category', 'item_number', 'catalog_number',
    'description', 'quantity', 'unit', 'unit_cost', 'base_unit_price',
    'unit_price', 'line_cost', 'line_price', 'margin_pct',
    'price_overridden', 'is_package', 'sort_order',
  ];
  const placeholders = [];
  const values = [];
  let p = 1;
  for (const it of items) {
    const phs = cols.map(() => `$${p++}`);
    placeholders.push(`(${phs.join(',')})`);
    values.push(
      quoteId, it.section, it.category, it.item_number, it.catalog_number,
      it.description, it.quantity, it.unit, it.unit_cost, it.base_unit_price,
      it.unit_price, it.line_cost, it.line_price, it.margin_pct,
      it.price_overridden || false, it.is_package || false, it.sort_order || 0,
    );
  }
  await client.query(
    `INSERT INTO quote_line_items (${cols.join(',')}) VALUES ${placeholders.join(',')}`,
    values
  );
}

async function updateQuoteTotals(client, quoteId) {
  const li = await client.query(
    'SELECT * FROM quote_line_items WHERE quote_id = $1', [quoteId]
  );
  const q = await client.query('SELECT tax_rate FROM quotes WHERE id = $1', [quoteId]);
  const taxRate = num(q.rows[0]?.tax_rate) ?? TAX_RATE_DEFAULT;
  const t = recomputeQuoteTotals(li.rows, taxRate);
  await client.query(
    `UPDATE quotes SET subtotal=$1, tax_amount=$2, total=$3, total_cost=$4,
       gross_profit=$5, margin_pct=$6, updated_at=NOW() WHERE id=$7`,
    [t.subtotal, t.taxAmount, t.total, t.totalCost, t.grossProfit, t.marginPct, quoteId]
  );
}

async function loadFullQuote(quoteId) {
  const q = (await query(`
    SELECT q.*, p.name AS project_name, p.customer AS project_customer_text,
           c.name AS customer_name
    FROM quotes q
    JOIN projects p ON p.id = q.project_id
    LEFT JOIN customers c ON c.id = q.customer_id
    WHERE q.id = $1
  `, [quoteId])).rows[0];
  if (!q) return null;
  const items = (await query(
    'SELECT * FROM quote_line_items WHERE quote_id = $1 ORDER BY sort_order, id',
    [quoteId]
  )).rows;
  return { ...q, line_items: items };
}

// --- Routes ----------------------------------------------------------------

// GET /quotes — list (optional ?status=, ?project_id=)
router.get('/', async (req, res) => {
  const { status, project_id } = req.query;
  const where = [];
  const params = [];
  if (status) { params.push(status); where.push(`q.status = $${params.length}`); }
  if (project_id) { params.push(project_id); where.push(`q.project_id = $${params.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await query(`
    SELECT q.id, q.quote_number, q.status, q.price_level, q.total, q.margin_pct,
           q.created_by, q.created_at, q.valid_until,
           p.name AS project_name,
           c.name AS customer_name
    FROM quotes q
    JOIN projects p ON p.id = q.project_id
    LEFT JOIN customers c ON c.id = q.customer_id
    ${whereSql}
    ORDER BY q.created_at DESC
  `, params);
  res.json(rows);
});

// GET /quotes/:qid
router.get('/:qid', async (req, res) => {
  const q = await loadFullQuote(req.params.qid);
  if (!q) return res.status(404).json({ error: 'not found' });
  res.json(q);
});

// PUT /quotes/:qid — update status, notes, valid_until, sent_to, sent_at, tax_rate;
//                    if price_level changes, regenerate line items.
router.put('/:qid', async (req, res) => {
  const { qid } = req.params;
  const b = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = (await client.query('SELECT * FROM quotes WHERE id = $1 FOR UPDATE', [qid])).rows[0];
    if (!cur) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not found' });
    }
    const updates = {};
    for (const f of ['status', 'notes', 'valid_until', 'sent_to', 'sent_at', 'tax_rate']) {
      if (f in b) updates[f] = b[f] === '' ? null : b[f];
    }
    let regen = false;
    if ('price_level' in b && Number(b.price_level) !== Number(cur.price_level)) {
      updates.price_level = Number(b.price_level);
      regen = true;
    }
    const keys = Object.keys(updates);
    if (keys.length > 0) {
      const setParts = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
      const values = keys.map((k) => updates[k]);
      values.push(qid);
      await client.query(
        `UPDATE quotes SET ${setParts}, updated_at = NOW() WHERE id = $${values.length}`,
        values
      );
    }
    if (regen) {
      await client.query('DELETE FROM quote_line_items WHERE quote_id = $1', [qid]);
      const items = await buildLineItemsForProject(cur.project_id, updates.price_level);
      await insertQuoteLineItems(client, qid, items);
    }
    await updateQuoteTotals(client, qid);
    await client.query('COMMIT');
    const fresh = await loadFullQuote(qid);
    res.json(fresh);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// DELETE /quotes/:qid — only if status = draft
router.delete('/:qid', async (req, res) => {
  const r = await query('SELECT status FROM quotes WHERE id = $1', [req.params.qid]);
  if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
  if (r.rows[0].status !== 'draft') {
    return res.status(409).json({ error: 'only draft quotes can be deleted' });
  }
  await query('DELETE FROM quotes WHERE id = $1', [req.params.qid]);
  res.status(204).end();
});

// POST /quotes/:qid/adjust — apply a price adjustment.
//   Body: { mode: 'target_margin' | 'target_revenue' | 'bulk', value: number, section?: string }
//   Persists new unit_price + line_price + margin_pct on each affected row, sets price_overridden=true.
router.post('/:qid/adjust', async (req, res) => {
  const { qid } = req.params;
  const b = req.body || {};
  const mode = b.mode;
  const value = Number(b.value);
  const sectionFilter = b.section || null; // 'all' or null = all
  if (!['target_margin', 'target_revenue', 'bulk'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be target_margin | target_revenue | bulk' });
  }
  if (Number.isNaN(value)) return res.status(400).json({ error: 'value must be a number' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const liRows = (await client.query(
      'SELECT * FROM quote_line_items WHERE quote_id = $1 ORDER BY sort_order, id', [qid]
    )).rows;
    if (liRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'quote not found or empty' });
    }
    const inScope = (li) => {
      if (li.is_package) return false;
      if (li.unit_price == null) return false;
      if (sectionFilter && sectionFilter !== 'all' && li.section !== sectionFilter) return false;
      return true;
    };

    if (mode === 'target_margin') {
      const targetPct = value;
      if (targetPct < 0 || targetPct >= 100) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'target margin must be 0–99.99' });
      }
      for (const li of liRows) {
        if (!inScope(li)) continue;
        if (li.unit_cost == null) continue;
        const newUnit = Number(li.unit_cost) / (1 - targetPct / 100);
        await applyLineUpdate(client, li.id, newUnit, li.quantity, li.unit_cost);
      }
    } else if (mode === 'target_revenue') {
      const targetRev = value;
      const curSubtotal = liRows
        .filter(inScope)
        .reduce((s, li) => s + Number(li.line_price || 0), 0);
      if (curSubtotal <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'cannot scale: current subtotal is 0' });
      }
      const mult = targetRev / curSubtotal;
      for (const li of liRows) {
        if (!inScope(li)) continue;
        const newUnit = Number(li.unit_price) * mult;
        await applyLineUpdate(client, li.id, newUnit, li.quantity, li.unit_cost);
      }
    } else if (mode === 'bulk') {
      const mult = 1 + value / 100;
      for (const li of liRows) {
        if (!inScope(li)) continue;
        const newUnit = Number(li.unit_price) * mult;
        await applyLineUpdate(client, li.id, newUnit, li.quantity, li.unit_cost);
      }
    }

    await updateQuoteTotals(client, qid);
    await client.query('COMMIT');
    const fresh = await loadFullQuote(qid);
    res.json(fresh);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

async function applyLineUpdate(client, lineId, newUnit, qty, unitCost) {
  const linePrice = Number(qty) * Number(newUnit);
  const lineCost = unitCost != null ? Number(qty) * Number(unitCost) : null;
  const marginPct = (linePrice > 0 && lineCost != null)
    ? ((linePrice - lineCost) / linePrice) * 100 : null;
  await client.query(
    `UPDATE quote_line_items
     SET unit_price = $1, line_price = $2, line_cost = COALESCE($3, line_cost),
         margin_pct = $4, price_overridden = true
     WHERE id = $5`,
    [newUnit, linePrice, lineCost, marginPct, lineId]
  );
}

// POST /quotes/:qid/reset — restore unit_price = base_unit_price for all rows
router.post('/:qid/reset', async (req, res) => {
  const { qid } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      UPDATE quote_line_items
      SET unit_price = base_unit_price,
          line_price = CASE WHEN base_unit_price IS NULL THEN NULL ELSE quantity * base_unit_price END,
          line_cost  = CASE WHEN unit_cost IS NULL       THEN NULL ELSE quantity * unit_cost       END,
          margin_pct = CASE
            WHEN base_unit_price IS NULL OR unit_cost IS NULL OR quantity * base_unit_price = 0
              THEN NULL
            ELSE ((quantity * base_unit_price - quantity * unit_cost) / (quantity * base_unit_price)) * 100
          END,
          price_overridden = false
      WHERE quote_id = $1
    `, [qid]);
    await updateQuoteTotals(client, qid);
    await client.query('COMMIT');
    const fresh = await loadFullQuote(qid);
    res.json(fresh);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// POST /quotes/:qid/line-items — add a manual line item from sku_catalog_full
//   Body: { item_number?, catalog_number?, description, quantity, section?, category? }
router.post('/:qid/line-items', async (req, res) => {
  const { qid } = req.params;
  const b = req.body || {};
  const qty = Number(b.quantity);
  if (!b.description || !(qty > 0)) {
    return res.status(400).json({ error: 'description and quantity > 0 required' });
  }
  // Look up pricing by item_number first, then catalog_number
  let sku = null;
  if (b.item_number) {
    sku = (await query('SELECT * FROM sku_catalog_full WHERE item_number = $1', [b.item_number])).rows[0];
  }
  if (!sku && b.catalog_number) {
    sku = (await query('SELECT * FROM sku_catalog_full WHERE catalog_number = $1', [b.catalog_number])).rows[0];
  }
  // Determine price level on the parent quote
  const q = (await query('SELECT price_level FROM quotes WHERE id = $1', [qid])).rows[0];
  if (!q) return res.status(404).json({ error: 'quote not found' });
  const priceField = PRICE_LEVEL_FIELDS[q.price_level] || 'price1';

  const unitCost = sku ? num(sku.cost) : null;
  const baseUnit = sku ? num(sku[priceField]) : null;
  const unitPrice = baseUnit;
  const lineCost = unitCost != null ? qty * unitCost : null;
  const linePrice = unitPrice != null ? qty * unitPrice : null;
  const marginPct = (linePrice && lineCost != null && linePrice > 0)
    ? ((linePrice - lineCost) / linePrice) * 100 : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const maxOrder = (await client.query(
      'SELECT COALESCE(MAX(sort_order), 0) AS m FROM quote_line_items WHERE quote_id = $1',
      [qid]
    )).rows[0].m;
    const ins = await client.query(
      `INSERT INTO quote_line_items
        (quote_id, section, category, item_number, catalog_number, description,
         quantity, unit, unit_cost, base_unit_price, unit_price,
         line_cost, line_price, margin_pct, price_overridden, is_package, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false,false,$15)
       RETURNING *`,
      [
        qid,
        b.section || 'Additional Items',
        b.category || null,
        sku?.item_number || b.item_number || null,
        sku?.catalog_number || b.catalog_number || null,
        b.description,
        qty,
        sku?.unit || b.unit || null,
        unitCost, baseUnit, unitPrice,
        lineCost, linePrice, marginPct,
        Number(maxOrder) + 1,
      ]
    );
    await updateQuoteTotals(client, qid);
    await client.query('COMMIT');
    res.status(201).json(ins.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// DELETE /quotes/:qid/line-items/:liid
router.delete('/:qid/line-items/:liid', async (req, res) => {
  const { qid, liid } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      'DELETE FROM quote_line_items WHERE id = $1 AND quote_id = $2',
      [liid, qid]
    );
    if (r.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not found' });
    }
    await updateQuoteTotals(client, qid);
    await client.query('COMMIT');
    res.status(204).end();
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

export default router;

// --- Project-scoped routes (mounted under /projects/:id/quotes) ------------

export function attachProjectQuotesRoutes(projectsRouter) {
  // GET /projects/:id/quotes
  projectsRouter.get('/:id/quotes', async (req, res) => {
    const { id } = req.params;
    const { rows } = await query(`
      SELECT q.id, q.quote_number, q.status, q.price_level, q.total, q.margin_pct,
             q.created_by, q.created_at, q.valid_until
      FROM quotes q
      WHERE q.project_id = $1
      ORDER BY q.created_at DESC
    `, [id]);
    res.json(rows);
  });

  // POST /projects/:id/quotes
  projectsRouter.post('/:id/quotes', async (req, res) => {
    const { id } = req.params;
    const b = req.body || {};
    const proj = (await query('SELECT id, customer_id, price_level FROM projects WHERE id = $1', [id])).rows[0];
    if (!proj) return res.status(404).json({ error: 'project not found' });
    const priceLevel = Number(b.price_level || proj.price_level || 1);
    if (![1, 2, 3, 4].includes(priceLevel)) {
      return res.status(400).json({ error: 'price_level must be 1-4' });
    }
    const items = await buildLineItemsForProject(id, priceLevel);
    const totals = recomputeQuoteTotals(items, TAX_RATE_DEFAULT);
    const createdBy = req.user?.username || null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const quoteNumber = await generateQuoteNumber(client);
      const ins = await client.query(
        `INSERT INTO quotes
          (project_id, customer_id, quote_number, price_level, status,
           subtotal, tax_rate, tax_amount, total, total_cost, gross_profit, margin_pct,
           notes, created_by)
         VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          id, proj.customer_id, quoteNumber, priceLevel,
          totals.subtotal, TAX_RATE_DEFAULT, totals.taxAmount, totals.total,
          totals.totalCost, totals.grossProfit, totals.marginPct,
          b.notes || null, createdBy,
        ]
      );
      const quoteId = ins.rows[0].id;
      await insertQuoteLineItems(client, quoteId, items);
      await client.query('COMMIT');
      const fresh = await loadFullQuote(quoteId);
      res.status(201).json(fresh);
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });
}
