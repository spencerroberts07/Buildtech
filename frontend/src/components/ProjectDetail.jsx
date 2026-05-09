import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import Sketch from './Sketch.jsx';
import ProjectSettings from './ProjectSettings.jsx';
import OpeningsTable from './OpeningsTable.jsx';

const CAD_FORMATTER = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
function fmtCad(v) {
  if (v == null) return '—';
  return CAD_FORMATTER.format(Number(v));
}

// Icon-only delete button: muted gray default, BuildTek red on hover.
function TrashButton({ title, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'transparent',
        border: 'none',
        padding: '0.25rem 0.5rem',
        cursor: 'pointer',
        fontSize: '1.1rem',
        lineHeight: 1,
        color: hover ? '#CC0000' : '#6B7280',
      }}
    >🗑</button>
  );
}

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [projectQuotes, setProjectQuotes] = useState([]);
  const [generatingQuote, setGeneratingQuote] = useState(false);
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
  const [showDeleted, setShowDeleted] = useState(false);
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
    try {
      const fn = showDeleted ? api.materialListWithDeleted : api.materialList;
      setMaterialList(await fn(id));
    } catch (e) { setError(e.message); }
  }, [id, showDeleted]);

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
  // Re-fetch material list when the show-deleted toggle changes.
  useEffect(() => { refetchMaterialList(); }, [showDeleted, refetchMaterialList]);

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

  // Helper: empty string for null/undefined/em-dash so Excel doesn't show â€" symbols.
  const csvCell = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (s === '—') return '';
    return s;
  };

  function exportFullCsv() {
    const header = ['Group', 'Section', 'Item#', 'Catalog#', 'Material', 'Unit', 'Total Qty'];
    const rows = materialList
      .filter((r) => !r.deleted)
      .map((r) => [
        csvCell(r.section), csvCell(r.category),
        csvCell(r.item_number), csvCell(r.catalog_number),
        csvCell(r.material_name), csvCell(r.material_unit),
        String(Number(r.total_quantity)),
      ]);
    const csv = [header, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\r\n');
    downloadCsv(csv, `${project.name.replace(/[^a-z0-9-_]+/gi, '_')}_material_list.csv`);
  }

  function exportPosCsv() {
    const groups = new Map();
    for (const r of materialList) {
      if (r.deleted) continue;
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
      .map((r) => [
        csvCell(r.item_number), csvCell(r.catalog_number),
        csvCell(r.description), String(r.total_quantity), csvCell(r.unit),
      ]);
    const header = ['Item#', 'Catalog#', 'Description', 'Total Qty', 'Unit'];
    const csv = [header, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\r\n');
    downloadCsv(csv, `${project.name.replace(/[^a-z0-9-_]+/gi, '_')}_pos_list.csv`);
  }

  function downloadCsv(csv, filename) {
    // Prepend UTF-8 BOM so Excel reads accented chars and em-dashes correctly.
    const withBom = '﻿' + csv;
    const blob = new Blob([withBom], { type: 'text/csv;charset=utf-8' });
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

  const deleteMaterial = useCallback(async (description, section) => {
    try {
      await api.createMaterialDeletion(id, { description, section });
      await refetchMaterialList();
    } catch (e) { setError(e.message); }
  }, [id, refetchMaterialList]);

  const restoreMaterial = useCallback(async (deletionId) => {
    try {
      await api.deleteMaterialDeletion(id, deletionId);
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
      <p className="muted">Created by: {project.created_by || '—'}</p>

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
          className={tab === 'quotes' ? 'tab active' : 'tab'}
          onClick={async () => { setTab('quotes'); try { setProjectQuotes(await api.listProjectQuotes(id)); } catch (e) { setError(e.message); } }}
        >Quotes</button>
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

      {tab === 'quotes' && (
        <div className="card">
          {projectQuotes.length === 0 ? (
            <p className="muted" style={{ marginTop: 0 }}>
              No quotes yet. Click "Generate Quote" below the material list to create one.
            </p>
          ) : (
            <table>
              <thead>
                <tr><th>Quote #</th><th>Status</th><th>Price level</th><th>Total</th><th>Margin %</th><th>Created by</th><th>Date</th><th></th></tr>
              </thead>
              <tbody>
                {projectQuotes.map((q) => (
                  <tr key={q.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/quotes/${q.id}`)}>
                    <td><Link to={`/quotes/${q.id}`}>{q.quote_number}</Link></td>
                    <td>{q.status}</td>
                    <td>L{q.price_level}</td>
                    <td>{fmtCad(q.total)}</td>
                    <td>{q.margin_pct != null ? `${Number(q.margin_pct).toFixed(1)}%` : '—'}</td>
                    <td>{q.created_by || '—'}</td>
                    <td>{new Date(q.created_at).toLocaleDateString()}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <TrashButton
                        title="Delete quote"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!confirm('Delete this quote? This cannot be undone.')) return;
                          const prev = projectQuotes;
                          setProjectQuotes((cur) => cur.filter((x) => x.id !== q.id));
                          try { await api.deleteQuote(q.id); }
                          catch (err) {
                            setProjectQuotes(prev);
                            setError(`Delete failed: ${err.message}`);
                          }
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
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
              <th>Item#</th>
              <th>Catalog#</th>
              <th>Material</th>
              <th>Qty</th>
              <th>Unit</th>
              <th style={{ width: '4rem' }}></th>
            </tr>
          </thead>
          <tbody>
            {renderGroupedMaterialRows(materialList, collapsedSections, toggleSection, {
              skusByDefinition, applyOverride, resetOverride, deleteMaterial, restoreMaterial,
            })}
          </tbody>
        </table>
      )}
      {materialList.length > 0 && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.5rem' }}>
          <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
          <span className="muted">Show deleted items</span>
        </label>
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
        <button
          className="primary"
          disabled={!materialList.length || generatingQuote}
          onClick={async () => {
            setGeneratingQuote(true);
            try {
              const q = await api.generateQuote(id, { price_level: projectSettings?.price_level || 1 });
              window.open(`/quotes/${q.id}`, '_blank');
              try { setProjectQuotes(await api.listProjectQuotes(id)); } catch {}
            } catch (e) {
              setError(e.message);
            } finally {
              setGeneratingQuote(false);
            }
          }}
        >{generatingQuote ? 'Generating…' : 'Generate Quote'}</button>
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
          <span className="section-chevron" style={{ display: 'inline-block', width: '1.2em' }}>
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
            deleteMaterial={opts.deleteMaterial}
            restoreMaterial={opts.restoreMaterial}
          />
        );
      });
    }
  });
  return out;
}

function MaterialRow({ row, sectionLabel, skusByDefinition, applyOverride, resetOverride, deleteMaterial, restoreMaterial }) {
  const [open, setOpen] = useState(false);
  const substitutes = (() => {
    if (!skusByDefinition || !row.definition) return [];
    const list = skusByDefinition.get(row.definition) || [];
    return list.filter((s) => s.description !== row.material_name);
  })();
  const hasGroup = substitutes.length > 0 || row.modified;
  const isPackage = !!row.is_package;
  const isDeleted = !!row.deleted;

  const cellStyle = isDeleted
    ? { textDecoration: 'line-through', color: '#9CA3AF' }
    : undefined;

  return (
    <tr className="material-row">
      <td className="material-row-section-cell" style={cellStyle}>
        {sectionLabel || <span className="muted">—</span>}
      </td>
      <td style={cellStyle}>{row.category || <span className="muted">—</span>}</td>
      <td style={cellStyle}>{row.item_number || <span className="muted">—</span>}</td>
      <td style={cellStyle}>{row.catalog_number || <span className="muted">—</span>}</td>
      <td style={cellStyle}>
        {row.material_name}
        {row.modified && (
          <span
            title={`Substituted from: ${row.original_description}`}
            style={{
              display: 'inline-block', marginLeft: 6,
              width: 8, height: 8, borderRadius: '50%',
              background: '#CC0000', verticalAlign: 'middle',
            }}
          />
        )}
      </td>
      <td style={cellStyle}>{Number(row.total_quantity)}</td>
      <td style={cellStyle}>{row.material_unit}</td>
      <td style={{ position: 'relative', textAlign: 'center', whiteSpace: 'nowrap' }}>
        {isDeleted ? (
          <button
            type="button"
            onClick={() => restoreMaterial?.(row.deletion_id)}
            title="Restore"
            className="secondary"
            style={{ padding: '0.1rem 0.4rem', fontSize: '0.75rem' }}
          >Restore</button>
        ) : (
          <>
            {!isPackage && hasGroup && (
              <>
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  title="Substitute material"
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: '0.1rem 0.25rem', fontSize: '0.85rem', color: '#6B7280',
                  }}
                >▼</button>
                {open && (
                  <div
                    style={{
                      position: 'absolute', right: 0, top: '100%',
                      background: 'white', border: '1px solid #E0E0E0',
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
                          border: 'none', borderBottom: '1px solid #E0E0E0',
                          cursor: 'pointer', fontWeight: 600, color: '#CC0000',
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
                            borderBottom: '1px solid #F0F0F0',
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
            <button
              type="button"
              onClick={() => deleteMaterial?.(row.original_description || row.material_name, row.section)}
              title="Hide this row"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: '0.1rem 0.25rem', fontSize: '0.9rem', color: '#9CA3AF',
                marginLeft: 4,
              }}
            >🗑</button>
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
    try {
      // Blank → 0 means "use auto-calculated area from polygon".
      const sf = draftArea === '' ? 0 : Number(draftArea);
      const created = await api.createFloor(projectId, {
        floor_area_sf: sf,
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
          No floor yet. Click create to start tracking floor materials. Floor area is
          calculated automatically from the exterior polygon, but can be overridden.
        </p>
        <div className="row">
          <div>
            <label>Floor area override (sf, optional)</label>
            <input type="number" value={draftArea} onChange={(e) => setDraftArea(e.target.value)} placeholder="leave blank to use auto" />
          </div>
          <div style={{ flex: '0 0 auto' }}>
            <button className="primary" onClick={createFloor}>Create floor</button>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const autoSf = Number(floor.auto_floor_area_sf) || 0;
  const overrideSf = Number(floor.floor_area_sf) || 0;
  const effectiveSf = overrideSf > 0 ? overrideSf : autoSf;

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: '0.5rem' }}>
        <strong style={{ flex: 1 }}>
          Floor: {effectiveSf.toFixed(0)} sf{overrideSf > 0 ? ' (manual override)' : ' (auto)'} · {SUBFLOOR_OPTIONS.find((o) => o.value === floor.subfloor_type)?.label || floor.subfloor_type}
        </strong>
        <button className="danger" style={{ flex: '0 0 auto', padding: '0.3rem 0.7rem' }} onClick={deleteFloor}>Delete floor</button>
      </div>
      <div className="row">
        <div>
          <label>
            Floor area (auto)
            <span title="Calculated from exterior polygon. Override below if needed." style={{ marginLeft: 4, color: '#9CA3AF', cursor: 'help' }}>ⓘ</span>
          </label>
          <input
            type="number"
            value={autoSf > 0 ? autoSf.toFixed(1) : ''}
            placeholder="(no polygon yet)"
            readOnly
            style={{ background: '#F5F5F5' }}
          />
        </div>
        <div>
          <label>Override area (sf)</label>
          <input
            type="number"
            value={overrideSf > 0 ? overrideSf : ''}
            placeholder="(use auto)"
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
  const [expandedPricing, setExpandedPricing] = useState(() => new Set());

  function togglePricing(pid) {
    setExpandedPricing((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return next;
    });
  }

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

  // Save a numeric pricing field on blur. Empty string clears the field
  // (server stores NULL → quote falls back to "— Quoted Separately —").
  // Skip the patch when the value matches what's already on the row so we
  // don't spam the server every time the user tabs through fields.
  async function patchPkgPrice(p, field, raw) {
    const cur = p[field];
    if (raw === '' || raw == null) {
      if (cur == null) return;
      await patchPkg(p, { [field]: null });
      return;
    }
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    if (cur != null && Number(cur) === v) return;
    await patchPkg(p, { [field]: v });
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
              <th>Pricing</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {packages.map((p) => {
              const isOpen = expandedPricing.has(p.id);
              const hasPricing = [p.cost, p.price1, p.price2, p.price3, p.price4].some((v) => v != null);
              return (
                <React.Fragment key={p.id}>
                  <tr>
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
                    <td>
                      <button
                        className="secondary"
                        style={{ padding: '0.15rem 0.5rem', fontSize: '0.85rem' }}
                        onClick={() => togglePricing(p.id)}
                        title={isOpen ? 'Hide pricing' : 'Edit pricing'}
                      >
                        {isOpen ? '▼' : '▶'} {hasPricing ? `$${Number(p.price1 ?? p.cost ?? 0).toLocaleString()}` : 'Pricing'}
                      </button>
                    </td>
                    <td><button className="danger" onClick={() => deletePkg(p.id)}>Delete</button></td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={6} style={{ background: '#FAFAFA', padding: '0.75rem 1rem' }}>
                        <div className="row" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
                          <div>
                            <label>Our Cost ($)</label>
                            <input
                              type="number"
                              step="0.01"
                              style={{ width: '8rem' }}
                              placeholder="0.00"
                              defaultValue={p.cost ?? ''}
                              onBlur={(e) => patchPkgPrice(p, 'cost', e.target.value)}
                            />
                          </div>
                          <div>
                            <label>Level 1 Retail ($)</label>
                            <input
                              type="number"
                              step="0.01"
                              style={{ width: '8rem' }}
                              placeholder="0.00"
                              defaultValue={p.price1 ?? ''}
                              onBlur={(e) => patchPkgPrice(p, 'price1', e.target.value)}
                            />
                          </div>
                          <div>
                            <label>Level 2 Builder ($)</label>
                            <input
                              type="number"
                              step="0.01"
                              style={{ width: '8rem' }}
                              placeholder="0.00"
                              defaultValue={p.price2 ?? ''}
                              onBlur={(e) => patchPkgPrice(p, 'price2', e.target.value)}
                            />
                          </div>
                          <div>
                            <label>Level 3 Large Builder ($)</label>
                            <input
                              type="number"
                              step="0.01"
                              style={{ width: '8rem' }}
                              placeholder="0.00"
                              defaultValue={p.price3 ?? ''}
                              onBlur={(e) => patchPkgPrice(p, 'price3', e.target.value)}
                            />
                          </div>
                          <div>
                            <label>Level 4 Top Volume ($)</label>
                            <input
                              type="number"
                              step="0.01"
                              style={{ width: '8rem' }}
                              placeholder="0.00"
                              defaultValue={p.price4 ?? ''}
                              onBlur={(e) => patchPkgPrice(p, 'price4', e.target.value)}
                            />
                          </div>
                        </div>
                        <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
                          Leave blank to quote separately. The level matching the quote's price tier is used; if that level is blank, Level 1 is used as a fallback.
                        </p>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
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
