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
    return {
      available: true,
      errors: [...new Set(errors)],
      bubbles,
      formVisible: !!info.formVisible,
      phoneVisible: !!info.phoneVisible,
      textLen: info.textLen || 0,
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
  return {
    verdict, reasons, newErrors, funnelRegressed, formLost,
    origBubbles: orig.bubbles, outBubbles: out.bubbles,
    origForm: orig.formVisible, outForm: out.formVisible,
    formKit: !!o.formKit,
    brokenImages: out.brokenImages || 0,
    kit: { injected: out.kitInjected, class: out.kitClass, formFound: out.kitFormFound, btnStyled: out.kitBtnStyled, inputStyled: out.kitInputStyled, priceHasDigit: out.kitPriceHasDigit, priceText: out.kitPriceText, gameHasImage: out.kitGameHasImage }
  };
}

module.exports = { renderCheck, compareRenders };
