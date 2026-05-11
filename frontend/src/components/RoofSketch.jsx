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

// "Complex shape" triggers the split prompt — anything that isn't a simple
// convex quadrilateral.
function isComplexShape(corners) {
  if (!Array.isArray(corners) || corners.length < 3) return false;
  if (corners.length > 4) return true;
  return findReflexCorner(corners) != null;
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
  return { polyA, polyB };
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
    } catch (e) { setError(e.message); }
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
      // L-shape / complex shape: offer to auto-split into two rectangles.
      if (isComplexShape(corners)) setSplitPrompt(created);
    } catch (e) { setError(e.message); }
  }

  async function applyAutoSplit(original) {
    const split = computeAutoSplit(original.corners || []);
    if (!split) {
      showToast('Could not determine a clean split for this shape.');
      setSplitPrompt(null);
      return;
    }
    try {
      const a = await api.createRoofSection(projectId, {
        section_name: 'Main Roof',
        corners: split.polyA,
        pitch: original.pitch,
      });
      const b = await api.createRoofSection(projectId, {
        section_name: 'Wing Roof',
        corners: split.polyB,
        pitch: original.pitch,
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
            }}>Overhang: {overhangDragLabel.oh.toFixed(2)}ft</div>
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
            />
          ) : (
            <ProjectRoofSettingsPanel roof={legacyRoof} onPatch={patchLegacyRoof} />
          )}
        </div>
      </div>

      {splitPrompt && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
        }}>
          <div className="card" style={{ maxWidth: 480, padding: '1.25rem' }}>
            <strong style={{ fontSize: '1.05rem' }}>Complex roof shape detected</strong>
            <p style={{ marginTop: '0.5rem' }}>
              This roof section has a complex shape. For an L-shaped or T-shaped house,
              you'll get better results by drawing two separate rectangular sections that
              meet at a valley. Would you like to split this into two sections automatically?
            </p>
            <div className="row" style={{ marginTop: '1rem' }}>
              <button className="primary" onClick={() => applyAutoSplit(splitPrompt)}>Split automatically</button>
              <button className="secondary" onClick={() => setSplitPrompt(null)}>Keep as one</button>
            </div>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}
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
function SectionPanel({ section, scale, onPatch, onPatchEdge, onDelete, onClose }) {
  const g = sectionGeom(section, scale);
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
        <thead><tr><th>#</th><th>End</th><th>Overhang (ft)</th></tr></thead>
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
                  type="number" step="0.25" min="0" max="4"
                  style={{ width: '4rem' }}
                  defaultValue={Number(e.overhang_ft)}
                  onBlur={(ev) => {
                    const v = Math.max(0, Math.min(4, Number(ev.target.value) || 0));
                    if (v !== Number(e.overhang_ft)) onPatchEdge(e.id, { overhang_ft: v });
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="danger" style={{ marginTop: '0.75rem', width: '100%' }} onClick={onDelete}>Delete this section</button>
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

// Find the "interior corner" of an L: the shared-edge endpoint that lies
// strictly inside the union bounding box of the two sections (not on its
// boundary). Returns null for cases where both endpoints are on the union
// boundary — those fall back to the along-edge valley.
function findInteriorCorner(sharedEndpoints, allCorners) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of allCorners) {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
  }
  const EPS = 0.1;
  for (const p of sharedEndpoints) {
    const onLeft = Math.abs(p.x - minX) < EPS;
    const onRight = Math.abs(p.x - maxX) < EPS;
    const onTop = Math.abs(p.y - minY) < EPS;
    const onBot = Math.abs(p.y - maxY) < EPS;
    if (!onLeft && !onRight && !onTop && !onBot) return p;
  }
  return null;
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
  const PARALLEL_DOT = Math.cos(5 * Math.PI / 180);
  const NEAR_FT = 1.0;
  const drawn = new Set();
  for (let si = 0; si < sections.length; si++) {
    for (let sj = si + 1; sj < sections.length; sj++) {
      const a = sectionGeom(sections[si], scale);
      const b = sectionGeom(sections[sj], scale);
      if (a.expanded.length < 3 || b.expanded.length < 3) continue;
      const sameP = sections[si].pitch === sections[sj].pitch;
      const pitchA = pitchRiseRun(sections[si].pitch);
      const pitchB = pitchRiseRun(sections[sj].pitch);
      const valleyFactor = Math.sqrt(1 + 2 * Math.max(pitchA, pitchB) ** 2);
      for (let i = 0; i < a.expanded.length; i++) {
        const ax1 = a.expanded[i], ax2 = a.expanded[(i + 1) % a.expanded.length];
        const adx = ax2.x - ax1.x, ady = ax2.y - ax1.y;
        const aLen = Math.hypot(adx, ady) || 1;
        for (let j = 0; j < b.expanded.length; j++) {
          const bx1 = b.expanded[j], bx2 = b.expanded[(j + 1) % b.expanded.length];
          const bdx = bx2.x - bx1.x, bdy = bx2.y - bx1.y;
          const bLen = Math.hypot(bdx, bdy) || 1;
          const dot = Math.abs((adx * bdx + ady * bdy) / (aLen * bLen));
          if (dot < PARALLEL_DOT) continue;
          const cross = ((bx1.x - ax1.x) * (-ady) + (bx1.y - ax1.y) * (adx)) / aLen;
          if (Math.abs(cross) > NEAR_FT) continue;
          const key = `${si}:${i}:${sj}:${j}`;
          if (drawn.has(key)) continue;
          drawn.add(key);
          // Identify shared-edge endpoints (use the shorter edge's vertices,
          // already approximately coincident with the other section's edge).
          const useA = aLen <= bLen ? [ax1, ax2] : [bx1, bx2];
          // Pick the interior corner if one of the endpoints sits inside the
          // union of the two sections' bboxes. For L-shapes the shared edge
          // has one endpoint that's the inner corner of the L.
          const allCorners = [...a.expanded, ...b.expanded];
          const interior = findInteriorCorner(useA, allCorners);
          // Try to find where the two ridges intersect — that's the high
          // point above the inner corner.
          const r1 = ridgeLine(sections[si], scale);
          const r2 = ridgeLine(sections[sj], scale);
          let valleyEnd = null;
          if (r1 && r2) {
            valleyEnd = lineLineIntersect(r1, r2);
          }
          let p1, p2, valleyLfWorld;
          if (sameP && interior && valleyEnd) {
            // Purple valley line from inner corner up to ridge intersection.
            p1 = worldToScreen(interior.x, interior.y, vp);
            p2 = worldToScreen(valleyEnd.x, valleyEnd.y, vp);
            const planLen = Math.hypot(valleyEnd.x - interior.x, valleyEnd.y - interior.y);
            valleyLfWorld = planLen * scale * valleyFactor;
          } else {
            // Fallback: along the shared edge (original behavior).
            p1 = worldToScreen(useA[0].x, useA[0].y, vp);
            p2 = worldToScreen(useA[1].x, useA[1].y, vp);
            valleyLfWorld = Math.min(aLen, bLen) * scale * valleyFactor;
          }
          ctx.strokeStyle = sameP ? '#7C3AED' : '#D97706';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
          if (sameP) {
            const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
            const txt = `V: ${valleyLfWorld.toFixed(1)}'`;
            ctx.font = '500 9px "Segoe UI", -apple-system, sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            const tm = ctx.measureText(txt);
            ctx.fillRect(mx - tm.width / 2 - 2, my - 14, tm.width + 4, 12);
            ctx.fillStyle = '#7C3AED';
            ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
            ctx.fillText(txt, mx, my - 3);
          }
        }
      }
    }
  }
}

function pitchRiseRun(pitch) {
  const m = /^(\d+):12$/.exec(pitch || '');
  return m ? Number(m[1]) / 12 : 0.5;
}
