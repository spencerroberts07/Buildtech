import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { api } from '../api.js';

// Polygon-based roof sketch tool. Each section is a polygon (corners +
// per-edge overhang + per-edge end_type). Reuses the same world/screen model
// as Sketch.jsx so coordinates stay consistent across the app.

const BASE_GRID_PX = 20;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
const CANVAS_HEIGHT = 600;
const CORNER_HIT_PX = 10;
const EDGE_HIT_PX = 8;
const OVERHANG_HANDLE_PX = 9;
const OVERHANG_HANDLE_OFFSET_PX = 18; // pixels outside polygon edge for the handle

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
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
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
// CCW winding sign — used to know which side of an edge is "outside".
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

// Build per-section quick-access geometry for canvas rendering / hit-test.
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

// Outward unit normal for edge i (in world coords, accounting for winding).
function edgeOutwardNormal(corners, i, ccw) {
  const a = corners[i], b = corners[(i + 1) % corners.length];
  const dx = Number(b.x) - Number(a.x), dy = Number(b.y) - Number(a.y);
  const len = Math.hypot(dx, dy) || 1;
  return ccw ? { nx: dy / len, ny: -dx / len } : { nx: -dy / len, ny: dx / len };
}

// ---------- main component ----------
export default function RoofSketch({
  projectId, projectSettings, onMaterialsChanged, onProjectSettingsChange, refetchProjectSettings,
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  const scaleFtPerGrid = num(projectSettings?.scale_ft_per_grid) || 1;
  const [sections, setSections] = useState([]);
  const [legacyRoof, setLegacyRoof] = useState(null); // for sheathing_type / rafter_spacing
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }

  // Selection state. Only one of these is non-null at a time.
  const [selectedSectionId, setSelectedSectionId] = useState(null);
  const [selectedCornerKey, setSelectedCornerKey] = useState(null); // `${sid}:${idx}`
  const [selectedEdgeKey, setSelectedEdgeKey] = useState(null);     // `${sid}:${idx}`

  // Add-section drawing state
  const [adding, setAdding] = useState(false);
  const [draftCorners, setDraftCorners] = useState([]);

  // Drag state
  const dragState = useRef({ active: false, type: null });

  const [viewport, setViewport] = useState(() => ({
    panX: num(projectSettings?.viewport_pan_x),
    panY: num(projectSettings?.viewport_pan_y),
    zoom: num(projectSettings?.viewport_zoom) || 1,
  }));
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: CANVAS_HEIGHT });
  const [hoverWorld, setHoverWorld] = useState(null);

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
      // Auto-copy top floor on first open if no sections yet.
      if ((secs || []).length === 0) {
        await tryAutoCopyTopFloor();
      }
    } catch (e) { setError(e.message); setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  useEffect(() => { loadAll(); }, [loadAll]);

  async function tryAutoCopyTopFloor() {
    try {
      const fps = await api.listFloorPlans(projectId);
      // Prefer Floor 2, then Floor 1.
      let candidate = (fps || []).find((p) => p.level === 'floor2');
      if (!candidate || !Array.isArray(candidate.corners) || candidate.corners.length < 3) {
        candidate = (fps || []).find((p) => p.level === 'floor1');
      }
      if (!candidate || !Array.isArray(candidate.corners) || candidate.corners.length < 3) {
        return; // no source polygon → empty state UI handles it
      }
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
      if (wrapRef.current) setCanvasSize({ w: wrapRef.current.clientWidth, h: CANVAS_HEIGHT });
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

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
    } catch (e) { setError(e.message); }
  }
  async function patchLegacyRoof(patch) {
    try {
      // The legacy roofs row only carries sheathing_type / rafter_spacing now.
      // Auto-create one if it doesn't exist yet.
      let existing = legacyRoof;
      if (!existing) {
        existing = await api.createRoof(projectId, {
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
      adding, draftCorners, hoverWorld, scale: scaleFtPerGrid,
    });
  }, [canvasSize, viewport, sections, selectedSectionId, selectedCornerKey, selectedEdgeKey, adding, draftCorners, hoverWorld, scaleFtPerGrid]);

  // ---- mouse handlers ----
  function getMouse(e) {
    const r = canvasRef.current.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  }
  function snappedWorld(sx, sy) {
    const w = screenToWorld(sx, sy, viewport);
    return { x: snapHalf(w.x), y: snapHalf(w.y) };
  }

  // Hit-test: corner > overhang handle > edge > polygon body. Returns a hit
  // descriptor or null.
  function hitTest(sx, sy) {
    for (const s of sections) {
      const { corners, ccw } = sectionGeom(s, scaleFtPerGrid);
      // corners
      for (let i = 0; i < corners.length; i++) {
        const cs = worldToScreen(corners[i].x, corners[i].y, viewport);
        if (Math.hypot(cs.x - sx, cs.y - sy) <= CORNER_HIT_PX) {
          return { kind: 'corner', sid: s.id, idx: i };
        }
      }
      // overhang handles (placed midpoint + outward normal × OFFSET)
      for (let i = 0; i < corners.length; i++) {
        const a = corners[i], b = corners[(i + 1) % corners.length];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const { nx, ny } = edgeOutwardNormal(corners, i, ccw);
        const ms = worldToScreen(mid.x, mid.y, viewport);
        const hx = ms.x + nx * OVERHANG_HANDLE_OFFSET_PX;
        const hy = ms.y + ny * OVERHANG_HANDLE_OFFSET_PX;
        if (Math.hypot(hx - sx, hy - sy) <= OVERHANG_HANDLE_PX) {
          return { kind: 'overhang', sid: s.id, idx: i };
        }
      }
      // edges
      for (let i = 0; i < corners.length; i++) {
        const a = corners[i], b = corners[(i + 1) % corners.length];
        const aS = worldToScreen(a.x, a.y, viewport);
        const bS = worldToScreen(b.x, b.y, viewport);
        if (distPointToSegment(sx, sy, aS.x, aS.y, bS.x, bS.y) <= EDGE_HIT_PX) {
          return { kind: 'edge', sid: s.id, idx: i };
        }
      }
    }
    // polygon body (interior)
    for (const s of sections) {
      const { corners } = sectionGeom(s, scaleFtPerGrid);
      const w = screenToWorld(sx, sy, viewport);
      if (pointInPolygon(w.x, w.y, corners)) {
        return { kind: 'body', sid: s.id };
      }
    }
    return null;
  }

  function onMouseDown(e) {
    if (e.button !== 0) return; // left click only
    const { sx, sy } = getMouse(e);
    if (adding) {
      // Add a corner (snapped). Double-click or Enter closes.
      const w = snappedWorld(sx, sy);
      setDraftCorners((cur) => [...cur, w]);
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
      dragState.current = { active: true, type: 'corner', sid: hit.sid, idx: hit.idx, moved: false };
    } else if (hit.kind === 'overhang') {
      setSelectedSectionId(hit.sid);
      setSelectedEdgeKey(`${hit.sid}:${hit.idx}`);
      setSelectedCornerKey(null);
      dragState.current = { active: true, type: 'overhang', sid: hit.sid, idx: hit.idx, moved: false };
    } else if (hit.kind === 'edge') {
      setSelectedSectionId(hit.sid);
      setSelectedEdgeKey(`${hit.sid}:${hit.idx}`);
      setSelectedCornerKey(null);
    } else if (hit.kind === 'body') {
      setSelectedSectionId(hit.sid);
      setSelectedCornerKey(null);
      setSelectedEdgeKey(null);
    }
  }
  function onMouseMove(e) {
    const { sx, sy } = getMouse(e);
    setHoverWorld(screenToWorld(sx, sy, viewport));
    const ds = dragState.current;
    if (!ds.active) return;
    if (ds.type === 'corner') {
      const w = snappedWorld(sx, sy);
      setSections((cur) => cur.map((s) => {
        if (s.id !== ds.sid) return s;
        const corners = (s.corners || []).map((c, i) =>
          i === ds.idx ? { x: w.x, y: w.y } : { x: Number(c.x), y: Number(c.y) }
        );
        return { ...s, corners };
      }));
      ds.moved = true;
    } else if (ds.type === 'overhang') {
      // Drag perpendicular to edge → set overhang_ft based on distance from edge midpoint.
      const sec = sections.find((s) => s.id === ds.sid);
      if (!sec) return;
      const { corners, ccw } = sectionGeom(sec, scaleFtPerGrid);
      const a = corners[ds.idx], b = corners[(ds.idx + 1) % corners.length];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const w = screenToWorld(sx, sy, viewport);
      const { nx, ny } = edgeOutwardNormal(corners, ds.idx, ccw);
      const project = (w.x - mid.x) * nx + (w.y - mid.y) * ny; // world units along outward normal
      const oh = Math.max(0, Math.min(4, snapQuarter(project * scaleFtPerGrid)));
      setSections((cur) => cur.map((s) => {
        if (s.id !== ds.sid) return s;
        return {
          ...s,
          edges: (s.edges || []).map((e) =>
            Number(e.edge_index) === ds.idx ? { ...e, overhang_ft: oh } : e
          ),
        };
      }));
      ds.lastOverhang = oh;
      ds.moved = true;
    }
  }
  function onMouseUp() {
    const ds = dragState.current;
    if (!ds.active) return;
    if (ds.type === 'corner' && ds.moved) {
      const sec = sections.find((s) => s.id === ds.sid);
      if (sec) patchSection(ds.sid, { corners: sec.corners });
    } else if (ds.type === 'overhang' && ds.moved) {
      const sec = sections.find((s) => s.id === ds.sid);
      const edge = sec?.edges?.find((e) => Number(e.edge_index) === ds.idx);
      if (edge) patchEdge(ds.sid, edge.id, { overhang_ft: ds.lastOverhang ?? 1.5 });
    }
    dragState.current = { active: false, type: null };
  }
  function onWheel(e) {
    e.preventDefault();
    const { sx, sy } = getMouse(e);
    const oldZoom = viewport.zoom;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * factor));
    if (newZoom === oldZoom) return;
    // Zoom toward cursor point.
    const w = screenToWorld(sx, sy, viewport);
    const newPanX = sx - w.x * BASE_GRID_PX * newZoom;
    const newPanY = sy - w.y * BASE_GRID_PX * newZoom;
    setViewport({ panX: newPanX, panY: newPanY, zoom: newZoom });
  }

  // Add-section keyboard
  useEffect(() => {
    function onKey(e) {
      if (!adding) return;
      if (e.key === 'Enter') {
        if (draftCorners.length >= 3) {
          createSectionFromCorners(draftCorners);
        }
        setAdding(false); setDraftCorners([]);
      } else if (e.key === 'Escape') {
        setAdding(false); setDraftCorners([]);
      } else if (e.key === 'Backspace') {
        setDraftCorners((cur) => cur.slice(0, -1));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adding, draftCorners]);

  // ---- selected derived ----
  const selectedSection = sections.find((s) => s.id === selectedSectionId) || null;
  const selectedEdge = (() => {
    if (!selectedEdgeKey) return null;
    const [sid, idx] = selectedEdgeKey.split(':');
    const sec = sections.find((s) => s.id === Number(sid));
    if (!sec) return null;
    return (sec.edges || []).find((e) => Number(e.edge_index) === Number(idx)) || null;
  })();

  // Edge popup screen position (only when edge is selected and not dragging)
  const edgePopupPos = (() => {
    if (!selectedEdge || !selectedSection) return null;
    const { corners } = sectionGeom(selectedSection, scaleFtPerGrid);
    const i = Number(selectedEdge.edge_index);
    if (i < 0 || i >= corners.length) return null;
    const a = corners[i], b = corners[(i + 1) % corners.length];
    const mid = worldToScreen((a.x + b.x) / 2, (a.y + b.y) / 2, viewport);
    return { x: mid.x, y: mid.y };
  })();

  if (loading) return <p className="muted">Loading roof…</p>;

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
        <button
          className={adding ? 'primary' : 'secondary'}
          onClick={() => { setAdding((v) => !v); setDraftCorners([]); }}
        >{adding ? 'Cancel drawing' : '+ Add Section'}</button>
        {sections.length === 0 && !adding && (
          <button className="primary" onClick={() => setAdding(true)}>Draw Roof Section</button>
        )}
        <span className="muted" style={{ alignSelf: 'center' }}>
          {sections.length} section{sections.length === 1 ? '' : 's'}
          {adding && ` · click to place corner${draftCorners.length > 0 ? `s (${draftCorners.length})` : ''}, Enter to close, Esc to cancel`}
        </span>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
        <div ref={wrapRef} style={{ flex: 1, position: 'relative', border: '1px solid #E0E0E0', borderRadius: 4, overflow: 'hidden', background: '#FAFAFA' }}>
          <canvas
            ref={canvasRef}
            style={{ display: 'block', cursor: adding ? 'crosshair' : 'default' }}
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
              left: edgePopupPos.x + 12,
              top: edgePopupPos.y - 14,
              background: 'white',
              border: '1px solid #E0E0E0',
              borderRadius: 6,
              padding: '4px 6px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              fontSize: '0.85rem',
              display: 'flex',
              gap: 4,
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
          {toast && (
            <div style={{
              position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
              padding: '0.5rem 1rem',
              background: 'rgba(10,10,10,0.92)', color: 'white',
              fontSize: '13px', borderRadius: 6,
              pointerEvents: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
              maxWidth: '80%',
            }}>{toast}</div>
          )}
        </div>

        <div style={{ flex: '0 0 320px' }}>
          {selectedSection ? (
            <SectionPanel
              section={selectedSection}
              scale={scaleFtPerGrid}
              onPatch={(patch) => patchSection(selectedSection.id, patch)}
              onPatchEdge={(eid, patch) => patchEdge(selectedSection.id, eid, patch)}
              onDelete={() => deleteSection(selectedSection.id)}
              onClose={() => { setSelectedSectionId(null); setSelectedCornerKey(null); setSelectedEdgeKey(null); }}
            />
          ) : (
            <ProjectRoofSettingsPanel
              roof={legacyRoof}
              onPatch={patchLegacyRoof}
            />
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  );
}

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
      <select
        value={section.pitch}
        onChange={(e) => onPatch({ pitch: e.target.value })}
      >
        {PITCH_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>

      <p className="muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
        Footprint: <strong>{g.footprintArea.toLocaleString(undefined, { maximumFractionDigits: 0 })} sf</strong>
        {' · '}
        Surface: <strong>{g.surfaceArea.toLocaleString(undefined, { maximumFractionDigits: 0 })} sf</strong>
      </p>

      <p className="muted" style={{ marginTop: '0.75rem', marginBottom: '0.25rem', fontSize: '0.85rem' }}>
        Edges (click an edge on the canvas for Gable/Hip)
      </p>
      <table style={{ fontSize: '0.85rem' }}>
        <thead>
          <tr><th>#</th><th>End</th><th>Overhang (ft)</th></tr>
        </thead>
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

function ProjectRoofSettingsPanel({ roof, onPatch }) {
  return (
    <div className="card">
      <strong>Roof project settings</strong>
      <p className="muted" style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}>
        Applied across all sections.
      </p>
      <label>Sheathing</label>
      <select
        value={roof?.sheathing_type || 'plywood_1_2_csp'}
        onChange={(e) => onPatch({ sheathing_type: e.target.value })}
      >
        {SHEATHING_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <label>Rafter / truss spacing</label>
      <select
        value={roof?.rafter_spacing || '24_oc'}
        onChange={(e) => onPatch({ rafter_spacing: e.target.value })}
      >
        {SPACING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <p className="muted" style={{ marginTop: '0.75rem', fontSize: '0.85rem', marginBottom: 0 }}>
        Click a section on the canvas to edit its name, pitch, and per-edge overhangs / end type.
      </p>
    </div>
  );
}

// ---------- canvas ----------
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

function drawScene(ctx, size, vp, S) {
  const { sections, selectedSectionId, selectedCornerKey, selectedEdgeKey, adding, draftCorners, hoverWorld, scale } = S;
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

  // sections
  for (const s of sections) {
    const { corners, edges, ccw, expanded } = sectionGeom(s, scale);
    if (corners.length < 3) continue;
    const selected = s.id === selectedSectionId;
    // Filled body
    ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
    ctx.beginPath();
    for (let i = 0; i < corners.length; i++) {
      const c = worldToScreen(corners[i].x, corners[i].y, vp);
      if (i === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y);
    }
    ctx.closePath();
    ctx.fill();

    // Per-edge stroke (gable solid, hip dashed)
    for (let i = 0; i < corners.length; i++) {
      const a = worldToScreen(corners[i].x, corners[i].y, vp);
      const b = worldToScreen(corners[(i + 1) % corners.length].x, corners[(i + 1) % corners.length].y, vp);
      const e = edges.find((ee) => Number(ee.edge_index) === i);
      const isHip = e?.end_type === 'hip';
      const edgeKey = `${s.id}:${i}`;
      const edgeSelected = edgeKey === selectedEdgeKey;
      ctx.strokeStyle = selected ? '#CC0000' : '#1D4ED8';
      ctx.lineWidth = edgeSelected ? 3 : (selected ? 2.5 : 2);
      ctx.setLineDash(isHip ? [6, 4] : []);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Overhang dashed lines (from polygon edge to expanded edge)
    ctx.strokeStyle = '#7C7C7C';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i], b = corners[(i + 1) % corners.length];
      const ea = expanded[i], eb = expanded[(i + 1) % expanded.length];
      const aS = worldToScreen(a.x, a.y, vp);
      const bS = worldToScreen(b.x, b.y, vp);
      const eaS = worldToScreen(ea.x, ea.y, vp);
      const ebS = worldToScreen(eb.x, eb.y, vp);
      ctx.beginPath();
      ctx.moveTo(aS.x, aS.y); ctx.lineTo(eaS.x, eaS.y);
      ctx.moveTo(bS.x, bS.y); ctx.lineTo(ebS.x, ebS.y);
      ctx.moveTo(eaS.x, eaS.y); ctx.lineTo(ebS.x, ebS.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Section name label (centroid)
    const cen = polygonCentroid(corners);
    const cs = worldToScreen(cen.x, cen.y, vp);
    ctx.font = '600 12px "Segoe UI", -apple-system, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const label = s.section_name || 'Roof Section';
    const m = ctx.measureText(label);
    ctx.fillRect(cs.x - m.width / 2 - 4, cs.y - 10, m.width + 8, 18);
    ctx.fillStyle = '#1D4ED8';
    ctx.fillText(label, cs.x, cs.y);

    // Corners
    for (let i = 0; i < corners.length; i++) {
      const c = worldToScreen(corners[i].x, corners[i].y, vp);
      const cKey = `${s.id}:${i}`;
      const isSel = cKey === selectedCornerKey;
      ctx.fillStyle = isSel ? '#CC0000' : '#1D4ED8';
      ctx.beginPath();
      ctx.arc(c.x, c.y, isSel ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Overhang handles (small circles outside each edge midpoint)
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i], b = corners[(i + 1) % corners.length];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const { nx, ny } = edgeOutwardNormal(corners, i, ccw);
      const ms = worldToScreen(mid.x, mid.y, vp);
      const hx = ms.x + nx * OVERHANG_HANDLE_OFFSET_PX;
      const hy = ms.y + ny * OVERHANG_HANDLE_OFFSET_PX;
      ctx.fillStyle = 'white';
      ctx.strokeStyle = '#1D4ED8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hx, hy, OVERHANG_HANDLE_PX, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      // tiny double-arrow glyph
      ctx.strokeStyle = '#1D4ED8';
      ctx.beginPath();
      ctx.moveTo(hx - 4, hy); ctx.lineTo(hx + 4, hy);
      ctx.moveTo(hx - 4, hy); ctx.lineTo(hx - 2, hy - 2);
      ctx.moveTo(hx - 4, hy); ctx.lineTo(hx - 2, hy + 2);
      ctx.moveTo(hx + 4, hy); ctx.lineTo(hx + 2, hy - 2);
      ctx.moveTo(hx + 4, hy); ctx.lineTo(hx + 2, hy + 2);
      ctx.stroke();
      // overhang label
      const e = edges.find((ee) => Number(ee.edge_index) === i);
      if (e && Number(e.overhang_ft) > 0) {
        ctx.font = '500 10px "Segoe UI", -apple-system, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillStyle = '#1D4ED8';
        ctx.fillText(`${Number(e.overhang_ft).toFixed(2)}ft`, hx + nx * 14, hy + ny * 14);
      }
    }
  }

  // Valley / ridge overlay between sections. Heuristic: any two edges from
  // different sections that are within 1ft and parallel within ~5° are
  // treated as a shared edge. Same pitch → valley (purple); different
  // pitches → ridge (orange). The overlay is for visual reference only —
  // the rules engine does the matching length computation.
  const PARALLEL_DOT = Math.cos(5 * Math.PI / 180);
  const NEAR_FT = 1.0;
  const drawn = new Set();
  for (let si = 0; si < sections.length; si++) {
    for (let sj = si + 1; sj < sections.length; sj++) {
      const a = sectionGeom(sections[si], scale);
      const b = sectionGeom(sections[sj], scale);
      if (a.expanded.length < 3 || b.expanded.length < 3) continue;
      const sameP = sections[si].pitch === sections[sj].pitch;
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
          // Use the shorter edge for the overlay run.
          const useA = aLen <= bLen ? [ax1, ax2] : [bx1, bx2];
          const p1 = worldToScreen(useA[0].x, useA[0].y, vp);
          const p2 = worldToScreen(useA[1].x, useA[1].y, vp);
          ctx.strokeStyle = sameP ? '#7C3AED' : '#D97706';
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }

  // Draft polygon (when adding a new section)
  if (adding && draftCorners.length > 0) {
    ctx.strokeStyle = '#CC0000';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (let i = 0; i < draftCorners.length; i++) {
      const c = worldToScreen(draftCorners[i].x, draftCorners[i].y, vp);
      if (i === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y);
    }
    if (hoverWorld) {
      const hc = worldToScreen(hoverWorld.x, hoverWorld.y, vp);
      ctx.lineTo(hc.x, hc.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    for (const dc of draftCorners) {
      const c = worldToScreen(dc.x, dc.y, vp);
      ctx.fillStyle = '#CC0000';
      ctx.beginPath();
      ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
