import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

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

const CORNER_OPTIONS = [
  { value: '3_stud', label: '3-stud corner' },
];

export default function Settings() {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    api.getSettings().then(setS).catch((e) => setError(e.message));
  }, []);

  async function update(field, value) {
    const next = { ...s, [field]: value };
    setS(next);
    try {
      const updated = await api.updateSettings({ [field]: value });
      setS(updated);
      setSavedAt(new Date());
    } catch (e) {
      setError(e.message);
    }
  }

  if (!s) return <p className="muted">{error || 'Loading...'}</p>;

  return (
    <div>
      <h1>Global settings</h1>
      <p className="muted">
        These are the takeoff defaults for every project. Project-level and
        per-wall overrides take precedence when computing materials.
      </p>
      <div className="card">
        <div className="row">
          <div>
            <label>Default wall height (ft)</label>
            <input
              type="number"
              step="0.5"
              value={s.default_wall_height ?? ''}
              onChange={(e) => update('default_wall_height', e.target.value)}
            />
          </div>
          <div>
            <label>Default stud spacing (in)</label>
            <input
              type="number"
              step="1"
              value={s.stud_spacing ?? ''}
              onChange={(e) => update('stud_spacing', e.target.value)}
            />
          </div>
        </div>
        <div className="row">
          <div>
            <label>Default exterior sheathing</label>
            <select
              value={s.exterior_sheathing ?? ''}
              onChange={(e) => update('exterior_sheathing', e.target.value)}
            >
              {SHEATHING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Default roof sheathing (stored — not used yet)</label>
            <select
              value={s.roof_sheathing ?? ''}
              onChange={(e) => update('roof_sheathing', e.target.value)}
            >
              {SHEATHING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="row">
          <div>
            <label>Default drywall</label>
            <select
              value={s.drywall ?? ''}
              onChange={(e) => update('drywall', e.target.value)}
            >
              {DRYWALL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Default corner style</label>
            <select
              value={s.corner_style ?? ''}
              onChange={(e) => update('corner_style', e.target.value)}
            >
              {CORNER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
      {savedAt && (
        <p className="muted">Saved at {savedAt.toLocaleTimeString()}.</p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
