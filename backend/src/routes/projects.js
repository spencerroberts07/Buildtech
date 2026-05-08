import { Router } from 'express';
import multer from 'multer';
import { PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { query } from '../db.js';
import {
  computeWallMaterials,
  computeProjectMaterials,
  computeFloorPlanMaterials,
  computeRoofMaterials,
  buildFloorPlanWalls,
  sumMaterials,
  resolveProjectSettings,
  sectionFor,
  sectionRank,
  categoryRank,
  LEVELS,
} from '../wallRules.js';
import { pool } from '../db.js';
import { ensureMaterial } from '../materialUpsert.js';
import { r2, BUCKET, PUBLIC_URL } from '../r2.js';
import { computeProjectMaterialList } from '../materialListBuilder.js';

const r2Configured = () => !!process.env.R2_ENDPOINT;
const pdfKey = (projectId) => `projects/${projectId}/plan.pdf`;

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are allowed'));
    }
    cb(null, true);
  },
});

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
  'pdf_scale',
  'pdf_page',
  'pdf_filename',
  'ceiling_drywall_type',
  'price_level',
];

const WALL_TYPES = ['exterior_2x6', 'interior_2x4', 'interior_2x6'];
const WALL_FIELDS = [
  'x1', 'y1', 'x2', 'y2',
  'height', 'wall_type',
  'sheathing_override', 'drywall_override',
  'extra_corner_studs',
];

router.get('/', async (req, res) => {
  const { rows } = await query(`
    SELECT p.id, p.name, p.customer, p.customer_id, p.notes, p.num_storeys,
           p.created_by, p.created_at, p.updated_at,
           c.name AS customer_name
    FROM projects p
    LEFT JOIN customers c ON c.id = p.customer_id
    ORDER BY p.updated_at DESC
  `);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const p = await query(`
    SELECT p.*, c.name AS customer_name
    FROM projects p
    LEFT JOIN customers c ON c.id = p.customer_id
    WHERE p.id = $1
  `, [id]);
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
  const { name, customer, customer_id, notes, num_storeys, floor2_wall_height, default_wall_height } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const storeys = Number(num_storeys ?? 1);
  const createdBy = req.user?.username || null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const proj = await client.query(
      `INSERT INTO projects (name, customer, customer_id, notes, num_storeys, floor2_wall_height, default_wall_height, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, customer || null, customer_id || null, notes || null, storeys,
       floor2_wall_height ?? 9, default_wall_height ?? null, createdBy]
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
  const b = req.body || {};
  const fields = ['name', 'customer', 'customer_id', 'notes'];
  const updates = {};
  for (const f of fields) {
    if (f in b) updates[f] = b[f] === '' ? null : b[f];
  }
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    const { rows } = await query('SELECT * FROM projects WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    return res.json(rows[0]);
  }
  const setParts = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => updates[k]);
  values.push(id);
  const { rows } = await query(
    `UPDATE projects SET ${setParts}, updated_at = NOW()
     WHERE id = $${values.length}
     RETURNING *`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  // Best-effort PDF cleanup before the row goes.
  if (r2Configured()) {
    try {
      const r = await query('SELECT pdf_filename FROM projects WHERE id = $1', [id]);
      const key = r.rows[0]?.pdf_filename;
      if (key) {
        try { await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })); } catch {}
      }
    } catch {}
  }
  await query('DELETE FROM projects WHERE id=$1', [id]);
  res.status(204).end();
});

// ---------------- PDF underlay (Cloudflare R2) ----------------
router.post('/:id/upload-pdf', (req, res) => {
  pdfUpload.single('pdf')(req, res, async (err) => {
    if (err) {
      const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(code).json({ error: err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'pdf file required' });
    if (!r2Configured()) {
      console.warn('R2_ENDPOINT not set — PDF storage not configured');
      return res.status(503).json({ error: 'PDF storage not configured' });
    }
    const { id } = req.params;
    try {
      const exists = await query('SELECT id FROM projects WHERE id = $1', [id]);
      if (!exists.rows[0]) return res.status(404).json({ error: 'project not found' });
      const key = pdfKey(id);
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: req.file.buffer,
        ContentType: 'application/pdf',
      }));
      const { rows } = await query(
        `UPDATE projects SET pdf_filename = $1, pdf_page = 1, updated_at = NOW()
         WHERE id = $2 RETURNING id, pdf_filename, pdf_scale, pdf_page, updated_at`,
        [key, id]
      );
      res.status(201).json(rows[0]);
    } catch (e) {
      console.error('R2 upload failed:', e);
      res.status(500).json({ error: e.message });
    }
  });
});

router.get('/:id/pdf', async (req, res) => {
  const { id } = req.params;
  const r = await query('SELECT pdf_filename, updated_at FROM projects WHERE id = $1', [id]);
  const key = r.rows[0]?.pdf_filename;
  if (!key) return res.status(404).json({ error: 'no pdf uploaded' });
  if (!r2Configured()) return res.status(503).json({ error: 'PDF storage not configured' });
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') {
      return res.status(404).json({ error: 'pdf_missing' });
    }
    console.error('R2 head failed:', e);
    return res.status(500).json({ error: 'pdf storage error' });
  }
  // Cache-bust on the static R2 key by appending the project's updated_at.
  const v = encodeURIComponent(new Date(r.rows[0].updated_at).getTime());
  res.redirect(302, `${PUBLIC_URL}/${key}?v=${v}`);
});

router.delete('/:id/pdf', async (req, res) => {
  const { id } = req.params;
  const r = await query('SELECT pdf_filename FROM projects WHERE id = $1', [id]);
  const key = r.rows[0]?.pdf_filename;
  if (key && r2Configured()) {
    try { await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })); } catch (e) {
      console.error('R2 delete failed:', e);
    }
  }
  await query(
    `UPDATE projects SET pdf_filename = NULL, pdf_scale = NULL, pdf_page = 1, updated_at = NOW()
     WHERE id = $1`,
    [id]
  );
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
const FLOOR_PLAN_WALL_FIELDS = ['wall_type', 'height', 'sheathing_override', 'drywall_override', 'on_concrete'];
const INTERIOR_WALL_TYPES = new Set(['interior_2x4', 'interior_2x6']);
const INTERIOR_WALL_FIELDS = ['x1', 'y1', 'x2', 'y2', 'wall_type', 'height', 'on_concrete', 'sheathing_override', 'drywall_override', 'interior_wall_type_label'];
const FLOOR_PLAN_PUT_EXTRA_FIELDS = ['drawing_phase'];

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
  const interiorWalls = await query(
    'SELECT * FROM floor_plan_interior_walls WHERE floor_plan_id = $1 ORDER BY id',
    [fpId]
  );
  return {
    ...fp.rows[0],
    walls: walls.rows,
    openings: openings.rows,
    interior_walls: interiorWalls.rows,
  };
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

// PUT — replaces the corners array (if provided) and/or updates drawing_phase.
// When corners is provided, reconciles floor_plan_walls rows: keeps existing rows
// for indices that still exist, adds new default rows for new indices, deletes rows whose
// index is now out of range. Openings on deleted walls cascade.
router.put('/:id/floor-plans/:fpid', async (req, res) => {
  const { id, fpid } = req.params;
  const body = req.body || {};
  const corners = Array.isArray(body.corners) ? body.corners : null;
  const drawingPhase = body.drawing_phase;
  if (corners == null && drawingPhase == null) {
    return res.status(400).json({ error: 'corners array or drawing_phase required' });
  }
  if (drawingPhase != null && drawingPhase !== 'exterior' && drawingPhase !== 'interior') {
    return res.status(400).json({ error: "drawing_phase must be 'exterior' or 'interior'" });
  }

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
    if (drawingPhase != null) {
      await client.query(
        `UPDATE floor_plans SET drawing_phase = $1, updated_at = NOW() WHERE id = $2`,
        [drawingPhase, fpid]
      );
    }
    if (corners == null) {
      await client.query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
      await client.query('COMMIT');
      const data = await loadFloorPlanFull(id, fpid);
      return res.json(data);
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
    // Auto-calc enclosed floor area (shoelace) → cache on this floor_plans row AND
    // on the matching floors row. We use scale_ft_per_grid (project-level scale) to
    // convert grid² → ft².
    if (corners.length >= 3) {
      const proj = await client.query('SELECT scale_ft_per_grid FROM projects WHERE id = $1', [id]);
      const sft = Number(proj.rows[0]?.scale_ft_per_grid) || 1;
      let acc = 0;
      for (let i = 0; i < corners.length; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % corners.length];
        acc += (Number(a.x) * Number(b.y) - Number(b.x) * Number(a.y));
      }
      const areaSf = Math.abs(acc) / 2 * (sft * sft);
      const lvl = fp.rows[0].level || 'floor1';
      // Cache on this floor_plans row.
      await client.query(
        'UPDATE floor_plans SET auto_floor_area_sf = $1 WHERE id = $2',
        [areaSf, fpid]
      );
      // Mirror onto the matching floors row if one exists.
      const f = await client.query(
        'SELECT id FROM floors WHERE project_id = $1 AND level = $2 ORDER BY id LIMIT 1',
        [id, lvl]
      );
      if (f.rows[0]) {
        await client.query(
          'UPDATE floors SET auto_floor_area_sf = $1 WHERE id = $2',
          [areaSf, f.rows[0].id]
        );
      } else {
        // Don't auto-create the row — only update if the user has already created a floor.
        // (Avoids cluttering projects that don't want floor materials.)
      }
    } else {
      // Polygon dropped below 3 corners — clear the cached area.
      await client.query(
        'UPDATE floor_plans SET auto_floor_area_sf = NULL WHERE id = $1',
        [fpid]
      );
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

// ---------------- Interior walls (independent line segments) ----------------
async function ensureFloorPlanBelongsToProject(fpid, projectId) {
  const { rows } = await query(
    'SELECT id FROM floor_plans WHERE id = $1 AND project_id = $2',
    [fpid, projectId]
  );
  return rows.length > 0;
}

router.get('/:id/floor-plans/:fpid/interior-walls', async (req, res) => {
  const { id, fpid } = req.params;
  if (!(await ensureFloorPlanBelongsToProject(fpid, id))) {
    return res.status(404).json({ error: 'floor plan not found' });
  }
  const { rows } = await query(
    'SELECT * FROM floor_plan_interior_walls WHERE floor_plan_id = $1 ORDER BY id',
    [fpid]
  );
  res.json(rows);
});

router.post('/:id/floor-plans/:fpid/interior-walls', async (req, res) => {
  const { id, fpid } = req.params;
  const b = req.body || {};
  if (b.x1 == null || b.y1 == null || b.x2 == null || b.y2 == null) {
    return res.status(400).json({ error: 'x1, y1, x2, y2 required' });
  }
  const wallType = b.wall_type || 'interior_2x4';
  if (!INTERIOR_WALL_TYPES.has(wallType)) {
    return res.status(400).json({ error: `wall_type must be one of: ${[...INTERIOR_WALL_TYPES].join(', ')}` });
  }
  if (!(await ensureFloorPlanBelongsToProject(fpid, id))) {
    return res.status(404).json({ error: 'floor plan not found' });
  }
  const { rows } = await query(
    `INSERT INTO floor_plan_interior_walls
       (floor_plan_id, x1, y1, x2, y2, wall_type, height, on_concrete, sheathing_override, drywall_override, interior_wall_type_label)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      fpid, b.x1, b.y1, b.x2, b.y2,
      wallType, b.height ?? null, !!b.on_concrete,
      b.sheathing_override ?? null, b.drywall_override ?? null,
      b.interior_wall_type_label ?? null,
    ]
  );
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.status(201).json(rows[0]);
});

router.put('/:id/floor-plans/:fpid/interior-walls/:iwid', async (req, res) => {
  const { id, fpid, iwid } = req.params;
  const b = req.body || {};
  const updates = {};
  for (const f of INTERIOR_WALL_FIELDS) {
    if (f in b) {
      if (f === 'wall_type' && !INTERIOR_WALL_TYPES.has(b[f])) {
        return res.status(400).json({ error: 'invalid wall_type for interior wall' });
      }
      updates[f] = b[f] === '' ? null : b[f];
    }
  }
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    const { rows } = await query(
      `SELECT iw.* FROM floor_plan_interior_walls iw
       JOIN floor_plans fp ON fp.id = iw.floor_plan_id
       WHERE iw.id = $1 AND iw.floor_plan_id = $2 AND fp.project_id = $3`,
      [iwid, fpid, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    return res.json(rows[0]);
  }
  const setParts = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => updates[k]);
  values.push(iwid, fpid, id);
  const { rows } = await query(
    `UPDATE floor_plan_interior_walls SET ${setParts}
     WHERE id = $${values.length - 2} AND floor_plan_id = $${values.length - 1}
       AND floor_plan_id IN (SELECT id FROM floor_plans WHERE project_id = $${values.length})
     RETURNING *`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.json(rows[0]);
});

router.delete('/:id/floor-plans/:fpid/interior-walls/:iwid', async (req, res) => {
  const { id, fpid, iwid } = req.params;
  const { rowCount } = await query(
    `DELETE FROM floor_plan_interior_walls iw
     USING floor_plans fp
     WHERE iw.floor_plan_id = fp.id
       AND fp.project_id = $1
       AND iw.floor_plan_id = $2
       AND iw.id = $3`,
    [id, fpid, iwid]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'not found' });
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.status(204).end();
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

// ---------------- Packages (line items quoted separately) ----------------
const PACKAGE_FIELDS = ['name', 'package_type', 'notes', 'quantity', 'unit'];

router.get('/:id/packages', async (req, res) => {
  const { id } = req.params;
  const { rows } = await query(
    'SELECT * FROM packages WHERE project_id = $1 ORDER BY id', [id]
  );
  res.json(rows);
});

router.post('/:id/packages', async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) {
    return res.status(400).json({ error: 'name required' });
  }
  const { rows } = await query(
    `INSERT INTO packages (project_id, name, package_type, notes, quantity, unit)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      id,
      String(b.name).trim(),
      b.package_type || 'custom',
      b.notes || null,
      b.quantity != null ? Number(b.quantity) : 1,
      b.unit || 'PKG',
    ]
  );
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.status(201).json(rows[0]);
});

router.put('/:id/packages/:pid', async (req, res) => {
  const { id, pid } = req.params;
  const b = req.body || {};
  const updates = {};
  for (const f of PACKAGE_FIELDS) {
    if (f in b) updates[f] = b[f] === '' ? null : b[f];
  }
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    const { rows } = await query(
      'SELECT * FROM packages WHERE id = $1 AND project_id = $2', [pid, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    return res.json(rows[0]);
  }
  const setParts = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => updates[k]);
  values.push(pid, id);
  const { rows } = await query(
    `UPDATE packages SET ${setParts}
     WHERE id = $${values.length - 1} AND project_id = $${values.length}
     RETURNING *`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.json(rows[0]);
});

router.delete('/:id/packages/:pid', async (req, res) => {
  const { id, pid } = req.params;
  await query('DELETE FROM packages WHERE id = $1 AND project_id = $2', [pid, id]);
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.status(204).end();
});

// ---------------- Floor (singleton per project) ----------------
const FLOOR_FIELDS = ['floor_area_sf', 'subfloor_type', 'level', 'notes'];

router.get('/:id/floor', async (req, res) => {
  const { id } = req.params;
  const { rows } = await query(
    'SELECT * FROM floors WHERE project_id = $1 ORDER BY id LIMIT 1', [id]
  );
  res.json(rows[0] || null);
});

router.post('/:id/floor', async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  if (b.floor_area_sf == null) {
    return res.status(400).json({ error: 'floor_area_sf required' });
  }
  const { rows } = await query(
    `INSERT INTO floors (project_id, level, floor_area_sf, subfloor_type, notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [id, b.level || 'floor1', Number(b.floor_area_sf), b.subfloor_type || '58tgcsp', b.notes || null]
  );
  // Auto-create a "Floor Package" line item if one doesn't already exist for this project.
  const existing = await query(
    `SELECT id FROM packages WHERE project_id = $1 AND package_type = 'floor' LIMIT 1`,
    [id]
  );
  if (existing.rowCount === 0) {
    await query(
      `INSERT INTO packages (project_id, name, package_type, quantity, unit)
       VALUES ($1, 'Floor Package', 'floor', 1, 'PKG')`,
      [id]
    );
  }
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.status(201).json(rows[0]);
});

router.put('/:id/floor', async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  const updates = {};
  for (const f of FLOOR_FIELDS) {
    if (f in b) updates[f] = b[f] === '' ? null : b[f];
  }
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    const { rows } = await query('SELECT * FROM floors WHERE project_id = $1 ORDER BY id LIMIT 1', [id]);
    return res.json(rows[0] || null);
  }
  const setParts = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => updates[k]);
  values.push(id);
  const { rows } = await query(
    `UPDATE floors SET ${setParts}
     WHERE project_id = $${values.length}
     RETURNING *`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: 'no floor for project' });
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.json(rows[0]);
});

router.delete('/:id/floor', async (req, res) => {
  const { id } = req.params;
  await query('DELETE FROM floors WHERE project_id = $1', [id]);
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.status(204).end();
});

// ---------------- Material overrides (per-project SKU substitutions) ----------------
router.get('/:id/overrides', async (req, res) => {
  const { id } = req.params;
  const { rows } = await query(
    'SELECT * FROM material_overrides WHERE project_id = $1 ORDER BY id', [id]
  );
  res.json(rows);
});

router.post('/:id/overrides', async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  const original = (b.original_description || '').trim();
  const override = (b.override_description || '').trim();
  if (!original || !override) {
    return res.status(400).json({ error: 'original_description and override_description required' });
  }
  const { rows } = await query(
    `INSERT INTO material_overrides (project_id, original_description, override_description)
     VALUES ($1, $2, $3)
     ON CONFLICT (project_id, original_description)
     DO UPDATE SET override_description = EXCLUDED.override_description, created_at = NOW()
     RETURNING *`,
    [id, original, override]
  );
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.status(201).json(rows[0]);
});

router.delete('/:id/overrides/:oid', async (req, res) => {
  const { id, oid } = req.params;
  await query(
    'DELETE FROM material_overrides WHERE id = $1 AND project_id = $2',
    [oid, id]
  );
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.status(204).end();
});

// ---------------- Material deletions (per-row hide-from-list) ----------------
router.get('/:id/deletions', async (req, res) => {
  const { id } = req.params;
  const { rows } = await query(
    'SELECT * FROM material_deletions WHERE project_id = $1 ORDER BY id', [id]
  );
  res.json(rows);
});

router.post('/:id/deletions', async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  const desc = (b.description || '').trim();
  const section = (b.section || '').trim();
  if (!desc || !section) return res.status(400).json({ error: 'description and section required' });
  const { rows } = await query(
    `INSERT INTO material_deletions (project_id, description, section)
     VALUES ($1, $2, $3)
     ON CONFLICT (project_id, description, section) DO UPDATE SET created_at = NOW()
     RETURNING *`,
    [id, desc, section]
  );
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.status(201).json(rows[0]);
});

router.delete('/:id/deletions/:did', async (req, res) => {
  const { id, did } = req.params;
  await query(
    'DELETE FROM material_deletions WHERE id = $1 AND project_id = $2',
    [did, id]
  );
  await query('UPDATE projects SET updated_at = NOW() WHERE id = $1', [id]);
  res.status(204).end();
});

// Material list — combined rollup of typed measurements + sketched walls.
// Implementation lives in ../materialListBuilder.js so the quote builder can reuse it.
router.get('/:id/material-list', async (req, res) => {
  const { id } = req.params;
  const includeDeleted = req.query.include_deleted === '1' || req.query.include_deleted === 'true';
  const filtered = await computeProjectMaterialList(id, { includeDeleted });
  if (filtered === null) return res.status(404).json({ error: 'not found' });
  res.json(filtered);
});


export default router;
