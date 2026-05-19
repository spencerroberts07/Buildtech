import React, { useEffect, useRef, useState } from 'react';
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
const DECK_JOIST_OPTIONS = [
  { value: '2x8',  label: '2x8' },
  { value: '2x10', label: '2x10' },
  { value: '2x12', label: '2x12' },
];
const DECK_POST_OPTIONS = [
  { value: '4x4', label: '4x4' },
  { value: '6x6', label: '6x6' },
  { value: '8x8', label: '8x8' },
];
const DECK_FOOTING_OPTIONS = [
  { value: 'deck_block', label: 'Deck Block' },
  { value: 'sonotube',   label: 'Sonotube + BigFoot' },
  { value: 'poured',     label: 'Poured Concrete 12x12x8' },
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

  function numField(key, step = 0.5, suffix = '') {
    return (
      <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        <input
          type="number"
          step={step}
          style={{ width: '6rem' }}
          value={settings[key] ?? ''}
          onChange={(e) => setSettings((cur) => ({ ...cur, [key]: e.target.value }))}
        />
        {suffix && <span className="muted">{suffix}</span>}
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

      {/* SKU Catalog is the FIRST section because it's the most important
          onboarding step for a new store — every other calculation
          surfaces "TBD" pricing until this Excel import is run.
          TODO: when role-based access lands, a read-only "Last Import"
          view should live somewhere a non-admin can reach (e.g. a small
          mapping-progress chip on the projects list page). */}
      <div className="form-section-band">SKU Catalog</div>
      <SkuCatalogPanel />

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

      <div className="form-section-band">AUTO-calculation waste factors</div>
      <div className="card">
        <Row label="Roof shingles">{pctField('roof_shingles_waste')}</Row>
        <Row label="Siding (field)">{pctField('siding_waste')}</Row>
        <Row label="Siding (gable ends)">{pctField('siding_gable_waste')}</Row>
        <Row label="Floor framing">{pctField('floor_framing_waste')}</Row>
        <Row label="Attic insulation">{pctField('attic_insulation_waste')}</Row>
      </div>

      <div className="form-section-band">Framing nails — LF per box</div>
      <div className="card">
        <p className="muted" style={{ marginTop: 0, fontSize: '0.85rem' }}>
          Adjust to match your yard's actual product coverage. The Framing
          Nails module divides total dimensional-lumber LF by these numbers
          to get box counts.
        </p>
        <Row label='3-1/4" framing nails (LF per box)'>{numField('framing_nails_lf_per_box_3_25', 50, 'LF')}</Row>
        <Row label='2-3/8" framing nails (LF per box)'>{numField('framing_nails_lf_per_box_2_375', 50, 'LF')}</Row>
      </div>

      <div className="form-section-band">Deck defaults</div>
      <div className="card">
        <Row label="Default joist size">{selectField('default_deck_joist_size', DECK_JOIST_OPTIONS)}</Row>
        <Row label="Default post size">{selectField('default_deck_post_size', DECK_POST_OPTIONS)}</Row>
        <Row label="Default footing type">{selectField('default_deck_footing_type', DECK_FOOTING_OPTIONS)}</Row>
        <Row label="Default post spacing">{numField('default_deck_post_spacing_ft', 0.5, 'ft')}</Row>
        <Row label="Deck board waste %">{pctField('deck_waste_decking')}</Row>
        <Row label="Deck framing waste %">{pctField('deck_waste_framing')}</Row>
        <Row label="Deck concrete waste %">{pctField('deck_waste_concrete')}</Row>
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

// ============================================================
// SKU Catalog Excel import panel.
// Three states:
//   A: no preview yet (or after Cancel/Upload-new) → upload dropzone
//   B: preview loaded                              → table + Confirm/Cancel
//   C: import just succeeded                       → success banner,
//                                                    auto-collapses into the
//                                                    "Last Import" card on
//                                                    next mount.
// The Last Import card + mapping progress bar render alongside the
// dropzone whenever there's a prior import on file.
// ============================================================
const STATUS_LABEL = {
  MATCH_NEW:    { label: '🟢 New mapping',    color: '#15803D', bg: '#DCFCE7', border: '#86EFAC' },
  MATCH_UPDATE: { label: '🟡 Update existing', color: '#92400E', bg: '#FEF3C7', border: '#FDE68A' },
  NO_MATCH:     { label: '🔴 No match found', color: '#991B1B', bg: '#FEE2E2', border: '#FCA5A5' },
};

function SkuCatalogPanel() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);     // { rows, summary }
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmResult, setConfirmResult] = useState(null);
  const [latest, setLatest] = useState(null);       // { exists, ...meta }
  const [status, setStatus] = useState(null);       // { total, mapped, unmapped, percent_complete }
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [err, setErr] = useState('');
  const [dragOver, setDragOver] = useState(false);

  async function loadMeta() {
    try {
      const [l, s] = await Promise.all([
        api.getLatestSkuImport().catch(() => ({ exists: false })),
        api.getSkuImportStatus().catch(() => null),
      ]);
      setLatest(l);
      setStatus(s);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { loadMeta(); }, []);

  async function onFileSelected(f) {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) {
      setErr('Please upload an Excel file (.xlsx)');
      return;
    }
    setErr('');
    setFile(f);
    setPreviewing(true);
    setPreview(null);
    setConfirmResult(null);
    try {
      const result = await api.previewSkuImport(f);
      setPreview(result);
    } catch (e) {
      setErr(e.message);
      setFile(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function onConfirm() {
    if (!file) return;
    setConfirming(true);
    setErr('');
    try {
      const res = await api.confirmSkuImport(file);
      setConfirmResult(res);
      setPreview(null);
      setFile(null);
      // Reload the Last Import card + mapping progress now that there's
      // a fresh import on file.
      await loadMeta();
    } catch (e) {
      setErr(e.message);
    } finally {
      setConfirming(false);
    }
  }

  function onCancel() {
    setFile(null);
    setPreview(null);
    setErr('');
  }

  // STATE B — preview loaded
  if (preview) {
    const visibleRows = preview.rows.filter((r) =>
      r.status === 'MATCH_NEW' ||
      r.status === 'MATCH_UPDATE' ||
      (showUnmatched && r.status === 'NO_MATCH')
    );
    const unmatchedCount = preview.summary.unmatched || 0;
    return (
      <div className="card">
        {err && <p className="error">{err}</p>}
        <SummaryBar summary={preview.summary} />
        <div style={{ marginTop: 12, marginBottom: 8, fontSize: '0.85rem', color: '#6B7280' }}>
          Reviewing <strong>{file?.name || 'upload'}</strong> — nothing has been saved yet.
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 480, border: '1px solid #E5E7EB', borderRadius: 6 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead style={{ position: 'sticky', top: 0, background: '#F9FAFB' }}>
              <tr>
                <Th>Sheet</Th>
                <Th>Material</Th>
                <Th>Catalog #</Th>
                <Th>Item #</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid #F3F4F6' }}>
                  <Td>{r.sheet}</Td>
                  <Td>{r.material}</Td>
                  <Td>{r.catalog_number || <span style={{ color: '#9CA3AF' }}>—</span>}</Td>
                  <Td>{r.item_number || <span style={{ color: '#9CA3AF' }}>—</span>}</Td>
                  <Td><StatusBadge status={r.status} /></Td>
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr><Td colSpan={5}><span className="muted">No rows to review.</span></Td></tr>
              )}
            </tbody>
          </table>
        </div>
        {unmatchedCount > 0 && (
          <div style={{ marginTop: 8, fontSize: '0.85rem' }}>
            <button
              type="button"
              className="secondary"
              onClick={() => setShowUnmatched((v) => !v)}
              style={{ padding: '0.3rem 0.6rem' }}
            >
              {showUnmatched
                ? `Hide ${unmatchedCount} unmatched row${unmatchedCount === 1 ? '' : 's'}`
                : `Show ${unmatchedCount} unmatched row${unmatchedCount === 1 ? '' : 's'}`}
            </button>
            <span className="muted" style={{ marginLeft: 8 }}>
              Unmatched rows are rows in your Excel that BuildTek doesn't recognize — these are not written and can be ignored or reviewed.
            </span>
          </div>
        )}
        <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
          <button
            type="button"
            className="primary"
            disabled={confirming || (preview.summary.new + preview.summary.updates === 0)}
            onClick={onConfirm}
          >
            {confirming ? 'Importing…' : 'Confirm Import'}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={onCancel}
            disabled={confirming}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // STATE A + C — dropzone (plus last-import card + progress bar if present)
  return (
    <div className="card">
      {err && <p className="error">{err}</p>}

      {confirmResult && (
        <div style={{
          padding: 12, marginBottom: 16, borderRadius: 6,
          background: '#DCFCE7', border: '1px solid #86EFAC', color: '#15803D',
          fontSize: '0.9rem',
        }}>
          ✓ Import complete — {confirmResult.summary.new} SKUs mapped,
          {' '}{confirmResult.summary.updates} updated
          {confirmResult.summary.unmatched > 0
            ? `, ${confirmResult.summary.unmatched} not matched`
            : ''}.
        </div>
      )}

      <p className="muted" style={{ marginTop: 0 }}>
        Upload your completed onboarding Excel to connect your store's SKUs
        to BuildTek's material calculations.
      </p>

      <Dropzone
        previewing={previewing}
        dragOver={dragOver}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer?.files?.[0];
          if (f) onFileSelected(f);
        }}
        onSelect={onFileSelected}
      />

      <div style={{ marginTop: 10, fontSize: '0.85rem' }}>
        Don't have the template?{' '}
        <a
          href={`${(import.meta.env.VITE_API_BASE || 'http://localhost:4000')}/sku-import/template`}
          target="_blank"
          rel="noreferrer"
        >Download it here</a>
        .
        {/* The template Excel must be uploaded once manually to R2 at
            key 'sku-catalog/templates/BuildTek_SKU_Catalog_Template.xlsx'.
            The /sku-import/template route 302-redirects to that public URL. */}
      </div>

      {latest?.exists && (
        <LastImportCard latest={latest} status={status} />
      )}
    </div>
  );
}

function SummaryBar({ summary }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: '0.85rem', flexWrap: 'wrap' }}>
      <Chip color="#15803D" bg="#DCFCE7" border="#86EFAC">
        {summary.new} new
      </Chip>
      <Chip color="#92400E" bg="#FEF3C7" border="#FDE68A">
        {summary.updates} update{summary.updates === 1 ? '' : 's'}
      </Chip>
      <Chip color="#6B7280" bg="#F3F4F6" border="#E5E7EB">
        {summary.skipped} skipped
      </Chip>
      {summary.unmatched > 0 && (
        <Chip color="#991B1B" bg="#FEE2E2" border="#FCA5A5">
          {summary.unmatched} unmatched
        </Chip>
      )}
    </div>
  );
}

function Chip({ color, bg, border, children }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      color, background: bg, border: `1px solid ${border}`, fontWeight: 600,
    }}>{children}</span>
  );
}

function StatusBadge({ status }) {
  const s = STATUS_LABEL[status] || STATUS_LABEL.NO_MATCH;
  return (
    <span style={{
      display: 'inline-block', padding: '1px 6px', borderRadius: 4,
      fontSize: 11, fontWeight: 600,
      color: s.color, background: s.bg, border: `1px solid ${s.border}`,
      whiteSpace: 'nowrap',
    }}>{s.label}</span>
  );
}

function Th({ children }) {
  return <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>{children}</th>;
}
function Td({ children, colSpan }) {
  return <td colSpan={colSpan} style={{ padding: '6px 10px', verticalAlign: 'top' }}>{children}</td>;
}

function Dropzone({ previewing, dragOver, onDragOver, onDragLeave, onDrop, onSelect }) {
  const inputRef = useRef(null);
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragOver ? '#CC0000' : '#D1D5DB'}`,
        background: dragOver ? '#FEF2F2' : '#F9FAFB',
        borderRadius: 8, padding: 32, textAlign: 'center', cursor: 'pointer',
        transition: 'all 100ms ease',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        style={{ display: 'none' }}
        onChange={(e) => onSelect(e.target.files?.[0])}
      />
      {previewing ? (
        <span className="muted">Parsing Excel…</span>
      ) : (
        <>
          <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 4 }}>
            Drag &amp; drop your Excel here, or click to browse
          </div>
          <div className="muted" style={{ fontSize: '0.85rem' }}>.xlsx only — max 25 MB</div>
        </>
      )}
    </div>
  );
}

function LastImportCard({ latest, status }) {
  return (
    <div style={{
      marginTop: 20, padding: 16, background: '#F9FAFB',
      border: '1px solid #E5E7EB', borderRadius: 6,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Last Import</div>
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 4, fontSize: '0.85rem' }}>
        <div className="muted">Filename:</div>
        <div>{latest.filename}</div>
        <div className="muted">Imported:</div>
        <div>{new Date(latest.imported_at).toLocaleString()}</div>
        <div className="muted">By:</div>
        <div>{latest.imported_by_username || <span className="muted">—</span>}</div>
        <div className="muted">Stats:</div>
        <div>
          Mapped: <strong>{latest.rows_matched}</strong>
          {' · '}Updated: <strong>{latest.rows_updated}</strong>
          {' · '}Skipped: <strong>{latest.rows_skipped}</strong>
          {' · '}Unmatched: <strong>{latest.rows_unmatched}</strong>
        </div>
      </div>
      {latest.download_url && (
        <div style={{ marginTop: 12 }}>
          <a
            href={latest.download_url}
            target="_blank"
            rel="noreferrer"
            className="secondary"
            style={{
              display: 'inline-block', padding: '0.4rem 0.8rem',
              border: '1px solid #D1D5DB', borderRadius: 4,
              textDecoration: 'none', color: '#374151', fontSize: '0.85rem',
            }}
          >Download Excel</a>
        </div>
      )}
      {status && status.total > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 4 }}>
            <span>{status.mapped} of {status.total} materials mapped</span>
            <strong>{status.percent_complete}%</strong>
          </div>
          <div style={{
            height: 8, background: '#E5E7EB', borderRadius: 4, overflow: 'hidden',
          }}>
            <div style={{
              width: `${status.percent_complete}%`, height: '100%',
              background: '#CC0000', transition: 'width 200ms ease',
            }} />
          </div>
        </div>
      )}
    </div>
  );
}
