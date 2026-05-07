import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', email: '', phone: '', city: '' });
  const navigate = useNavigate();

  async function load() {
    try { setCustomers(await api.listCustomers()); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    try {
      const created = await api.createCustomer(draft);
      setAdding(false);
      setDraft({ name: '', email: '', phone: '', city: '' });
      navigate(`/customers/${created.id}`);
    } catch (e) { setError(e.message); }
  }

  async function remove(id) {
    if (!confirm('Delete this customer?')) return;
    try {
      await api.deleteCustomer(id);
      load();
    } catch (e) { setError(e.message); }
  }

  return (
    <div>
      <div className="row" style={{ alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ flex: 1, margin: 0 }}>Customers</h1>
        <button className="primary" style={{ flex: '0 0 auto' }} onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : '+ New customer'}
        </button>
      </div>

      {adding && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <form onSubmit={create}>
            <div className="row">
              <div style={{ flex: 2 }}>
                <label>Name *</label>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Smith Construction" autoFocus />
              </div>
              <div style={{ flex: 2 }}>
                <label>Email</label>
                <input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="contact@example.com" />
              </div>
              <div>
                <label>Phone</label>
                <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
              </div>
              <div>
                <label>City</label>
                <input value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
              </div>
              <div style={{ flex: '0 0 auto' }}>
                <button className="primary" type="submit">Create</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {customers.length === 0 ? (
        <p className="muted">No customers yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>City</th>
              <th># Projects</th>
              <th>Last project</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/customers/${c.id}`}>{c.name}</Link></td>
                <td>{c.email || <span className="muted">—</span>}</td>
                <td>{c.phone || <span className="muted">—</span>}</td>
                <td>{c.city || <span className="muted">—</span>}</td>
                <td>{c.project_count}</td>
                <td>{c.last_project_at ? new Date(c.last_project_at).toLocaleDateString() : <span className="muted">—</span>}</td>
                <td>
                  <Link to={`/customers/${c.id}`} className="secondary" style={{ marginRight: 6 }}>View</Link>
                  <button className="danger" onClick={() => remove(c.id)} disabled={c.project_count > 0} title={c.project_count > 0 ? 'Cannot delete: customer has projects' : ''}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
