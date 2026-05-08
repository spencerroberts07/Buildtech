// Quote PDF generation. Renders an HTML template with puppeteer-core +
// @sparticuz/chromium so it works on Render's container env.
//
// Logo source priority:
//   1. process.env.STORE_LOGO_BASE64 — used directly as a data URI
//   2. backend/assets/lyndhurst-logo.jpg — read from disk, base64-encoded
//   3. Neither set → store name renders as plain text (no <img>)
//
// Local dev: puppeteer-core has no bundled Chrome. Set
//   CHROME_EXECUTABLE_PATH=/path/to/chrome
// to override the @sparticuz/chromium binary path. On Render the bundled
// binary works as-is.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.resolve(__dirname, '../assets/lyndhurst-logo.jpg');

const STORE = {
  name: 'Lyndhurst Home Building Centre',
  address: '397 Lyndhurst Rd, Lyndhurst ON, K0E 1N0',
  phone: '613-928-2828',
  email: 'admin@lyndhursthbc.com',
  disclaimer:
    'This estimate is provided for budgetary purposes only. Prices are valid for 30 days from the date of issue and are subject to change without notice. Lyndhurst Home Building Centre does not guarantee the completeness or accuracy of this material list. The builder and/or owner are solely responsible for verifying all quantities, specifications, and compliance with applicable building codes prior to ordering.',
};

// --- Logo loading ---------------------------------------------------------

function getLogoHtml() {
  if (process.env.STORE_LOGO_BASE64) {
    return `<img src="data:image/jpeg;base64,${process.env.STORE_LOGO_BASE64}" alt="${esc(STORE.name)}" />`;
  }
  try {
    if (fs.existsSync(LOGO_PATH)) {
      const buf = fs.readFileSync(LOGO_PATH);
      return `<img src="data:image/jpeg;base64,${buf.toString('base64')}" alt="${esc(STORE.name)}" />`;
    }
  } catch (e) {
    console.warn('quote-pdf: failed to read local logo:', e.message);
  }
  return `<div class="store-name-fallback">${esc(STORE.name)}</div>`;
}

// --- Helpers --------------------------------------------------------------

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMoney(v) {
  if (v == null) return '—';
  return `$${Number(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtPct(v) {
  if (v == null) return '—';
  return `${Number(v).toFixed(1)}%`;
}
function marginClass(pct) {
  if (pct == null) return '';
  if (pct >= 20) return 'margin-good';
  if (pct >= 15) return 'margin-mid';
  return 'margin-low';
}

const PRICE_LEVEL_LABELS = {
  1: 'Level 1 — Retail',
  2: 'Level 2 — Builder',
  3: 'Level 3 — Large Builder',
  4: 'Level 4 — Top Volume',
};

function groupBySection(items) {
  const m = new Map();
  for (const it of items) {
    const k = it.section || 'Other';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}

// --- HTML template -------------------------------------------------------

function renderHtml(quote) {
  const lineItems = Array.isArray(quote.line_items) ? quote.line_items : [];
  const sections = groupBySection(lineItems);
  const today = new Date(quote.created_at || Date.now()).toLocaleDateString('en-CA');
  const validUntil = quote.valid_until
    ? new Date(quote.valid_until).toLocaleDateString('en-CA')
    : '30 days from issue';

  // Customer-facing line items, grouped by section.
  let lineItemsHtml = '';
  for (const [sectionName, items] of sections) {
    lineItemsHtml += `<tr class="section-band-row"><td colspan="6" class="section-band">${esc(sectionName)}</td></tr>`;
    for (const li of items) {
      const unitPrice = li.is_package
        ? '<span class="muted">— Quoted Separately —</span>'
        : (li.unit_price == null ? '<span class="tbd">TBD</span>' : fmtMoney(li.unit_price));
      const total = li.is_package
        ? '—'
        : (li.line_price == null ? '<span class="tbd">TBD</span>' : fmtMoney(li.line_price));
      lineItemsHtml += `
        <tr>
          <td>${esc(li.item_number || '—')}</td>
          <td>${esc(li.description)}</td>
          <td class="num">${esc(Number(li.quantity).toLocaleString())}</td>
          <td>${esc(li.unit || '—')}</td>
          <td class="num">${unitPrice}</td>
          <td class="num">${total}</td>
        </tr>`;
    }
  }

  // Internal-only per-section margin breakdown.
  let marginRowsHtml = '';
  for (const [sectionName, items] of sections) {
    let revenue = 0, cost = 0;
    for (const li of items) {
      if (li.line_price != null) revenue += Number(li.line_price);
      if (li.line_cost != null) cost += Number(li.line_cost);
    }
    const gp = revenue - cost;
    const mp = revenue > 0 ? (gp / revenue) * 100 : null;
    marginRowsHtml += `
      <tr>
        <td>${esc(sectionName)}</td>
        <td class="num">${fmtMoney(revenue)}</td>
        <td class="num">${fmtMoney(cost)}</td>
        <td class="num">${fmtMoney(gp)}</td>
        <td class="num margin-cell ${marginClass(mp)}">${fmtPct(mp)}</td>
      </tr>`;
  }

  const logoHtml = getLogoHtml();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Quote ${esc(quote.quote_number)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', -apple-system, sans-serif; color: #1A1A1A; margin: 0; padding: 0; font-size: 11px; }

  .header {
    background: #0A0A0A;
    color: white;
    padding: 24px 40px;
    display: flex;
    align-items: center;
    gap: 24px;
  }
  .header img { height: 64px; max-width: 200px; object-fit: contain; }
  .header .store-name-fallback { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
  .header .store-meta { line-height: 1.5; }
  .header .store-name { font-size: 16px; font-weight: 600; letter-spacing: -0.3px; }
  .header .store-info { font-size: 10px; color: #D1D1D1; }

  .page { padding: 32px 40px 80px; }
  .new-page { page-break-before: always; padding-top: 40px; }

  h1 { font-size: 22px; margin: 0 0 4px; color: #0A0A0A; }
  h1 .quote-num { color: #CC0000; }
  h2 { font-size: 14px; margin: 24px 0 8px; color: #0A0A0A; }

  .quote-meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px 32px;
    margin: 16px 0 8px;
    padding: 14px 16px;
    background: #F5F5F5;
    border-left: 3px solid #CC0000;
    border-radius: 4px;
  }
  .quote-meta .field { line-height: 1.4; }
  .quote-meta .label {
    color: #6B7280;
    text-transform: uppercase;
    font-size: 9px;
    letter-spacing: 0.5px;
    font-weight: 600;
  }
  .quote-meta .value { font-size: 12px; }

  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  thead th {
    text-align: left;
    padding: 8px;
    background: #F5F5F5;
    border-bottom: 2px solid #E0E0E0;
    text-transform: uppercase;
    font-size: 9px;
    letter-spacing: 0.4px;
    color: #6B7280;
    font-weight: 700;
  }
  td {
    padding: 6px 8px;
    border-bottom: 1px solid #F0F0F0;
    vertical-align: top;
  }
  td.num { text-align: right; white-space: nowrap; }

  tr.section-band-row td {
    padding: 0;
    border-bottom: none;
  }
  td.section-band {
    background: #0A0A0A;
    color: white;
    padding: 7px 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    font-size: 10px;
    border-left: 3px solid #CC0000;
  }

  .totals {
    margin-top: 18px;
    padding: 12px 16px;
    border-top: 2px solid #0A0A0A;
    max-width: 320px;
    margin-left: auto;
  }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px; }
  .totals .row.grand {
    font-size: 16px;
    font-weight: 700;
    color: #CC0000;
    border-top: 1px solid #E0E0E0;
    padding-top: 8px;
    margin-top: 8px;
  }

  .disclaimer {
    margin-top: 24px;
    padding: 12px 14px;
    background: #FFFBEC;
    font-size: 9px;
    color: #4B5563;
    line-height: 1.5;
    border-left: 3px solid #FFB800;
  }

  .internal-banner {
    background: #FFF0F0;
    border: 1px solid #CC0000;
    padding: 10px 14px;
    margin-bottom: 16px;
    color: #CC0000;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .margin-cell { font-weight: 700; }
  .margin-good { color: #16A34A; }
  .margin-mid  { color: #B45309; }
  .margin-low  { color: #CC0000; }

  .tbd { color: #9CA3AF; font-style: italic; }
  .muted { color: #6B7280; font-style: italic; }
</style>
</head>
<body>

<div class="header">
  ${logoHtml}
  <div class="store-meta">
    <div class="store-name">${esc(STORE.name)}</div>
    <div class="store-info">${esc(STORE.address)}</div>
    <div class="store-info">${esc(STORE.phone)} · ${esc(STORE.email)}</div>
  </div>
</div>

<div class="page">
  <h1>Quote <span class="quote-num">${esc(quote.quote_number)}</span></h1>
  <div class="quote-meta">
    <div class="field">
      <div class="label">Project</div>
      <div class="value">${esc(quote.project_name || '—')}</div>
    </div>
    <div class="field">
      <div class="label">Quote date</div>
      <div class="value">${esc(today)}</div>
    </div>
    <div class="field">
      <div class="label">Customer</div>
      <div class="value">${esc(quote.customer_name || '—')}</div>
    </div>
    <div class="field">
      <div class="label">Valid until</div>
      <div class="value">${esc(validUntil)}</div>
    </div>
    <div class="field">
      <div class="label">Estimator</div>
      <div class="value">${esc(quote.created_by || '—')}</div>
    </div>
    <div class="field">
      <div class="label">Price level</div>
      <div class="value">${esc(PRICE_LEVEL_LABELS[quote.price_level] || `Level ${quote.price_level}`)}</div>
    </div>
  </div>

  <h2>Line items</h2>
  <table>
    <thead>
      <tr>
        <th style="width:90px">Item #</th>
        <th>Description</th>
        <th style="width:50px;text-align:right">Qty</th>
        <th style="width:50px">Unit</th>
        <th style="width:90px;text-align:right">Unit price</th>
        <th style="width:100px;text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>
      ${lineItemsHtml || '<tr><td colspan="6" class="muted">No line items.</td></tr>'}
    </tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Subtotal</span><span>${fmtMoney(quote.subtotal)}</span></div>
    <div class="row"><span>HST ${quote.tax_rate != null ? `${(Number(quote.tax_rate) * 100).toFixed(0)}%` : '13%'}</span><span>${fmtMoney(quote.tax_amount)}</span></div>
    <div class="row grand"><span>Grand Total</span><span>${fmtMoney(quote.total)}</span></div>
  </div>

  <div class="disclaimer">${esc(STORE.disclaimer)}</div>
</div>

<div class="page new-page">
  <div class="internal-banner">Internal use only — do not share with customer</div>
  <h1>Margin Summary <span class="quote-num">${esc(quote.quote_number)}</span></h1>

  <h2>By section</h2>
  <table>
    <thead>
      <tr>
        <th>Section</th>
        <th style="text-align:right;width:90px">Revenue</th>
        <th style="text-align:right;width:90px">Cost</th>
        <th style="text-align:right;width:100px">Gross profit</th>
        <th style="text-align:right;width:80px">Margin %</th>
      </tr>
    </thead>
    <tbody>
      ${marginRowsHtml || '<tr><td colspan="5" class="muted">No data.</td></tr>'}
    </tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Total revenue</span><span>${fmtMoney(quote.subtotal)}</span></div>
    <div class="row"><span>Total cost</span><span>${fmtMoney(quote.total_cost)}</span></div>
    <div class="row"><span>Gross profit</span><span>${fmtMoney(quote.gross_profit)}</span></div>
    <div class="row grand">
      <span>Overall margin</span>
      <span class="margin-cell ${marginClass(quote.margin_pct)}">${fmtPct(quote.margin_pct)}</span>
    </div>
  </div>
</div>

</body>
</html>`;
}

// --- Puppeteer ------------------------------------------------------------

async function launchBrowser() {
  // Allow CHROME_EXECUTABLE_PATH override for local dev (where the
  // @sparticuz/chromium Lambda binary won't run on Windows/macOS).
  const executablePath = process.env.CHROME_EXECUTABLE_PATH
    || (await chromium.executablePath());
  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  });
}

export async function generateQuotePdf(quote) {
  const html = renderHtml(quote);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return pdf;
  } finally {
    await browser.close();
  }
}
