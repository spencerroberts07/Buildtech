import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function NewProjectModal({ open, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [customers, setCustomers] = useState([]);
  // customerMode: 'none' | 'existing' | 'new'
  const [customerMode, setCustomerMode] = useState('none');
  const [customerId, setCustomerId] = useState('');
  const [newCustomer, setNewCustomer] = useState({ name: '', email: '', phone: '' });
  const [storeys, setStoreys] = useState(1);
  const [floor1Height, setFloor1Height] = useState(9);
  const [floor2Height, setFloor2Height] = useState(9);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset on open + load customers
  useEffect(() => {
    if (open) {
      setName('');
      setCustomerMode('none');
      setCustomerId('');
      setNewCustomer({ name: '', email: '', phone: '' });
      setStoreys(1);
      setFloor1Height(9); setFloor2Height(9);
      setNotes(''); setError(''); setSubmitting(false);
      api.listCustomers().then(setCustomers).catch(() => {});
    }
  }, [open]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Project name is required.'); return; }
    setSubmitting(true);
    try {
      let resolvedCustomerId = null;
      let resolvedCustomerText = null;
      if (customerMode === 'existing' && customerId) {
        resolvedCustomerId = Number(customerId);
        resolvedCustomerText = customers.find((c) => c.id === Number(customerId))?.name || null;
      } else if (customerMode === 'new') {
        if (!newCustomer.name.trim()) {
          setError('Customer name is required when creating a new customer.');
          setSubmitting(false);
          return;
        }
        const created = await api.createCustomer({
          name: newCustomer.name.trim(),
          email: newCustomer.email.trim() || null,
          phone: newCustomer.phone.trim() || null,
        });
        resolvedCustomerId = created.id;
        resolvedCustomerText = created.name;
      }
      await onCreate({
        name: name.trim(),
        customer: resolvedCustomerText,
        customer_id: resolvedCustomerId,
        notes: notes.trim() || null,
        num_storeys: Number(storeys),
        default_wall_height: Number(floor1Height),
        floor2_wall_height: Number(floor2Height),
      });
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>New project</h2>
        <form onSubmit={submit}>
          <label>Project name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="123 Main St — Smith residence" autoFocus />

          <label>Customer (optional)</label>
          <select value={customerMode} onChange={(e) => setCustomerMode(e.target.value)}>
            <option value="none">— No customer —</option>
            <option value="existing">Select existing customer</option>
            <option value="new">+ New customer</option>
          </select>
          {customerMode === 'existing' && (
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} style={{ marginTop: '0.5rem' }}>
              <option value="">— pick one —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          {customerMode === 'new' && (
            <div className="card" style={{ marginTop: '0.5rem', padding: '0.75rem' }}>
              <div className="row">
                <div style={{ flex: 2 }}>
                  <label>Customer name *</label>
                  <input value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} />
                </div>
                <div style={{ flex: 2 }}>
                  <label>Email</label>
                  <input value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} />
                </div>
                <div>
                  <label>Phone</label>
                  <input value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} />
                </div>
              </div>
            </div>
          )}

          <div className="row">
            <div>
              <label>Number of storeys</label>
              <select value={storeys} onChange={(e) => setStoreys(Number(e.target.value))}>
                <option value={1}>1 Storey</option>
                <option value={2}>2 Storey</option>
              </select>
            </div>
            <div>
              <label>Floor 1 wall height</label>
              <select value={floor1Height} onChange={(e) => setFloor1Height(Number(e.target.value))}>
                <option value={8}>8 ft</option>
                <option value={9}>9 ft</option>
                <option value={10}>10 ft</option>
              </select>
            </div>
            {storeys === 2 && (
              <div>
                <label>Floor 2 wall height</label>
                <select value={floor2Height} onChange={(e) => setFloor2Height(Number(e.target.value))}>
                  <option value={8}>8 ft</option>
                  <option value={9}>9 ft</option>
                  <option value={10}>10 ft</option>
                </select>
              </div>
            )}
          </div>

          <label>Notes (optional)</label>
          <textarea
            value={notes} onChange={(e) => setNotes(e.target.value)}
            rows={3} style={{ resize: 'vertical' }}
          />

          {error && <p className="error">{error}</p>}

          <div className="row" style={{ marginTop: '1rem' }}>
            <button type="button" className="secondary" style={{ flex: 1 }} onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="primary" style={{ flex: 1 }} disabled={submitting}>
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
