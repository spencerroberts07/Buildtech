import React, { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api.js';

const BASE_GRID_PX = 20;          // 1 grid unit at zoom=1
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
const HIT_TOLERANCE_PX = 8;
const CANVAS_HEIGHT = 600;

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

// ---------- pure geometry helpers ----------
const num = (v) => (v == null || v === '' ? 0 : Number(v));

function worldToScreen(wx, wy, vp) {
  return {
    x: wx * BASE_GRID_PX * vp.zoom + vp.panX,
    y: wy * BASE_GRID_PX * vp.zoom + vp.panY,
  };
}
function screenToWorld(sx, sy, vp) {
  return {
    x: (sx - vp.panX) / (BASE_GRID_PX * vp.zoom),
    y: (sy - vp.panY) / (BASE_GRID_PX * vp.zoom),
  };
}
function snapWorld(p) {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}
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

// ---------- main component ----------
export default function Sketch({
  projectId,
  projectSettings,         // /projects/:id/settings response
  onProjectSettingsChange, // (patch) => void  (parent persists, debounced)
  onMaterialsChanged,      // () => void  (parent refetches material list)
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  const [walls, setWalls] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [drawingType, setDrawingType] = useState('exterior_2x6');
  const [drawingStart, setDrawingStart] = useState(null); // {x,y} world snapped
  const [hoverWorld, setHoverWorld] = useState(null);     // {x,y} world snapped
  const [viewport, setViewport] = useState(() => ({
    panX: num(projectSettings?.viewport_pan_x),
    panY: num(projectSettings?.viewport_pan_y),
    zoom: num(projectSettings?.viewport_zoom) || 1,
  }));
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: CANVAS_HEIGHT });
  const [error, setError] = useState('');

  // panning / keyboard state (refs so handlers always see latest)
  const panState = useRef({ active: false, startX: 0, startY: 0, basePan: null });
  const spaceDown = useRef(false);

  const scaleFtPerGrid = num(projectSettings?.scale_ft_per_grid) || 1;

  // ---- load walls ----
  useEffect(() => {
    api.listWalls(projectId).then(setWalls).catch((e) => setError(e.message));
  }, [projectId]);

  // ---- sync viewport state when prop changes (e.g., switching projects) ----
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
      if (wrapRef.current) {
        setCanvasSize({ w: wrapRef.current.clientWidth, h: CANVAS_HEIGHT });
      }
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
    drawScene(ctx, canvasSize, viewport, walls, selectedId, drawingStart, hoverWorld, scaleFtPerGrid);
  }, [canvasSize, viewport, walls, selectedId, drawingStart, hoverWorld, scaleFtPerGrid]);

  // ---- mouse handlers ----
  function getMouseWorld(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return { sx, sy, world: screenToWorld(sx, sy, viewport) };
  }

  function onMouseDown(e) {
    canvasRef.current.focus();
    const { sx, sy } = getMouseWorld(e);
    // Pan: middle button OR (left + space)
    if (e.button === 1 || (e.button === 0 && spaceDown.current)) {
      e.preventDefault();
      panState.current = {
        active: true,
        startX: sx,
        startY: sy,
        basePan: { x: viewport.panX, y: viewport.panY },
      };
    }
  }

  function onMouseMove(e) {
    const { sx, sy, world } = getMouseWorld(e);
    if (panState.current.active) {
      const dx = sx - panState.current.startX;
      const dy = sy - panState.current.startY;
      setViewport((vp) => ({
        ...vp,
        panX: panState.current.basePan.x + dx,
        panY: panState.current.basePan.y + dy,
      }));
      return;
    }
    setHoverWorld(snapWorld(world));
  }

  function onMouseUp(e) {
    if (panState.current.active) {
      panState.current.active = false;
      return;
    }
    if (e.button !== 0) return;
    if (spaceDown.current) return;

    const { sx, sy, world } = getMouseWorld(e);

    // 1. Try to hit-test an existing wall first
    const tolWorld = HIT_TOLERANCE_PX / (BASE_GRID_PX * viewport.zoom);
    let best = null;
    for (const w of walls) {
      const d = distPointToSegment(
        world.x, world.y,
        num(w.x1), num(w.y1), num(w.x2), num(w.y2),
      );
      if (d <= tolWorld && (best == null || d < best.d)) best = { d, wall: w };
    }
    if (best) {
      setSelectedId(best.wall.id);
      setDrawingStart(null);
      return;
    }

    // 2. Otherwise it's a drawing click
    const snapped = snapWorld(world);
    if (drawingStart == null) {
      setDrawingStart(snapped);
      setSelectedId(null);
    } else {
      // Don't create zero-length walls
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
      // Keep the world point under the cursor stable.
      const worldUnderMouse = {
        x: (sx - vp.panX) / (BASE_GRID_PX * vp.zoom),
        y: (sy - vp.panY) / (BASE_GRID_PX * vp.zoom),
      };
      const newPanX = sx - worldUnderMouse.x * BASE_GRID_PX * newZoom;
      const newPanY = sy - worldUnderMouse.y * BASE_GRID_PX * newZoom;
      return { panX: newPanX, panY: newPanY, zoom: newZoom };
    });
  }

  function onMouseLeave() {
    setHoverWorld(null);
    panState.current.active = false;
  }

  // ---- keyboard ----
  useEffect(() => {
    function isTypingTarget(t) {
      if (!t) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t.isContentEditable;
    }
    function onKeyDown(e) {
      if (e.code === 'Space') {
        spaceDown.current = true;
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (e.code === 'Delete' || e.code === 'Backspace') {
        if (selectedId != null) {
          e.preventDefault();
          deleteSelected();
        }
      } else if (e.code === 'Escape') {
        setDrawingStart(null);
        setSelectedId(null);
      }
    }
    function onKeyUp(e) {
      if (e.code === 'Space') spaceDown.current = false;
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ---- wall mutations ----
  async function createWall(p1, p2) {
    try {
      const newWall = await api.createWall(projectId, {
        x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
        wall_type: drawingType,
      });
      setWalls((cur) => [...cur, newWall]);
      onMaterialsChanged?.();
    } catch (e) { setError(e.message); }
  }

  async function deleteSelected() {
    if (selectedId == null) return;
    const id = selectedId;
    setSelectedId(null);
    setWalls((cur) => cur.filter((w) => w.id !== id));
    try {
      await api.deleteWall(projectId, id);
      onMaterialsChanged?.();
    } catch (e) { setError(e.message); }
  }

  // Patch a wall — used by side panel. Pending changes are debounced for text inputs.
  const debounceTimers = useRef({});
  const updateWall = useCallback((id, patch, { immediate = false } = {}) => {
    setWalls((cur) => cur.map((w) => (w.id === id ? { ...w, ...patch } : w)));
    if (immediate) {
      api.updateWall(projectId, id, patch).then(() => onMaterialsChanged?.()).catch((e) => setError(e.message));
      return;
    }
    clearTimeout(debounceTimers.current[id]);
    debounceTimers.current[id] = setTimeout(() => {
      api.updateWall(projectId, id, patch).then(() => onMaterialsChanged?.()).catch((e) => setError(e.message));
    }, 500);
  }, [projectId, onMaterialsChanged]);

  const selectedWall = walls.find((w) => w.id === selectedId) || null;

  return (
    <div>
      <div className="sketch-toolbar">
        <label style={{ margin: 0 }}>Type for next wall</label>
        <select value={drawingType} onChange={(e) => setDrawingType(e.target.value)} style={{ width: 'auto' }}>
          {WALL_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button
          className="danger"
          onClick={deleteSelected}
          disabled={!selectedWall}
        >Delete selected</button>
        <span className="muted">
          Click-click to draw • Esc cancels • Space+drag or middle-drag pans • Wheel zooms
        </span>
        <span className="right muted">
          {walls.length} wall{walls.length === 1 ? '' : 's'} · scale 1 grid = {scaleFtPerGrid} ft
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
            style={{ cursor: spaceDown.current ? 'grab' : 'crosshair', display: 'block', background: '#fafafa' }}
          />
        </div>
        {selectedWall && (
          <WallEditor
            wall={selectedWall}
            scale={scaleFtPerGrid}
            onChange={(patch, opts) => updateWall(selectedWall.id, patch, opts)}
            onDelete={deleteSelected}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// ---------- side panel ----------
function WallEditor({ wall, scale, onChange, onDelete, onClose }) {
  const lengthFt = wallLengthFt(wall, scale);
  return (
    <div className="wall-editor card">
      <div className="row" style={{ marginBottom: '0.5rem' }}>
        <strong style={{ flex: 1 }}>Wall #{wall.id}</strong>
        <button className="secondary" style={{ flex: '0 0 auto', padding: '0.25rem 0.5rem' }} onClick={onClose}>×</button>
      </div>
      <p className="muted" style={{ margin: 0 }}>Length: {lengthFt.toFixed(2)} ft</p>

      <label>Wall type</label>
      <select
        value={wall.wall_type}
        onChange={(e) => onChange({ wall_type: e.target.value }, { immediate: true })}
      >
        {WALL_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <label>Height (ft) — blank = inherit</label>
      <input
        type="number"
        step="0.5"
        value={wall.height ?? ''}
        placeholder="(default)"
        onChange={(e) => onChange({ height: e.target.value === '' ? null : e.target.value })}
      />

      <label>Sheathing override</label>
      <select
        value={wall.sheathing_override ?? ''}
        onChange={(e) => onChange({ sheathing_override: e.target.value || null }, { immediate: true })}
      >
        <option value="">(default)</option>
        {SHEATHING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <label>Drywall override</label>
      <select
        value={wall.drywall_override ?? ''}
        onChange={(e) => onChange({ drywall_override: e.target.value || null }, { immediate: true })}
      >
        <option value="">(default)</option>
        {DRYWALL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <label>Extra corner studs</label>
      <input
        type="number"
        step="1"
        min="0"
        value={wall.extra_corner_studs ?? 0}
        onChange={(e) => onChange({ extra_corner_studs: Number(e.target.value) || 0 })}
      />

      <button className="danger" style={{ marginTop: '1rem', width: '100%' }} onClick={onDelete}>
        Delete this wall
      </button>
    </div>
  );
}

// ---------- canvas drawing ----------
function drawScene(ctx, size, vp, walls, selectedId, drawingStart, hoverWorld, scale) {
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, size.w, size.h);

  drawGrid(ctx, size, vp);

  for (const wall of walls) {
    drawWall(ctx, wall, vp, wall.id === selectedId, scale);
  }

  if (drawingStart && hoverWorld) {
    drawPreviewWall(ctx, drawingStart, hoverWorld, vp, scale);
  }
  if (drawingStart) {
    const s = worldToScreen(drawingStart.x, drawingStart.y, vp);
    ctx.fillStyle = '#2563eb';
    ctx.beginPath();
    ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (hoverWorld) {
    const s = worldToScreen(hoverWorld.x, hoverWorld.y, vp);
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
    ctx.stroke();
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
  for (let x = startX; x < size.w; x += step) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, size.h);
  }
  for (let y = startY; y < size.h; y += step) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(size.w, y + 0.5);
  }
  ctx.stroke();

  // Origin axes
  const origin = worldToScreen(0, 0, vp);
  if (origin.x >= 0 && origin.x <= size.w) {
    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(origin.x + 0.5, 0);
    ctx.lineTo(origin.x + 0.5, size.h);
    ctx.stroke();
  }
  if (origin.y >= 0 && origin.y <= size.h) {
    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(0, origin.y + 0.5);
    ctx.lineTo(size.w, origin.y + 0.5);
    ctx.stroke();
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

  // halo for selected
  if (selected) {
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = style.width + 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  // endpoint dots
  ctx.fillStyle = style.color;
  for (const p of [a, b]) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // length label at midpoint
  const lengthFt = wallLengthFt(wall, scale);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const text = `${lengthFt.toFixed(2)} ft`;
  ctx.font = '12px -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const padding = 3;
  const metrics = ctx.measureText(text);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(
    mx - metrics.width / 2 - padding,
    my - 8 - padding,
    metrics.width + padding * 2,
    16 + padding * 2,
  );
  ctx.fillStyle = '#111827';
  ctx.fillText(text, mx, my);
}

function drawPreviewWall(ctx, start, end, vp, scale) {
  const a = worldToScreen(start.x, start.y, vp);
  const b = worldToScreen(end.x, end.y, vp);
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // length label
  const dx = end.x - start.x, dy = end.y - start.y;
  const lengthFt = Math.sqrt(dx * dx + dy * dy) * scale;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const text = `${lengthFt.toFixed(2)} ft`;
  ctx.font = '12px -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2563eb';
  ctx.fillText(text, mx, my - 12);
}
