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
