// AI-powered floor plan extraction. Sends the project's architectural PDF
// (and the optional engineered truss layout when both are uploaded) to
// Claude's vision API and asks it to read off the exterior polygon, interior
// walls, door/window schedules, and basic roof settings as structured JSON.
//
// The user reviews everything in a confirmation modal on the frontend
// before any walls or openings get written to the database. The dedicated
// /apply-floor-plan-extraction route handles the actual inserts.

import Anthropic from '@anthropic-ai/sdk';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { r2, BUCKET } from './r2.js';

const MODEL = 'claude-sonnet-4-6';
const TIMEOUT_MS = 60_000; // floor plans are 4-8x larger than roof-only
// 4096 was running into truncation on real plan sets — a 2-storey house
// with ~12 interior walls + ~14 openings doubled to absolute+fraction
// coords easily crosses 5K output tokens. 8192 gives generous headroom.
const MAX_TOKENS = 8192;

export function aiConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

const SYSTEM_PROMPT =
  'You are an expert architectural drawing reader specializing in residential construction drawings. ' +
  'You extract precise measurement data from architectural floor plans and schedules. ' +
  'Return ONLY valid JSON with no markdown, no code blocks, no explanation.';

const USER_MESSAGE = `Analyze this architectural drawing set. BEFORE extracting any data, scan ALL pages of the document and identify which floor each plan page represents:

- A page titled "FLOOR PLAN", "GROUND FLOOR PLAN", "MAIN FLOOR PLAN", or "FIRST FLOOR" → floor_level: "floor1"
- A page titled "UPPER FLOOR PLAN", "SECOND FLOOR PLAN", "2ND FLOOR" → floor_level: "floor2"
- A page titled "BASEMENT PLAN", "FOUNDATION PLAN" → floor_level: "basement"

Extract detailed plan data for EVERY floor plan page you find — not just one. Return one entry in the floors[] array per detected floor.

Return this EXACT JSON structure with no markdown, no code blocks, no prose:

{
  "building": {
    "total_width_ft": number,
    "total_depth_ft": number,
    "wall_type": "2x4" or "2x6",
    "num_storeys": 1 or 2,
    "floor_area_sqft": number or null,
    "wall_height_ft": number
  },
  "floors_detected": [
    { "floor_level": "floor1" | "floor2" | "basement", "page_number": number, "label": string }
  ],
  "floors": [
    {
      "floor_level": "floor1" | "floor2" | "basement",
      "page_number": number,
      "exterior_polygon": [
        { "x_ft": number, "y_ft": number, "x_fraction": number, "y_fraction": number }
      ],
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
          "wall_type": "interior_2x4" or "interior_2x6",
          "is_load_bearing": boolean
        }
      ],
      "exterior_doors": [
        {
          "label": string,
          "width_inches": number,
          "height_inches": number,
          "ro_width_inches": number,
          "ro_height_inches": number,
          "type": "hinged" or "slider" or "french",
          "quantity": number,
          "wall_side": "front" or "back" or "left" or "right" or null,
          "position_fraction": number or null
        }
      ],
      "interior_doors": [
        {
          "label": string,
          "width_inches": number,
          "height_inches": number,
          "ro_width_inches": number,
          "ro_height_inches": number,
          "quantity": number,
          "interior_wall_hint": string or null
        }
      ],
      "windows": [
        {
          "label": string,
          "width_inches": number,
          "height_inches": number,
          "ro_width_inches": number,
          "ro_height_inches": number,
          "type": string,
          "quantity": number,
          "wall_side": "front" or "back" or "left" or "right" or null,
          "position_fraction": number or null
        }
      ]
    }
  ],
  "roof": {
    "pitch": string or null,
    "truss_spacing_inches": number or null
  },
  "confidence": "high" or "medium" or "low",
  "notes": string,
  "warnings": [string]
}

============================================================
EXTERIOR POLYGON — CRITICAL RULES
============================================================
The exterior polygon must trace ONLY the conditioned living space (the actual heated building walls).

DO NOT include any of the following in the polygon, even if they're shown attached to the building:
- Decks (usually drawn with dashed lines, diagonal hatching, or "5/4" or composite decking notation)
- Porches and covered entries (often labeled "PORCH", "COVERED PORCH", "COVERED ENTRY")
- Garages (unless they share a heated wall — and even then trace only the heated envelope)
- Patios, walkways, stairs, any outdoor structure

Look for the THICK exterior wall lines that form the heated envelope. These are typically drawn as solid double lines. The polygon must close around just the heated space.

If you detect a deck, porch, or other excluded structure, add a string to "warnings" describing it, e.g. "Excluded 12'×16' rear deck from polygon" or "Excluded covered front porch".

Trace the corners starting from the top-left going clockwise. For each corner, return both the absolute foot coordinate (x_ft, y_ft, from top-left origin) AND its position as a fraction of the building bounding box (x_fraction = x_ft / total_width_ft, y_fraction = y_ft / total_depth_ft).

============================================================
INTERIOR WALLS — WALL TYPE RULES
============================================================
Default interior wall_type to "interior_2x4". The vast majority of residential interior partition walls are 2x4.

Mark is_load_bearing=true and wall_type="interior_2x6" ONLY when the wall is explicitly labeled on the drawing as:
- "2x6 LOAD BEARING"
- "2x6 @ 16 O.C. LOAD BEARING"
- Any explicit structural notation indicating a load-bearing 2x6 wall

When in doubt, choose interior_2x4. Do not infer load bearing from wall position alone.

For each interior wall return BOTH the absolute coordinates (start_x_ft, start_y_ft, end_x_ft, end_y_ft, from top-left origin in feet) AND the fraction-based positions:
- start_x_fraction = start_x_ft / total_width_ft
- start_y_fraction = start_y_ft / total_depth_ft
- end_x_fraction = end_x_ft / total_width_ft
- end_y_fraction = end_y_ft / total_depth_ft

Use the dimension annotations printed on the drawing to calculate these fractions accurately.

============================================================
DOORS — INTERIOR vs EXTERIOR CATEGORIZATION
============================================================
Read the door schedule and categorize EACH row:

EXTERIOR doors → exterior_doors[]:
- The label or description contains "EXT.", "EXTERIOR", "SLIDER", "PATIO", or "GLASS PANEL"
- OR the door is shown on the perimeter walls of the building in the plan view

INTERIOR doors → interior_doors[]:
- The label or description is just "HINGED", "3 PANEL", "DOUBLE HINGED", "BIFOLD", "POCKET" without an EXT/EXTERIOR prefix
- OR the door is shown on an interior partition wall in the plan view

Examples from a real plan set:
- D01 "HINGED-3 PANEL" (no EXT label) → interior_doors
- D04 "DOUBLE HINGED-3 PANEL" (no EXT label) → interior_doors
- D02 "EXT. HINGED" → exterior_doors
- D03 "EXT. SLIDER" → exterior_doors

For interior doors, also include interior_wall_hint — the room/area where the door is located based on the floor plan layout (e.g. "Office", "Bedroom 2", "Bath", "Master Closet"). This helps the placement engine match each door to its likely interior wall.

============================================================
WINDOWS AND DOOR PLACEMENT
============================================================
Read the schedules directly for exact RO sizes.

For each exterior door and window, set wall_side based on which exterior wall the opening is on:
- "front"  = the edge at the LARGEST y coordinate (bottom of the plan drawing)
- "back"   = the edge at the SMALLEST y coordinate (top of the plan drawing)
- "left"   = the edge at the SMALLEST x coordinate
- "right"  = the edge at the LARGEST x coordinate

Also estimate position_fraction (0 to 1) representing where along that wall_side edge the opening sits, measured from the start of the edge. Use null only if the wall_side can't be determined.

============================================================
ROOF + CONFIDENCE
============================================================
For roof.pitch: read from the building section drawing (e.g. "5.5:12", "6:12").
For roof.truss_spacing_inches: read from any roof framing note (typically 24 or 16).

Set confidence to "high" only when wall lines are clear, schedules are readable, and dimensions are explicitly labeled. Use "medium" when minor details are inferred. Use "low" when significant guessing was required.

============================================================
RULES
============================================================
- If multiple PDFs are provided (e.g. architectural + truss), cross-reference but TRUST the architectural set for walls/doors/windows.
- If any value cannot be determined, use null. DO NOT GUESS measurements — null is correct.
- If only one floor plan page is present, return a single entry in floors[].
- Always populate the absolute foot fields AND the fraction fields together — don't return one without the other.`;

async function fetchR2Object(key) {
  const out = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of out.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Parse the model's text response, tolerating common wrapping issues:
// - markdown code fences (```json ... ```)
// - leading prose like "Here's the extracted data:"
// - trailing prose
// Returns { data, parseError } so callers can log what went wrong.
function parseExtractionJson(rawText) {
  if (!rawText) return { data: null, parseError: 'Empty response from model' };
  let text = String(rawText).trim();
  // Strip surrounding code fences. Handle both ```json...``` and bare ```...```.
  text = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  // If there's prose before the JSON, slice from the first { to the last }.
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0) {
    return { data: null, parseError: `Response contained no '{' — likely truncated or non-JSON: ${text.slice(0, 200)}` };
  }
  if (last <= first) {
    return { data: null, parseError: `Response had no closing '}' — likely truncated at ${text.length} chars: ${text.slice(0, 200)}` };
  }
  text = text.slice(first, last + 1);
  try {
    return { data: JSON.parse(text), parseError: null };
  } catch (e) {
    return { data: null, parseError: `${e.message} (response was ${text.length} chars)` };
  }
}

// Wrap a flat (non-multi-floor) response in a floors[] array so callers can
// treat both shapes uniformly. Idempotent — if floors[] is already present
// returns the input unchanged.
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

// Simpler, single-floor prompt used as a fallback when the full multi-floor
// extraction fails to parse (typically due to max-tokens truncation on a
// large plan set). The response shape is the OLD flat structure — the
// caller normalizes it back to the floors[] wrapper.
const SIMPLIFIED_USER_MESSAGE = `Extract the ground floor plan data from this architectural drawing. Return ONLY this JSON structure with no markdown:
{
  "building": { "total_width_ft": number, "total_depth_ft": number, "wall_type": "2x4"|"2x6", "wall_height_ft": number, "num_storeys": 1|2, "floor_area_sqft": number|null },
  "exterior_polygon": [{ "x_ft": number, "y_ft": number, "x_fraction": number, "y_fraction": number }],
  "interior_walls": [{ "start_x_ft": number, "start_y_ft": number, "end_x_ft": number, "end_y_ft": number, "start_x_fraction": number, "start_y_fraction": number, "end_x_fraction": number, "end_y_fraction": number, "wall_type": "interior_2x4"|"interior_2x6", "is_load_bearing": boolean }],
  "exterior_doors": [{ "label": string, "width_inches": number, "height_inches": number, "ro_width_inches": number, "ro_height_inches": number, "type": string, "quantity": number, "wall_side": "front"|"back"|"left"|"right"|null, "position_fraction": number|null }],
  "interior_doors": [{ "label": string, "width_inches": number, "height_inches": number, "ro_width_inches": number, "ro_height_inches": number, "quantity": number, "interior_wall_hint": string|null }],
  "windows": [{ "label": string, "width_inches": number, "height_inches": number, "ro_width_inches": number, "ro_height_inches": number, "type": string, "quantity": number, "wall_side": "front"|"back"|"left"|"right"|null, "position_fraction": number|null }],
  "roof": { "pitch": string|null, "truss_spacing_inches": number|null },
  "confidence": "high"|"medium"|"low",
  "notes": string,
  "warnings": [string]
}

Rules:
- Exterior polygon: trace ONLY the conditioned heated space. Exclude decks, porches, covered entries, garages.
- Interior walls: default to interior_2x4. Only mark interior_2x6 + is_load_bearing=true when the drawing explicitly says "2x6 LOAD BEARING".
- Interior doors: any door NOT labeled EXT./EXTERIOR/SLIDER/PATIO in the schedule.
- Exterior doors: doors labeled EXT., EXTERIOR, SLIDER, PATIO DOOR, or GLASS PANEL.
- Use null for any value you cannot determine. Do not guess.`;

async function callClaude(client, content, userMessage) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const message = await client.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [...content, { type: 'text', text: userMessage }] }],
      },
      { signal: abort.signal }
    );
    const textBlock = (message.content || []).find((b) => b.type === 'text');
    return {
      raw: textBlock?.text || '',
      stop_reason: message.stop_reason,
      input_tokens: message.usage?.input_tokens,
      output_tokens: message.usage?.output_tokens,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the floor-plan extraction. Pass the R2 keys of the PDFs to include.
 * At least one is required.
 *
 * Returns { data, raw, parseError, attempts }. `data` is the normalized
 * parsed JSON (always with a floors[] array) or null if parse failed even
 * after the simplified-prompt retry.
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
  const attempts = [];

  // First attempt: full multi-floor prompt.
  const a1 = await callClaude(client, documentBlocks, USER_MESSAGE);
  const p1 = parseExtractionJson(a1.raw);
  attempts.push({
    prompt: 'multi-floor',
    stop_reason: a1.stop_reason,
    output_tokens: a1.output_tokens,
    parse_error: p1.parseError,
    raw_length: a1.raw.length,
  });
  if (p1.data) {
    return { data: normalizeExtraction(p1.data), raw: a1.raw, parseError: null, attempts };
  }

  // Truncation diagnostic: log conspicuously when the model hit max_tokens.
  if (a1.stop_reason === 'max_tokens') {
    console.error(`[floor-plan-extractor] First attempt hit max_tokens (${a1.output_tokens} output tokens). Retrying with simplified prompt.`);
  } else {
    console.error(`[floor-plan-extractor] First attempt parse failed: ${p1.parseError}. Retrying with simplified prompt.`);
  }

  // Second attempt: simplified single-floor prompt.
  const a2 = await callClaude(client, documentBlocks, SIMPLIFIED_USER_MESSAGE);
  const p2 = parseExtractionJson(a2.raw);
  attempts.push({
    prompt: 'simplified',
    stop_reason: a2.stop_reason,
    output_tokens: a2.output_tokens,
    parse_error: p2.parseError,
    raw_length: a2.raw.length,
  });
  if (p2.data) {
    return { data: normalizeExtraction(p2.data), raw: a2.raw, parseError: null, attempts };
  }

  // Both failed — return raw from the first attempt and the most useful
  // error message we have.
  return {
    data: null,
    raw: a1.raw,
    parseError: p1.parseError || p2.parseError,
    attempts,
  };
}
