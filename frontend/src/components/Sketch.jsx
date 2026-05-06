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
}) {
  const [activeLevel, setActiveLevel] = useState('floor1');
  const visibleLevels = LEVEL_TABS_BASE.filter((l) => l.value !== 'floor2' || Number(numStoreys) >= 2);

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
      />
    </div>
  );
}

function LevelTabs({ tabs, active, onChange }) {
  return (
    <div style={{
      display: 'flex', gap: '0.25rem', marginBottom: '0.5rem',
      borderBottom: '1px solid #e5e7eb', paddingBottom: '0.4rem',
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
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  const [floorPlanId, setFloorPlanId] = useState(null);
  const [corners, setCorners] = useState([]);
  const [walls, setWalls] = useState([]); // floor_plan_walls rows
  const [openings, setOpenings] = useState([]);
  const [mode, setMode] = useState('placing'); // 'placing' | 'editing'
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
  const [dragLabel, setDragLabel] = useState(null);

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
        setMode(cs.length >= 3 ? 'editing' : 'placing');
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
    });
  }, [canvasSize, viewport, corners, walls, openings, mode, selectedCornerIdx, selectedWallIdx,
      selectedOpeningId, hoverWorld, scaleFtPerGrid, dragLabel]);

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

  // ---- mouse handlers ----
  function onMouseDown(e) {
    canvasRef.current.focus();
    const { sx, sy, world } = getMouseWorld(e);
    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      e.preventDefault();
      panState.current = { active: true, startX: sx, startY: sy, basePan: { x: viewport.panX, y: viewport.panY } };
      return;
    }
    if (e.button !== 0) return;
    if (mode === 'editing') {
      // Check opening drag first
      const hitO = hitTestOpening(sx, sy);
      if (hitO) {
        e.preventDefault();
        dragState.current = { active: true, type: 'opening', openingId: hitO.id, moved: false };
        return;
      }
      // Check corner drag
      const hitC = hitTestCorner(sx, sy);
      if (hitC != null) {
        e.preventDefault();
        dragState.current = { active: true, type: 'corner', idx: hitC, moved: false };
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
  }

  function onMouseUp(e) {
    if (panState.current.active) { panState.current.active = false; return; }
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
        } else {
          setSelectedCornerIdx(ds.idx);
          setSelectedWallIdx(null);
          setSelectedOpeningId(null);
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
        } else {
          setSelectedOpeningId(ds.openingId);
          setSelectedCornerIdx(null);
          setSelectedWallIdx(null);
        }
      }
      return;
    }
    if (e.button !== 0) return;
    if (spaceDown.current) return;

    const { sx, sy, world } = getMouseWorld(e);

    if (mode === 'placing') {
      // Place a corner
      const snapped = snapWorld(world);
      // Don't add a duplicate of the last corner
      const last = corners[corners.length - 1];
      if (last && last.x === snapped.x && last.y === snapped.y) return;
      setCorners((cur) => [...cur, snapped]);
      return;
    }

    // Editing mode: hit-test opening → corner → edge
    const hitO = hitTestOpening(sx, sy);
    if (hitO) {
      setSelectedOpeningId(hitO.id);
      setSelectedCornerIdx(null);
      setSelectedWallIdx(null);
      return;
    }
    const hitC = hitTestCorner(sx, sy);
    if (hitC != null) {
      setSelectedCornerIdx(hitC);
      setSelectedWallIdx(null);
      setSelectedOpeningId(null);
      return;
    }
    const hitE = hitTestEdge(world);
    if (hitE != null) {
      setSelectedWallIdx(hitE);
      setSelectedCornerIdx(null);
      setSelectedOpeningId(null);
      return;
    }
    // Click on empty canvas — deselect
    setSelectedCornerIdx(null);
    setSelectedWallIdx(null);
    setSelectedOpeningId(null);
  }

  function onWheel(e) {
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
      // The edge whose trailing corner is cIdx has wall_index = cIdx - 1 (mod). Deleting that
      // edge in the backend removes corners[cIdx]. But the backend's DELETE endpoint takes a wall
      // index and removes corners[(widx+1) % len]. So widx = cIdx - 1 (or len-1 if cIdx == 0).
      const widx = (cIdx - 1 + corners.length) % corners.length;
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
      if (isTypingTarget(e.target)) return;
      if (e.code === 'Enter' && mode === 'placing' && corners.length >= 3) {
        // Close polygon, switch to editing, persist
        try {
          const updated = await api.updateFloorPlan(projectId, floorPlanId, { corners });
          setCorners(updated.corners || corners);
          setWalls(updated.walls || []);
          setOpenings(updated.openings || []);
          setMode('editing');
          onMaterialsChanged?.();
          onOpeningsChanged?.();
        } catch (err) { setError(err.message); }
      } else if (e.code === 'Escape') {
        if (mode === 'placing' && corners.length > 0) {
          // Pop the last placed corner
          setCorners((cur) => cur.slice(0, -1));
        } else {
          setSelectedCornerIdx(null);
          setSelectedWallIdx(null);
          setSelectedOpeningId(null);
        }
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        if (selectedOpeningId != null) { e.preventDefault(); deleteSelectedOpening(); }
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
  }, [mode, corners, selectedOpeningId, floorPlanId, projectId]);

  // ---- mutations ----
  async function clearFloorPlan() {
    if (!confirm('Clear floor plan? This deletes all corners, walls, and openings.')) return;
    try {
      const updated = await api.updateFloorPlan(projectId, floorPlanId, { corners: [] });
      setCorners([]); setWalls([]); setOpenings([]);
      setSelectedCornerIdx(null); setSelectedWallIdx(null); setSelectedOpeningId(null);
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
      return created;
    } catch (e) { setError(e.message); }
  }
  async function deleteSelectedOpening() {
    if (selectedOpeningId == null) return;
    const oid = selectedOpeningId;
    setSelectedOpeningId(null);
    setOpenings((cur) => cur.filter((o) => o.id !== oid));
    try {
      await api.deleteOpening(projectId, oid);
      onMaterialsChanged?.();
      onOpeningsChanged?.();
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

  return (
    <div>
      <div className="sketch-toolbar">
        {mode === 'placing' ? (
          <span className="muted">
            <strong>{level}</strong> · <strong>Click</strong> to place corners ({corners.length} placed) · <strong>Enter</strong> to close polygon (need 3+) · <strong>Esc</strong> undoes last
          </span>
        ) : (
          <span className="muted">
            <strong>{level}</strong> · click corner/edge/opening to select · drag corners · right-click corner to delete · Space+drag pans · wheel zooms
          </span>
        )}
        <span className="right muted">
          {corners.length} corner{corners.length === 1 ? '' : 's'} · {openings.length} opening{openings.length === 1 ? '' : 's'} · {perimeterFt.toFixed(1)} lf · {areaSf.toFixed(0)} sf
        </span>
        {level !== 'floor1' && corners.length === 0 && (
          <button className="secondary" style={{ flex: '0 0 auto' }} onClick={copyFromFloor1}>Copy from Floor 1</button>
        )}
        {mode === 'editing' && (
          <button className="danger" style={{ flex: '0 0 auto' }} onClick={clearFloorPlan}>Clear floor plan</button>
        )}
      </div>
      <div className="sketch-area">
        <div className="sketch-canvas-wrap" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            tabIndex={0}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave}
            onWheel={onWheel}
            onContextMenu={onContextMenu}
            style={{ cursor: spaceDown.current ? 'grab' : (mode === 'placing' ? 'crosshair' : 'default'), display: 'block', background: '#fafafa' }}
          />
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
        {!selectedOpening && !selectedWall && selectedCorner && (
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

      <hr style={{ margin: '1rem 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />

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
        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#f9fafb', borderRadius: 4 }}>
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

// ---------- canvas drawing ----------
function drawScene(ctx, size, vp, S) {
  const { corners, walls, openings, mode, selectedCornerIdx, selectedWallIdx, selectedOpeningId, hoverWorld, scale, dragLabel } = S;
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, size.w, size.h);
  drawGrid(ctx, size, vp);

  // Edges
  if (corners.length >= 2) {
    for (let i = 0; i < corners.length; i++) {
      // In placing mode, don't draw the closing edge (corners[N-1] → corners[0]) yet
      if (mode === 'placing' && i === corners.length - 1) continue;
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      const wall = walls.find((w) => Number(w.wall_index) === i);
      drawEdge(ctx, a, b, vp, scale, i, wall, i === selectedWallIdx);
    }
  }

  // Live preview from last corner to cursor (placing mode)
  if (mode === 'placing' && corners.length > 0 && hoverWorld) {
    const last = corners[corners.length - 1];
    const a = worldToScreen(last.x, last.y, vp);
    const b = worldToScreen(hoverWorld.x, hoverWorld.y, vp);
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    const dx = hoverWorld.x - last.x, dy = hoverWorld.y - last.y;
    const lengthFt = Math.sqrt(dx * dx + dy * dy) * scale;
    ctx.font = '12px -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#2563eb';
    ctx.fillText(`${lengthFt.toFixed(2)} ft`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 12);
  }

  // Corners on top of edges
  for (let i = 0; i < corners.length; i++) {
    const s = worldToScreen(corners[i].x, corners[i].y, vp);
    const selected = i === selectedCornerIdx;
    if (selected) {
      ctx.fillStyle = 'rgba(251,191,36,0.35)';
      ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = i === 0 && mode === 'placing' ? '#2563eb' : '#1f2937';
    ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, Math.PI * 2); ctx.fill();
  }

  // Openings
  for (const o of openings) {
    drawOpening(ctx, o, walls, corners, vp, o.id === selectedOpeningId);
  }

  // Hover marker (placing mode)
  if (mode === 'placing' && hoverWorld) {
    const s = worldToScreen(hoverWorld.x, hoverWorld.y, vp);
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.stroke();
  }

  if (dragLabel) {
    ctx.font = 'bold 12px -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const m = ctx.measureText(dragLabel.text);
    ctx.fillStyle = 'rgba(31,41,55,0.95)';
    ctx.fillRect(dragLabel.x - m.width / 2 - 6, dragLabel.y - 10, m.width + 12, 20);
    ctx.fillStyle = 'white';
    ctx.fillText(dragLabel.text, dragLabel.x, dragLabel.y);
  }
}

function drawGrid(ctx, size, vp) {
  const step = BASE_GRID_PX * vp.zoom;
  if (step < 4) return;
  const startX = vp.panX % step;
  const startY = vp.panY % step;
  ctx.lineWidth = 1; ctx.strokeStyle = '#e5e7eb';
  ctx.beginPath();
  for (let x = startX; x < size.w; x += step) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, size.h); }
  for (let y = startY; y < size.h; y += step) { ctx.moveTo(0, y + 0.5); ctx.lineTo(size.w, y + 0.5); }
  ctx.stroke();
  const origin = worldToScreen(0, 0, vp);
  if (origin.x >= 0 && origin.x <= size.w) {
    ctx.strokeStyle = '#cbd5e1'; ctx.beginPath();
    ctx.moveTo(origin.x + 0.5, 0); ctx.lineTo(origin.x + 0.5, size.h); ctx.stroke();
  }
  if (origin.y >= 0 && origin.y <= size.h) {
    ctx.strokeStyle = '#cbd5e1'; ctx.beginPath();
    ctx.moveTo(0, origin.y + 0.5); ctx.lineTo(size.w, origin.y + 0.5); ctx.stroke();
  }
}

const WALL_STYLES = {
  exterior_2x6: { width: 5, color: '#1f2937' },
  interior_2x6: { width: 4, color: '#475569' },
  interior_2x4: { width: 3, color: '#64748b' },
};

function drawEdge(ctx, a, b, vp, scale, idx, wall, selected) {
  const sa = worldToScreen(a.x, a.y, vp);
  const sb = worldToScreen(b.x, b.y, vp);
  const wallType = wall?.wall_type || 'exterior_2x6';
  const style = WALL_STYLES[wallType] || WALL_STYLES.exterior_2x6;
  if (selected) {
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = style.width + 6;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
  }
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();

  // Length + type label at midpoint
  const lengthFt = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2) * scale;
  const mx = (sa.x + sb.x) / 2; const my = (sa.y + sb.y) / 2;
  const text = `${lengthFt.toFixed(2)} ft · ${WALL_TYPE_SHORT[wallType] || wallType}`;
  ctx.font = '12px -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const padding = 3;
  const metrics = ctx.measureText(text);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(mx - metrics.width / 2 - padding, my - 8 - padding, metrics.width + padding * 2, 16 + padding * 2);
  ctx.fillStyle = '#111827';
  ctx.fillText(text, mx, my);
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
  const fill = opening.type === 'door' ? '#16a34a' : '#2563eb';
  const corners4 = [
    [sc.x - halfL * ux + halfT * nx, sc.y - halfL * uy + halfT * ny],
    [sc.x + halfL * ux + halfT * nx, sc.y + halfL * uy + halfT * ny],
    [sc.x + halfL * ux - halfT * nx, sc.y + halfL * uy - halfT * ny],
    [sc.x - halfL * ux - halfT * nx, sc.y - halfL * uy - halfT * ny],
  ];
  if (selected) {
    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(corners4[0][0], corners4[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners4[i][0], corners4[i][1]);
    ctx.closePath(); ctx.stroke();
  }
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.moveTo(corners4[0][0], corners4[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(corners4[i][0], corners4[i][1]);
  ctx.closePath(); ctx.fill();

  const presetLabel = findPresetLabel(opening.type, opening.rough_opening_width, opening.rough_opening_height);
  const labelText = opening.label || presetLabel;
  ctx.font = '11px -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const offX = sc.x + 14 * nx;
  const offY = sc.y + 14 * ny;
  const m = ctx.measureText(labelText);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(offX - m.width / 2 - 2, offY - 1, m.width + 4, 14);
  ctx.fillStyle = fill;
  ctx.fillText(labelText, offX, offY);
}
