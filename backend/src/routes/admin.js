// Admin-only routes for the GPT-4o fine-tuning training data collector.
// Mounted at /admin under authRequired + adminRequired.

import { Router } from 'express';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { query } from '../db.js';
import { r2, BUCKET } from '../r2.js';
import { launchPdfRenderer, renderPdfPageToPng } from '../pdfRender.js';

const router = Router();

// ---- helpers ----
async function fetchPdfFromR2(key) {
  const out = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of out.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function jsonOrNull(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

// ============================================================
// GET /admin/training-examples
// List all collected examples with summary metadata.
// ============================================================
router.get('/training-examples', async (req, res) => {
  const { rows } = await query(`
    SELECT
      id, project_id, project_name, floor_level, quality_rating, notes,
      created_by, created_at, pdf_filename,
      jsonb_array_length(COALESCE(interior_walls, '[]'::jsonb))
        + jsonb_array_length(COALESCE(exterior_polygon, '[]'::jsonb)) AS wall_count,
      jsonb_array_length(COALESCE(openings, '[]'::jsonb)) AS opening_count
    FROM training_examples
    ORDER BY created_at DESC
  `);
  res.json(rows);
});

// ============================================================
// DELETE /admin/training-examples/:id
// ============================================================
router.delete('/training-examples/:id', async (req, res) => {
  const { id } = req.params;
  const r = await query('DELETE FROM training_examples WHERE id = $1', [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

// ============================================================
// PUT /admin/training-examples/:id/rating
// Body: { quality_rating: 1-5 | null, notes: string }
// ============================================================
router.put('/training-examples/:id/rating', async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  const updates = {};
  if ('quality_rating' in b) {
    const v = b.quality_rating;
    if (v == null) updates.quality_rating = null;
    else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        return res.status(400).json({ error: 'quality_rating must be 1-5 or null' });
      }
      updates.quality_rating = n;
    }
  }
  if ('notes' in b) updates.notes = b.notes == null ? null : String(b.notes);
  const keys = Object.keys(updates);
  if (keys.length === 0) return res.status(400).json({ error: 'no fields provided' });
  const setParts = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = keys.map((k) => updates[k]);
  values.push(id);
  const { rows } = await query(
    `UPDATE training_examples SET ${setParts}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});

// ============================================================
// GET /admin/training-examples/stats
// ============================================================
router.get('/training-examples/stats', async (req, res) => {
  const totals = (await query(`
    SELECT
      COUNT(*) AS total,
      COUNT(DISTINCT project_id) FILTER (WHERE project_id IS NOT NULL) AS unique_projects,
      AVG(jsonb_array_length(COALESCE(interior_walls, '[]'::jsonb))) AS avg_walls,
      AVG(jsonb_array_length(COALESCE(openings, '[]'::jsonb))) AS avg_openings,
      COUNT(*) FILTER (WHERE quality_rating >= 3 OR quality_rating IS NULL) AS ready_for_export
    FROM training_examples
  `)).rows[0];
  const byFloor = (await query(`
    SELECT floor_level, COUNT(*) AS n FROM training_examples GROUP BY floor_level
  `)).rows;
  const byQuality = (await query(`
    SELECT
      COUNT(*) FILTER (WHERE quality_rating = 5) AS r5,
      COUNT(*) FILTER (WHERE quality_rating = 4) AS r4,
      COUNT(*) FILTER (WHERE quality_rating = 3) AS r3,
      COUNT(*) FILTER (WHERE quality_rating = 2) AS r2,
      COUNT(*) FILTER (WHERE quality_rating = 1) AS r1,
      COUNT(*) FILTER (WHERE quality_rating IS NULL) AS unrated
    FROM training_examples
  `)).rows[0];
  const total = Number(totals.total) || 0;
  res.json({
    total_examples: total,
    by_floor: Object.fromEntries(byFloor.map((r) => [r.floor_level, Number(r.n)])),
    by_quality: {
      5: Number(byQuality.r5), 4: Number(byQuality.r4), 3: Number(byQuality.r3),
      2: Number(byQuality.r2), 1: Number(byQuality.r1),
      unrated: Number(byQuality.unrated),
    },
    avg_walls_per_example: Number(totals.avg_walls) || 0,
    avg_openings_per_example: Number(totals.avg_openings) || 0,
    unique_projects: Number(totals.unique_projects) || 0,
    ready_for_export: Number(totals.ready_for_export) || 0,
    estimated_training_cost_usd: Number(totals.ready_for_export) * 0.008,
  });
});

// ============================================================
// GET /admin/training-examples/export
// Streams a JSONL file (one OpenAI fine-tuning message per line) so
// memory stays bounded — examples with deleted PDFs are skipped with a
// warning logged to the server.
// ============================================================
router.get('/training-examples/export', async (req, res) => {
  const { rows } = await query(`
    SELECT * FROM training_examples
    WHERE quality_rating >= 3 OR quality_rating IS NULL
    ORDER BY id
  `);

  const date = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/x-jsonlines; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="buildtek-training-${date}-${rows.length}examples.jsonl"`
  );
  // Prefix comment line (JSONL ignores non-JSON lines for OpenAI uploads;
  // they reject any non-JSON, so we don't actually write a comment here —
  // the summary lives in the response headers + filename instead).
  res.setHeader('X-BuildTek-Training-Count', String(rows.length));

  if (rows.length === 0) {
    return res.end();
  }

  const browser = await launchPdfRenderer();
  let written = 0;
  let skipped = 0;
  try {
    for (const ex of rows) {
      if (!ex.pdf_filename) { skipped++; continue; }
      let pdfBuffer;
      try {
        pdfBuffer = await fetchPdfFromR2(ex.pdf_filename);
      } catch (e) {
        console.warn(`[training-export] Skipped example ${ex.id}: PDF unavailable from R2 (${e.message})`);
        skipped++;
        continue;
      }
      let pngBuffer;
      try {
        pngBuffer = await renderPdfPageToPng(browser, pdfBuffer, { scale: 1.5 });
      } catch (e) {
        console.warn(`[training-export] Skipped example ${ex.id}: PDF render failed (${e.message})`);
        skipped++;
        continue;
      }
      const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;

      const building = jsonOrNull(ex.building_info) || {};
      const polygon = jsonOrNull(ex.exterior_polygon) || [];
      const interiorWalls = jsonOrNull(ex.interior_walls) || [];
      const openings = jsonOrNull(ex.openings) || [];

      // The frontend save endpoint stores openings as a single mixed array;
      // for the training target we split them by type for clearer signal.
      const exterior_doors = openings.filter((o) => o.type === 'door' && o.wall_kind !== 'interior');
      const interior_doors = openings.filter((o) => o.type === 'door' && o.wall_kind === 'interior');
      const windowsList    = openings.filter((o) => o.type === 'window');

      const assistantPayload = {
        building: {
          total_width_ft: building.total_width_ft ?? null,
          total_depth_ft: building.total_depth_ft ?? null,
          wall_type: building.wall_type ?? null,
          wall_height_ft: building.wall_height_ft ?? null,
          floor_area_sqft: building.floor_area_sqft ?? null,
        },
        exterior_polygon: polygon,
        interior_walls: interiorWalls,
        exterior_doors,
        interior_doors,
        windows: windowsList,
      };

      const userText =
        'You are an architectural floor plan reader. Extract the floor plan data from this drawing.\n\n' +
        'Return ONLY this JSON structure with no markdown:\n' +
        '{\n' +
        '  "building": { "total_width_ft", "total_depth_ft", "wall_type", "wall_height_ft", "floor_area_sqft" },\n' +
        '  "exterior_polygon": [{"x_ft", "y_ft"}],\n' +
        '  "interior_walls": [{"start_x_ft", "start_y_ft", "end_x_ft", "end_y_ft", "wall_type", "is_load_bearing"}],\n' +
        '  "exterior_doors": [{"label", "width_inches", "height_inches", "ro_width_inches", "ro_height_inches", "type", "quantity", "wall_side"}],\n' +
        '  "interior_doors": [{"label", "width_inches", "height_inches", "ro_width_inches", "ro_height_inches", "quantity"}],\n' +
        '  "windows": [{"label", "width_inches", "height_inches", "ro_width_inches", "ro_height_inches", "type", "quantity", "wall_side"}]\n' +
        '}\n\n' +
        'CRITICAL: Exclude decks, porches, and outdoor areas from the exterior polygon. Only include conditioned heated space.';

      const message = {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: dataUrl } },
              { type: 'text', text: userText },
            ],
          },
          { role: 'assistant', content: JSON.stringify(assistantPayload) },
        ],
      };

      res.write(JSON.stringify(message));
      res.write('\n');
      written++;
    }
  } finally {
    try { await browser.close(); } catch {}
  }
  res.end();
  console.log(`[training-export] Wrote ${written} examples (${skipped} skipped) for ${date}`);
});

// ============================================================
// GET /admin/ai-status
// What models are currently wired up. Shown in the admin panel header so
// the user knows whether requests will hit Claude or a fine-tuned GPT-4o.
// ============================================================
router.get('/ai-status', async (req, res) => {
  const claude_available = !!process.env.ANTHROPIC_API_KEY;
  const openai_available = !!process.env.OPENAI_API_KEY;
  const fine_tuned_model = process.env.OPENAI_FINE_TUNED_MODEL || null;
  const active_extractor = fine_tuned_model && openai_available
    ? 'fine-tuned-gpt4o'
    : claude_available
      ? 'claude-opus'
      : 'none';
  const r = await query('SELECT COUNT(*) AS n FROM training_examples');
  res.json({
    claude_available,
    openai_available,
    fine_tuned_model,
    active_extractor,
    training_examples_count: Number(r.rows[0]?.n) || 0,
  });
});

export default router;
