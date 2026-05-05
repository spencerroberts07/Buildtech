import { Router } from 'express';
import { query } from '../db.js';
import {
  computeWallMaterials,
  computeProjectMaterials,
  sumMaterials,
  resolveProjectSettings,
  sectionRank,
  categoryRank,
} from '../wallRules.js';
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
  const { rows } = await query(
    `INSERT INTO projects (name, customer, notes, num_storeys, floor2_wall_height, default_wall_height)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      name,
      customer || null,
      notes || null,
      num_storeys ?? 1,
      floor2_wall_height ?? 9,
      default_wall_height ?? null,
    ]
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
  'wall_id', 'type', 'rough_opening_width', 'rough_opening_height',
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
  if (!b.wall_id) return res.status(400).json({ error: 'wall_id required' });
  if (b.rough_opening_width == null || b.rough_opening_height == null) {
    return res.status(400).json({ error: 'rough_opening_width and rough_opening_height required' });
  }
  const type = b.type || 'window';
  if (!OPENING_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${OPENING_TYPES.join(', ')}` });
  }
  // Confirm wall belongs to project
  const wall = await query('SELECT id FROM walls WHERE id = $1 AND project_id = $2', [b.wall_id, id]);
  if (!wall.rows[0]) return res.status(400).json({ error: 'wall not found in this project' });
  const { rows } = await query(
    `INSERT INTO openings
       (project_id, wall_id, type, rough_opening_width, rough_opening_height, label, position_along_wall)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, b.wall_id, type, b.rough_opening_width, b.rough_opening_height,
     b.label || null, b.position_along_wall ?? 0.5],
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
  const settings = resolveProjectSettings(projectRow, globalRow);
  const walls = (await query('SELECT * FROM walls WHERE project_id = $1', [id])).rows;

  const openings = (await query(
    'SELECT * FROM openings WHERE project_id = $1', [id]
  )).rows;

  // Group openings by wall_id for per-wall calc; enrich with wall_type for project-level
  const wallById = new Map(walls.map((w) => [w.id, w]));
  const openingsByWall = new Map();
  const enrichedOpenings = [];
  for (const o of openings) {
    if (!openingsByWall.has(o.wall_id)) openingsByWall.set(o.wall_id, []);
    openingsByWall.get(o.wall_id).push(o);
    enrichedOpenings.push({ ...o, wall_type: wallById.get(o.wall_id)?.wall_type });
  }

  // Per-wall items + project-level rollups (housewrap, insulation, gasket, headers, shims, etc.)
  const wallItems = [];
  for (const w of walls) {
    wallItems.push(...computeWallMaterials(w, settings, openingsByWall.get(w.id) || []));
  }
  wallItems.push(...computeProjectMaterials(walls, settings, enrichedOpenings));
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
    .map((r) => ({ ...r, total_quantity: Math.ceil(r.total_quantity) }))
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
