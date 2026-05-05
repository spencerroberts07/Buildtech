import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const UNITS = ['each', 'sheet', 'pail', 'lb', 'sf', 'lf', 'cf', 'cy', 'box', 'roll', 'gal'];

export default function Materials() {
  const [items, setItems] = useState([]);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('each');
  const [notes, setNotes] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editUnit, setEditUnit] = useState('each');
  const [editNotes, setEditNotes] = useState('');

  async function load() {
    try { setItems(await api.listMaterials()); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.createMaterial({ name: name.trim(), unit, notes: notes.trim() });
      setName(''); setNotes('');
      load();
    } catch (e) { setError(e.message); }
  }

  function startEdit(m) {
    setEditingId(m.id); setEditName(m.name); setEditUnit(m.unit); setEditNotes(m.notes || '');
  }
  function cancelEdit() { setEditingId(null); }
  async function saveEdit(id) {
    try {
      await api.updateMaterial(id, { name: editName, unit: editUnit, notes: editNotes });
      setEditingId(null);
      load();
    } catch (e) { setError(e.message); }
  }
  async function remove(id) {
    if (!confirm('Delete this material?')) return;
    try {
      await api.deleteMaterial(id);
      load();
    } catch (e) { setError(e.message); }
  }

  const filtered = filter
    ? items.filter(m => m.name.toLowerCase().includes(filter.toLowerCase()))
    : items;

  return (
    <div>
      <h1>Materials</h1>
      <p className="muted">Generic items used inside assemblies. Phase 2: link these to your store SKUs.</p>

      <div className="card">
        <h3 style={{marginTop:0}}>Add material</h3>
        <form onSubmit={create}>
          <div className="row">
            <div style={{flex:2}}>
              <label>Name</label>
              <input value={name} onChange={e=>setName(e.target.value)} placeholder="2x6x8 SPF stud" />
            </div>
            <div>
              <label>Unit</label>
              <select value={unit} onChange={e=>setUnit(e.target.value)}>
                {UNITS.map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div style={{flex:2}}>
              <label>Notes (optional)</label>
              <input value={notes} onChange={e=>setNotes(e.target.value)} />
            </div>
            <div style={{flex:'0 0 auto'}}>
              <button className="primary" type="submit">Add</button>
            </div>
          </div>
        </form>
      </div>

      <div className="toolbar">
        <input style={{maxWidth:300}} placeholder="Filter materials..." value={filter} onChange={e=>setFilter(e.target.value)} />
        <span className="muted">{filtered.length} of {items.length}</span>
      </div>

      {error && <p className="error">{error}</p>}
      <table>
        <thead><tr><th>Name</th><th>Unit</th><th>Notes</th><th></th></tr></thead>
        <tbody>
          {filtered.map(m => (
            <tr key={m.id}>
              {editingId === m.id ? (
                <>
                  <td><input value={editName} onChange={e=>setEditName(e.target.value)} /></td>
                  <td>
                    <select value={editUnit} onChange={e=>setEditUnit(e.target.value)}>
                      {UNITS.map(u => <option key={u}>{u}</option>)}
                    </select>
                  </td>
                  <td><input value={editNotes} onChange={e=>setEditNotes(e.target.value)} /></td>
                  <td>
                    <button className="primary" onClick={()=>saveEdit(m.id)}>Save</button>{' '}
                    <button className="secondary" onClick={cancelEdit}>Cancel</button>
                  </td>
                </>
              ) : (
                <>
                  <td>{m.name}</td>
                  <td>{m.unit}</td>
                  <td>{m.notes}</td>
                  <td>
                    <button className="secondary" onClick={()=>startEdit(m)}>Edit</button>{' '}
                    <button className="danger" onClick={()=>remove(m.id)}>Delete</button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
