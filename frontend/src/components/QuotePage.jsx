import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';

const PRICE_LEVEL_LABELS = {
  1: 'Level 1 — Retail',
  2: 'Level 2 — Builder',
  3: 'Level 3 — Large Builder',
  4: 'Level 4 — Top Volume',
};

function fmtMoney(v) {
  if (v == null) return '—';
  return `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

export default function QuotePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState('');
  const [adjOpen, setAdjOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  async function load() {
    try { setQuote(await api.getQuote(id)); }
    catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [id]);

  if (!quote) return <p className="muted">{error || 'Loading...'}</p>;

  const sections = useMemo(() => groupBySection(quote.line_items || []), [quote]);
  const sectionList = Array.from(sections.keys());

  async function changeStatus(newStatus) {
    try {
      const updated = await api.updateQuote(id, { status: newStatus });
      setQuote(updated);
    } catch (e) { setError(e.message); }
  }

  async function deleteLine(liid) {
    if (!confirm('Remove this line item?')) return;
    try {
      await api.deleteQuoteLineItem(id, liid);
      await load();
    } catch (e) { setError(e.message); }
  }

  async function resetPrices() {
    if (!confirm('Reset all prices to the original price-level values?')) return;
    try {
      const updated = await api.resetQuotePrices(id);
      setQuote(updated);
    } catch (e) { setError(e.message); }
  }

  return (
    <div>
      <p><Link to={`/projects/${quote.project_id}`}>← Back to project</Link></p>

      <div className="row" style={{ alignItems: 'baseline' }}>
        <h1 style={{ margin: 0, flex: 1 }}>{quote.quote_number}</h1>
        <span className="storey-badge" style={{ background: statusBg(quote.status), color: statusText(quote.status) }}>
          {quote.status.toUpperCase()}
        </span>
      </div>

      <p className="muted" style={{ marginTop: '0.25rem' }}>
        Project: <Link to={`/projects/${quote.project_id}`}>{quote.project_name}</Link>
        {quote.customer_name && <> · Customer: {quote.customer_name}</>}
        {' · '}{PRICE_LEVEL_LABELS[quote.price_level] || `Level ${quote.price_level}`}
        {' · '}Created by {quote.created_by || '—'} on {new Date(quote.created_at).toLocaleDateString()}
        {quote.valid_until && <> · Valid until {new Date(quote.valid_until).toLocaleDateString()}</>}
      </p>

      {error && <p className="error">{error}</p>}

      <div className="toolbar" style={{ marginTop: '1rem' }}>
        <button className="primary" disabled>Generate PDF</button>
        <button className="primary" disabled>Send Email</button>
        <button className="secondary" onClick={() => setAddOpen(true)}>+ Add Item</button>
        <button className="secondary" onClick={resetPrices}>Reset to original prices</button>
        <select
          value={quote.status}
          onChange={(e) => changeStatus(e.target.value)}
        >
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="approved">Approved</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      <h2>Line items</h2>
      <table>
        <thead>
          <tr>
            <th>Item#</th>
            <th>Catalog#</th>
            <th>Description</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Unit Price</th>
            <th>Total</th>
            <th>Margin %</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sectionList.map((sec) => (
            <React.Fragment key={sec}>
              <tr className="material-section-header">
                <td colSpan={9}>
                  <span className="section-chevron" style={{ display: 'inline-block', width: '1.2em' }}>▼</span>
                  {sec || 'Other'}
                </td>
              </tr>
              {sections.get(sec).map((li) => (
                <tr key={li.id}>
                  <td>{li.item_number || <span className="muted">—</span>}</td>
                  <td>{li.catalog_number || <span className="muted">—</span>}</td>
                  <td>
                    {li.description}
                    {li.price_overridden && (
                      <span title="Price overridden" style={{ marginLeft: 6, display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#FFB800', verticalAlign: 'middle' }} />
                    )}
                  </td>
                  <td>{Number(li.quantity).toLocaleString()}</td>
                  <td>{li.unit || '—'}</td>
                  <td>
                    {li.is_package ? <span className="muted">— Quoted Separately —</span>
                      : li.unit_price == null ? <span style={{ color: '#9CA3AF' }}>TBD</span>
                      : fmtMoney(li.unit_price)}
                  </td>
                  <td>
                    {li.is_package ? '—'
                      : li.line_price == null ? <span style={{ color: '#9CA3AF' }}>TBD</span>
                      : fmtMoney(li.line_price)}
                  </td>
                  <td style={{ color: marginColor(li.margin_pct), fontWeight: 600 }}>
                    {li.is_package ? '—' : fmtPct(li.margin_pct)}
                  </td>
                  <td>
                    <button
                      className="secondary"
                      style={{ padding: '0.15rem 0.5rem', fontSize: '0.85rem' }}
                      onClick={() => deleteLine(li.id)}
                      title="Remove line item"
                    >🗑</button>
                  </td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>

      <PriceAdjustmentPanel
        quote={quote}
        open={adjOpen}
        onToggle={() => setAdjOpen((v) => !v)}
        sectionList={sectionList}
        onApplied={(updated) => setQuote(updated)}
      />

      <h2>Totals</h2>
      <div className="card">
        <div className="row">
          <div><strong>Subtotal:</strong> {fmtMoney(quote.subtotal)}</div>
          <div><strong>HST {(Number(quote.tax_rate) * 100).toFixed(0)}%:</strong> {fmtMoney(quote.tax_amount)}</div>
          <div style={{ fontSize: '1.1rem' }}><strong>Grand Total: {fmtMoney(quote.total)}</strong></div>
        </div>
      </div>

      <h2>Internal margin summary</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Internal — not shown on customer-facing PDF.
      </p>
      <InternalMarginPanel sections={sections} quote={quote} />

      {addOpen && (
        <AddItemModal
          quoteId={id}
          onClose={() => setAddOpen(false)}
          onAdded={async () => { setAddOpen(false); await load(); }}
        />
      )}
    </div>
  );
}

function groupBySection(items) {
  const m = new Map();
  for (const it of items) {
    const k = it.section || 'Other';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}

function statusBg(s) {
  if (s === 'draft') return '#E0E0E0';
  if (s === 'sent') return '#FFB800';
  if (s === 'approved') return '#16A34A';
  if (s === 'expired') return '#CC0000';
  return '#E0E0E0';
}
function statusText(s) {
  if (s === 'sent') return '#0A0A0A';
  if (s === 'draft') return '#1A1A1A';
  return 'white';
}

// --- Internal margin panel -------------------------------------------------

function InternalMarginPanel({ sections, quote }) {
  const rows = [];
  for (const [name, items] of sections) {
    let revenue = 0, cost = 0;
    for (const li of items) {
      if (li.line_price != null) revenue += Number(li.line_price);
      if (li.line_cost != null) cost += Number(li.line_cost);
    }
    const gp = revenue - cost;
    const mp = revenue > 0 ? (gp / revenue) * 100 : null;
    rows.push({ name, revenue, cost, gp, mp });
  }
  return (
    <div className="card">
      <table>
        <thead>
          <tr><th>Section</th><th>Revenue</th><th>Cost</th><th>Gross Profit</th><th>Margin %</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>{fmtMoney(r.revenue)}</td>
              <td>{fmtMoney(r.cost)}</td>
              <td>{fmtMoney(r.gp)}</td>
              <td style={{ color: marginColor(r.mp), fontWeight: 600 }}>{fmtPct(r.mp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: '1rem', fontSize: '1.15rem' }}>
        <strong>Overall job margin:</strong>{' '}
        <span style={{ color: marginColor(quote.margin_pct), fontWeight: 700 }}>
          {fmtPct(quote.margin_pct)}
        </span>
        {' · '}<strong>Total cost:</strong> {fmtMoney(quote.total_cost)}
        {' · '}<strong>Gross profit:</strong> {fmtMoney(quote.gross_profit)}
      </p>
    </div>
  );
}

// --- Price adjustment panel ------------------------------------------------

function PriceAdjustmentPanel({ quote, open, onToggle, sectionList, onApplied }) {
  const [mode, setMode] = useState('target_margin');
  const [targetMargin, setTargetMargin] = useState(Math.max(0, Math.min(60, Math.round(Number(quote.margin_pct) || 25))));
  const [targetRevenue, setTargetRevenue] = useState(Number(quote.subtotal) || 0);
  const [bulkPct, setBulkPct] = useState(0);
  const [section, setSection] = useState('all');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setTargetMargin(Math.max(0, Math.min(60, Math.round(Number(quote.margin_pct) || 25))));
    setTargetRevenue(Number(quote.subtotal) || 0);
  }, [quote]);

  // Live preview for target_margin
  const preview = useMemo(() => {
    const items = (quote.line_items || []).filter((li) => !li.is_package && li.unit_price != null);
    const inScope = (li) => section === 'all' || li.section === section;
    let newSubtotal = 0;
    let newCost = 0;
    if (mode === 'target_margin') {
      const t = targetMargin;
      for (const li of items) {
        const inS = inScope(li);
        const hasCost = li.unit_cost != null;
        const newUnit = (inS && hasCost) ? Number(li.unit_cost) / (1 - t / 100) : Number(li.unit_price);
        newSubtotal += Number(li.quantity) * newUnit;
        if (hasCost) newCost += Number(li.quantity) * Number(li.unit_cost);
      }
    } else if (mode === 'target_revenue') {
      const curIn = items.filter(inScope).reduce((s, li) => s + Number(li.line_price || 0), 0);
      const curOut = items.filter((li) => !inScope(li)).reduce((s, li) => s + Number(li.line_price || 0), 0);
      const mult = curIn > 0 ? targetRevenue / curIn : 1;
      newSubtotal = targetRevenue + curOut;
      for (const li of items) {
        if (li.unit_cost != null) newCost += Number(li.quantity) * Number(li.unit_cost);
      }
    } else if (mode === 'bulk') {
      const mult = 1 + bulkPct / 100;
      for (const li of items) {
        const newUnit = inScope(li) ? Number(li.unit_price) * mult : Number(li.unit_price);
        newSubtotal += Number(li.quantity) * newUnit;
        if (li.unit_cost != null) newCost += Number(li.quantity) * Number(li.unit_cost);
      }
    }
    const newMargin = newSubtotal > 0 ? ((newSubtotal - newCost) / newSubtotal) * 100 : null;
    const newTotal = newSubtotal * (1 + Number(quote.tax_rate));
    return { newSubtotal, newMargin, newTotal };
  }, [mode, targetMargin, targetRevenue, bulkPct, section, quote]);

  async function apply() {
    setBusy(true); setErr('');
    try {
      const value = mode === 'target_margin' ? targetMargin
        : mode === 'target_revenue' ? targetRevenue
        : bulkPct;
      const updated = await api.adjustQuote(quote.id, { mode, value, section });
      onApplied(updated);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div className="row" style={{ alignItems: 'center' }}>
        <strong style={{ flex: 1 }}>Price Adjustment</strong>
        <button className="secondary" onClick={onToggle}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <>
          <div className="tabs" style={{ marginTop: '0.5rem' }}>
            <button className={mode === 'target_margin' ? 'tab active' : 'tab'} onClick={() => setMode('target_margin')}>Target margin</button>
            <button className={mode === 'target_revenue' ? 'tab active' : 'tab'} onClick={() => setMode('target_revenue')}>Target revenue</button>
            <button className={mode === 'bulk' ? 'tab active' : 'tab'} onClick={() => setMode('bulk')}>Bulk markup/markdown</button>
          </div>

          {mode === 'target_margin' && (
            <div className="row" style={{ marginTop: '0.75rem' }}>
              <div style={{ flex: 2 }}>
                <label>Target margin %</label>
                <input type="range" min="0" max="60" step="0.5" value={targetMargin}
                  onChange={(e) => setTargetMargin(Number(e.target.value))} />
                <div className="muted">{targetMargin}%</div>
              </div>
              <div>
                <label>Or type value</label>
                <input type="number" step="0.5" value={targetMargin}
                  onChange={(e) => setTargetMargin(Number(e.target.value))} />
              </div>
            </div>
          )}

          {mode === 'target_revenue' && (
            <div className="row" style={{ marginTop: '0.75rem' }}>
              <div>
                <label>Target total revenue ($)</label>
                <input type="number" step="0.01" value={targetRevenue}
                  onChange={(e) => setTargetRevenue(Number(e.target.value))} />
                <div className="muted">Current subtotal: {fmtMoney(quote.subtotal)}</div>
              </div>
            </div>
          )}

          {mode === 'bulk' && (
            <div className="row" style={{ marginTop: '0.75rem' }}>
              <div>
                <label>Adjust prices by ±%</label>
                <input type="number" step="0.5" value={bulkPct}
                  onChange={(e) => setBulkPct(Number(e.target.value))} />
              </div>
            </div>
          )}

          <div className="row" style={{ marginTop: '0.75rem' }}>
            <div>
              <label>Apply to section</label>
              <select value={section} onChange={(e) => setSection(e.target.value)}>
                <option value="all">All sections</option>
                {sectionList.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="card" style={{ marginTop: '0.75rem', background: '#F5F5F5' }}>
            <strong>Preview</strong>
            <div className="row">
              <div>Adjusted Subtotal: <strong>{fmtMoney(preview.newSubtotal)}</strong></div>
              <div>Adjusted Total (incl. HST): <strong>{fmtMoney(preview.newTotal)}</strong></div>
              <div>
                Adjusted Margin:{' '}
                <strong style={{ color: marginColor(preview.newMargin) }}>{fmtPct(preview.newMargin)}</strong>
              </div>
            </div>
          </div>

          {err && <p className="error">{err}</p>}
          <div style={{ marginTop: '0.75rem' }}>
            <button className="primary" disabled={busy} onClick={apply}>
              {busy ? 'Applying…' : 'Apply'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// --- Add item modal --------------------------------------------------------

function AddItemModal({ quoteId, onClose, onAdded }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [picked, setPicked] = useState(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const rows = await api.skuSearch(q);
        if (!cancelled) setResults(rows);
      } catch (e) {
        if (!cancelled) setErr(e.message);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  async function add() {
    if (!picked || !(qty > 0)) return;
    setBusy(true); setErr('');
    try {
      await api.addQuoteLineItem(quoteId, {
        item_number: picked.item_number,
        catalog_number: picked.catalog_number,
        description: picked.description,
        quantity: qty,
        unit: picked.unit,
      });
      onAdded();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <h2>Add line item</h2>
        <label>Search SKU catalog (description, item #, or catalog #)</label>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Type at least 2 characters…"
        />
        <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: '0.5rem', border: '1px solid #E0E0E0', borderRadius: 6 }}>
          {results.length === 0 ? (
            <p className="muted" style={{ padding: '0.75rem', margin: 0 }}>
              {q.trim().length < 2 ? 'Type to search…' : 'No matches.'}
            </p>
          ) : (
            <table>
              <thead>
                <tr><th>Item#</th><th>Catalog#</th><th>Description</th><th>Unit</th><th>Price</th></tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr
                    key={r.item_number}
                    style={{ cursor: 'pointer', background: picked?.item_number === r.item_number ? '#FFF0F0' : undefined }}
                    onClick={() => setPicked(r)}
                  >
                    <td>{r.item_number}</td>
                    <td>{r.catalog_number || '—'}</td>
                    <td>{r.description}</td>
                    <td>{r.unit || '—'}</td>
                    <td>{r.price1 != null ? fmtMoney(r.price1) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {picked && (
          <div className="row" style={{ marginTop: '0.75rem' }}>
            <div>
              <label>Selected</label>
              <div>{picked.description}</div>
            </div>
            <div>
              <label>Quantity</label>
              <input type="number" step="0.01" min="0.01" value={qty}
                onChange={(e) => setQty(Number(e.target.value))} />
            </div>
          </div>
        )}
        {err && <p className="error">{err}</p>}
        <div className="row" style={{ marginTop: '1rem' }}>
          <button className="primary" disabled={!picked || busy} onClick={add}>
            {busy ? 'Adding…' : 'Add'}
          </button>
          <button className="secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
