import React, { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api.js';

// Polygon-based deck sketch tool. Mirrors RoofSketch's structure but is
// specialized for decks: deck shapes snap to the exterior walls of the
// active floor plan (those edges become the ledger). All other edges are
// free perimeter — they get rim joists, fascia, and railing.

const BASE_GRID_PX = 20;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
const CANVAS_HEIGHT = 600;
const CORNER_HIT_PX = 10;
const EDGE_HIT_PX = 8;
const SNAP_FT_WALL = 2;
const LEDGER_TOL_FT = 0.5;

const JOIST_SIZE_OPTIONS = [
  { value: '2x8', label: '2x8' }, { value: '2x10', label: '2x10' }, { value: '2x12', label: '2x12' },
];
const JOIST_SPACING_OPTIONS = [
  { value: 8, label: '8" o/c' }, { value: 16, label: '16" o/c' }, { value: 24, label: '24" o/c' },
];
const BEAM_SIZE_OPTIONS = [
  { value: '2x8', label: '2x8' }, { value: '2x10', label: '2x10' }, { value: '2x12', label: '2x12' },
];
const BEAM_PLY_OPTIONS = [
  { value: 2, label: '2-ply' }, { value: 3, label: '3-ply' },
];
const POST_SIZE_OPTIONS = [
  { value: '4x4', label: '4x4' }, { value: '6x6', label: '6x6' }, { value: '8x8', label: '8x8' },
];
const FOOTING_OPTIONS = [
  { value: 'deck_block', label: 'Deck Block' },
  { value: 'sonotube', label: 'Sonotube + BigFoot' },
  { value: 'poured', label: 'Poured Concrete 12x12x8' },
];
const DECKING_SIZE_OPTIONS = [
  { value: '5/4x6', label: '5/4 x 6' }, { value: '2x6', label: '2 x 6' },
];
const DECKING_PATTERN_OPTIONS = [
  { value: 'perpendicular', label: 'Perpendicular to house' },
  { value: 'parallel', label: 'Parallel to house' },
  { value: 'boxed', label: 'Boxed / Picture Frame' },
];
const RAILING_TYPE_OPTIONS = [
  { value: 'wood', label: 'Wood 2x4' },
  { value: 'aluminum', label: 'Aluminum Package (quoted separately)' },
];
const RAILING_POST_SPACING_OPTIONS = [
  { value: 4, label: '4 ft' }, { value: 6, label: '6 ft' }, { value: 8, label: '8 ft' },
];

// ---------- geometry helpers ----------
function num(v) { return v == null || v === '' ? 0 : Number(v); }
function worldToScreen(wx, wy, vp) {
  return { x: wx * BASE_GRID_PX * vp.zoom + vp.panX, y: wy * BASE_GRID_PX * vp.zoom + vp.panY };
}
function screenToWorld(sx, sy, vp) {
  return { x: (sx - vp.panX) / (BASE_GRID_PX * vp.zoom), y: (sy - vp.panY) / (BASE_GRID_PX * vp.zoom) };
}
function snapHalf(v) { return Math.round(v * 2) / 2; }
function distance(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
function distPointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { d: Math.hypot(px - x1, py - y1), t: 0, cx: x1, cy: y1 };
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

// Same logic as deckRules.detectLedgerEdges (mirrored on the client so the
// canvas can mark ledger edges without round-tripping to the server).
function detectLedgerEdges(deckCorners, houseCorners, tolFt = 0.5) {
  if (!Array.isArray(deckCorners) || deckCorners.length < 3) return [];
  if (!Array.isArray(houseCorners) || houseCorners.length < 3) return [];
  const out = [];
  for (let i = 0; i < deckCorners.length; i++) {
    const a = deckCorners[i];
    const b = deckCorners[(i + 1) % deckCorners.length];
    let near = false;
    for (let j = 0; j < houseCorners.length; j++) {
      const c = houseCorners[j];
      const d = houseCorners[(j + 1) % houseCorners.length];
      const da = distPointToSegment(a.x, a.y, c.x, c.y, d.x, d.y).d;
      const db = distPointToSegment(b.x, b.y, c.x, c.y, d.x, d.y).d;
      if (da <= tolFt && db <= tolFt) { near = true; break; }
    }
    if (near) out.push(i);
  }
  return out;
}

// ---------- main component ----------
export default function DeckSketch({
  projectId, projectSettings, level, onMaterialsChanged, onProjectSettingsChange,
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);

  const scaleFtPerGrid = num(projectSettings?.scale_ft_per_grid) || 1;

  const [decks, setDecks] = useState([]);
  const [floorPlanCorners, setFloorPlanCorners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDeckId, setSelectedDeckId] = useState(null);
  const [selectedCornerKey, setSelectedCornerKey] = useState(null); // 'deckId:cornerIdx'
  const [selectedEdgeKey, setSelectedEdgeKey] = useState(null);     // 'deckId:edgeIdx'
  const [selectedStairId, setSelectedStairId] = useState(null);

  // Tool: 'select' | 'draw_deck' | 'add_stairs' | 'pan'
  const [tool, setTool] = useState('select');
  const [draftCorners, setDraftCorners] = useState([]);
  const [snappedHover, setSnappedHover] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [hoverWorld, setHoverWorld] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  const dragState = useRef({ active: false, type: null, deckId: null, cornerIdx: null, moved: false });
  const cornerSaveTimer = useRef(null);
  const panState = useRef({ active: false, startX: 0, startY: 0, basePan: null });
  const spaceDown = useRef(false);

  const [viewport, setViewport] = useState(() => ({
    panX: num(projectSettings?.viewport_pan_x),
    panY: num(projectSettings?.viewport_pan_y),
    zoom: num(projectSettings?.viewport_zoom) || 1,
  }));
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: CANVAS_HEIGHT });

  // ---- bootstrap ----
  const loadAll = useCallback(async () => {
    try {
      const [allDecks, fps] = await Promise.all([
        api.listDecks(projectId),
        api.listFloorPlans(projectId),
      ]);
      // Show every deck on the project — `floor_level` is stored per-deck
      // for second-storey framing context but the canvas is shared.
      setDecks(allDecks || []);
      const fp = (fps || []).find((p) => p.level === 'floor1');
      setFloorPlanCorners(Array.isArray(fp?.corners) ? fp.corners : []);
      setLoading(false);
    } catch (e) { setError(e.message); setLoading(false); }
  }, [projectId, level]);
  useEffect(() => { loadAll(); }, [loadAll]);

  // ---- canvas resize ----
  useEffect(() => {
    function measure() {
      if (wrapRef.current) setCanvasSize({ w: wrapRef.current.clientWidth, h: fullscreen ? window.innerHeight - 80 : CANVAS_HEIGHT });
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [fullscreen]);

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
      decks, floorPlanCorners, draftCorners, snappedHover, hoverWorld,
      selectedDeckId, selectedCornerKey, selectedEdgeKey, selectedStairId,
      scaleFtPerGrid, tool,
    });
  }, [canvasSize, viewport, decks, floorPlanCorners, draftCorners, snappedHover,
      hoverWorld, selectedDeckId, selectedCornerKey, selectedEdgeKey, selectedStairId,
      scaleFtPerGrid, tool]);

  // ---- helpers ----
  function getMouseWorld(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return { sx, sy, world: screenToWorld(sx, sy, viewport) };
  }
  // Snap to: existing deck corner > house wall corner > house wall edge > 0.5ft grid.
  function snapWorld(world, opts = {}) {
    const snapToWall = opts.snapToWall !== false;
    const snapDistFt = snapToWall ? SNAP_FT_WALL : 0.5;
    // Deck corners
    let best = null;
    for (const d of decks) {
      for (let i = 0; i < (d.corners || []).length; i++) {
        const c = d.corners[i];
        const dist = Math.hypot(c.x - world.x, c.y - world.y);
        if (dist <= snapDistFt && (best == null || dist < best.dist)) {
          best = { dist, x: Number(c.x), y: Number(c.y), type: 'deck-corner' };
        }
      }
    }
    if (best) return best;
    // House corners
    for (const c of floorPlanCorners) {
      const dist = Math.hypot(c.x - world.x, c.y - world.y);
      if (dist <= snapDistFt && (best == null || dist < best.dist)) {
        best = { dist, x: Number(c.x), y: Number(c.y), type: 'wall-corner' };
      }
    }
    if (best) return best;
    // House edges
    for (let i = 0; i < floorPlanCorners.length; i++) {
      const a = floorPlanCorners[i];
      const b = floorPlanCorners[(i + 1) % floorPlanCorners.length];
      const d = distPointToSegment(world.x, world.y, a.x, a.y, b.x, b.y);
      if (d.d <= snapDistFt && (best == null || d.d < best.dist)) {
        best = { dist: d.d, x: snapHalf(d.cx), y: snapHalf(d.cy), type: 'wall-edge' };
      }
    }
    if (best) return best;
    return { x: snapHalf(world.x), y: snapHalf(world.y), type: 'grid' };
  }

  function hitTestCorner(sx, sy) {
    for (const d of decks) {
      for (let i = 0; i < (d.corners || []).length; i++) {
        const c = d.corners[i];
        const s = worldToScreen(c.x, c.y, viewport);
        if (Math.hypot(s.x - sx, s.y - sy) <= CORNER_HIT_PX) {
          return { deckId: d.id, cornerIdx: i };
        }
      }
    }
    return null;
  }
  function hitTestEdge(world) {
    const tol = EDGE_HIT_PX / (BASE_GRID_PX * viewport.zoom);
    let best = null;
    for (const d of decks) {
      for (let i = 0; i < (d.corners || []).length; i++) {
        const a = d.corners[i];
        const b = d.corners[(i + 1) % d.corners.length];
        const r = distPointToSegment(world.x, world.y, a.x, a.y, b.x, b.y);
        if (r.d <= tol && (best == null || r.d < best.d)) best = { d: r.d, deckId: d.id, edgeIdx: i, t: r.t };
      }
    }
    return best;
  }
  function hitTestDeck(world) {
    for (const d of decks) {
      if (pointInPolygon(world.x, world.y, d.corners || [])) return d.id;
    }
    return null;
  }

  // ---- mutations ----
  async function autoDetectLedger(deck) {
    const corners = deck.corners || [];
    const ledger = detectLedgerEdges(corners, floorPlanCorners, LEDGER_TOL_FT);
    // Only push if it differs to avoid an unnecessary PUT.
    const cur = Array.isArray(deck.attached_wall_edge) ? deck.attached_wall_edge : [];
    if (cur.length === ledger.length && cur.every((v, i) => v === ledger[i])) return deck;
    const updated = await api.updateDeck(projectId, deck.id, { attached_wall_edge: ledger });
    setDecks((cur) => cur.map((x) => x.id === deck.id ? updated : x));
    return updated;
  }

  async function createDeckFromCorners(corners) {
    try {
      const detected = detectLedgerEdges(corners, floorPlanCorners, LEDGER_TOL_FT);
      const created = await api.createDeck(projectId, {
        name: `Deck ${decks.length + 1}`,
        floor_level: level,
        corners,
        attached_wall_edge: detected,
        deck_height_ft: 3.0,
      });
      setDecks((cur) => [...cur, created]);
      setSelectedDeckId(created.id);
      setTool('select');
      onMaterialsChanged?.();
      if (detected.length === 0) {
        showToast('No ledger detected — first/last point must touch the house. You can re-draw or edit corners.');
      } else {
        showToast(`Deck created — ${detected.length} ledger edge${detected.length === 1 ? '' : 's'} detected`);
      }
    } catch (e) { setError(e.message); }
  }

  async function patchDeck(deckId, patch) {
    try {
      // Optimistic local update.
      setDecks((cur) => cur.map((d) => d.id === deckId ? { ...d, ...patch } : d));
      const updated = await api.updateDeck(projectId, deckId, patch);
      setDecks((cur) => cur.map((d) => d.id === deckId ? updated : d));
      if ('corners' in patch) await autoDetectLedger(updated);
      onMaterialsChanged?.();
    } catch (e) { setError(e.message); }
  }

  async function deleteDeck(deckId) {
    if (!confirm('Delete this deck?')) return;
    try {
      await api.deleteDeck(projectId, deckId);
      setDecks((cur) => cur.filter((d) => d.id !== deckId));
      if (selectedDeckId === deckId) setSelectedDeckId(null);
      onMaterialsChanged?.();
    } catch (e) { setError(e.message); }
  }

  async function addStair(deckId, edgeIdx, t) {
    try {
      const deck = decks.find((d) => d.id === deckId);
      if (!deck) return;
      const stdSteps = Math.max(1, Math.ceil(Number(deck.deck_height_ft || 3) * 12 / 7));
      const created = await api.createDeckStair(projectId, deckId, {
        edge_index: edgeIdx,
        position_fraction: Math.max(0.05, Math.min(0.95, t)),
        width_ft: 3.0,
        num_steps: stdSteps,
        tread_material: deck.decking_size || '5/4x6',
      });
      setDecks((cur) => cur.map((d) => d.id === deckId
        ? { ...d, stairs: [...(d.stairs || []), created] }
        : d
      ));
      setSelectedStairId(created.id);
      setTool('select');
      onMaterialsChanged?.();
    } catch (e) { setError(e.message); }
  }

  async function patchStair(deckId, stairId, patch) {
    try {
      setDecks((cur) => cur.map((d) => d.id === deckId ? {
        ...d, stairs: (d.stairs || []).map((s) => s.id === stairId ? { ...s, ...patch } : s),
      } : d));
      const updated = await api.updateDeckStair(projectId, deckId, stairId, patch);
      setDecks((cur) => cur.map((d) => d.id === deckId ? {
        ...d, stairs: (d.stairs || []).map((s) => s.id === stairId ? updated : s),
      } : d));
      onMaterialsChanged?.();
    } catch (e) { setError(e.message); }
  }

  async function deleteStair(deckId, stairId) {
    if (!confirm('Delete this staircase?')) return;
    try {
      await api.deleteDeckStair(projectId, deckId, stairId);
      setDecks((cur) => cur.map((d) => d.id === deckId ? {
        ...d, stairs: (d.stairs || []).filter((s) => s.id !== stairId),
      } : d));
      if (selectedStairId === stairId) setSelectedStairId(null);
      onMaterialsChanged?.();
    } catch (e) { setError(e.message); }
  }

  // ---- canvas events ----
  function onMouseDown(e) {
    const { sx, sy, world } = getMouseWorld(e);
    // Pan with space, middle button, or pan tool.
    if (e.button === 1 || spaceDown.current || tool === 'pan') {
      panState.current = { active: true, startX: e.clientX, startY: e.clientY, basePan: { x: viewport.panX, y: viewport.panY } };
      return;
    }
    if (tool === 'draw_deck') {
      const snap = snapWorld(world, { snapToWall: true });
      // Click on first corner to close.
      if (draftCorners.length >= 3) {
        const first = draftCorners[0];
        if (Math.hypot(first.x - snap.x, first.y - snap.y) < 0.6) {
          finalizeDraft();
          return;
        }
      }
      setDraftCorners([...draftCorners, { x: snap.x, y: snap.y }]);
      return;
    }
    if (tool === 'add_stairs') {
      const edgeHit = hitTestEdge(world);
      if (!edgeHit) return;
      const deck = decks.find((d) => d.id === edgeHit.deckId);
      const isLedger = (deck?.attached_wall_edge || []).includes(edgeHit.edgeIdx);
      if (isLedger) {
        showToast('Stairs cannot attach to a ledger edge — pick a free side.');
        return;
      }
      addStair(edgeHit.deckId, edgeHit.edgeIdx, edgeHit.t);
      return;
    }
    // Select tool — pick corner > edge > deck body.
    const cornerHit = hitTestCorner(sx, sy);
    if (cornerHit) {
      setSelectedDeckId(cornerHit.deckId);
      setSelectedCornerKey(`${cornerHit.deckId}:${cornerHit.cornerIdx}`);
      setSelectedEdgeKey(null);
      setSelectedStairId(null);
      dragState.current = { active: true, type: 'corner', deckId: cornerHit.deckId, cornerIdx: cornerHit.cornerIdx, moved: false };
      return;
    }
    const edgeHit = hitTestEdge(world);
    if (edgeHit) {
      setSelectedDeckId(edgeHit.deckId);
      setSelectedEdgeKey(`${edgeHit.deckId}:${edgeHit.edgeIdx}`);
      setSelectedCornerKey(null);
      setSelectedStairId(null);
      return;
    }
    const deckHit = hitTestDeck(world);
    if (deckHit) {
      setSelectedDeckId(deckHit);
      setSelectedCornerKey(null);
      setSelectedEdgeKey(null);
      setSelectedStairId(null);
      return;
    }
    // Clicked empty space — clear selection.
    setSelectedDeckId(null);
    setSelectedCornerKey(null);
    setSelectedEdgeKey(null);
    setSelectedStairId(null);
  }
  function onMouseMove(e) {
    const { world } = getMouseWorld(e);
    setHoverWorld(world);
    if (panState.current.active) {
      const dx = e.clientX - panState.current.startX;
      const dy = e.clientY - panState.current.startY;
      setViewport((v) => ({ ...v, panX: panState.current.basePan.x + dx, panY: panState.current.basePan.y + dy }));
      return;
    }
    if (tool === 'draw_deck') {
      setSnappedHover(snapWorld(world, { snapToWall: true }));
      return;
    }
    if (dragState.current.active && dragState.current.type === 'corner') {
      const { deckId, cornerIdx } = dragState.current;
      const snap = snapWorld(world, { snapToWall: false });
      dragState.current.moved = true;
      // Local update only; debounce server save.
      setDecks((cur) => cur.map((d) => d.id === deckId ? {
        ...d,
        corners: (d.corners || []).map((c, i) => i === cornerIdx ? { x: snap.x, y: snap.y } : c),
      } : d));
      clearTimeout(cornerSaveTimer.current);
      cornerSaveTimer.current = setTimeout(() => {
        const deck = decks.find((d) => d.id === deckId);
        if (!deck) return;
        const newCorners = (deck.corners || []).map((c, i) => i === cornerIdx ? { x: snap.x, y: snap.y } : c);
        patchDeck(deckId, { corners: newCorners });
      }, 300);
    }
  }
  function onMouseUp() {
    panState.current.active = false;
    if (dragState.current.active) {
      dragState.current.active = false;
    }
  }
  function onWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const { sx, sy, world } = getMouseWorld(e);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, viewport.zoom * factor));
    // Keep mouse-world point stationary.
    const newPanX = sx - world.x * BASE_GRID_PX * newZoom;
    const newPanY = sy - world.y * BASE_GRID_PX * newZoom;
    setViewport({ panX: newPanX, panY: newPanY, zoom: newZoom });
  }
  function onContextMenu(e) {
    e.preventDefault();
    const { sx, sy } = getMouseWorld(e);
    const hit = hitTestCorner(sx, sy);
    if (!hit) return;
    const deck = decks.find((d) => d.id === hit.deckId);
    if (!deck || (deck.corners || []).length <= 3) return;
    if (!confirm('Delete this corner?')) return;
    const newCorners = deck.corners.filter((_, i) => i !== hit.cornerIdx);
    patchDeck(deck.id, { corners: newCorners });
  }

  function finalizeDraft() {
    if (draftCorners.length < 3) return;
    createDeckFromCorners(draftCorners);
    setDraftCorners([]);
    setSnappedHover(null);
  }
  function cancelDraft() {
    setDraftCorners([]);
    setSnappedHover(null);
    setTool('select');
  }

  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.key === ' ') { spaceDown.current = true; return; }
      if (e.key === 'Escape') {
        if (tool === 'draw_deck') cancelDraft();
        else {
          setSelectedDeckId(null);
          setSelectedCornerKey(null);
          setSelectedEdgeKey(null);
          setSelectedStairId(null);
        }
        return;
      }
      if (e.key === 'Enter' && tool === 'draw_deck') {
        finalizeDraft();
      }
    }
    function onKeyUp(e) {
      if (e.key === ' ') spaceDown.current = false;
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); };
  }, [tool, draftCorners]);

  const selectedDeck = decks.find((d) => d.id === selectedDeckId) || null;
  const selectedStair = selectedDeck?.stairs?.find((s) => s.id === selectedStairId) || null;

  if (loading) return <p className="muted">Loading decks…</p>;

  return (
    <div ref={wrapRef} style={fullscreen ? {
      position: 'fixed', inset: 0, zIndex: 50, background: 'white', padding: '0.5rem',
    } : {}}>
      {error && <p className="error">{error}</p>}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <ToolButton active={tool === 'select'}    onClick={() => setTool('select')}>Select</ToolButton>
        <ToolButton active={tool === 'draw_deck'} onClick={() => setTool('draw_deck')}>Draw Deck</ToolButton>
        <ToolButton active={tool === 'add_stairs'} onClick={() => setTool('add_stairs')}>Add Stairs</ToolButton>
        <ToolButton active={tool === 'pan'}       onClick={() => setTool('pan')}>Pan</ToolButton>
        <button onClick={() => setFullscreen((f) => !f)} className="secondary" style={{ marginLeft: 'auto' }}>
          {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
        <canvas
          ref={canvasRef}
          style={{ border: '1px solid #E0E0E0', background: 'white', cursor: tool === 'draw_deck' ? 'crosshair' : 'default', flex: 1 }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
          onContextMenu={onContextMenu}
        />
        <DeckSidePanel
          deck={selectedDeck}
          stair={selectedStair}
          floorPlanCorners={floorPlanCorners}
          scale={scaleFtPerGrid}
          onPatchDeck={(patch) => selectedDeck && patchDeck(selectedDeck.id, patch)}
          onDeleteDeck={() => selectedDeck && deleteDeck(selectedDeck.id)}
          onPatchStair={(patch) => selectedDeck && selectedStair && patchStair(selectedDeck.id, selectedStair.id, patch)}
          onDeleteStair={() => selectedDeck && selectedStair && deleteStair(selectedDeck.id, selectedStair.id)}
          onSelectStair={setSelectedStairId}
        />
      </div>
      {toast && (
        <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: '#FEF3C7', color: '#92400E', borderRadius: 4, fontSize: 13 }}>
          {toast}
        </div>
      )}
      {tool === 'draw_deck' && (
        <p className="muted" style={{ marginTop: '0.4rem', fontSize: 13 }}>
          <strong>Drawing deck</strong> — click corners ({draftCorners.length} placed). Start and end on the house wall.
          Click first corner or press <strong>Enter</strong> to close (3+ corners). <strong>Esc</strong> cancels.
        </p>
      )}
      {tool === 'add_stairs' && (
        <p className="muted" style={{ marginTop: '0.4rem', fontSize: 13 }}>
          <strong>Add stairs</strong> — click a non-ledger edge of a deck to place a staircase.
        </p>
      )}
    </div>
  );
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

function ToolButton({ active, children, ...rest }) {
  return (
    <button
      {...rest}
      className={active ? 'primary' : 'secondary'}
      style={{ padding: '0.35rem 0.75rem', fontSize: 13 }}
    >{children}</button>
  );
}

// ============================================================
// Side panel for deck + stair settings
// ============================================================
function DeckSidePanel({ deck, stair, floorPlanCorners, scale, onPatchDeck, onDeleteDeck, onPatchStair, onDeleteStair, onSelectStair }) {
  if (!deck) {
    return (
      <div style={{ width: 280, padding: '0.5rem', borderLeft: '1px solid #E0E0E0', fontSize: 13, color: '#6B7280' }}>
        Select a deck or use Draw Deck to start.
      </div>
    );
  }
  const corners = deck.corners || [];
  const areaSf = polygonArea(corners) * scale * scale;
  const heightFt = Number(deck.deck_height_ft) || 0;
  const guardrailRequired = heightFt > 2.0;
  const set = (key) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    onPatchDeck({ [key]: v });
  };
  const setNum = (key, parseFloat = true) => (e) => {
    const raw = e.target.value;
    if (raw === '') return onPatchDeck({ [key]: null });
    const v = parseFloat ? Number(raw) : parseInt(raw, 10);
    if (!Number.isFinite(v)) return;
    onPatchDeck({ [key]: v });
  };
  return (
    <div style={{ width: 280, padding: '0.5rem 0.75rem', borderLeft: '1px solid #E0E0E0', fontSize: 13, overflowY: 'auto', maxHeight: '85vh' }}>
      {stair ? (
        <StairPanel stair={stair} deck={deck} onPatchStair={onPatchStair} onDeleteStair={onDeleteStair} onBack={() => onSelectStair(null)} />
      ) : (
        <>
          <SectionBand>General</SectionBand>
          <Field label="Deck name">
            <input value={deck.name || ''} onChange={set('name')} style={{ width: '100%' }} />
          </Field>
          <Field label="Height from grade (ft)">
            <input type="number" step="0.5" value={deck.deck_height_ft ?? ''} onChange={setNum('deck_height_ft')} style={{ width: '5rem' }} />
          </Field>
          {guardrailRequired && (
            <div style={{ background: '#FEF3C7', color: '#92400E', padding: '0.4rem 0.5rem', borderRadius: 4, fontSize: 12, marginBottom: '0.5rem' }}>
              ⚠️ Guardrail required by OBC (&gt; 600mm above grade)
            </div>
          )}
          <Field label="Area"><span className="muted">{areaSf.toFixed(0)} sf</span></Field>
          <Field label="Ledger edges"><span className="muted">{(deck.attached_wall_edge || []).join(', ') || 'none detected'}</span></Field>

          <SectionBand>Framing</SectionBand>
          <SelectField label="Joist size"    value={deck.joist_size}  options={JOIST_SIZE_OPTIONS}  onChange={set('joist_size')} />
          <SelectField label="Joist spacing" value={Number(deck.joist_spacing_inches)} options={JOIST_SPACING_OPTIONS} onChange={(e) => onPatchDeck({ joist_spacing_inches: Number(e.target.value) })} />
          <SelectField label="Beam size"     value={deck.beam_size}   options={BEAM_SIZE_OPTIONS}   onChange={set('beam_size')} />
          <SelectField label="Beam ply"      value={Number(deck.beam_ply)} options={BEAM_PLY_OPTIONS} onChange={(e) => onPatchDeck({ beam_ply: Number(e.target.value) })} />
          <SelectField label="Post size"     value={deck.post_size}   options={POST_SIZE_OPTIONS}   onChange={set('post_size')} />
          <Field label="Post spacing (ft)">
            <input type="number" step="0.5" value={deck.post_spacing_ft ?? ''} onChange={setNum('post_spacing_ft')} style={{ width: '5rem' }} />
          </Field>

          <SectionBand>Footing</SectionBand>
          <SelectField label="Footing type" value={deck.footing_type} options={FOOTING_OPTIONS} onChange={set('footing_type')} />

          <SectionBand>Decking</SectionBand>
          <SelectField label="Board size" value={deck.decking_size} options={DECKING_SIZE_OPTIONS} onChange={set('decking_size')} />
          <SelectField label="Pattern"    value={deck.decking_pattern} options={DECKING_PATTERN_OPTIONS} onChange={set('decking_pattern')} />
          <CheckboxField label="Include fascia board" checked={!!deck.fascia_board} onChange={set('fascia_board')} />
          <CheckboxField label="Composite decking package" checked={!!deck.composite_package} onChange={set('composite_package')} />

          <SectionBand>Railing</SectionBand>
          <CheckboxField
            label={guardrailRequired ? 'Include railing (required at this height)' : 'Include railing'}
            checked={!!deck.include_railing || guardrailRequired}
            disabled={guardrailRequired}
            onChange={set('include_railing')}
          />
          <SelectField label="Railing type"   value={deck.railing_type}                  options={RAILING_TYPE_OPTIONS}         onChange={set('railing_type')} />
          <SelectField label="Post spacing"   value={Number(deck.railing_post_spacing_ft)} options={RAILING_POST_SPACING_OPTIONS} onChange={(e) => onPatchDeck({ railing_post_spacing_ft: Number(e.target.value) })} />

          <SectionBand>Stairs</SectionBand>
          {(deck.stairs || []).length === 0 ? (
            <p className="muted" style={{ fontSize: 12, margin: '0.3rem 0' }}>None. Use Add Stairs tool.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {(deck.stairs || []).map((s) => (
                <li key={s.id} style={{ padding: '0.3rem 0', borderBottom: '1px solid #F3F4F6' }}>
                  <button
                    onClick={() => onSelectStair(s.id)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline', color: '#1F2937', padding: 0 }}
                  >
                    Edge {s.edge_index} · {Number(s.width_ft).toFixed(1)}ft wide · {s.num_steps} steps
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div style={{ marginTop: '0.75rem' }}>
            <button onClick={onDeleteDeck} className="secondary" style={{ color: '#991B1B', fontSize: 12 }}>Delete deck</button>
          </div>
        </>
      )}
    </div>
  );
}

function StairPanel({ stair, deck, onPatchStair, onDeleteStair, onBack }) {
  const stdSteps = Math.max(1, Math.ceil(Number(deck?.deck_height_ft || 3) * 12 / 7));
  return (
    <>
      <div style={{ marginBottom: '0.5rem' }}>
        <button onClick={onBack} className="secondary" style={{ fontSize: 12 }}>← Back to deck</button>
      </div>
      <SectionBand>Staircase</SectionBand>
      <Field label="Width (ft)">
        <input type="number" step="0.25" min="3" value={stair.width_ft ?? ''}
          onChange={(e) => onPatchStair({ width_ft: Number(e.target.value) })} style={{ width: '5rem' }} />
      </Field>
      <Field label={`Number of steps (auto: ${stdSteps})`}>
        <input type="number" step="1" min="1" value={stair.num_steps ?? ''}
          onChange={(e) => onPatchStair({ num_steps: Number(e.target.value) })} style={{ width: '5rem' }} />
      </Field>
      <SelectField label="Tread material" value={stair.tread_material} options={DECKING_SIZE_OPTIONS}
        onChange={(e) => onPatchStair({ tread_material: e.target.value })} />
      <div style={{ marginTop: '0.75rem' }}>
        <button onClick={onDeleteStair} className="secondary" style={{ color: '#991B1B', fontSize: 12 }}>Delete staircase</button>
      </div>
    </>
  );
}

function SectionBand({ children }) {
  return <div style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#6B7280', marginTop: '0.75rem', marginBottom: '0.4rem' }}>{children}</div>;
}
function Field({ label, children }) {
  return (
    <div style={{ marginBottom: '0.4rem' }}>
      <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 2 }}>{label}</div>
      {children}
    </div>
  );
}
function SelectField({ label, value, options, onChange }) {
  return (
    <Field label={label}>
      <select value={value ?? ''} onChange={onChange} style={{ width: '100%' }}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}
function CheckboxField({ label, checked, onChange, disabled }) {
  return (
    <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.4rem', fontSize: 12, opacity: disabled ? 0.6 : 1 }}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <span>{label}</span>
    </label>
  );
}

// ============================================================
// Canvas drawing
// ============================================================
function drawScene(ctx, canvasSize, vp, state) {
  const { w, h } = canvasSize;
  ctx.clearRect(0, 0, w, h);
  // Grid background.
  drawGrid(ctx, w, h, vp);
  // House polygon (ghost).
  if (state.floorPlanCorners.length >= 3) {
    ctx.save();
    ctx.beginPath();
    state.floorPlanCorners.forEach((c, i) => {
      const s = worldToScreen(c.x, c.y, vp);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(180, 180, 180, 0.06)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 120, 120, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  // Decks.
  for (const deck of state.decks) drawDeck(ctx, deck, vp, state);
  // Draft polygon (in-progress draw).
  if (state.draftCorners.length > 0) drawDraft(ctx, state.draftCorners, state.snappedHover, vp, state.scaleFtPerGrid);
  // Hover snap indicator while drawing.
  if (state.tool === 'draw_deck' && state.snappedHover) {
    const s = worldToScreen(state.snappedHover.x, state.snappedHover.y, vp);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = state.snappedHover.type === 'wall-corner' || state.snappedHover.type === 'wall-edge' ? '#F59E0B' : '#9CA3AF';
    ctx.globalAlpha = 0.5;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawGrid(ctx, w, h, vp) {
  ctx.strokeStyle = '#F3F4F6';
  ctx.lineWidth = 1;
  const step = BASE_GRID_PX * vp.zoom;
  if (step < 6) return;
  const startX = vp.panX % step;
  const startY = vp.panY % step;
  ctx.beginPath();
  for (let x = startX; x < w; x += step) {
    ctx.moveTo(x, 0); ctx.lineTo(x, h);
  }
  for (let y = startY; y < h; y += step) {
    ctx.moveTo(0, y); ctx.lineTo(w, y);
  }
  ctx.stroke();
}

function drawDeck(ctx, deck, vp, state) {
  const corners = deck.corners || [];
  if (corners.length < 2) return;
  const isSel = deck.id === state.selectedDeckId;
  // Fill
  if (corners.length >= 3) {
    ctx.beginPath();
    corners.forEach((c, i) => {
      const s = worldToScreen(c.x, c.y, vp);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(139, 90, 40, 0.08)';
    ctx.fill();
  }
  // Edges.
  const ledger = new Set((deck.attached_wall_edge || []).map(Number));
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    const aS = worldToScreen(a.x, a.y, vp);
    const bS = worldToScreen(b.x, b.y, vp);
    const isLedger = ledger.has(i);
    const isEdgeSelected = state.selectedEdgeKey === `${deck.id}:${i}`;
    ctx.beginPath();
    ctx.moveTo(aS.x, aS.y); ctx.lineTo(bS.x, bS.y);
    ctx.strokeStyle = isEdgeSelected ? '#1D4ED8' : (isLedger ? '#DC2626' : '#8B5A28');
    ctx.lineWidth = isEdgeSelected ? 3 : 2;
    ctx.setLineDash(isLedger ? [6, 4] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    // Dimension label.
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenFt = Math.hypot(dx, dy) * state.scaleFtPerGrid;
    const mx = (aS.x + bS.x) / 2, my = (aS.y + bS.y) / 2;
    // Outward normal.
    const lenS = Math.hypot(bS.x - aS.x, bS.y - aS.y) || 1;
    const nx = -(bS.y - aS.y) / lenS, ny = (bS.x - aS.x) / lenS;
    ctx.fillStyle = '#374151';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    const tx = mx + nx * 14, ty = my + ny * 14;
    ctx.fillText(`${lenFt.toFixed(1)}'`, tx, ty);
    if (isLedger) {
      ctx.fillStyle = '#DC2626';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText('LEDGER', mx - nx * 14, my - ny * 14);
    }
  }
  // Corners.
  for (let i = 0; i < corners.length; i++) {
    const s = worldToScreen(corners[i].x, corners[i].y, vp);
    const isSelCorner = state.selectedCornerKey === `${deck.id}:${i}`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, isSelCorner ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = isSelCorner ? '#1D4ED8' : (isSel ? '#8B5A28' : '#9CA3AF');
    ctx.fill();
  }
  // Center label.
  if (corners.length >= 3) {
    const c = polygonCentroid(corners);
    const sc = worldToScreen(c.x, c.y, vp);
    const area = polygonArea(corners) * state.scaleFtPerGrid * state.scaleFtPerGrid;
    ctx.fillStyle = '#6B7280';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(deck.name || 'Deck', sc.x, sc.y - 6);
    ctx.font = '11px sans-serif';
    ctx.fillText(`${area.toFixed(0)} sf`, sc.x, sc.y + 8);
  }
  // Stairs.
  for (const stair of (deck.stairs || [])) drawStair(ctx, deck, stair, vp, state);
}

function drawStair(ctx, deck, stair, vp, state) {
  const corners = deck.corners || [];
  const idx = Number(stair.edge_index);
  if (idx < 0 || idx >= corners.length) return;
  const a = corners[idx];
  const b = corners[(idx + 1) % corners.length];
  const t = Number(stair.position_fraction) || 0.5;
  const mx = a.x + t * (b.x - a.x);
  const my = a.y + t * (b.y - a.y);
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenW = Math.hypot(dx, dy) || 1;
  const ux = dx / lenW, uy = dy / lenW;
  // Outward normal — assume away from polygon centroid.
  const c = polygonCentroid(corners);
  const cVecX = mx - c.x, cVecY = my - c.y;
  let nx = -uy, ny = ux;
  if (nx * cVecX + ny * cVecY < 0) { nx = -nx; ny = -ny; }
  const widthFt = Number(stair.width_ft) || 3.0;
  const runFt = (Number(stair.num_steps) || 4) * 11 / 12;
  const aS = worldToScreen(mx - ux * widthFt / 2 / state.scaleFtPerGrid, my - uy * widthFt / 2 / state.scaleFtPerGrid, vp);
  const bS = worldToScreen(mx + ux * widthFt / 2 / state.scaleFtPerGrid, my + uy * widthFt / 2 / state.scaleFtPerGrid, vp);
  const cS = worldToScreen(mx + ux * widthFt / 2 / state.scaleFtPerGrid + nx * runFt / state.scaleFtPerGrid,
                            my + uy * widthFt / 2 / state.scaleFtPerGrid + ny * runFt / state.scaleFtPerGrid, vp);
  const dS = worldToScreen(mx - ux * widthFt / 2 / state.scaleFtPerGrid + nx * runFt / state.scaleFtPerGrid,
                            my - uy * widthFt / 2 / state.scaleFtPerGrid + ny * runFt / state.scaleFtPerGrid, vp);
  const isSel = stair.id === state.selectedStairId;
  ctx.beginPath();
  ctx.moveTo(aS.x, aS.y); ctx.lineTo(bS.x, bS.y); ctx.lineTo(cS.x, cS.y); ctx.lineTo(dS.x, dS.y); ctx.closePath();
  ctx.fillStyle = 'rgba(139, 90, 40, 0.18)';
  ctx.fill();
  ctx.strokeStyle = isSel ? '#1D4ED8' : '#8B5A28';
  ctx.lineWidth = isSel ? 2.5 : 1.5;
  ctx.stroke();
  // Tread lines.
  const steps = Number(stair.num_steps) || 4;
  for (let i = 1; i < steps; i++) {
    const k = i / steps;
    const p1 = { x: aS.x + (dS.x - aS.x) * k, y: aS.y + (dS.y - aS.y) * k };
    const p2 = { x: bS.x + (cS.x - bS.x) * k, y: bS.y + (cS.y - bS.y) * k };
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = '#8B5A28';
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
  // Center label.
  const mid = worldToScreen(mx + nx * runFt / 2 / state.scaleFtPerGrid, my + ny * runFt / 2 / state.scaleFtPerGrid, vp);
  ctx.fillStyle = '#6B7280';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${widthFt.toFixed(1)}' / ${steps} steps`, mid.x, mid.y);
}

function drawDraft(ctx, corners, hover, vp, scale) {
  ctx.save();
  ctx.strokeStyle = '#8B5A28';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  for (let i = 0; i < corners.length; i++) {
    const s = worldToScreen(corners[i].x, corners[i].y, vp);
    if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
  }
  if (hover) {
    const s = worldToScreen(hover.x, hover.y, vp);
    ctx.lineTo(s.x, s.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  // Corner dots.
  for (const c of corners) {
    const s = worldToScreen(c.x, c.y, vp);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#8B5A28';
    ctx.fill();
  }
  ctx.restore();
}
