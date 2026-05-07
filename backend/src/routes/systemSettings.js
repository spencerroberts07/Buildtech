import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

// Admin-only guard. Reads users.role for the JWT-identified user; returns 403 unless 'admin'.
async function requireAdmin(req, res, next) {
  try {
    const r = await query('SELECT role FROM users WHERE id = $1', [req.user?.id]);
    if (!r.rows[0] || r.rows[0].role !== 'admin') {
      return res.status(403).json({ error: 'admin only' });
    }
    next();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

router.get('/', requireAdmin, async (req, res) => {
  const { rows } = await query('SELECT key, value FROM system_settings ORDER BY key');
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  res.json(out);
});

router.put('/:key', requireAdmin, async (req, res) => {
  const { key } = req.params;
  const value = (req.body || {}).value;
  if (value == null) return res.status(400).json({ error: 'value required' });
  const { rows } = await query(
    `INSERT INTO system_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
     RETURNING *`,
    [key, String(value)]
  );
  res.json(rows[0]);
});

export default router;
