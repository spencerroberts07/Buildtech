import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      const c = await api.getCustomer(id);
      setCustomer(c);
      setDraft(c);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [id]);

  async function save() {
    try {
      const updated = await api.updateCustomer(id, {
        name: draft.name,
        email: draft.email,
        phone: draft.phone,
        address: draft.address,
        city: draft.city,
        notes: draft.notes,
      });
      setCustomer({ ...customer, ...updated });
      setEditing(false);
    } catch (e) { setError(e.message); }
  }

  async function remove() {
    if (!confirm('Delete this customer?')) return;
    try {
      await api.deleteCustomer(id);
      navigate('/customers');
    } catch (e) { setError(e.message); }
  }

  if (!customer) return <p className="muted">{error || 'Loading…'}</p>;

  return (
    <div>
      <p><Link to="/customers">← All customers</Link></p>
      <div className="row" style={{ alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ flex: 1, margin: 0 }}>{customer.name}</h1>
        {!editing ? (
          <>
            <button className="secondary" style={{ flex: '0 0 auto' }} onClick={() => { setDraft(customer); setEditing(true); }}>Edit</button>
            <button
              className="danger"
              style={{ flex: '0 0 auto' }}
              onClick={remove}
              disabled={(customer.projects?.length || 0) > 0}
              title={(customer.projects?.length || 0) > 0 ? 'Cannot delete: customer has projects' : ''}
            >Delete</button>
          </>
        ) : (
          <>
            <button className="primary" style={{ flex: '0 0 auto' }} onClick={save}>Save</button>
            <button className="secondary" style={{ flex: '0 0 auto' }} onClick={() => { setDraft(customer); setEditing(false); }}>Cancel</button>
          </>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="card">
        {!editing ? (
          <div className="row" style={{ flexWrap: 'wrap', gap: '1rem' }}>
            <Field label="Email" value={customer.email} />
            <Field label="Phone" value={customer.phone} />
            <Field label="Address" value={customer.address} />
            <Field label="City" value={customer.city} />
            <div style={{ flex: '1 1 100%' }}>
              <Field label="Notes" value={customer.notes} multi />
            </div>
          </div>
        ) : (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div style={{ flex: 2 }}>
              <label>Name *</label>
              <input value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div style={{ flex: 2 }}>
              <label>Email</label>
              <input value={draft.email || ''} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            </div>
            <div>
              <label>Phone</label>
              <input value={draft.phone || ''} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            </div>
            <div style={{ flex: 2 }}>
              <label>Address</label>
              <input value={draft.address || ''} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
            </div>
            <div>
              <label>City</label>
              <input value={draft.city || ''} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
            </div>
            <div style={{ flex: '1 1 100%' }}>
              <label>Notes</label>
              <textarea rows={3} value={draft.notes || ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </div>
          </div>
        )}
      </div>

      <h2>Projects ({customer.projects?.length || 0})</h2>
      {(customer.projects?.length || 0) === 0 ? (
        <p className="muted">No projects linked to this customer yet.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Project</th><th>Last updated</th><th>Created</th></tr>
          </thead>
          <tbody>
            {customer.projects.map((p) => (
              <tr key={p.id}>
                <td><Link to={`/projects/${p.id}`}>{p.name}</Link></td>
                <td>{new Date(p.updated_at).toLocaleString()}</td>
                <td>{new Date(p.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Field({ label, value, multi = false }) {
  return (
    <div style={{ flex: 1, minWidth: 180 }}>
      <div className="muted" style={{ fontSize: '0.8rem' }}>{label}</div>
      <div style={{ whiteSpace: multi ? 'pre-wrap' : undefined }}>
        {value || <span className="muted">—</span>}
      </div>
    </div>
  );
}
