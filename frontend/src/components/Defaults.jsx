import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

const SHEATHING_OPTIONS = [
  { value: '7/16_osb', label: '7/16" OSB' },
  { value: '1/2_osb',  label: '1/2" OSB' },
  { value: '1/2_csp',  label: '1/2" CSP' },
  { value: '5/8_osb',  label: '5/8" OSB' },
];
const ROOF_SHEATHING_OPTIONS = [
  { value: '1/2_csp', label: '1/2" CSP' },
  { value: '5/8_csp', label: '5/8" CSP' },
  { value: '7/16_osb', label: '7/16" OSB' },
];
const SPACING_OPTIONS = [
  { value: '16', label: '16" o.c.' },
  { value: '24', label: '24" o.c.' },
];
const RAFTER_SPACING_OPTIONS = [
  { value: '24_oc', label: '24" o.c.' },
  { value: '16_oc', label: '16" o.c.' },
];
const HEIGHT_OPTIONS = [
  { value: '8',  label: '8 ft' },
  { value: '9',  label: '9 ft' },
  { value: '10', label: '10 ft' },
];
const CORNER_OPTIONS = [
  { value: '3_stud',     label: '3-stud' },
  { value: '2_stud',     label: '2-stud' },
  { value: 'california', label: 'California' },
];
const SILVERBOARD_OPTIONS = [
  { value: 'none',           label: 'None' },
  { value: 'silverboard_1',  label: '1" R5' },
  { value: 'silverboard_15', label: '1.5" R7.5' },
  { value: 'silverboard_2',  label: '2" R10' },
];
const INSULATION_OPTIONS = [
  { value: 'pink_r12_15', label: 'R12-15 Pink', group: 'Pink Fibreglass' },
  { value: 'pink_r12_23', label: 'R12-23 Pink', group: 'Pink Fibreglass' },
  { value: 'pink_r14_15', label: 'R14-15 Pink', group: 'Pink Fibreglass' },
  { value: 'pink_r20_15', label: 'R20-15 Pink', group: 'Pink Fibreglass' },
  { value: 'pink_r20_23', label: 'R20-23 Pink', group: 'Pink Fibreglass' },
  { value: 'pink_r22_15', label: 'R22-15 Pink (49.0 sf)', group: 'Pink Fibreglass' },
  { value: 'pink_r22_23', label: 'R22-23 Pink', group: 'Pink Fibreglass' },
  { value: 'pink_r24_15', label: 'R24-15 Pink', group: 'Pink Fibreglass' },
  { value: 'pink_r28_15', label: 'R28-15 Pink', group: 'Pink Fibreglass' },
  { value: 'pink_r31_24', label: 'R31-24 Pink', group: 'Pink Fibreglass' },
  { value: 'pink_r40_16', label: 'R40-16 Pink', group: 'Pink Fibreglass' },
  { value: 'rockwool_r14_15', label: 'Rockwool R14-15', group: 'Rockwool' },
  { value: 'rockwool_r22_15', label: 'Rockwool R22-15', group: 'Rockwool' },
  { value: 'rockwool_sns_15', label: 'Rockwool Safe-N-Sound', group: 'Rockwool' },
];
const CEILING_DRYWALL_OPTIONS = [
  { value: '41212dw', label: '4 X 12 - 1/2" DRYWALL' },
  { value: '41012dw', label: '4 X 10 - 1/2" DRYWALL' },
];
const EXTERIOR_STUD_OPTIONS = [
  { value: 'exterior_2x6', label: 'Exterior 2x6' },
  { value: 'exterior_2x4', label: 'Exterior 2x4' },
];
const INTERIOR_STUD_OPTIONS = [
  { value: 'interior_2x4', label: 'Interior 2x4' },
  { value: 'interior_2x6', label: 'Interior 2x6' },
];

export default function Defaults() {
  const [unlocked, setUnlocked] = useState(false);
  const [pw, setPw] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [savedKey, setSavedKey] = useState(null);

  async function unlock(e) {
    e.preventDefault();
    setVerifyError('');
    try {
      const res = await api.verifyPassword(pw);
      if (!res.valid) {
        setVerifyError('Incorrect password.');
        return;
      }
      setUnlocked(true);
      const all = await api.getSystemSettings();
      setSettings(all);
    } catch (e) {
      setVerifyError(e.message);
    }
  }

  async function saveKey(key, value) {
    try {
      await api.updateSystemSetting(key, value);
      setSettings((cur) => ({ ...cur, [key]: String(value) }));
      setSavedKey(key);
      setTimeout(() => setSavedKey(null), 1500);
    } catch (e) { setError(e.message); }
  }

  if (!unlocked) {
    return (
      <div>
        <p><Link to="/projects">← All projects</Link></p>
        <h1>Defaults</h1>
        <p className="muted">Editing defaults requires re-entering your password.</p>
        <form onSubmit={unlock} className="card" style={{ maxWidth: 360 }}>
          <label>Password</label>
          <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
          {verifyError && <p className="error">{verifyError}</p>}
          <button type="submit" className="primary" style={{ marginTop: '0.75rem', width: '100%' }}>Unlock</button>
        </form>
      </div>
    );
  }

  if (!settings) return <p className="muted">Loading defaults…</p>;

  function selectField(key, options) {
    return (
      <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        <select
          value={settings[key] ?? ''}
          onChange={(e) => setSettings((cur) => ({ ...cur, [key]: e.target.value }))}
        >
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button className="secondary" type="button" style={{ padding: '0.3rem 0.6rem' }} onClick={() => saveKey(key, settings[key])}>Save</button>
        {savedKey === key && <span className="muted" style={{ color: '#10B981' }}>Saved ✓</span>}
      </div>
    );
  }

  function pctField(key) {
    const num = Number(settings[key]) || 0;
    return (
      <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        <input
          type="number"
          step="0.5"
          style={{ width: '6rem' }}
          value={Math.round(num * 1000) / 10}
          onChange={(e) => setSettings((cur) => ({ ...cur, [key]: String(Number(e.target.value) / 100) }))}
        />
        <span className="muted">%</span>
        <button className="secondary" type="button" style={{ padding: '0.3rem 0.6rem' }} onClick={() => saveKey(key, settings[key])}>Save</button>
        {savedKey === key && <span className="muted" style={{ color: '#10B981' }}>Saved ✓</span>}
      </div>
    );
  }

  function insulationField(key) {
    return (
      <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        <select
          value={settings[key] ?? ''}
          onChange={(e) => setSettings((cur) => ({ ...cur, [key]: e.target.value }))}
        >
          {['Pink Fibreglass', 'Rockwool'].map((g) => (
            <optgroup key={g} label={g}>
              {INSULATION_OPTIONS.filter((o) => o.group === g).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <button className="secondary" type="button" style={{ padding: '0.3rem 0.6rem' }} onClick={() => saveKey(key, settings[key])}>Save</button>
        {savedKey === key && <span className="muted" style={{ color: '#10B981' }}>Saved ✓</span>}
      </div>
    );
  }

  return (
    <div>
      <p><Link to="/projects">← All projects</Link></p>
      <h1>Defaults</h1>
      {error && <p className="error">{error}</p>}

      <h2>Wall defaults</h2>
      <div className="card">
        <Row label="Default exterior stud type">{selectField('default_exterior_stud_type', EXTERIOR_STUD_OPTIONS)}</Row>
        <Row label="Default interior stud type">{selectField('default_interior_stud_type', INTERIOR_STUD_OPTIONS)}</Row>
        <Row label="Default stud spacing">{selectField('default_stud_spacing', SPACING_OPTIONS)}</Row>
        <Row label="Default wall height — Floor 1">{selectField('default_wall_height_floor1', HEIGHT_OPTIONS)}</Row>
        <Row label="Default wall height — Floor 2">{selectField('default_wall_height_floor2', HEIGHT_OPTIONS)}</Row>
        <Row label="Default corner style">{selectField('default_corner_style', CORNER_OPTIONS)}</Row>
      </div>

      <h2>Sheathing &amp; wrap defaults</h2>
      <div className="card">
        <Row label="Default wall sheathing">{selectField('default_wall_sheathing', SHEATHING_OPTIONS)}</Row>
        <Row label="Default roof sheathing">{selectField('default_roof_sheathing', ROOF_SHEATHING_OPTIONS)}</Row>
        <Row label="Default rafter spacing">{selectField('default_rafter_spacing', RAFTER_SPACING_OPTIONS)}</Row>
        <Row label="Default Silverboard">{selectField('default_silverboard', SILVERBOARD_OPTIONS)}</Row>
      </div>

      <h2>Insulation &amp; drywall</h2>
      <div className="card">
        <Row label="Default wall insulation">{insulationField('default_wall_insulation')}</Row>
        <Row label="Default ceiling drywall">{selectField('default_ceiling_drywall', CEILING_DRYWALL_OPTIONS)}</Row>
      </div>

      <h2>Waste factors</h2>
      <div className="card">
        <Row label="Dimensional lumber">{pctField('waste_lumber')}</Row>
        <Row label="Sheet goods (OSB, plywood, drywall)">{pctField('waste_sheet')}</Row>
        <Row label="Roof sheathing">{pctField('waste_roof_sheet')}</Row>
        <Row label="Concrete">{pctField('waste_concrete')}</Row>
        <Row label="Housewrap">{pctField('waste_housewrap')}</Row>
        <Row label="Insulation">{pctField('waste_insulation')}</Row>
      </div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="row" style={{ alignItems: 'center', marginBottom: '0.5rem' }}>
      <div style={{ flex: 1, fontSize: '0.9rem' }}>{label}</div>
      <div style={{ flex: '0 0 auto' }}>{children}</div>
    </div>
  );
}
