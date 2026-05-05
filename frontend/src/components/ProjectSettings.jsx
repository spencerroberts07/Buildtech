import React from 'react';

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

// `settings` here is the row from /projects/:id/settings.
// `globalSettings` is the row from /settings.
// `onChange(field, value)` fires immediately; the parent debounces / persists.
export default function ProjectSettings({ settings, globalSettings, onChange }) {
  if (!settings || !globalSettings) return null;

  function inheritedLabel(field) {
    const g = globalSettings[field];
    if (g === null || g === undefined) return '(default)';
    return `(default: ${g})`;
  }

  function selectField(field, options) {
    return (
      <select
        value={settings[field] ?? ''}
        onChange={(e) => onChange(field, e.target.value || null)}
      >
        <option value="">{inheritedLabel(field)}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }

  return (
    <div className="card">
      <p className="muted" style={{ marginTop: 0 }}>
        Leave a field blank to inherit the global default. Per-wall overrides
        in the Sketch tab take precedence over project-level settings.
      </p>
      <div className="row">
        <div>
          <label>Wall height (ft)</label>
          <input
            type="number"
            step="0.5"
            value={settings.default_wall_height ?? ''}
            placeholder={inheritedLabel('default_wall_height')}
            onChange={(e) => onChange('default_wall_height', e.target.value === '' ? null : e.target.value)}
          />
        </div>
        <div>
          <label>Stud spacing (in)</label>
          <input
            type="number"
            step="1"
            value={settings.stud_spacing ?? ''}
            placeholder={inheritedLabel('stud_spacing')}
            onChange={(e) => onChange('stud_spacing', e.target.value === '' ? null : e.target.value)}
          />
        </div>
        <div>
          <label>Scale (ft per grid square)</label>
          <input
            type="number"
            step="0.25"
            value={settings.scale_ft_per_grid ?? ''}
            onChange={(e) => onChange('scale_ft_per_grid', e.target.value === '' ? 1 : e.target.value)}
          />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Exterior sheathing</label>
          {selectField('exterior_sheathing', SHEATHING_OPTIONS)}
        </div>
        <div>
          <label>Roof sheathing</label>
          {selectField('roof_sheathing', SHEATHING_OPTIONS)}
        </div>
      </div>
      <div className="row">
        <div>
          <label>Drywall</label>
          {selectField('drywall', DRYWALL_OPTIONS)}
        </div>
        <div>
          <label>Corner style</label>
          {selectField('corner_style', CORNER_OPTIONS)}
        </div>
      </div>
    </div>
  );
}
