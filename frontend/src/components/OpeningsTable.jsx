import React, { useState } from 'react';
import { WINDOW_PRESETS, DOOR_PRESETS } from './Sketch.jsx';

function presetLabel(type, w, h) {
  const list = type === 'door' ? DOOR_PRESETS : WINDOW_PRESETS;
  const m = list.find((p) => p.w === Number(w) && p.h === Number(h));
  return m ? m.label : `${w}" × ${h}"`;
}

export default function OpeningsTable({ openings, walls }) {
  const [collapsed, setCollapsed] = useState(false);
  if (!openings || openings.length === 0) return null;

  const wallById = new Map(walls.map((w) => [w.id, w]));

  return (
    <div style={{ marginTop: '1.25rem' }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
        Openings ({openings.length})
        <button
          className="secondary"
          style={{ padding: '0.2rem 0.6rem', fontSize: '0.85rem' }}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </h2>
      {!collapsed && (
        <table>
          <thead>
            <tr><th>Wall</th><th>Type</th><th>Label</th><th>RO Size</th><th>Header</th></tr>
          </thead>
          <tbody>
            {openings.map((o) => {
              const wall = wallById.get(o.wall_id);
              const sizeLabel = presetLabel(o.type, o.rough_opening_width, o.rough_opening_height);
              return (
                <tr key={o.id}>
                  <td>#{o.wall_id}{wall ? ` (${wall.wall_type})` : ''}</td>
                  <td style={{ textTransform: 'capitalize' }}>{o.type}</td>
                  <td>{o.label || <span className="muted">—</span>}</td>
                  <td>{sizeLabel}</td>
                  <td>Dbl 2x10</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
