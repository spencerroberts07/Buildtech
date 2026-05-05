import React, { useEffect, useState } from 'react';

export default function NewProjectModal({ open, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [customer, setCustomer] = useState('');
  const [storeys, setStoreys] = useState(1);
  const [floor1Height, setFloor1Height] = useState(9);
  const [floor2Height, setFloor2Height] = useState(9);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset on open
  useEffect(() => {
    if (open) {
      setName(''); setCustomer(''); setStoreys(1);
      setFloor1Height(9); setFloor2Height(9);
      setNotes(''); setError(''); setSubmitting(false);
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
      await onCreate({
        name: name.trim(),
        customer: customer.trim() || null,
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
          <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="John Smith" />

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
