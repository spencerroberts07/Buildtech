// AI-powered floor plan extraction.
//
// The pipeline is split into THREE focused, sequential Claude calls — each
// with one well-defined job. This is more reliable than asking a single call
// to produce a giant nested JSON for everything; the model can devote full
// reasoning + token budget to one task at a time, and partial failures
// degrade gracefully (e.g. schedules-call failure → empty doors/windows
// but exterior polygon + interior walls still work).
//
// CALL 1 — door + window SCHEDULES (table reading, no spatial work)
// CALL 2 — exterior POLYGON only (conditioned space only — exclude decks)
// CALL 3 — interior WALLS (given the polygon dims from call 2)
//
// Merged result matches the shape the frontend modal expects (a floors[]
// wrapper around { building, exterior_polygon, interior_walls, doors,
// windows, roof, ... }). The merge defaults wall_side/position_fraction
// to null for now — placement on specific exterior walls happens manually
// after the apply (those rows show up in the modal's "could not be placed"
// section).

import Anthropic from '@anthropic-ai/sdk';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { r2, BUCKET } from './r2.js';

const MODEL = 'claude-opus-4-5';
const TIMEOUT_MS = 60_000; // applied per Claude call; 3 calls × 60s = 180s worst case

export function aiConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

// ============================================================
// Prompts — one per call
// ============================================================

const SYSTEM_SCHEDULES =
  'You are an expert at reading architectural drawing schedules. ' +
  'Extract data from tables exactly as written. ' +
  'Return ONLY valid JSON with no markdown.';

const USER_SCHEDULES = `Find the DOOR SCHEDULE and WINDOW SCHEDULE tables in this architectural drawing set. These are usually on a notes/schedule page.

Return this exact JSON:
{
  "door_schedule": [
    {
      "label": string,
      "quantity": number,
      "floor": number,
      "width_inches": number,
      "height_inches": number,
      "ro_width_inches": number|null,
      "ro_height_inches": number|null,
      "description": string,
      "is_exterior": boolean,
      "comments": string|null
    }
  ],
  "window_schedule": [
    {
      "label": string,
      "quantity": number,
      "floor": number,
      "width_inches": number,
      "height_inches": number,
      "ro_width_inches": number|null,
      "ro_height_inches": number|null,
      "description": string,
      "comments": string|null
    }
  ]
}

For "is_exterior": set true when the DESCRIPTION column contains any of "EXT.", "EXTERIOR", "SLIDER", "PATIO", or "GLASS PANEL". Otherwise false.

Read the RO (rough opening) column carefully — it may be formatted as 32 1/2"×83 1/2" or similar. Convert fractions to decimals.

If no schedules are found, return { "door_schedule": [], "window_schedule": [] }.`;

const SYSTEM_POLYGON =
  'You are an expert at reading architectural floor plans. ' +
  'Your only job is to identify the exact outline of the heated/conditioned living space. ' +
  'Return ONLY valid JSON with no markdown.';

const USER_POLYGON = `Look at the FLOOR PLAN page (usually labeled 'GROUND FLOOR PLAN' or 'FLOOR PLAN'). Find the plan scale (e.g. 1/8" = 1'-0").

Your task: Identify the exterior wall outline of the CONDITIONED LIVING SPACE ONLY.

CRITICAL EXCLUSION RULES — these must NEVER be included in the polygon:
1. DECKS — areas labeled "DECK", "COMPOSITE DECKING", or showing deck railings/guards. Decks attach to the outside of the building.
2. PORCHES — covered or uncovered entry porches.
3. CARPORTS or GARAGES — unless they share a heated wall, and even then trace only the heated envelope.
4. Any outdoor area even if it touches the building walls.

HOW TO IDENTIFY THE BUILDING OUTLINE:
- The exterior walls are drawn as thick double lines (representing the wall thickness).
- Look for the heated rooms: bedrooms, kitchen, living room, bathroom, office, sunroom.
- The building outline connects all exterior wall faces.
- Dimension strings along the perimeter show the distances between corners.

EXAMPLE — Mitro Residence:
- The overall dimensions shown on the title block are 47'-0" wide × 35'-0" deep.
- BUT the 35'-0" dimension INCLUDES the rear deck (approximately 8'-0" deep).
- The HOUSE itself is approximately 47'-0" wide × 27'-0" deep.
- A SUN ROOM on one side is part of the conditioned space (include it).
- The DECK areas labeled as such are NOT part of the conditioned space (exclude them).

Return the exterior polygon as corners starting from top-left going clockwise. Each corner has x_ft, y_ft (feet from top-left origin) AND x_fraction, y_fraction (fraction of building bounding box):

{
  "scale": string,
  "total_width_ft": number,
  "total_depth_ft": number,
  "wall_type": "2x4"|"2x6",
  "wall_height_ft": number,
  "floor_area_sqft": number|null,
  "exterior_polygon": [
    { "x_ft": number, "y_ft": number, "x_fraction": number, "y_fraction": number, "label": string|null }
  ],
  "deck_excluded": string,
  "confidence": "high"|"medium"|"low",
  "notes": string
}

If you excluded any deck/porch/garage, describe what you excluded in the "deck_excluded" field (e.g. "Rear deck 47'×8' and front entry porch 8'×6'"). If nothing was excluded, set it to "".

If any value cannot be determined, use null. Do not guess.`;

const SYSTEM_WALLS =
  'You are an expert at reading architectural floor plans. ' +
  'Extract interior wall positions accurately. ' +
  'Return ONLY valid JSON with no markdown.';

function userWallsPrompt({ totalWidthFt, totalDepthFt }) {
  return `Look at the FLOOR PLAN page. The exterior building outline is ${totalWidthFt}ft wide × ${totalDepthFt}ft deep.

Extract all INTERIOR PARTITION WALLS from the floor plan. For each wall:
1. Measure its START and END position using the room dimensions printed on the plan.
2. Express positions as both feet from the top-left corner AND as a fraction (0.0 to 1.0) of the building width/depth.
3. Determine wall type: ONLY use "interior_2x6" if the wall is explicitly labeled "2x6 LOAD BEARING" or a similar structural note. Default ALL other interior walls to "interior_2x4".

Also read the BUILDING SECTION drawing (if present) to determine wall height.

Return:
{
  "wall_height_ft": number,
  "interior_walls": [
    {
      "start_x_ft": number,
      "start_y_ft": number,
      "end_x_ft": number,
      "end_y_ft": number,
      "start_x_fraction": number,
      "start_y_fraction": number,
      "end_x_fraction": number,
      "end_y_fraction": number,
      "wall_type": "interior_2x4"|"interior_2x6",
      "is_load_bearing": boolean,
      "room_label": string
    }
  ],
  "floors_detected": [
    { "floor_level": "floor1"|"floor2", "page_label": string }
  ]
}

If any value cannot be determined, use null.`;
}

// ============================================================
// Helpers
// ============================================================

async function fetchR2Object(key) {
  const out = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of out.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Parse the model's text response, tolerating common wrapping issues
// (markdown fences, leading prose, trailing prose). Returns null on
// failure; callers decide whether the failure is fatal.
function parseClaudeJson(rawText) {
  if (!rawText) return null;
  let text = String(rawText).trim();
  text = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  text = text.slice(first, last + 1);
  try { return JSON.parse(text); } catch { return null; }
}

async function callClaude(client, documentBlocks, systemPrompt, userPrompt, maxTokens) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const message = await client.messages.create(
      {
        model: MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [...documentBlocks, { type: 'text', text: userPrompt }],
        }],
      },
      { signal: abort.signal }
    );
    const textBlock = (message.content || []).find((b) => b.type === 'text');
    return textBlock?.text || '';
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// Merge — turn three call outputs into the modal-ready shape
// ============================================================

function mergeExtraction(schedules, polygon, walls) {
  const door_schedule = Array.isArray(schedules?.door_schedule) ? schedules.door_schedule : [];
  const window_schedule = Array.isArray(schedules?.window_schedule) ? schedules.window_schedule : [];

  const exterior_doors = door_schedule.filter((d) => d.is_exterior).map((d) => ({
    label: d.label,
    width_inches: d.width_inches,
    height_inches: d.height_inches,
    ro_width_inches: d.ro_width_inches,
    ro_height_inches: d.ro_height_inches,
    type: String(d.description || '').toLowerCase().includes('slider') ? 'slider' : 'hinged',
    quantity: d.quantity || 1,
    wall_side: null,
    position_fraction: null,
  }));

  const interior_doors = door_schedule.filter((d) => !d.is_exterior).map((d) => ({
    label: d.label,
    width_inches: d.width_inches,
    height_inches: d.height_inches,
    ro_width_inches: d.ro_width_inches,
    ro_height_inches: d.ro_height_inches,
    quantity: d.quantity || 1,
    interior_wall_hint: null,
  }));

  const windows = window_schedule.map((w) => {
    const desc = String(w.description || '').toLowerCase();
    const type = desc.includes('casement') ? 'casement'
      : desc.includes('fixed') ? 'fixed'
      : desc.includes('slider') ? 'slider'
      : 'single';
    return {
      label: w.label,
      width_inches: w.width_inches,
      height_inches: w.height_inches,
      ro_width_inches: w.ro_width_inches,
      ro_height_inches: w.ro_height_inches,
      type,
      quantity: w.quantity || 1,
      wall_side: null,
      position_fraction: null,
    };
  });

  const numStoreys = Array.isArray(walls?.floors_detected) && walls.floors_detected.length > 0
    ? walls.floors_detected.length
    : 1;
  const wallHeight = walls?.wall_height_ft || polygon?.wall_height_ft || 9;
  const notesParts = [polygon?.notes, polygon?.deck_excluded].filter(Boolean);
  const warnings = polygon?.deck_excluded ? [`Excluded: ${polygon.deck_excluded}`] : [];

  const merged = {
    building: {
      total_width_ft: polygon?.total_width_ft,
      total_depth_ft: polygon?.total_depth_ft,
      wall_type: polygon?.wall_type,
      wall_height_ft: wallHeight,
      num_storeys: numStoreys,
      floor_area_sqft: polygon?.floor_area_sqft ?? null,
    },
    exterior_polygon: polygon?.exterior_polygon || [],
    interior_walls: walls?.interior_walls || [],
    exterior_doors,
    interior_doors,
    windows,
    roof: { pitch: null, truss_spacing_inches: 24 },
    confidence: polygon?.confidence || 'medium',
    notes: notesParts.join(' | '),
    warnings,
    floors_detected: walls?.floors_detected || [{ floor_level: 'floor1', label: 'Ground Floor Plan' }],
  };
  return normalizeExtraction(merged);
}

// Wrap a flat response in the floors[] shape the modal expects. Idempotent.
export function normalizeExtraction(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  if (Array.isArray(parsed.floors) && parsed.floors.length > 0) return parsed;
  return {
    ...parsed,
    floors_detected: parsed.floors_detected || [{
      floor_level: 'floor1', page_number: null, label: 'Ground Floor Plan',
    }],
    floors: [{
      floor_level: 'floor1',
      page_number: null,
      exterior_polygon: parsed.exterior_polygon || [],
      interior_walls:   parsed.interior_walls   || [],
      exterior_doors:   parsed.exterior_doors   || [],
      interior_doors:   parsed.interior_doors   || [],
      windows:          parsed.windows          || [],
    }],
  };
}

// ============================================================
// Main entry — run all three calls + merge
// ============================================================

/**
 * Run the floor-plan extraction. Pass the R2 keys of the PDFs to include.
 * At least one is required.
 *
 * Returns { data, error }:
 * - data: normalized merged extraction with floors[] shape
 * - error: human-readable message when extraction had a hard failure (only
 *   when the polygon call fails — partial failures on schedules/walls
 *   degrade silently to empty arrays)
 */
export async function extractFloorPlan({ architecturalKey, trussKey }) {
  if (!aiConfigured()) {
    const err = new Error('AI extraction not available');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }
  const keys = [];
  if (architecturalKey) keys.push({ key: architecturalKey, label: 'architectural plan set' });
  if (trussKey) keys.push({ key: trussKey, label: 'engineered truss layout' });
  if (keys.length === 0) {
    const err = new Error('No PDF uploaded to this project');
    err.code = 'NO_PDF';
    throw err;
  }

  const buffers = await Promise.all(keys.map((k) => fetchR2Object(k.key)));
  const documentBlocks = buffers.map((buf, i) => ({
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') },
    title: keys[i].label,
  }));

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // ---- Call 1: schedules (non-fatal on failure) ----
  let schedules = { door_schedule: [], window_schedule: [] };
  try {
    const raw1 = await callClaude(client, documentBlocks, SYSTEM_SCHEDULES, USER_SCHEDULES, 2048);
    const parsed1 = parseClaudeJson(raw1);
    if (parsed1) schedules = parsed1;
    else console.warn('[floor-plan-extractor] Call 1 (schedules): parse failed, continuing with empty schedules');
    console.log(
      `[floor-plan-extractor] Call 1 (schedules): ${schedules.door_schedule?.length || 0} doors, ` +
      `${schedules.window_schedule?.length || 0} windows`
    );
  } catch (e) {
    console.warn('[floor-plan-extractor] Call 1 (schedules) failed:', e.message);
  }

  // ---- Call 2: exterior polygon (FATAL on failure — we can't draw without it) ----
  let polygon = null;
  try {
    const raw2 = await callClaude(client, documentBlocks, SYSTEM_POLYGON, USER_POLYGON, 1024);
    polygon = parseClaudeJson(raw2);
  } catch (e) {
    console.error('[floor-plan-extractor] Call 2 (polygon) errored:', e.message);
  }
  if (!polygon || !Array.isArray(polygon.exterior_polygon) || polygon.exterior_polygon.length < 3) {
    return {
      data: null,
      error: 'Could not extract a valid exterior polygon from this PDF. ' +
             'Make sure the floor plan page is included and clearly labeled.',
    };
  }
  console.log(
    `[floor-plan-extractor] Call 2 (polygon): ${polygon.total_width_ft}'×${polygon.total_depth_ft}' building, ` +
    `${polygon.exterior_polygon.length} corners, confidence=${polygon.confidence || 'unknown'}` +
    (polygon.deck_excluded ? `, excluded=${polygon.deck_excluded}` : '')
  );

  // ---- Call 3: interior walls (non-fatal on failure) ----
  let walls = { wall_height_ft: null, interior_walls: [], floors_detected: [] };
  try {
    const userWalls = userWallsPrompt({
      totalWidthFt: polygon.total_width_ft,
      totalDepthFt: polygon.total_depth_ft,
    });
    const raw3 = await callClaude(client, documentBlocks, SYSTEM_WALLS, userWalls, 2048);
    const parsed3 = parseClaudeJson(raw3);
    if (parsed3) walls = parsed3;
    else console.warn('[floor-plan-extractor] Call 3 (walls): parse failed, continuing with no interior walls');
  } catch (e) {
    console.warn('[floor-plan-extractor] Call 3 (walls) failed:', e.message);
  }
  console.log(`[floor-plan-extractor] Call 3 (interior walls): ${walls.interior_walls?.length || 0} walls detected`);

  const merged = mergeExtraction(schedules, polygon, walls);
  console.log('[floor-plan-extractor] Merge complete. Sending to frontend.');
  return { data: merged, error: null };
}
