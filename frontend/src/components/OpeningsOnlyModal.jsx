// Simpler confirmation modal for the "✨ Place Openings" flow.
// The user has already drawn exterior + interior walls manually; this modal
// just shows the AI-extracted door + window schedule and asks them to
// confirm which openings to drop onto the existing walls.
//
// Edge mapping (wall_side → edge_index in the existing polygon) is done
// client-side using the corners loaded by PolygonSketch, then the apply
// endpoint is called with attach_to_existing_walls: true so it doesn't try
// to recreate any walls.

import React, { useMemo, useState } from 'react';
import { api } from '../api.js';

const WALL_SIDE_LABELS = { front: 'Front', back: 'Back', left: 'Left', right: 'Right' };

export default function OpeningsOnlyModal({
  data, projectId, currentFloorLevel,
  existingCorners, existingInteriorWallCount,
  onClose, onApplied, onError,
}) {
  const conf = data.confidence || 'medium';
  const confColor =
    conf === 'high' ? { bg: '#DCFCE7', fg: '#166534', border: '#86EFAC' } :
    conf === 'low'  ? { bg: '#FFEDD5', fg: '#9A3412', border: '#FDBA74' } :
                      { bg: '#FEF9C3', fg: '#854D0E', border: '#FDE68A' };

  const extDoors = data.exterior_doors || [];
  const intDoors = data.interior_doors || [];
  const windows  = data.windows || [];

  const [checks, setChecks] = useState(() => {
    const s = new Set();
    extDoors.forEach((_, i) => s.add(`ext_door:${i}`));
    intDoors.forEach((_, i) => s.add(`int_door:${i}`));
    windows.forEach((_, i) => s.add(`win:${i}`));
    return s;
  });
  const toggle = (k) => setChecks((cur) => {
    const next = new Set(cur);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  // ---- map wall_side → edge_index in the user's existing polygon ----
  const edgeBySide = useMemo(() => {
    const poly = existingCorners || [];
    if (poly.length < 3) return {};
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of poly) {
      const x = Number(p.x), y = Number(p.y);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const TOL = 0.5;
    const candidates = { front: [], back: [], left: [], right: [] };
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const len = Math.hypot(Number(b.x) - Number(a.x), Number(b.y) - Number(a.y));
      const midX = (Number(a.x) + Number(b.x)) / 2;
      const midY = (Number(a.y) + Number(b.y)) / 2;
      const horizontal = Math.abs(Number(b.y) - Number(a.y)) < TOL;
      const vertical   = Math.abs(Number(b.x) - Number(a.x)) < TOL;
      if (horizontal && Math.abs(midY - maxY) < TOL) candidates.front.push({ i, len });
      if (horizontal && Math.abs(midY - minY) < TOL) candidates.back .push({ i, len });
      if (vertical   && Math.abs(midX - minX) < TOL) candidates.left .push({ i, len });
      if (vertical   && Math.abs(midX - maxX) < TOL) candidates.right.push({ i, len });
    }
    const result = { front: -1, back: -1, left: -1, right: -1 };
    for (const side of Object.keys(candidates)) {
      const winners = candidates[side].sort((a, b) => b.len - a.len);
      if (winners.length > 0) result[side] = winners[0].i;
    }
    return result;
  }, [existingCorners]);

  // ---- build the openings list to apply ----
  const planned = useMemo(() => {
    const placed = [];
    const unplaced = [];

    function pushExterior(row, category, idx) {
      const qty = Math.max(1, Math.round(Number(row.quantity) || 1));
      const edge = row.wall_side && edgeBySide[row.wall_side] != null ? edgeBySide[row.wall_side] : -1;
      const ro_w = Number(row.ro_width_inches);
      const ro_h = Number(row.ro_height_inches);
      const baseLabel = row.label || category;
      if (edge < 0 || !Number.isFinite(ro_w) || !Number.isFinite(ro_h)) {
        unplaced.push({ category, idx, row,
          reason: edge < 0 ? 'wall_side unknown or no matching wall' : 'missing RO size' });
        return;
      }
      for (let k = 1; k <= qty; k++) {
        placed.push({
          wall_kind: 'exterior',
          edge_index: edge,
          type: category === 'win' ? 'window' : 'door',
          ro_width: ro_w, ro_height: ro_h,
          position: k / (qty + 1),
          label: qty > 1 ? `${baseLabel}-${k}` : baseLabel,
        });
      }
    }

    function pushInterior(row, idx) {
      const qty = Math.max(1, Math.round(Number(row.quantity) || 1));
      const ro_w = Number(row.ro_width_inches);
      const ro_h = Number(row.ro_height_inches);
      const baseLabel = row.label || `Int Door ${idx + 1}`;
      if ((existingInteriorWallCount || 0) === 0 || !Number.isFinite(ro_w) || !Number.isFinite(ro_h)) {
        unplaced.push({ category: 'int_door', idx, row,
          reason: (existingInteriorWallCount || 0) === 0 ? 'no interior walls drawn' : 'missing RO size' });
        return;
      }
      for (let k = 0; k < qty; k++) {
        const interiorIdx = k % (existingInteriorWallCount || 1);
        placed.push({
          wall_kind: 'interior',
          interior_wall_index: interiorIdx,
          type: 'door',
          ro_width: ro_w, ro_height: ro_h,
          position: 0.5,
          label: qty > 1 ? `${baseLabel}-${k + 1}` : baseLabel,
        });
      }
    }

    extDoors.forEach((row, i) => { if (checks.has(`ext_door:${i}`)) pushExterior(row, 'ext_door', i); });
    windows.forEach((row, i) =>  { if (checks.has(`win:${i}`))      pushExterior(row, 'win', i); });
    intDoors.forEach((row, i) => { if (checks.has(`int_door:${i}`)) pushInterior(row, i); });

    return { placed, unplaced };
  }, [extDoors, intDoors, windows, checks, edgeBySide, existingInteriorWallCount]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function apply() {
    setBusy(true); setErr('');
    try {
      const out = await api.applyFloorPlanExtraction(projectId, {
        floor_level: currentFloorLevel,
        attach_to_existing_walls: true,
        openings: planned.placed,
      });
      if (out?.error) throw new Error(out.error);
      const winCount = planned.placed.filter((o) => o.type === 'window').length;
      const extDoorCount = planned.placed.filter((o) => o.type === 'door' && o.wall_kind === 'exterior').length;
      const intDoorCount = planned.placed.filter((o) => o.type === 'door' && o.wall_kind === 'interior').length;
      const summary = `Placed ${planned.placed.length} opening${planned.placed.length === 1 ? '' : 's'} from PDF: ` +
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

  const winSelected = windows.filter((_, i) => checks.has(`win:${i}`)).reduce((s, w) => s + (Number(w.quantity) || 1), 0);
  const extSelected = extDoors.filter((_, i) => checks.has(`ext_door:${i}`)).reduce((s, d) => s + (Number(d.quantity) || 1), 0);
  const intSelected = intDoors.filter((_, i) => checks.has(`int_door:${i}`)).reduce((s, d) => s + (Number(d.quantity) || 1), 0);

  return (
    <div className="opo-backdrop" role="dialog" aria-modal="true">
      <style>{OPO_CSS}</style>
      <div className="opo-card">
        <header className="opo-header">
          <div>
            <strong className="opo-title">Windows &amp; Doors from PDF</strong>
            <div className="opo-sub">
              Placed onto your existing walls — no walls will be created or moved.
            </div>
          </div>
          <span
            className="opo-conf-badge"
            style={{ background: confColor.bg, color: confColor.fg, borderColor: confColor.border }}
          >{conf} confidence</span>
        </header>

        {data.notes && (
          <div className="opo-notes">
            <strong>AI notes:</strong> {data.notes}
          </div>
        )}

        <div className="opo-body">
          <OpeningTable
            title="Exterior doors"
            rows={extDoors}
            keyPrefix="ext_door"
            checks={checks}
            toggle={toggle}
            showWallSide
          />
          <OpeningTable
            title="Windows"
            rows={windows}
            keyPrefix="win"
            checks={checks}
            toggle={toggle}
            showWallSide
          />
          <OpeningTable
            title="Interior doors"
            rows={intDoors}
            keyPrefix="int_door"
            checks={checks}
            toggle={toggle}
          />

          {planned.unplaced.length > 0 && (
            <section className="opo-section opo-unplaced">
              <h3 className="opo-section-title">Could not be placed automatically ({planned.unplaced.length})</h3>
              <p className="opo-muted" style={{ marginTop: 0 }}>
                These openings will be skipped — wall_side wasn't determined or your sketch is missing the matching wall. Add them manually after applying.
              </p>
              <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
                {planned.unplaced.map((u, idx) => (
                  <li key={idx} className="opo-muted" style={{ fontSize: 13 }}>
                    {u.row.label || u.category} ({u.row.width_inches}"×{u.row.height_inches}") — {u.reason}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {err && <div className="opo-error">{err}</div>}
        </div>

        <footer className="opo-footer">
          <div className="opo-muted" style={{ fontSize: 12, flex: 1 }}>
            {winSelected} window{winSelected === 1 ? '' : 's'}, {extSelected} exterior door{extSelected === 1 ? '' : 's'},
            {' '}{intSelected} interior door{intSelected === 1 ? '' : 's'} will be placed.
            {planned.unplaced.length > 0 && ` ${planned.unplaced.length} skipped.`}
          </div>
          <button className="opo-btn opo-btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="opo-btn opo-btn-primary" onClick={apply} disabled={busy || planned.placed.length === 0}>
            {busy ? 'Placing…' : 'Place on Walls'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function OpeningTable({ title, rows, keyPrefix, checks, toggle, showWallSide }) {
  if (rows.length === 0) return null;
  return (
    <section className="opo-section">
      <h3 className="opo-section-title">{title}</h3>
      <table className="opo-table">
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
                {showWallSide && <td>{r.wall_side ? WALL_SIDE_LABELS[r.wall_side] : <span className="opo-muted">—</span>}</td>}
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={checks.has(k)} onChange={() => toggle(k)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

const OPO_CSS = `
.opo-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 1300; padding: 24px;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}
.opo-card {
  background: #FFFFFF; border-radius: 12px; max-width: 820px; width: 100%;
  max-height: 90vh; display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.35);
}
.opo-header {
  padding: 18px 22px; border-bottom: 1px solid #E5E7EB;
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
}
.opo-title { font-size: 17px; color: #1A1A1A; }
.opo-sub { font-size: 13px; color: #6B7280; margin-top: 4px; }
.opo-conf-badge {
  font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 4px;
  text-transform: capitalize; border: 1px solid #E5E7EB; white-space: nowrap;
}
.opo-notes {
  margin: 14px 22px 0; padding: 10px 14px; background: #F9FAFB;
  border: 1px solid #E5E7EB; border-radius: 8px; font-size: 13px; color: #1F2937;
  line-height: 1.5;
}
.opo-body { flex: 1; overflow-y: auto; padding: 14px 22px 18px; }
.opo-section { margin-top: 18px; }
.opo-section-title { font-size: 14px; margin: 0 0 10px; color: #111827; }
.opo-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.opo-table th, .opo-table td { padding: 6px 8px; border-bottom: 1px solid #F3F4F6; text-align: left; }
.opo-table th { background: #F9FAFB; font-weight: 600; color: #4B5563; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
.opo-muted { color: #6B7280; }
.opo-unplaced { background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px; padding: 12px 16px; }
.opo-error { margin-top: 14px; padding: 10px 12px; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 6px; color: #991B1B; font-size: 13px; }
.opo-footer {
  padding: 14px 22px; border-top: 1px solid #E5E7EB;
  display: flex; align-items: center; gap: 10px;
}
.opo-btn {
  font: inherit; font-size: 14px; font-weight: 600;
  padding: 9px 18px; border-radius: 6px; cursor: pointer;
  border: 1px solid transparent;
}
.opo-btn-primary { background: #CC0000; color: #FFFFFF; }
.opo-btn-primary:hover:not(:disabled) { background: #AA0000; }
.opo-btn-secondary { background: #FFFFFF; color: #1A1A1A; border-color: #E5E7EB; }
.opo-btn-secondary:hover:not(:disabled) { background: #F9FAFB; }
.opo-btn:disabled { opacity: 0.5; cursor: not-allowed; }
`;
