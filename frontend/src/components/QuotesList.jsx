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
      setQuotes(await api.listQuotes(params));
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [statusFilter]);

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
              <th>Date</th>
              <th>Total</th>
              <th>Margin %</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/quotes/${q.id}`)}>
                <td><Link to={`/quotes/${q.id}`}>{q.quote_number}</Link></td>
                <td>{q.project_name}</td>
                <td>{q.customer_name || '—'}</td>
                <td>{q.created_by || '—'}</td>
                <td>{new Date(q.created_at).toLocaleDateString()}</td>
                <td>{q.total != null ? `$${Number(q.total).toFixed(2)}` : '—'}</td>
                <td style={{ color: marginColor(q.margin_pct), fontWeight: 600 }}>
                  {q.margin_pct != null ? `${Number(q.margin_pct).toFixed(1)}%` : '—'}
                </td>
                <td>{q.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
