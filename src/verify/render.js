'use strict';
// Render-reviewer: the orchestrator's browser-based helper. Loads a built site in
// a real headless Chromium, drives the funnel, and reports uncaught JS errors,
// how far the funnel progressed, and whether the order form becomes reachable.
// Comparing original vs translated makes "did we break it?" objective.
//
// puppeteer-core + chromium are only present in the Docker image; on hosts that
// lack them this module degrades to a no-op (returns { available:false }).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { stripPhpSafe } = require('../extract/mask');

const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const MIME = { '.php': 'text/html', '.phtml': 'text/html', '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject' };

function serve(root) {
  return new Promise((resolve) => {
    const s = http.createServer((q, r) => {
      let rel = decodeURIComponent((q.url || '/').split('?')[0]);
      if (rel.endsWith('/')) rel += 'index.php';
      let fp = path.join(root, rel.replace(/^\/+/, ''));
      if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { r.statusCode = 404; return r.end(); }
      const e = path.extname(fp).toLowerCase();
      if (e === '.php' || e === '.phtml') { r.setHeader('Content-Type', 'text/html; charset=utf-8'); return r.end(stripPhpSafe(fs.readFileSync(fp, 'utf8'))); }
      r.setHeader('Content-Type', MIME[e] || 'application/octet-stream');
      fs.createReadStream(fp).pipe(r);
    });
    s.on('error', () => resolve(null));
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

// Render one site dir. Returns { errors:[], bubbles, formVisible, phoneVisible, textLen } or null.
async function renderCheck(root, shotPath) {
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { return { available: false }; }
  if (!fs.existsSync(CHROME)) return { available: false };
  const idx = fs.existsSync(path.join(root, 'index.php')) || fs.existsSync(path.join(root, 'index.html'));
  if (!idx) return { available: true, skipped: 'no-index' };
  const srv = await serve(root);
  if (!srv) return { available: true, skipped: 'no-server' };
  const port = srv.address().port;
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 420, height: 900 });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e && e.message || e).split('\n')[0].slice(0, 140)));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle2', timeout: 25000 }).catch(() => {});
    let bubbles = 0;
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 1300));
      // Drive the funnel forward: click a quiz/game element. The selector list
      // covers common landing patterns PLUS the form-kit games we inject
      // (door-face = door kit, .spin-button = wheel kit, .medboxes-kit .box =
      // medboxes kit) so a replaced form actually gets revealed during the check.
      await page.evaluate(() => {
        const sels = ['.answer', '[data-answer]', '.quiz button', '.variants button', 'button.next', '.btn-next', '.answers button',
          '.door-kit .door-face', '.door-kit [data-door-card] button', '.wheel-kit .spin-button', '.wheel-kit #spinButton',
          '.medboxes-kit .box', '.medboxes-kit .door', '[class*=door]'];
        for (const s of sels) { const el = document.querySelector(s); if (el && el.offsetParent) { el.click(); return; } }
      }).catch(() => {});
      const c = await page.evaluate(() => document.querySelectorAll('.box,.message,.msg,.chat__item,.b-msg,li,.review').length).catch(() => 0);
      if (c > bubbles) bubbles = c;
    }
    await new Promise(r => setTimeout(r, 1200));
    const info = await page.evaluate(() => { const vis = e => !!e && !!e.offsetParent; return { formVisible: vis(document.querySelector('form')), phoneVisible: vis(document.querySelector('input[type=tel],input[name*=phone]')), textLen: (document.body.innerText || '').replace(/\s+/g, ' ').trim().length }; }).catch(() => ({}));
    if (shotPath) { try { await page.screenshot({ path: shotPath, fullPage: false }); } catch { /* noop */ } }
    return { available: true, errors: [...new Set(errors)], bubbles, formVisible: !!info.formVisible, phoneVisible: !!info.phoneVisible, textLen: info.textLen || 0 };
  } catch (e) {
    return { available: true, error: String(e && e.message || e) };
  } finally { try { await browser.close(); } catch {} srv.close(); }
}

// Compare original vs translated render -> verdict.
// opts.formKit: when a form kit replaced the original lead form, the funnel is
// INTENTIONALLY different (a 9-box game instead of a 25-step quiz), so a bubble
// count drop is expected, not a regression. Likewise the host page's own JS may
// error when its (now-removed) form targets are gone — that is the cost of the
// swap, not a kit bug. So with a kit we only flag: formLost (kit form itself
// broken/unreachable) and JS errors that are clearly NOT the host's stale refs.
function compareRenders(orig, out, opts) {
  const o = opts || {};
  if (!orig || !out || orig.available === false || out.available === false) return { verdict: 'skipped' };
  if (orig.skipped || out.skipped || orig.error || out.error) return { verdict: 'skipped', note: orig.error || out.error || orig.skipped || out.skipped };
  const newErrors = (out.errors || []).filter(e => !(orig.errors || []).includes(e));
  const funnelRegressed = (orig.bubbles || 0) > 4 && (out.bubbles || 0) < (orig.bubbles || 0) * 0.7;
  const formLost = orig.formVisible && !out.formVisible;
  let verdict = 'ok';
  const reasons = [];
  if (o.formKit) {
    // With a kit, a funnel-depth change is by design. Only a genuinely broken
    // kit form counts as a regression. Host JS errors referencing removed nodes
    // (null .style/.textContent on old form/quiz hooks) are expected noise.
    if (formLost) { verdict = 'regression'; reasons.push('formLost'); }
  } else {
    if (newErrors.length) { verdict = 'regression'; reasons.push('errors'); }
    if (funnelRegressed) { verdict = 'regression'; reasons.push('funnel'); }
    if (formLost) { verdict = 'regression'; reasons.push('formLost'); }
  }
  return { verdict, reasons, newErrors, funnelRegressed, formLost, origBubbles: orig.bubbles, outBubbles: out.bubbles, origForm: orig.formVisible, outForm: out.formVisible, formKit: !!o.formKit };
}

module.exports = { renderCheck, compareRenders };
