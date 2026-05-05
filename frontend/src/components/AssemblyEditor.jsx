import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../api.js';

const UNITS = ['linear foot', 'square foot', 'cubic foot', 'cubic yard', 'each'];

export default function AssemblyEditor() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const [materials, setMaterials] = useState([]);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('linear foot');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const mats = await api.listMaterials();
        setMaterials(mats);
        if (!isNew) {
          const a = await api.getAssembly(id);
          setName(a.name); setUnit(a.unit); setDescription(a.description || '');
          setItems(a.items.map(it => ({
            material_id: it.material_id,
            quantity_per_unit: it.quantity_per_unit,
            waste_factor: it.waste_factor,
          })));
        }
      } catch (e) { setError(e.message); }
    })();
  }, [id]);

  function addRow() {
    setItems([...items, { material_id: materials[0]?.id || '', quantity_per_unit: 1, waste_factor: 0 }]);
  }
  function updateRow(i, field, value) {
    const next = items.slice();
    next[i] = { ...next[i], [field]: value };
    setItems(next);
  }
  function removeRow(i) {
    setItems(items.filter((_, idx) => idx !== i));
  }

  async function save(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Name required'); return; }
    const payload = {
      name: name.trim(),
      unit,
      description: description.trim() || null,
      items: items
        .filter(it => it.material_id)
        .map(it => ({
          material_id: Number(it.material_id),
          quantity_per_unit: Number(it.quantity_per_unit) || 0,
          waste_factor: Number(it.waste_factor) || 0,
        })),
    };
    try {
      if (isNew) await api.createAssembly(payload);
      else await api.updateAssembly(id, payload);
      navigate('/assemblies');
    } catch (e) { setError(e.message); }
  }

  return (
    <div>
      <p><Link to="/assemblies">← Assemblies</Link></p>
      <h1>{isNew ? 'New assembly' : 'Edit assembly'}</h1>
      <form onSubmit={save}>
        <div className="card">
          <div className="row">
            <div style={{flex:2}}>
              <label>Name</label>
              <input value={name} onChange={e=>setName(e.target.value)} placeholder="Exterior 2x6 wall (9ft)" />
            </div>
            <div>
              <label>Unit</label>
              <select value={unit} onChange={e=>setUnit(e.target.value)}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <label>Description (optional)</label>
          <textarea rows="2" value={description} onChange={e=>setDescription(e.target.value)} />
        </div>

        <div className="card">
          <h3 style={{marginTop:0}}>Materials per unit</h3>
          <p className="muted">Quantity is "how much of this material per 1 {unit} of assembly". Waste is added as a fraction (e.g., 0.10 = 10%).</p>
          <table className="assembly-items">
            <thead>
              <tr><th>Material</th><th style={{width:120}}>Qty per {unit}</th><th style={{width:120}}>Waste factor</th><th></th></tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td>
                    <select value={it.material_id} onChange={e=>updateRow(i, 'material_id', e.target.value)}>
                      <option value="">— pick a material —</option>
                      {materials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
                    </select>
                  </td>
                  <td><input type="number" step="0.0001" value={it.quantity_per_unit} onChange={e=>updateRow(i, 'quantity_per_unit', e.target.value)} /></td>
                  <td><input type="number" step="0.01" value={it.waste_factor} onChange={e=>updateRow(i, 'waste_factor', e.target.value)} /></td>
                  <td><button type="button" className="danger" onClick={()=>removeRow(i)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{marginTop:'0.75rem'}}>
            <button type="button" className="secondary" onClick={addRow}>+ Add material</button>
          </div>
          {materials.length === 0 && (
            <p className="error">No materials in the database yet. Create some on the Materials tab first.</p>
          )}
        </div>

        {error && <p className="error">{error}</p>}
        <div className="toolbar">
          <button className="primary" type="submit">Save assembly</button>
          <Link to="/assemblies"><button type="button" className="secondary">Cancel</button></Link>
        </div>
      </form>
    </div>
  );
}
