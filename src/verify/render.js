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
// opts.geo: target country (name or ISO2) — the submit probe checks it reaches the tracker.
async function renderCheck(root, shotPath, opts) {
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

    // ── Lead-safety guard, active for the WHOLE session (load + funnel drive +
    // submit probe), NOT just the final probe. The funnel-driving clicks below can
    // trigger a real POST on some landings, so the block must be in place BEFORE
    // page.goto. Two layers: (1) a NETWORK abort of every POST/PUT/PATCH (nothing
    // can leave the machine no matter how it is triggered — fetch/XHR/sendBeacon/
    // native form submit); (2) in-page overrides that also CAPTURE the intended
    // payload and keep app code happy (fetch returns a fake 200).
    const netCap = [];
    try {
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        try {
          const m = (req.method() || 'GET').toUpperCase();
          if (m === 'POST' || m === 'PUT' || m === 'PATCH') { netCap.push({ url: req.url(), method: m, body: (req.postData() || '').slice(0, 3000) }); return req.abort(); }
          return req.continue();
        } catch (e) { try { req.continue(); } catch (e2) { /* already handled */ } }
      });
      await page.evaluateOnNewDocument(() => {
        window.__cap = { posts: [], forms: [] };
        window.fetch = function (u, o) {
          try { window.__cap.posts.push({ via: 'fetch', url: String(u), method: (o && o.method || 'GET').toUpperCase(), body: o && o.body ? String(o.body).slice(0, 3000) : '' }); } catch (e) { /* noop */ }
          return Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
        };
        const O = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (m, u) { this.__c = { m: String(m || '').toUpperCase(), u: String(u || '') }; return O.apply(this, arguments); };
        XMLHttpRequest.prototype.send = function (b) { try { window.__cap.posts.push({ via: 'xhr', url: this.__c && this.__c.u, method: this.__c && this.__c.m, body: b ? String(b).slice(0, 3000) : '' }); } catch (e) { /* noop */ } /* swallow: never send */ };
        try { if (navigator.sendBeacon) navigator.sendBeacon = function (u, d) { try { window.__cap.posts.push({ via: 'beacon', url: String(u), method: 'POST', body: d ? String(d).slice(0, 3000) : '' }); } catch (e) { /* noop */ } return true; }; } catch (e) { /* noop */ }
        try { HTMLFormElement.prototype.submit = function () { try { const f = this, fd = new FormData(f), pr = {}; for (const [k, v] of fd.entries()) pr[k] = String(v).slice(0, 200); window.__cap.forms.push({ action: f.getAttribute('action') || f.action || '', method: (f.getAttribute('method') || 'GET').toUpperCase(), fields: pr }); } catch (e) { /* noop */ } /* swallow programmatic submit */ }; } catch (e) { /* noop */ }
        document.addEventListener('submit', function (e) {
          try { const f = e.target, fd = new FormData(f), pr = {}; for (const [k, v] of fd.entries()) pr[k] = String(v).slice(0, 200); window.__cap.forms.push({ action: f.getAttribute('action') || f.action || '', method: (f.getAttribute('method') || 'GET').toUpperCase(), fields: pr }); } catch (err) { /* noop */ }
          e.preventDefault(); e.stopPropagation();
        }, true);
      });
    } catch (e) { /* interception unsupported -> probe still best-effort below */ }

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
    // Semantic probes (in addition to the bubble/form-visible counts). These
    // catch the classes of bugs the regression-diff misses: an unstyled form
    // (kit CSS not scoped), a kit form with an empty price, broken <img>
    // icons, and an injected kit whose game elements never rendered.
    const info = await page.evaluate(() => {
      const vis = e => !!e && !!e.offsetParent;
      const out = {
        formVisible: vis(document.querySelector('form')),
        phoneVisible: vis(document.querySelector('input[type=tel],input[name*=phone]')),
        textLen: (document.body.innerText || '').replace(/\s+/g, ' ').trim().length
      };
      // Show the kit order form if it is hidden (kits reveal on game play).
      const ob = document.querySelector('.order_block, [data-order-block], #order_block');
      if (ob) ob.style.display = 'block';
      const kit = document.querySelector('.medboxes-kit, .door-kit, .wheel-kit');
      out.kitInjected = !!kit;
      out.kitClass = kit ? kit.className : '';
      if (kit) {
        const form = document.querySelector('[data-formkit-form], .order_form, .orderForm');
        out.kitFormFound = !!form;
        if (form) {
          const btn = form.querySelector('.ifr_button, .order_form_button, .form-button, .button, button[type=submit], button');
          const inp = form.querySelector('input[type=text], input[type=tel], input[name=name], input:not([type=hidden])');
          if (btn) {
            const c = getComputedStyle(btn);
            // A styled CTA is never the browser default: it has a real
            // background (color OR gradient image) and non-trivial padding.
            const hasBg = c.backgroundColor !== 'rgba(0, 0, 0, 0)' || (c.backgroundImage && c.backgroundImage !== 'none');
            out.kitBtnStyled = hasBg && (parseFloat(c.paddingTop) > 4 || parseFloat(c.paddingBottom) > 4);
          }
          if (inp) {
            const c = getComputedStyle(inp);
            // Default browser inputs use a 2px inset border; a styled one
            // uses a solid border with custom padding.
            out.kitInputStyled = !/inset/.test(c.border) && (parseFloat(c.paddingTop) > 4 || parseFloat(c.paddingBottom) > 4);
          }
          // Kit price block should carry a digit (old or new price) once the
          // injector filled it. Empty/blank → agent likely erased it.
          const priceEl = document.querySelector('.offer-price1, .order-price, .price-section-new');
          if (priceEl) {
            const t = (priceEl.textContent || '').replace(/\s+/g, ' ').trim();
            out.kitPriceHasDigit = /\d/.test(t);
            out.kitPriceText = t.slice(0, 40);
          }
        }
        // Box/door game images: each game cell should carry a background
        // image (the product/box icon). Empty containers = missing assets.
        const gameCell = document.querySelector('.medboxes-kit .door, .door-kit .door-face, .door-kit [data-door-card]');
        if (gameCell) {
          const bg = getComputedStyle(gameCell).backgroundImage;
          out.kitGameHasImage = bg && bg !== 'none';
        }
      }
      // Broken images across the whole page (naturalWidth 0 after load).
      const imgs = Array.from(document.querySelectorAll('img'));
      let broken = 0;
      for (const im of imgs) {
        if (im.src && im.complete && im.naturalWidth === 0) broken++;
      }
      out.brokenImages = broken;
      return out;
    }).catch(() => ({}));
    if (shotPath) { try { await page.screenshot({ path: shotPath, fullPage: false }); } catch { /* noop */ } }
    // Submit + GEO probe LAST (it fills & submits the form). Safe: it intercepts
    // and BLOCKS the outgoing POST, so no real lead is ever sent to the tracker.
    let submit = { probed: false };
    try { submit = await probeSubmit(page, (opts && opts.geo) || '', netCap); } catch { /* best-effort */ }
    return {
      available: true,
      errors: [...new Set(errors)],
      bubbles,
      formVisible: !!info.formVisible,
      phoneVisible: !!info.phoneVisible,
      textLen: info.textLen || 0,
      submit,
      // semantic probes (present only when a kit is in play)
      kitInjected: !!info.kitInjected,
      kitClass: info.kitClass || '',
      kitFormFound: info.kitFormFound,
      kitBtnStyled: info.kitBtnStyled,
      kitInputStyled: info.kitInputStyled,
      kitPriceHasDigit: info.kitPriceHasDigit,
      kitPriceText: info.kitPriceText || '',
      kitGameHasImage: info.kitGameHasImage,
      brokenImages: info.brokenImages || 0
    };
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
// broken/unreachable), unstyled kit form, empty kit price, broken images, and
// missing kit game images — the semantic probes added to renderCheck.
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
    // With a kit, a funnel-depth change is by design. The semantic probes on
    // `out` are what actually tell us if the kit is broken:
    if (formLost) { verdict = 'regression'; reasons.push('formLost'); }
    // Kit injected but form not found inside it → injector or polish broke it.
    if (out.kitInjected && out.kitFormFound === false) { verdict = 'regression'; reasons.push('kitFormMissing'); }
    // Form present but button/input unstyled → kit CSS not scoped/linked.
    if (out.kitFormFound && out.kitBtnStyled === false) { verdict = 'regression'; reasons.push('kitButtonUnstyled'); }
    if (out.kitFormFound && out.kitInputStyled === false) { verdict = 'regression'; reasons.push('kitInputUnstyled'); }
    // Kit price block exists but has no digit → agent erased/zeroed the price.
    if (out.kitFormFound && out.kitPriceHasDigit === false && out.kitPriceText !== undefined) { verdict = 'regression'; reasons.push('kitPriceEmpty'); }
    // Medboxes/door game cells without a background image → dimg assets missing.
    if (out.kitInjected && out.kitGameHasImage === false) { verdict = 'regression'; reasons.push('kitGameImagesMissing'); }
  } else {
    if (newErrors.length) { verdict = 'regression'; reasons.push('errors'); }
    if (funnelRegressed) { verdict = 'regression'; reasons.push('funnel'); }
    if (formLost) { verdict = 'regression'; reasons.push('formLost'); }
  }
  // Broken <img> icons are a regression regardless of kit — they are visible
  // 404s the buyer will see. (Original pages rarely have them.)
  if ((out.brokenImages || 0) > 0 && (out.brokenImages || 0) > (orig.brokenImages || 0)) { verdict = 'regression'; reasons.push('brokenImages'); }

  // Submit/GEO regression — the lead flow is broken even if the form LOOKS fine.
  // Compared against the original so headless validation quirks (which affect
  // both) never false-positive: only flag when the original DID post but the
  // translated/kit-swapped page no longer does.
  const oSub = orig.submit || {}, tSub = out.submit || {};
  if (oSub.probed && tSub.probed) {
    if (oSub.submitPosts && !tSub.submitPosts) { verdict = 'regression'; reasons.push('submitDoesNotPost'); }
    // Posts, but the tracking sub1..5 fields the original carried are gone.
    if (tSub.submitPosts && oSub.submitHasSub && !tSub.submitHasSub) { verdict = 'regression'; reasons.push('submitMissingSub'); }
  } else if (oSub.probed && !tSub.probed) {
    // The translated/kit page broke the probe though the original ran — surface a
    // soft note for a manual look (NOT an auto-regression, to avoid flaky alarms).
    reasons.push('submitProbeInconclusive');
  }

  return {
    verdict, reasons, newErrors, funnelRegressed, formLost,
    origBubbles: orig.bubbles, outBubbles: out.bubbles,
    origForm: orig.formVisible, outForm: out.formVisible,
    formKit: !!o.formKit,
    brokenImages: out.brokenImages || 0,
    submit: { orig: oSub, out: tSub },
    kit: { injected: out.kitInjected, class: out.kitClass, formFound: out.kitFormFound, btnStyled: out.kitBtnStyled, inputStyled: out.kitInputStyled, priceHasDigit: out.kitPriceHasDigit, priceText: out.kitPriceText, gameHasImage: out.kitGameHasImage }
  };
}

// Submit + GEO probe. Installs capture-and-BLOCK interceptors (fetch / XHR /
// form submit), fills the visible lead form with test data, triggers submit, and
// reports whether a POST would have fired, to where, and whether it carries the
// tracking sub1..5 + a country/GEO field. CRITICAL: it never lets the request go
// out (fetch returns a fake 200, XHR.send is swallowed, submit is preventDefault-
// ed) so running the check can NOT create a fake lead on the real tracker.
async function probeSubmit(page, geo, netCap) {
  // The capture-and-BLOCK guard is already installed for the whole session (see
  // renderCheck). Here we just reveal, fill and submit the lead form, then read
  // what WOULD have posted (network + in-page captures). No real lead is sent.
  try {
    const filled = await page.evaluate(() => {
      const forms = Array.from(document.querySelectorAll('form')).filter(f => f.offsetParent);
      const form = forms.find(f => f.querySelector('input[type=tel],input[name*=phone]')) || forms[0];
      if (!form) return { hasForm: false };
      const nameI = form.querySelector('input[name=name]') || form.querySelector('input[type=text]:not([type=hidden])') || form.querySelector('input:not([type=hidden]):not([type=tel])');
      const phoneI = form.querySelector('input[type=tel]') || form.querySelector('input[name*=phone]');
      if (nameI) { nameI.value = 'Test Testov'; nameI.dispatchEvent(new Event('input', { bubbles: true })); nameI.dispatchEvent(new Event('change', { bubbles: true })); }
      if (phoneI) { phoneI.value = '+15551234567'; phoneI.dispatchEvent(new Event('input', { bubbles: true })); phoneI.dispatchEvent(new Event('change', { bubbles: true })); }
      const btn = form.querySelector('button[type=submit],input[type=submit]') || form.querySelector('button');
      try { if (btn) btn.click(); else if (form.requestSubmit) form.requestSubmit(); else form.submit(); } catch (e) { /* noop */ }
      return { hasForm: true, hidden: Array.from(form.querySelectorAll('input[type=hidden]')).map(i => i.name).filter(Boolean) };
    });
    await new Promise(r => setTimeout(r, 1500)); // let an async post fire
    const cap = await page.evaluate(() => window.__cap || { posts: [], forms: [] });
    const posts = [...(cap.posts || []), ...(netCap || [])]; // in-page + network captures
    const forms = cap.forms || [];
    const payloads = [];
    for (const p of posts) payloads.push((p.url || '') + ' ' + (p.body || ''));
    for (const f of forms) payloads.push((f.action || '') + ' ' + Object.entries(f.fields || {}).map(([k, v]) => k + '=' + v).join('&'));
    const blob = payloads.join(' \n ');
    const nPosts = posts.length + forms.length;
    const hasSub = /(?:^|[^a-z])sub[1-5](?:[^a-z]|$)/i.test(blob) || (filled.hidden || []).some(n => /^sub[1-5]$/i.test(n));
    const g = String(geo || '').trim();
    let hasGeo = /(?:^|[^a-z])(country|geo)(?:[^a-z]|$)/i.test(blob);
    if (!hasGeo && g) { try { hasGeo = new RegExp('(?:^|[^\\p{L}])' + g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[^\\p{L}]|$)', 'iu').test(blob); } catch { hasGeo = blob.toLowerCase().includes(g.toLowerCase()); } }
    const url = (posts[0] && posts[0].url) || (forms[0] && forms[0].action) || '';
    return { probed: true, hasForm: filled.hasForm !== false, posts: nPosts, submitPosts: nPosts > 0, submitUrl: url, submitHasSub: hasSub, submitHasGeo: hasGeo };
  } catch (e) { return { probed: false, error: String(e && e.message || e) }; }
}

module.exports = { renderCheck, compareRenders };
