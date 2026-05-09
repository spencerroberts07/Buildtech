import React, { useState } from 'react';
import { api } from '../api.js';

// Modal for sending a quote PDF by email. Used by both QuotePage (single
// quote) and QuotesList (per-row envelope button).
//
// Props:
//   quote: { id, quote_number, customer_email, ... }
//   onClose():           dismiss without sending
//   onSent(recipient):   close + bubble success up so the caller can update
//                        local state (status badge, toast, sent_at)
export default function SendQuoteEmailModal({ quote, onClose, onSent }) {
  const [recipient, setRecipient] = useState(quote?.customer_email || '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e?.preventDefault?.();
    setErr('');
    const trimmed = recipient.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setErr('Please enter a valid email address.');
      return;
    }
    setBusy(true);
    try {
      await api.sendQuoteEmail(quote.id, {
        recipient_email: trimmed,
        message: message.trim() || undefined,
      });
      onSent?.(trimmed);
    } catch (e) {
      setErr(e.message || 'Send failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <h2>Email quote {quote?.quote_number}</h2>
        <form onSubmit={submit}>
          <label>To</label>
          <input
            type="email"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="customer@example.com"
            autoFocus
            required
          />
          <label style={{ marginTop: '0.75rem' }}>Personal note <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder="Anything you'd like to say to the customer alongside the quote…"
            style={{ resize: 'vertical' }}
          />
          {err && <p className="error">{err}</p>}
          <p className="muted" style={{ marginTop: '0.75rem' }}>
            The quote PDF will be attached automatically. The customer-facing template will be used — internal margin data is not included.
          </p>
          <div className="row" style={{ marginTop: '1rem' }}>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Sending…' : 'Send'}
            </button>
            <button type="button" className="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
