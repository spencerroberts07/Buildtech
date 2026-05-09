// Quote PDF generation. Renders a customer-facing HTML template with
// puppeteer-core + @sparticuz/chromium so it works on Render's container env.
//
// This is a customer-facing document. No internal data (margin %, cost,
// gross profit, price-level label, "INTERNAL" banners) appears on the PDF.
// The web QuotePage still shows that information for the estimator.
//
// Local dev: puppeteer-core has no bundled Chrome. Set
//   CHROME_EXECUTABLE_PATH=/path/to/chrome
// to override the @sparticuz/chromium binary path. On Render the bundled
// binary works as-is.

import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const STORE = {
  name: 'Lyndhurst Home Building Centre',
  address: '397 Lyndhurst Rd, Lyndhurst ON  K0E 1N0',
  phone: '613-928-2828',
  email: 'admin@lyndhursthbc.com',
  disclaimer:
    'This estimate is provided for budgetary purposes only. Prices are valid for 30 days from the date of issue and are subject to change without notice. Lyndhurst Home Building Centre does not guarantee the completeness or accuracy of this material list. The builder and/or owner are solely responsible for verifying all quantities, specifications, and compliance with applicable building codes prior to ordering.',
};

// Inline Home Hardware logo: yellow rounded outer + red rounded inner with
// a stylized "dh" mark (two pillars with top/bottom serifs and a peaked
// roof connecting them at the top). Drawn at 60×60.
const HH_LOGO_SVG = `
<svg viewBox="0 0 60 60" width="60" height="60" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Home Hardware">
  <rect width="60" height="60" rx="10" ry="10" fill="#FFD700"/>
  <rect x="4" y="4" width="52" height="52" rx="7" ry="7" fill="#CC0000"/>
  <g fill="#FFFFFF">
    <!-- Peaked roof connecting the top serifs -->
    <path d="M 19 19 L 22 19 L 30 13 L 38 19 L 41 19 L 30 9 Z"/>
    <!-- d-pillar: top + bottom serifs, mid bump extending right -->
    <path d="M 9 18 L 23 18 L 23 23 L 19 23 L 19 28 L 26 28 L 26 32 L 19 32 L 19 42 L 23 42 L 23 47 L 9 47 L 9 42 L 13 42 L 13 23 L 9 23 Z"/>
    <!-- h-pillar: top + bottom serifs, mid bump extending left -->
    <path d="M 37 18 L 51 18 L 51 23 L 47 23 L 47 42 L 51 42 L 51 47 L 37 47 L 37 42 L 41 42 L 41 32 L 34 32 L 34 28 L 41 28 L 41 23 L 37 23 Z"/>
  </g>
</svg>`;

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

  // Customer-facing line items, grouped by section. Columns:
  //   Item # | Catalog # | Description | Qty | Unit | Unit price | Total
  // No margin %, no cost — purely customer-facing.
  let lineItemsHtml = '';
  for (const [sectionName, items] of sections) {
    lineItemsHtml += `<tr class="section-band-row"><td colspan="7" class="section-band">${esc(sectionName)}</td></tr>`;
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
          <td>${esc(li.catalog_number || '—')}</td>
          <td>${esc(li.description)}</td>
          <td class="num">${esc(Number(li.quantity).toLocaleString())}</td>
          <td>${esc(li.unit || '—')}</td>
          <td class="num">${unitPrice}</td>
          <td class="num">${total}</td>
        </tr>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Estimate ${esc(quote.quote_number)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', -apple-system, sans-serif; color: #1A1A1A; margin: 0; padding: 0; font-size: 11px; }

  .header {
    background: #0A0A0A;
    color: white;
    padding: 24px 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .header-left svg { display: block; }
  .header-left .store-name { font-size: 14px; font-weight: 700; letter-spacing: -0.2px; }
  .header-left .store-info { font-size: 10px; color: #FFFFFF; }
  .header-right { text-align: right; }
  .header-right .estimate-label {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: 3px;
    color: #FFD700;
  }
  .header-right .quote-number { font-size: 13px; font-weight: 600; margin-top: 2px; }
  .header-right .quote-meta-line { font-size: 10px; color: #D1D1D1; margin-top: 1px; }

  .page { padding: 32px 40px 40px; }

  h2 { font-size: 12px; margin: 18px 0 8px; color: #0A0A0A; text-transform: uppercase; letter-spacing: 0.6px; }

  .bill-to {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px 32px;
    margin: 0 0 8px;
    padding: 14px 16px;
    background: #F5F5F5;
    border-left: 3px solid #CC0000;
    border-radius: 4px;
  }
  .bill-to .field { line-height: 1.4; }
  .bill-to .label {
    color: #6B7280;
    text-transform: uppercase;
    font-size: 9px;
    letter-spacing: 0.5px;
    font-weight: 600;
  }
  .bill-to .value { font-size: 12px; }

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

  .footer {
    margin-top: 16px;
    padding-top: 10px;
    border-top: 1px solid #E0E0E0;
    text-align: center;
    font-size: 9px;
    color: #6B7280;
  }

  .tbd { color: #9CA3AF; font-style: italic; }
  .muted { color: #6B7280; font-style: italic; }
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    ${HH_LOGO_SVG}
    <div>
      <div class="store-name">${esc(STORE.name)}</div>
      <div class="store-info">${esc(STORE.address)}</div>
      <div class="store-info">${esc(STORE.phone)}  |  ${esc(STORE.email)}</div>
    </div>
  </div>
  <div class="header-right">
    <div class="estimate-label">ESTIMATE</div>
    <div class="quote-number">${esc(quote.quote_number)}</div>
    <div class="quote-meta-line">Date: ${esc(today)}</div>
    <div class="quote-meta-line">Valid until: ${esc(validUntil)}</div>
  </div>
</div>

<div class="page">
  <h2>Bill To / Project Details</h2>
  <div class="bill-to">
    <div class="field">
      <div class="label">Customer</div>
      <div class="value">${esc(quote.customer_name || '—')}</div>
    </div>
    <div class="field">
      <div class="label">Project</div>
      <div class="value">${esc(quote.project_name || '—')}</div>
    </div>
    <div class="field">
      <div class="label">Estimator</div>
      <div class="value">${esc(quote.created_by || '—')}</div>
    </div>
    <div class="field">
      <div class="label">Quote #</div>
      <div class="value">${esc(quote.quote_number)}</div>
    </div>
  </div>

  <h2>Materials</h2>
  <table>
    <thead>
      <tr>
        <th style="width:80px">Item #</th>
        <th style="width:80px">Catalog #</th>
        <th>Description</th>
        <th style="width:50px;text-align:right">Qty</th>
        <th style="width:50px">Unit</th>
        <th style="width:90px;text-align:right">Unit price</th>
        <th style="width:100px;text-align:right">Total</th>
      </tr>
    </thead>
    <tbody>
      ${lineItemsHtml || '<tr><td colspan="7" class="muted">No line items.</td></tr>'}
    </tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Subtotal</span><span>${fmtMoney(quote.subtotal)}</span></div>
    <div class="row"><span>HST ${quote.tax_rate != null ? `${(Number(quote.tax_rate) * 100).toFixed(0)}%` : '13%'}</span><span>${fmtMoney(quote.tax_amount)}</span></div>
    <div class="row grand"><span>Grand Total</span><span>${fmtMoney(quote.total)}</span></div>
  </div>

  <div class="disclaimer">${esc(STORE.disclaimer)}</div>

  <div class="footer">
    ${esc(STORE.name)}  ·  ${esc(STORE.phone)}  ·  ${esc(STORE.email)}
  </div>
</div>

</body>
</html>`;
}

// --- Puppeteer ------------------------------------------------------------

async function launchBrowser() {
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
