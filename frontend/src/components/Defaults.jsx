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
        {savedKey === key && <span className="muted" style={{ color: '#16A34A' }}>Saved ✓</span>}
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
        {savedKey === key && <span className="muted" style={{ color: '#16A34A' }}>Saved ✓</span>}
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
        {savedKey === key && <span className="muted" style={{ color: '#16A34A' }}>Saved ✓</span>}
      </div>
    );
  }

  return (
    <div>
      <p><Link to="/projects">← All projects</Link></p>
      <h1>Defaults</h1>
      {error && <p className="error">{error}</p>}

      <div className="form-section-band">Wall defaults</div>
      <div className="card">
        <Row label="Default exterior stud type">{selectField('default_exterior_stud_type', EXTERIOR_STUD_OPTIONS)}</Row>
        <Row label="Default interior stud type">{selectField('default_interior_stud_type', INTERIOR_STUD_OPTIONS)}</Row>
        <Row label="Default stud spacing">{selectField('default_stud_spacing', SPACING_OPTIONS)}</Row>
        <Row label="Default wall height — Floor 1">{selectField('default_wall_height_floor1', HEIGHT_OPTIONS)}</Row>
        <Row label="Default wall height — Floor 2">{selectField('default_wall_height_floor2', HEIGHT_OPTIONS)}</Row>
        <Row label="Default corner style">{selectField('default_corner_style', CORNER_OPTIONS)}</Row>
      </div>

      <div className="form-section-band">Sheathing &amp; wrap defaults</div>
      <div className="card">
        <Row label="Default wall sheathing">{selectField('default_wall_sheathing', SHEATHING_OPTIONS)}</Row>
        <Row label="Default roof sheathing">{selectField('default_roof_sheathing', ROOF_SHEATHING_OPTIONS)}</Row>
        <Row label="Default rafter spacing">{selectField('default_rafter_spacing', RAFTER_SPACING_OPTIONS)}</Row>
        <Row label="Default Silverboard">{selectField('default_silverboard', SILVERBOARD_OPTIONS)}</Row>
      </div>

      <div className="form-section-band">Insulation &amp; drywall</div>
      <div className="card">
        <Row label="Default wall insulation">{insulationField('default_wall_insulation')}</Row>
        <Row label="Default ceiling drywall">{selectField('default_ceiling_drywall', CEILING_DRYWALL_OPTIONS)}</Row>
      </div>

      <div className="form-section-band">Waste factors</div>
      <div className="card">
        <Row label="Dimensional lumber">{pctField('waste_lumber')}</Row>
        <Row label="Sheet goods (OSB, plywood, drywall)">{pctField('waste_sheet')}</Row>
        <Row label="Roof sheathing">{pctField('waste_roof_sheet')}</Row>
        <Row label="Concrete">{pctField('waste_concrete')}</Row>
        <Row label="Housewrap">{pctField('waste_housewrap')}</Row>
        <Row label="Insulation">{pctField('waste_insulation')}</Row>
      </div>

      <div className="form-section-band">Training data (GPT-4o fine-tuning)</div>
      <TrainingDataPanel />
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

// ============================================================
// Training-data panel — admin-only collector + JSONL exporter for
// fine-tuning GPT-4o on the user's own corrected floor plans.
// ============================================================
function TrainingDataPanel() {
  const [examples, setExamples] = useState(null);
  const [stats, setStats] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);
  const [err, setErr] = useState('');
  const [exporting, setExporting] = useState(false);
  const [editingRating, setEditingRating] = useState(null); // {id, current}

  async function load() {
    try {
      const [ex, st, ai] = await Promise.all([
        api.listTrainingExamples(),
        api.trainingExampleStats(),
        api.aiStatus().catch(() => null),
      ]);
      setExamples(ex);
      setStats(st);
      setAiStatus(ai);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function deleteOne(id) {
    if (!confirm('Delete this training example? This cannot be undone.')) return;
    try { await api.deleteTrainingExample(id); await load(); }
    catch (e) { setErr(e.message); }
  }
  async function rate(id, value) {
    try {
      await api.rateTrainingExample(id, { quality_rating: value });
      setEditingRating(null);
      await load();
    } catch (e) { setErr(e.message); }
  }
  async function doExport() {
    if (!stats || stats.ready_for_export === 0) return;
    setExporting(true);
    setErr('');
    try {
      const { blob, filename } = await api.exportTrainingJsonl();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e.message);
    } finally { setExporting(false); }
  }

  if (err) return <div className="card" style={{ color: '#991B1B' }}>{err}</div>;
  if (!stats || !examples) return <p className="muted">Loading…</p>;

  return (
    <>
      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 12 }}>
          <Stat label="Total examples" value={stats.total_examples} />
          <Stat label="Ready to export" value={stats.ready_for_export} />
          <Stat label="Est. training cost" value={`$${stats.estimated_training_cost_usd.toFixed(2)}`} />
          <Stat label="Unique projects" value={stats.unique_projects} />
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: '#6B7280' }}>
          <span>5★: <strong>{stats.by_quality[5]}</strong></span>
          <span>4★: <strong>{stats.by_quality[4]}</strong></span>
          <span>3★: <strong>{stats.by_quality[3]}</strong></span>
          <span>2★: <strong>{stats.by_quality[2]}</strong></span>
          <span>1★: <strong>{stats.by_quality[1]}</strong></span>
          <span>Unrated: <strong>{stats.by_quality.unrated}</strong></span>
          <span style={{ marginLeft: 'auto' }}>
            Active extractor: <strong>{aiStatus?.active_extractor || 'unknown'}</strong>
            {aiStatus?.fine_tuned_model && <> — <code style={{ fontSize: 11 }}>{aiStatus.fine_tuned_model}</code></>}
          </span>
        </div>
        <div style={{ marginTop: 14 }}>
          <button
            className="primary"
            disabled={exporting || stats.ready_for_export === 0}
            onClick={doExport}
          >
            {exporting
              ? 'Generating JSONL (rendering PDFs)…'
              : `Export for Fine-tuning (${stats.ready_for_export} example${stats.ready_for_export === 1 ? '' : 's'})`}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        {examples.length === 0 ? (
          <p className="muted" style={{ padding: 16, margin: 0 }}>
            No training examples saved yet. Use the "💾 Save Example" button on a floor plan after drawing it to add one.
          </p>
        ) : (
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Project</th>
                <th style={{ textAlign: 'left' }}>Floor</th>
                <th style={{ textAlign: 'left' }}>Date</th>
                <th style={{ textAlign: 'right' }}>Walls</th>
                <th style={{ textAlign: 'right' }}>Openings</th>
                <th style={{ textAlign: 'left' }}>Quality</th>
                <th style={{ textAlign: 'left' }}>Notes</th>
                <th style={{ textAlign: 'right', width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {examples.map((ex) => (
                <tr key={ex.id}>
                  <td>{ex.project_name || <span className="muted">—</span>}</td>
                  <td>{ex.floor_level}</td>
                  <td className="muted">{new Date(ex.created_at).toLocaleDateString()}</td>
                  <td style={{ textAlign: 'right' }}>{ex.wall_count}</td>
                  <td style={{ textAlign: 'right' }}>{ex.opening_count}</td>
                  <td>
                    <RatingStars
                      value={ex.quality_rating}
                      editing={editingRating?.id === ex.id}
                      onOpen={() => setEditingRating({ id: ex.id, current: ex.quality_rating })}
                      onClose={() => setEditingRating(null)}
                      onChange={(v) => rate(ex.id, v)}
                    />
                  </td>
                  <td className="muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ex.notes || ''}>
                    {ex.notes || ''}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      onClick={() => deleteOne(ex.id)}
                      title="Delete"
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14, color: '#6B7280', padding: '2px 6px' }}
                    >🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginTop: 16, background: '#F9FAFB', fontSize: 13 }}>
        <strong>How to fine-tune GPT-4o with this data:</strong>
        <ol style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20, lineHeight: 1.7 }}>
          <li>Click <strong>Export for Fine-tuning</strong> above to download the .jsonl file.</li>
          <li>Go to <a href="https://platform.openai.com/finetune" target="_blank" rel="noreferrer">platform.openai.com → Fine-tuning</a> → Create new.</li>
          <li>Select model: <code>gpt-4o-2024-08-06</code>.</li>
          <li>Upload the .jsonl file.</li>
          <li>Set epochs: <strong>3</strong>, learning rate: <strong>auto</strong>.</li>
          <li>Click <strong>Create</strong> — training takes 1–4 hours.</li>
          <li>Copy the resulting model ID (<code>ft:gpt-4o-...</code>).</li>
          <li>Add to Render env: <code>OPENAI_FINE_TUNED_MODEL=ft:gpt-4o-…</code> and <code>OPENAI_API_KEY=sk-…</code>.</li>
          <li>BuildTek will automatically use your fine-tuned model on the next extraction.</li>
        </ol>
      </div>
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function RatingStars({ value, editing, onOpen, onClose, onChange }) {
  if (!editing) {
    return (
      <button
        type="button"
        onClick={onOpen}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit' }}
      >
        {value
          ? <span style={{ color: '#FFB800', fontSize: 16 }}>{'★'.repeat(value)}<span style={{ color: '#D1D5DB' }}>{'★'.repeat(5 - value)}</span></span>
          : <span className="muted">Unrated</span>}
      </button>
    );
  }
  return (
    <div style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
      {[1,2,3,4,5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: '0 2px', fontSize: 18,
            color: value && n <= value ? '#FFB800' : '#D1D5DB',
          }}
          title={`${n} stars`}
        >★</button>
      ))}
      <button
        type="button"
        onClick={() => onChange(null)}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', marginLeft: 4, fontSize: 11, color: '#6B7280' }}
        title="Clear rating"
      >clear</button>
      <button
        type="button"
        onClick={onClose}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', marginLeft: 4, fontSize: 11, color: '#6B7280' }}
      >×</button>
    </div>
  );
}
