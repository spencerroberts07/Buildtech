import { Router } from 'express';
import { query } from '../db.js';
import {
  computeWallMaterials,
  computeProjectMaterials,
  computeFloorPlanMaterials,
  computeRoofMaterials,
  sumMaterials,
  resolveProjectSettings,
  sectionRank,
  categoryRank,
  LEVELS,
} from '../wallRules.js';
import { pool } from '../db.js';
import { ensureMaterial } from '../materialUpsert.js';

const router = Router();

const PROJECT_SETTING_FIELDS = [
  'default_wall_height',
  'exterior_sheathing',
  'roof_sheathing',
  'drywall',
  'stud_spacing',
  'corner_style',
  'scale_ft_per_grid',
  'viewport_pan_x',
  'viewport_pan_y',
  'viewport_zoom',
  'insulation_type',
  'silverboard_type',
  'num_storeys',
  'floor2_wall_height',
  'rafter_spacing',
];

const WALL_TYPES = ['exterior_2x6', 'interior_2x4', 'interior_2x6'];
const WALL_FIELDS = [
  'x1', 'y1', 'x2', 'y2',
  'height', 'wall_type',
  'sheathing_override', 'drywall_override',
  'extra_corner_studs',
];

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
  const { name, customer, notes, num_storeys, floor2_wall_height, default_wall_height } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const storeys = Number(num_storeys ?? 1);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const proj = await client.query(
      `INSERT INTO projects (name, customer, notes, num_storeys, floor2_wall_height, default_wall_height)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, customer || null, notes || null, storeys,
       floor2_wall_height ?? 9, default_wall_height ?? null]
    );
    const projectId = proj.rows[0].id;
    // Auto-create floor plans for all applicable levels.
    const levels = ['foundation', 'floor1', 'roof'];
    if (storeys === 2) levels.splice(2, 0, 'floor2');
    for (const lvl of levels) {
      await client.query(
        `INSERT INTO floor_plans (project_id, level, corners) VALUES ($1, $2, '[]'::jsonb)`,
        [projectId, lvl]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(proj.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
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

// Project settings (overrides + scale + viewport)
router.get('/:id/settings', async (req, res) => {
  const { id } = req.params;
  const cols = PROJECT_SETTING_FIELDS.join(', ');
  const { rows } = await query(
    `SELECT id, ${cols} FROM projects WHERE id = $1`,
    [id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

router.put('/:id/settings', async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const updates = {};
  for (const f of PROJECT_SETTING_FIELDS) {
    if (f in body) updates[f] = body[f] === '' ? null : body[f];
  }
  const keys = Object.keys(updates);
  const cols = PROJECT_SETTING_FIELDS.join(', ');
  if (keys.length === 0) {
    const { rows } = await query(
      `SELECT id, ${cols} FROM projects WHERE id = $1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    return res.json(rows[0]);
  }
  const setParts = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => updates[k]);
  values.push(id);
  const { rows } = await query(
    `UPDATE projects SET ${setParts}, updated_at = NOW()
     WHERE id = $${values.length}
     RETURNING id, ${cols}`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

// Walls CRUD
router.get('/:id/walls', async (req, res) => {
  const { id } = req.params;
  const { rows } = await query(
    'SELECT * FROM walls WHERE project_id = $1 ORDER BY id',
    [id]
  );
  res.json(rows);
});

router.post('/:id/walls', async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  if (b.x1 == null || b.y1 == null || b.x2 == null || b.y2 == null) {
    return res.status(400).json({ error: 'x1, y1, x2, y2 required' });
  }
  if (!WALL_TYPES.includes(b.wall_type)) {
    return res.status(400).json({
      error: `wall_type must be one of: ${WALL_TYPES.join(', ')}`,
    });
  }
  const { rows } = await query(
    `INSERT INTO walls
       (project_id, x1, y1, x2, y2, height, wall_type,
        sheathing_override, drywall_override, extra_corner_studs)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      id, b.x1, b.y1, b.x2, b.y2,
      b.height ?? null, b.wall_type,
      b.sheathing_override ?? null,
      b.drywall_override ?? null,
      b.extra_corner_studs ?? 0,
    ]
  );
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.status(201).json(rows[0]);
});

router.put('/:id/walls/:wid', async (req, res) => {
  const { id, wid } = req.params;
  const b = req.body || {};
  const updates = {};
  for (const f of WALL_FIELDS) {
    if (f in b) {
      if (f === 'wall_type' && !WALL_TYPES.includes(b[f])) {
        return res.status(400).json({ error: 'invalid wall_type' });
      }
      updates[f] = b[f] === '' ? null : b[f];
    }
  }
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    const { rows } = await query(
      'SELECT * FROM walls WHERE id = $1 AND project_id = $2',
      [wid, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    return res.json(rows[0]);
  }
  const setParts = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => updates[k]);
  values.push(wid, id);
  const { rows } = await query(
    `UPDATE walls SET ${setParts}
     WHERE id = $${values.length - 1} AND project_id = $${values.length}
     RETURNING *`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.json(rows[0]);
});

router.delete('/:id/walls/:wid', async (req, res) => {
  const { id, wid } = req.params;
  await query('DELETE FROM walls WHERE id = $1 AND project_id = $2', [wid, id]);
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.status(204).end();
});

// Openings CRUD
const OPENING_TYPES = ['window', 'door'];
const OPENING_FIELDS = [
  'wall_id', 'floor_plan_wall_id', 'type', 'rough_opening_width', 'rough_opening_height',
  'label', 'position_along_wall',
];

router.get('/:id/openings', async (req, res) => {
  const { id } = req.params;
  const { rows } = await query(
    'SELECT * FROM openings WHERE project_id = $1 ORDER BY id',
    [id]
  );
  res.json(rows);
});

router.post('/:id/openings', async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  if (!b.wall_id && !b.floor_plan_wall_id) {
    return res.status(400).json({ error: 'wall_id or floor_plan_wall_id required' });
  }
  if (b.rough_opening_width == null || b.rough_opening_height == null) {
    return res.status(400).json({ error: 'rough_opening_width and rough_opening_height required' });
  }
  const type = b.type || 'window';
  if (!OPENING_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${OPENING_TYPES.join(', ')}` });
  }
  // Validate FK belongs to this project
  if (b.floor_plan_wall_id) {
    const r = await query(
      `SELECT fpw.id FROM floor_plan_walls fpw
       JOIN floor_plans fp ON fp.id = fpw.floor_plan_id
       WHERE fpw.id = $1 AND fp.project_id = $2`,
      [b.floor_plan_wall_id, id]
    );
    if (!r.rows[0]) return res.status(400).json({ error: 'floor_plan_wall_id not found in this project' });
  } else {
    const r = await query('SELECT id FROM walls WHERE id = $1 AND project_id = $2', [b.wall_id, id]);
    if (!r.rows[0]) return res.status(400).json({ error: 'wall not found in this project' });
  }
  const { rows } = await query(
    `INSERT INTO openings
       (project_id, wall_id, floor_plan_wall_id, type, rough_opening_width, rough_opening_height, label, position_along_wall)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      id,
      b.wall_id ?? null,
      b.floor_plan_wall_id ?? null,
      type,
      b.rough_opening_width,
      b.rough_opening_height,
      b.label || null,
      b.position_along_wall ?? 0.5,
    ],
  );
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.status(201).json(rows[0]);
});

router.put('/:id/openings/:oid', async (req, res) => {
  const { id, oid } = req.params;
  const b = req.body || {};
  const updates = {};
  for (const f of OPENING_FIELDS) {
    if (f in b) {
      if (f === 'type' && !OPENING_TYPES.includes(b[f])) {
        return res.status(400).json({ error: 'invalid opening type' });
      }
      updates[f] = b[f] === '' ? null : b[f];
    }
  }
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    const { rows } = await query(
      'SELECT * FROM openings WHERE id = $1 AND project_id = $2',
      [oid, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    return res.json(rows[0]);
  }
  const setParts = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => updates[k]);
  values.push(oid, id);
  const { rows } = await query(
    `UPDATE openings SET ${setParts}
     WHERE id = $${values.length - 1} AND project_id = $${values.length}
     RETURNING *`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.json(rows[0]);
});

router.delete('/:id/openings/:oid', async (req, res) => {
  const { id, oid } = req.params;
  await query('DELETE FROM openings WHERE id = $1 AND project_id = $2', [oid, id]);
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.status(204).end();
});

// ---------------- Floor plans (polygon-based) ----------------
const FLOOR_PLAN_WALL_FIELDS = ['wall_type', 'height', 'sheathing_override', 'drywall_override'];

async function loadFloorPlanFull(projectId, fpId) {
  const fp = await query(
    'SELECT * FROM floor_plans WHERE id = $1 AND project_id = $2',
    [fpId, projectId]
  );
  if (!fp.rows[0]) return null;
  const walls = await query(
    'SELECT * FROM floor_plan_walls WHERE floor_plan_id = $1 ORDER BY wall_index',
    [fpId]
  );
  const openings = await query(
    `SELECT o.* FROM openings o
     JOIN floor_plan_walls fpw ON fpw.id = o.floor_plan_wall_id
     WHERE fpw.floor_plan_id = $1
     ORDER BY o.id`,
    [fpId]
  );
  return { ...fp.rows[0], walls: walls.rows, openings: openings.rows };
}

router.get('/:id/floor-plans', async (req, res) => {
  const { id } = req.params;
  const { rows } = await query(
    'SELECT * FROM floor_plans WHERE project_id = $1 ORDER BY id',
    [id]
  );
  res.json(rows);
});

router.post('/:id/floor-plans', async (req, res) => {
  const { id } = req.params;
  const { level } = req.body || {};
  const { rows } = await query(
    `INSERT INTO floor_plans (project_id, level, corners) VALUES ($1, $2, '[]'::jsonb) RETURNING *`,
    [id, level || 'floor1']
  );
  res.status(201).json(rows[0]);
});

router.get('/:id/floor-plans/:fpid', async (req, res) => {
  const { id, fpid } = req.params;
  const data = await loadFloorPlanFull(id, fpid);
  if (!data) return res.status(404).json({ error: 'not found' });
  res.json(data);
});

// PUT — replaces the corners array. Reconciles floor_plan_walls rows: keeps existing rows
// for indices that still exist, adds new default rows for new indices, deletes rows whose
// index is now out of range. Openings on deleted walls cascade.
router.put('/:id/floor-plans/:fpid', async (req, res) => {
  const { id, fpid } = req.params;
  const body = req.body || {};
  const corners = Array.isArray(body.corners) ? body.corners : null;
  if (!corners) return res.status(400).json({ error: 'corners array required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const fp = await client.query(
      'SELECT * FROM floor_plans WHERE id = $1 AND project_id = $2 FOR UPDATE',
      [fpid, id]
    );
    if (!fp.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not found' });
    }
    await client.query(
      `UPDATE floor_plans SET corners = $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(corners), fpid]
    );
    const targetCount = corners.length >= 3 ? corners.length : 0;
    // Delete out-of-range walls (and their openings via CASCADE)
    await client.query(
      `DELETE FROM floor_plan_walls WHERE floor_plan_id = $1 AND wall_index >= $2`,
      [fpid, targetCount]
    );
    // Ensure rows exist for each in-range index
    if (targetCount > 0) {
      const existing = await client.query(
        `SELECT wall_index FROM floor_plan_walls WHERE floor_plan_id = $1`,
        [fpid]
      );
      const have = new Set(existing.rows.map((r) => Number(r.wall_index)));
      for (let i = 0; i < targetCount; i++) {
        if (!have.has(i)) {
          await client.query(
            `INSERT INTO floor_plan_walls (floor_plan_id, wall_index, wall_type) VALUES ($1, $2, 'exterior_2x6')`,
            [fpid, i]
          );
        }
      }
    }
    await client.query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
    await client.query('COMMIT');
    const data = await loadFloorPlanFull(id, fpid);
    res.json(data);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Update one wall (by wall_index) — type, height, overrides
router.put('/:id/floor-plans/:fpid/walls/:widx', async (req, res) => {
  const { id, fpid, widx } = req.params;
  const b = req.body || {};
  const updates = {};
  for (const f of FLOOR_PLAN_WALL_FIELDS) {
    if (f in b) updates[f] = b[f] === '' ? null : b[f];
  }
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    const { rows } = await query(
      `SELECT fpw.* FROM floor_plan_walls fpw
       JOIN floor_plans fp ON fp.id = fpw.floor_plan_id
       WHERE fpw.floor_plan_id = $1 AND fpw.wall_index = $2 AND fp.project_id = $3`,
      [fpid, widx, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    return res.json(rows[0]);
  }
  const setParts = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => updates[k]);
  values.push(fpid, widx, id);
  const { rows } = await query(
    `UPDATE floor_plan_walls SET ${setParts}
     WHERE floor_plan_id = $${values.length - 2} AND wall_index = $${values.length - 1}
       AND floor_plan_id IN (SELECT id FROM floor_plans WHERE project_id = $${values.length})
     RETURNING *`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.json(rows[0]);
});

// Delete a wall (an edge): collapses the polygon by removing corners[widx+1] (the trailing
// corner of this edge), then re-indexes higher walls down by 1. Openings on the removed wall
// cascade-delete via FK.
router.delete('/:id/floor-plans/:fpid/walls/:widx', async (req, res) => {
  const { id, fpid, widx } = req.params;
  const widxN = Number(widx);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const fp = await client.query(
      'SELECT * FROM floor_plans WHERE id = $1 AND project_id = $2 FOR UPDATE',
      [fpid, id]
    );
    if (!fp.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not found' });
    }
    const corners = fp.rows[0].corners || [];
    if (widxN < 0 || widxN >= corners.length || corners.length <= 3) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'cannot delete: would collapse polygon below 3 corners' });
    }
    // Drop the trailing corner of this edge: corners[widxN + 1] (mod length).
    const removeIdx = (widxN + 1) % corners.length;
    const newCorners = corners.filter((_, i) => i !== removeIdx);
    await client.query(
      `UPDATE floor_plans SET corners = $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(newCorners), fpid]
    );
    // Delete the wall row at widx (cascades openings)
    await client.query(
      `DELETE FROM floor_plan_walls WHERE floor_plan_id = $1 AND wall_index = $2`,
      [fpid, widxN]
    );
    // Re-index higher walls down by 1
    await client.query(
      `UPDATE floor_plan_walls SET wall_index = wall_index - 1
       WHERE floor_plan_id = $1 AND wall_index > $2`,
      [fpid, widxN]
    );
    // Trim if now out of range
    await client.query(
      `DELETE FROM floor_plan_walls WHERE floor_plan_id = $1 AND wall_index >= $2`,
      [fpid, newCorners.length]
    );
    await client.query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
    await client.query('COMMIT');
    const data = await loadFloorPlanFull(id, fpid);
    res.json(data);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Copy one level's geometry and walls to another level (e.g., Floor 1 → Floor 2).
// Replaces target's corners + walls. Openings are NOT copied.
router.post('/:id/floor-plans/copy-level', async (req, res) => {
  const { id } = req.params;
  const { from_level, to_level } = req.body || {};
  if (!from_level || !to_level) return res.status(400).json({ error: 'from_level and to_level required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const src = await client.query(
      'SELECT * FROM floor_plans WHERE project_id = $1 AND level = $2',
      [id, from_level]
    );
    if (!src.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `source level ${from_level} not found` });
    }
    let dst = (await client.query(
      'SELECT * FROM floor_plans WHERE project_id = $1 AND level = $2',
      [id, to_level]
    )).rows[0];
    if (!dst) {
      const inserted = await client.query(
        `INSERT INTO floor_plans (project_id, level, corners) VALUES ($1, $2, '[]'::jsonb) RETURNING *`,
        [id, to_level]
      );
      dst = inserted.rows[0];
    }
    // Replace target corners
    await client.query(
      `UPDATE floor_plans SET corners = $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(src.rows[0].corners || []), dst.id]
    );
    // Wipe target walls (cascades openings) and re-insert copies of source walls
    await client.query('DELETE FROM floor_plan_walls WHERE floor_plan_id = $1', [dst.id]);
    const srcWalls = await client.query(
      'SELECT * FROM floor_plan_walls WHERE floor_plan_id = $1 ORDER BY wall_index',
      [src.rows[0].id]
    );
    for (const w of srcWalls.rows) {
      await client.query(
        `INSERT INTO floor_plan_walls
           (floor_plan_id, wall_index, wall_type, height, sheathing_override, drywall_override)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [dst.id, w.wall_index, w.wall_type, w.height, w.sheathing_override, w.drywall_override]
      );
    }
    await client.query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
    await client.query('COMMIT');
    const data = await loadFloorPlanFull(id, dst.id);
    res.json(data);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ---------------- Roof (Session 3) ----------------
const ROOF_FIELDS = [
  'width_ft', 'depth_ft', 'pitch', 'sheathing_type', 'rafter_spacing',
  'north_side', 'south_side', 'east_side', 'west_side', 'notes',
];

router.get('/:id/roof', async (req, res) => {
  const { id } = req.params;
  const { rows } = await query('SELECT * FROM roofs WHERE project_id = $1 ORDER BY id LIMIT 1', [id]);
  res.json(rows[0] || null);
});

router.post('/:id/roof', async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  if (b.width_ft == null || b.depth_ft == null) {
    return res.status(400).json({ error: 'width_ft and depth_ft required' });
  }
  const { rows } = await query(
    `INSERT INTO roofs (project_id, width_ft, depth_ft, pitch, sheathing_type, rafter_spacing,
                        north_side, south_side, east_side, west_side, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      id, b.width_ft, b.depth_ft,
      b.pitch || '6:12',
      b.sheathing_type || 'plywood_1_2_csp',
      b.rafter_spacing || '24_oc',
      b.north_side || 'gable', b.south_side || 'gable',
      b.east_side || 'gable', b.west_side || 'gable',
      b.notes || null,
    ]
  );
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.status(201).json(rows[0]);
});

router.put('/:id/roof', async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  const updates = {};
  for (const f of ROOF_FIELDS) {
    if (f in b) updates[f] = b[f] === '' ? null : b[f];
  }
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    const { rows } = await query('SELECT * FROM roofs WHERE project_id = $1 ORDER BY id LIMIT 1', [id]);
    return res.json(rows[0] || null);
  }
  const setParts = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => updates[k]);
  values.push(id);
  const { rows } = await query(
    `UPDATE roofs SET ${setParts}
     WHERE project_id = $${values.length}
     RETURNING *`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: 'no roof for project' });
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.json(rows[0]);
});

router.delete('/:id/roof', async (req, res) => {
  const { id } = req.params;
  await query('DELETE FROM roofs WHERE project_id = $1', [id]);
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.status(204).end();
});

// Material list — combined rollup of typed measurements + sketched walls
router.get('/:id/material-list', async (req, res) => {
  const { id } = req.params;

  // Existing measurement-based rollup (unchanged SQL)
  const measurementRollup = await query(`
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
  `, [id]);

  // Wall-based rollup
  const projectRow = (await query('SELECT * FROM projects WHERE id = $1', [id])).rows[0];
  if (!projectRow) return res.status(404).json({ error: 'not found' });
  const globalRow = (await query('SELECT * FROM settings WHERE id = 1')).rows[0];
  const walls = (await query('SELECT * FROM walls WHERE project_id = $1', [id])).rows;
  // Default settings (Floor 1) used by legacy walls fallback
  const settings = resolveProjectSettings(projectRow, globalRow, LEVELS.FLOOR1);

  // Prefer floor plans (new polygon flow). Fall back to legacy walls table if no floor plan exists.
  const fpRows = (await query(
    'SELECT * FROM floor_plans WHERE project_id = $1 ORDER BY id', [id]
  )).rows;

  let wallItems = [];
  if (fpRows.length > 0) {
    for (const fp of fpRows) {
      // Skip levels that produce no materials this session: foundation (M2) and roof (handled below)
      if (fp.level === LEVELS.FOUNDATION) continue;
      if (fp.level === LEVELS.ROOF) continue;
      // Floor 2 only counts on 2-storey projects
      if (fp.level === LEVELS.FLOOR2 && Number(projectRow.num_storeys) < 2) continue;
      const lvlSettings = resolveProjectSettings(projectRow, globalRow, fp.level);
      const fpWalls = (await query(
        'SELECT * FROM floor_plan_walls WHERE floor_plan_id = $1 ORDER BY wall_index',
        [fp.id]
      )).rows;
      const fpOpenings = (await query(
        `SELECT o.* FROM openings o
         JOIN floor_plan_walls fpw ON fpw.id = o.floor_plan_wall_id
         WHERE fpw.floor_plan_id = $1`,
        [fp.id]
      )).rows;
      wallItems.push(...computeFloorPlanMaterials(fp.corners || [], fpWalls, lvlSettings, fpOpenings, fp.level));
    }
  } else {
    // Legacy: use the walls table directly (floor 1 prefix)
    const openings = (await query(
      'SELECT * FROM openings WHERE project_id = $1 AND wall_id IS NOT NULL', [id]
    )).rows;
    const wallById = new Map(walls.map((w) => [w.id, w]));
    const openingsByWall = new Map();
    const enrichedOpenings = [];
    for (const o of openings) {
      if (!openingsByWall.has(o.wall_id)) openingsByWall.set(o.wall_id, []);
      openingsByWall.get(o.wall_id).push(o);
      enrichedOpenings.push({ ...o, wall_type: wallById.get(o.wall_id)?.wall_type });
    }
    for (const w of walls) {
      wallItems.push(...computeWallMaterials(w, settings, openingsByWall.get(w.id) || []));
    }
    wallItems.push(...computeProjectMaterials(walls, settings, enrichedOpenings));
  }

  // Roof items (Session 3)
  const roofRow = (await query(
    'SELECT * FROM roofs WHERE project_id = $1 ORDER BY id LIMIT 1', [id]
  )).rows[0];
  if (roofRow) wallItems.push(...computeRoofMaterials(roofRow));

  const wallRolled = sumMaterials(wallItems);

  // Lazy-create material rows for any wall-derived names not yet in the table.
  const wallWithIds = [];
  for (const item of wallRolled) {
    const matId = await ensureMaterial(item.name, item.unit);
    wallWithIds.push({
      material_id: matId,
      material_name: item.name,
      material_unit: item.unit,
      section: item.section,
      category: item.category,
      total_quantity: item.quantity,
    });
  }

  // Merge by (material_id, section, category). Typed-measurement rows have
  // section/category null so they merge on material_id alone.
  const merged = new Map();
  const mkKey = (matId, section, category) => `${matId}|${section ?? ''}|${category ?? ''}`;
  for (const r of measurementRollup.rows) {
    merged.set(mkKey(r.material_id, null, null), {
      material_id: r.material_id,
      material_name: r.material_name,
      material_unit: r.material_unit,
      section: null,
      category: null,
      total_quantity: Number(r.total_quantity),
    });
  }
  for (const r of wallWithIds) {
    const k = mkKey(r.material_id, r.section, r.category);
    const existing = merged.get(k);
    if (existing) existing.total_quantity += r.total_quantity;
    else merged.set(k, r);
  }

  const out = Array.from(merged.values())
    .map((r) => ({ ...r, total_quantity: Math.max(0, Math.ceil(r.total_quantity - 1e-9)) }))
    .sort((a, b) => {
      const ra = sectionRank(a.section);
      const rb = sectionRank(b.section);
      if (ra !== rb) return ra - rb;
      const ca = categoryRank(a.category);
      const cb = categoryRank(b.category);
      if (ca !== cb) return ca - cb;
      return a.material_name.localeCompare(b.material_name);
    });
  res.json(out);
});

export default router;
