import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT id, item_number, catalog_number, description, product_type, definition,
            coverage_value, coverage_unit, section_notes
     FROM sku_catalog
     ORDER BY definition NULLS LAST, description`
  );
  res.json(rows);
});

export default router;

// Standalone search router mounted at /sku-search. Searches sku_catalog_full
// (the full warehouse catalog) by item_number, catalog_number, or description.
export const skuSearchRouter = Router();

skuSearchRouter.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  if (!q) return res.json([]);
  const { rows } = await query(`
    SELECT item_number, catalog_number, description, unit, cost,
           price1, price2, price3, price4
    FROM sku_catalog_full
    WHERE description ILIKE $1
       OR item_number = $2
       OR catalog_number ILIKE $1
    ORDER BY
      CASE WHEN item_number = $2 THEN 0
           WHEN catalog_number ILIKE $2 THEN 1
           ELSE 2
      END,
      description
    LIMIT $3
  `, [`%${q}%`, q, limit]);
  res.json(rows);
});
