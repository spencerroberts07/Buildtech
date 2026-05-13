import React, { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api.js';

// Polygon-based roof sketch tool. Each section is a polygon (wall corners +
// per-edge overhang + per-edge end_type). Shares the world/screen model with
// Sketch.jsx so coordinates stay consistent across the app.

const BASE_GRID_PX = 20;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
const CANVAS_HEIGHT = 600;
const CORNER_HIT_PX = 10;
const EDGE_HIT_PX = 8;
const OVERHANG_HANDLE_PX = 9;
const OVERHANG_HANDLE_OFFSET_PX = 14;
const SNAP_FT = 2;            // snap radius while drawing a new section
const CONNECT_FT = 0.05;      // tolerance for treating two corners as "the same"

const PITCH_OPTIONS = ['3:12', '4:12', '5:12', '6:12', '7:12', '8:12', '10:12', '12:12'];
const SHEATHING_TYPE_OPTIONS = [
  { value: 'plywood_1_2_csp', label: '1/2" CSP Plywood' },
  { value: 'osb_7_16',        label: '7/16" OSB' },
  { value: 'plywood_5_8',     label: '5/8" Plywood' },
];
const SPACING_OPTIONS = [
  { value: '24_oc', label: '24" o.c.' },
  { value: '16_oc', label: '16" o.c.' },
];
const PITCH_MULT = {
  '3:12': 1.031, '4:12': 1.054, '5:12': 1.083,
  '6:12': 1.118, '7:12': 1.158, '8:12': 1.202,
  '9:12': 1.250, '10:12': 1.302, '12:12': 1.414,
};

// ---------- geometry helpers ----------
function num(v) { return v == null || v === '' ? 0 : Number(v); }
function worldToScreen(wx, wy, vp) {
  return { x: wx * BASE_GRID_PX * vp.zoom + vp.panX, y: wy * BASE_GRID_PX * vp.zoom + vp.panY };
}
function screenToWorld(sx, sy, vp) {
  return { x: (sx - vp.panX) / (BASE_GRID_PX * vp.zoom), y: (sy - vp.panY) / (BASE_GRID_PX * vp.zoom) };
}
function snapHalf(v) { return Math.round(v * 2) / 2; }
function snapQuarter(v) { return Math.round(v * 4) / 4; }
function distPointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { d: Math.hypot(px - x1, py - y1), t: 0 };
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return { d: Math.hypot(px - cx, py - cy), t, cx, cy };
}
function polygonArea(corners) {
  if (!corners || corners.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < corners.length; i++) {
    const p = corners[i], q = corners[(i + 1) % corners.length];
    a += Number(p.x) * Number(q.y) - Number(q.x) * Number(p.y);
  }
  return Math.abs(a) / 2;
}
function polygonCentroid(corners) {
  if (!corners || corners.length === 0) return { x: 0, y: 0 };
  let sx = 0, sy = 0;
  for (const c of corners) { sx += Number(c.x); sy += Number(c.y); }
  return { x: sx / corners.length, y: sy / corners.length };
}
function isCCW(corners) {
  let s = 0;
  for (let i = 0; i < corners.length; i++) {
    const p = corners[i], q = corners[(i + 1) % corners.length];
    s += Number(p.x) * Number(q.y) - Number(q.x) * Number(p.y);
  }
  return s > 0;
}
function lineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}
function expandPolygon(corners, overhangs) {
  const n = corners.length;
  if (n < 3) return corners.slice();
  const ccw = isCCW(corners);
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = corners[i], b = corners[(i + 1) % n];
    const ax = Number(a.x), ay = Number(a.y), bx = Number(b.x), by = Number(b.y);
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = ccw ? dy / len : -dy / len;
    const ny = ccw ? -dx / len : dx / len;
    const off = Number(overhangs[i] ?? 0);
    lines.push({
      ax: ax + nx * off, ay: ay + ny * off,
      bx: bx + nx * off, by: by + ny * off,
    });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n], cur = lines[i];
    const p = lineIntersection(prev.ax, prev.ay, prev.bx, prev.by, cur.ax, cur.ay, cur.bx, cur.by);
    out.push(p || { x: corners[i].x, y: corners[i].y });
  }
  return out;
}
function pointInPolygon(x, y, corners) {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const xi = Number(corners[i].x), yi = Number(corners[i].y);
    const xj = Number(corners[j].x), yj = Number(corners[j].y);
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function edgeOutwardNormal(corners, i, ccw) {
  const a = corners[i], b = corners[(i + 1) % corners.length];
  const dx = Number(b.x) - Number(a.x), dy = Number(b.y) - Number(a.y);
  const len = Math.hypot(dx, dy) || 1;
  return ccw ? { nx: dy / len, ny: -dx / len } : { nx: -dy / len, ny: dx / len };
}

// Find the first reflex (re-entrant) corner — a corner whose interior angle
// exceeds 180°. Such a corner sticks INTO the polygon. Returns null for
// purely convex polygons.
function findReflexCorner(corners) {
  const n = corners.length;
  if (n < 4) return null;
  const ccw = isCCW(corners);
  for (let i = 0; i < n; i++) {
    const prev = corners[(i - 1 + n) % n];
    const cur = corners[i];
    const next = corners[(i + 1) % n];
    const v1x = Number(cur.x) - Number(prev.x), v1y = Number(cur.y) - Number(prev.y);
    const v2x = Number(next.x) - Number(cur.x), v2y = Number(next.y) - Number(cur.y);
    const cross = v1x * v2y - v1y * v2x;
    if (ccw && cross < 0) return i;
    if (!ccw && cross > 0) return i;
  }
  return null;
}

// Count reflex corners. 1 = L-shape, 2 = U-shape, 3+ = too complex to auto-split.
function countReflexCorners(corners) {
  const n = corners?.length || 0;
  if (n < 4) return 0;
  const ccw = isCCW(corners);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const prev = corners[(i - 1 + n) % n];
    const cur = corners[i];
    const next = corners[(i + 1) % n];
    const v1x = Number(cur.x) - Number(prev.x), v1y = Number(cur.y) - Number(prev.y);
    const v2x = Number(next.x) - Number(cur.x), v2y = Number(next.y) - Number(cur.y);
    const cross = v1x * v2y - v1y * v2x;
    if ((ccw && cross < 0) || (!ccw && cross > 0)) count++;
  }
  return count;
}

function bboxOf(corners) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, Number(c.x)); maxX = Math.max(maxX, Number(c.x));
    minY = Math.min(minY, Number(c.y)); maxY = Math.max(maxY, Number(c.y));
  }
  return { minX, maxX, minY, maxY };
}

// "Complex shape" = anything with at least one reflex corner. Pentagons /
// octagons without reflex corners don't need a split prompt.
function isComplexShape(corners) {
  return countReflexCorners(corners) >= 1;
}

// True when the polygon's axis-aligned bbox is wider than tall (or square).
function bboxIsWiderThanTall(corners) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, Number(c.x)); maxX = Math.max(maxX, Number(c.x));
    minY = Math.min(minY, Number(c.y)); maxY = Math.max(maxY, Number(c.y));
  }
  return (maxX - minX) >= (maxY - minY);
}

// Ridge direction from a section's own bbox. Width-dominant → horizontal;
// height-dominant → vertical. Square pieces are an explicit tie that the
// caller resolves (typically by setting the Wing perpendicular to Main).
function preferredRidgeDir(corners, tieBreakFallback) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, Number(c.x)); maxX = Math.max(maxX, Number(c.x));
    minY = Math.min(minY, Number(c.y)); maxY = Math.max(maxY, Number(c.y));
  }
  const w = maxX - minX, h = maxY - minY;
  if (Math.abs(w - h) < 1e-6) return tieBreakFallback;
  return w > h ? 'horizontal' : 'vertical';
}

// Bounding-box aspect ratio (long / short) — used to compare candidate splits.
function bboxAspectRatio(corners) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of corners) {
    minX = Math.min(minX, Number(c.x)); maxX = Math.max(maxX, Number(c.x));
    minY = Math.min(minY, Number(c.y)); maxY = Math.max(maxY, Number(c.y));
  }
  const w = maxX - minX, h = maxY - minY;
  if (w <= 0 || h <= 0) return Infinity;
  return Math.max(w, h) / Math.min(w, h);
}

// Extend a ray from the reflex corner along `dir`, find the first non-adjacent
// edge it hits, then build the two resulting polygons. Returns { polyA, polyB }
// or null if no valid cut is found.
function computeCutAndSplit(corners, k, dir) {
  const n = corners.length;
  const cur = corners[k];
  const len = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / len, uy = dir.y / len;
  let best = null;
  for (let j = 0; j < n; j++) {
    if (j === k || j === (k - 1 + n) % n) continue;
    const a = corners[j], b = corners[(j + 1) % n];
    const dx = Number(b.x) - Number(a.x), dy = Number(b.y) - Number(a.y);
    // Ray: cur + t*(ux,uy); Edge: a + s*(dx,dy). Solve for t,s.
    const denom = ux * dy - uy * dx;
    if (Math.abs(denom) < 1e-9) continue;
    const ax = Number(a.x) - Number(cur.x);
    const ay = Number(a.y) - Number(cur.y);
    const t = (ax * dy - ay * dx) / denom;
    const s = (ax * uy - ay * ux) / denom;
    if (t <= 1e-6) continue;
    if (s < -1e-9 || s > 1 + 1e-9) continue;
    if (best == null || t < best.t) {
      best = { t, s, j, P: { x: Number(cur.x) + t * ux, y: Number(cur.y) + t * uy } };
    }
  }
  if (!best) return null;
  const { P, j } = best;
  // polyA: from k forward through k+1, k+2, ..., j, then close via P
  const polyA = [{ x: Number(cur.x), y: Number(cur.y) }];
  let i = (k + 1) % n;
  while (i !== (j + 1) % n) {
    polyA.push({ x: Number(corners[i].x), y: Number(corners[i].y) });
    i = (i + 1) % n;
  }
  polyA.push({ x: P.x, y: P.y });
  // polyB: from k via P, then j+1, j+2, ..., k-1
  const polyB = [{ x: Number(cur.x), y: Number(cur.y) }, { x: P.x, y: P.y }];
  let i2 = (j + 1) % n;
  while (i2 !== k) {
    polyB.push({ x: Number(corners[i2].x), y: Number(corners[i2].y) });
    i2 = (i2 + 1) % n;
  }
  // sharedA = the reflex corner (interior corner of the original L);
  // sharedB = the point where the cut line exits the polygon. The shared
  // edge between the two new sections is the segment between them, and
  // its direction tells us which way the Wing's ridge should run.
  return {
    polyA, polyB,
    sharedA: { x: Number(cur.x), y: Number(cur.y) },
    sharedB: { x: P.x, y: P.y },
  };
}

// Pick the L-shape split that produces the two most square-like pieces. Tries
// both cut directions (along the incoming edge and along the reverse of the
// outgoing edge) and minimizes max(aspectRatioA, aspectRatioB).
function computeAutoSplit(corners) {
  const k = findReflexCorner(corners);
  if (k == null) return null;
  const n = corners.length;
  const prev = corners[(k - 1 + n) % n];
  const cur = corners[k];
  const next = corners[(k + 1) % n];
  const dir1 = { x: Number(cur.x) - Number(prev.x), y: Number(cur.y) - Number(prev.y) };
  const dir2 = { x: Number(cur.x) - Number(next.x), y: Number(cur.y) - Number(next.y) };
  const cutA = computeCutAndSplit(corners, k, dir1);
  const cutB = computeCutAndSplit(corners, k, dir2);
  function maxAspect(pair) {
    if (!pair) return Infinity;
    return Math.max(bboxAspectRatio(pair.polyA), bboxAspectRatio(pair.polyB));
  }
  const ma = maxAspect(cutA), mb = maxAspect(cutB);
  if (ma === Infinity && mb === Infinity) return null;
  return ma <= mb ? cutA : cutB;
}

// For a U-shape (two reflex corners), cut at the first reflex — that produces
// a clean rectangle plus an L-shaped remainder. Cut the remainder at its
// reflex corner to get the final three pieces.
function computeUShapeSplit(corners) {
  const first = computeAutoSplit(corners);
  if (!first) return null;
  const aReflex = findReflexCorner(first.polyA) != null;
  const bReflex = findReflexCorner(first.polyB) != null;
  if (aReflex === bReflex) return null;
  const remainder = aReflex ? first.polyA : first.polyB;
  const clean = aReflex ? first.polyB : first.polyA;
  const second = computeAutoSplit(remainder);
  if (!second) return null;
  return { pieces: [clean, second.polyA, second.polyB] };
}

// Per-section quick-access geometry. Note `corners` are the wall corners and
// `expanded` is the roof outline including overhangs — the polygon body fills
// `expanded` and the wall line is rendered as a dashed inset using `corners`.
function sectionGeom(section, scale) {
  const corners = (section.corners || []).map((c) => ({ x: Number(c.x), y: Number(c.y) }));
  const edges = section.edges || [];
  const overhangs = corners.map((_, i) => {
    const e = edges.find((ee) => Number(ee.edge_index) === i);
    return e ? Number(e.overhang_ft) : 1.5;
  });
  const ccw = isCCW(corners);
  const expanded = expandPolygon(corners, overhangs);
  const footprintArea = polygonArea(expanded) * (scale * scale);
  const surfaceArea = footprintArea * (PITCH_MULT[section.pitch] || PITCH_MULT['6:12']);
  return { corners, edges, overhangs, ccw, expanded, footprintArea, surfaceArea };
}

// Bounding box + ridge axis derivation. Ridge runs along the bounding box's
// long axis through the centroid. Endpoints get shortened by shortDim/2 at
// any "end edge" whose end_type is 'hip'. End edges are detected as those
// whose direction is roughly perpendicular to the ridge axis (within 30°).
function computeRidgeAndHips(section, scale) {
  const { corners, edges, expanded } = sectionGeom(section, scale);
  if (expanded.length < 3) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of expanded) {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
  }
  const w = maxX - minX, h = maxY - minY;
  // Ridge direction: 'auto' picks the long axis; 'horizontal' / 'vertical'
  // are manual overrides. With a manual override the ridge runs in the
  // chosen direction regardless of which bbox dim is larger, which is what
  // the user expects when they're correcting an auto-detect mismatch.
  const ridgeOverride = section?.ridge_direction || 'auto';
  const horizontal = ridgeOverride === 'horizontal' ? true
    : ridgeOverride === 'vertical' ? false
    : (w >= h);
  const longDim = horizontal ? w : h;
  const shortDim = horizontal ? h : w;
  if (longDim <= 0) return null;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // Ridge unit vector + perpendicular. The "low" end is the one toward
  // smaller world coord (left for horizontal, top for vertical).
  const ridgeDir = horizontal ? { x: 1, y: 0 } : { x: 0, y: 1 };
  // Determine hip reductions per end. We classify each edge as "end" if its
  // normalized direction's dot with ridgeDir is small (perpendicular ±30°).
  // Then split end edges into "low" vs "high" by the centroid of the edge.
  let lowHip = false, highHip = false;
  for (let i = 0; i < expanded.length; i++) {
    const a = expanded[i], b = expanded[(i + 1) % expanded.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const dot = Math.abs(dx * ridgeDir.x + dy * ridgeDir.y) / len;
    if (dot >= Math.cos(60 * Math.PI / 180)) continue; // not an end edge
    const e = edges.find((ee) => Number(ee.edge_index) === i);
    if (e?.end_type !== 'hip') continue;
    const midProj = horizontal
      ? ((a.x + b.x) / 2)
      : ((a.y + b.y) / 2);
    const center = horizontal ? cx : cy;
    if (midProj < center) lowHip = true; else highHip = true;
  }
  const lowReduce = lowHip ? shortDim / 2 : 0;
  const highReduce = highHip ? shortDim / 2 : 0;
  const ridgeStart = horizontal
    ? { x: cx - longDim / 2 + lowReduce, y: cy }
    : { x: cx, y: cy - longDim / 2 + lowReduce };
  const ridgeEnd = horizontal
    ? { x: cx + longDim / 2 - highReduce, y: cy }
    : { x: cx, y: cy + longDim / 2 - highReduce };
  // Hip rafter lines: each hip end emits two lines from its two corners up to
  // the matching ridge endpoint.
  const hipLines = [];
  for (let i = 0; i < expanded.length; i++) {
    const e = edges.find((ee) => Number(ee.edge_index) === i);
    if (e?.end_type !== 'hip') continue;
    const a = expanded[i], b = expanded[(i + 1) % expanded.length];
    const midProj = horizontal ? ((a.x + b.x) / 2) : ((a.y + b.y) / 2);
    const center = horizontal ? cx : cy;
    const target = midProj < center ? ridgeStart : ridgeEnd;
    hipLines.push({ a: { x: a.x, y: a.y }, b: target });
    hipLines.push({ a: { x: b.x, y: b.y }, b: target });
  }
  return {
    ridgeStart, ridgeEnd, ridgeDir, horizontal, longDim, shortDim,
    bbox: { minX, maxX, minY, maxY }, hipLines,
  };
}

// ---------- main component ----------
export default function RoofSketch({
  projectId, projectSettings, onMaterialsChanged, onProjectSettingsChange,
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  const scaleFtPerGrid = num(projectSettings?.scale_ft_per_grid) || 1;
  const [sections, setSections] = useState([]);
  const [legacyRoof, setLegacyRoof] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [autoCopyTried, setAutoCopyTried] = useState(false);
  const [hasFloorPlan, setHasFloorPlan] = useState(false);
  const [splitPrompt, setSplitPrompt] = useState(null); // section pending split decision
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }

  // AI roof extraction state.
  const [extracting, setExtracting] = useState(false);
  const [extractStage, setExtractStage] = useState(''); // 'Reading roof plan…' → 'Analyzing measurements…'
  const [extractResult, setExtractResult] = useState(null); // { data, source }
  const [extractError, setExtractError] = useState('');
  const [extractFieldsChecked, setExtractFieldsChecked] = useState({});
  const [extractApplyPitchToSections, setExtractApplyPitchToSections] = useState(true);

  const hasArchPdf = !!projectSettings?.pdf_filename;
  const hasTrussPdf = !!projectSettings?.truss_pdf_filename;
  const hasAnyPdf = hasArchPdf || hasTrussPdf;
  const hasAnyExtracted =
    projectSettings?.extracted_pitch != null ||
    projectSettings?.extracted_sheathing_sf != null ||
    projectSettings?.extracted_valley_lf != null ||
    projectSettings?.extracted_ridge_lf != null ||
    projectSettings?.extracted_hip_lf != null ||
    projectSettings?.extracted_fascia_lf != null;

  const [selectedSectionId, setSelectedSectionId] = useState(null);
  const [selectedCornerKey, setSelectedCornerKey] = useState(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState(null);

  // Tool: 'select' | 'pan' | 'draw_section'. Default select.
  const [tool, setTool] = useState('select');
  const [draftCorners, setDraftCorners] = useState([]);
  const [snappedHover, setSnappedHover] = useState(null); // { x, y } when snap is active
  const [fullscreen, setFullscreen] = useState(false);

  const dragState = useRef({ active: false, type: null });
  const spaceDown = useRef(false);
  const ctrlDown = useRef(false);
  const panState = useRef({ active: false, startX: 0, startY: 0, basePan: null });

  const [viewport, setViewport] = useState(() => ({
    panX: num(projectSettings?.viewport_pan_x),
    panY: num(projectSettings?.viewport_pan_y),
    zoom: num(projectSettings?.viewport_zoom) || 1,
  }));
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: CANVAS_HEIGHT });
  const [hoverWorld, setHoverWorld] = useState(null);
  const [overhangDragLabel, setOverhangDragLabel] = useState(null); // {sx, sy, oh}

  // ---- load + auto-copy ----
  const loadAll = useCallback(async () => {
    try {
      const [secs, roof] = await Promise.all([
        api.listRoofSections(projectId),
        api.getRoof(projectId).catch(() => null),
      ]);
      setSections(secs || []);
      setLegacyRoof(roof || null);
      setLoading(false);
      if ((secs || []).length === 0) await tryAutoCopyTopFloor();
    } catch (e) { setError(e.message); setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  useEffect(() => { loadAll(); }, [loadAll]);

  async function tryAutoCopyTopFloor() {
    setAutoCopyTried(true);
    try {
      const fps = await api.listFloorPlans(projectId);
      const anyHasCorners = (fps || []).some((p) => Array.isArray(p.corners) && p.corners.length >= 3);
      setHasFloorPlan(anyHasCorners);
      let candidate = (fps || []).find((p) => p.level === 'floor2' && Array.isArray(p.corners) && p.corners.length >= 3);
      if (!candidate) {
        candidate = (fps || []).find((p) => p.level === 'floor1' && Array.isArray(p.corners) && p.corners.length >= 3);
      }
      if (!candidate) return;
      const src = candidate.level === 'floor2' ? 'Floor 2' : 'Floor 1';
      const created = await api.createRoofSection(projectId, {
        section_name: 'Main Roof',
        corners: candidate.corners.map((c) => ({ x: Number(c.x), y: Number(c.y) })),
        pitch: '6:12',
      });
      setSections([created]);
      setSelectedSectionId(created.id);
      onMaterialsChanged?.();
      showToast(`Roof copied from ${src} — adjust overhangs and add sections as needed`);
      // Run the same L-shape / complex-shape detection as manual draw.
      // Copying from an L-shaped floor plan should also surface the split
      // prompt so the user gets clean rectangular sections by default.
      maybeOfferSplit(created);
    } catch (e) { setError(e.message); }
  }

  // Offer split for L (1 reflex) and U (2 reflex); show "too complex" toast
  // for 3+ reflex corners; do nothing for clean convex shapes.
  function maybeOfferSplit(section) {
    const reflexCount = countReflexCorners(section.corners || []);
    if (reflexCount === 0) return;
    if (reflexCount >= 3) {
      showToast('Too complex to auto-split — please draw sections manually.');
      return;
    }
    setSplitPrompt(section);
  }

  // ---- viewport persistence ----
  const lastSavedViewport = useRef(viewport);
  useEffect(() => {
    const t = setTimeout(() => {
      const s = lastSavedViewport.current;
      if (s.panX === viewport.panX && s.panY === viewport.panY && s.zoom === viewport.zoom) return;
      lastSavedViewport.current = viewport;
      onProjectSettingsChange?.({
        viewport_pan_x: viewport.panX, viewport_pan_y: viewport.panY, viewport_zoom: viewport.zoom,
      });
    }, 500);
    return () => clearTimeout(t);
  }, [viewport, onProjectSettingsChange]);

  useEffect(() => {
    function measure() {
      if (wrapRef.current) setCanvasSize({ w: wrapRef.current.clientWidth, h: fullscreen ? window.innerHeight - 80 : CANVAS_HEIGHT });
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [fullscreen]);

  // ---- API helpers ----
  async function patchSection(sid, patch) {
    setSections((cur) => cur.map((s) => s.id === sid ? { ...s, ...patch } : s));
    try {
      const updated = await api.updateRoofSection(projectId, sid, patch);
      setSections((cur) => cur.map((s) => s.id === sid ? updated : s));
      onMaterialsChanged?.();
    } catch (e) { setError(e.message); }
  }
  async function patchEdge(sid, eid, patch) {
    setSections((cur) => cur.map((s) => s.id === sid ? {
      ...s,
      edges: (s.edges || []).map((e) => e.id === eid ? { ...e, ...patch } : e),
    } : s));
    try {
      const updated = await api.updateRoofSectionEdge(projectId, sid, eid, patch);
      setSections((cur) => cur.map((s) => s.id === sid ? {
        ...s,
        edges: (s.edges || []).map((e) => e.id === eid ? updated : e),
      } : s));
      onMaterialsChanged?.();
    } catch (e) { setError(e.message); }
  }
  async function deleteSection(sid) {
    if (!confirm('Delete this roof section?')) return;
    try {
      await api.deleteRoofSection(projectId, sid);
      setSections((cur) => cur.filter((s) => s.id !== sid));
      if (selectedSectionId === sid) setSelectedSectionId(null);
      onMaterialsChanged?.();
    } catch (e) { setError(e.message); }
  }
  async function createSectionFromCorners(corners) {
    try {
      const created = await api.createRoofSection(projectId, {
        section_name: `Section ${sections.length + 1}`,
        corners,
        pitch: '6:12',
      });
      setSections((cur) => [...cur, created]);
      setSelectedSectionId(created.id);
      onMaterialsChanged?.();
      maybeOfferSplit(created);
    } catch (e) { setError(e.message); }
  }

  async function applyAutoSplit(original) {
    const reflexCount = countReflexCorners(original.corners || []);
    if (reflexCount >= 3) {
      showToast('Too complex to auto-split — please draw sections manually.');
      setSplitPrompt(null);
      return;
    }
    if (reflexCount === 2) {
      return applyUShapeSplit(original);
    }
    const split = computeAutoSplit(original.corners || []);
    if (!split) {
      showToast('Could not determine a clean split for this shape.');
      setSplitPrompt(null);
      return;
    }
    // Decide which piece is Main vs Wing by area. The larger piece is the
    // Main Roof and its ridge runs along its own long axis. The Wing Roof's
    // ridge is perpendicular to the shared edge so the two ridges actually
    // intersect — which is what the valley line needs to terminate at.
    const areaA = polygonArea(split.polyA);
    const areaB = polygonArea(split.polyB);
    const mainCorners = areaA >= areaB ? split.polyA : split.polyB;
    const wingCorners = areaA >= areaB ? split.polyB : split.polyA;
    // Ridge direction = long axis of EACH section's own bounding box. For a
    // tall narrow piece the ridge runs vertical; for a wide short piece it
    // runs horizontal. Square pieces (a rare tie after a clean L-split) get
    // tie-broken perpendicular to Main so the two ridges actually cross —
    // otherwise the valley would degenerate to "along the shared edge".
    const mainDir = preferredRidgeDir(mainCorners, 'horizontal');
    const wingDir = preferredRidgeDir(wingCorners, mainDir === 'horizontal' ? 'vertical' : 'horizontal');
    try {
      const a = await api.createRoofSection(projectId, {
        section_name: 'Main Roof',
        corners: mainCorners,
        pitch: original.pitch,
        ridge_direction: mainDir,
      });
      const b = await api.createRoofSection(projectId, {
        section_name: 'Wing Roof',
        corners: wingCorners,
        pitch: original.pitch,
        ridge_direction: wingDir,
      });
      await api.deleteRoofSection(projectId, original.id);
      setSections((cur) => {
        const filtered = cur.filter((s) => s.id !== original.id);
        return [...filtered, a, b];
      });
      setSelectedSectionId(a.id);
      setSplitPrompt(null);
      showToast('Split into 2 sections — valley detected automatically');
      onMaterialsChanged?.();
    } catch (e) { setError(e.message); setSplitPrompt(null); }
  }

  async function applyUShapeSplit(original) {
    const result = computeUShapeSplit(original.corners || []);
    if (!result) {
      showToast('Could not determine a clean split for this U-shape.');
      setSplitPrompt(null);
      return;
    }
    // Largest-area piece becomes Main Roof (the connector spanning the U's
    // base). Its ridge runs along its own long axis. The two smaller pieces
    // are wings with ridges perpendicular to Main so each forms a valley
    // against it. Wings are sorted along Main's perpendicular axis so the
    // left/right labels track the on-canvas position.
    const pieces = result.pieces.map((corners) => ({
      corners,
      area: polygonArea(corners),
      bbox: bboxOf(corners),
    }));
    pieces.sort((a, b) => b.area - a.area);
    const main = pieces[0];
    const wings = [pieces[1], pieces[2]];
    const mainDir = preferredRidgeDir(main.corners, 'horizontal');
    const wingDir = mainDir === 'horizontal' ? 'vertical' : 'horizontal';
    if (mainDir === 'horizontal') {
      wings.sort((a, b) => (a.bbox.minX + a.bbox.maxX) - (b.bbox.minX + b.bbox.maxX));
    } else {
      wings.sort((a, b) => (a.bbox.minY + a.bbox.maxY) - (b.bbox.minY + b.bbox.maxY));
    }
    try {
      const mainSec = await api.createRoofSection(projectId, {
        section_name: 'Main Roof',
        corners: main.corners,
        pitch: original.pitch,
        ridge_direction: mainDir,
      });
      const leftSec = await api.createRoofSection(projectId, {
        section_name: 'Left Wing',
        corners: wings[0].corners,
        pitch: original.pitch,
        ridge_direction: wingDir,
      });
      const rightSec = await api.createRoofSection(projectId, {
        section_name: 'Right Wing',
        corners: wings[1].corners,
        pitch: original.pitch,
        ridge_direction: wingDir,
      });
      await api.deleteRoofSection(projectId, original.id);
      setSections((cur) => {
        const filtered = cur.filter((s) => s.id !== original.id);
        return [...filtered, mainSec, leftSec, rightSec];
      });
      setSelectedSectionId(mainSec.id);
      setSplitPrompt(null);
      showToast('Split into 3 sections — valleys detected automatically');
      onMaterialsChanged?.();
    } catch (e) { setError(e.message); setSplitPrompt(null); }
  }

  // ---- AI extraction handlers ----
  async function uploadTrussPdf(file) {
    if (!file) return;
    try {
      const r = await api.uploadTrussPdf(projectId, file);
      onProjectSettingsChange?.({ truss_pdf_filename: r?.truss_pdf_filename || `projects/${projectId}/truss.pdf` });
      showToast('Truss layout uploaded');
    } catch (e) { setError(e.message); }
  }
  async function deleteTrussPdf() {
    if (!confirm('Remove the engineered truss layout PDF?')) return;
    try {
      await api.deleteTrussPdf(projectId);
      onProjectSettingsChange?.({ truss_pdf_filename: null });
      showToast('Truss layout removed');
    } catch (e) { setError(e.message); }
  }
  async function runExtract() {
    if (!hasAnyPdf || extracting) return;
    setExtracting(true);
    setExtractError('');
    setExtractStage('Reading roof plan…');
    const stageTimer = setTimeout(() => setExtractStage('Analyzing measurements…'), 4000);
    try {
      const out = await api.extractRoofData(projectId);
      if (!out.data) {
        setExtractError(out.error || 'Could not read roof data from this plan');
        setExtracting(false);
        clearTimeout(stageTimer);
        return;
      }
      // Default all extracted fields to "use" (checked); user can uncheck per row.
      const d = out.data;
      const defaults = {
        extracted_pitch: d.pitch != null,
        extracted_sheathing_sf: d.sheathing_area_sf != null,
        extracted_valley_lf: d.valley_lf != null,
        extracted_ridge_lf: d.ridge_lf != null,
        extracted_hip_lf: d.hip_ridge_lf != null,
        extracted_fascia_lf: d.fascia_lf != null,
        roof_width_ft: d.roof_width_ft != null,
        roof_depth_ft: d.roof_depth_ft != null,
      };
      setExtractFieldsChecked(defaults);
      setExtractResult(out);
    } catch (e) {
      setExtractError(e.message || 'Extraction failed');
    } finally {
      setExtracting(false);
      clearTimeout(stageTimer);
    }
  }
  async function applyExtracted() {
    if (!extractResult?.data) return;
    const d = extractResult.data;
    const body = {};
    if (extractFieldsChecked.extracted_pitch && d.pitch) body.extracted_pitch = d.pitch;
    if (extractFieldsChecked.extracted_sheathing_sf && d.sheathing_area_sf != null) body.extracted_sheathing_sf = d.sheathing_area_sf;
    if (extractFieldsChecked.extracted_valley_lf && d.valley_lf != null) body.extracted_valley_lf = d.valley_lf;
    if (extractFieldsChecked.extracted_ridge_lf && d.ridge_lf != null) body.extracted_ridge_lf = d.ridge_lf;
    if (extractFieldsChecked.extracted_hip_lf && d.hip_ridge_lf != null) body.extracted_hip_lf = d.hip_ridge_lf;
    if (extractFieldsChecked.extracted_fascia_lf && d.fascia_lf != null) body.extracted_fascia_lf = d.fascia_lf;
    if (body.extracted_pitch && extractApplyPitchToSections) body.apply_pitch_to_sections = true;
    if (Object.keys(body).length === 0) { setExtractResult(null); return; }
    try {
      await api.applyExtractedRoofData(projectId, body);
      // Reflect updated extracted_* on local projectSettings so the badge UI
      // refreshes without a full project refetch.
      const settingsPatch = { ...body };
      delete settingsPatch.apply_pitch_to_sections;
      onProjectSettingsChange?.(settingsPatch);
      // If we pushed pitch onto existing sections, refetch them.
      if (body.apply_pitch_to_sections) await loadAll();
      onMaterialsChanged?.();
      showToast('Roof data applied from PDF');
      setExtractResult(null);
    } catch (e) {
      setExtractError(e.message);
    }
  }
  async function clearExtracted() {
    if (!confirm('Clear all extracted roof values? The material list will revert to polygon-calculated quantities.')) return;
    try {
      await api.clearExtractedRoofData(projectId);
      onProjectSettingsChange?.({
        extracted_pitch: null,
        extracted_sheathing_sf: null,
        extracted_valley_lf: null,
        extracted_ridge_lf: null,
        extracted_hip_lf: null,
        extracted_fascia_lf: null,
      });
      onMaterialsChanged?.();
      showToast('Extracted values cleared');
    } catch (e) { setError(e.message); }
  }

  async function patchLegacyRoof(patch) {
    try {
      if (!legacyRoof) {
        await api.createRoof(projectId, {
          width_ft: 0, depth_ft: 0,
          pitch: '6:12',
          sheathing_type: patch.sheathing_type || 'plywood_1_2_csp',
          rafter_spacing: patch.rafter_spacing || '24_oc',
        });
      }
      const updated = await api.updateRoof(projectId, patch);
      setLegacyRoof(updated);
      onMaterialsChanged?.();
    } catch (e) { setError(e.message); }
  }

  // ---- snap during drawing ----
  // Find closest corner / edge point on existing sections within SNAP_FT.
  // Returns { x, y } in world coords, or null.
  function findSnapPoint(world) {
    let best = null;
    for (const s of sections) {
      const corners = (s.corners || []).map((c) => ({ x: Number(c.x), y: Number(c.y) }));
      // corner snap
      for (const c of corners) {
        const d = Math.hypot(world.x - c.x, world.y - c.y);
        if (d <= SNAP_FT && (best == null || d < best.d)) best = { d, x: c.x, y: c.y };
      }
      // edge snap (perpendicular foot)
      for (let i = 0; i < corners.length; i++) {
        const a = corners[i], b = corners[(i + 1) % corners.length];
        const r = distPointToSegment(world.x, world.y, a.x, a.y, b.x, b.y);
        if (r.d <= SNAP_FT && (best == null || r.d < best.d)) best = { d: r.d, x: r.cx, y: r.cy };
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  // ---- connected-corner mapping ----
  // Build a map sid → [{ idx, links: [{ sid, idx }] }] of corners that
  // coincide (within CONNECT_FT) with corners in OTHER sections. Used during
  // corner drag to move shared corners together so valleys stay aligned.
  function findConnectedCorners(sid, idx) {
    const sec = sections.find((s) => s.id === sid);
    if (!sec) return [];
    const c = sec.corners?.[idx];
    if (!c) return [];
    const links = [];
    for (const other of sections) {
      if (other.id === sid) continue;
      (other.corners || []).forEach((oc, oi) => {
        if (Math.hypot(Number(oc.x) - Number(c.x), Number(oc.y) - Number(c.y)) <= CONNECT_FT) {
          links.push({ sid: other.id, idx: oi });
        }
      });
    }
    return links;
  }

  // ---- mouse helpers ----
  function getMouse(e) {
    const r = canvasRef.current.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }
  function snappedWorld(sx, sy) {
    const w = screenToWorld(sx, sy, viewport);
    return { x: snapHalf(w.x), y: snapHalf(w.y) };
  }
  function hitTest(sx, sy) {
    for (const s of sections) {
      const { corners, ccw, expanded } = sectionGeom(s, scaleFtPerGrid);
      // corners (wall corners are draggable)
      for (let i = 0; i < corners.length; i++) {
        const cs = worldToScreen(corners[i].x, corners[i].y, viewport);
        if (Math.hypot(cs.x - sx, cs.y - sy) <= CORNER_HIT_PX) {
          return { kind: 'corner', sid: s.id, idx: i };
        }
      }
      // overhang handles at expanded edge midpoints
      for (let i = 0; i < expanded.length; i++) {
        const a = expanded[i], b = expanded[(i + 1) % expanded.length];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const { nx, ny } = edgeOutwardNormal(expanded, i, ccw);
        const ms = worldToScreen(mid.x, mid.y, viewport);
        const hx = ms.x + nx * OVERHANG_HANDLE_OFFSET_PX;
        const hy = ms.y + ny * OVERHANG_HANDLE_OFFSET_PX;
        if (Math.hypot(hx - sx, hy - sy) <= OVERHANG_HANDLE_PX) {
          return { kind: 'overhang', sid: s.id, idx: i };
        }
      }
      // expanded edges (clickable for Gable/Hip popup)
      for (let i = 0; i < expanded.length; i++) {
        const a = expanded[i], b = expanded[(i + 1) % expanded.length];
        const aS = worldToScreen(a.x, a.y, viewport);
        const bS = worldToScreen(b.x, b.y, viewport);
        const r = distPointToSegment(sx, sy, aS.x, aS.y, bS.x, bS.y);
        if (r.d <= EDGE_HIT_PX) {
          return { kind: 'edge', sid: s.id, idx: i };
        }
      }
    }
    for (const s of sections) {
      const { expanded } = sectionGeom(s, scaleFtPerGrid);
      const w = screenToWorld(sx, sy, viewport);
      if (pointInPolygon(w.x, w.y, expanded)) {
        return { kind: 'body', sid: s.id };
      }
    }
    return null;
  }

  function shouldStartPan(e) {
    // Pan tool active OR space held OR middle-click OR (ctrl + empty canvas).
    if (tool === 'pan') return true;
    if (spaceDown.current) return true;
    if (e.button === 1) return true;
    if (e.button === 0 && ctrlDown.current) return true;
    return false;
  }

  function onMouseDown(e) {
    const { sx, sy } = getMouse(e);
    if (shouldStartPan(e)) {
      e.preventDefault();
      panState.current = { active: true, startX: e.clientX, startY: e.clientY, basePan: { x: viewport.panX, y: viewport.panY } };
      return;
    }
    if (e.button !== 0) return;
    if (tool === 'draw_section') {
      // Use snap point if active, otherwise grid-snapped world.
      const w = screenToWorld(sx, sy, viewport);
      const snap = findSnapPoint(w);
      const placed = snap || { x: snapHalf(w.x), y: snapHalf(w.y) };
      setDraftCorners((cur) => [...cur, placed]);
      return;
    }
    const hit = hitTest(sx, sy);
    if (!hit) {
      setSelectedSectionId(null);
      setSelectedCornerKey(null);
      setSelectedEdgeKey(null);
      return;
    }
    if (hit.kind === 'corner') {
      setSelectedSectionId(hit.sid);
      setSelectedCornerKey(`${hit.sid}:${hit.idx}`);
      setSelectedEdgeKey(null);
      const links = findConnectedCorners(hit.sid, hit.idx);
      dragState.current = { active: true, type: 'corner', sid: hit.sid, idx: hit.idx, links, moved: false };
    } else if (hit.kind === 'overhang') {
      setSelectedSectionId(hit.sid);
      setSelectedEdgeKey(`${hit.sid}:${hit.idx}`);
      setSelectedCornerKey(null);
      dragState.current = { active: true, type: 'overhang', sid: hit.sid, idx: hit.idx, moved: false };
    } else if (hit.kind === 'edge') {
      setSelectedSectionId(hit.sid);
      setSelectedEdgeKey(`${hit.sid}:${hit.idx}`);
      setSelectedCornerKey(null);
    } else {
      setSelectedSectionId(hit.sid);
      setSelectedCornerKey(null);
      setSelectedEdgeKey(null);
    }
  }

  function onMouseMove(e) {
    const { sx, sy } = getMouse(e);
    if (panState.current.active) {
      setViewport((vp) => ({
        ...vp,
        panX: panState.current.basePan.x + (e.clientX - panState.current.startX),
        panY: panState.current.basePan.y + (e.clientY - panState.current.startY),
      }));
      return;
    }
    const w = screenToWorld(sx, sy, viewport);
    setHoverWorld(w);
    if (tool === 'draw_section') {
      const snap = findSnapPoint(w);
      setSnappedHover(snap);
    } else if (snappedHover) {
      setSnappedHover(null);
    }
    const ds = dragState.current;
    if (!ds.active) return;
    if (ds.type === 'corner') {
      const placed = (() => {
        const snap = findSnapPoint(w);
        return snap || { x: snapHalf(w.x), y: snapHalf(w.y) };
      })();
      setSections((cur) => cur.map((s) => {
        if (s.id === ds.sid) {
          const corners = (s.corners || []).map((c, i) =>
            i === ds.idx ? { x: placed.x, y: placed.y } : { x: Number(c.x), y: Number(c.y) }
          );
          return { ...s, corners };
        }
        // Connected corners get moved in sync to keep valleys aligned.
        const link = ds.links?.find((l) => l.sid === s.id);
        if (link) {
          const corners = (s.corners || []).map((c, i) =>
            i === link.idx ? { x: placed.x, y: placed.y } : { x: Number(c.x), y: Number(c.y) }
          );
          return { ...s, corners };
        }
        return s;
      }));
      ds.moved = true;
    } else if (ds.type === 'overhang') {
      const sec = sections.find((s) => s.id === ds.sid);
      if (!sec) return;
      const { corners, ccw, expanded } = sectionGeom(sec, scaleFtPerGrid);
      // Drag is interpreted in expanded-polygon space (handle sits there).
      const a = expanded[ds.idx], b = expanded[(ds.idx + 1) % expanded.length];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const { nx, ny } = edgeOutwardNormal(corners, ds.idx, ccw);
      // Existing overhang for this edge plus the projected delta in world units.
      const e = sec.edges.find((ee) => Number(ee.edge_index) === ds.idx);
      const cur = Number(e?.overhang_ft ?? 1.5);
      const project = (w.x - mid.x) * nx + (w.y - mid.y) * ny;
      const oh = Math.max(0, Math.min(4, snapQuarter((cur + project) * scaleFtPerGrid)));
      setSections((curSecs) => curSecs.map((s) => {
        if (s.id !== ds.sid) return s;
        return {
          ...s,
          edges: (s.edges || []).map((ee) =>
            Number(ee.edge_index) === ds.idx ? { ...ee, overhang_ft: oh } : ee
          ),
        };
      }));
      ds.lastOverhang = oh;
      ds.moved = true;
      setOverhangDragLabel({ sx, sy, oh });
    }
  }

  function onMouseUp() {
    if (panState.current.active) {
      panState.current.active = false;
      return;
    }
    const ds = dragState.current;
    if (!ds.active) return;
    if (ds.type === 'corner' && ds.moved) {
      // Save the dragged section AND every linked section.
      const affectedIds = new Set([ds.sid, ...((ds.links || []).map((l) => l.sid))]);
      for (const sid of affectedIds) {
        const sec = sections.find((s) => s.id === sid);
        if (sec) patchSection(sid, { corners: sec.corners });
      }
    } else if (ds.type === 'overhang' && ds.moved) {
      const sec = sections.find((s) => s.id === ds.sid);
      const edge = sec?.edges?.find((e) => Number(e.edge_index) === ds.idx);
      if (edge) patchEdge(ds.sid, edge.id, { overhang_ft: ds.lastOverhang ?? 1.5 });
      setOverhangDragLabel(null);
    }
    dragState.current = { active: false, type: null };
  }

  function onWheel(e) {
    // Plain scroll is allowed to scroll the page. Only Ctrl/Meta zooms.
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const { sx, sy } = getMouse(e);
    const oldZoom = viewport.zoom;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * factor));
    if (newZoom === oldZoom) return;
    const w = screenToWorld(sx, sy, viewport);
    const newPanX = sx - w.x * BASE_GRID_PX * newZoom;
    const newPanY = sy - w.y * BASE_GRID_PX * newZoom;
    setViewport({ panX: newPanX, panY: newPanY, zoom: newZoom });
  }

  // ---- keyboard ----
  useEffect(() => {
    function onKey(e) {
      if (e.type === 'keydown') {
        if (e.key === ' ' || e.code === 'Space') spaceDown.current = true;
        if (e.key === 'Control' || e.key === 'Meta') ctrlDown.current = true;
        if (tool === 'draw_section') {
          if (e.key === 'Enter') {
            if (draftCorners.length >= 3) createSectionFromCorners(draftCorners);
            setDraftCorners([]); setTool('select');
          } else if (e.key === 'Escape') {
            setDraftCorners([]); setTool('select');
          } else if (e.key === 'Backspace') {
            setDraftCorners((cur) => cur.slice(0, -1));
          }
        }
        if (e.key === 'Escape' && fullscreen) setFullscreen(false);
      } else {
        if (e.key === ' ' || e.code === 'Space') spaceDown.current = false;
        if (e.key === 'Control' || e.key === 'Meta') ctrlDown.current = false;
      }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, draftCorners, fullscreen]);

  // ---- drawing ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.w * dpr;
    canvas.height = canvasSize.h * dpr;
    canvas.style.width = `${canvasSize.w}px`;
    canvas.style.height = `${canvasSize.h}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(ctx, canvasSize, viewport, {
      sections, selectedSectionId, selectedCornerKey, selectedEdgeKey,
      tool, draftCorners, hoverWorld, snappedHover, scale: scaleFtPerGrid,
      rafterSpacing: legacyRoof?.rafter_spacing || '24_oc',
    });
  }, [canvasSize, viewport, sections, selectedSectionId, selectedCornerKey, selectedEdgeKey, tool, draftCorners, hoverWorld, snappedHover, scaleFtPerGrid, legacyRoof]);

  // ---- selected derived ----
  const selectedSection = sections.find((s) => s.id === selectedSectionId) || null;
  const selectedEdge = (() => {
    if (!selectedEdgeKey) return null;
    const [sid, idx] = selectedEdgeKey.split(':');
    const sec = sections.find((s) => s.id === Number(sid));
    if (!sec) return null;
    return (sec.edges || []).find((e) => Number(e.edge_index) === Number(idx)) || null;
  })();
  const edgePopupPos = (() => {
    if (!selectedEdge || !selectedSection) return null;
    const { expanded } = sectionGeom(selectedSection, scaleFtPerGrid);
    const i = Number(selectedEdge.edge_index);
    if (i < 0 || i >= expanded.length) return null;
    const a = expanded[i], b = expanded[(i + 1) % expanded.length];
    const mid = worldToScreen((a.x + b.x) / 2, (a.y + b.y) / 2, viewport);
    return { x: mid.x, y: mid.y };
  })();

  if (loading) return <p className="muted">Loading roof…</p>;

  const cursor = tool === 'pan' ? 'grab'
    : tool === 'draw_section' ? 'crosshair'
    : (panState.current.active ? 'grabbing' : 'default');
  const wrapperStyle = fullscreen
    ? { position: 'fixed', inset: 0, zIndex: 1000, background: 'white', padding: '0.5rem' }
    : {};

  return (
    <div style={wrapperStyle}>
      <RoofToolbar
        tool={tool} setTool={(t) => { setTool(t); setDraftCorners([]); }}
        fullscreen={fullscreen} toggleFullscreen={() => setFullscreen((f) => !f)}
        sectionsCount={sections.length}
        drafting={tool === 'draw_section'}
        draftLen={draftCorners.length}
      />

      <AIExtractionBar
        hasArchPdf={hasArchPdf}
        hasTrussPdf={hasTrussPdf}
        hasAnyExtracted={hasAnyExtracted}
        extracting={extracting}
        onUploadTruss={uploadTrussPdf}
        onDeleteTruss={deleteTrussPdf}
        onExtract={runExtract}
        onClearExtracted={clearExtracted}
      />

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
        <div ref={wrapRef} style={{ flex: 1, position: 'relative', border: '1px solid #E0E0E0', borderRadius: 4, overflow: 'hidden', background: '#FAFAFA' }}>
          <canvas
            ref={canvasRef}
            style={{ display: 'block', cursor }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onWheel={onWheel}
            onContextMenu={(e) => e.preventDefault()}
          />
          {edgePopupPos && selectedEdge && (
            <div style={{
              position: 'absolute',
              left: edgePopupPos.x + 12, top: edgePopupPos.y - 14,
              background: 'white', border: '1px solid #E0E0E0', borderRadius: 6,
              padding: '4px 6px', boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              fontSize: '0.85rem', display: 'flex', gap: 4,
            }}>
              {['gable', 'hip'].map((t) => (
                <button
                  key={t}
                  onClick={() => patchEdge(selectedSection.id, selectedEdge.id, { end_type: t })}
                  className={selectedEdge.end_type === t ? 'primary' : 'secondary'}
                  style={{ padding: '0.15rem 0.5rem', fontSize: '0.85rem', textTransform: 'capitalize' }}
                >{t}</button>
              ))}
            </div>
          )}
          {overhangDragLabel && (
            <div style={{
              position: 'absolute', left: overhangDragLabel.sx + 14, top: overhangDragLabel.sy - 10,
              padding: '2px 6px', background: 'rgba(10,10,10,0.92)', color: 'white',
              fontSize: 11, fontWeight: 600, borderRadius: 4, pointerEvents: 'none',
            }}>Overhang: {Math.round(overhangDragLabel.oh * 12)}"</div>
          )}
          {toast && (
            <div style={{
              position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
              padding: '0.5rem 1rem',
              background: 'rgba(10,10,10,0.92)', color: 'white',
              fontSize: 13, borderRadius: 6, pointerEvents: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)', maxWidth: '80%',
            }}>{toast}</div>
          )}
          {extracting && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'rgba(250,250,250,0.85)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 12, zIndex: 50,
            }}>
              <div style={{
                width: 36, height: 36, border: '3px solid #E0E0E0',
                borderTopColor: '#CC0000', borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }} />
              <div style={{ fontSize: 14, fontWeight: 500, color: '#1A1A1A' }}>
                {extractStage || 'Reading roof plan…'}
              </div>
              <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
            </div>
          )}
          {extractError && !extracting && (
            <div style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
              padding: '0.5rem 0.9rem',
              background: '#FEF2F2', color: '#991B1B',
              border: '1px solid #FECACA', borderRadius: 6,
              fontSize: 13, maxWidth: '80%', boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              zIndex: 51,
            }}>
              {extractError}
              <button
                onClick={() => setExtractError('')}
                style={{
                  marginLeft: 10, background: 'transparent', border: 'none',
                  color: '#991B1B', cursor: 'pointer', fontSize: 14, fontWeight: 700,
                }}
              >×</button>
            </div>
          )}
        </div>

        <div style={{ flex: '0 0 320px' }}>
          {sections.length === 0 && autoCopyTried && !hasFloorPlan ? (
            <EmptyStatePanel onDraw={() => setTool('draw_section')} onRetry={loadAll} />
          ) : selectedSection ? (
            <SectionPanel
              section={selectedSection}
              scale={scaleFtPerGrid}
              onPatch={(patch) => patchSection(selectedSection.id, patch)}
              onPatchEdge={(eid, patch) => patchEdge(selectedSection.id, eid, patch)}
              onDelete={() => deleteSection(selectedSection.id)}
              onClose={() => { setSelectedSectionId(null); setSelectedCornerKey(null); setSelectedEdgeKey(null); }}
              onSplit={() => setSplitPrompt(selectedSection)}
            />
          ) : (
            <ProjectRoofSettingsPanel roof={legacyRoof} onPatch={patchLegacyRoof} />
          )}
        </div>
      </div>

      {splitPrompt && (() => {
        const reflexCount = countReflexCorners(splitPrompt.corners || []);
        const isU = reflexCount === 2;
        return (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
          }}>
            <div className="card" style={{ maxWidth: 480, padding: '1.25rem' }}>
              <strong style={{ fontSize: '1.05rem' }}>
                {isU ? 'U-shape roof detected' : 'Complex roof shape detected'}
              </strong>
              <p style={{ marginTop: '0.5rem' }}>
                {isU
                  ? 'This roof has a U-shape. Split into 3 sections automatically? (Left Wing + Main Roof + Right Wing)'
                  : "This roof section has a complex shape. For an L-shaped or T-shaped house, you'll get better results by drawing two separate rectangular sections that meet at a valley. Would you like to split this into two sections automatically?"}
              </p>
              <div className="row" style={{ marginTop: '1rem' }}>
                <button className="primary" onClick={() => applyAutoSplit(splitPrompt)}>
                  {isU ? 'Split into 3 sections' : 'Split automatically'}
                </button>
                <button className="secondary" onClick={() => setSplitPrompt(null)}>Keep as one</button>
              </div>
            </div>
          </div>
        );
      })()}

      {extractResult?.data && (
        <ExtractionResultModal
          result={extractResult}
          checked={extractFieldsChecked}
          setChecked={setExtractFieldsChecked}
          applyPitchToSections={extractApplyPitchToSections}
          setApplyPitchToSections={setExtractApplyPitchToSections}
          hasSections={sections.length > 0}
          onApply={applyExtracted}
          onCancel={() => setExtractResult(null)}
        />
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}

// ---------- AI extraction bar (above canvas) ----------
function AIExtractionBar({
  hasArchPdf, hasTrussPdf, hasAnyExtracted, extracting,
  onUploadTruss, onDeleteTruss, onExtract, onClearExtracted,
}) {
  const trussInputRef = useRef(null);
  const canExtract = (hasArchPdf || hasTrussPdf) && !extracting;
  const extractTitle = !hasArchPdf && !hasTrussPdf
    ? 'Upload an architectural or truss PDF first'
    : extracting ? 'Extraction in progress…' : 'Extract roof measurements from the uploaded PDF(s)';
  return (
    <div className="card" style={{
      display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center',
      padding: '0.4rem 0.6rem', marginBottom: '0.4rem',
    }}>
      <input
        ref={trussInputRef} type="file" accept="application/pdf" style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUploadTruss(f);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className={hasTrussPdf ? 'secondary' : 'secondary'}
        onClick={() => trussInputRef.current?.click()}
        title={hasTrussPdf
          ? 'Replace the uploaded engineered truss layout PDF'
          : 'Upload your engineered truss layouts for more accurate AI extraction'}
        style={{ padding: '0.4rem 0.7rem', fontSize: '0.85rem' }}
      >
        {hasTrussPdf ? '↻ Replace Truss Layouts' : '⬆ Upload Truss Layouts'}
      </button>
      {hasTrussPdf && (
        <button
          type="button"
          className="secondary"
          onClick={onDeleteTruss}
          title="Remove the engineered truss layout PDF"
          style={{ padding: '0.4rem 0.55rem', fontSize: '0.85rem', color: '#991B1B', borderColor: '#FECACA' }}
        >×</button>
      )}
      <button
        type="button"
        className="primary"
        disabled={!canExtract}
        onClick={onExtract}
        title={extractTitle}
        style={{
          padding: '0.4rem 0.85rem', fontSize: '0.85rem',
          opacity: canExtract ? 1 : 0.55, cursor: canExtract ? 'pointer' : 'not-allowed',
        }}
      >✨ Extract from PDF</button>
      <span className="muted" style={{ fontSize: '0.8rem', marginLeft: '0.25rem' }}>
        {hasTrussPdf && hasArchPdf
          ? 'Using both PDFs (architectural + truss).'
          : hasTrussPdf
            ? 'Using truss layouts.'
            : hasArchPdf
              ? 'Using architectural PDF. Upload truss layouts for higher accuracy.'
              : 'Upload an architectural or truss PDF to enable.'}
      </span>
      <span style={{ flex: 1 }} />
      {hasAnyExtracted && (
        <button
          type="button"
          onClick={onClearExtracted}
          title="Revert roof line items back to polygon-calculated quantities"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#6B7280', fontSize: '0.8rem', textDecoration: 'underline',
            padding: '0.25rem 0.5rem',
          }}
        >Clear extracted values</button>
      )}
    </div>
  );
}

// ---------- Extraction confirmation modal ----------
function ExtractionResultModal({
  result, checked, setChecked, applyPitchToSections, setApplyPitchToSections,
  hasSections, onApply, onCancel,
}) {
  const d = result.data;
  const conf = d.confidence || 'medium';
  const confColor =
    conf === 'high' ? { bg: '#DCFCE7', fg: '#166534', border: '#86EFAC' } :
    conf === 'low'  ? { bg: '#FFEDD5', fg: '#9A3412', border: '#FDBA74' } :
                      { bg: '#FEF9C3', fg: '#854D0E', border: '#FDE68A' };
  const rows = [
    { key: 'extracted_pitch',         label: 'Pitch',           value: d.pitch,             unit: '' },
    { key: 'extracted_sheathing_sf',  label: 'Sheathing area',  value: d.sheathing_area_sf, unit: 'sf' },
    { key: 'extracted_valley_lf',     label: 'Valley length',   value: d.valley_lf,         unit: 'lf' },
    { key: 'extracted_ridge_lf',      label: 'Ridge length',    value: d.ridge_lf,          unit: 'lf' },
    { key: 'extracted_hip_lf',        label: 'Hip ridge',       value: d.hip_ridge_lf,      unit: 'lf' },
    { key: 'extracted_fascia_lf',     label: 'Fascia',          value: d.fascia_lf,         unit: 'lf' },
    { key: 'roof_width_ft',           label: 'Roof width',      value: d.roof_width_ft,     unit: 'ft' },
    { key: 'roof_depth_ft',           label: 'Roof depth',      value: d.roof_depth_ft,     unit: 'ft' },
  ];
  const anyValueAvailable = rows.some((r) => r.value != null);
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200,
    }}>
      <div className="card" style={{ maxWidth: 560, width: '100%', padding: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '0.75rem' }}>
          <strong style={{ fontSize: '1.05rem', flex: 1 }}>Roof Data Extracted</strong>
          <span style={{
            padding: '2px 10px', fontSize: 11, fontWeight: 600,
            color: confColor.fg, background: confColor.bg,
            border: `1px solid ${confColor.border}`, borderRadius: 4,
            textTransform: 'capitalize',
          }}>{conf} confidence</span>
        </div>
        {!anyValueAvailable && (
          <p className="muted" style={{ marginTop: 0 }}>
            No clear roof measurements were found on this plan. You can still apply nothing, or cancel and upload a truss layout for better results.
          </p>
        )}
        {anyValueAvailable && (
          <table style={{ width: '100%', fontSize: '0.9rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Field</th>
                <th style={{ textAlign: 'left' }}>Extracted</th>
                <th style={{ width: 60, textAlign: 'center' }}>Use?</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isPresent = r.value != null;
                const disabled = !isPresent;
                return (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td>{isPresent
                      ? <strong>{typeof r.value === 'number' ? r.value.toLocaleString() : r.value}{r.unit ? ` ${r.unit}` : ''}</strong>
                      : <span className="muted">—</span>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={!!checked[r.key] && isPresent}
                        disabled={disabled}
                        onChange={(e) => setChecked({ ...checked, [r.key]: e.target.checked })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {checked.extracted_pitch && d.pitch && hasSections && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: '0.75rem', fontSize: '0.85rem', textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: '#1A1A1A' }}>
            <input type="checkbox" checked={applyPitchToSections}
              onChange={(e) => setApplyPitchToSections(e.target.checked)} />
            Also update pitch on existing roof sections ({d.pitch})
          </label>
        )}
        {d.notes && (
          <div style={{
            marginTop: '0.85rem', padding: '0.6rem 0.75rem',
            background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 6,
            fontSize: '0.85rem', color: '#374151', lineHeight: 1.45,
          }}>
            <strong style={{ display: 'block', marginBottom: 4, color: '#1A1A1A' }}>Notes from extraction</strong>
            {d.notes}
          </div>
        )}
        <div className="row" style={{ marginTop: '1rem' }}>
          <button className="primary" onClick={onApply} disabled={!anyValueAvailable}>
            Apply to Roof
          </button>
          <button className="secondary" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ---------- toolbar ----------
function RoofToolbar({ tool, setTool, fullscreen, toggleFullscreen, sectionsCount, drafting, draftLen }) {
  const tools = [
    { key: 'select',       label: 'Select',       icon: ICONS.cursor, tooltip: 'Select & drag (default)' },
    { key: 'pan',          label: 'Pan',          icon: ICONS.hand,   tooltip: 'Click and drag to pan the view' },
    { key: 'draw_section', label: 'Draw Section', icon: ICONS.pencil, tooltip: 'Click corners then Enter to close' },
  ];
  return (
    <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center', padding: '0.4rem', marginBottom: '0.4rem' }}>
      {tools.map((t) => {
        const active = tool === t.key;
        return (
          <button
            key={t.key}
            type="button"
            title={t.tooltip}
            onClick={() => setTool(t.key)}
            style={{
              flex: '0 0 auto',
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.4rem 0.7rem',
              background: active ? '#CC0000' : 'white',
              color: active ? 'white' : '#1A1A1A',
              border: active ? '1px solid #CC0000' : '1px solid #E0E0E0',
              cursor: 'pointer',
              borderRadius: 4,
            }}
          >
            <Icon path={t.icon} stroke={active ? 'white' : '#1A1A1A'} />
            <span style={{ fontSize: '0.85rem' }}>{t.label}</span>
          </button>
        );
      })}
      <span className="muted" style={{ marginLeft: '0.5rem', fontSize: '0.85rem' }}>
        {sectionsCount} section{sectionsCount === 1 ? '' : 's'}
        {drafting && ` · ${draftLen} corner${draftLen === 1 ? '' : 's'} placed — Enter to close, Esc to cancel, Backspace to undo`}
      </span>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
        onClick={toggleFullscreen}
        style={{
          flex: '0 0 auto',
          display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
          padding: '0.4rem 0.7rem',
          background: fullscreen ? '#CC0000' : 'white',
          color: fullscreen ? 'white' : '#1A1A1A',
          border: fullscreen ? '1px solid #CC0000' : '1px solid #E0E0E0',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        <Icon path={ICONS.expand} stroke={fullscreen ? 'white' : '#1A1A1A'} />
        <span style={{ fontSize: '0.85rem' }}>{fullscreen ? 'Exit' : 'Fullscreen'}</span>
      </button>
    </div>
  );
}

function Icon({ path, stroke = '#1A1A1A', size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block' }}>
      <path d={path} />
    </svg>
  );
}
const ICONS = {
  cursor: 'M4 3 L4 17 L9 13 L12 19 L14.5 17.5 L11.5 11.5 L17 11 Z',
  hand:   'M7 11 V6 a1.5 1.5 0 0 1 3 0 V11 M10 11 V4 a1.5 1.5 0 0 1 3 0 V11 M13 11 V5 a1.5 1.5 0 0 1 3 0 V13 M16 13 V8 a1.5 1.5 0 0 1 3 0 V14 a6 6 0 0 1 -6 6 H11 a4 4 0 0 1 -3.5 -2 L4 12 a1.7 1.7 0 0 1 3 -1.5 L8 12',
  pencil: 'M4 20 L4 16 L16 4 L20 8 L8 20 Z M14 6 L18 10',
  expand: 'M4 9 V4 H9 M20 9 V4 H15 M4 15 V20 H9 M20 15 V20 H15',
};

// ---------- side panels ----------
function SectionPanel({ section, scale, onPatch, onPatchEdge, onDelete, onClose, onSplit }) {
  const g = sectionGeom(section, scale);
  const complex = isComplexShape(section.corners);
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: '0.5rem' }}>
        <strong style={{ flex: 1 }}>Roof section #{section.id}</strong>
        <button className="secondary" style={{ flex: '0 0 auto', padding: '0.25rem 0.5rem' }} onClick={onClose}>×</button>
      </div>
      <label>Section name</label>
      <input
        defaultValue={section.section_name}
        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== section.section_name) onPatch({ section_name: v }); }}
      />
      <label>Pitch</label>
      <select value={section.pitch} onChange={(e) => onPatch({ pitch: e.target.value })}>
        {PITCH_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <label>Ridge direction</label>
      <div className="row" style={{ gap: '0.25rem', marginTop: '0.2rem' }}>
        {[
          { v: 'auto', label: 'Auto' },
          { v: 'horizontal', label: '↔ Horizontal' },
          { v: 'vertical', label: '↕ Vertical' },
        ].map((o) => (
          <button
            key={o.v}
            className={(section.ridge_direction || 'auto') === o.v ? 'primary' : 'secondary'}
            style={{ flex: 1, padding: '0.3rem', fontSize: '0.8rem' }}
            onClick={() => onPatch({ ridge_direction: o.v })}
          >{o.label}</button>
        ))}
      </div>
      <p className="muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
        Footprint: <strong>{g.footprintArea.toLocaleString(undefined, { maximumFractionDigits: 0 })} sf</strong>
        {' · '}
        Surface: <strong>{g.surfaceArea.toLocaleString(undefined, { maximumFractionDigits: 0 })} sf</strong>
      </p>
      <p className="muted" style={{ marginTop: '0.75rem', marginBottom: '0.25rem', fontSize: '0.85rem' }}>
        Edges (click an edge on the canvas for Gable/Hip)
      </p>
      <table style={{ fontSize: '0.85rem' }}>
        <thead><tr><th>#</th><th>End</th><th>Overhang (in)</th></tr></thead>
        <tbody>
          {(section.edges || []).slice().sort((a, b) => Number(a.edge_index) - Number(b.edge_index)).map((e) => (
            <tr key={e.id}>
              <td>{e.edge_index}</td>
              <td>
                <select value={e.end_type} onChange={(ev) => onPatchEdge(e.id, { end_type: ev.target.value })}>
                  <option value="gable">Gable</option>
                  <option value="hip">Hip</option>
                </select>
              </td>
              <td>
                <input
                  type="number" step="3" min="0" max="48"
                  style={{ width: '4rem' }}
                  defaultValue={Math.round(Number(e.overhang_ft) * 12)}
                  onBlur={(ev) => {
                    const inches = Math.max(0, Math.min(48, Number(ev.target.value) || 0));
                    const ft = inches / 12;
                    if (Math.abs(ft - Number(e.overhang_ft)) > 1e-6) onPatchEdge(e.id, { overhang_ft: ft });
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {complex && onSplit && (
        <button
          className="secondary"
          style={{ marginTop: '0.75rem', width: '100%', borderColor: '#FFB800', color: '#92400E' }}
          onClick={onSplit}
          title="Split into two rectangular sections joined at a valley"
        >Split section…</button>
      )}
      <button className="danger" style={{ marginTop: '0.5rem', width: '100%' }} onClick={onDelete}>Delete this section</button>
    </div>
  );
}

function EmptyStatePanel({ onDraw, onRetry }) {
  return (
    <div className="card">
      <strong>No roof yet</strong>
      <p className="muted" style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
        Roof sections normally auto-copy from your top floor's polygon. Draw your
        Floor 1 polygon first, then come back to the Roof tab — it'll create a
        "Main Roof" section with 18″ overhangs automatically.
      </p>
      <p className="muted" style={{ marginTop: '0.75rem', fontSize: '0.9rem' }}>
        Or skip the auto-copy and start from scratch.
      </p>
      <div className="row" style={{ marginTop: '0.75rem', gap: '0.5rem' }}>
        <button className="primary" onClick={onDraw}>Draw Section manually</button>
        <button className="secondary" onClick={onRetry}>Re-check floor plans</button>
      </div>
    </div>
  );
}

function ProjectRoofSettingsPanel({ roof, onPatch }) {
  return (
    <div className="card">
      <strong>Roof project settings</strong>
      <p className="muted" style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}>Applied across all sections.</p>
      <label>Sheathing</label>
      <select
        value={roof?.sheathing_type || 'plywood_1_2_csp'}
        onChange={(e) => onPatch({ sheathing_type: e.target.value })}
      >{SHEATHING_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      <label>Rafter / truss spacing</label>
      <select
        value={roof?.rafter_spacing || '24_oc'}
        onChange={(e) => onPatch({ rafter_spacing: e.target.value })}
      >{SPACING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      <p className="muted" style={{ marginTop: '0.75rem', fontSize: '0.85rem', marginBottom: 0 }}>
        Click a section on the canvas to edit its name, pitch, and per-edge overhangs / end type.
      </p>
    </div>
  );
}

// ---------- canvas ----------
function drawScene(ctx, size, vp, S) {
  const {
    sections, selectedSectionId, selectedCornerKey, selectedEdgeKey,
    tool, draftCorners, hoverWorld, snappedHover, scale, rafterSpacing,
  } = S;
  ctx.fillStyle = '#FAFAFA';
  ctx.fillRect(0, 0, size.w, size.h);
  // grid
  const step = BASE_GRID_PX * vp.zoom;
  const startX = vp.panX % step;
  const startY = vp.panY % step;
  ctx.lineWidth = 1; ctx.strokeStyle = '#E8E8E8';
  ctx.beginPath();
  for (let x = startX; x < size.w; x += step) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, size.h); }
  for (let y = startY; y < size.h; y += step) { ctx.moveTo(0, y + 0.5); ctx.lineTo(size.w, y + 0.5); }
  ctx.stroke();

  for (const s of sections) {
    drawSection(ctx, s, vp, scale, rafterSpacing,
      s.id === selectedSectionId, selectedCornerKey, selectedEdgeKey);
  }

  // Valley / ridge overlay between sections (solid now per spec).
  drawSharedEdges(ctx, sections, vp, scale);

  // Draft polygon (when adding a new section)
  if (tool === 'draw_section' && draftCorners.length > 0) {
    ctx.strokeStyle = '#CC0000'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (let i = 0; i < draftCorners.length; i++) {
      const c = worldToScreen(draftCorners[i].x, draftCorners[i].y, vp);
      if (i === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y);
    }
    if (hoverWorld) {
      const hp = snappedHover || hoverWorld;
      const hc = worldToScreen(hp.x, hp.y, vp);
      ctx.lineTo(hc.x, hc.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    for (const dc of draftCorners) {
      const c = worldToScreen(dc.x, dc.y, vp);
      ctx.fillStyle = '#CC0000';
      ctx.beginPath(); ctx.arc(c.x, c.y, 5, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Snap indicator (yellow ring) when drawing and a snap point is active.
  if (tool === 'draw_section' && snappedHover) {
    const ss = worldToScreen(snappedHover.x, snappedHover.y, vp);
    ctx.strokeStyle = '#F59E0B'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ss.x, ss.y, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(245, 158, 11, 0.3)';
    ctx.beginPath(); ctx.arc(ss.x, ss.y, 5, 0, Math.PI * 2); ctx.fill();
  }
}

function drawSection(ctx, section, vp, scale, rafterSpacing, selected, selectedCornerKey, selectedEdgeKey) {
  const { corners, edges, ccw, expanded } = sectionGeom(section, scale);
  if (corners.length < 3 || expanded.length < 3) return;

  // Build screen-space paths for both polygons.
  const expScreen = expanded.map((c) => worldToScreen(c.x, c.y, vp));
  const wallScreen = corners.map((c) => worldToScreen(c.x, c.y, vp));

  // Polygon body (roof outline w/ overhangs).
  ctx.fillStyle = 'rgba(59, 130, 246, 0.10)';
  ctx.beginPath();
  for (let i = 0; i < expScreen.length; i++) {
    const p = expScreen[i];
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.fill();

  // Per-edge stroke on the OUTER (overhang) polygon — gable solid, hip dashed.
  for (let i = 0; i < expScreen.length; i++) {
    const a = expScreen[i], b = expScreen[(i + 1) % expScreen.length];
    const e = edges.find((ee) => Number(ee.edge_index) === i);
    const isHip = e?.end_type === 'hip';
    const edgeKey = `${section.id}:${i}`;
    const edgeSelected = edgeKey === selectedEdgeKey;
    ctx.strokeStyle = selected ? '#CC0000' : '#1D4ED8';
    ctx.lineWidth = edgeSelected ? 3 : (selected ? 2.5 : 2);
    ctx.setLineDash(isHip ? [6, 4] : []);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Eave dashed line: the wall corners — inset within the polygon.
  ctx.strokeStyle = '#6B7280';
  ctx.lineWidth = 0.75;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  for (let i = 0; i < wallScreen.length; i++) {
    const p = wallScreen[i];
    if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  // ----- Roof structural lines (clip to expanded polygon for rafters) -----
  const ridge = computeRidgeAndHips(section, scale);

  // Rafter / truss lines: 6 evenly spaced lines perpendicular to ridge,
  // clipped to the expanded polygon.
  if (ridge) {
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < expScreen.length; i++) {
      const p = expScreen[i];
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = '#9CA3AF';
    ctx.lineWidth = 0.75;
    const { bbox, horizontal } = ridge;
    const N = 6;
    for (let k = 1; k <= N; k++) {
      const t = k / (N + 1);
      ctx.beginPath();
      if (horizontal) {
        const x = bbox.minX + (bbox.maxX - bbox.minX) * t;
        const a = worldToScreen(x, bbox.minY - 1, vp);
        const b = worldToScreen(x, bbox.maxY + 1, vp);
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      } else {
        const y = bbox.minY + (bbox.maxY - bbox.minY) * t;
        const a = worldToScreen(bbox.minX - 1, y, vp);
        const b = worldToScreen(bbox.maxX + 1, y, vp);
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }
    ctx.restore();
    // Rafter spacing label near one of the rafters.
    const lbl = rafterSpacing === '16_oc' ? '@ 16" o.c.' : '@ 24" o.c.';
    ctx.font = '500 9px "Segoe UI", -apple-system, sans-serif';
    ctx.fillStyle = '#6B7280';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const labelAnchor = horizontal
      ? worldToScreen(bbox.minX + (bbox.maxX - bbox.minX) / (6 + 1), bbox.minY, vp)
      : worldToScreen(bbox.minX, bbox.minY + (bbox.maxY - bbox.minY) / (6 + 1), vp);
    ctx.fillText(lbl, labelAnchor.x + 4, labelAnchor.y + 4);
  }

  // Hip lines (orange).
  if (ridge && ridge.hipLines.length > 0) {
    ctx.strokeStyle = '#D97706';
    ctx.lineWidth = 1.5;
    for (const h of ridge.hipLines) {
      const a = worldToScreen(h.a.x, h.a.y, vp);
      const b = worldToScreen(h.b.x, h.b.y, vp);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }

  // Ridge line (red, bold).
  if (ridge && (ridge.ridgeStart.x !== ridge.ridgeEnd.x || ridge.ridgeStart.y !== ridge.ridgeEnd.y)) {
    const ra = worldToScreen(ridge.ridgeStart.x, ridge.ridgeStart.y, vp);
    const rb = worldToScreen(ridge.ridgeEnd.x, ridge.ridgeEnd.y, vp);
    ctx.strokeStyle = '#CC0000';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(ra.x, ra.y); ctx.lineTo(rb.x, rb.y); ctx.stroke();
    // Pitch label at midpoint.
    const mx = (ra.x + rb.x) / 2;
    const my = (ra.y + rb.y) / 2;
    ctx.font = '600 10px "Segoe UI", -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const pitchTxt = section.pitch || '6:12';
    const pm = ctx.measureText(pitchTxt);
    ctx.fillRect(mx - pm.width / 2 - 3, my - 14, pm.width + 6, 14);
    ctx.fillStyle = '#CC0000';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(pitchTxt, mx, my - 2);
  }

  // Gable end indicators: small filled triangles at the two corners of each
  // gable end edge, pointing toward the polygon interior (centroid).
  const expCentroid = polygonCentroid(expanded);
  ctx.fillStyle = 'rgba(29, 78, 216, 0.6)';
  for (let i = 0; i < expanded.length; i++) {
    const e = edges.find((ee) => Number(ee.edge_index) === i);
    if (e?.end_type !== 'gable') continue;
    const a = expanded[i], b = expanded[(i + 1) % expanded.length];
    const ends = [a, b];
    for (const corner of ends) {
      const cs = worldToScreen(corner.x, corner.y, vp);
      const towardCentroid = { x: expCentroid.x - corner.x, y: expCentroid.y - corner.y };
      const tlen = Math.hypot(towardCentroid.x, towardCentroid.y) || 1;
      const tx = towardCentroid.x / tlen, ty = towardCentroid.y / tlen;
      const px = -ty, py = tx; // perpendicular
      const tipS = { x: cs.x + tx * 10, y: cs.y + ty * 10 };
      const baseAS = { x: cs.x + tx * 0 + px * 4, y: cs.y + ty * 0 + py * 4 };
      const baseBS = { x: cs.x + tx * 0 - px * 4, y: cs.y + ty * 0 - py * 4 };
      ctx.beginPath();
      ctx.moveTo(tipS.x, tipS.y);
      ctx.lineTo(baseAS.x, baseAS.y);
      ctx.lineTo(baseBS.x, baseBS.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Edge length dimension labels OUTSIDE each edge. Placed in fixed SCREEN
  // pixels beyond the overhang handle so the two never overlap regardless
  // of zoom level (handle center is 14px out + 9px radius = 23px → put the
  // label centerline another ~15px past that).
  ctx.font = '500 10px "Segoe UI", -apple-system, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const LABEL_OFFSET_PX = OVERHANG_HANDLE_OFFSET_PX + OVERHANG_HANDLE_PX + 14;
  for (let i = 0; i < expanded.length; i++) {
    const a = expanded[i], b = expanded[(i + 1) % expanded.length];
    const lenFt = Math.hypot(b.x - a.x, b.y - a.y) * scale;
    if (lenFt < 0.5) continue;
    const midW = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const { nx, ny } = edgeOutwardNormal(expanded, i, ccw);
    const midS = worldToScreen(midW.x, midW.y, vp);
    const lsx = midS.x + nx * LABEL_OFFSET_PX;
    const lsy = midS.y + ny * LABEL_OFFSET_PX;
    const txt = `${lenFt.toFixed(1)}'`;
    const tm = ctx.measureText(txt);
    ctx.fillStyle = 'white';
    ctx.fillRect(lsx - tm.width / 2 - 2, lsy - 7, tm.width + 4, 14);
    ctx.fillStyle = '#1A1A1A';
    ctx.fillText(txt, lsx, lsy);
  }

  // Section name + area + pitch labels at the centroid (of expanded perimeter).
  {
    const cs = worldToScreen(expCentroid.x, expCentroid.y, vp);
    const footprint = polygonArea(expanded) * (scale * scale);
    const surface = footprint * (PITCH_MULT[section.pitch] || PITCH_MULT['6:12']);
    const name = section.section_name || 'Roof Section';
    const areaTxt = `${Math.round(surface).toLocaleString()} sf`;
    const pitchTxt = `${section.pitch} pitch`;

    ctx.font = '600 12px "Segoe UI", -apple-system, sans-serif';
    ctx.textAlign = 'center';
    const nameW = ctx.measureText(name).width;
    ctx.font = '500 11px "Segoe UI", -apple-system, sans-serif';
    const areaW = ctx.measureText(areaTxt).width;
    ctx.font = '500 9px "Segoe UI", -apple-system, sans-serif';
    const pitchW = ctx.measureText(pitchTxt).width;
    const maxW = Math.max(nameW, areaW, pitchW);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(cs.x - maxW / 2 - 5, cs.y - 24, maxW + 10, 50);

    ctx.font = '600 12px "Segoe UI", -apple-system, sans-serif';
    ctx.fillStyle = '#1D4ED8';
    ctx.textBaseline = 'top';
    ctx.fillText(name, cs.x, cs.y - 22);
    ctx.font = '500 11px "Segoe UI", -apple-system, sans-serif';
    ctx.fillText(areaTxt, cs.x, cs.y - 6);
    ctx.font = '500 9px "Segoe UI", -apple-system, sans-serif';
    ctx.fillStyle = '#6B7280';
    ctx.fillText(pitchTxt, cs.x, cs.y + 10);
  }

  // Wall corner handles (the draggable corners). Drawn ON TOP so they remain
  // visible over the rafters and the eave dashed line.
  for (let i = 0; i < wallScreen.length; i++) {
    const p = wallScreen[i];
    const cKey = `${section.id}:${i}`;
    const isSel = cKey === selectedCornerKey;
    ctx.fillStyle = isSel ? '#CC0000' : '#1D4ED8';
    ctx.beginPath(); ctx.arc(p.x, p.y, isSel ? 6 : 4, 0, Math.PI * 2); ctx.fill();
  }

  // Overhang handles at expanded edge midpoints (outward).
  for (let i = 0; i < expanded.length; i++) {
    const a = expanded[i], b = expanded[(i + 1) % expanded.length];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const { nx, ny } = edgeOutwardNormal(expanded, i, ccw);
    const ms = worldToScreen(mid.x, mid.y, vp);
    const hx = ms.x + nx * OVERHANG_HANDLE_OFFSET_PX;
    const hy = ms.y + ny * OVERHANG_HANDLE_OFFSET_PX;
    ctx.fillStyle = 'white';
    ctx.strokeStyle = '#1D4ED8';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(hx, hy, OVERHANG_HANDLE_PX, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(hx - 4, hy); ctx.lineTo(hx + 4, hy);
    ctx.moveTo(hx - 4, hy); ctx.lineTo(hx - 2, hy - 2);
    ctx.moveTo(hx - 4, hy); ctx.lineTo(hx - 2, hy + 2);
    ctx.moveTo(hx + 4, hy); ctx.lineTo(hx + 2, hy - 2);
    ctx.moveTo(hx + 4, hy); ctx.lineTo(hx + 2, hy + 2);
    ctx.stroke();
  }
}

// Build the ridge segment as an extendable infinite line (point + direction).
function ridgeLine(section, scale) {
  const r = computeRidgeAndHips(section, scale);
  if (!r) return null;
  const dx = r.ridgeEnd.x - r.ridgeStart.x;
  const dy = r.ridgeEnd.y - r.ridgeStart.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    p: { x: (r.ridgeStart.x + r.ridgeEnd.x) / 2, y: (r.ridgeStart.y + r.ridgeEnd.y) / 2 },
    dir: { x: dx / len, y: dy / len },
    horizontal: r.horizontal,
  };
}

// Intersection of two infinite lines (point+direction form). Returns null when
// the lines are parallel.
function lineLineIntersect(l1, l2) {
  const a = l1.p, b = l1.dir, c = l2.p, d = l2.dir;
  const denom = b.x * d.y - b.y * d.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((c.x - a.x) * d.y - (c.y - a.y) * d.x) / denom;
  return { x: a.x + t * b.x, y: a.y + t * b.y };
}

function drawSharedEdges(ctx, sections, vp, scale) {
  if (sections.length < 2) return;
  const SHARE_TOL = 0.5;  // wall-corner snap tolerance (ft)
  const BBOX_EPS = 0.5;   // tolerance for "on the combined bbox boundary"
  for (let si = 0; si < sections.length; si++) {
    for (let sj = si + 1; sj < sections.length; sj++) {
      const a = sectionGeom(sections[si], scale);
      const b = sectionGeom(sections[sj], scale);
      if (a.corners.length < 3 || b.corners.length < 3) continue;

      // Match WALL corners across the two sections — the corners the user
      // actually manipulates. After an auto-split the two new sections share
      // exactly the cut endpoints as wall corners; manual rectangles snapped
      // together share them too.
      const sharedCorners = [];
      for (const ac of a.corners) {
        for (const bc of b.corners) {
          if (Math.hypot(ac.x - bc.x, ac.y - bc.y) < SHARE_TOL) {
            sharedCorners.push({ x: ac.x, y: ac.y });
            break;
          }
        }
      }
      if (sharedCorners.length === 0) continue;

      const sameP = sections[si].pitch === sections[sj].pitch;
      const multA = PITCH_MULT[sections[si].pitch] || PITCH_MULT['6:12'];
      const multB = PITCH_MULT[sections[sj].pitch] || PITCH_MULT['6:12'];
      const factor = sameP ? multA : Math.sqrt(multA * multB);

      // Interior corner = the shared corner that sits INSIDE the combined
      // wall bounding box, not on its boundary. For an L-split this is the
      // reflex corner of the original polygon.
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const c of [...a.corners, ...b.corners]) {
        minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
        minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
      }
      const interior = sharedCorners.find((p) =>
        Math.abs(p.x - minX) > BBOX_EPS && Math.abs(p.x - maxX) > BBOX_EPS &&
        Math.abs(p.y - minY) > BBOX_EPS && Math.abs(p.y - maxY) > BBOX_EPS
      );

      const r1 = ridgeLine(sections[si], scale);
      const r2 = ridgeLine(sections[sj], scale);
      const ridgeIntersect = (r1 && r2) ? lineLineIntersect(r1, r2) : null;

      // A valley line forms wherever two roof slopes meet at a re-entrant
      // join. For an L/U split, both endpoints of the shared edge anchor a
      // valley that runs UP to the ridge intersection — yielding a V shape
      // with the ridge intersection at its peak.
      const valleys = [];
      if (interior && ridgeIntersect) {
        valleys.push({
          a: interior,
          b: ridgeIntersect,
          planLen: Math.hypot(ridgeIntersect.x - interior.x, ridgeIntersect.y - interior.y),
        });
        const exterior = sharedCorners.find((p) =>
          Math.hypot(p.x - interior.x, p.y - interior.y) > 1e-6
        );
        if (exterior) {
          valleys.push({
            a: exterior,
            b: ridgeIntersect,
            planLen: Math.hypot(ridgeIntersect.x - exterior.x, ridgeIntersect.y - exterior.y),
          });
        }
      } else if (sharedCorners.length >= 2) {
        // Fallback when ridges are parallel or no interior corner exists:
        // draw along the shared edge using the first two shared corners.
        valleys.push({
          a: sharedCorners[0],
          b: sharedCorners[1],
          planLen: Math.hypot(
            sharedCorners[1].x - sharedCorners[0].x,
            sharedCorners[1].y - sharedCorners[0].y
          ),
        });
      } else {
        continue;
      }

      for (const v of valleys) {
        const p1 = worldToScreen(v.a.x, v.a.y, vp);
        const p2 = worldToScreen(v.b.x, v.b.y, vp);
        const valleyLfWorld = v.planLen * scale * factor;
        ctx.strokeStyle = sameP ? '#7C3AED' : '#D97706';
        ctx.lineWidth = sameP ? 2.5 : 2;
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        if (sameP) {
          // Chevron at p2 (the high end — toward the ridge intersection).
          const dx = p2.x - p1.x, dy = p2.y - p1.y;
          const seg = Math.hypot(dx, dy) || 1;
          const ux = dx / seg, uy = dy / seg;
          const px = -uy, py = ux;
          const back = 8;
          ctx.beginPath();
          ctx.moveTo(p2.x - ux * back + px * (back * 0.55), p2.y - uy * back + py * (back * 0.55));
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(p2.x - ux * back - px * (back * 0.55), p2.y - uy * back - py * (back * 0.55));
          ctx.stroke();
          const mx = (p1.x + p2.x) / 2 + px * 12;
          const my = (p1.y + p2.y) / 2 + py * 12;
          const txt = `V: ${valleyLfWorld.toFixed(1)}'`;
          ctx.font = '500 10px "Segoe UI", -apple-system, sans-serif';
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          const tm = ctx.measureText(txt);
          ctx.fillRect(mx - tm.width / 2 - 2, my - 7, tm.width + 4, 14);
          ctx.fillStyle = '#7C3AED';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(txt, mx, my);
        }
      }
    }
  }
}

function pitchRiseRun(pitch) {
  const m = /^(\d+):12$/.exec(pitch || '');
  return m ? Number(m[1]) / 12 : 0.5;
}
