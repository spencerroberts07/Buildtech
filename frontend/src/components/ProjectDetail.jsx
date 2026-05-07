import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import Sketch from './Sketch.jsx';
import ProjectSettings from './ProjectSettings.jsx';
import OpeningsTable from './OpeningsTable.jsx';

export default function ProjectDetail() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [assemblies, setAssemblies] = useState([]);
  const [materialList, setMaterialList] = useState([]);
  const [projectSettings, setProjectSettings] = useState(null);
  const [globalSettings, setGlobalSettings] = useState(null);
  const [openings, setOpenings] = useState([]);
  const [walls, setWalls] = useState([]);
  const [floorPlanWalls, setFloorPlanWalls] = useState([]);
  const [packages, setPackages] = useState([]);
  const [floor, setFloor] = useState(null);
  const [skuCatalog, setSkuCatalog] = useState([]);
  const [tab, setTab] = useState('measurements');
  const [error, setError] = useState('');
  // Per-section collapsed state (true = collapsed, false/undefined = expanded)
  const [collapsedSections, setCollapsedSections] = useState({});

  function toggleSection(sec) {
    setCollapsedSections((cur) => ({ ...cur, [sec]: !cur[sec] }));
  }

  // new measurement form
  const [desc, setDesc] = useState('');
  const [qty, setQty] = useState('');
  const [assemblyId, setAssemblyId] = useState('');

  const loadAll = useCallback(async () => {
    try {
      const [p, a, ml, ps, gs, ws, ops, fps, pkgs, fl, skus] = await Promise.all([
        api.getProject(id),
        api.listAssemblies(),
        api.materialList(id),
        api.getProjectSettings(id),
        api.getSettings(),
        api.listWalls(id),
        api.listOpenings(id),
        api.listFloorPlans(id),
        api.listPackages(id),
        api.getFloor(id),
        api.listSkuCatalog(),
      ]);
      setProject(p);
      setAssemblies(a);
      setMaterialList(ml);
      setProjectSettings(ps);
      setGlobalSettings(gs);
      setWalls(ws);
      setOpenings(ops);
      setPackages(pkgs);
      setFloor(fl);
      setSkuCatalog(skus);
      // For now there's just one floor plan per project — fetch its walls for the openings table label
      if (fps && fps[0]) {
        const full = await api.getFloorPlan(id, fps[0].id);
        setFloorPlanWalls(full.walls || []);
        setOpenings(full.openings || ops);
      } else {
        setFloorPlanWalls([]);
      }
    } catch (e) { setError(e.message); }
  }, [id]);

  const refetchPackages = useCallback(async () => {
    try { setPackages(await api.listPackages(id)); }
    catch (e) { setError(e.message); }
  }, [id]);

  const refetchMaterialList = useCallback(async () => {
    try { setMaterialList(await api.materialList(id)); }
    catch (e) { setError(e.message); }
  }, [id]);

  const refetchProjectSettings = useCallback(async () => {
    try { setProjectSettings(await api.getProjectSettings(id)); }
    catch (e) { setError(e.message); }
  }, [id]);

  const refetchOpenings = useCallback(async () => {
    try {
      const fps = await api.listFloorPlans(id);
      if (fps && fps[0]) {
        const full = await api.getFloorPlan(id, fps[0].id);
        setFloorPlanWalls(full.walls || []);
        setOpenings(full.openings || []);
        setWalls(await api.listWalls(id));
      } else {
        const [ops, ws] = await Promise.all([api.listOpenings(id), api.listWalls(id)]);
        setOpenings(ops);
        setWalls(ws);
        setFloorPlanWalls([]);
      }
    } catch (e) { setError(e.message); }
  }, [id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ---- project settings save (debounced) ----
  const settingsTimer = useRef(null);
  const pendingPatch = useRef({});
  const handleProjectSettingsChange = useCallback((patch) => {
    setProjectSettings((cur) => ({ ...cur, ...patch }));
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    clearTimeout(settingsTimer.current);
    settingsTimer.current = setTimeout(async () => {
      const toSend = pendingPatch.current;
      pendingPatch.current = {};
      try {
        await api.updateProjectSettings(id, toSend);
        // If the change affects materials (anything other than viewport), refresh the list
        const viewportOnly =
          Object.keys(toSend).every((k) => k.startsWith('viewport_'));
        if (!viewportOnly) refetchMaterialList();
      } catch (e) { setError(e.message); }
    }, 500);
  }, [id, refetchMaterialList]);

  async function addMeasurement(e) {
    e.preventDefault();
    if (!desc.trim() || !qty) return;
    try {
      await api.addMeasurement(id, {
        description: desc.trim(),
        quantity: Number(qty),
        assembly_id: assemblyId ? Number(assemblyId) : null,
      });
      setDesc(''); setQty(''); setAssemblyId('');
      await loadAll();
    } catch (e) { setError(e.message); }
  }

  async function deleteMeasurement(mid) {
    if (!confirm('Delete this measurement?')) return;
    await api.deleteMeasurement(id, mid);
    await loadAll();
  }

  function exportFullCsv() {
    const header = ['Group', 'Section', 'Catalog#', 'Item#', 'Material', 'Unit', 'Total Qty'];
    const rows = materialList.map(r => [
      r.section || '—',
      r.category || '—',
      r.catalog_number ?? '—',
      r.item_number ?? '—',
      r.material_name,
      r.material_unit,
      String(Number(r.total_quantity)),
    ]);
    const csv = [header, ...rows].map(r => r.map(escapeCsv).join(',')).join('\n');
    downloadCsv(csv, `${project.name.replace(/[^a-z0-9-_]+/gi,'_')}_material_list.csv`);
  }

  function exportPosCsv() {
    // Group by catalog_number; rows without a catalog group by description.
    const groups = new Map();
    for (const r of materialList) {
      const key = r.catalog_number
        ? `cat|${r.catalog_number}`
        : `desc|${(r.material_name || '').trim().toLowerCase()}`;
      const existing = groups.get(key);
      if (existing) {
        existing.total_quantity += Number(r.total_quantity);
      } else {
        groups.set(key, {
          catalog_number: r.catalog_number ?? null,
          item_number: r.item_number ?? null,
          description: r.material_name,
          unit: r.material_unit,
          total_quantity: Number(r.total_quantity),
        });
      }
    }
    const rows = Array.from(groups.values())
      .sort((a, b) => (a.description || '').localeCompare(b.description || ''))
      .map(r => [
        r.catalog_number ?? '—',
        r.item_number ?? '—',
        r.description,
        String(r.total_quantity),
        r.unit,
      ]);
    const header = ['Catalog#', 'Item#', 'Description', 'Total Qty', 'Unit'];
    const csv = [header, ...rows].map(r => r.map(escapeCsv).join(',')).join('\n');
    downloadCsv(csv, `${project.name.replace(/[^a-z0-9-_]+/gi,'_')}_pos_list.csv`);
  }

  function downloadCsv(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printList() { window.print(); }

  // Substitution callbacks for the material list dropdown.
  const applyOverride = useCallback(async (originalDescription, overrideDescription) => {
    try {
      await api.upsertOverride(id, {
        original_description: originalDescription,
        override_description: overrideDescription,
      });
      await refetchMaterialList();
    } catch (e) { setError(e.message); }
  }, [id, refetchMaterialList]);

  const resetOverride = useCallback(async (originalDescription) => {
    try {
      const overrides = await api.listOverrides(id);
      const found = overrides.find(
        (o) => o.original_description.trim().toLowerCase() === originalDescription.trim().toLowerCase()
      );
      if (found) await api.deleteOverride(id, found.id);
      await refetchMaterialList();
    } catch (e) { setError(e.message); }
  }, [id, refetchMaterialList]);

  // Build substitutes map: definition -> array of SKU rows in that group.
  const skusByDefinition = React.useMemo(() => {
    const m = new Map();
    for (const s of skuCatalog) {
      const d = s.definition;
      if (!d) continue;
      if (!m.has(d)) m.set(d, []);
      m.get(d).push(s);
    }
    return m;
  }, [skuCatalog]);

  if (!project) return <p className="muted">{error || 'Loading...'}</p>;

  return (
    <div>
      <p><Link to="/projects">← All projects</Link></p>
      <h1>{project.name}</h1>
      {(project.customer_id || project.customer) && (
        <p className="muted">
          Customer:{' '}
          {project.customer_id ? (
            <Link to={`/customers/${project.customer_id}`}>{project.customer_name || project.customer}</Link>
          ) : project.customer}
        </p>
      )}

      <div className="tabs">
        <button
          className={tab === 'measurements' ? 'tab active' : 'tab'}
          onClick={() => setTab('measurements')}
        >Measurements</button>
        <button
          className={tab === 'sketch' ? 'tab active' : 'tab'}
          onClick={() => setTab('sketch')}
        >Sketch</button>
        <button
          className={tab === 'settings' ? 'tab active' : 'tab'}
          onClick={() => setTab('settings')}
        >Project settings</button>
      </div>

      {tab === 'measurements' && (
        <>
          <h2>Add measurement</h2>
          <div className="card">
            <form onSubmit={addMeasurement}>
              <div className="row">
                <div style={{flex:2}}>
                  <label>Description</label>
                  <input value={desc} onChange={e=>setDesc(e.target.value)} placeholder="First floor exterior walls" />
                </div>
                <div>
                  <label>Quantity</label>
                  <input type="number" step="0.01" value={qty} onChange={e=>setQty(e.target.value)} placeholder="184" />
                </div>
                <div>
                  <label>Assembly</label>
                  <select value={assemblyId} onChange={e=>setAssemblyId(e.target.value)}>
                    <option value="">— none —</option>
                    {assemblies.map(a => (
                      <option key={a.id} value={a.id}>{a.name} ({a.unit})</option>
                    ))}
                  </select>
                </div>
                <div style={{flex:'0 0 auto'}}>
                  <button className="primary" type="submit">Add</button>
                </div>
              </div>
            </form>
          </div>

          <h2>Measurements</h2>
          {project.measurements.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Description</th><th>Quantity</th><th>Assembly</th><th></th></tr>
              </thead>
              <tbody>
                {project.measurements.map(m => (
                  <tr key={m.id}>
                    <td>{m.description}</td>
                    <td>{Number(m.quantity).toLocaleString()} {m.assembly_unit || ''}</td>
                    <td>{m.assembly_name || <span className="muted">—</span>}</td>
                    <td><button className="danger" onClick={() => deleteMeasurement(m.id)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {tab === 'sketch' && projectSettings && (
        <Sketch
          projectId={id}
          projectSettings={projectSettings}
          numStoreys={Number(project.num_storeys) || 1}
          onProjectSettingsChange={handleProjectSettingsChange}
          onMaterialsChanged={refetchMaterialList}
          onOpeningsChanged={refetchOpenings}
          refetchProjectSettings={refetchProjectSettings}
        />
      )}

      {tab === 'settings' && projectSettings && globalSettings && (
        <ProjectSettings
          settings={projectSettings}
          globalSettings={globalSettings}
          onChange={(field, value) => handleProjectSettingsChange({ [field]: value })}
        />
      )}

      <OpeningsTable openings={openings} walls={walls} floorPlanWalls={floorPlanWalls} />

      <h2>Floor</h2>
      <FloorPanel
        projectId={id}
        floor={floor}
        setFloor={setFloor}
        onMaterialsChanged={refetchMaterialList}
        onPackagesChanged={refetchPackages}
      />

      <h2>Material list</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Combined rollup of typed measurements and sketched walls.
      </p>
      {materialList.length === 0 ? (
        <p className="muted">No materials yet. Add measurements or draw walls in the Sketch tab.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Section</th>
              <th>Category</th>
              <th>Catalog#</th>
              <th>Item#</th>
              <th>Material</th>
              <th>Qty</th>
              <th>Unit</th>
              <th style={{ width: '2.5rem' }}></th>
            </tr>
          </thead>
          <tbody>
            {renderGroupedMaterialRows(materialList, collapsedSections, toggleSection, {
              skusByDefinition, applyOverride, resetOverride,
            })}
          </tbody>
        </table>
      )}

      <h2>Packages</h2>
      <PackagesSection
        projectId={id}
        packages={packages}
        onChanged={async () => { await refetchPackages(); await refetchMaterialList(); }}
        onError={setError}
      />

      <div className="toolbar" style={{ marginTop: '1rem' }}>
        <button className="primary" onClick={exportFullCsv} disabled={!materialList.length}>Export Full List</button>
        <button className="primary" onClick={exportPosCsv} disabled={!materialList.length}>Export POS List</button>
        <button className="secondary" onClick={printList} disabled={!materialList.length}>Print</button>
        <span className="muted">Quantities include all per-material waste factors.</span>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function escapeCsv(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Render the material list as collapsible group bands.
// Server already returns rows sorted by section then category, so we just
// inject a clickable group header before each new section.
function renderGroupedMaterialRows(rows, collapsedSections, toggleSection, opts = {}) {
  const { skusByDefinition, applyOverride, resetOverride } = opts;
  // Group rows by section (preserves order)
  const groups = [];
  let cur = null;
  for (const r of rows) {
    const sec = r.section || null;
    if (!cur || cur.section !== sec) {
      cur = { section: sec, rows: [] };
      groups.push(cur);
    }
    cur.rows.push(r);
  }

  const out = [];
  groups.forEach((g, gi) => {
    const label = g.section || 'Other';
    const isCollapsed = !!collapsedSections[label];
    out.push(
      <tr
        key={`hdr|${label}|${gi}`}
        className="material-section-header"
        onClick={() => toggleSection(label)}
        style={{ cursor: 'pointer' }}
      >
        <td colSpan={8}>
          <span style={{ display: 'inline-block', width: '1.2em' }}>
            {isCollapsed ? '▶' : '▼'}
          </span>
          {label}
          <span style={{ marginLeft: '0.6rem', opacity: 0.6, fontWeight: 400, fontSize: '0.85rem' }}>
            ({g.rows.length})
          </span>
        </td>
      </tr>
    );
    if (!isCollapsed) {
      g.rows.forEach((r, i) => {
        out.push(
          <MaterialRow
            key={`${r.material_id}|${g.section ?? ''}|${r.category ?? ''}|${i}`}
            row={r}
            sectionLabel={g.section}
            skusByDefinition={skusByDefinition}
            applyOverride={applyOverride}
            resetOverride={resetOverride}
          />
        );
      });
    }
  });
  return out;
}

function MaterialRow({ row, sectionLabel, skusByDefinition, applyOverride, resetOverride }) {
  const [open, setOpen] = useState(false);
  // Substitutes: SKUs in the same definition group, excluding the current displayed SKU.
  const substitutes = (() => {
    if (!skusByDefinition || !row.definition) return [];
    const list = skusByDefinition.get(row.definition) || [];
    return list.filter((s) => s.description !== row.material_name);
  })();
  const hasGroup = substitutes.length > 0 || row.modified;
  const isPackage = !!row.is_package;

  return (
    <tr className="material-row">
      <td className="material-row-section-cell">
        {sectionLabel || <span className="muted">—</span>}
      </td>
      <td>{row.category || <span className="muted">—</span>}</td>
      <td>{row.catalog_number || <span className="muted">—</span>}</td>
      <td>{row.item_number || <span className="muted">—</span>}</td>
      <td>
        {row.material_name}
        {row.modified && (
          <span
            title={`Substituted from: ${row.original_description}`}
            style={{
              display: 'inline-block', marginLeft: 6,
              width: 8, height: 8, borderRadius: '50%',
              background: '#D97706', verticalAlign: 'middle',
            }}
          />
        )}
      </td>
      <td>{Number(row.total_quantity)}</td>
      <td>{row.material_unit}</td>
      <td style={{ position: 'relative', textAlign: 'center' }}>
        {!isPackage && hasGroup && (
          <>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              title="Substitute material"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: '0.1rem 0.35rem', fontSize: '0.85rem', color: '#6B7280',
              }}
            >▼</button>
            {open && (
              <div
                style={{
                  position: 'absolute', right: 0, top: '100%',
                  background: 'white', border: '1px solid #E5E7EB',
                  borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                  zIndex: 50, minWidth: 280, maxHeight: 320, overflowY: 'auto',
                  textAlign: 'left',
                }}
                onMouseLeave={() => setOpen(false)}
              >
                {row.modified && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      resetOverride(row.original_description);
                    }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '0.5rem 0.75rem', background: 'transparent',
                      border: 'none', borderBottom: '1px solid #E5E7EB',
                      cursor: 'pointer', fontWeight: 600, color: '#B91C1C',
                    }}
                  >Reset to original ({row.original_description})</button>
                )}
                {substitutes.length === 0 ? (
                  <div style={{ padding: '0.5rem 0.75rem', color: '#6B7280' }}>No alternates available.</div>
                ) : (
                  substitutes.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        const original = row.original_description || row.material_name;
                        applyOverride(original, s.description);
                      }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '0.45rem 0.75rem', background: 'transparent',
                        border: 'none', cursor: 'pointer', fontSize: '0.85rem',
                        borderBottom: '1px solid #F3F4F6',
                      }}
                    >
                      <div style={{ fontWeight: 500 }}>{s.description}</div>
                      <div style={{ color: '#6B7280', fontSize: '0.75rem' }}>
                        {s.catalog_number || '—'} · {s.item_number || '—'}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

// ---------- Floor panel ----------
const SUBFLOOR_OPTIONS = [
  { value: '58tgcsp', label: '5/8" T&G CSP Plywood' },
  { value: '34tgcsp', label: '3/4" T&G CSP Plywood' },
];

function FloorPanel({ projectId, floor, setFloor, onMaterialsChanged, onPackagesChanged }) {
  const [draftArea, setDraftArea] = useState('');
  const [error, setError] = useState('');
  const saveTimer = useRef(null);

  async function createFloor() {
    if (!draftArea) return;
    try {
      const created = await api.createFloor(projectId, {
        floor_area_sf: Number(draftArea),
        subfloor_type: '58tgcsp',
      });
      setFloor(created);
      setDraftArea('');
      onMaterialsChanged?.();
      onPackagesChanged?.();
    } catch (e) { setError(e.message); }
  }

  function patchFloor(patch) {
    setFloor((cur) => ({ ...cur, ...patch }));
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const updated = await api.updateFloor(projectId, patch);
        setFloor(updated);
        onMaterialsChanged?.();
      } catch (e) { setError(e.message); }
    }, 400);
  }

  async function deleteFloor() {
    if (!confirm('Delete the floor? This removes subfloor materials from the takeoff.')) return;
    try {
      await api.deleteFloor(projectId);
      setFloor(null);
      onMaterialsChanged?.();
    } catch (e) { setError(e.message); }
  }

  if (!floor) {
    return (
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          No floor yet. Enter the floor area below to add subfloor + adhesive to the takeoff.
        </p>
        <div className="row">
          <div>
            <label>Floor area (sf)</label>
            <input type="number" value={draftArea} onChange={(e) => setDraftArea(e.target.value)} placeholder="720" />
          </div>
          <div style={{ flex: '0 0 auto' }}>
            <button className="primary" onClick={createFloor}>Create floor</button>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: '0.5rem' }}>
        <strong style={{ flex: 1 }}>
          Floor: {Number(floor.floor_area_sf)} sf · {SUBFLOOR_OPTIONS.find((o) => o.value === floor.subfloor_type)?.label || floor.subfloor_type}
        </strong>
        <button className="danger" style={{ flex: '0 0 auto', padding: '0.3rem 0.7rem' }} onClick={deleteFloor}>Delete floor</button>
      </div>
      <div className="row">
        <div>
          <label>Floor area (sf)</label>
          <input
            type="number"
            value={floor.floor_area_sf ?? ''}
            onChange={(e) => patchFloor({ floor_area_sf: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </div>
        <div>
          <label>Subfloor type</label>
          <select
            value={floor.subfloor_type}
            onChange={(e) => patchFloor({ subfloor_type: e.target.value })}
          >
            {SUBFLOOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// ---------- Packages section ----------
const PACKAGE_TYPE_OPTIONS = [
  { value: 'truss',          label: 'Truss Package' },
  { value: 'floor',          label: 'Floor Package' },
  { value: 'window_door',    label: 'Window & Door Package' },
  { value: 'interior_door',  label: 'Interior Door Package' },
  { value: 'railing',        label: 'Railing Package' },
  { value: 'custom',         label: 'Custom' },
];

function PackagesSection({ projectId, packages, onChanged, onError }) {
  const [adding, setAdding] = useState(false);
  const [draftType, setDraftType] = useState('truss');
  const [draftName, setDraftName] = useState('Truss Package');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftQty, setDraftQty] = useState('1');
  const [draftUnit, setDraftUnit] = useState('PKG');

  function changeType(t) {
    setDraftType(t);
    if (t === 'custom') setDraftName('');
    else setDraftName(PACKAGE_TYPE_OPTIONS.find((o) => o.value === t)?.label || '');
  }

  async function submitAdd() {
    if (!draftName.trim()) return;
    try {
      await api.createPackage(projectId, {
        name: draftName.trim(),
        package_type: draftType,
        notes: draftNotes.trim() || null,
        quantity: Number(draftQty) || 1,
        unit: draftUnit.trim() || 'PKG',
      });
      setAdding(false);
      changeType('truss');
      setDraftNotes('');
      setDraftQty('1');
      setDraftUnit('PKG');
      onChanged?.();
    } catch (e) { onError?.(e.message); }
  }

  async function deletePkg(pid) {
    if (!confirm('Delete this package?')) return;
    try {
      await api.deletePackage(projectId, pid);
      onChanged?.();
    } catch (e) { onError?.(e.message); }
  }

  async function patchPkg(p, patch) {
    try {
      await api.updatePackage(projectId, p.id, patch);
      onChanged?.();
    } catch (e) { onError?.(e.message); }
  }

  return (
    <>
      {packages.length === 0 ? (
        <p className="muted">No packages yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Package Name</th>
              <th>Notes</th>
              <th>Qty</th>
              <th>Unit</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {packages.map((p) => (
              <tr key={p.id}>
                <td>
                  <input
                    defaultValue={p.name}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.name) patchPkg(p, { name: v }); }}
                  />
                </td>
                <td>
                  <input
                    defaultValue={p.notes || ''}
                    onBlur={(e) => patchPkg(p, { notes: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    style={{ width: '5rem' }}
                    defaultValue={Number(p.quantity)}
                    onBlur={(e) => { const v = Number(e.target.value); if (!isNaN(v) && v !== Number(p.quantity)) patchPkg(p, { quantity: v }); }}
                  />
                </td>
                <td>
                  <input
                    style={{ width: '5rem' }}
                    defaultValue={p.unit}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.unit) patchPkg(p, { unit: v }); }}
                  />
                </td>
                <td><button className="danger" onClick={() => deletePkg(p.id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!adding ? (
        <button className="primary" style={{ marginTop: '0.5rem' }} onClick={() => setAdding(true)}>+ Add Package</button>
      ) : (
        <div className="card" style={{ marginTop: '0.5rem' }}>
          <div className="row">
            <div>
              <label>Type</label>
              <select value={draftType} onChange={(e) => changeType(e.target.value)}>
                {PACKAGE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div style={{ flex: 2 }}>
              <label>Name</label>
              <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Package name" />
            </div>
            <div style={{ flex: 2 }}>
              <label>Notes</label>
              <input value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} placeholder="Optional notes" />
            </div>
            <div>
              <label>Qty</label>
              <input type="number" style={{ width: '5rem' }} value={draftQty} onChange={(e) => setDraftQty(e.target.value)} />
            </div>
            <div>
              <label>Unit</label>
              <input style={{ width: '5rem' }} value={draftUnit} onChange={(e) => setDraftUnit(e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <button className="primary" onClick={submitAdd}>Add</button>
            <button className="secondary" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
