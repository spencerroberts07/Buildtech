// Server-side PDF-page → PNG renderer.
//
// Re-uses the existing @sparticuz/chromium + puppeteer-core stack already
// installed for quote PDFs. Rather than open the PDF in Chrome's built-in
// PDF viewer (which adds a toolbar + scroll bars and is hard to clip),
// we mount a tiny HTML page that renders the PDF page to a <canvas> via
// pdf.js and screenshot just the canvas element.
//
// The browser is meant to be launched ONCE per export and reused across
// every example — exporting 50 examples should not spawn Chrome 50 times.

import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const PDFJS_VERSION = '4.7.76';

export async function launchPdfRenderer() {
  const executablePath = process.env.CHROME_EXECUTABLE_PATH
    || (await chromium.executablePath());
  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  });
}

/**
 * Render the first page of a PDF to a PNG buffer.
 *
 * @param {import('puppeteer-core').Browser} browser
 * @param {Buffer} pdfBuffer
 * @param {object} opts
 * @param {number} [opts.scale=1.5] pdf.js render scale — higher = sharper but
 *                                  larger file. 1.5× is a good middle ground
 *                                  for training-data accuracy vs file size.
 * @param {number} [opts.page=1] 1-indexed page number
 * @returns {Promise<Buffer>} PNG bytes
 */
export async function renderPdfPageToPng(browser, pdfBuffer, opts = {}) {
  const scale = Number(opts.scale) || 1.5;
  const pageNumber = Math.max(1, Math.round(Number(opts.page) || 1));
  const b64 = pdfBuffer.toString('base64');

  const html = `<!doctype html>
<html><body style="margin:0;background:white;">
  <canvas id="c"></canvas>
  <script type="module">
    import * as pdfjs from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs';
    pdfjs.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs';
    try {
      const bin = atob(${JSON.stringify(b64)});
      const data = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
      const pdf = await pdfjs.getDocument({ data }).promise;
      const pageIdx = Math.min(${pageNumber}, pdf.numPages);
      const page = await pdf.getPage(pageIdx);
      const viewport = page.getViewport({ scale: ${scale} });
      const canvas = document.getElementById('c');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      window.__renderResult = { ok: true, width: canvas.width, height: canvas.height };
    } catch (e) {
      window.__renderResult = { ok: false, error: String(e && e.message || e) };
    }
  </script>
</body></html>`;

  const page = await browser.newPage();
  try {
    // Need a viewport large enough for the canvas not to be clipped. The
    // pdf.js render scales the canvas to viewport.width/height (pixels in
    // PDF user space × scale). We grow the browser viewport to match the
    // rendered canvas after pdf.js reports its dimensions.
    await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    // Wait for pdf.js to finish (or fail).
    await page.waitForFunction(() => !!window.__renderResult, { timeout: 30_000 });
    const result = await page.evaluate(() => window.__renderResult);
    if (!result?.ok) throw new Error(result?.error || 'pdf.js render failed');
    // Resize viewport to fit the canvas so the screenshot captures it
    // fully without internal scrolling.
    await page.setViewport({ width: result.width, height: result.height, deviceScaleFactor: 1 });
    const canvas = await page.$('#c');
    if (!canvas) throw new Error('canvas element not found after render');
    const png = await canvas.screenshot({ type: 'png', omitBackground: false });
    return png;
  } finally {
    await page.close();
  }
}
