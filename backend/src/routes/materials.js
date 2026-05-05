import { Router } from 'express';
import { query } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const { rows } = await query('SELECT * FROM materials ORDER BY name');
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { name, unit, notes } = req.body;
  if (!name || !unit) return res.status(400).json({ error: 'name and unit required' });
  const { rows } = await query(
    'INSERT INTO materials (name, unit, notes) VALUES ($1,$2,$3) RETURNING *',
    [name, unit, notes || null]
  );
  res.status(201).json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, unit, notes } = req.body;
  const { rows } = await query(
    'UPDATE materials SET name=$1, unit=$2, notes=$3 WHERE id=$4 RETURNING *',
    [name, unit, notes || null, id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await query('DELETE FROM materials WHERE id=$1', [id]);
    res.status(204).end();
  } catch (e) {
    // likely FK violation from assembly_items
    res.status(409).json({ error: 'Material is in use by an assembly' });
  }
});

export default router;
