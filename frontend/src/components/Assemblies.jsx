import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function Assemblies() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');

  async function load() {
    try { setItems(await api.listAssemblies()); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function remove(id) {
    if (!confirm('Delete this assembly?')) return;
    await api.deleteAssembly(id);
    load();
  }

  return (
    <div>
      <h1>Assemblies</h1>
      <div className="toolbar">
        <Link to="/assemblies/new"><button className="primary">+ New assembly</button></Link>
        <span className="muted">Define what materials are consumed per unit of work (linear foot, square foot, each).</span>
      </div>
      {error && <p className="error">{error}</p>}
      {items.length === 0 ? (
        <p className="muted">No assemblies yet.</p>
      ) : (
        <table>
          <thead><tr><th>Name</th><th>Unit</th><th>Materials</th><th></th></tr></thead>
          <tbody>
            {items.map(a => (
              <tr key={a.id}>
                <td><Link to={`/assemblies/${a.id}`}>{a.name}</Link></td>
                <td>{a.unit}</td>
                <td>{a.items.length}</td>
                <td><button className="danger" onClick={() => remove(a.id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
