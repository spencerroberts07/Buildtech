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

const USER_MESSAGE = `Analyze this architectural drawing set and extract the complete floor plan data. Look at ALL pages — the floor plan page (usually labeled 'FLOOR PLAN' or 'GROUND FLOOR PLAN'), the door schedule, the window schedule, and the building section.

Extract and return this exact JSON structure:

{
  "building": {
    "total_width_ft": number,
    "total_depth_ft": number,
    "wall_type": "2x4" or "2x6",
    "num_storeys": 1 or 2,
    "floor_area_sqft": number or null,
    "wall_height_ft": number
  },
  "exterior_polygon": [
    { "x_ft": number, "y_ft": number }
  ],
  "interior_walls": [
    {
      "start_x_ft": number,
      "start_y_ft": number,
      "end_x_ft": number,
      "end_y_ft": number,
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
      "wall_side": "front" or "back" or "left" or "right" or null
    }
  ],
  "interior_doors": [
    {
      "label": string,
      "width_inches": number,
      "height_inches": number,
      "ro_width_inches": number,
      "ro_height_inches": number,
      "quantity": number
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
      "wall_side": "front" or "back" or "left" or "right" or null
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

For exterior_polygon: trace the exterior wall corners starting from the top-left corner going clockwise. Use the overall dimensions from the floor plan. For a simple rectangle, 4 points. For an L-shape, 6 points. Coordinates in feet from top-left origin (0,0).

For interior_walls: trace the major interior walls from the floor plan. Use the room dimensions and labels to determine wall positions. Approximate positions are fine — the user will review and adjust.

For doors and windows: read the door schedule and window schedule tables directly — these have exact sizes. Also note which walls they are on from the floor plan layout. wall_side conventions: "front" = the edge of the polygon at the largest y coordinate (bottom of drawing); "back" = smallest y (top); "left" = smallest x; "right" = largest x.

If multiple documents are provided (e.g. architectural + truss), cross-reference them but trust the architectural set for door/window/wall data.

If any value cannot be determined, use null. Do not guess measurements — use null instead.`;

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
