import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import NewProjectModal from './NewProjectModal.jsx';

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const navigate = useNavigate();

  async function load() {
    try { setProjects(await api.listProjects()); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function handleCreate(payload) {
    const created = await api.createProject(payload);
    setShowModal(false);
    navigate(`/projects/${created.id}`);
  }

  async function remove(id) {
    if (!confirm('Delete this project? This removes all measurements.')) return;
    await api.deleteProject(id);
    load();
  }

  return (
    <div>
      <div className="row" style={{ alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ flex: 1, margin: 0 }}>Projects</h1>
        <button className="primary" style={{ flex: '0 0 auto' }} onClick={() => setShowModal(true)}>
          + New project
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {projects.length === 0 ? (
        <p className="muted">No projects yet. Click + New project to get started.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Name</th><th>Customer</th><th>Created by</th><th>Last updated</th><th></th></tr>
          </thead>
          <tbody>
            {projects.map(p => (
              <tr key={p.id}>
                <td>
                  <Link to={`/projects/${p.id}`}>{p.name}</Link>
                  <span className="storey-badge">{Number(p.num_storeys) === 2 ? '2 Storey' : '1 Storey'}</span>
                </td>
                <td>
                  {p.customer_id ? (
                    <Link to={`/customers/${p.customer_id}`}>{p.customer_name || p.customer || ''}</Link>
                  ) : (p.customer || '')}
                </td>
                <td>{p.created_by || '—'}</td>
                <td>{new Date(p.updated_at).toLocaleString()}</td>
                <td><button className="danger" onClick={() => remove(p.id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <NewProjectModal open={showModal} onClose={() => setShowModal(false)} onCreate={handleCreate} />
    </div>
  );
}
