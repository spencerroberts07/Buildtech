import React, { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api.js';

const BASE_GRID_PX = 20;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
const HIT_TOLERANCE_PX = 8;
const CORNER_HIT_PX = 10;
const CANVAS_HEIGHT = 600;
const OPENING_MARKER_HALF_LEN_PX = 14;
const OPENING_MARKER_HALF_THICK_PX = 5;

const WALL_TYPE_OPTIONS = [
  { value: 'exterior_2x6', label: 'Exterior 2x6' },
  { value: 'interior_2x4', label: 'Interior 2x4' },
  { value: 'interior_2x6', label: 'Interior 2x6' },
];
const WALL_TYPE_SHORT = {
  exterior_2x6: 'Ext 2x6',
  interior_2x4: 'Int 2x4',
  interior_2x6: 'Int 2x6',
};
const SHEATHING_OPTIONS = [
  { value: '7/16_osb', label: '7/16" OSB' },
  { value: '1/2_osb', label: '1/2" OSB' },
  { value: '1/2_csp', label: '1/2" CSP' },
  { value: '5/8_osb', label: '5/8" OSB' },
];
const DRYWALL_OPTIONS = [
  { value: '1/2_drywall', label: '1/2" drywall' },
  { value: '5/8_drywall', label: '5/8" drywall' },
];

export const WINDOW_PRESETS = [
  { label: "2'0 x 3'0", w: 24, h: 36 },
  { label: "2'0 x 4'0", w: 24, h: 48 },
  { label: "2'8 x 4'0", w: 32, h: 48 },
  { label: "3'0 x 3'0", w: 36, h: 36 },
  { label: "3'0 x 4'0", w: 36, h: 48 },
  { label: "3'0 x 5'0", w: 36, h: 60 },
  { label: "4'0 x 3'0", w: 48, h: 36 },
  { label: "4'0 x 4'0", w: 48, h: 48 },
  { label: "4'0 x 5'0", w: 48, h: 60 },
  { label: "5'0 x 4'0", w: 60, h: 48 },
  { label: "5'0 x 5'0", w: 60, h: 60 },
  { label: "6'0 x 4'0", w: 72, h: 48 },
  { label: 'Custom', w: null, h: null },
];
export const DOOR_PRESETS = [
  { label: "2'4 x 6'11", w: 28, h: 83 },
  { label: "2'6 x 6'11", w: 30, h: 83 },
  { label: "2'8 x 6'11", w: 32, h: 83 },
  { label: "3'0 x 6'11", w: 36, h: 83 },
  { label: "3'0 x 8'0", w: 36, h: 96 },
  { label: "5'0 x 6'11 Patio", w: 60, h: 83 },
  { label: "6'0 x 6'11 Double", w: 72, h: 83 },
  { label: "6'0 x 8'0 Double", w: 72, h: 96 },
  { label: 'Custom', w: null, h: null },
];
const presetsFor = (type) => (type === 'door' ? DOOR_PRESETS : WINDOW_PRESETS);
function findPresetLabel(type, w, h) {
  const list = presetsFor(type);
  const m = list.find((p) => p.w === Number(w) && p.h === Number(h));
  return m ? m.label : 'Custom';
}

// ---------- geometry ----------
const num = (v) => (v == null || v === '' ? 0 : Number(v));
function worldToScreen(wx, wy, vp) {
  return { x: wx * BASE_GRID_PX * vp.zoom + vp.panX, y: wy * BASE_GRID_PX * vp.zoom + vp.panY };
}
function screenToWorld(sx, sy, vp) {
  return { x: (sx - vp.panX) / (BASE_GRID_PX * vp.zoom), y: (sy - vp.panY) / (BASE_GRID_PX * vp.zoom) };
}
function snapWorld(p) { return { x: Math.round(p.x), y: Math.round(p.y) }; }
function snapHalf(v) { return Math.round(v * 2) / 2; }
function distPointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}
function edgeLengthFt(corners, idx, scale) {
  const a = corners[idx];
  const b = corners[(idx + 1) % corners.length];
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2) * scale;
}

// ---------- main ----------
const LEVEL_TABS_BASE = [
  { value: 'foundation', label: 'Foundation' },
  { value: 'floor1', label: 'Floor 1' },
  { value: 'floor2', label: 'Floor 2' },
  { value: 'roof', label: 'Roof' },
];

export default function Sketch({
  projectId,
  projectSettings,
  numStoreys = 1,
  onProjectSettingsChange,
  onMaterialsChanged,
  onOpeningsChanged,
  refetchProjectSettings,
}) {
  const [activeLevel, setActiveLevel] = useState('floor1');
  const visibleLevels = LEVEL_TABS_BASE.filter((l) => l.value !== 'floor2' || Number(numStoreys) >= 2);

  // ---- PDF state lives at this level so it survives level switches. ----
  const pdfFilename = projectSettings?.pdf_filename || null;
  const pdfPageStored = Number(projectSettings?.pdf_page) || 1;
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfPage, setPdfPage] = useState(pdfPageStored);
  const [pdfNumPages, setPdfNumPages] = useState(0);
  const [pdfStatus, setPdfStatus] = useState(pdfFilename ? 'loading' : 'none'); // none | loading | ready | missing
  const [pdfPageCanvas, setPdfPageCanvas] = useState(null);
  const [pdfOpacity, setPdfOpacity] = useState(0.4);

  // Load (or unload) the PDF when filename changes.
  useEffect(() => {
    let cancelled = false;
    if (!pdfFilename) {
      setPdfDoc(null); setPdfNumPages(0); setPdfPageCanvas(null);
      setPdfStatus('none');
      return () => { cancelled = true; };
    }
    if (!window.pdfjsLib) {
      // Wait briefly for CDN to load; bail with missing if it never arrives.
      let tries = 0;
      const iv = setInterval(() => {
        tries++;
        if (window.pdfjsLib) { clearInterval(iv); load(); }
        else if (tries > 20) { clearInterval(iv); setPdfStatus('missing'); }
      }, 100);
      return () => { cancelled = true; clearInterval(iv); };
    }
    load();
    return () => { cancelled = true; };

    async function load() {
      setPdfStatus('loading');
      try {
        const blob = await api.fetchPdfBlob(projectId);
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        const doc = await window.pdfjsLib.getDocument(url).promise;
        if (cancelled) { URL.revokeObjectURL(url); return; }
        setPdfDoc(doc);
        setPdfNumPages(doc.numPages);
        setPdfStatus('ready');
        URL.revokeObjectURL(url);
      } catch (e) {
        if (cancelled) return;
        setPdfStatus(e.code === 'pdf_missing' ? 'missing' : 'none');
        setPdfDoc(null); setPdfNumPages(0); setPdfPageCanvas(null);
      }
    }
  }, [pdfFilename, projectId]);

  // Render the selected page to an offscreen canvas whenever doc or page changes.
  useEffect(() => {
    let cancelled = false;
    if (!pdfDoc) { setPdfPageCanvas(null); return; }
    const page = Math.max(1, Math.min(pdfDoc.numPages, pdfPage));
    pdfDoc.getPage(page).then((p) => {
      if (cancelled) return;
      const viewport = p.getViewport({ scale: 1 });
      const off = document.createElement('canvas');
      off.width = Math.ceil(viewport.width);
      off.height = Math.ceil(viewport.height);
      const ctx = off.getContext('2d');
      p.render({ canvasContext: ctx, viewport }).promise.then(() => {
        if (cancelled) return;
        setPdfPageCanvas(off);
      }).catch(() => {});
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [pdfDoc, pdfPage]);

  async function uploadPdf(file) {
    try {
      await api.uploadPdf(projectId, file);
      // The server set the canonical filename. Re-fetch settings so the load effect sees it.
      setPdfPage(1);
      await refetchProjectSettings?.();
    } catch (e) {
      alert(`Upload failed: ${e.message}`);
    }
  }

  async function removePdf() {
    if (!confirm('Remove the PDF underlay?')) return;
    try {
      await api.deletePdf(projectId);
      setPdfDoc(null); setPdfPageCanvas(null); setPdfNumPages(0);
      setPdfStatus('none');
      await refetchProjectSettings?.();
    } catch (e) { alert(`Remove failed: ${e.message}`); }
  }

  function changePage(delta) {
    if (!pdfDoc) return;
    const next = Math.max(1, Math.min(pdfDoc.numPages, pdfPage + delta));
    if (next === pdfPage) return;
    setPdfPage(next);
    onProjectSettingsChange?.({ pdf_page: next });
  }

  const pdfControls = {
    pdfFilename, pdfStatus, pdfNumPages, pdfPage, pdfOpacity, pdfPageCanvas,
    setPdfOpacity, uploadPdf, removePdf, changePage,
  };

  if (activeLevel === 'roof') {
    return (
      <div>
        <LevelTabs tabs={visibleLevels} active={activeLevel} onChange={setActiveLevel} />
        <RoofPanel projectId={projectId} onMaterialsChanged={onMaterialsChanged} />
      </div>
    );
  }

  return (
    <div>
      <LevelTabs tabs={visibleLevels} active={activeLevel} onChange={setActiveLevel} />
      <PolygonSketch
        key={activeLevel /* full remount on level switch — simpler than per-level state */}
        projectId={projectId}
        level={activeLevel}
        projectSettings={projectSettings}
        onProjectSettingsChange={onProjectSettingsChange}
        onMaterialsChanged={onMaterialsChanged}
        onOpeningsChanged={onOpeningsChanged}
        pdfControls={pdfControls}
      />
    </div>
  );
}

function LevelTabs({ tabs, active, onChange }) {
  return (
    <div style={{
      display: 'flex', gap: '0.25rem', marginBottom: '0.5rem',
      borderBottom: '1px solid #E0E0E0', paddingBottom: '0.4rem',
    }}>
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={t.value === active ? 'tab active' : 'tab'}
          style={{ padding: '0.4rem 0.9rem' }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function PolygonSketch({
  projectId,
  level,
  projectSettings,
  onProjectSettingsChange,
  onMaterialsChanged,
  onOpeningsChanged,
  pdfControls,
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  const [floorPlanId, setFloorPlanId] = useState(null);
  const [corners, setCorners] = useState([]);
  const [walls, setWalls] = useState([]); // floor_plan_walls rows
  const [openings, setOpenings] = useState([]);
  const [interiorWalls, setInteriorWalls] = useState([]); // floor_plan_interior_walls rows
  const [drawingPhase, setDrawingPhase] = useState('exterior'); // 'exterior' | 'interior'
  const [pendingInteriorEndpoint, setPendingInteriorEndpoint] = useState(null); // first click of a 2-click segment
  const [selectedInteriorWallId, setSelectedInteriorWallId] = useState(null);
  const [wallDragPreview, setWallDragPreview] = useState(null); // { idx, deltaPerp, newCorners }
  const [hoverCursor, setHoverCursor] = useState(null); // 'move' | null
  const [toast, setToast] = useState(null);
  const [mode, setMode] = useState('placing'); // 'placing' | 'editing'
  // Modal toolbar tool: 'select' | 'pan' | 'draw_exterior' | 'draw_interior'
  // 'select' is the default for closed polygons; 'draw_exterior' for fresh sketches.
  const [sketchMode, setSketchMode] = useState('draw_exterior');
  const [fullscreen, setFullscreen] = useState(false);
  // In-memory undo stack (max 20). Each entry is a function that reverts the action
  // (server-side via API + local state). Cleared on level switch (component remount).
  const undoStack = useRef([]);
  const [undoCount, setUndoCount] = useState(0); // for UI re-render
  const [selectedCornerIdx, setSelectedCornerIdx] = useState(null);
  const [selectedWallIdx, setSelectedWallIdx] = useState(null);
  const [selectedOpeningId, setSelectedOpeningId] = useState(null);
  const [hoverWorld, setHoverWorld] = useState(null);
  const [viewport, setViewport] = useState(() => ({
    panX: num(projectSettings?.viewport_pan_x),
    panY: num(projectSettings?.viewport_pan_y),
    zoom: num(projectSettings?.viewport_zoom) || 1,
  }));
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: CANVAS_HEIGHT });
  const [error, setError] = useState('');

  const panState = useRef({ active: false, startX: 0, startY: 0, basePan: null });
  const spaceDown = useRef(false);
  const dragState = useRef({ active: false, type: null, idx: null, openingId: null, moved: false });
  const cornerSaveTimer = useRef(null);
  const openingSaveTimers = useRef({});
  const interiorWallSaveTimers = useRef({});
  const toastTimer = useRef(null);
  const [dragLabel, setDragLabel] = useState(null);

  // Auxiliary tools that take over canvas clicks (calibrate, measure).
  // 'idle' = normal canvas behavior. 'calibrate' = pick 2 pts → enter real distance.
  // 'measure' = pick 2 pts → persist a measurement line; repeat.
  const [tool, setTool] = useState('idle');
  // Click-to-pick state shared by both tools (one or two world points).
  const [toolPoints, setToolPoints] = useState([]);
  // Persistent measurement lines drawn while in measure mode.
  const [measurements, setMeasurements] = useState([]);
  // Calibration dialog state: appears once 2 points have been picked in calibrate mode.
  const [calibDialog, setCalibDialog] = useState({ open: false, distFt: '' });

  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  // ---- Undo stack ----
  function pushUndo(label, undoFn) {
    undoStack.current.push({ label, fn: undoFn });
    if (undoStack.current.length > 20) undoStack.current.shift();
    setUndoCount(undoStack.current.length);
  }
  async function popUndo() {
    const entry = undoStack.current.pop();
    setUndoCount(undoStack.current.length);
    if (!entry) return;
    try { await entry.fn(); }
    catch (e) { setError(`Undo failed (${entry.label}): ${e.message}`); }
  }

  const scaleFtPerGrid = num(projectSettings?.scale_ft_per_grid) || 1;
  const wallByIndex = new Map(walls.map((w) => [Number(w.wall_index), w]));

  // ---- bootstrap floor plan for the active level ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.listFloorPlans(projectId);
        let fp = list.find((f) => f.level === level);
        if (!fp) fp = await api.createFloorPlan(projectId, { level });
        const full = await api.getFloorPlan(projectId, fp.id);
        if (cancelled) return;
        setFloorPlanId(full.id);
        const cs = Array.isArray(full.corners) ? full.corners : [];
        setCorners(cs);
        setWalls(full.walls || []);
        setOpenings(full.openings || []);
        setInteriorWalls(full.interior_walls || []);
        const phase = full.drawing_phase === 'interior' ? 'interior' : 'exterior';
        setDrawingPhase(phase);
        // Editing mode if polygon is closed; otherwise placing.
        const isClosed = cs.length >= 3;
        setMode(isClosed ? 'editing' : 'placing');
        // Modal toolbar: select for closed polygons, draw_exterior for fresh sketches.
        setSketchMode(isClosed ? 'select' : 'draw_exterior');
      } catch (e) { setError(e.message); }
    })();
    return () => { cancelled = true; };
  }, [projectId, level]);

  async function copyFromFloor1() {
    if (!confirm(`Copy Floor 1 footprint into ${level}? This replaces any existing corners/walls.`)) return;
    try {
      const updated = await api.copyFloorPlanLevel(projectId, 'floor1', level);
      setFloorPlanId(updated.id);
      setCorners(Array.isArray(updated.corners) ? updated.corners : []);
      setWalls(updated.walls || []);
      setOpenings(updated.openings || []);
      setInteriorWalls(updated.interior_walls || []);
      setDrawingPhase(updated.drawing_phase === 'interior' ? 'interior' : 'exterior');
      setMode((updated.corners || []).length >= 3 ? 'editing' : 'placing');
      onMaterialsChanged?.();
      onOpeningsChanged?.();
    } catch (e) { setError(e.message); }
  }

  // ---- viewport sync + persistence ----
  useEffect(() => {
    setViewport({
      panX: num(projectSettings?.viewport_pan_x),
      panY: num(projectSettings?.viewport_pan_y),
      zoom: num(projectSettings?.viewport_zoom) || 1,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

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

  // ---- canvas resize ----
  useEffect(() => {
    function measure() {
      if (wrapRef.current) setCanvasSize({ w: wrapRef.current.clientWidth, h: CANVAS_HEIGHT });
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // ---- redraw ----
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
      corners, walls, openings, mode, selectedCornerIdx, selectedWallIdx, selectedOpeningId,
      hoverWorld, scale: scaleFtPerGrid, dragLabel,
      interiorWalls, selectedInteriorWallId, drawingPhase,
      pendingInteriorEndpoint, wallDragPreview,
      pdfPageCanvas: pdfControls?.pdfPageCanvas || null,
      pdfOpacity: pdfControls?.pdfOpacity ?? 0.4,
      pdfStatus: pdfControls?.pdfStatus || 'none',
      tool, toolPoints, measurements,
    });
  }, [canvasSize, viewport, corners, walls, openings, mode, selectedCornerIdx, selectedWallIdx,
      selectedOpeningId, hoverWorld, scaleFtPerGrid, dragLabel,
      interiorWalls, selectedInteriorWallId, drawingPhase,
      pendingInteriorEndpoint, wallDragPreview,
      pdfControls?.pdfPageCanvas, pdfControls?.pdfOpacity, pdfControls?.pdfStatus,
      tool, toolPoints, measurements]);

  // ---- helpers ----
  function getMouseWorld(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return { sx, sy, world: screenToWorld(sx, sy, viewport) };
  }
  function hitTestCorner(sx, sy) {
    for (let i = 0; i < corners.length; i++) {
      const s = worldToScreen(corners[i].x, corners[i].y, viewport);
      if (Math.hypot(s.x - sx, s.y - sy) <= CORNER_HIT_PX) return i;
    }
    return null;
  }
  function hitTestEdge(world) {
    if (corners.length < 3) return null;
    const tol = HIT_TOLERANCE_PX / (BASE_GRID_PX * viewport.zoom);
    let best = null;
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      const d = distPointToSegment(world.x, world.y, a.x, a.y, b.x, b.y);
      if (d <= tol && (best == null || d < best.d)) best = { d, idx: i };
    }
    return best ? best.idx : null;
  }
  function openingScreenMeta(opening) {
    const wall = walls.find((w) => w.id === opening.floor_plan_wall_id);
    if (!wall) return null;
    const idx = Number(wall.wall_index);
    if (idx < 0 || idx >= corners.length) return null;
    const a = corners[idx];
    const b = corners[(idx + 1) % corners.length];
    const t = num(opening.position_along_wall) || 0.5;
    const wx = a.x + t * (b.x - a.x);
    const wy = a.y + t * (b.y - a.y);
    const sc = worldToScreen(wx, wy, viewport);
    const aS = worldToScreen(a.x, a.y, viewport);
    const bS = worldToScreen(b.x, b.y, viewport);
    const len = Math.hypot(bS.x - aS.x, bS.y - aS.y) || 1;
    const ux = (bS.x - aS.x) / len, uy = (bS.y - aS.y) / len;
    return { sc, ux, uy, nx: -uy, ny: ux, wallIdx: idx };
  }
  function hitTestOpening(sx, sy) {
    for (const o of openings) {
      const meta = openingScreenMeta(o);
      if (!meta) continue;
      const dx = sx - meta.sc.x, dy = sy - meta.sc.y;
      const along = dx * meta.ux + dy * meta.uy;
      const across = dx * meta.nx + dy * meta.ny;
      if (Math.abs(along) <= OPENING_MARKER_HALF_LEN_PX && Math.abs(across) <= OPENING_MARKER_HALF_THICK_PX + 4) {
        return o;
      }
    }
    return null;
  }

  // Hit-test an interior wall (line segment). Returns { id, end: 'a' | 'b' | null }
  // where end indicates whether the hit was on an endpoint (within CORNER_HIT_PX) or
  // on the segment body. Null if no hit.
  function hitTestInteriorWall(sx, sy, world) {
    const tol = HIT_TOLERANCE_PX / (BASE_GRID_PX * viewport.zoom);
    let best = null;
    for (const iw of interiorWalls) {
      const ax = Number(iw.x1), ay = Number(iw.y1);
      const bx = Number(iw.x2), by = Number(iw.y2);
      // Endpoint hits (priority, in screen pixels for consistency with corners)
      const aS = worldToScreen(ax, ay, viewport);
      const bS = worldToScreen(bx, by, viewport);
      if (Math.hypot(aS.x - sx, aS.y - sy) <= CORNER_HIT_PX) {
        return { id: iw.id, end: 'a' };
      }
      if (Math.hypot(bS.x - sx, bS.y - sy) <= CORNER_HIT_PX) {
        return { id: iw.id, end: 'b' };
      }
      const d = distPointToSegment(world.x, world.y, ax, ay, bx, by);
      if (d <= tol && (best == null || d < best.d)) best = { d, id: iw.id, end: null };
    }
    return best ? { id: best.id, end: null } : null;
  }

  // Find a snap target near the cursor: existing exterior corner, exterior midpoint,
  // or interior wall endpoint. Returns world coords if within snap distance, else null.
  function findInteriorSnapTarget(world) {
    const tol = (CORNER_HIT_PX * 1.2) / (BASE_GRID_PX * viewport.zoom);
    let best = null;
    const tryPt = (x, y) => {
      const d = Math.hypot(world.x - x, world.y - y);
      if (d <= tol && (best == null || d < best.d)) best = { d, x, y };
    };
    for (const c of corners) tryPt(c.x, c.y);
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      tryPt((a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    for (const iw of interiorWalls) {
      tryPt(Number(iw.x1), Number(iw.y1));
      tryPt(Number(iw.x2), Number(iw.y2));
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  // Perpendicular drag math for exterior wall segment idx:
  // returns the allowed range [tNeg, tPos] (along perpendicular unit vector n)
  // such that both adjacent edges keep length >= minLenWorld.
  //
  // For each adjacent edge, the squared length |v ± t·n|^2 is a parabola in t.
  // The forbidden interval is between its two roots t1 < t2 (where length = minLen).
  // Outside (t1, t2) the edge is long enough. t=0 sits in one of the allowed regions
  // (left of t1 or right of t2), so the only nearby clamp is on the side of t=0
  // facing the forbidden interval — the OPPOSITE direction is unbounded (unlimited
  // outward movement). The previous code clamped both directions, which broke
  // outward dragging.
  function maxPerpendicularDelta(idx, n, minLenWorld) {
    if (corners.length < 3) return { tPos: Infinity, tNeg: -Infinity };
    const N = corners.length;
    const a = corners[idx];
    const b = corners[(idx + 1) % N];
    const c0 = corners[(idx - 1 + N) % N]; // before a
    const c3 = corners[(idx + 2) % N];     // after b

    // Core: given vDotN (signed projection of edge vector onto n) and |v|^2,
    // return { tLow, tHigh } — the allowed bounds of t around 0. Inf if unbounded
    // on that side.
    const bounds = (vDotN, vSq) => {
      const c = vSq - minLenWorld * minLenWorld;
      // If already at or below minLen, no movement allowed at all (defensive).
      if (vSq < minLenWorld * minLenWorld) return { tLow: 0, tHigh: 0 };
      const disc = vDotN * vDotN - c;
      if (disc < 0) {
        // Parabola never crosses minLen — adjacent edge stays ≥ minLen for all t.
        return { tLow: -Infinity, tHigh: Infinity };
      }
      const sq = Math.sqrt(disc);
      const t1 = -vDotN - sq;
      const t2 = -vDotN + sq;
      // t=0 is in the allowed region. Determine which side of (t1, t2).
      if (0 <= t1) {
        // 0 is to the LEFT of the forbidden interval. Going positive clamps at t1.
        // Going negative is unbounded.
        return { tLow: -Infinity, tHigh: t1 };
      }
      if (0 >= t2) {
        // 0 is to the RIGHT of the forbidden interval. Going negative clamps at t2.
        return { tLow: t2, tHigh: Infinity };
      }
      // 0 inside forbidden interval — shouldn't happen given the vSq check, but
      // be safe: no movement.
      return { tLow: 0, tHigh: 0 };
    };

    // Edge BEFORE: a moves to a + t*n. Length² = |(a - c0) + t*n|².
    const va = { x: a.x - c0.x, y: a.y - c0.y };
    const beforeBounds = bounds(va.x * n.x + va.y * n.y, va.x * va.x + va.y * va.y);
    // Edge AFTER: b moves to b + t*n. Length² = |(c3 - b) - t*n|², which is the
    // same form with v' = c3 - b and v'·n replaced by -(v'·n).
    const vb = { x: c3.x - b.x, y: c3.y - b.y };
    const afterBounds = bounds(-(vb.x * n.x + vb.y * n.y), vb.x * vb.x + vb.y * vb.y);

    const tPos = Math.min(beforeBounds.tHigh, afterBounds.tHigh);
    const tNeg = Math.max(beforeBounds.tLow, afterBounds.tLow);
    return { tPos, tNeg };
  }

  // ---- mouse handlers ----
  function onMouseDown(e) {
    canvasRef.current.focus();
    const { sx, sy, world } = getMouseWorld(e);
    // Pan triggers: middle-click, space+drag, Ctrl+drag, or PAN tool (any left-drag).
    const panTool = sketchMode === 'pan';
    if (e.button === 1 || (e.button === 0 && (spaceDown.current || e.ctrlKey || panTool))) {
      e.preventDefault();
      panState.current = { active: true, startX: sx, startY: sy, basePan: { x: viewport.panX, y: viewport.panY } };
      return;
    }
    if (e.button !== 0) return;

    // Aux tools (calibrate / measure) intercept clicks BEFORE normal canvas logic.
    if (tool === 'calibrate' || tool === 'measure') {
      e.preventDefault();
      const snapped = snapWorld(world);
      if (toolPoints.length === 0) {
        setToolPoints([snapped]);
      } else {
        const a = toolPoints[0];
        const b = snapped;
        if (tool === 'calibrate') {
          // Open the distance dialog; commit happens on dialog submit.
          setCalibDialog({ open: true, distFt: '' });
          setToolPoints([a, b]);
        } else {
          // measure: push the line and reset for the next pair
          setMeasurements((cur) => [...cur, { a, b }]);
          setToolPoints([]);
        }
      }
      return;
    }

    // SELECT mode: hit-test for drag/select. DRAW modes skip drag init and let mouseUp handle the click.
    if (sketchMode === 'select' && mode === 'editing') {
      // Check opening drag first
      const hitO = hitTestOpening(sx, sy);
      if (hitO) {
        e.preventDefault();
        const orig = openings.find((x) => x.id === hitO.id);
        dragState.current = {
          active: true, type: 'opening', openingId: hitO.id, moved: false,
          origOpening: orig ? { ...orig } : null,
        };
        return;
      }
      // Check corner drag
      const hitC = hitTestCorner(sx, sy);
      if (hitC != null) {
        e.preventDefault();
        dragState.current = {
          active: true, type: 'corner', idx: hitC, moved: false,
          origCorners: corners.map((c) => ({ x: c.x, y: c.y })),
        };
        return;
      }
      // Check interior wall (endpoint drag if on endpoint, else click-to-select on body)
      const hitI = hitTestInteriorWall(sx, sy, world);
      if (hitI) {
        e.preventDefault();
        const orig = interiorWalls.find((x) => x.id === hitI.id);
        if (hitI.end) {
          dragState.current = {
            active: true, type: 'interior_endpoint',
            interiorId: hitI.id, end: hitI.end, moved: false,
            startX: sx, startY: sy,
            origIw: orig ? { ...orig } : null,
          };
        } else {
          // body of interior wall — defer to mouseUp click-select (no drag)
          dragState.current = {
            active: true, type: 'interior_select',
            interiorId: hitI.id, moved: false,
            startX: sx, startY: sy,
          };
        }
        return;
      }
      // Check exterior wall drag zone (on the polygon edge body)
      const hitE = hitTestEdge(world);
      if (hitE != null) {
        e.preventDefault();
        const a = corners[hitE];
        const b = corners[(hitE + 1) % corners.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len > 0) {
          const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
          const nx = -uy, ny = ux; // perpendicular (left of direction)
          dragState.current = {
            active: true, type: 'wall',
            idx: hitE, moved: false,
            startX: sx, startY: sy,
            startWorld: { x: world.x, y: world.y },
            n: { x: nx, y: ny },
            origCorners: corners.map((c) => ({ x: c.x, y: c.y })),
            origInteriorWalls: interiorWalls.map((iw) => ({ ...iw })),
          };
        }
        return;
      }
    }
  }

  function onMouseMove(e) {
    const { sx, sy, world } = getMouseWorld(e);
    if (panState.current.active) {
      const dx = sx - panState.current.startX;
      const dy = sy - panState.current.startY;
      setViewport((vp) => ({ ...vp, panX: panState.current.basePan.x + dx, panY: panState.current.basePan.y + dy }));
      return;
    }
    if (dragState.current.active && dragState.current.type === 'corner') {
      const snapped = snapWorld(world);
      const idx = dragState.current.idx;
      setCorners((cur) => cur.map((c, i) => (i === idx ? snapped : c)));
      dragState.current.moved = true;
      return;
    }
    if (dragState.current.active && dragState.current.type === 'wall') {
      const ds = dragState.current;
      // Project world delta onto perpendicular n
      const dxw = world.x - ds.startWorld.x;
      const dyw = world.y - ds.startWorld.y;
      let t = dxw * ds.n.x + dyw * ds.n.y;
      // Snap perpendicular distance to 0.5 ft (world units == ft when scale=1)
      t = snapHalf(t / scaleFtPerGrid) * scaleFtPerGrid;
      // Clamp so adjacent walls stay >= 2 ft
      const minLenWorld = 2 / scaleFtPerGrid;
      const { tPos, tNeg } = maxPerpendicularDelta(ds.idx, ds.n, minLenWorld);
      if (t > 0) t = Math.min(t, tPos);
      else t = Math.max(t, tNeg);
      // Threshold: ignore moves under 3 px in screen space
      if (Math.hypot(sx - ds.startX, sy - ds.startY) < 3 && Math.abs(t) < 1e-9) return;
      ds.moved = true;
      const idx = ds.idx;
      const N = ds.origCorners.length;
      const newCorners = ds.origCorners.map((c, i) => {
        if (i === idx || i === (idx + 1) % N) {
          return { x: c.x + t * ds.n.x, y: c.y + t * ds.n.y };
        }
        return c;
      });
      setWallDragPreview({ idx, t, newCorners });
      // Distance label at edge midpoint of the new wall position
      const a2 = newCorners[idx];
      const b2 = newCorners[(idx + 1) % N];
      const mid = worldToScreen((a2.x + b2.x) / 2, (a2.y + b2.y) / 2, viewport);
      const ftLabel = (t * scaleFtPerGrid >= 0 ? '+' : '') + (t * scaleFtPerGrid).toFixed(1);
      setDragLabel({ x: mid.x, y: mid.y - 22, text: `${ftLabel} ft` });
      return;
    }
    if (dragState.current.active && dragState.current.type === 'interior_endpoint') {
      const ds = dragState.current;
      const snapped = snapWorld(world);
      // Threshold for click vs drag
      if (!ds.moved && Math.hypot(sx - ds.startX, sy - ds.startY) < 3) return;
      ds.moved = true;
      setInteriorWalls((cur) => cur.map((iw) => {
        if (iw.id !== ds.interiorId) return iw;
        if (ds.end === 'a') return { ...iw, x1: snapped.x, y1: snapped.y };
        return { ...iw, x2: snapped.x, y2: snapped.y };
      }));
      return;
    }
    if (dragState.current.active && dragState.current.type === 'interior_select') {
      // Mark moved if cursor strays beyond click threshold (we still treat as click on up)
      if (Math.hypot(sx - dragState.current.startX, sy - dragState.current.startY) >= 3) {
        dragState.current.moved = true;
      }
      return;
    }
    if (dragState.current.active && dragState.current.type === 'opening') {
      const o = openings.find((x) => x.id === dragState.current.openingId);
      const w = o ? walls.find((x) => x.id === o.floor_plan_wall_id) : null;
      if (!w) return;
      const idx = Number(w.wall_index);
      if (idx < 0 || idx >= corners.length) return;
      const a = corners[idx];
      const b = corners[(idx + 1) % corners.length];
      const dxw = b.x - a.x, dyw = b.y - a.y;
      const lenSq = dxw * dxw + dyw * dyw;
      if (lenSq === 0) return;
      const wallLen = Math.sqrt(lenSq) * scaleFtPerGrid;
      let t = ((world.x - a.x) * dxw + (world.y - a.y) * dyw) / lenSq;
      const posFt = t * wallLen;
      const snappedFt = Math.round(posFt / 0.5) * 0.5;
      let snappedT = snappedFt / wallLen;
      snappedT = Math.max(0.05, Math.min(0.95, snappedT));
      dragState.current.moved = true;
      setOpenings((cur) => cur.map((x) => (x.id === o.id ? { ...x, position_along_wall: snappedT } : x)));
      const labelWx = a.x + snappedT * dxw;
      const labelWy = a.y + snappedT * dyw;
      const sc = worldToScreen(labelWx, labelWy, viewport);
      setDragLabel({ x: sc.x, y: sc.y - 22, text: `${(snappedT * wallLen).toFixed(1)} ft` });
      return;
    }
    setHoverWorld(snapWorld(world));
    // Cursor hint: if hovering over an exterior edge body (and not over a corner/opening),
    // show the move cursor for wall drag affordance.
    if (mode === 'editing' && corners.length >= 3) {
      const overCorner = hitTestCorner(sx, sy) != null;
      const overOpening = !!hitTestOpening(sx, sy);
      const overInterior = !!hitTestInteriorWall(sx, sy, world);
      const overEdge = hitTestEdge(world) != null;
      setHoverCursor(overEdge && !overCorner && !overOpening && !overInterior ? 'move' : null);
    } else {
      setHoverCursor(null);
    }
  }

  function onMouseUp(e) {
    if (panState.current.active) { panState.current.active = false; return; }
    // Calibrate / measure modes consumed the click on mousedown.
    if (tool === 'calibrate' || tool === 'measure') return;
    if (dragState.current.active) {
      const ds = { ...dragState.current };
      dragState.current = { active: false, type: null, idx: null, openingId: null, moved: false };
      setDragLabel(null);
      if (ds.type === 'corner') {
        if (ds.moved) {
          // Debounced save of new corners array
          clearTimeout(cornerSaveTimer.current);
          const snap = corners; // current state has the moved corner
          cornerSaveTimer.current = setTimeout(() => {
            api.updateFloorPlan(projectId, floorPlanId, { corners: snap })
              .then(() => onMaterialsChanged?.())
              .catch((err) => setError(err.message));
          }, 300);
          const orig = ds.origCorners;
          pushUndo('move corner', async () => {
            setCorners(orig);
            await api.updateFloorPlan(projectId, floorPlanId, { corners: orig });
            onMaterialsChanged?.();
          });
        } else {
          setSelectedCornerIdx(ds.idx);
          setSelectedWallIdx(null);
          setSelectedOpeningId(null);
          setSelectedInteriorWallId(null);
        }
      } else if (ds.type === 'opening') {
        if (ds.moved) {
          const o = openings.find((x) => x.id === ds.openingId);
          const positionToSave = o?.position_along_wall;
          clearTimeout(openingSaveTimers.current[ds.openingId]);
          openingSaveTimers.current[ds.openingId] = setTimeout(() => {
            api.updateOpening(projectId, ds.openingId, { position_along_wall: positionToSave })
              .then(() => { onMaterialsChanged?.(); onOpeningsChanged?.(); })
              .catch((err) => setError(err.message));
          }, 300);
          const orig = ds.origOpening;
          if (orig) {
            pushUndo('move opening', async () => {
              setOpenings((cur) => cur.map((x) => x.id === orig.id ? { ...x, position_along_wall: orig.position_along_wall } : x));
              await api.updateOpening(projectId, orig.id, { position_along_wall: orig.position_along_wall });
              onMaterialsChanged?.(); onOpeningsChanged?.();
            });
          }
        } else {
          setSelectedOpeningId(ds.openingId);
          setSelectedCornerIdx(null);
          setSelectedWallIdx(null);
          setSelectedInteriorWallId(null);
        }
      } else if (ds.type === 'wall') {
        if (ds.moved && wallDragPreview) {
          const newCorners = wallDragPreview.newCorners;
          // Snap any interior wall endpoint that was on the dragged exterior edge to the
          // corresponding new position. Endpoints close to the original corner snap there;
          // endpoints on the segment translate by the same perpendicular delta.
          const idx = ds.idx;
          const N = ds.origCorners.length;
          const aOld = ds.origCorners[idx];
          const bOld = ds.origCorners[(idx + 1) % N];
          const aNew = newCorners[idx];
          const bNew = newCorners[(idx + 1) % N];
          const SNAP = 4 / (BASE_GRID_PX * viewport.zoom); // ~4 px in world units
          const tDelta = wallDragPreview.t;
          const nVec = ds.n;
          const updatedInteriors = ds.origInteriorWalls.map((iw) => {
            const moveEndpoint = (x, y) => {
              const dToA = Math.hypot(x - aOld.x, y - aOld.y);
              const dToB = Math.hypot(x - bOld.x, y - bOld.y);
              if (dToA <= SNAP) return { x: aNew.x, y: aNew.y, moved: true };
              if (dToB <= SNAP) return { x: bNew.x, y: bNew.y, moved: true };
              const dToSeg = distPointToSegment(x, y, aOld.x, aOld.y, bOld.x, bOld.y);
              if (dToSeg <= SNAP) return { x: x + tDelta * nVec.x, y: y + tDelta * nVec.y, moved: true };
              return { x, y, moved: false };
            };
            const a = moveEndpoint(Number(iw.x1), Number(iw.y1));
            const b = moveEndpoint(Number(iw.x2), Number(iw.y2));
            if (!a.moved && !b.moved) return iw;
            return { ...iw, x1: a.x, y1: a.y, x2: b.x, y2: b.y, _moved: true };
          });
          setCorners(newCorners);
          setInteriorWalls(updatedInteriors);
          setWallDragPreview(null);
          clearTimeout(cornerSaveTimer.current);
          const movedIws = updatedInteriors.filter((iw) => iw._moved);
          cornerSaveTimer.current = setTimeout(async () => {
            try {
              await api.updateFloorPlan(projectId, floorPlanId, { corners: newCorners });
              for (const iw of movedIws) {
                await api.updateInteriorWall(projectId, floorPlanId, iw.id, {
                  x1: iw.x1, y1: iw.y1, x2: iw.x2, y2: iw.y2,
                });
              }
              onMaterialsChanged?.();
            } catch (err) { setError(err.message); }
          }, 300);
          const origCorners = ds.origCorners;
          const origIws = ds.origInteriorWalls;
          pushUndo('move wall', async () => {
            setCorners(origCorners);
            setInteriorWalls(origIws);
            await api.updateFloorPlan(projectId, floorPlanId, { corners: origCorners });
            for (const iw of movedIws) {
              const orig = origIws.find((x) => x.id === iw.id);
              if (orig) {
                await api.updateInteriorWall(projectId, floorPlanId, orig.id, {
                  x1: orig.x1, y1: orig.y1, x2: orig.x2, y2: orig.y2,
                });
              }
            }
            onMaterialsChanged?.();
          });
        } else {
          // Treat as click — select the edge
          setWallDragPreview(null);
          setSelectedWallIdx(ds.idx);
          setSelectedCornerIdx(null);
          setSelectedOpeningId(null);
          setSelectedInteriorWallId(null);
        }
      } else if (ds.type === 'interior_endpoint') {
        if (ds.moved) {
          const iw = interiorWalls.find((x) => x.id === ds.interiorId);
          if (iw) {
            const patch = ds.end === 'a'
              ? { x1: iw.x1, y1: iw.y1 }
              : { x2: iw.x2, y2: iw.y2 };
            clearTimeout(interiorWallSaveTimers.current[ds.interiorId]);
            interiorWallSaveTimers.current[ds.interiorId] = setTimeout(() => {
              api.updateInteriorWall(projectId, floorPlanId, ds.interiorId, patch)
                .then(() => onMaterialsChanged?.())
                .catch((err) => setError(err.message));
            }, 300);
            const orig = ds.origIw;
            if (orig) {
              pushUndo('move interior endpoint', async () => {
                setInteriorWalls((cur) => cur.map((x) => x.id === orig.id ? { ...x, x1: orig.x1, y1: orig.y1, x2: orig.x2, y2: orig.y2 } : x));
                await api.updateInteriorWall(projectId, floorPlanId, orig.id, {
                  x1: orig.x1, y1: orig.y1, x2: orig.x2, y2: orig.y2,
                });
                onMaterialsChanged?.();
              });
            }
          }
        } else {
          // Click on endpoint = select wall
          setSelectedInteriorWallId(ds.interiorId);
          setSelectedCornerIdx(null);
          setSelectedWallIdx(null);
          setSelectedOpeningId(null);
        }
      } else if (ds.type === 'interior_select') {
        if (!ds.moved) {
          setSelectedInteriorWallId(ds.interiorId);
          setSelectedCornerIdx(null);
          setSelectedWallIdx(null);
          setSelectedOpeningId(null);
        }
      }
      return;
    }
    if (e.button !== 0) return;
    if (spaceDown.current) return;

    const { sx, sy, world } = getMouseWorld(e);

    // DRAW INTERIOR — two-click segment. Only available when polygon closed.
    if (sketchMode === 'draw_interior') {
      if (corners.length < 3) return; // need a closed polygon
      const snapTarget = findInteriorSnapTarget(world);
      const placed = snapTarget || snapWorld(world);
      if (!pendingInteriorEndpoint) {
        setPendingInteriorEndpoint(placed);
      } else {
        if (placed.x === pendingInteriorEndpoint.x && placed.y === pendingInteriorEndpoint.y) return;
        createInteriorWall(pendingInteriorEndpoint, placed);
        setPendingInteriorEndpoint(null);
      }
      return;
    }

    // DRAW EXTERIOR — click-click corner placement. Disabled once polygon closed.
    if (sketchMode === 'draw_exterior') {
      if (corners.length >= 3 && drawingPhase === 'interior') return; // polygon already closed
      // Click on first corner closes the polygon.
      if (corners.length >= 3) {
        const firstHit = hitTestCorner(sx, sy);
        if (firstHit === 0) {
          closePolygonAndSwitchToInterior();
          return;
        }
      }
      const snapped = snapWorld(world);
      const last = corners[corners.length - 1];
      if (last && last.x === snapped.x && last.y === snapped.y) return;
      const prevCorners = corners.slice();
      setCorners((cur) => [...cur, snapped]);
      // Push undo: remove the corner we just added (revert to prevCorners and persist).
      pushUndo('add corner', async () => {
        setCorners(prevCorners);
        if (prevCorners.length >= 3) {
          await api.updateFloorPlan(projectId, floorPlanId, { corners: prevCorners });
          onMaterialsChanged?.();
        }
      });
      return;
    }

    // PAN tool — clicks do nothing (drag was handled in mouseDown).
    if (sketchMode === 'pan') return;

    // SELECT mode (mode === 'editing'): hit-test opening → corner → interior wall → edge
    const hitO = hitTestOpening(sx, sy);
    if (hitO) {
      setSelectedOpeningId(hitO.id);
      setSelectedCornerIdx(null);
      setSelectedWallIdx(null);
      setSelectedInteriorWallId(null);
      return;
    }
    const hitC = hitTestCorner(sx, sy);
    if (hitC != null) {
      setSelectedCornerIdx(hitC);
      setSelectedWallIdx(null);
      setSelectedOpeningId(null);
      setSelectedInteriorWallId(null);
      return;
    }
    const hitI = hitTestInteriorWall(sx, sy, world);
    if (hitI) {
      setSelectedInteriorWallId(hitI.id);
      setSelectedCornerIdx(null);
      setSelectedWallIdx(null);
      setSelectedOpeningId(null);
      return;
    }
    const hitE = hitTestEdge(world);
    if (hitE != null) {
      setSelectedWallIdx(hitE);
      setSelectedCornerIdx(null);
      setSelectedOpeningId(null);
      setSelectedInteriorWallId(null);
      return;
    }
    // Click on empty canvas — deselect
    setSelectedCornerIdx(null);
    setSelectedWallIdx(null);
    setSelectedOpeningId(null);
    setSelectedInteriorWallId(null);
  }

  function onWheel(e) {
    // Plain scroll passes through to the page. Hold Ctrl to zoom the canvas.
    if (!e.ctrlKey) return;
    e.preventDefault();
    const { sx, sy } = getMouseWorld(e);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setViewport((vp) => {
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, vp.zoom * factor));
      const worldUnderMouse = {
        x: (sx - vp.panX) / (BASE_GRID_PX * vp.zoom),
        y: (sy - vp.panY) / (BASE_GRID_PX * vp.zoom),
      };
      return {
        panX: sx - worldUnderMouse.x * BASE_GRID_PX * newZoom,
        panY: sy - worldUnderMouse.y * BASE_GRID_PX * newZoom,
        zoom: newZoom,
      };
    });
  }

  function onMouseLeave() {
    setHoverWorld(null);
    panState.current.active = false;
    if (dragState.current.active) {
      dragState.current = { active: false, type: null, idx: null, openingId: null, moved: false };
      setDragLabel(null);
    }
  }

  async function onContextMenu(e) {
    e.preventDefault();
    if (mode !== 'editing') return;
    const { sx, sy } = getMouseWorld(e);
    const cIdx = hitTestCorner(sx, sy);
    if (cIdx != null) {
      // Right-click corner → delete it (collapses two adjacent edges into one)
      if (corners.length <= 3) { setError('Cannot delete: polygon needs at least 3 corners.'); return; }
      const widx = (cIdx - 1 + corners.length) % corners.length;
      const origCorners = corners.slice();
      try {
        const updated = await api.deleteFloorPlanWall(projectId, floorPlanId, widx);
        setCorners(Array.isArray(updated.corners) ? updated.corners : []);
        setWalls(updated.walls || []);
        setOpenings(updated.openings || []);
        setSelectedCornerIdx(null);
        setSelectedWallIdx(null);
        setSelectedOpeningId(null);
        onMaterialsChanged?.();
        onOpeningsChanged?.();
        pushUndo('delete corner', async () => {
          const restored = await api.updateFloorPlan(projectId, floorPlanId, { corners: origCorners });
          setCorners(restored.corners || origCorners);
          setWalls(restored.walls || []);
          setOpenings(restored.openings || []);
          onMaterialsChanged?.(); onOpeningsChanged?.();
        });
      } catch (err) { setError(err.message); }
    }
  }

  // ---- keyboard ----
  useEffect(() => {
    function isTypingTarget(t) {
      if (!t) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t.isContentEditable;
    }
    async function onKeyDown(e) {
      if (e.code === 'Space') { spaceDown.current = true; return; }
      // Ctrl+Z (or Cmd+Z) → undo. Doesn't fire while typing.
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) {
        if (isTypingTarget(e.target)) return;
        e.preventDefault();
        popUndo();
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (e.code === 'Enter' && mode === 'placing' && drawingPhase === 'exterior' && corners.length >= 3) {
        await closePolygonAndSwitchToInterior();
      } else if (e.code === 'Escape') {
        if (fullscreen) { setFullscreen(false); return; }
        if (tool !== 'idle') {
          setTool('idle');
          setToolPoints([]);
          setMeasurements([]);
          setCalibDialog({ open: false, distFt: '' });
          return;
        }
        if (pendingInteriorEndpoint) {
          setPendingInteriorEndpoint(null);
        } else if (mode === 'placing' && drawingPhase === 'exterior' && corners.length > 0) {
          // Pop the last placed corner
          setCorners((cur) => cur.slice(0, -1));
        } else {
          setSelectedCornerIdx(null);
          setSelectedWallIdx(null);
          setSelectedOpeningId(null);
          setSelectedInteriorWallId(null);
        }
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        if (selectedOpeningId != null) { e.preventDefault(); deleteSelectedOpening(); }
        else if (selectedInteriorWallId != null) {
          e.preventDefault();
          deleteInteriorWall(selectedInteriorWallId);
        }
      }
    }
    function onKeyUp(e) { if (e.code === 'Space') spaceDown.current = false; }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, corners, selectedOpeningId, selectedInteriorWallId, floorPlanId, projectId, drawingPhase, pendingInteriorEndpoint, tool, fullscreen]);

  // ---- mutations ----
  async function closePolygonAndSwitchToInterior() {
    try {
      const updated = await api.updateFloorPlan(projectId, floorPlanId, {
        corners,
        drawing_phase: 'interior',
      });
      setCorners(updated.corners || corners);
      setWalls(updated.walls || []);
      setOpenings(updated.openings || []);
      setInteriorWalls(updated.interior_walls || []);
      setDrawingPhase('interior');
      setMode('placing'); // stay in placing so user can immediately draw interior walls
      setSketchMode('draw_interior');
      setPendingInteriorEndpoint(null);
      showToast('Exterior walls complete — now drawing interior walls.');
      onMaterialsChanged?.();
      onOpeningsChanged?.();
    } catch (err) { setError(err.message); }
  }

  async function setDrawingPhasePersist(phase) {
    setDrawingPhase(phase);
    setPendingInteriorEndpoint(null);
    try {
      await api.updateFloorPlan(projectId, floorPlanId, { drawing_phase: phase });
    } catch (err) { setError(err.message); }
  }

  async function createInteriorWall(a, b) {
    try {
      const created = await api.createInteriorWall(projectId, floorPlanId, {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        wall_type: 'interior_2x4',
      });
      setInteriorWalls((cur) => [...cur, created]);
      onMaterialsChanged?.();
      pushUndo('add interior wall', async () => {
        await api.deleteInteriorWall(projectId, floorPlanId, created.id);
        setInteriorWalls((cur) => cur.filter((iw) => iw.id !== created.id));
        if (selectedInteriorWallId === created.id) setSelectedInteriorWallId(null);
        onMaterialsChanged?.();
      });
    } catch (err) { setError(err.message); }
  }

  const updateInteriorWallById = useCallback((iwid, patch, { immediate = false } = {}) => {
    setInteriorWalls((cur) => cur.map((iw) => (iw.id === iwid ? { ...iw, ...patch } : iw)));
    const send = () => api.updateInteriorWall(projectId, floorPlanId, iwid, patch)
      .then(() => onMaterialsChanged?.())
      .catch((e) => setError(e.message));
    if (immediate) return send();
    clearTimeout(interiorWallSaveTimers.current[iwid]);
    interiorWallSaveTimers.current[iwid] = setTimeout(send, 500);
  }, [projectId, floorPlanId, onMaterialsChanged]);

  function commitCalibration() {
    const realFt = Number(calibDialog.distFt);
    if (!realFt || realFt <= 0) return;
    if (toolPoints.length < 2) return;
    const [a, b] = toolPoints;
    const worldDist = Math.hypot(b.x - a.x, b.y - a.y);
    if (worldDist <= 0) return;
    const newScale = realFt / worldDist; // ft per grid unit
    const pdfScalePxPerFt = BASE_GRID_PX / newScale; // for record per spec
    onProjectSettingsChange?.({
      scale_ft_per_grid: newScale,
      pdf_scale: pdfScalePxPerFt,
    });
    setCalibDialog({ open: false, distFt: '' });
    setToolPoints([]);
    setTool('idle');
    showToast(`Scale calibrated: ${realFt.toFixed(2)} ft over ${worldDist.toFixed(2)} grid units`);
  }

  function cancelCalibration() {
    setCalibDialog({ open: false, distFt: '' });
    setToolPoints([]);
  }

  async function deleteInteriorWall(iwid) {
    try {
      const orig = interiorWalls.find((iw) => iw.id === iwid);
      await api.deleteInteriorWall(projectId, floorPlanId, iwid);
      setInteriorWalls((cur) => cur.filter((iw) => iw.id !== iwid));
      if (selectedInteriorWallId === iwid) setSelectedInteriorWallId(null);
      onMaterialsChanged?.();
      if (orig) {
        pushUndo('delete interior wall', async () => {
          const recreated = await api.createInteriorWall(projectId, floorPlanId, {
            x1: orig.x1, y1: orig.y1, x2: orig.x2, y2: orig.y2,
            wall_type: orig.wall_type,
            height: orig.height,
            on_concrete: orig.on_concrete,
            sheathing_override: orig.sheathing_override,
            drywall_override: orig.drywall_override,
            interior_wall_type_label: orig.interior_wall_type_label,
          });
          setInteriorWalls((cur) => [...cur, recreated]);
          onMaterialsChanged?.();
        });
      }
    } catch (err) { setError(err.message); }
  }

  async function clearFloorPlan() {
    if (!confirm('Clear floor plan? This deletes all corners, walls, openings, and interior walls.')) return;
    try {
      // Reset drawing_phase too so a fresh sketch starts in exterior mode.
      const updated = await api.updateFloorPlan(projectId, floorPlanId, { corners: [], drawing_phase: 'exterior' });
      setCorners([]); setWalls([]); setOpenings([]);
      // Wipe any interior walls — server cascades on floor_plan delete but not on corners reset,
      // so issue an explicit cleanup.
      for (const iw of interiorWalls) {
        try { await api.deleteInteriorWall(projectId, floorPlanId, iw.id); } catch {}
      }
      setInteriorWalls([]);
      setDrawingPhase('exterior');
      setSelectedCornerIdx(null); setSelectedWallIdx(null); setSelectedOpeningId(null);
      setSelectedInteriorWallId(null);
      setPendingInteriorEndpoint(null);
      setMode('placing');
      onMaterialsChanged?.();
      onOpeningsChanged?.();
    } catch (e) { setError(e.message); }
  }

  const wallSaveTimers = useRef({});
  const updateWallByIndex = useCallback((widx, patch, { immediate = false } = {}) => {
    setWalls((cur) => cur.map((w) => (Number(w.wall_index) === widx ? { ...w, ...patch } : w)));
    const send = () => api.updateFloorPlanWall(projectId, floorPlanId, widx, patch)
      .then(() => onMaterialsChanged?.())
      .catch((e) => setError(e.message));
    if (immediate) return send();
    clearTimeout(wallSaveTimers.current[widx]);
    wallSaveTimers.current[widx] = setTimeout(send, 500);
  }, [projectId, floorPlanId, onMaterialsChanged]);

  async function createOpening(payload) {
    try {
      const wall = walls.find((w) => Number(w.wall_index) === payload.wall_index);
      if (!wall) return;
      const created = await api.createOpening(projectId, {
        ...payload,
        floor_plan_wall_id: wall.id,
        wall_id: undefined,
      });
      setOpenings((cur) => [...cur, created]);
      onMaterialsChanged?.();
      onOpeningsChanged?.();
      pushUndo('add opening', async () => {
        await api.deleteOpening(projectId, created.id);
        setOpenings((cur) => cur.filter((o) => o.id !== created.id));
        if (selectedOpeningId === created.id) setSelectedOpeningId(null);
        onMaterialsChanged?.(); onOpeningsChanged?.();
      });
      return created;
    } catch (e) { setError(e.message); }
  }
  async function deleteSelectedOpening() {
    if (selectedOpeningId == null) return;
    const oid = selectedOpeningId;
    const orig = openings.find((o) => o.id === oid);
    setSelectedOpeningId(null);
    setOpenings((cur) => cur.filter((o) => o.id !== oid));
    try {
      await api.deleteOpening(projectId, oid);
      onMaterialsChanged?.();
      onOpeningsChanged?.();
      if (orig) {
        pushUndo('delete opening', async () => {
          const recreated = await api.createOpening(projectId, {
            floor_plan_wall_id: orig.floor_plan_wall_id,
            wall_id: orig.wall_id ?? undefined,
            type: orig.type,
            rough_opening_width: orig.rough_opening_width,
            rough_opening_height: orig.rough_opening_height,
            label: orig.label,
            position_along_wall: orig.position_along_wall,
          });
          setOpenings((cur) => [...cur, recreated]);
          onMaterialsChanged?.(); onOpeningsChanged?.();
        });
      }
    } catch (e) { setError(e.message); }
  }
  const openingPatchTimers = useRef({});
  const updateOpening = useCallback((oid, patch, { immediate = false } = {}) => {
    setOpenings((cur) => cur.map((o) => (o.id === oid ? { ...o, ...patch } : o)));
    const send = () => api.updateOpening(projectId, oid, patch)
      .then(() => { onMaterialsChanged?.(); onOpeningsChanged?.(); })
      .catch((e) => setError(e.message));
    if (immediate) return send();
    clearTimeout(openingPatchTimers.current[oid]);
    openingPatchTimers.current[oid] = setTimeout(send, 500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, onMaterialsChanged]);

  // ---- derived selections ----
  const selectedWall = selectedWallIdx != null ? wallByIndex.get(selectedWallIdx) : null;
  const selectedCorner = selectedCornerIdx != null ? corners[selectedCornerIdx] : null;
  const selectedOpening = openings.find((o) => o.id === selectedOpeningId) || null;

  const perimeterFt = corners.length >= 3
    ? corners.reduce((sum, _, i) => sum + edgeLengthFt(corners, i, scaleFtPerGrid), 0)
    : 0;
  const areaSf = polygonAreaSf(corners, scaleFtPerGrid);

  const polygonClosed = corners.length >= 3 && (mode === 'editing' || drawingPhase === 'interior');
  const selectedInteriorWall = interiorWalls.find((iw) => iw.id === selectedInteriorWallId) || null;
  const cursorStyle = spaceDown.current
    ? 'grab'
    : sketchMode === 'pan'
      ? (panState.current.active ? 'grabbing' : 'grab')
      : (tool === 'calibrate' || tool === 'measure'
          ? 'crosshair'
          : (sketchMode === 'draw_exterior' || sketchMode === 'draw_interior'
              ? 'crosshair'
              : (hoverCursor === 'move' ? 'move' : 'default')));

  function chooseMode(next) {
    // Clear any in-flight pending state when switching tools.
    setSelectedCornerIdx(null);
    setSelectedWallIdx(null);
    setSelectedOpeningId(null);
    setSelectedInteriorWallId(null);
    setPendingInteriorEndpoint(null);
    setSketchMode(next);
    // Keep server-side `mode` in sync so existing render gates (closing edge in
    // exterior placing, etc.) keep working.
    if (next === 'draw_exterior') setMode('placing');
    else if (next === 'draw_interior') setMode('placing');
    else setMode(corners.length >= 3 ? 'editing' : 'placing');
  }

  const containerStyle = fullscreen
    ? { position: 'fixed', inset: 0, zIndex: 1000, background: 'white', overflow: 'auto', padding: '0.5rem' }
    : undefined;

  return (
    <div style={containerStyle}>
      <ModeToolbar
        sketchMode={sketchMode}
        chooseMode={chooseMode}
        polygonClosed={polygonClosed}
        canDrawExterior={!polygonClosed}
        canDrawInterior={polygonClosed}
        fullscreen={fullscreen}
        toggleFullscreen={() => setFullscreen((v) => !v)}
        canUndo={undoCount > 0}
        onUndo={popUndo}
      />
      <PdfToolbar
        controls={pdfControls}
        tool={tool}
        setTool={(t) => { setTool(t); setToolPoints([]); setMeasurements([]); }}
      />
      <div className="sketch-toolbar">
        {tool === 'calibrate' ? (
          <span className="muted">
            <strong>Calibrate scale:</strong> click two points on the plan that you know the distance between ({toolPoints.length}/2). <strong>Esc</strong> cancels.
          </span>
        ) : tool === 'measure' ? (
          <span className="muted">
            <strong>Measure:</strong> click two points to draw a measurement line. Repeat for more. <strong>Esc</strong> exits.
          </span>
        ) : sketchMode === 'draw_interior' ? (
          <span className="muted">
            <strong>{level}</strong> · drawing <strong>interior walls</strong> · click two points to place a wall · <strong>Esc</strong> cancels pending point
          </span>
        ) : sketchMode === 'draw_exterior' ? (
          <span className="muted">
            <strong>{level}</strong> · drawing <strong>exterior walls</strong> · click to place corners ({corners.length} placed) · click first corner or press <strong>Enter</strong> to close (need 3+) · <strong>Esc</strong> undoes last
          </span>
        ) : sketchMode === 'pan' ? (
          <span className="muted">
            <strong>Pan:</strong> click and drag the canvas to move the view. <strong>Ctrl+wheel</strong> still zooms.
          </span>
        ) : (
          <span className="muted">
            <strong>{level}</strong> · click corner/edge/wall to select · drag corner or wall · right-click corner to delete · <strong>Ctrl+drag</strong> or PAN tool moves the view · <strong>Ctrl+wheel</strong> zooms
          </span>
        )}
        <span className="right muted">
          {corners.length} corner{corners.length === 1 ? '' : 's'} · {interiorWalls.length} interior · {openings.length} opening{openings.length === 1 ? '' : 's'} · {perimeterFt.toFixed(1)} lf · {areaSf.toFixed(0)} sf
        </span>
        {level !== 'floor1' && corners.length === 0 && (
          <button className="secondary" style={{ flex: '0 0 auto' }} onClick={copyFromFloor1}>Copy from Floor 1</button>
        )}
        {polygonClosed && (
          <button className="danger" style={{ flex: '0 0 auto' }} onClick={clearFloorPlan}>Clear floor plan</button>
        )}
      </div>
      <div className="sketch-area">
        <div className="sketch-canvas-wrap" ref={wrapRef} style={{ position: 'relative' }}>
          <canvas
            ref={canvasRef}
            tabIndex={0}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave}
            onWheel={onWheel}
            onContextMenu={onContextMenu}
            style={{ cursor: cursorStyle, display: 'block', background: GRID_BG }}
          />
          {mode === 'placing' && (
            <div style={{
              position: 'absolute', top: 8, left: 8,
              padding: '0.3rem 0.6rem',
              background: 'rgba(10,10,10,0.85)', color: 'white',
              fontSize: '12px', fontWeight: 600, borderRadius: 4,
              pointerEvents: 'none',
            }}>
              Drawing: {drawingPhase === 'interior' ? 'Interior Walls' : 'Exterior Walls'}
            </div>
          )}
          {toast && (
            <div style={{
              position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
              padding: '0.5rem 1rem',
              background: 'rgba(10,10,10,0.92)', color: 'white',
              fontSize: '13px', borderRadius: 6,
              pointerEvents: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            }}>{toast}</div>
          )}
          {calibDialog.open && (
            <div style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              background: 'white', border: '1px solid #E0E0E0', borderRadius: 8,
              padding: '1rem', minWidth: 320, boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            }}>
              <strong style={{ display: 'block', marginBottom: '0.5rem' }}>Set scale</strong>
              <p className="muted" style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem' }}>
                What is the real-world distance between these two points?
              </p>
              <input
                type="number"
                step="0.1"
                autoFocus
                value={calibDialog.distFt}
                onChange={(e) => setCalibDialog({ ...calibDialog, distFt: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') commitCalibration(); }}
                placeholder="ft"
                style={{ width: '100%' }}
              />
              <div className="row" style={{ marginTop: '0.75rem' }}>
                <button className="primary" style={{ flex: 1 }} onClick={commitCalibration}>Set scale</button>
                <button className="secondary" style={{ flex: 1 }} onClick={cancelCalibration}>Cancel</button>
              </div>
            </div>
          )}
        </div>
        {selectedOpening && (
          <OpeningEditor
            opening={selectedOpening}
            onChange={(patch, opts) => updateOpening(selectedOpening.id, patch, opts)}
            onDelete={deleteSelectedOpening}
            onClose={() => setSelectedOpeningId(null)}
          />
        )}
        {!selectedOpening && selectedWall && (
          <WallEditor
            wall={selectedWall}
            scale={scaleFtPerGrid}
            edgeLengthFt={edgeLengthFt(corners, selectedWallIdx, scaleFtPerGrid)}
            wallIndex={selectedWallIdx}
            wallOpenings={openings.filter((o) => o.floor_plan_wall_id === selectedWall.id)}
            onChange={(patch, opts) => updateWallByIndex(selectedWallIdx, patch, opts)}
            onClose={() => setSelectedWallIdx(null)}
            onAddOpening={(payload) => createOpening({ ...payload, wall_index: selectedWallIdx })}
            onSelectOpening={(oid) => { setSelectedOpeningId(oid); setSelectedWallIdx(null); }}
          />
        )}
        {!selectedOpening && !selectedWall && selectedInteriorWall && (
          <InteriorWallEditor
            wall={selectedInteriorWall}
            scale={scaleFtPerGrid}
            onChange={(patch, opts) => updateInteriorWallById(selectedInteriorWall.id, patch, opts)}
            onDelete={() => deleteInteriorWall(selectedInteriorWall.id)}
            onClose={() => setSelectedInteriorWallId(null)}
          />
        )}
        {!selectedOpening && !selectedWall && !selectedInteriorWall && selectedCorner && (
          <div className="wall-editor card">
            <div className="row" style={{ marginBottom: '0.5rem' }}>
              <strong style={{ flex: 1 }}>Corner #{selectedCornerIdx}</strong>
              <button className="secondary" style={{ flex: '0 0 auto', padding: '0.25rem 0.5rem' }} onClick={() => setSelectedCornerIdx(null)}>×</button>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              At ({selectedCorner.x}, {selectedCorner.y})
            </p>
            <p className="muted" style={{ marginTop: '0.5rem' }}>
              Drag to reposition. Right-click to delete (merges adjacent walls).
            </p>
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// ---------- Roof panel (rectangle drawing + form) ----------
const PITCH_OPTIONS = ['4:12', '6:12', '8:12', '10:12', '12:12'];
const SHEATHING_TYPE_OPTIONS = [
  { value: 'plywood_1_2_csp', label: '1/2" CSP Plywood' },
  { value: 'osb_7_16',        label: '7/16" OSB' },
  { value: 'plywood_5_8',     label: '5/8" Plywood' },
];
const SPACING_OPTIONS = [
  { value: '24_oc', label: '24" o.c.' },
  { value: '16_oc', label: '16" o.c.' },
];
const SIDE_OPTIONS = [
  { value: 'gable', label: 'Gable' },
  { value: 'hip', label: 'Hip' },
];

function RoofPanel({ projectId, onMaterialsChanged }) {
  const [roof, setRoof] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Draft for new roof (when none exists)
  const [draftWidth, setDraftWidth] = useState('');
  const [draftDepth, setDraftDepth] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.getRoof(projectId)
      .then((r) => { if (!cancelled) { setRoof(r); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [projectId]);

  async function createRoof() {
    if (!draftWidth || !draftDepth) return;
    try {
      const created = await api.createRoof(projectId, {
        width_ft: Number(draftWidth), depth_ft: Number(draftDepth),
        pitch: '6:12', sheathing_type: 'plywood_1_2_csp', rafter_spacing: '24_oc',
      });
      setRoof(created);
      onMaterialsChanged?.();
    } catch (e) { setError(e.message); }
  }

  const saveTimer = useRef(null);
  function patchRoof(patch) {
    setRoof((cur) => ({ ...cur, ...patch }));
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const updated = await api.updateRoof(projectId, patch);
        setRoof(updated);
        onMaterialsChanged?.();
      } catch (e) { setError(e.message); }
    }, 400);
  }

  async function deleteRoof() {
    if (!confirm('Delete the roof? This removes all roof materials from the takeoff.')) return;
    try {
      await api.deleteRoof(projectId);
      setRoof(null);
      onMaterialsChanged?.();
    } catch (e) { setError(e.message); }
  }

  if (loading) return <p className="muted">Loading roof…</p>;

  if (!roof) {
    return (
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          No roof yet. Enter the roof footprint dimensions below.
        </p>
        <div className="row">
          <div>
            <label>Width (ft)</label>
            <input type="number" value={draftWidth} onChange={(e) => setDraftWidth(e.target.value)} placeholder="40" />
          </div>
          <div>
            <label>Depth (ft)</label>
            <input type="number" value={draftDepth} onChange={(e) => setDraftDepth(e.target.value)} placeholder="50" />
          </div>
          <div style={{ flex: '0 0 auto' }}>
            <button className="primary" onClick={createRoof}>Create roof</button>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: '0.5rem' }}>
        <strong style={{ flex: 1 }}>
          Roof: {Number(roof.width_ft)} × {Number(roof.depth_ft)} ft, {roof.pitch} pitch · {SHEATHING_TYPE_OPTIONS.find((o) => o.value === roof.sheathing_type)?.label || roof.sheathing_type}
        </strong>
        <button className="danger" style={{ flex: '0 0 auto', padding: '0.3rem 0.7rem' }} onClick={deleteRoof}>Delete roof</button>
      </div>
      <div className="row">
        <div>
          <label>Width (ft)</label>
          <input type="number" value={roof.width_ft ?? ''} onChange={(e) => patchRoof({ width_ft: e.target.value })} />
        </div>
        <div>
          <label>Depth (ft)</label>
          <input type="number" value={roof.depth_ft ?? ''} onChange={(e) => patchRoof({ depth_ft: e.target.value })} />
        </div>
        <div>
          <label>Pitch</label>
          <select value={roof.pitch} onChange={(e) => patchRoof({ pitch: e.target.value })}>
            {PITCH_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div className="row">
        <div>
          <label>Sheathing</label>
          <select value={roof.sheathing_type} onChange={(e) => patchRoof({ sheathing_type: e.target.value })}>
            {SHEATHING_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label>Rafter / truss spacing</label>
          <select value={roof.rafter_spacing} onChange={(e) => patchRoof({ rafter_spacing: e.target.value })}>
            {SPACING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <div className="row">
        {['north', 'south', 'east', 'west'].map((side) => (
          <div key={side}>
            <label>{side[0].toUpperCase() + side.slice(1)} side</label>
            <select
              value={roof[`${side}_side`]}
              onChange={(e) => patchRoof({ [`${side}_side`]: e.target.value })}
            >
              {SIDE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        ))}
      </div>
      <label>Notes</label>
      <textarea
        value={roof.notes ?? ''}
        onChange={(e) => patchRoof({ notes: e.target.value })}
        rows={2}
        style={{ resize: 'vertical' }}
      />
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function polygonAreaSf(corners, scale) {
  if (corners.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < corners.length; i++) {
    const p = corners[i];
    const q = corners[(i + 1) % corners.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2) * scale * scale;
}

// ---------- side panels ----------
function WallEditor({ wall, scale, edgeLengthFt: lengthFt, wallIndex, wallOpenings, onChange, onClose, onAddOpening, onSelectOpening }) {
  const [showAdd, setShowAdd] = useState(false);
  const [addType, setAddType] = useState('window');
  const [addPresetIdx, setAddPresetIdx] = useState(0);
  const [addLabel, setAddLabel] = useState('');
  const [addCustomW, setAddCustomW] = useState('');
  const [addCustomH, setAddCustomH] = useState('');

  function resetAdd() {
    setShowAdd(false); setAddPresetIdx(0); setAddLabel(''); setAddCustomW(''); setAddCustomH('');
  }
  function changeType(t) { setAddType(t); setAddPresetIdx(0); }
  async function submitAdd() {
    const presets = presetsFor(addType);
    const preset = presets[addPresetIdx];
    let w, h;
    if (preset.label === 'Custom') {
      w = Number(addCustomW); h = Number(addCustomH);
      if (!w || !h) return;
    } else { w = preset.w; h = preset.h; }
    await onAddOpening({
      type: addType, rough_opening_width: w, rough_opening_height: h, label: addLabel.trim() || null,
    });
    resetAdd();
  }
  const presets = presetsFor(addType);
  const isCustom = presets[addPresetIdx]?.label === 'Custom';

  return (
    <div className="wall-editor card">
      <div className="row" style={{ marginBottom: '0.5rem' }}>
        <strong style={{ flex: 1 }}>Wall #{wallIndex}</strong>
        <button className="secondary" style={{ flex: '0 0 auto', padding: '0.25rem 0.5rem' }} onClick={onClose}>×</button>
      </div>
      <p className="muted" style={{ margin: 0 }}>Length: {lengthFt.toFixed(2)} ft</p>

      <label>Wall type</label>
      <select value={wall.wall_type} onChange={(e) => onChange({ wall_type: e.target.value }, { immediate: true })}>
        {WALL_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <label>Height (ft) — blank = inherit</label>
      <input
        type="number" step="0.5"
        value={wall.height ?? ''} placeholder="(default)"
        onChange={(e) => onChange({ height: e.target.value === '' ? null : e.target.value })}
      />

      <label>Sheathing override</label>
      <select value={wall.sheathing_override ?? ''}
        onChange={(e) => onChange({ sheathing_override: e.target.value || null }, { immediate: true })}>
        <option value="">(default)</option>
        {SHEATHING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <label>Drywall override</label>
      <select value={wall.drywall_override ?? ''}
        onChange={(e) => onChange({ drywall_override: e.target.value || null }, { immediate: true })}>
        <option value="">(default)</option>
        {DRYWALL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
        <input
          type="checkbox"
          checked={!!wall.on_concrete}
          onChange={(e) => onChange({ on_concrete: e.target.checked }, { immediate: true })}
        />
        Wall sits on concrete
      </label>

      <hr style={{ margin: '1rem 0', border: 'none', borderTop: '1px solid #E0E0E0' }} />

      <div className="row" style={{ marginBottom: '0.5rem' }}>
        <strong style={{ flex: 1 }}>Openings ({wallOpenings.length})</strong>
        {!showAdd && (
          <button className="primary" style={{ flex: '0 0 auto', padding: '0.3rem 0.6rem' }} onClick={() => setShowAdd(true)}>+ Add Opening</button>
        )}
      </div>
      {wallOpenings.length > 0 && (
        <ul style={{ paddingLeft: '1.2rem', margin: 0 }}>
          {wallOpenings.map((o) => {
            const preset = findPresetLabel(o.type, o.rough_opening_width, o.rough_opening_height);
            return (
              <li key={o.id} style={{ fontSize: '0.85rem', marginBottom: '0.2rem' }}>
                <a href="#" onClick={(e) => { e.preventDefault(); onSelectOpening(o.id); }}>
                  {o.type === 'door' ? '🚪' : '🪟'} {o.label || preset}
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {showAdd && (
        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#FAFAFA', borderRadius: 4 }}>
          <label>Type</label>
          <select value={addType} onChange={(e) => changeType(e.target.value)}>
            <option value="window">Window</option>
            <option value="door">Door</option>
          </select>
          <label>Preset size</label>
          <select value={addPresetIdx} onChange={(e) => setAddPresetIdx(Number(e.target.value))}>
            {presets.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
          </select>
          {isCustom && (
            <div className="row">
              <div><label>RO width (in)</label>
                <input type="number" value={addCustomW} onChange={(e) => setAddCustomW(e.target.value)} /></div>
              <div><label>RO height (in)</label>
                <input type="number" value={addCustomH} onChange={(e) => setAddCustomH(e.target.value)} /></div>
            </div>
          )}
          <label>Label (optional)</label>
          <input value={addLabel} onChange={(e) => setAddLabel(e.target.value)} placeholder="e.g. Front door" />
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <button className="primary" style={{ flex: 1 }} onClick={submitAdd}>Add</button>
            <button className="secondary" style={{ flex: 1 }} onClick={resetAdd}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Interior wall type dropdown — 4 options. The actual wall_type stays as
// 'interior_2x4' or 'interior_2x6' (rules engine knows only those two), while
// interior_wall_type_label carries the display variant ("plumbing wall", "load
// bearing", "firewall"). For load-bearing 2x6 and firewall variants, the label
// is informational; framing lumber selection follows the underlying 2x6 / 2x4 rule.
const INTERIOR_WALL_TYPE_OPTIONS = [
  { key: 'interior_2x4',           wall_type: 'interior_2x4', label: '2x4 Interior' },
  { key: 'interior_2x6_plumbing',  wall_type: 'interior_2x6', label: '2x6 Interior (plumbing wall)' },
  { key: 'interior_2x6_load',      wall_type: 'interior_2x6', label: '2x6 Interior Load Bearing' },
  { key: 'interior_2x4_firewall',  wall_type: 'interior_2x4', label: '2x4 Interior Firewall' },
];

function interiorTypeKey(wall) {
  if (wall.interior_wall_type_label) return wall.interior_wall_type_label;
  return wall.wall_type === 'interior_2x6' ? 'interior_2x6_plumbing' : 'interior_2x4';
}

function InteriorWallEditor({ wall, scale, onChange, onDelete, onClose }) {
  const lengthFt = Math.hypot(Number(wall.x2) - Number(wall.x1), Number(wall.y2) - Number(wall.y1)) * scale;
  const currentKey = interiorTypeKey(wall);
  return (
    <div className="wall-editor card">
      <div className="row" style={{ marginBottom: '0.5rem' }}>
        <strong style={{ flex: 1 }}>Interior wall #{wall.id}</strong>
        <button className="secondary" style={{ flex: '0 0 auto', padding: '0.25rem 0.5rem' }} onClick={onClose}>×</button>
      </div>
      <p className="muted" style={{ margin: 0 }}>Length: {lengthFt.toFixed(2)} ft</p>

      <label>Wall type</label>
      <select
        value={currentKey}
        onChange={(e) => {
          const key = e.target.value;
          const opt = INTERIOR_WALL_TYPE_OPTIONS.find((o) => o.key === key);
          if (!opt) return;
          // Send both: backing wall_type (for rules engine) + display label.
          onChange({ wall_type: opt.wall_type, interior_wall_type_label: opt.key }, { immediate: true });
        }}
      >
        {INTERIOR_WALL_TYPE_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </select>

      <label>Height (ft) — blank = inherit</label>
      <input
        type="number" step="0.5"
        value={wall.height ?? ''} placeholder="(default)"
        onChange={(e) => onChange({ height: e.target.value === '' ? null : e.target.value })}
      />

      <label>Drywall override</label>
      <select value={wall.drywall_override ?? ''}
        onChange={(e) => onChange({ drywall_override: e.target.value || null }, { immediate: true })}>
        <option value="">(default)</option>
        {DRYWALL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
        <input
          type="checkbox"
          checked={!!wall.on_concrete}
          onChange={(e) => onChange({ on_concrete: e.target.checked }, { immediate: true })}
        />
        Wall sits on concrete
      </label>

      <p className="muted" style={{ marginTop: '0.75rem', marginBottom: 0, fontSize: '0.85rem' }}>
        Drag either endpoint on the canvas to move it. Press Delete or Backspace to remove this wall.
      </p>
      <button className="danger" style={{ marginTop: '0.5rem', width: '100%' }} onClick={onDelete}>Delete this wall</button>
    </div>
  );
}

function OpeningEditor({ opening, onChange, onDelete, onClose }) {
  const presets = presetsFor(opening.type);
  const currentPresetIdx = presets.findIndex(
    (p) => p.w === Number(opening.rough_opening_width) && p.h === Number(opening.rough_opening_height),
  );
  const presetIdx = currentPresetIdx === -1 ? presets.length - 1 : currentPresetIdx;
  const isCustom = presets[presetIdx]?.label === 'Custom';

  function selectPreset(idx) {
    const p = presets[idx];
    if (p.label === 'Custom') return;
    onChange({ rough_opening_width: p.w, rough_opening_height: p.h }, { immediate: true });
  }

  return (
    <div className="wall-editor card">
      <div className="row" style={{ marginBottom: '0.5rem' }}>
        <strong style={{ flex: 1 }}>{opening.type === 'door' ? 'Door' : 'Window'} #{opening.id}</strong>
        <button className="secondary" style={{ flex: '0 0 auto', padding: '0.25rem 0.5rem' }} onClick={onClose}>×</button>
      </div>
      <label>Type</label>
      <select value={opening.type}
        onChange={(e) => {
          const newType = e.target.value;
          const first = presetsFor(newType)[0];
          onChange({ type: newType, rough_opening_width: first.w, rough_opening_height: first.h }, { immediate: true });
        }}>
        <option value="window">Window</option>
        <option value="door">Door</option>
      </select>
      <label>Preset size</label>
      <select value={presetIdx} onChange={(e) => selectPreset(Number(e.target.value))}>
        {presets.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
      </select>
      {isCustom && (
        <div className="row">
          <div><label>RO width (in)</label>
            <input type="number" value={opening.rough_opening_width ?? ''}
              onChange={(e) => onChange({ rough_opening_width: e.target.value })} /></div>
          <div><label>RO height (in)</label>
            <input type="number" value={opening.rough_opening_height ?? ''}
              onChange={(e) => onChange({ rough_opening_height: e.target.value })} /></div>
        </div>
      )}
      <label>Label (optional)</label>
      <input value={opening.label ?? ''}
        onChange={(e) => onChange({ label: e.target.value || null })} placeholder="e.g. Front door" />
      <button className="danger" style={{ marginTop: '1rem', width: '100%' }} onClick={onDelete}>Delete this opening</button>
    </div>
  );
}

// ---------- Mode toolbar (modal tool buttons + fullscreen + undo) ----------
function ModeToolbar({
  sketchMode, chooseMode,
  canDrawExterior, canDrawInterior,
  fullscreen, toggleFullscreen,
  canUndo, onUndo,
}) {
  const tools = [
    { key: 'select',         label: 'Select',         icon: ICONS.cursor,        enabled: true,            tooltip: 'Select & drag (default)' },
    { key: 'pan',            label: 'Pan',            icon: ICONS.hand,          enabled: true,            tooltip: 'Click and drag to pan the view' },
    { key: 'draw_exterior',  label: 'Exterior',       icon: ICONS.pencil,        enabled: canDrawExterior, tooltip: canDrawExterior ? 'Draw exterior wall corners' : 'Polygon already closed' },
    { key: 'draw_interior',  label: 'Interior',       icon: ICONS.pencilDashed,  enabled: canDrawInterior, tooltip: canDrawInterior ? 'Draw interior wall segments' : 'Close the exterior polygon first' },
  ];
  return (
    <div
      className="card"
      style={{
        display: 'flex', flexWrap: 'wrap', gap: '0.4rem',
        alignItems: 'center', padding: '0.4rem',
        marginBottom: '0.4rem',
      }}
    >
      {tools.map((t) => {
        const active = sketchMode === t.key;
        return (
          <button
            key={t.key}
            type="button"
            title={t.tooltip}
            disabled={!t.enabled}
            onClick={() => t.enabled && chooseMode(t.key)}
            className="secondary"
            style={{
              flex: '0 0 auto',
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.4rem 0.7rem',
              background: active ? '#CC0000' : 'white',
              color: active ? 'white' : (t.enabled ? '#1A1A1A' : '#9CA3AF'),
              border: active ? '1px solid #CC0000' : '1px solid #E0E0E0',
              cursor: t.enabled ? 'pointer' : 'not-allowed',
              opacity: t.enabled ? 1 : 0.6,
            }}
          >
            <span aria-hidden="true" style={{ display: 'inline-flex' }}>
              <Icon path={t.icon} stroke={active ? 'white' : (t.enabled ? '#1A1A1A' : '#9CA3AF')} />
            </span>
            <span style={{ fontSize: '0.85rem' }}>{t.label}</span>
          </button>
        );
      })}
      <span style={{ flex: 1 }} />
      <button
        type="button"
        title="Undo (Ctrl+Z)"
        disabled={!canUndo}
        onClick={onUndo}
        className="secondary"
        style={{
          flex: '0 0 auto',
          display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
          padding: '0.4rem 0.7rem',
          background: 'white', color: canUndo ? '#1A1A1A' : '#9CA3AF',
          border: '1px solid #E0E0E0',
          cursor: canUndo ? 'pointer' : 'not-allowed',
          opacity: canUndo ? 1 : 0.6,
        }}
      >
        <span aria-hidden="true" style={{ display: 'inline-flex' }}>
          <Icon path={ICONS.undo} stroke={canUndo ? '#1A1A1A' : '#9CA3AF'} />
        </span>
        <span style={{ fontSize: '0.85rem' }}>Undo</span>
      </button>
      <button
        type="button"
        title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
        onClick={toggleFullscreen}
        className="secondary"
        style={{
          flex: '0 0 auto',
          display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
          padding: '0.4rem 0.7rem',
          background: fullscreen ? '#CC0000' : 'white',
          color: fullscreen ? 'white' : '#1A1A1A',
          border: fullscreen ? '1px solid #CC0000' : '1px solid #E0E0E0',
        }}
      >
        <span aria-hidden="true" style={{ display: 'inline-flex' }}>
          <Icon path={ICONS.expand} stroke={fullscreen ? 'white' : '#1A1A1A'} />
        </span>
        <span style={{ fontSize: '0.85rem' }}>{fullscreen ? 'Exit' : 'Fullscreen'}</span>
      </button>
    </div>
  );
}

// Tiny inline-SVG icons drawn from a single path string.
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
  cursor:       'M4 3 L4 17 L9 13 L12 19 L14.5 17.5 L11.5 11.5 L17 11 Z',
  hand:         'M7 11 V6 a1.5 1.5 0 0 1 3 0 V11 M10 11 V4 a1.5 1.5 0 0 1 3 0 V11 M13 11 V5 a1.5 1.5 0 0 1 3 0 V13 M16 13 V8 a1.5 1.5 0 0 1 3 0 V14 a6 6 0 0 1 -6 6 H11 a4 4 0 0 1 -3.5 -2 L4 12 a1.7 1.7 0 0 1 3 -1.5 L8 12',
  pencil:       'M4 20 L4 16 L16 4 L20 8 L8 20 Z M14 6 L18 10',
  pencilDashed: 'M4 20 L4 16 L16 4 L20 8 L8 20 Z M14 6 L18 10 M3 22 L5 22 M7 22 L9 22 M11 22 L13 22',
  expand:       'M4 9 V4 H9 M20 9 V4 H15 M4 15 V20 H9 M20 15 V20 H15',
  undo:         'M9 14 L4 9 L9 4 M4 9 H14 a6 6 0 0 1 0 12 H10',
};

// ---------- PDF toolbar ----------
function PdfToolbar({ controls, tool, setTool }) {
  const fileRef = useRef(null);
  if (!controls) return null;
  const { pdfFilename, pdfStatus, pdfNumPages, pdfPage, pdfOpacity,
    setPdfOpacity, uploadPdf, removePdf, changePage } = controls;

  function pickFile() { fileRef.current?.click(); }
  function onFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      alert('Please choose a PDF file.');
      return;
    }
    uploadPdf(f);
  }

  return (
    <div className="sketch-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem' }}>
      <input ref={fileRef} type="file" accept="application/pdf" onChange={onFile} style={{ display: 'none' }} />
      {!pdfFilename ? (
        <button className="secondary" style={{ flex: '0 0 auto' }} onClick={pickFile}>Upload PDF</button>
      ) : (
        <>
          <span className="muted" style={{ flex: '0 0 auto' }}>
            PDF: {pdfStatus === 'loading' ? 'loading…' : pdfStatus === 'missing' ? 'file not found' : 'loaded'}
          </span>
          {pdfNumPages > 1 && (
            <span style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <button className="secondary" style={{ padding: '0.2rem 0.5rem' }} onClick={() => changePage(-1)} disabled={pdfPage <= 1}>‹</button>
              <span className="muted" style={{ fontSize: '0.85rem' }}>page {pdfPage} of {pdfNumPages}</span>
              <button className="secondary" style={{ padding: '0.2rem 0.5rem' }} onClick={() => changePage(+1)} disabled={pdfPage >= pdfNumPages}>›</button>
            </span>
          )}
          <span style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span className="muted" style={{ fontSize: '0.85rem' }}>Opacity {Math.round(pdfOpacity * 100)}%</span>
            <input type="range" min="0" max="60" step="1" value={Math.round(pdfOpacity * 100)}
              onChange={(e) => setPdfOpacity(Number(e.target.value) / 100)} />
          </span>
          <button className="secondary" style={{ flex: '0 0 auto' }} onClick={pickFile}>Replace PDF</button>
          <button className="danger" style={{ flex: '0 0 auto' }} onClick={removePdf}>Remove PDF</button>
        </>
      )}
      <span style={{ flex: 1 }} />
      <button
        className={tool === 'calibrate' ? 'primary' : 'secondary'}
        style={{ flex: '0 0 auto' }}
        onClick={() => setTool(tool === 'calibrate' ? 'idle' : 'calibrate')}
      >Calibrate scale</button>
      <button
        className={tool === 'measure' ? 'primary' : 'secondary'}
        style={{ flex: '0 0 auto' }}
        onClick={() => setTool(tool === 'measure' ? 'idle' : 'measure')}
      >Measure</button>
    </div>
  );
}

// ---------- canvas drawing ----------
function drawScene(ctx, size, vp, S) {
  const {
    corners, walls, openings, mode, selectedCornerIdx, selectedWallIdx, selectedOpeningId,
    hoverWorld, scale, dragLabel,
    interiorWalls = [], selectedInteriorWallId = null,
    drawingPhase = 'exterior',
    pendingInteriorEndpoint = null,
    wallDragPreview = null,
    pdfPageCanvas = null, pdfOpacity = 0.4, pdfStatus = 'none',
    tool = 'idle', toolPoints = [], measurements = [],
  } = S;
  ctx.fillStyle = GRID_BG;
  ctx.fillRect(0, 0, size.w, size.h);

  // PDF underlay sits beneath the grid so the grid + walls remain visible.
  if (pdfPageCanvas) {
    ctx.save();
    ctx.globalAlpha = pdfOpacity;
    ctx.drawImage(
      pdfPageCanvas,
      vp.panX, vp.panY,
      pdfPageCanvas.width * vp.zoom,
      pdfPageCanvas.height * vp.zoom,
    );
    ctx.restore();
  } else if (pdfStatus === 'missing') {
    ctx.save();
    ctx.fillStyle = 'rgba(204,0,0,0.08)';
    ctx.fillRect(20, 20, 360, 60);
    ctx.strokeStyle = '#CC0000';
    ctx.lineWidth = 1;
    ctx.strokeRect(20, 20, 360, 60);
    ctx.fillStyle = '#1A1A1A';
    ctx.font = '600 13px "Segoe UI", -apple-system, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('PDF not found — please re-upload', 32, 38);
    ctx.fillStyle = '#6B7280';
    ctx.font = '12px "Segoe UI", -apple-system, sans-serif';
    ctx.fillText('The server may have lost the file (ephemeral disk).', 32, 58);
    ctx.restore();
  }

  drawGrid(ctx, size, vp);

  // Polygon fill — only when closed (editing mode or interior phase)
  const polygonClosed = corners.length >= 3 && (mode === 'editing' || drawingPhase === 'interior');
  if (polygonClosed) {
    ctx.save();
    ctx.fillStyle = 'rgba(204,0,0,0.05)'; // primary at 5% — subtle red wash on closed polygon
    ctx.beginPath();
    for (let i = 0; i < corners.length; i++) {
      const s = worldToScreen(corners[i].x, corners[i].y, vp);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Polygon centroid (in screen coords) — used to push exterior dimension labels outside.
  let centroidScreen = null;
  if (corners.length >= 3 && polygonClosed) {
    let cx = 0, cy = 0;
    for (const c of corners) { cx += c.x; cy += c.y; }
    cx /= corners.length; cy /= corners.length;
    centroidScreen = worldToScreen(cx, cy, vp);
  }

  // Edges
  if (corners.length >= 2) {
    for (let i = 0; i < corners.length; i++) {
      // In exterior placing mode, don't draw the closing edge (corners[N-1] → corners[0]) yet
      if (mode === 'placing' && drawingPhase === 'exterior' && i === corners.length - 1) continue;
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      const wall = walls.find((w) => Number(w.wall_index) === i);
      // Skip the dragged wall — its preview is drawn separately
      if (wallDragPreview && wallDragPreview.idx === i) continue;
      drawEdge(ctx, a, b, vp, scale, i, wall, i === selectedWallIdx, centroidScreen);
    }
  }

  // Wall drag preview: dashed wall in new position + dashed adjusted adjacent walls.
  if (wallDragPreview) {
    const N = corners.length;
    const idx = wallDragPreview.idx;
    const newCorners = wallDragPreview.newCorners;
    const drawDashed = (a, b, color, width) => {
      const sa = worldToScreen(a.x, a.y, vp);
      const sb = worldToScreen(b.x, b.y, vp);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash([8, 4]);
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
      ctx.restore();
    };
    // Adjusted adjacent walls (using old fixed corner + new moved corner)
    drawDashed(corners[(idx - 1 + N) % N], newCorners[idx], ACCENT_RUST, 2);
    drawDashed(newCorners[(idx + 1) % N], corners[(idx + 2) % N], ACCENT_RUST, 2);
    // The dragged wall preview
    drawDashed(newCorners[idx], newCorners[(idx + 1) % N], ACCENT_RUST, 3);
  }

  // Interior walls — solid lines (thickness encodes type), label above the wall.
  for (const iw of interiorWalls) {
    const a = { x: Number(iw.x1), y: Number(iw.y1) };
    const b = { x: Number(iw.x2), y: Number(iw.y2) };
    const sa = worldToScreen(a.x, a.y, vp);
    const sb = worldToScreen(b.x, b.y, vp);
    const selected = iw.id === selectedInteriorWallId;
    const style = WALL_STYLES[iw.wall_type] || WALL_STYLES.interior_2x4;
    ctx.save();
    if (selected) {
      ctx.shadowColor = 'rgba(204,0,0,0.45)';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = ACCENT_RUST;
      ctx.lineWidth = 3;
    } else {
      ctx.strokeStyle = style.color;
      ctx.lineWidth = style.width;
    }
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
    ctx.restore();
    // Length-only label, offset 12 px on the visually-upper side.
    const lengthFt = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2) * scale;
    if (lengthFt > 0) {
      const mx = (sa.x + sb.x) / 2; const my = (sa.y + sb.y) / 2;
      const dx = sb.x - sa.x, dy = sb.y - sa.y;
      const len = Math.hypot(dx, dy) || 1;
      let nx = -dy / len, ny = dx / len;
      if (ny > 0) { nx = -nx; ny = -ny; } // pick the side with negative screen-y (upward)
      drawDimensionPill(ctx, mx + nx * 12, my + ny * 12, `${lengthFt.toFixed(2)} ft`);
    }
    // Endpoint dots
    for (const p of [sa, sb]) {
      ctx.fillStyle = selected ? ACCENT_RUST : CORNER_GRAY;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Pending interior endpoint (placing mode, interior phase) + preview to cursor
  if (mode === 'placing' && drawingPhase === 'interior' && pendingInteriorEndpoint) {
    const p = worldToScreen(pendingInteriorEndpoint.x, pendingInteriorEndpoint.y, vp);
    ctx.fillStyle = ACCENT_RUST;
    ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
    if (hoverWorld) {
      const h = worldToScreen(hoverWorld.x, hoverWorld.y, vp);
      ctx.save();
      ctx.strokeStyle = ACCENT_RUST;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(h.x, h.y); ctx.stroke();
      ctx.restore();
      const lenFt = Math.hypot(hoverWorld.x - pendingInteriorEndpoint.x, hoverWorld.y - pendingInteriorEndpoint.y) * scale;
      ctx.font = '12px "Segoe UI", -apple-system, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = ACCENT_RUST;
      ctx.fillText(`${lenFt.toFixed(2)} ft`, (p.x + h.x) / 2, (p.y + h.y) / 2 - 12);
    }
  }

  // Live preview from last corner to cursor (exterior placing mode only)
  if (mode === 'placing' && drawingPhase === 'exterior' && corners.length > 0 && hoverWorld) {
    const last = corners[corners.length - 1];
    const a = worldToScreen(last.x, last.y, vp);
    const b = worldToScreen(hoverWorld.x, hoverWorld.y, vp);
    ctx.strokeStyle = ACCENT_RUST;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    const dx = hoverWorld.x - last.x, dy = hoverWorld.y - last.y;
    const lengthFt = Math.sqrt(dx * dx + dy * dy) * scale;
    ctx.font = '12px "Segoe UI", -apple-system, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = ACCENT_RUST;
    ctx.fillText(`${lengthFt.toFixed(2)} ft`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 12);
  }

  // Corners on top of edges
  for (let i = 0; i < corners.length; i++) {
    const s = worldToScreen(corners[i].x, corners[i].y, vp);
    const selected = i === selectedCornerIdx;
    if (selected) {
      ctx.fillStyle = 'rgba(204,0,0,0.18)';
      ctx.beginPath(); ctx.arc(s.x, s.y, 11, 0, Math.PI * 2); ctx.fill();
    }
    if (selected) {
      ctx.fillStyle = ACCENT_RUST;
      ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.fill();
    } else {
      // Highlight the first corner only while drawing the exterior polygon (it's the
      // close-the-loop target). Other corners are gray.
      const isClosingTarget = i === 0 && mode === 'placing' && drawingPhase === 'exterior' && corners.length >= 3;
      ctx.fillStyle = isClosingTarget ? ACCENT_RUST : CORNER_GRAY;
      ctx.beginPath(); ctx.arc(s.x, s.y, isClosingTarget ? 6 : 4, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Openings
  for (const o of openings) {
    drawOpening(ctx, o, walls, corners, vp, o.id === selectedOpeningId);
  }

  // Hover marker (placing mode)
  if (mode === 'placing' && hoverWorld) {
    const s = worldToScreen(hoverWorld.x, hoverWorld.y, vp);
    ctx.strokeStyle = ACCENT_RUST;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.stroke();
  }

  if (dragLabel) {
    ctx.font = 'bold 12px "Segoe UI", -apple-system, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const m = ctx.measureText(dragLabel.text);
    ctx.fillStyle = ACCENT_RUST;
    ctx.fillRect(dragLabel.x - m.width / 2 - 6, dragLabel.y - 10, m.width + 12, 20);
    ctx.fillStyle = 'white';
    ctx.fillText(dragLabel.text, dragLabel.x, dragLabel.y);
  }

  // Tool overlays: persisted measurements + in-progress tool picks.
  function drawWorldLine(a, b, color, label) {
    const sa = worldToScreen(a.x, a.y, vp);
    const sb = worldToScreen(b.x, b.y, vp);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
    ctx.restore();
    for (const p of [sa, sb]) {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
    }
    if (label) {
      const mx = (sa.x + sb.x) / 2;
      const my = (sa.y + sb.y) / 2 - 14;
      ctx.font = 'bold 12px "Segoe UI", -apple-system, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const m = ctx.measureText(label);
      ctx.fillStyle = color;
      ctx.fillRect(mx - m.width / 2 - 6, my - 10, m.width + 12, 20);
      ctx.fillStyle = 'white';
      ctx.fillText(label, mx, my);
    }
  }

  for (const m of measurements) {
    const lenFt = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y) * scale;
    drawWorldLine(m.a, m.b, '#2563EB', `${lenFt.toFixed(2)} ft`);
  }

  if (tool === 'calibrate' || tool === 'measure') {
    const color = tool === 'calibrate' ? '#CC0000' : '#2563EB';
    if (toolPoints.length === 1 && hoverWorld) {
      const lenFt = Math.hypot(hoverWorld.x - toolPoints[0].x, hoverWorld.y - toolPoints[0].y) * scale;
      drawWorldLine(toolPoints[0], hoverWorld, color, `${lenFt.toFixed(2)} ft`);
    }
    if (toolPoints.length === 2) {
      const lenFt = Math.hypot(toolPoints[1].x - toolPoints[0].x, toolPoints[1].y - toolPoints[0].y) * scale;
      drawWorldLine(toolPoints[0], toolPoints[1], color, `${lenFt.toFixed(2)} ft`);
    }
  }
}

function drawGrid(ctx, size, vp) {
  const step = BASE_GRID_PX * vp.zoom;
  if (step < 4) return;
  const startX = vp.panX % step;
  const startY = vp.panY % step;
  ctx.lineWidth = 1; ctx.strokeStyle = GRID_LINE;
  ctx.beginPath();
  for (let x = startX; x < size.w; x += step) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, size.h); }
  for (let y = startY; y < size.h; y += step) { ctx.moveTo(0, y + 0.5); ctx.lineTo(size.w, y + 0.5); }
  ctx.stroke();
  const origin = worldToScreen(0, 0, vp);
  if (origin.x >= 0 && origin.x <= size.w) {
    ctx.strokeStyle = '#9CA3AF'; ctx.beginPath();
    ctx.moveTo(origin.x + 0.5, 0); ctx.lineTo(origin.x + 0.5, size.h); ctx.stroke();
  }
  if (origin.y >= 0 && origin.y <= size.h) {
    ctx.strokeStyle = '#9CA3AF'; ctx.beginPath();
    ctx.moveTo(0, origin.y + 0.5); ctx.lineTo(size.w, origin.y + 0.5); ctx.stroke();
  }
}

// Wall stroke styles. Thickness + slight color shift now distinguish wall type
// since the on-canvas type label has been removed.
const WALL_STYLES = {
  exterior_2x6: { width: 3,   color: '#0A0A0A' },
  interior_2x6: { width: 2.5, color: '#374151' },
  interior_2x4: { width: 1.5, color: '#6B7280' },
};
const ACCENT_RUST = '#CC0000';
const CORNER_GRAY = '#6B7280';
const WINDOW_COLOR = '#2563EB';
const DOOR_COLOR = '#16A34A';
const GRID_BG = '#FAFAFA';
const GRID_LINE = '#E8E8E8';
const LABEL_TEXT = '#1A1A1A';
const INTERIOR_WALL_COLOR = '#6B7280';

function drawDimensionPill(ctx, cx, cy, text) {
  ctx.font = '500 12px "Segoe UI", -apple-system, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const padding = 4;
  const metrics = ctx.measureText(text);
  const pillX = cx - metrics.width / 2 - padding;
  const pillY = cy - 9 - padding;
  const pillW = metrics.width + padding * 2;
  const pillH = 18 + padding * 2;
  ctx.fillStyle = 'white';
  roundRect(ctx, pillX, pillY, pillW, pillH, 4);
  ctx.fill();
  ctx.strokeStyle = '#E0E0E0';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = LABEL_TEXT;
  ctx.fillText(text, cx, cy);
}

// Outward perpendicular (in screen coords) for an exterior edge — given the
// polygon centroid in screen coords, points away from it.
function outwardScreenNormal(saX, saY, sbX, sbY, centroidScreen) {
  const dx = sbX - saX, dy = sbY - saY;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  let nx = -uy, ny = ux; // left of direction
  const mx = (saX + sbX) / 2, my = (saY + sbY) / 2;
  // Flip if "left" is toward the centroid (i.e., inward).
  const towardCentroidDot = (centroidScreen.x - mx) * nx + (centroidScreen.y - my) * ny;
  if (towardCentroidDot > 0) { nx = -nx; ny = -ny; }
  return { nx, ny };
}

function drawEdge(ctx, a, b, vp, scale, idx, wall, selected, centroidScreen) {
  const sa = worldToScreen(a.x, a.y, vp);
  const sb = worldToScreen(b.x, b.y, vp);
  const wallType = wall?.wall_type || 'exterior_2x6';
  const style = WALL_STYLES[wallType] || WALL_STYLES.exterior_2x6;

  if (selected) {
    ctx.save();
    ctx.shadowColor = 'rgba(204,0,0,0.45)';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = ACCENT_RUST;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
    ctx.restore();
  } else {
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
  }

  // Length-only label, positioned OUTSIDE the polygon.
  const lengthFt = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2) * scale;
  const mx = (sa.x + sb.x) / 2;
  const my = (sa.y + sb.y) / 2;
  let labelX = mx, labelY = my;
  if (centroidScreen) {
    const { nx, ny } = outwardScreenNormal(sa.x, sa.y, sb.x, sb.y, centroidScreen);
    labelX = mx + nx * 20;
    labelY = my + ny * 20;
  }
  drawDimensionPill(ctx, labelX, labelY, `${lengthFt.toFixed(2)} ft`);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawOpening(ctx, opening, walls, corners, vp, selected) {
  const wall = walls.find((w) => w.id === opening.floor_plan_wall_id);
  if (!wall) return;
  const idx = Number(wall.wall_index);
  if (idx < 0 || idx >= corners.length) return;
  const a = corners[idx];
  const b = corners[(idx + 1) % corners.length];
  const t = num(opening.position_along_wall) || 0.5;
  const wx = a.x + t * (b.x - a.x);
  const wy = a.y + t * (b.y - a.y);
  const sc = worldToScreen(wx, wy, vp);
  const aS = worldToScreen(a.x, a.y, vp);
  const bS = worldToScreen(b.x, b.y, vp);
  const len = Math.hypot(bS.x - aS.x, bS.y - aS.y) || 1;
  const ux = (bS.x - aS.x) / len, uy = (bS.y - aS.y) / len;
  const nx = -uy, ny = ux;
  const halfL = OPENING_MARKER_HALF_LEN_PX, halfT = OPENING_MARKER_HALF_THICK_PX;
  const fill = opening.type === 'door' ? DOOR_COLOR : WINDOW_COLOR;
  const corners4 = [
    [sc.x - halfL * ux + halfT * nx, sc.y - halfL * uy + halfT * ny],
    [sc.x + halfL * ux + halfT * nx, sc.y + halfL * uy + halfT * ny],
    [sc.x + halfL * ux - halfT * nx, sc.y + halfL * uy - halfT * ny],
    [sc.x - halfL * ux - halfT * nx, sc.y - halfL * uy - halfT * ny],
  ];
  if (selected) {
    ctx.save();
    ctx.shadowColor = 'rgba(204,0,0,0.5)';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = ACCENT_RUST; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(corners4[0][0], corners4[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners4[i][0], corners4[i][1]);
    ctx.closePath(); ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.moveTo(corners4[0][0], corners4[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(corners4[i][0], corners4[i][1]);
  ctx.closePath(); ctx.fill();

  const presetLabel = findPresetLabel(opening.type, opening.rough_opening_width, opening.rough_opening_height);
  const labelText = opening.label || presetLabel;
  ctx.font = '500 11px "Segoe UI", -apple-system, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const offX = sc.x + 14 * nx;
  const offY = sc.y + 14 * ny;
  const m = ctx.measureText(labelText);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(offX - m.width / 2 - 2, offY - 1, m.width + 4, 14);
  ctx.fillStyle = fill;
  ctx.fillText(labelText, offX, offY);
}
