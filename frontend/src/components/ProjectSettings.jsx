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

// Mirrors INSULATION_TYPES in backend/src/wallRules.js — kept in sync manually.
const INSULATION_OPTIONS = [
  { value: 'pink_r12_15', label: 'R12-15 FIBREGLASS INSUL.', group: 'Pink Fibreglass' },
  { value: 'pink_r12_23', label: 'R12-23 FIBREGLASS INSUL.', group: 'Pink Fibreglass' },
  { value: 'pink_r14_15', label: 'R14-15 FIBREGLASS INSUL.', group: 'Pink Fibreglass' },
  { value: 'pink_r20_15', label: 'R20-15 FIBREGLASS INSUL.', group: 'Pink Fibreglass' },
  { value: 'pink_r20_23', label: 'R20-23 FIBREGLASS INSUL.', group: 'Pink Fibreglass' },
  { value: 'pink_r22_15', label: 'R22-15 FIBREGLASS INSUL. 49.0 SQ FT', group: 'Pink Fibreglass' },
  { value: 'pink_r22_23', label: 'R22-23 FIBREGLASS INSUL.', group: 'Pink Fibreglass' },
  { value: 'pink_r24_15', label: 'R24-15 FIBREGLASS INSUL.', group: 'Pink Fibreglass' },
  { value: 'pink_r24_23', label: 'R24-23 FIBREGLASS INSUL.', group: 'Pink Fibreglass' },
  { value: 'pink_r28_15', label: 'R28-15 FIBREGLASS INSUL.', group: 'Pink Fibreglass' },
  { value: 'pink_r28_16', label: 'R28-16 FIBREGLASS INSUL.', group: 'Pink Fibreglass' },
  { value: 'pink_r28_19', label: 'R28-19 FIBREGLASS INSUL.', group: 'Pink Fibreglass' },
  { value: 'pink_r28_24', label: 'R28-24 FIBREGLASS INSUL.', group: 'Pink Fibreglass' },
  { value: 'pink_r31_24', label: 'R31-24 FIBREGLASS INSUL.', group: 'Pink Fibreglass' },
  { value: 'pink_r35_16', label: 'R35-16 FIBREGLASS INSUL.', group: 'Pink Fibreglass' },
  { value: 'pink_r40_16', label: 'R40-16 FIBREGLASS INSUL.', group: 'Pink Fibreglass' },
  { value: 'pink_r40_24', label: 'R40-24 FIBREGLASS INSUL.', group: 'Pink Fibreglass' },
  { value: 'rockwool_r14_15', label: 'ROCKWOOL R14-15 COMFORTBATT', group: 'Rockwool' },
  { value: 'rockwool_r14_23', label: 'ROCKWOOL R14-23 COMFORTBATT', group: 'Rockwool' },
  { value: 'rockwool_r22_15', label: 'ROCKWOOL R22-15 COMFORTBATT', group: 'Rockwool' },
  { value: 'rockwool_r22_23', label: 'ROCKWOOL R22-23 COMFORTBATT', group: 'Rockwool' },
  { value: 'rockwool_sns_15', label: 'ROCKWOOL SAFE N SOUND 3X15', group: 'Rockwool' },
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
      <div className="row">
        <div style={{ flex: 2 }}>
          <label>Insulation type</label>
          <select
            value={settings.insulation_type ?? 'pink_r22_15'}
            onChange={(e) => onChange('insulation_type', e.target.value)}
          >
            {['Pink Fibreglass', 'Rockwool'].map((g) => (
              <optgroup key={g} label={g}>
                {INSULATION_OPTIONS.filter((o) => o.group === g).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div style={{ flex: 2 }}>
          <label>Exterior Rigid Insulation (Silverboard)</label>
          <select
            value={settings.silverboard_type ?? 'silverboard_1'}
            onChange={(e) => onChange('silverboard_type', e.target.value)}
          >
            <option value="none">None</option>
            <option value="silverboard_1">SILVERBOARD GRAPHITE 4X8 1" R5</option>
            <option value="silverboard_15">SILVERBOARD GRAPHITE 4X8 1.5" R7.5</option>
            <option value="silverboard_2">SILVERBOARD GRAPHITE 4X8 2" R10</option>
          </select>
        </div>
      </div>
    </div>
  );
}
