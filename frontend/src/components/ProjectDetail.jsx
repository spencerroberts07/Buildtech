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
      const [p, a, ml, ps, gs, ws, ops, fps] = await Promise.all([
        api.getProject(id),
        api.listAssemblies(),
        api.materialList(id),
        api.getProjectSettings(id),
        api.getSettings(),
        api.listWalls(id),
        api.listOpenings(id),
        api.listFloorPlans(id),
      ]);
      setProject(p);
      setAssemblies(a);
      setMaterialList(ml);
      setProjectSettings(ps);
      setGlobalSettings(gs);
      setWalls(ws);
      setOpenings(ops);
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

  const refetchMaterialList = useCallback(async () => {
    try { setMaterialList(await api.materialList(id)); }
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

  function exportCsv() {
    const header = ['Group', 'Section', 'Material', 'Unit', 'Total quantity (incl. waste)'];
    const rows = materialList.map(r => [
      r.section || '—',
      r.category || '—',
      r.material_name,
      r.material_unit,
      String(Number(r.total_quantity)),
    ]);
    const csv = [header, ...rows].map(r => r.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^a-z0-9-_]+/gi,'_')}_material_list.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printList() { window.print(); }

  if (!project) return <p className="muted">{error || 'Loading...'}</p>;

  return (
    <div>
      <p><Link to="/projects">← All projects</Link></p>
      <h1>{project.name}</h1>
      {project.customer && <p className="muted">Customer: {project.customer}</p>}

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

      <h2>Material list</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Combined rollup of typed measurements and sketched walls.
      </p>
      <div className="toolbar">
        <button className="primary" onClick={exportCsv} disabled={!materialList.length}>Export CSV</button>
        <button className="secondary" onClick={printList} disabled={!materialList.length}>Print</button>
        <span className="muted">Quantities include all per-material waste factors.</span>
      </div>
      {materialList.length === 0 ? (
        <p className="muted">No materials yet. Add measurements or draw walls in the Sketch tab.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Section</th><th>Material</th><th>Quantity</th><th>Unit</th></tr>
          </thead>
          <tbody>
            {renderGroupedMaterialRows(materialList, collapsedSections, toggleSection)}
          </tbody>
        </table>
      )}
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
// inject a clickable group header before each new section. Within a section
// the per-row "Section" column shows the material's category (Bottom Plate,
// Studs, Sheathing, etc.).
function renderGroupedMaterialRows(rows, collapsedSections, toggleSection) {
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
        <td colSpan={4}>
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
          <tr key={`${r.material_id}|${g.section ?? ''}|${r.category ?? ''}|${i}`} className="material-row">
            <td className="material-row-section-cell">
              {r.category || <span className="muted">—</span>}
            </td>
            <td>{r.material_name}</td>
            <td>{Number(r.total_quantity)}</td>
            <td>{r.material_unit}</td>
          </tr>
        );
      });
    }
  });
  return out;
}
