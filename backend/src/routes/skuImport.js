// SKU Catalog Excel import routes.
// Two-step flow: POST /preview (parses + classifies, no writes) →
// POST /confirm (re-parses, commits to sku_catalog inside a transaction,
// uploads the Excel to R2, logs the import).
//
// Multitenancy: today every UPDATE operates against the global
// sku_catalog table and the R2 key is hard-coded to 'sku-catalog/org-1/...'.
// TODOs throughout flag every single-tenant assumption so org-scoping
// later is a one-line filter add per spot.

import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { pool, query } from '../db.js';
import { adminRequired } from '../auth.js';
import { r2, BUCKET, PUBLIC_URL } from '../r2.js';

const router = Router();

const r2Configured = () => !!process.env.R2_ENDPOINT;

// TODO: replace 'org-1' with the active org's id when multitenancy is
// implemented. Key shape chosen so the swap is a one-line change.
const R2_LATEST_KEY = 'sku-catalog/org-1/latest.xlsx';
// Template Excel is uploaded once manually to R2 (Spencer drops it in
// via the Cloudflare dashboard or aws s3 cp). The app only links to
// it from the Defaults page download button.
const R2_TEMPLATE_KEY = 'sku-catalog/templates/BuildTek_SKU_Catalog_Template.xlsx';

// Sheets that aren't catalog data — skipped during parsing.
const SKIPPED_SHEETS = new Set(['Instructions', 'Summary']);

// Header labels exactly as they appear in the BuildTek onboarding Excel.
// If the store renames a header the importer surfaces a 400 with the
// "Excel format not recognised" message instead of silently mismatching.
const REQUIRED_HEADERS = [
  'Material / Description',
  'Catalog #',
  'Item #',
  'Full SKU Description',
  'Coverage per Unit',
  'Coverage Unit',
];
// 'Default? (Y/N)' is read for the preview UI but NOT written to DB
// (no is_default column on sku_catalog today).

// Multer config — mirrors pdfUpload in routes/projects.js exactly:
// memoryStorage, 25 MB cap, mime allowlist scoped to .xlsx. Some browsers
// report inconsistent mime types for xlsx files, so we accept the two
// common ones plus the .xlsx extension as a fallback.
const xlsxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
  fileFilter: (req, file, cb) => {
    const mt = file.mimetype || '';
    const okMime =
      mt === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mt === 'application/vnd.ms-excel' ||
      mt === 'application/octet-stream';
    const okExt = /\.xlsx$/i.test(file.originalname || '');
    if (!okMime && !okExt) {
      return cb(new Error('Please upload an Excel file (.xlsx)'));
    }
    cb(null, true);
  },
});

// ---------- Excel parsing ----------

function trimOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function parseYesNo(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'y' || s === 'yes' || s === 'true' || s === '1';
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Parse the buffer into a flat list of normalized rows + collect any
// per-sheet header validation errors. Returns { rows, error } — when
// `error` is set the caller should 400 with its message.
function parseWorkbook(buffer) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (e) {
    return { rows: [], error: 'Excel format not recognised — please use the BuildTek template' };
  }
  const rows = [];
  for (const sheetName of workbook.SheetNames) {
    if (SKIPPED_SHEETS.has(sheetName)) continue;
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    // header:1 → array-of-arrays so we can validate headers ourselves.
    const arr = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });
    if (!arr.length) continue;
    // Find the header row — first row containing "Catalog #". Some sheets
    // have a title/section row above the header.
    let headerIdx = -1;
    for (let i = 0; i < Math.min(arr.length, 10); i++) {
      const r = arr[i] || [];
      if (r.some((c) => typeof c === 'string' && c.trim() === 'Catalog #')) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) continue; // sheet doesn't have the expected layout — silently skip
    const headers = (arr[headerIdx] || []).map((h) => (h == null ? '' : String(h).trim()));
    // Validate that every required header is present in this sheet.
    for (const req of REQUIRED_HEADERS) {
      if (!headers.includes(req)) {
        return {
          rows: [],
          error: 'Excel format not recognised — please use the BuildTek template',
        };
      }
    }
    const colIdx = {
      material:    headers.indexOf('Material / Description'),
      catalog:     headers.indexOf('Catalog #'),
      item:        headers.indexOf('Item #'),
      fullDesc:    headers.indexOf('Full SKU Description'),
      coverageVal: headers.indexOf('Coverage per Unit'),
      coverageUnit: headers.indexOf('Coverage Unit'),
      isDefault:   headers.indexOf('Default? (Y/N)'), // optional
    };
    for (let i = headerIdx + 1; i < arr.length; i++) {
      const r = arr[i] || [];
      const material = trimOrNull(r[colIdx.material]);
      const catalog  = trimOrNull(r[colIdx.catalog]);
      // Need a material name to do anything with the row. Truly blank
      // rows are skipped here; rows with a material but no catalog # are
      // kept and surface as SKIPPED in classifyRows so the store sees a
      // count of how many SKUs they still need to fill in.
      if (!material) continue;
      rows.push({
        sheet: sheetName,
        material,
        catalog_number: catalog, // may be null → SKIPPED in classification
        item_number: trimOrNull(r[colIdx.item]),
        warehouse_description: trimOrNull(r[colIdx.fullDesc]),
        coverage_value: toNumberOrNull(r[colIdx.coverageVal]),
        coverage_unit: trimOrNull(r[colIdx.coverageUnit]),
        is_default: colIdx.isDefault >= 0 ? parseYesNo(r[colIdx.isDefault]) : false,
      });
    }
  }
  return { rows, error: null };
}

// Classify each parsed row against the current sku_catalog state.
// Returns enriched rows ({ ...parsed, status }) and a summary object.
//
// TODO: when sku_catalog becomes per-org, add `WHERE org_id = $1` to the
// SELECT below — this is the single point where the import resolves
// matches, so org-scoping is a one-query change.
async function classifyRows(parsedRows) {
  const skus = (await query('SELECT id, description, catalog_number FROM sku_catalog')).rows;
  const byDesc = new Map();
  for (const s of skus) {
    if (!s.description) continue;
    byDesc.set(s.description.trim().toLowerCase(), s);
  }
  const out = [];
  const summary = { new: 0, updates: 0, skipped: 0, unmatched: 0 };
  for (const r of parsedRows) {
    let status;
    if (!r.catalog_number) {
      // Store hasn't filled in this row's catalog # yet. Surface in the
      // skipped count so the store sees how many materials remain to fill,
      // but do not show in the preview table or write anything to DB.
      status = 'SKIPPED';
      summary.skipped++;
    } else {
      const sku = byDesc.get((r.material || '').trim().toLowerCase());
      if (!sku) {
        status = 'NO_MATCH';
        summary.unmatched++;
      } else if (sku.catalog_number == null || sku.catalog_number === '') {
        status = 'MATCH_NEW';
        summary.new++;
      } else {
        status = 'MATCH_UPDATE';
        summary.updates++;
      }
    }
    out.push({ ...r, status });
  }
  return { rows: out, summary };
}

// ---------- POST /preview ----------
// Admin-only. Parses the Excel, classifies rows, returns the preview
// payload. Does NOT touch the DB or R2.
router.post('/preview', adminRequired, (req, res) => {
  xlsxUpload.single('file')(req, res, async (err) => {
    if (err) {
      const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(code).json({ error: err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'Excel file required' });
    try {
      const { rows: parsed, error } = parseWorkbook(req.file.buffer);
      if (error) return res.status(400).json({ error });
      if (parsed.length === 0) {
        return res.status(400).json({
          error: 'No catalog numbers found — please fill in the Catalog # column and try again',
        });
      }
      const { rows, summary } = await classifyRows(parsed);
      // 400 when the entire Excel is unfilled — every row has a material
      // name but no catalog #. The store needs to fill in at least one
      // catalog number before there's anything to import.
      if (summary.new + summary.updates + summary.unmatched === 0) {
        return res.status(400).json({
          error: 'No catalog numbers found — please fill in the Catalog # column and try again',
        });
      }
      res.json({ rows, summary });
    } catch (e) {
      console.error('SKU preview failed:', e);
      res.status(500).json({ error: e.message || 'preview failed' });
    }
  });
});

// ---------- POST /confirm ----------
// Admin-only. Re-parses the Excel from scratch (does not trust a client-
// sent preview payload), commits MATCH_NEW + MATCH_UPDATE rows inside a
// transaction, uploads the file to R2, logs the import. R2 upload happens
// AFTER the DB commit; if R2 fails we log the error but the import row
// still records what got committed.
router.post('/confirm', adminRequired, (req, res) => {
  xlsxUpload.single('file')(req, res, async (err) => {
    if (err) {
      const code = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(code).json({ error: err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'Excel file required' });

    try {
      const { rows: parsed, error } = parseWorkbook(req.file.buffer);
      if (error) return res.status(400).json({ error });
      if (parsed.length === 0) {
        return res.status(400).json({
          error: 'No catalog numbers found — please fill in the Catalog # column and try again',
        });
      }
      const { rows: classified, summary } = await classifyRows(parsed);
      if (summary.new + summary.updates + summary.unmatched === 0) {
        return res.status(400).json({
          error: 'No catalog numbers found — please fill in the Catalog # column and try again',
        });
      }

      // Commit phase — transaction wraps every sku_catalog UPDATE so a
      // mid-batch failure rolls back cleanly. NO_MATCH and SKIPPED rows
      // are left alone.
      // TODO: when sku_catalog becomes per-org, add AND org_id = $N to
      // the WHERE clause so an org can't overwrite another org's mappings.
      const client = await pool.connect();
      let importedAt;
      let logRow;
      try {
        await client.query('BEGIN');
        for (const r of classified) {
          if (r.status !== 'MATCH_NEW' && r.status !== 'MATCH_UPDATE') continue;
          await client.query(
            `UPDATE sku_catalog SET
               catalog_number        = $1,
               item_number           = $2,
               warehouse_description = $3,
               coverage_value        = $4,
               coverage_unit         = $5
             WHERE LOWER(TRIM(description)) = LOWER(TRIM($6))`,
            [
              r.catalog_number,
              r.item_number,
              r.warehouse_description,
              r.coverage_value,
              r.coverage_unit,
              r.material,
            ]
          );
        }
        const ins = await client.query(
          `INSERT INTO sku_catalog_imports
             (r2_key, filename, imported_by, rows_matched, rows_updated, rows_skipped, rows_unmatched)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, imported_at`,
          [
            R2_LATEST_KEY,
            req.file.originalname || 'sku-catalog.xlsx',
            req.user?.id || null,
            summary.new + summary.updates,
            summary.updates,
            summary.skipped,
            summary.unmatched,
          ]
        );
        logRow = ins.rows[0];
        importedAt = logRow.imported_at;
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        console.error('SKU import commit failed:', txErr);
        return res.status(500).json({ error: txErr.message || 'commit failed' });
      } finally {
        client.release();
      }

      // R2 upload — after DB commit. If this fails the import is still
      // recorded (so download_url just won't resolve until a re-upload)
      // and we log the error but still return success to the client.
      if (r2Configured()) {
        try {
          await r2.send(new PutObjectCommand({
            Bucket: BUCKET,
            Key: R2_LATEST_KEY,
            Body: req.file.buffer,
            ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          }));
        } catch (r2Err) {
          console.error('R2 upload of SKU Excel failed (DB import already committed):', r2Err);
        }
      } else {
        console.warn('R2_ENDPOINT not set — SKU Excel not uploaded to R2');
      }

      res.json({
        success: true,
        summary,
        imported_at: importedAt,
      });
    } catch (e) {
      console.error('SKU confirm failed:', e);
      res.status(500).json({ error: e.message || 'confirm failed' });
    }
  });
});

// ---------- GET /latest ----------
// Auth required (any logged-in user). Returns the metadata for the most
// recent import + a 302-target download URL. No row → { exists: false }.
//
// TODO: when multitenancy lands, filter by org_id and also gate this to
// "any user belonging to the org" (not literally any logged-in user).
// A read-only view of this data would eventually live on a per-org
// onboarding/status page so non-admins can see mapping completeness
// without entering the admin Defaults page.
router.get('/latest', async (req, res) => {
  try {
    const r = await query(`
      SELECT i.id, i.r2_key, i.filename, i.imported_at,
             i.rows_matched, i.rows_updated, i.rows_skipped, i.rows_unmatched,
             u.username AS imported_by_username
      FROM sku_catalog_imports i
      LEFT JOIN users u ON u.id = i.imported_by
      ORDER BY i.imported_at DESC
      LIMIT 1
    `);
    const row = r.rows[0];
    if (!row) return res.json({ exists: false });
    // Cache-bust by appending the import timestamp — same pattern as the
    // PDF download in routes/projects.js. PUBLIC_URL is the configured
    // public R2 host (env R2_PUBLIC_URL).
    const v = encodeURIComponent(new Date(row.imported_at).getTime());
    const download_url = PUBLIC_URL ? `${PUBLIC_URL}/${row.r2_key}?v=${v}` : null;
    res.json({
      exists: true,
      filename: row.filename,
      imported_at: row.imported_at,
      imported_by_username: row.imported_by_username,
      rows_matched: row.rows_matched,
      rows_updated: row.rows_updated,
      rows_skipped: row.rows_skipped,
      rows_unmatched: row.rows_unmatched,
      download_url,
    });
  } catch (e) {
    console.error('GET /sku-import/latest failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ---------- GET /status ----------
// Auth required. Returns mapping completeness across the whole catalog.
//
// TODO: when multitenancy lands, filter by org_id so each org sees only
// their own catalog completeness.
router.get('/status', async (req, res) => {
  try {
    const r = await query(`
      SELECT
        COUNT(*)::INT AS total,
        COUNT(catalog_number)::INT AS mapped,
        (COUNT(*) - COUNT(catalog_number))::INT AS unmapped
      FROM sku_catalog
    `);
    const { total, mapped, unmapped } = r.rows[0];
    const percent_complete = total > 0 ? Math.round((mapped / total) * 100) : 0;
    res.json({ total, mapped, unmapped, percent_complete });
  } catch (e) {
    console.error('GET /sku-import/status failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ---------- GET /template ----------
// Returns a 302 redirect to the static onboarding template Excel in R2.
// The template must be uploaded to R2 once manually (Spencer drops it
// in via the Cloudflare dashboard at the key above) — the app just
// hands out the link.
router.get('/template', (req, res) => {
  if (!PUBLIC_URL) return res.status(503).json({ error: 'template URL not configured' });
  res.redirect(302, `${PUBLIC_URL}/${R2_TEMPLATE_KEY}`);
});

export default router;
