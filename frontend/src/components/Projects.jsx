import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [name, setName] = useState('');
  const [customer, setCustomer] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      setProjects(await api.listProjects());
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.createProject({ name: name.trim(), customer: customer.trim() });
      setName(''); setCustomer('');
      load();
    } catch (e) { setError(e.message); }
  }

  async function remove(id) {
    if (!confirm('Delete this project? This removes all measurements.')) return;
    await api.deleteProject(id);
    load();
  }

  return (
    <div>
      <h1>Projects</h1>
      <div className="card">
        <form onSubmit={create}>
          <div className="row">
            <div>
              <label>Project name</label>
              <input value={name} onChange={e=>setName(e.target.value)} placeholder="123 Main St — Smith residence" />
            </div>
            <div>
              <label>Customer (optional)</label>
              <input value={customer} onChange={e=>setCustomer(e.target.value)} placeholder="John Smith" />
            </div>
            <div style={{flex:'0 0 auto'}}>
              <button className="primary" type="submit">Create project</button>
            </div>
          </div>
        </form>
      </div>

      {error && <p className="error">{error}</p>}

      {projects.length === 0 ? (
        <p className="muted">No projects yet. Create your first one above.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Name</th><th>Customer</th><th>Last updated</th><th></th></tr>
          </thead>
          <tbody>
            {projects.map(p => (
              <tr key={p.id}>
                <td><Link to={`/projects/${p.id}`}>{p.name}</Link></td>
                <td>{p.customer || ''}</td>
                <td>{new Date(p.updated_at).toLocaleString()}</td>
                <td><button className="danger" onClick={() => remove(p.id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
