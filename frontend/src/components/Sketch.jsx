import React, { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api.js';

const BASE_GRID_PX = 20;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
const HIT_TOLERANCE_PX = 8;
const CANVAS_HEIGHT = 600;
const OPENING_MARKER_HALF_LEN_PX = 14;
const OPENING_MARKER_HALF_THICK_PX = 5;

const WALL_TYPE_OPTIONS = [
  { value: 'exterior_2x6', label: 'Exterior 2x6' },
  { value: 'interior_2x4', label: 'Interior 2x4' },
  { value: 'interior_2x6', label: 'Interior 2x6' },
];
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

// Preset opening sizes (label and rough opening dimensions in inches)
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

// Find the preset matching given dimensions, or 'Custom' if none.
function findPresetLabel(type, w, h) {
  const list = presetsFor(type);
  const m = list.find((p) => p.w === Number(w) && p.h === Number(h));
  return m ? m.label : 'Custom';
}

// ---------- pure geometry helpers ----------
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
function wallLengthFt(wall, scale) {
  const dx = num(wall.x2) - num(wall.x1);
  const dy = num(wall.y2) - num(wall.y1);
  return Math.sqrt(dx * dx + dy * dy) * scale;
}
function openingScreenCenter(opening, wallById, vp) {
  const w = wallById.get(opening.wall_id);
  if (!w) return null;
  const t = num(opening.position_along_wall) || 0.5;
  const wx = num(w.x1) + t * (num(w.x2) - num(w.x1));
  const wy = num(w.y1) + t * (num(w.y2) - num(w.y1));
  const sc = worldToScreen(wx, wy, vp);
  // Wall direction (screen space)
  const a = worldToScreen(num(w.x1), num(w.y1), vp);
  const b = worldToScreen(num(w.x2), num(w.y2), vp);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len; // along wall
  const uy = (b.y - a.y) / len;
  const nx = -uy; // perpendicular
  const ny = ux;
  return { sc, ux, uy, nx, ny };
}

// ---------- main component ----------
export default function Sketch({
  projectId,
  projectSettings,
  onProjectSettingsChange,
  onMaterialsChanged,
  onOpeningsChanged,
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  const [walls, setWalls] = useState([]);
  const [openings, setOpenings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedOpeningId, setSelectedOpeningId] = useState(null);
  const [drawingType, setDrawingType] = useState('exterior_2x6');
  const [drawingStart, setDrawingStart] = useState(null);
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
  // Drag state for moving an opening along its wall
  const dragState = useRef({ active: false, openingId: null, moved: false });
  const [hoveringOpeningId, setHoveringOpeningId] = useState(null);
  const [dragLabel, setDragLabel] = useState(null); // { x, y, text } in screen px
  const openingSaveTimers = useRef({});

  const scaleFtPerGrid = num(projectSettings?.scale_ft_per_grid) || 1;
  const wallById = new Map(walls.map((w) => [w.id, w]));

  function notifyOpeningsChanged() {
    onOpeningsChanged?.();
  }

  // ---- load walls + openings ----
  useEffect(() => {
    Promise.all([api.listWalls(projectId), api.listOpenings(projectId)])
      .then(([w, o]) => { setWalls(w); setOpenings(o); })
      .catch((e) => setError(e.message));
  }, [projectId]);

  // ---- sync viewport state on project change ----
  useEffect(() => {
    setViewport({
      panX: num(projectSettings?.viewport_pan_x),
      panY: num(projectSettings?.viewport_pan_y),
      zoom: num(projectSettings?.viewport_zoom) || 1,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ---- debounced viewport persistence ----
  const lastSavedViewport = useRef(viewport);
  useEffect(() => {
    const t = setTimeout(() => {
      const s = lastSavedViewport.current;
      if (s.panX === viewport.panX && s.panY === viewport.panY && s.zoom === viewport.zoom) return;
      lastSavedViewport.current = viewport;
      onProjectSettingsChange?.({
        viewport_pan_x: viewport.panX,
        viewport_pan_y: viewport.panY,
        viewport_zoom: viewport.zoom,
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
    drawScene(ctx, canvasSize, viewport, walls, openings, selectedId, selectedOpeningId, drawingStart, hoverWorld, scaleFtPerGrid, dragLabel);
  }, [canvasSize, viewport, walls, openings, selectedId, selectedOpeningId, drawingStart, hoverWorld, scaleFtPerGrid, dragLabel]);

  // ---- mouse handlers ----
  function getMouseWorld(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return { sx, sy, world: screenToWorld(sx, sy, viewport) };
  }

  // Hit-test openings — returns the opening hit, if any
  function hitTestOpening(sx, sy) {
    for (const o of openings) {
      const meta = openingScreenCenter(o, wallById, viewport);
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

  function onMouseDown(e) {
    canvasRef.current.focus();
    const { sx, sy } = getMouseWorld(e);
    // Pan: middle button OR (left + space) — wins over opening drag
    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      e.preventDefault();
      panState.current = { active: true, startX: sx, startY: sy, basePan: { x: viewport.panX, y: viewport.panY } };
      return;
    }
    if (e.button !== 0) return;
    // Try to start dragging an opening
    const hit = hitTestOpening(sx, sy);
    if (hit) {
      e.preventDefault();
      dragState.current = { active: true, openingId: hit.id, moved: false };
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
    // Drag an opening along its wall
    if (dragState.current.active) {
      const o = openings.find((x) => x.id === dragState.current.openingId);
      const w = o ? wallById.get(o.wall_id) : null;
      if (!w) return;
      const wallLen = wallLengthFt(w, scaleFtPerGrid);
      if (wallLen <= 0) return;
      // Project click onto wall (in world coordinates)
      const wx1 = num(w.x1), wy1 = num(w.y1), wx2 = num(w.x2), wy2 = num(w.y2);
      const dxw = wx2 - wx1, dyw = wy2 - wy1;
      const lenSq = dxw * dxw + dyw * dyw;
      let t = ((world.x - wx1) * dxw + (world.y - wy1) * dyw) / lenSq;
      // Snap fraction to nearest 0.5ft increment along the wall
      const posFt = t * wallLen;
      const snappedFt = Math.round(posFt / 0.5) * 0.5;
      let snappedT = snappedFt / wallLen;
      // Clamp to [0.05, 0.95]
      snappedT = Math.max(0.05, Math.min(0.95, snappedT));
      dragState.current.moved = true;
      // Optimistic local update
      setOpenings((cur) => cur.map((x) => (x.id === o.id ? { ...x, position_along_wall: snappedT } : x)));
      // Position label near marker
      const labelWx = wx1 + snappedT * dxw;
      const labelWy = wy1 + snappedT * dyw;
      const sc = worldToScreen(labelWx, labelWy, viewport);
      const distFt = snappedT * wallLen;
      setDragLabel({ x: sc.x, y: sc.y - 22, text: `${distFt.toFixed(1)} ft` });
      return;
    }
    // Hover state — for cursor + tracking snapped position
    setHoverWorld(snapWorld(world));
    const hover = hitTestOpening(sx, sy);
    setHoveringOpeningId(hover ? hover.id : null);
  }

  function onMouseUp(e) {
    if (panState.current.active) { panState.current.active = false; return; }
    // End drag: if the opening actually moved, schedule a debounced save;
    // otherwise treat the click as a selection.
    if (dragState.current.active) {
      const { active, openingId, moved } = dragState.current;
      dragState.current = { active: false, openingId: null, moved: false };
      setDragLabel(null);
      if (active && openingId != null) {
        if (moved) {
          const o = openings.find((x) => x.id === openingId);
          const positionToSave = o?.position_along_wall;
          clearTimeout(openingSaveTimers.current[openingId]);
          openingSaveTimers.current[openingId] = setTimeout(() => {
            api.updateOpening(projectId, openingId, { position_along_wall: positionToSave })
              .then(() => { onMaterialsChanged?.(); notifyOpeningsChanged(); })
              .catch((err) => setError(err.message));
          }, 300);
        } else {
          // No movement → treat as click: select the opening
          setSelectedOpeningId(openingId);
          setSelectedId(null);
          setDrawingStart(null);
        }
      }
      return;
    }
    if (e.button !== 0) return;
    if (spaceDown.current) return;

    const { sx, sy, world } = getMouseWorld(e);

    // 1. Hit-test openings first (they sit on top of walls).
    // (Opening drag is handled in onMouseDown; this branch handles the case where
    // mouseDown didn't start a drag for some reason.)
    const hit = hitTestOpening(sx, sy);
    if (hit) {
      setSelectedOpeningId(hit.id);
      setSelectedId(null);
      setDrawingStart(null);
      return;
    }

    // 2. Hit-test walls
    const tolWorld = HIT_TOLERANCE_PX / (BASE_GRID_PX * viewport.zoom);
    let best = null;
    for (const w of walls) {
      const d = distPointToSegment(world.x, world.y, num(w.x1), num(w.y1), num(w.x2), num(w.y2));
      if (d <= tolWorld && (best == null || d < best.d)) best = { d, wall: w };
    }
    if (best) {
      setSelectedId(best.wall.id);
      setSelectedOpeningId(null);
      setDrawingStart(null);
      return;
    }

    // 3. Otherwise it's a drawing click
    const snapped = snapWorld(world);
    if (drawingStart == null) {
      setDrawingStart(snapped);
      setSelectedId(null);
      setSelectedOpeningId(null);
    } else {
      if (snapped.x === drawingStart.x && snapped.y === drawingStart.y) {
        setDrawingStart(null);
        return;
      }
      createWall(drawingStart, snapped);
      setDrawingStart(null);
    }
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
    setHoveringOpeningId(null);
    panState.current.active = false;
    if (dragState.current.active) {
      // Cancel drag — discard local position change since we never confirmed
      dragState.current = { active: false, openingId: null, moved: false };
      setDragLabel(null);
    }
  }

  // ---- keyboard ----
  useEffect(() => {
    function isTypingTarget(t) {
      if (!t) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t.isContentEditable;
    }
    function onKeyDown(e) {
      if (e.code === 'Space') { spaceDown.current = true; return; }
      if (isTypingTarget(e.target)) return;
      if (e.code === 'Delete' || e.code === 'Backspace') {
        if (selectedOpeningId != null) { e.preventDefault(); deleteSelectedOpening(); }
        else if (selectedId != null) { e.preventDefault(); deleteSelectedWall(); }
      } else if (e.code === 'Escape') {
        setDrawingStart(null);
        setSelectedId(null);
        setSelectedOpeningId(null);
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
  }, [selectedId, selectedOpeningId]);

  // ---- wall mutations ----
  async function createWall(p1, p2) {
    try {
      const newWall = await api.createWall(projectId, {
        x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, wall_type: drawingType,
      });
      setWalls((cur) => [...cur, newWall]);
      onMaterialsChanged?.();
    } catch (e) { setError(e.message); }
  }

  async function deleteSelectedWall() {
    if (selectedId == null) return;
    const id = selectedId;
    setSelectedId(null);
    setWalls((cur) => cur.filter((w) => w.id !== id));
    // Cascade: openings on this wall are deleted in DB by FK; reflect locally
    setOpenings((cur) => cur.filter((o) => o.wall_id !== id));
    try {
      await api.deleteWall(projectId, id);
      onMaterialsChanged?.();
      notifyOpeningsChanged();
    } catch (e) { setError(e.message); }
  }

  const debounceTimers = useRef({});
  const updateWall = useCallback((id, patch, { immediate = false } = {}) => {
    setWalls((cur) => cur.map((w) => (w.id === id ? { ...w, ...patch } : w)));
    const send = () => api.updateWall(projectId, id, patch).then(() => onMaterialsChanged?.()).catch((e) => setError(e.message));
    if (immediate) return send();
    clearTimeout(debounceTimers.current[id]);
    debounceTimers.current[id] = setTimeout(send, 500);
  }, [projectId, onMaterialsChanged]);

  // ---- opening mutations ----
  async function createOpening(payload) {
    try {
      const created = await api.createOpening(projectId, payload);
      setOpenings((cur) => [...cur, created]);
      onMaterialsChanged?.();
      notifyOpeningsChanged();
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
      notifyOpeningsChanged();
    } catch (e) { setError(e.message); }
  }
  const openingTimers = useRef({});
  const updateOpening = useCallback((oid, patch, { immediate = false } = {}) => {
    setOpenings((cur) => cur.map((o) => (o.id === oid ? { ...o, ...patch } : o)));
    const send = () =>
      api.updateOpening(projectId, oid, patch)
        .then(() => { onMaterialsChanged?.(); notifyOpeningsChanged(); })
        .catch((e) => setError(e.message));
    if (immediate) return send();
    clearTimeout(openingTimers.current[oid]);
    openingTimers.current[oid] = setTimeout(send, 500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, onMaterialsChanged]);

  const selectedWall = walls.find((w) => w.id === selectedId) || null;
  const selectedOpening = openings.find((o) => o.id === selectedOpeningId) || null;
  const selectedOpeningWall = selectedOpening ? walls.find((w) => w.id === selectedOpening.wall_id) : null;

  return (
    <div>
      <div className="sketch-toolbar">
        <label style={{ margin: 0 }}>Type for next wall</label>
        <select value={drawingType} onChange={(e) => setDrawingType(e.target.value)} style={{ width: 'auto' }}>
          {WALL_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button className="danger" onClick={selectedOpeningId ? deleteSelectedOpening : deleteSelectedWall}
          disabled={!selectedWall && !selectedOpening}>
          Delete selected
        </button>
        <span className="muted">
          Click-click to draw • Click wall to select • Click opening marker to edit • Esc cancels • Space+drag pans • Wheel zooms
        </span>
        <span className="right muted">
          {walls.length} wall{walls.length === 1 ? '' : 's'} · {openings.length} opening{openings.length === 1 ? '' : 's'} · 1 grid = {scaleFtPerGrid} ft
        </span>
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
            onContextMenu={(e) => e.preventDefault()}
            style={{
              cursor:
                dragState.current.active ? 'grabbing'
                : hoveringOpeningId != null ? 'grab'
                : spaceDown.current ? 'grab'
                : 'crosshair',
              display: 'block',
              background: '#fafafa',
            }}
          />
        </div>
        {selectedOpening && selectedOpeningWall && (
          <OpeningEditor
            opening={selectedOpening}
            wall={selectedOpeningWall}
            onChange={(patch, opts) => updateOpening(selectedOpening.id, patch, opts)}
            onDelete={deleteSelectedOpening}
            onClose={() => setSelectedOpeningId(null)}
          />
        )}
        {!selectedOpening && selectedWall && (
          <WallEditor
            wall={selectedWall}
            scale={scaleFtPerGrid}
            wallOpenings={openings.filter((o) => o.wall_id === selectedWall.id)}
            onChange={(patch, opts) => updateWall(selectedWall.id, patch, opts)}
            onDelete={deleteSelectedWall}
            onClose={() => setSelectedId(null)}
            onAddOpening={(payload) => createOpening({ ...payload, wall_id: selectedWall.id })}
            onSelectOpening={(oid) => { setSelectedOpeningId(oid); setSelectedId(null); }}
          />
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// ---------- side panels ----------
function WallEditor({ wall, scale, wallOpenings, onChange, onDelete, onClose, onAddOpening, onSelectOpening }) {
  const lengthFt = wallLengthFt(wall, scale);
  const [showAdd, setShowAdd] = useState(false);
  const [addType, setAddType] = useState('window');
  const [addPresetIdx, setAddPresetIdx] = useState(0);
  const [addLabel, setAddLabel] = useState('');
  const [addCustomW, setAddCustomW] = useState('');
  const [addCustomH, setAddCustomH] = useState('');

  function resetAdd() {
    setShowAdd(false);
    setAddPresetIdx(0);
    setAddLabel('');
    setAddCustomW('');
    setAddCustomH('');
  }
  function changeType(t) {
    setAddType(t);
    setAddPresetIdx(0); // reset preset when type changes
  }
  async function submitAdd() {
    const presets = presetsFor(addType);
    const preset = presets[addPresetIdx];
    let w, h;
    if (preset.label === 'Custom') {
      w = Number(addCustomW); h = Number(addCustomH);
      if (!w || !h) return;
    } else {
      w = preset.w; h = preset.h;
    }
    await onAddOpening({
      type: addType,
      rough_opening_width: w,
      rough_opening_height: h,
      label: addLabel.trim() || null,
    });
    resetAdd();
  }

  const presets = presetsFor(addType);
  const isCustom = presets[addPresetIdx]?.label === 'Custom';

  return (
    <div className="wall-editor card">
      <div className="row" style={{ marginBottom: '0.5rem' }}>
        <strong style={{ flex: 1 }}>Wall #{wall.id}</strong>
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

      <label>Extra corner studs</label>
      <input
        type="number" step="1" min="0"
        value={wall.extra_corner_studs ?? 0}
        onChange={(e) => onChange({ extra_corner_studs: Number(e.target.value) || 0 })}
      />

      <hr style={{ margin: '1rem 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />

      <div className="row" style={{ marginBottom: '0.5rem' }}>
        <strong style={{ flex: 1 }}>Openings ({wallOpenings.length})</strong>
        {!showAdd && (
          <button className="primary" style={{ flex: '0 0 auto', padding: '0.3rem 0.6rem' }} onClick={() => setShowAdd(true)}>
            + Add Opening
          </button>
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
              <div>
                <label>RO width (in)</label>
                <input type="number" value={addCustomW} onChange={(e) => setAddCustomW(e.target.value)} />
              </div>
              <div>
                <label>RO height (in)</label>
                <input type="number" value={addCustomH} onChange={(e) => setAddCustomH(e.target.value)} />
              </div>
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

      <button className="danger" style={{ marginTop: '1rem', width: '100%' }} onClick={onDelete}>
        Delete this wall
      </button>
    </div>
  );
}

function OpeningEditor({ opening, wall, onChange, onDelete, onClose }) {
  const presets = presetsFor(opening.type);
  const currentPresetIdx = presets.findIndex(
    (p) => p.w === Number(opening.rough_opening_width) && p.h === Number(opening.rough_opening_height),
  );
  const presetIdx = currentPresetIdx === -1 ? presets.length - 1 : currentPresetIdx; // Custom is last
  const isCustom = presets[presetIdx]?.label === 'Custom';

  function selectPreset(idx) {
    const p = presets[idx];
    if (p.label === 'Custom') return; // user types into custom inputs directly
    onChange({ rough_opening_width: p.w, rough_opening_height: p.h }, { immediate: true });
  }

  return (
    <div className="wall-editor card">
      <div className="row" style={{ marginBottom: '0.5rem' }}>
        <strong style={{ flex: 1 }}>{opening.type === 'door' ? 'Door' : 'Window'} #{opening.id}</strong>
        <button className="secondary" style={{ flex: '0 0 auto', padding: '0.25rem 0.5rem' }} onClick={onClose}>×</button>
      </div>
      <p className="muted" style={{ margin: 0 }}>On Wall #{wall.id}</p>

      <label>Type</label>
      <select value={opening.type}
        onChange={(e) => {
          // Switching type: pick first preset of new type
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
          <div>
            <label>RO width (in)</label>
            <input
              type="number"
              value={opening.rough_opening_width ?? ''}
              onChange={(e) => onChange({ rough_opening_width: e.target.value })}
            />
          </div>
          <div>
            <label>RO height (in)</label>
            <input
              type="number"
              value={opening.rough_opening_height ?? ''}
              onChange={(e) => onChange({ rough_opening_height: e.target.value })}
            />
          </div>
        </div>
      )}

      <label>Label (optional)</label>
      <input
        value={opening.label ?? ''}
        onChange={(e) => onChange({ label: e.target.value || null })}
        placeholder="e.g. Front door"
      />

      <button className="danger" style={{ marginTop: '1rem', width: '100%' }} onClick={onDelete}>
        Delete this opening
      </button>
    </div>
  );
}

// ---------- canvas drawing ----------
function drawScene(ctx, size, vp, walls, openings, selectedId, selectedOpeningId, drawingStart, hoverWorld, scale, dragLabel) {
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, size.w, size.h);
  drawGrid(ctx, size, vp);

  for (const wall of walls) drawWall(ctx, wall, vp, wall.id === selectedId, scale);

  const wallById = new Map(walls.map((w) => [w.id, w]));
  for (const o of openings) drawOpening(ctx, o, wallById, vp, o.id === selectedOpeningId);

  if (drawingStart && hoverWorld) drawPreviewWall(ctx, drawingStart, hoverWorld, vp, scale);
  if (drawingStart) {
    const s = worldToScreen(drawingStart.x, drawingStart.y, vp);
    ctx.fillStyle = '#2563eb';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (hoverWorld && !dragLabel) {
    const s = worldToScreen(hoverWorld.x, hoverWorld.y, vp);
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Drag position label (e.g. "5.0 ft" while dragging an opening)
  if (dragLabel) {
    ctx.font = 'bold 12px -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
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
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#e5e7eb';
  ctx.beginPath();
  for (let x = startX; x < size.w; x += step) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, size.h); }
  for (let y = startY; y < size.h; y += step) { ctx.moveTo(0, y + 0.5); ctx.lineTo(size.w, y + 0.5); }
  ctx.stroke();
  const origin = worldToScreen(0, 0, vp);
  if (origin.x >= 0 && origin.x <= size.w) {
    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(origin.x + 0.5, 0); ctx.lineTo(origin.x + 0.5, size.h); ctx.stroke();
  }
  if (origin.y >= 0 && origin.y <= size.h) {
    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(0, origin.y + 0.5); ctx.lineTo(size.w, origin.y + 0.5); ctx.stroke();
  }
}

const WALL_STYLES = {
  exterior_2x6: { width: 5, color: '#1f2937' },
  interior_2x6: { width: 4, color: '#475569' },
  interior_2x4: { width: 3, color: '#64748b' },
};

function drawWall(ctx, wall, vp, selected, scale) {
  const a = worldToScreen(num(wall.x1), num(wall.y1), vp);
  const b = worldToScreen(num(wall.x2), num(wall.y2), vp);
  const style = WALL_STYLES[wall.wall_type] || WALL_STYLES.exterior_2x6;
  if (selected) {
    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = style.width + 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.strokeStyle = style.color; ctx.lineWidth = style.width; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.fillStyle = style.color;
  for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); }
  const lengthFt = wallLengthFt(wall, scale);
  const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
  const text = `${lengthFt.toFixed(2)} ft`;
  ctx.font = '12px -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const padding = 3;
  const metrics = ctx.measureText(text);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(mx - metrics.width / 2 - padding, my - 8 - padding, metrics.width + padding * 2, 16 + padding * 2);
  ctx.fillStyle = '#111827';
  ctx.fillText(text, mx, my);
}

function drawOpening(ctx, opening, wallById, vp, selected) {
  const meta = openingScreenCenter(opening, wallById, vp);
  if (!meta) return;
  const { sc, ux, uy, nx, ny } = meta;
  const halfL = OPENING_MARKER_HALF_LEN_PX;
  const halfT = OPENING_MARKER_HALF_THICK_PX;
  const fill = opening.type === 'door' ? '#16a34a' : '#2563eb';
  const corners = [
    [sc.x - halfL * ux + halfT * nx, sc.y - halfL * uy + halfT * ny],
    [sc.x + halfL * ux + halfT * nx, sc.y + halfL * uy + halfT * ny],
    [sc.x + halfL * ux - halfT * nx, sc.y + halfL * uy - halfT * ny],
    [sc.x - halfL * ux - halfT * nx, sc.y - halfL * uy - halfT * ny],
  ];
  if (selected) {
    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(corners[0][0], corners[0][1]);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i][0], corners[i][1]);
    ctx.closePath(); ctx.stroke();
  }
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(corners[0][0], corners[0][1]);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i][0], corners[i][1]);
  ctx.closePath(); ctx.fill();

  // Label below the marker
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

function drawPreviewWall(ctx, start, end, vp, scale) {
  const a = worldToScreen(start.x, start.y, vp);
  const b = worldToScreen(end.x, end.y, vp);
  ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.setLineDash([]);
  const dx = end.x - start.x, dy = end.y - start.y;
  const lengthFt = Math.sqrt(dx * dx + dy * dy) * scale;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  ctx.font = '12px -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2563eb';
  ctx.fillText(`${lengthFt.toFixed(2)} ft`, mx, my - 12);
}
