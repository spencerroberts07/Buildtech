// AI-powered roof data extraction from project PDFs.
//
// Sends the project's architectural plan (and the optional engineered truss
// layout when both are uploaded) to Claude's vision API and asks it to
// extract roof measurements as structured JSON.
//
// The user reviews the extracted values in the frontend confirmation panel
// before any of them are written to the project. Values get stored as
// `extracted_*` overrides on projects; the material list builder substitutes
// them in for the corresponding polygon-calculated quantities.

import Anthropic from '@anthropic-ai/sdk';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { r2, BUCKET } from './r2.js';

const MODEL = 'claude-sonnet-4-6';
const TIMEOUT_MS = 30_000;

export function aiConfigured() {
  return !!process.env.ANTHROPIC_API_KEY;
}

const SYSTEM_PROMPT =
  'You are a construction document reader specializing in residential roof plans and truss layout drawings. ' +
  'Extract roof measurement data from the provided plan image. ' +
  'Return ONLY valid JSON with no markdown, no explanation, no code blocks.';

const USER_MESSAGE = `Extract all roof measurements from this plan. When multiple documents are provided (e.g. architectural plans + engineered truss layouts), cross-reference them and prefer the truss layout for precise linear footage values. Look for:
- Roof pitch or slope (e.g. 6/12, 5.5:12, 6:12)
- Total sheathing area or roof plane area in square feet
- Valley flashing length in linear feet
- Ridge cap or ridge length in linear feet
- Hip ridge length in linear feet
- Fascia length in linear feet
- Overall roof dimensions (width and depth in feet)
- Any section-specific dimensions

Return this exact JSON structure:
{
  "pitch": string or null (e.g. "6:12"),
  "sheathing_area_sf": number or null,
  "valley_lf": number or null,
  "ridge_lf": number or null,
  "hip_ridge_lf": number or null,
  "fascia_lf": number or null,
  "roof_width_ft": number or null,
  "roof_depth_ft": number or null,
  "sections": [
    {
      "name": string,
      "width_ft": number or null,
      "depth_ft": number or null,
      "pitch": string or null
    }
  ],
  "confidence": "high" | "medium" | "low",
  "notes": string (any important observations about the roof or things that could not be extracted)
}

If a value is not clearly visible or labeled on the plan, use null. Do not guess.`;

async function fetchR2Object(key) {
  const out = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks = [];
  for await (const chunk of out.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function parseExtractionJson(rawText) {
  if (!rawText) return null;
  let text = String(rawText).trim();
  // Tolerate the model wrapping output in ```json fences even though we
  // asked for none — it happens occasionally on lower-confidence pages.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) text = fenceMatch[1].trim();
  // Trim anything before the first '{' or after the last '}' just in case.
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) text = text.slice(first, last + 1);
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Run the extraction. Pass the keys (R2 object keys) of the PDFs to include.
 * Either or both may be present; at least one is required.
 *
 * Returns { data, raw }. `data` is parsed JSON or null if parse failed.
 * `raw` is the model's text response (useful for the parse-fail error path).
 */
export async function extractRoofData({ architecturalKey, trussKey }) {
  if (!aiConfigured()) {
    const err = new Error('AI extraction not available');
    err.code = 'AI_NOT_CONFIGURED';
    throw err;
  }
  const keys = [];
  if (trussKey) keys.push({ key: trussKey, label: 'engineered truss layout' });
  if (architecturalKey) keys.push({ key: architecturalKey, label: 'architectural plan' });
  if (keys.length === 0) {
    const err = new Error('No PDF uploaded to this project');
    err.code = 'NO_PDF';
    throw err;
  }

  // Fetch all PDFs in parallel.
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
        max_tokens: 1024,
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
