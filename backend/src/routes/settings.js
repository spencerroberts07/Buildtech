import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

const ALLOWED_FIELDS = [
  'default_wall_height',
  'exterior_sheathing',
  'roof_sheathing',
  'drywall',
  'stud_spacing',
  'corner_style',
];

router.get('/', async (req, res) => {
  const { rows } = await query('SELECT * FROM settings WHERE id = 1');
  if (!rows[0]) return res.status(404).json({ error: 'settings not initialized' });
  res.json(rows[0]);
});

router.put('/', async (req, res) => {
  const updates = {};
  for (const f of ALLOWED_FIELDS) {
    if (f in (req.body || {})) {
      updates[f] = req.body[f] === '' ? null : req.body[f];
    }
  }
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    const { rows } = await query('SELECT * FROM settings WHERE id = 1');
    return res.json(rows[0]);
  }
  const setParts = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => updates[k]);
  const { rows } = await query(
    `UPDATE settings SET ${setParts}, updated_at = NOW() WHERE id = 1 RETURNING *`,
    values
  );
  res.json(rows[0]);
});

export default router;
