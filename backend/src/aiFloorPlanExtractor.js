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

function parseExtractionJson(rawText) {
  if (!rawText) return null;
  let text = String(rawText).trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) text = fenceMatch[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) text = text.slice(first, last + 1);
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Run the floor-plan extraction. Pass the R2 keys of the PDFs to include.
 * At least one is required.
 *
 * Returns { data, raw }. `data` is parsed JSON or null if parse failed.
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
  const content = [];
  for (let i = 0; i < buffers.length; i++) {
    content.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: buffers[i].toString('base64'),
      },
      title: keys[i].label,
    });
  }
  content.push({ type: 'text', text: USER_MESSAGE });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      },
      { signal: abort.signal }
    );
  } finally {
    clearTimeout(timer);
  }

  const textBlock = (response.content || []).find((b) => b.type === 'text');
  const raw = textBlock?.text || '';
  const data = parseExtractionJson(raw);
  return { data, raw };
}
