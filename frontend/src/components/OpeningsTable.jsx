import React, { useState } from 'react';
import { WINDOW_PRESETS, DOOR_PRESETS, INTERIOR_DOOR_PRESETS } from './Sketch.jsx';

function presetLabel(type, w, h, isInterior) {
  if (type === 'door') {
    if (isInterior) {
      const intHit = INTERIOR_DOOR_PRESETS.find((p) => p.w === Number(w) && p.h === Number(h));
      if (intHit && intHit.label !== 'Custom') return intHit.label;
    }
    const extHit = DOOR_PRESETS.find((p) => p.w === Number(w) && p.h === Number(h));
    if (extHit && extHit.label !== 'Custom') return extHit.label;
    return `${w}" × ${h}"`;
  }
  const winHit = WINDOW_PRESETS.find((p) => p.w === Number(w) && p.h === Number(h));
  return winHit && winHit.label !== 'Custom' ? winHit.label : `${w}" × ${h}"`;
}

export default function OpeningsTable({ openings, walls, floorPlanWalls, floorPlanInteriorWalls }) {
  const [collapsed, setCollapsed] = useState(false);
  if (!openings || openings.length === 0) return null;

  // Build a wall-id → display info map. Floor-plan walls preferred (new flow);
  // legacy walls fall back to wall_id; interior walls have their own table.
  const fpWallById = new Map((floorPlanWalls || []).map((w) => [w.id, w]));
  const intWallById = new Map((floorPlanInteriorWalls || []).map((w) => [w.id, w]));
  const wallById = new Map((walls || []).map((w) => [w.id, w]));

  return (
    <div style={{ marginTop: '1.25rem' }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
        Openings ({openings.length})
        <button className="secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.85rem' }} onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </h2>
      {!collapsed && (
        <table>
          <thead>
            <tr><th>Wall</th><th>Type</th><th>Label</th><th>RO Size</th><th>Swing</th><th>Header</th></tr>
          </thead>
          <tbody>
            {openings.map((o) => {
              let wallLabel;
              const isInterior = o.floor_plan_interior_wall_id != null;
              if (isInterior) {
                const iw = intWallById.get(o.floor_plan_interior_wall_id);
                wallLabel = iw ? `Interior wall #${iw.id} (${iw.wall_type})` : `Interior wall #?`;
              } else if (o.floor_plan_wall_id != null) {
                const fpw = fpWallById.get(o.floor_plan_wall_id);
                wallLabel = fpw ? `Wall #${fpw.wall_index} (${fpw.wall_type})` : `Wall #?`;
              } else {
                const w = wallById.get(o.wall_id);
                wallLabel = w ? `Wall #${o.wall_id} (${w.wall_type})` : `Wall #${o.wall_id}`;
              }
              const sizeLabel = presetLabel(o.type, o.rough_opening_width, o.rough_opening_height, isInterior);
              const typeLabel = isInterior ? 'Interior Door' : (o.type === 'door' ? 'Door' : 'Window');
              const headerLabel = isInterior ? 'Dbl 2x6' : 'Dbl 2x10';
              const swingLabel = isInterior ? (o.swing || 'RHI') : <span className="muted">—</span>;
              return (
                <tr key={o.id}>
                  <td>{wallLabel}</td>
                  <td>{typeLabel}</td>
                  <td>{o.label || <span className="muted">—</span>}</td>
                  <td>{sizeLabel}</td>
                  <td>{swingLabel}</td>
                  <td>{headerLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
