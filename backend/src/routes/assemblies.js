import { Router } from 'express';
import { query, pool } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const { rows } = await query(`
    SELECT a.*,
      COALESCE(json_agg(json_build_object(
        'id', ai.id,
        'material_id', ai.material_id,
        'material_name', m.name,
        'material_unit', m.unit,
        'quantity_per_unit', ai.quantity_per_unit,
        'waste_factor', ai.waste_factor
      ) ORDER BY m.name) FILTER (WHERE ai.id IS NOT NULL), '[]') AS items
    FROM assemblies a
    LEFT JOIN assembly_items ai ON ai.assembly_id = a.id
    LEFT JOIN materials m ON m.id = ai.material_id
    GROUP BY a.id
    ORDER BY a.name
  `);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const { rows } = await query(`
    SELECT a.*,
      COALESCE(json_agg(json_build_object(
        'id', ai.id,
        'material_id', ai.material_id,
        'material_name', m.name,
        'material_unit', m.unit,
        'quantity_per_unit', ai.quantity_per_unit,
        'waste_factor', ai.waste_factor
      ) ORDER BY m.name) FILTER (WHERE ai.id IS NOT NULL), '[]') AS items
    FROM assemblies a
    LEFT JOIN assembly_items ai ON ai.assembly_id = a.id
    LEFT JOIN materials m ON m.id = ai.material_id
    WHERE a.id = $1
    GROUP BY a.id
  `, [id]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

router.post('/', async (req, res) => {
  const { name, unit, description, items } = req.body;
  if (!name || !unit) return res.status(400).json({ error: 'name and unit required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const a = await client.query(
      'INSERT INTO assemblies (name, unit, description) VALUES ($1,$2,$3) RETURNING *',
      [name, unit, description || null]
    );
    const aid = a.rows[0].id;
    if (Array.isArray(items)) {
      for (const it of items) {
        await client.query(
          `INSERT INTO assembly_items (assembly_id, material_id, quantity_per_unit, waste_factor)
           VALUES ($1,$2,$3,$4)`,
          [aid, it.material_id, it.quantity_per_unit, it.waste_factor || 0]
        );
      }
    }
    await client.query('COMMIT');
    res.status(201).json(a.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, unit, description, items } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const a = await client.query(
      'UPDATE assemblies SET name=$1, unit=$2, description=$3 WHERE id=$4 RETURNING *',
      [name, unit, description || null, id]
    );
    if (!a.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not found' });
    }
    if (Array.isArray(items)) {
      await client.query('DELETE FROM assembly_items WHERE assembly_id=$1', [id]);
      for (const it of items) {
        await client.query(
          `INSERT INTO assembly_items (assembly_id, material_id, quantity_per_unit, waste_factor)
           VALUES ($1,$2,$3,$4)`,
          [id, it.material_id, it.quantity_per_unit, it.waste_factor || 0]
        );
      }
    }
    await client.query('COMMIT');
    res.json(a.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  await query('DELETE FROM assemblies WHERE id=$1', [id]);
  res.status(204).end();
});

export default router;
