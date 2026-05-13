// AI-powered floor plan extraction.
//
// Two entry points, two backend endpoints:
//
// 1) extractFloorPlan() — FULL extraction. Used by the "✨ Read Floor Plan"
//    button. Two parallel Opus calls:
//      A) Schedules (door + window tables)
//      B) Chain-of-thought floor plan reasoning — forces the model to
//         answer 7 sequential questions about scale → dimensions →
//         deck analysis → conditioned space → polygon corners → interior
//         walls → building info. Asking for explicit intermediate
//         reasoning makes the final polygon dramatically more reliable
//         than asking for coordinates straight away.
//    Merged into the same normalized shape the modal expects.
//
// 2) extractOpeningsOnly() — OPENINGS-ONLY extraction. Used by the
//    "✨ Place Openings" button when the user has already drawn exterior
//    walls manually. One focused Opus call that only reads schedules + tags
//    each row with wall_side. The frontend places the openings onto the
//    user's existing walls; no polygon or interior-wall creation happens.

import Anthropic from '@anthropic-ai/sdk';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { r2, BUCKET } from './r2.js';

const MODEL = 'claude-opus-4-5';
const TIMEOUT_MS = 60_000;

export function aiConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
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

async function loadDocumentBlocks({ architecturalKey, trussKey }) {
  const keys = [];
  if (architecturalKey) keys.push({ key: architecturalKey, label: 'architectural plan set' });
  if (trussKey) keys.push({ key: trussKey, label: 'engineered truss layout' });
  if (keys.length === 0) {
    const err = new Error('No PDF uploaded to this project');
    err.code = 'NO_PDF';
    throw err;
  }
  const buffers = await Promise.all(keys.map((k) => fetchR2Object(k.key)));
  return buffers.map((buf, i) => ({
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') },
    title: keys[i].label,
  }));
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
// Prompts
// ============================================================

const SYSTEM_SCHEDULES =
  'You are an expert at reading architectural drawing schedules. ' +
  'Extract data from tables exactly as written. ' +
  'Return ONLY valid JSON with no markdown or explanation.';

// Used by BOTH the full extraction (schedules half) and the openings-only
// flow. The openings-only mode additionally asks Claude to determine
// wall_side for each row by inspecting the floor plan.
function userSchedulesPrompt({ includeWallSide }) {
  const wallSideRules = includeWallSide
    ? `- For wall_side: look at the floor plan to determine which exterior wall each door/window is on. Use "front" for the main entrance side, "back" for the rear, "left" and "right" for the sides. Use null if uncertain.\n`
    : '';
  return `This is an architectural drawing set. Find and read the DOOR SCHEDULE and WINDOW SCHEDULE tables.

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
      "is_exterior": boolean${includeWallSide ? ',\n      "wall_side": "front"|"back"|"left"|"right"|null' : ''}
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
      "description": string${includeWallSide ? ',\n      "wall_side": "front"|"back"|"left"|"right"|null' : ''}
    }
  ],
  "building_info": {
    "wall_height_ft": number|null,
    "wall_type": "2x4"|"2x6"|null,
    "num_storeys": number|null
  },
  "confidence": "high"|"medium"|"low",
  "notes": string
}

Rules:
- is_exterior = true if description contains EXT., EXTERIOR, SLIDER, PATIO, or GLASS PANEL.
${wallSideRules}- RO format may be like 32 1/2" x 83 1/2" — convert fractions: 1/2=0.5, 3/4=0.75, 1/4=0.25.
- Read EVERY row in both schedule tables. Do not skip any.
- If multiple floors exist in the schedule (FLOOR column shows 1 or 2), include all rows and use the floor number.`;
}

const SYSTEM_CHAIN_OF_THOUGHT =
  'You are an expert architectural drawing reader. ' +
  'You must answer each question in order before computing the final result. ' +
  'Return ONLY valid JSON with no markdown or explanation.';

const USER_CHAIN_OF_THOUGHT = `Answer these questions IN ORDER about the GROUND FLOOR PLAN page in this architectural drawing set. Each answer informs the next. Do not skip ahead.

{
  "step1_scale": string,
  "step2_overall_dimensions": {
    "width_ft": number,
    "depth_ft": number
  },
  "step3_deck_analysis": {
    "has_rear_deck": boolean,
    "rear_deck_depth_ft": number|null,
    "has_front_deck": boolean,
    "front_deck_depth_ft": number|null,
    "deck_description": string
  },
  "step4_conditioned_space": {
    "width_ft": number,
    "depth_ft": number,
    "shape": "rectangle"|"L-shape"|"U-shape"|"other",
    "shape_description": string
  },
  "step5_polygon_corners": [
    { "corner": string, "x_ft": number, "y_ft": number }
  ],
  "step6_interior_walls": [
    {
      "description": string,
      "start_x_ft": number,
      "start_y_ft": number,
      "end_x_ft": number,
      "end_y_ft": number,
      "wall_type": "interior_2x4"|"interior_2x6",
      "is_load_bearing": boolean
    }
  ],
  "step7_building": {
    "wall_type": "2x4"|"2x6",
    "wall_height_ft": number,
    "floor_area_sqft": number|null,
    "num_storeys": number
  },
  "confidence": "high"|"medium"|"low",
  "notes": string,
  "warnings": [string]
}

QUESTION GUIDANCE:
- step1_scale: What is the drawing scale printed on the plan? (e.g. "1/8\\" = 1'-0\\"")
- step2_overall_dimensions: The TOTAL width across the top/bottom of the plan, and the TOTAL depth on the side. Read the outermost dimension strings.
- step3_deck_analysis: Identify any area labeled "DECK", "COMPOSITE DECKING", or shown with deck railings. If a rear deck exists, what is its depth from the back wall to the deck edge? Same for front deck. deck_description should describe ALL deck/porch areas on the plan.
- step4_conditioned_space: This is the HEATED interior space. width_ft is normally the same as step2. depth_ft is step2.depth_ft MINUS any deck depths from step3 (a rear deck makes the conditioned space shallower). shape is the silhouette of just the heated rooms.
- step5_polygon_corners: Trace the corners of the conditioned space starting from top-left going clockwise. For a rectangle 4 corners; L-shape 6 corners. Coordinates in feet from the top-left origin of the conditioned space (0,0). DO NOT include deck or porch corners.
- step6_interior_walls: All interior partition walls. Default wall_type to "interior_2x4". Use "interior_2x6" only if the drawing explicitly labels the wall "2x6 LOAD BEARING".
- step7_building: Wall type for the EXTERIOR walls (typically 2x6 in Ontario). Wall height from the building section drawing.

If any value cannot be determined, use null. Do not guess.`;

// ============================================================
// Merge — turn the parallel calls into the modal-ready shape
// ============================================================

function chainOfThoughtToFlat(c) {
  if (!c || typeof c !== 'object') return null;
  const conditioned = c.step4_conditioned_space || {};
  const totalWidthFt = Number(conditioned.width_ft) || null;
  const totalDepthFt = Number(conditioned.depth_ft) || null;
  const corners = Array.isArray(c.step5_polygon_corners) ? c.step5_polygon_corners : [];
  const polygon = corners.map((p) => {
    const x = Number(p.x_ft) || 0;
    const y = Number(p.y_ft) || 0;
    return {
      x_ft: x,
      y_ft: y,
      x_fraction: totalWidthFt ? x / totalWidthFt : null,
      y_fraction: totalDepthFt ? y / totalDepthFt : null,
    };
  });
  const interiorWalls = (Array.isArray(c.step6_interior_walls) ? c.step6_interior_walls : []).map((w) => {
    const sx = Number(w.start_x_ft) || 0;
    const sy = Number(w.start_y_ft) || 0;
    const ex = Number(w.end_x_ft) || 0;
    const ey = Number(w.end_y_ft) || 0;
    return {
      start_x_ft: sx, start_y_ft: sy, end_x_ft: ex, end_y_ft: ey,
      start_x_fraction: totalWidthFt ? sx / totalWidthFt : null,
      start_y_fraction: totalDepthFt ? sy / totalDepthFt : null,
      end_x_fraction:   totalWidthFt ? ex / totalWidthFt : null,
      end_y_fraction:   totalDepthFt ? ey / totalDepthFt : null,
      wall_type: w.wall_type || 'interior_2x4',
      is_load_bearing: !!w.is_load_bearing,
      room_label: w.description || null,
    };
  });
  const bldg = c.step7_building || {};
  const deckDesc = c.step3_deck_analysis?.deck_description || '';
  return {
    total_width_ft: totalWidthFt,
    total_depth_ft: totalDepthFt,
    polygon,
    interior_walls: interiorWalls,
    building: {
      wall_type: bldg.wall_type || '2x6',
      wall_height_ft: Number(bldg.wall_height_ft) || 9,
      floor_area_sqft: bldg.floor_area_sqft != null ? Number(bldg.floor_area_sqft) : null,
      num_storeys: Number(bldg.num_storeys) || 1,
    },
    confidence: c.confidence || 'medium',
    notes: c.notes || '',
    warnings: Array.isArray(c.warnings) ? c.warnings : [],
    deck_description: deckDesc,
  };
}

function scheduleToOpenings(schedules) {
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
    wall_side: d.wall_side || null,
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
      wall_side: w.wall_side || null,
      position_fraction: null,
    };
  });

  return { exterior_doors, interior_doors, windows };
}

function mergeFullExtraction(schedules, chainOfThought) {
  const flat = chainOfThoughtToFlat(chainOfThought);
  const { exterior_doors, interior_doors, windows } = scheduleToOpenings(schedules);
  const warnings = [...(flat?.warnings || [])];
  if (flat?.deck_description) warnings.unshift(`Deck/porch description: ${flat.deck_description}`);
  return normalizeExtraction({
    building: {
      total_width_ft: flat?.total_width_ft || null,
      total_depth_ft: flat?.total_depth_ft || null,
      wall_type: flat?.building?.wall_type || schedules?.building_info?.wall_type || '2x6',
      wall_height_ft: flat?.building?.wall_height_ft || schedules?.building_info?.wall_height_ft || 9,
      num_storeys: flat?.building?.num_storeys || schedules?.building_info?.num_storeys || 1,
      floor_area_sqft: flat?.building?.floor_area_sqft ?? null,
    },
    exterior_polygon: flat?.polygon || [],
    interior_walls: flat?.interior_walls || [],
    exterior_doors,
    interior_doors,
    windows,
    roof: { pitch: null, truss_spacing_inches: 24 },
    confidence: flat?.confidence || schedules?.confidence || 'medium',
    notes: flat?.notes || '',
    warnings,
    floors_detected: [{ floor_level: 'floor1', label: 'Ground Floor Plan' }],
  });
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
// Full extraction — parallel schedules + chain-of-thought
// ============================================================

export async function extractFloorPlan({ architecturalKey, trussKey }) {
  if (!aiConfigured()) {
    const err = new Error('AI extraction not available');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }
  const documentBlocks = await loadDocumentBlocks({ architecturalKey, trussKey });
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Parallel: schedules + chain-of-thought. Failures in one shouldn't block
  // the other.
  const [schedulesResult, chainResult] = await Promise.allSettled([
    callClaude(client, documentBlocks, SYSTEM_SCHEDULES, userSchedulesPrompt({ includeWallSide: false }), 2048),
    callClaude(client, documentBlocks, SYSTEM_CHAIN_OF_THOUGHT, USER_CHAIN_OF_THOUGHT, 8192),
  ]);

  let schedules = { door_schedule: [], window_schedule: [] };
  if (schedulesResult.status === 'fulfilled') {
    const parsed = parseClaudeJson(schedulesResult.value);
    if (parsed) schedules = parsed;
    else console.warn('[floor-plan-extractor] Schedules parse failed, continuing with empty schedules');
  } else {
    console.warn('[floor-plan-extractor] Schedules call failed:', schedulesResult.reason?.message);
  }
  console.log(
    `[floor-plan-extractor] Schedules: ${schedules.door_schedule?.length || 0} doors, ` +
    `${schedules.window_schedule?.length || 0} windows`
  );

  let chain = null;
  if (chainResult.status === 'fulfilled') {
    chain = parseClaudeJson(chainResult.value);
    if (!chain) console.warn('[floor-plan-extractor] Chain-of-thought parse failed');
  } else {
    console.warn('[floor-plan-extractor] Chain-of-thought call failed:', chainResult.reason?.message);
  }

  // Polygon is required for the modal to function. Without it we can't draw
  // anything, so we return an error.
  const corners = chain?.step5_polygon_corners;
  if (!Array.isArray(corners) || corners.length < 3) {
    return {
      data: null,
      error: 'Could not extract a valid exterior polygon from this PDF. ' +
             'Try the "✨ Place Openings" mode instead if you can draw exterior walls manually.',
    };
  }
  const conditioned = chain.step4_conditioned_space || {};
  console.log(
    `[floor-plan-extractor] Chain-of-thought: ${conditioned.width_ft}'×${conditioned.depth_ft}' ` +
    `${conditioned.shape || ''}, ${corners.length} corners, ` +
    `${chain.step6_interior_walls?.length || 0} interior walls, ` +
    `confidence=${chain.confidence || 'unknown'}`
  );
  if (chain.step3_deck_analysis?.deck_description) {
    console.log(`[floor-plan-extractor] Decks excluded: ${chain.step3_deck_analysis.deck_description}`);
  }

  const merged = mergeFullExtraction(schedules, chain);
  console.log('[floor-plan-extractor] Merge complete. Sending to frontend.');
  return { data: merged, error: null };
}

// ============================================================
// Openings-only extraction — one focused call
// ============================================================

export async function extractOpeningsOnly({ architecturalKey, trussKey }) {
  if (!aiConfigured()) {
    const err = new Error('AI extraction not available');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }
  const documentBlocks = await loadDocumentBlocks({ architecturalKey, trussKey });
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const raw = await callClaude(
    client, documentBlocks,
    SYSTEM_SCHEDULES,
    userSchedulesPrompt({ includeWallSide: true }),
    2048
  );
  const parsed = parseClaudeJson(raw);
  if (!parsed) {
    return { data: null, error: 'Could not parse door/window schedule from this PDF' };
  }
  const { exterior_doors, interior_doors, windows } = scheduleToOpenings(parsed);
  console.log(
    `[floor-plan-extractor] Openings-only: ${exterior_doors.length} ext doors, ` +
    `${interior_doors.length} int doors, ${windows.length} windows`
  );
  return {
    data: {
      exterior_doors,
      interior_doors,
      windows,
      building_info: parsed.building_info || {},
      confidence: parsed.confidence || 'medium',
      notes: parsed.notes || '',
    },
    error: null,
  };
}
