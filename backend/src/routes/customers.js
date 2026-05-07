import { Router } from 'express';
import { query, pool } from '../db.js';

const router = Router();

const CUSTOMER_FIELDS = ['name', 'email', 'phone', 'address', 'city', 'notes'];

router.get('/', async (req, res) => {
  const { rows } = await query(`
    SELECT
      c.*,
      (SELECT COUNT(*)::int FROM projects p WHERE p.customer_id = c.id) AS project_count,
      (SELECT MAX(p.updated_at) FROM projects p WHERE p.customer_id = c.id) AS last_project_at
    FROM customers c
    ORDER BY c.name
  `);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const c = await query('SELECT * FROM customers WHERE id = $1', [id]);
  if (!c.rows[0]) return res.status(404).json({ error: 'not found' });
  const projects = await query(
    `SELECT id, name, notes, num_storeys, created_at, updated_at
     FROM projects WHERE customer_id = $1 ORDER BY updated_at DESC`,
    [id]
  );
  res.json({ ...c.rows[0], projects: projects.rows });
});

router.get('/:id/projects', async (req, res) => {
  const { id } = req.params;
  const { rows } = await query(
    `SELECT id, name, notes, num_storeys, created_at, updated_at
     FROM projects WHERE customer_id = $1 ORDER BY updated_at DESC`,
    [id]
  );
  res.json(rows);
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const { rows } = await query(
    `INSERT INTO customers (name, email, phone, address, city, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      name,
      b.email?.trim() || null,
      b.phone?.trim() || null,
      b.address?.trim() || null,
      b.city?.trim() || null,
      b.notes?.trim() || null,
    ]
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  const updates = {};
  for (const f of CUSTOMER_FIELDS) {
    if (f in b) {
      const v = typeof b[f] === 'string' ? b[f].trim() : b[f];
      updates[f] = v === '' ? null : v;
    }
  }
  if ('name' in updates && !updates.name) {
    return res.status(400).json({ error: 'name cannot be empty' });
  }
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    const { rows } = await query('SELECT * FROM customers WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    return res.json(rows[0]);
  }
  const setParts = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => updates[k]);
  values.push(id);
  const { rows } = await query(
    `UPDATE customers SET ${setParts}, updated_at = NOW()
     WHERE id = $${values.length}
     RETURNING *`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const inUse = await query('SELECT COUNT(*)::int AS n FROM projects WHERE customer_id = $1', [id]);
  if (inUse.rows[0].n > 0) {
    return res.status(409).json({ error: 'Cannot delete: customer has projects. Reassign or delete those first.' });
  }
  await query('DELETE FROM customers WHERE id = $1', [id]);
  res.status(204).end();
});

export default router;
