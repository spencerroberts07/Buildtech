// Confirmation modal shown after Claude returns extracted floor-plan data.
// The user reviews every detected element (building info, exterior polygon,
// interior walls, doors, windows, roof settings), checks/unchecks what to
// apply, then clicks "Draw on Canvas" which calls the apply endpoint.
//
// Coordinate handling: Claude returns coordinates and dimensions in FEET
// from a top-left origin. The sketch canvas works in GRID UNITS where
// 1 grid = projectSettings.scale_ft_per_grid feet (default 1). All polygon
// + interior-wall coords are converted via ftToGrid() before being sent to
// the apply endpoint.

import React, { useMemo, useState } from 'react';
import { api } from '../api.js';

const WALL_SIDE_LABELS = { front: 'Front', back: 'Back', left: 'Left', right: 'Right' };

function snapHalf(v) { return Math.round(Number(v) * 2) / 2; }

export default function FloorPlanExtractionModal({
  data, scaleFtPerGrid, projectId, currentFloorLevel,
  existingExteriorWallCount, existingInteriorWallCount, existingOpeningsCount,
  onClose, onApplied, onError,
}) {
  const ftToGrid = (ft) => snapHalf(Number(ft) / (Number(scaleFtPerGrid) || 1));

  const conf = data.confidence || 'medium';
  const confColor =
    conf === 'high' ? { bg: '#DCFCE7', fg: '#166534', border: '#86EFAC' } :
    conf === 'low'  ? { bg: '#FFEDD5', fg: '#9A3412', border: '#FDBA74' } :
                      { bg: '#FEF9C3', fg: '#854D0E', border: '#FDE68A' };

  const hasExistingContent =
    (existingExteriorWallCount || 0) > 0 ||
    (existingInteriorWallCount || 0) > 0 ||
    (existingOpeningsCount || 0) > 0;

  // ---- multi-floor handling ----
  // Newer extractions return `floors: [{ floor_level, ...per-floor data }]`.
  // Older single-floor responses return plan data directly on the root.
  // `activeFloor` derefs to whichever shape we're working with.
  const multiFloor = Array.isArray(data.floors) && data.floors.length > 0;
  const detectedFloors = data.floors_detected || (multiFloor
    ? data.floors.map((f, i) => ({
        floor_level: f.floor_level || 'floor1',
        page_number: f.page_number || (i + 1),
        label: f.label || `Floor ${i + 1}`,
      }))
    : []);
  // Default selection: the entry whose floor_level matches the canvas's
  // currentFloorLevel, falling back to index 0.
  const initialFloorIdx = (() => {
    if (!multiFloor) return 0;
    const match = data.floors.findIndex((f) => f.floor_level === currentFloorLevel);
    return match >= 0 ? match : 0;
  })();
  const [selectedFloorIdx, setSelectedFloorIdx] = useState(initialFloorIdx);
  const activeFloor = multiFloor ? data.floors[selectedFloorIdx] : data;

  // ---- editable building info ----
  const initial = data.building || {};
  const [bldgWallType, setBldgWallType] = useState(initial.wall_type === '2x4' ? '2x4' : '2x6');
  const [bldgWallHeight, setBldgWallHeight] = useState(Number(initial.wall_height_ft) || 9);
  const [bldgStoreys, setBldgStoreys] = useState(Number(initial.num_storeys) || 1);
  const [bldgWidth, setBldgWidth] = useState(Number(initial.total_width_ft) || '');
  const [bldgDepth, setBldgDepth] = useState(Number(initial.total_depth_ft) || '');

  // ---- per-section toggles ----
  const [includeExterior, setIncludeExterior] = useState(true);
  const [includeRoof, setIncludeRoof] = useState(!!(data.roof?.pitch || data.roof?.truss_spacing_inches));

  // Interior walls + opening lists pulled from the active floor.
  const interiorWalls = activeFloor.interior_walls || [];
  const extDoors = activeFloor.exterior_doors || [];
  const intDoors = activeFloor.interior_doors || [];
  const windows  = activeFloor.windows || [];

  // Re-initialize the check sets whenever the selected floor changes so the
  // UI starts with all rows checked again.
  const [interiorChecks, setInteriorChecks] = useState(() => new Set(interiorWalls.map((_, i) => i)));
  const toggleInterior = (i) => setInteriorChecks((cur) => {
    const next = new Set(cur);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });
  const [openChecks, setOpenChecks] = useState(() => {
    const s = new Set();
    extDoors.forEach((_, i) => s.add(`ext_door:${i}`));
    intDoors.forEach((_, i) => s.add(`int_door:${i}`));
    windows.forEach((_, i) => s.add(`win:${i}`));
    return s;
  });
  const toggleOpen = (k) => setOpenChecks((cur) => {
    const next = new Set(cur);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  // When the floor selector changes, reset every checkbox so the user starts
  // with everything-on for the newly-active floor.
  React.useEffect(() => {
    setInteriorChecks(new Set(interiorWalls.map((_, i) => i)));
    const s = new Set();
    extDoors.forEach((_, i) => s.add(`ext_door:${i}`));
    intDoors.forEach((_, i) => s.add(`int_door:${i}`));
    windows.forEach((_, i) => s.add(`win:${i}`));
    setOpenChecks(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFloorIdx]);

  // ---- replace warning ----
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // ---- compute exterior polygon (grid units, snapped) ----
  // Prefer fraction-based positions (more reliable when Claude's absolute
  // feet drift) — multiplied against the user-editable building dimensions
  // so adjusting Width/Depth in the form rescales the whole polygon.
  const polygonGrid = useMemo(() => {
    const poly = activeFloor.exterior_polygon;
    if (!Array.isArray(poly) || poly.length < 3) return [];
    const w = Number(bldgWidth) > 0 ? Number(bldgWidth) : null;
    const d = Number(bldgDepth) > 0 ? Number(bldgDepth) : null;
    return poly.map((p) => {
      const xFt = (p.x_fraction != null && w != null) ? Number(p.x_fraction) * w : Number(p.x_ft);
      const yFt = (p.y_fraction != null && d != null) ? Number(p.y_fraction) * d : Number(p.y_ft);
      return { x: ftToGrid(xFt), y: ftToGrid(yFt) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFloor.exterior_polygon, scaleFtPerGrid, bldgWidth, bldgDepth]);

  // ---- L-shape edge mapping: pick longest matching edge for each wall_side ----
  const edgeBySide = useMemo(() => {
    if (polygonGrid.length < 3) return {};
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of polygonGrid) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const TOL = 0.5;
    const result = { front: -1, back: -1, left: -1, right: -1 };
    const candidatesBySide = { front: [], back: [], left: [], right: [] };
    for (let i = 0; i < polygonGrid.length; i++) {
      const a = polygonGrid[i];
      const b = polygonGrid[(i + 1) % polygonGrid.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const midY = (a.y + b.y) / 2;
      const midX = (a.x + b.x) / 2;
      const isHorizontal = Math.abs(b.y - a.y) < TOL;
      const isVertical   = Math.abs(b.x - a.x) < TOL;
      if (isHorizontal && Math.abs(midY - maxY) < TOL) candidatesBySide.front.push({ i, len });
      if (isHorizontal && Math.abs(midY - minY) < TOL) candidatesBySide.back .push({ i, len });
      if (isVertical   && Math.abs(midX - minX) < TOL) candidatesBySide.left .push({ i, len });
      if (isVertical   && Math.abs(midX - maxX) < TOL) candidatesBySide.right.push({ i, len });
    }
    for (const side of Object.keys(candidatesBySide)) {
      const winners = candidatesBySide[side].sort((a, b) => b.len - a.len);
      if (winners.length > 0) result[side] = winners[0].i;
    }
    return result;
  }, [polygonGrid]);

  // ---- build the openings list to send. Each schedule row expands into N
  //      individual opening records (quantity-expanded), distributed evenly
  //      along the wall_side's mapped edge. Rows where wall_side is null or
  //      doesn't map to an edge end up in "unplaced" instead.
  const planned = useMemo(() => {
    const placed = [];
    const unplaced = [];

    function placeExterior(row, category, idx, wallSide) {
      const qty = Math.max(1, Math.round(Number(row.quantity) || 1));
      const edgeIdx = wallSide && edgeBySide[wallSide] != null ? edgeBySide[wallSide] : -1;
      const ro_w = Number(row.ro_width_inches);
      const ro_h = Number(row.ro_height_inches);
      const baseLabel = row.label || category;
      if (edgeIdx < 0 || !Number.isFinite(ro_w) || !Number.isFinite(ro_h)) {
        unplaced.push({ category, idx, row, reason: edgeIdx < 0 ? 'wall_side unknown' : 'missing RO size' });
        return;
      }
      // If Claude returned a position_fraction for a SINGLE-quantity row, use
      // it directly. Otherwise distribute evenly: 1/(N+1)..N/(N+1).
      const hintedPos = (qty === 1 && Number.isFinite(Number(row.position_fraction)))
        ? Math.max(0, Math.min(1, Number(row.position_fraction)))
        : null;
      for (let k = 1; k <= qty; k++) {
        placed.push({
          wall_kind: 'exterior',
          edge_index: edgeIdx,
          type: category === 'win' ? 'window' : 'door',
          ro_width: ro_w,
          ro_height: ro_h,
          position: hintedPos != null ? hintedPos : (k / (qty + 1)),
          label: qty > 1 ? `${baseLabel}-${k}` : baseLabel,
        });
      }
    }

    function placeInterior(row, idx) {
      const qty = Math.max(1, Math.round(Number(row.quantity) || 1));
      const ro_w = Number(row.ro_width_inches);
      const ro_h = Number(row.ro_height_inches);
      // Interior doors carry a room hint from the AI (e.g. "Bedroom 2",
      // "Bath"). Append it to the canvas label so the user can see which
      // door is supposed to go where when they fine-tune positions after
      // the apply.
      const hint = row.interior_wall_hint ? String(row.interior_wall_hint).trim() : '';
      const baseLabel = row.label
        ? (hint ? `${row.label} — ${hint}` : row.label)
        : (hint || `Int Door ${idx + 1}`);
      // Round-robin assignment across the checked interior walls. We don't
      // have room positions, so we can't truly "match hint to nearest wall"
      // here — the hint flows through to the label for the user to verify.
      const checkedInteriorIndices = interiorWalls
        .map((_, i) => i)
        .filter((i) => interiorChecks.has(i));
      if (checkedInteriorIndices.length === 0 || !Number.isFinite(ro_w) || !Number.isFinite(ro_h)) {
        unplaced.push({ category: 'int_door', idx, row, reason: checkedInteriorIndices.length === 0 ? 'no interior walls drawn' : 'missing RO size' });
        return;
      }
      for (let k = 0; k < qty; k++) {
        const interiorIdx = checkedInteriorIndices[k % checkedInteriorIndices.length];
        placed.push({
          wall_kind: 'interior',
          interior_wall_index: interiorIdx,
          type: 'door',
          ro_width: ro_w,
          ro_height: ro_h,
          position: 0.5,
          label: qty > 1 ? `${baseLabel}-${k + 1}` : baseLabel,
        });
      }
    }

    extDoors.forEach((row, i) => {
      if (!openChecks.has(`ext_door:${i}`)) return;
      placeExterior(row, 'ext_door', i, row.wall_side);
    });
    intDoors.forEach((row, i) => {
      if (!openChecks.has(`int_door:${i}`)) return;
      placeInterior(row, i);
    });
    windows.forEach((row, i) => {
      if (!openChecks.has(`win:${i}`)) return;
      placeExterior(row, 'win', i, row.wall_side);
    });

    return { placed, unplaced };
  }, [extDoors, intDoors, windows, openChecks, edgeBySide, interiorWalls, interiorChecks]);

  async function apply() {
    if (hasExistingContent && !replaceConfirmed) {
      setErr('Confirm "Yes, replace existing walls" before drawing.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const exteriorWallType =
        bldgWallType === '2x4' ? 'exterior_2x4' : 'exterior_2x6';
      const wFt = Number(bldgWidth) > 0 ? Number(bldgWidth) : null;
      const dFt = Number(bldgDepth) > 0 ? Number(bldgDepth) : null;
      // Prefer fraction-based positions when present so the wall positions
      // scale with whatever Width/Depth the user edited in the form.
      const ftFor = (absFt, frac, total) =>
        (frac != null && total != null) ? Number(frac) * total : Number(absFt);
      const interiorWallsBody = interiorWalls
        .map((w, i) => ({ w, i }))
        .filter(({ i }) => interiorChecks.has(i))
        .map(({ w }) => ({
          x1: ftToGrid(ftFor(w.start_x_ft, w.start_x_fraction, wFt)),
          y1: ftToGrid(ftFor(w.start_y_ft, w.start_y_fraction, dFt)),
          x2: ftToGrid(ftFor(w.end_x_ft,   w.end_x_fraction,   wFt)),
          y2: ftToGrid(ftFor(w.end_y_ft,   w.end_y_fraction,   dFt)),
          // Default to interior_2x4 unless the row is explicitly load-bearing
          // OR Claude already returned interior_2x6 for it.
          wall_type: w.is_load_bearing
            ? 'interior_2x6'
            : (w.wall_type === 'interior_2x6' ? 'interior_2x6' : 'interior_2x4'),
        }));
      // After the modal selects a subset of interior walls, the apply endpoint
      // inserts them in order — so we need to remap each opening's
      // `interior_wall_index` from the ORIGINAL index space to the FILTERED
      // index space.
      const filterOldToNew = new Map();
      let newIdx = 0;
      interiorWalls.forEach((_, oldIdx) => {
        if (interiorChecks.has(oldIdx)) {
          filterOldToNew.set(oldIdx, newIdx++);
        }
      });
      const openingsBody = planned.placed.map((op) => {
        if (op.wall_kind !== 'interior') return op;
        const remapped = filterOldToNew.get(op.interior_wall_index);
        return remapped == null ? null : { ...op, interior_wall_index: remapped };
      }).filter(Boolean);

      const out = await api.applyFloorPlanExtraction(projectId, {
        floor_level: currentFloorLevel,
        replace_existing: !!replaceConfirmed,
        exterior_polygon: includeExterior && polygonGrid.length >= 3 ? polygonGrid : null,
        interior_walls: interiorWallsBody,
        openings: openingsBody,
        apply_wall_type: exteriorWallType,
        apply_wall_height_ft: Number(bldgWallHeight) || null,
        apply_roof_pitch: includeRoof ? (data.roof?.pitch || null) : null,
        apply_rafter_spacing: includeRoof
          ? (Number(data.roof?.truss_spacing_inches) === 16 ? '16_oc'
            : Number(data.roof?.truss_spacing_inches) === 24 ? '24_oc' : null)
          : null,
      });
      if (out?.error) throw new Error(out.error);
      // Build the rich toast summary: "Floor 1 drawn from PDF: 4 exterior
      // walls (47'×35'), 6 interior walls (5×2x4, 1×2x6), 14 windows, 3
      // exterior doors, 10 interior doors". Counts come from what we just
      // submitted, NOT what the server returned, so the breakdown matches
      // what the user saw on the modal.
      const int2x4 = interiorWallsBody.filter((w) => w.wall_type === 'interior_2x4').length;
      const int2x6 = interiorWallsBody.filter((w) => w.wall_type === 'interior_2x6').length;
      const winCount = openingsBody.filter((o) => o.type === 'window').length;
      const extDoorCount = openingsBody.filter((o) => o.type === 'door' && o.wall_kind === 'exterior').length;
      const intDoorCount = openingsBody.filter((o) => o.type === 'door' && o.wall_kind === 'interior').length;
      const dimensions = (wFt && dFt) ? ` (${wFt}'×${dFt}')` : '';
      const intBits = [];
      if (int2x4 > 0) intBits.push(`${int2x4}×2x4`);
      if (int2x6 > 0) intBits.push(`${int2x6}×2x6`);
      const intDetail = intBits.length > 0 ? ` (${intBits.join(', ')})` : '';
      const levelLabel = currentFloorLevel === 'floor2' ? 'Floor 2'
        : currentFloorLevel === 'basement' ? 'Basement'
        : 'Floor 1';
      const summary =
        `${levelLabel} drawn from PDF: ${out?.exterior_walls_created || 0} exterior walls${dimensions}, ` +
        `${interiorWallsBody.length} interior walls${intDetail}, ` +
        `${winCount} window${winCount === 1 ? '' : 's'}, ` +
        `${extDoorCount} exterior door${extDoorCount === 1 ? '' : 's'}, ` +
        `${intDoorCount} interior door${intDoorCount === 1 ? '' : 's'}`;
      onApplied?.({ ...out, summary });
    } catch (e) {
      setErr(e.message);
      onError?.(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fpx-backdrop" role="dialog" aria-modal="true">
      <style>{FPX_CSS}</style>
      <div className="fpx-card">
        <header className="fpx-header">
          <div>
            <strong className="fpx-title">Floor Plan Detected — Review Before Drawing</strong>
            <div className="fpx-sub">
              All values are editable. Uncheck anything you don't want applied.
            </div>
          </div>
          <span
            className="fpx-conf-badge"
            style={{ background: confColor.bg, color: confColor.fg, borderColor: confColor.border }}
          >{conf} confidence</span>
        </header>

        {(data.notes || (data.warnings && data.warnings.length > 0)) && (
          <div className="fpx-notes">
            {data.notes && <p style={{ margin: 0 }}><strong>AI notes:</strong> {data.notes}</p>}
            {Array.isArray(data.warnings) && data.warnings.length > 0 && (
              <ul style={{ margin: '6px 0 0 0', paddingLeft: 18 }}>
                {data.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
            {conf === 'low' && (
              <p style={{ margin: '8px 0 0 0', color: '#9A3412' }}>
                <strong>Low confidence:</strong> consider drawing manually if anything looks wrong below.
              </p>
            )}
          </div>
        )}

        {hasExistingContent && (
          <div className="fpx-replace-banner">
            ⚠️ This floor already has {existingExteriorWallCount} exterior wall{existingExteriorWallCount === 1 ? '' : 's'},
            {' '}{existingInteriorWallCount} interior wall{existingInteriorWallCount === 1 ? '' : 's'},
            {' '}and {existingOpeningsCount} opening{existingOpeningsCount === 1 ? '' : 's'}. Drawing from PDF will
            <strong> REPLACE</strong> them.
            <label className="fpx-replace-check">
              <input type="checkbox" checked={replaceConfirmed} onChange={(e) => setReplaceConfirmed(e.target.checked)} />
              Yes, replace existing walls
            </label>
          </div>
        )}

        <div className="fpx-body">
          {/* Floor selector — visible only when the AI detected multiple
              plan pages. The user picks WHICH plan-page to draw onto the
              current canvas level. */}
          {multiFloor && detectedFloors.length > 1 && (
            <section className="fpx-section">
              <h3 className="fpx-section-title">
                {detectedFloors.length} floors detected — pick which to draw
              </h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {detectedFloors.map((f, i) => {
                  const active = i === selectedFloorIdx;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedFloorIdx(i)}
                      style={{
                        padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
                        font: 'inherit', fontSize: 13, fontWeight: 600,
                        background: active ? '#CC0000' : '#FFFFFF',
                        color: active ? '#FFFFFF' : '#1A1A1A',
                        border: `1px solid ${active ? '#CC0000' : '#E5E7EB'}`,
                      }}
                    >
                      {f.label || `Floor ${i + 1}`}
                      <span style={{ marginLeft: 6, opacity: 0.7, fontWeight: 400 }}>
                        (p.{f.page_number})
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="fpx-muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                Drawing onto: <strong>{currentFloorLevel}</strong>. Run extraction again from another floor tab to draw the other floor.
              </p>
            </section>
          )}

          {/* Section 1 — Building Info */}
          <section className="fpx-section">
            <h3 className="fpx-section-title">Building info</h3>
            <div className="fpx-grid-4">
              <NumberField label="Width (ft)" value={bldgWidth} onChange={setBldgWidth} />
              <NumberField label="Depth (ft)" value={bldgDepth} onChange={setBldgDepth} />
              <SelectField label="Wall type" value={bldgWallType} onChange={setBldgWallType}
                options={[['2x4', '2x4'], ['2x6', '2x6']]} />
              <SelectField label="Wall height" value={String(bldgWallHeight)} onChange={(v) => setBldgWallHeight(Number(v))}
                options={[['8', "8'"], ['9', "9'"], ['10', "10'"]]} />
              <SelectField label="Storeys" value={String(bldgStoreys)} onChange={(v) => setBldgStoreys(Number(v))}
                options={[['1', '1'], ['2', '2']]} />
              <ReadField label="Floor area (sf)" value={initial.floor_area_sqft != null ? Number(initial.floor_area_sqft).toLocaleString() : '—'} />
            </div>
          </section>

          {/* Section 2 — Exterior Polygon */}
          <section className="fpx-section">
            <div className="fpx-row-between">
              <h3 className="fpx-section-title">Exterior walls</h3>
              <label className="fpx-toggle">
                <input type="checkbox" checked={includeExterior} onChange={(e) => setIncludeExterior(e.target.checked)} />
                Draw exterior walls
              </label>
            </div>
            <div className="fpx-poly-row">
              <PolygonPreview polygon={polygonGrid} edgeBySide={edgeBySide} />
              <div className="fpx-poly-info">
                <div>{polygonGrid.length}-corner polygon detected</div>
                <div className="fpx-muted" style={{ marginTop: 6 }}>
                  Edge sides mapped: {Object.entries(edgeBySide).filter(([, v]) => v >= 0).map(([k]) => WALL_SIDE_LABELS[k]).join(', ') || 'none'}
                </div>
                <div className="fpx-muted" style={{ marginTop: 6, fontSize: 12 }}>
                  Draw manually if the shape needs adjustment.
                </div>
              </div>
            </div>
          </section>

          {/* Section 3 — Interior Walls */}
          <section className="fpx-section">
            <div className="fpx-row-between">
              <h3 className="fpx-section-title">Interior walls ({interiorWalls.length} detected)</h3>
              <div className="fpx-muted" style={{ fontSize: 12 }}>
                {interiorChecks.size} of {interiorWalls.length} selected
              </div>
            </div>
            {interiorWalls.length === 0 ? (
              <p className="fpx-muted">No interior walls detected.</p>
            ) : (
              <table className="fpx-table">
                <thead><tr><th>#</th><th>From</th><th>To</th><th>Length</th><th>Type</th><th style={{ width: 60 }}>Use?</th></tr></thead>
                <tbody>
                  {interiorWalls.map((w, i) => {
                    const len = Math.hypot((w.end_x_ft - w.start_x_ft), (w.end_y_ft - w.start_y_ft));
                    return (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td>{Number(w.start_x_ft).toFixed(1)}, {Number(w.start_y_ft).toFixed(1)}</td>
                        <td>{Number(w.end_x_ft).toFixed(1)}, {Number(w.end_y_ft).toFixed(1)}</td>
                        <td>{len.toFixed(1)} ft</td>
                        <td>{w.is_load_bearing ? 'Load bearing (2x6)' : (w.wall_type || '2x4')}</td>
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={interiorChecks.has(i)} onChange={() => toggleInterior(i)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          {/* Section 4-6 — Opening Schedules */}
          <OpeningTable
            title="Exterior doors"
            rows={extDoors}
            keyPrefix="ext_door"
            openChecks={openChecks}
            toggleOpen={toggleOpen}
            showWallSide
          />
          <OpeningTable
            title="Interior doors"
            rows={intDoors}
            keyPrefix="int_door"
            openChecks={openChecks}
            toggleOpen={toggleOpen}
          />
          <OpeningTable
            title="Windows"
            rows={windows}
            keyPrefix="win"
            openChecks={openChecks}
            toggleOpen={toggleOpen}
            showWallSide
          />

          {/* Could not be placed */}
          {planned.unplaced.length > 0 && (
            <section className="fpx-section fpx-unplaced">
              <h3 className="fpx-section-title">Could not be placed automatically ({planned.unplaced.length})</h3>
              <p className="fpx-muted" style={{ marginTop: 0 }}>
                These openings will be skipped — add them manually after drawing. Reasons: missing wall_side, no matching wall, or no interior walls drawn.
              </p>
              <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
                {planned.unplaced.map((u, idx) => (
                  <li key={idx} className="fpx-muted" style={{ fontSize: 13 }}>
                    {u.row.label || u.category} ({u.row.width_inches}"×{u.row.height_inches}") — {u.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Section 7 — Roof */}
          {(data.roof?.pitch || data.roof?.truss_spacing_inches) && (
            <section className="fpx-section">
              <div className="fpx-row-between">
                <h3 className="fpx-section-title">Roof settings</h3>
                <label className="fpx-toggle">
                  <input type="checkbox" checked={includeRoof} onChange={(e) => setIncludeRoof(e.target.checked)} />
                  Apply to roof
                </label>
              </div>
              <div className="fpx-grid-4">
                <ReadField label="Pitch" value={data.roof?.pitch || '—'} />
                <ReadField label="Truss spacing" value={data.roof?.truss_spacing_inches != null ? `${data.roof.truss_spacing_inches}" o.c.` : '—'} />
              </div>
              <p className="fpx-muted" style={{ fontSize: 12 }}>
                Pitch is applied to existing roof sections (if any). Truss spacing is saved at the project level.
              </p>
            </section>
          )}

          {err && <div className="fpx-error">{err}</div>}
        </div>

        <footer className="fpx-footer">
          <div className="fpx-muted" style={{ fontSize: 12, flex: 1 }}>
            {planned.placed.length} opening{planned.placed.length === 1 ? '' : 's'} will be placed,{' '}
            {planned.unplaced.length} skipped.
          </div>
          <button className="fpx-btn fpx-btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="fpx-btn fpx-btn-primary"
            onClick={apply}
            disabled={busy || (hasExistingContent && !replaceConfirmed)}
          >
            {busy ? 'Drawing…' : 'Draw on Canvas'}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ---- helpers ----
function NumberField({ label, value, onChange }) {
  return (
    <label className="fpx-field">
      <span>{label}</span>
      <input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
function SelectField({ label, value, onChange, options }) {
  return (
    <label className="fpx-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
function ReadField({ label, value }) {
  return (
    <label className="fpx-field">
      <span>{label}</span>
      <div className="fpx-readonly">{value}</div>
    </label>
  );
}

function OpeningTable({ title, rows, keyPrefix, openChecks, toggleOpen, showWallSide }) {
  if (rows.length === 0) return null;
  return (
    <section className="fpx-section">
      <h3 className="fpx-section-title">{title}</h3>
      <table className="fpx-table">
        <thead>
          <tr>
            <th>Label</th><th>Size</th><th>RO</th><th>Type</th><th>Qty</th>
            {showWallSide && <th>Wall</th>}
            <th style={{ width: 60 }}>Use?</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const k = `${keyPrefix}:${i}`;
            return (
              <tr key={i}>
                <td>{r.label || '—'}</td>
                <td>{r.width_inches}" × {r.height_inches}"</td>
                <td>{r.ro_width_inches}" × {r.ro_height_inches}"</td>
                <td>{r.type || '—'}</td>
                <td>{r.quantity || 1}</td>
                {showWallSide && <td>{r.wall_side ? WALL_SIDE_LABELS[r.wall_side] : <span className="fpx-muted">—</span>}</td>}
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={openChecks.has(k)} onChange={() => toggleOpen(k)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function PolygonPreview({ polygon, edgeBySide }) {
  if (!polygon || polygon.length < 3) {
    return <div className="fpx-poly-empty">No polygon</div>;
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const pad = 0.05 * Math.max(w, h);
  const vb = `${minX - pad} ${minY - pad} ${w + 2 * pad} ${h + 2 * pad}`;
  const pts = polygon.map((p) => `${p.x},${p.y}`).join(' ');
  const highlightedEdges = new Set(Object.values(edgeBySide).filter((v) => v >= 0));
  return (
    <svg className="fpx-poly-svg" viewBox={vb} preserveAspectRatio="xMidYMid meet">
      <polygon points={pts} fill="rgba(37,99,235,0.1)" stroke="#2563EB" strokeWidth={Math.max(w, h) * 0.012} strokeLinejoin="miter" />
      {polygon.map((a, i) => {
        const b = polygon[(i + 1) % polygon.length];
        const highlighted = highlightedEdges.has(i);
        return (
          <line key={i}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={highlighted ? '#CC0000' : '#2563EB'}
            strokeWidth={Math.max(w, h) * (highlighted ? 0.018 : 0.012)}
          />
        );
      })}
      {polygon.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={Math.max(w, h) * 0.018} fill="#1D4ED8" />
      ))}
    </svg>
  );
}

const FPX_CSS = `
.fpx-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 1300; padding: 24px;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.fpx-card {
  background: #FFFFFF; border-radius: 12px; max-width: 920px; width: 100%;
  max-height: 90vh; display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.35);
}
.fpx-header {
  padding: 18px 22px; border-bottom: 1px solid #E5E7EB;
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
}
.fpx-title { font-size: 17px; color: #1A1A1A; }
.fpx-sub { font-size: 13px; color: #6B7280; margin-top: 4px; }
.fpx-conf-badge {
  font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 4px;
  text-transform: capitalize; border: 1px solid #E5E7EB; white-space: nowrap;
}
.fpx-notes {
  margin: 0 22px; padding: 12px 14px; background: #F9FAFB;
  border: 1px solid #E5E7EB; border-radius: 8px; font-size: 13px; color: #1F2937;
  line-height: 1.5; margin-top: 14px;
}
.fpx-replace-banner {
  margin: 14px 22px 0; padding: 12px 14px; background: #FEF2F2;
  border: 1px solid #FECACA; border-radius: 8px; font-size: 14px; color: #991B1B;
}
.fpx-replace-check {
  display: flex; align-items: center; gap: 8px; margin-top: 10px;
  font-weight: 600; color: #991B1B;
}
.fpx-body {
  flex: 1; overflow-y: auto; padding: 14px 22px 18px;
}
.fpx-section { margin-top: 18px; }
.fpx-section-title { font-size: 14px; margin: 0 0 10px; color: #111827; }
.fpx-row-between { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.fpx-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.fpx-field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.fpx-field span { font-weight: 600; color: #4B5563; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
.fpx-field input, .fpx-field select {
  font: inherit; font-size: 14px; padding: 7px 10px; border-radius: 6px;
  border: 1px solid #E5E7EB; background: #FFFFFF;
}
.fpx-readonly { font-size: 14px; padding: 7px 10px; background: #F9FAFB; border-radius: 6px; border: 1px solid #E5E7EB; }
.fpx-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.fpx-table th, .fpx-table td { padding: 6px 8px; border-bottom: 1px solid #F3F4F6; text-align: left; }
.fpx-table th { background: #F9FAFB; font-weight: 600; color: #4B5563; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
.fpx-toggle { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #1F2937; }
.fpx-muted { color: #6B7280; }
.fpx-poly-row { display: flex; gap: 18px; align-items: flex-start; }
.fpx-poly-svg { width: 200px; height: 200px; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; }
.fpx-poly-empty { width: 200px; height: 200px; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #9CA3AF; font-size: 13px; }
.fpx-poly-info { flex: 1; font-size: 14px; color: #1F2937; }
.fpx-unplaced { background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px; padding: 12px 16px; }
.fpx-error { margin-top: 14px; padding: 10px 12px; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px; color: #991B1B; font-size: 13px; }
.fpx-footer {
  padding: 14px 22px; border-top: 1px solid #E5E7EB;
  display: flex; align-items: center; gap: 10px;
}
.fpx-btn {
  font: inherit; font-size: 14px; font-weight: 600;
  padding: 9px 18px; border-radius: 6px; cursor: pointer;
  border: 1px solid transparent;
}
.fpx-btn-primary { background: #CC0000; color: #FFFFFF; }
.fpx-btn-primary:hover:not(:disabled) { background: #AA0000; }
.fpx-btn-secondary { background: #FFFFFF; color: #1A1A1A; border-color: #E5E7EB; }
.fpx-btn-secondary:hover:not(:disabled) { background: #F9FAFB; }
.fpx-btn:disabled { opacity: 0.5; cursor: not-allowed; }
`;
