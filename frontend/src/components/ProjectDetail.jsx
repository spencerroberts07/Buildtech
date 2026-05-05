import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';

export default function ProjectDetail() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [assemblies, setAssemblies] = useState([]);
  const [materialList, setMaterialList] = useState([]);
  const [error, setError] = useState('');

  // new measurement form
  const [desc, setDesc] = useState('');
  const [qty, setQty] = useState('');
  const [assemblyId, setAssemblyId] = useState('');

  async function load() {
    try {
      const [p, a, ml] = await Promise.all([
        api.getProject(id),
        api.listAssemblies(),
        api.materialList(id),
      ]);
      setProject(p);
      setAssemblies(a);
      setMaterialList(ml);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [id]);

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
      load();
    } catch (e) { setError(e.message); }
  }

  async function deleteMeasurement(mid) {
    if (!confirm('Delete this measurement?')) return;
    await api.deleteMeasurement(id, mid);
    load();
  }

  function exportCsv() {
    const header = ['Material', 'Unit', 'Total quantity (incl. waste)'];
    const rows = materialList.map(r => [
      r.material_name,
      r.material_unit,
      Number(r.total_quantity).toFixed(3),
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

  function printList() {
    window.print();
  }

  if (!project) return <p className="muted">{error || 'Loading...'}</p>;

  return (
    <div>
      <p><Link to="/projects">← All projects</Link></p>
      <h1>{project.name}</h1>
      {project.customer && <p className="muted">Customer: {project.customer}</p>}

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

      <h2>Material list</h2>
      <div className="toolbar">
        <button className="primary" onClick={exportCsv} disabled={!materialList.length}>Export CSV</button>
        <button className="secondary" onClick={printList} disabled={!materialList.length}>Print</button>
        <span className="muted">Quantities include per-material waste factors from each assembly.</span>
      </div>
      {materialList.length === 0 ? (
        <p className="muted">No materials yet. Add measurements with assemblies to see the rolled-up list.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Material</th><th>Unit</th><th>Total quantity</th></tr>
          </thead>
          <tbody>
            {materialList.map(r => (
              <tr key={r.material_id}>
                <td>{r.material_name}</td>
                <td>{r.material_unit}</td>
                <td>{Number(r.total_quantity).toFixed(2)}</td>
              </tr>
            ))}
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
