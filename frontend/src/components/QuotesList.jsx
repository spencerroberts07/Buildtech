import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'approved', label: 'Approved' },
  { value: 'expired', label: 'Expired' },
];

const PRICE_LEVEL_LABELS = {
  1: 'Level 1 — Retail',
  2: 'Level 2 — Builder',
  3: 'Level 3 — Large Builder',
  4: 'Level 4 — Top Volume',
};

const CAD_FORMATTER = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
function fmtMoney(v) {
  if (v == null) return '—';
  return CAD_FORMATTER.format(Number(v));
}
const LONG_DATE = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
function fmtLongDate(d) {
  if (d == null) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : LONG_DATE.format(dt);
}
function fmtPct(v) {
  if (v == null) return '—';
  return `${Number(v).toFixed(1)}%`;
}
function marginColor(pct) {
  if (pct == null) return '#6B7280';
  if (pct >= 20) return '#16A34A';
  if (pct >= 15) return '#FFB800';
  return '#CC0000';
}

export default function QuotesList() {
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [error, setError] = useState('');

  async function load() {
    try {
      const params = statusFilter === 'all' ? {} : { status: statusFilter };
      const rows = await api.listQuotes(params);
      setQuotes(rows);
    } catch (e) { setError(e.message); }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = statusFilter === 'all' ? {} : { status: statusFilter };
        const rows = await api.listQuotes(params);
        if (!cancelled) setQuotes(rows);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [statusFilter]);

  async function removeQuote(q, ev) {
    ev.stopPropagation();
    if (!confirm('Delete this quote? This cannot be undone.')) return;
    // Optimistic: drop the row immediately. On failure, restore + show error.
    const prev = quotes;
    setQuotes((cur) => cur.filter((x) => x.id !== q.id));
    try {
      await api.deleteQuote(q.id);
    } catch (e) {
      setQuotes(prev);
      setError(`Delete failed: ${e.message}`);
    }
  }

  const summary = (() => {
    const count = quotes.length;
    const totalValue = quotes.reduce((s, q) => s + (q.total != null ? Number(q.total) : 0), 0);
    const marginsWithValue = quotes.filter((q) => q.margin_pct != null).map((q) => Number(q.margin_pct));
    const avgMargin = marginsWithValue.length
      ? marginsWithValue.reduce((s, m) => s + m, 0) / marginsWithValue.length
      : null;
    return { count, totalValue, avgMargin };
  })();

  return (
    <div>
      <h1>Quotes</h1>
      <div className="tabs">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            className={statusFilter === t.value ? 'tab active' : 'tab'}
            onClick={() => setStatusFilter(t.value)}
          >{t.label}</button>
        ))}
      </div>

      <div className="card" style={{ display: 'flex', gap: '2rem', marginTop: '0.5rem' }}>
        <div>
          <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total quotes</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 600 }}>{summary.count}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total value</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 600 }}>{fmtMoney(summary.totalValue)}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Average margin</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 600, color: marginColor(summary.avgMargin) }}>
            {fmtPct(summary.avgMargin)}
          </div>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {quotes.length === 0 ? (
        <p className="muted">No quotes match this filter.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Quote #</th>
              <th>Project</th>
              <th>Customer</th>
              <th>Estimator</th>
              <th>Valid Until</th>
              <th>Price Level</th>
              <th>Subtotal</th>
              <th>HST</th>
              <th>Grand Total</th>
              <th>Margin %</th>
              <th>Created</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/quotes/${q.id}`)}>
                <td><Link to={`/quotes/${q.id}`}>{q.quote_number}</Link></td>
                <td>{q.project_name}</td>
                <td>{q.customer_name || '—'}</td>
                <td>{q.created_by || '—'}</td>
                <td>{q.valid_until ? fmtLongDate(q.valid_until) : '—'}</td>
                <td>{PRICE_LEVEL_LABELS[q.price_level] || `Level ${q.price_level}`}</td>
                <td>{fmtMoney(q.subtotal)}</td>
                <td>{fmtMoney(q.tax_amount)}</td>
                <td style={{ fontWeight: 700, color: '#CC0000' }}>{fmtMoney(q.total)}</td>
                <td style={{ color: marginColor(q.margin_pct), fontWeight: 600 }}>{fmtPct(q.margin_pct)}</td>
                <td>{fmtLongDate(q.created_at)}</td>
                <td>{q.status}</td>
                <td>
                  <button
                    className="danger"
                    style={{ padding: '0.2rem 0.55rem', fontSize: '0.85rem' }}
                    title="Delete quote"
                    onClick={(e) => removeQuote(q, e)}
                  >Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
