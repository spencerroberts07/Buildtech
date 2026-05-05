import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const { rows } = await query(
    'SELECT id, name, customer, notes, created_at, updated_at FROM projects ORDER BY updated_at DESC'
  );
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const p = await query('SELECT * FROM projects WHERE id=$1', [id]);
  if (!p.rows[0]) return res.status(404).json({ error: 'not found' });
  const m = await query(`
    SELECT m.*, a.name AS assembly_name, a.unit AS assembly_unit
    FROM measurements m
    LEFT JOIN assemblies a ON a.id = m.assembly_id
    WHERE m.project_id = $1
    ORDER BY m.id
  `, [id]);
  res.json({ ...p.rows[0], measurements: m.rows });
});

router.post('/', async (req, res) => {
  const { name, customer, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const { rows } = await query(
    'INSERT INTO projects (name, customer, notes) VALUES ($1,$2,$3) RETURNING *',
    [name, customer || null, notes || null]
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, customer, notes } = req.body;
  const { rows } = await query(
    'UPDATE projects SET name=$1, customer=$2, notes=$3, updated_at=NOW() WHERE id=$4 RETURNING *',
    [name, customer || null, notes || null, id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  await query('DELETE FROM projects WHERE id=$1', [id]);
  res.status(204).end();
});

// Measurements
router.post('/:id/measurements', async (req, res) => {
  const { id } = req.params;
  const { description, quantity, assembly_id } = req.body;
  if (!description || quantity == null) {
    return res.status(400).json({ error: 'description and quantity required' });
  }
  const { rows } = await query(
    `INSERT INTO measurements (project_id, description, quantity, assembly_id)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [id, description, quantity, assembly_id || null]
  );
  await query('UPDATE projects SET updated_at=NOW() WHERE id=$1', [id]);
  res.status(201).json(rows[0]);
});

router.put('/:id/measurements/:mid', async (req, res) => {
  const { id, mid } = req.params;
  const { description, quantity, assembly_id } = req.body;
  const { rows } = await query(
    `UPDATE measurements SET description=$1, quantity=$2, assembly_id=$3
     WHERE id=$4 AND project_id=$5 RETURNING *`,
    [description, quantity, assembly_id || null, mid, id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  await query('UPDATE projects SET updated_at=NOW() WHERE id=$1', [id]);
  res.json(rows[0]);
});

router.delete('/:id/measurements/:mid', async (req, res) => {
  const { id, mid } = req.params;
  await query('DELETE FROM measurements WHERE id=$1 AND project_id=$2', [mid, id]);
  await query('UPDATE projects SET updated_at=NOW() WHERE id=$1', [id]);
  res.status(204).end();
});

// Material list rollup
router.get('/:id/material-list', async (req, res) => {
  const { id } = req.params;
  const { rows } = await query(`
    SELECT
      m.id AS material_id,
      m.name AS material_name,
      m.unit AS material_unit,
      SUM(meas.quantity * ai.quantity_per_unit * (1 + ai.waste_factor)) AS total_quantity
    FROM measurements meas
    JOIN assemblies a ON a.id = meas.assembly_id
    JOIN assembly_items ai ON ai.assembly_id = a.id
    JOIN materials m ON m.id = ai.material_id
    WHERE meas.project_id = $1
    GROUP BY m.id, m.name, m.unit
    ORDER BY m.name
  `, [id]);
  res.json(rows);
});

export default router;
