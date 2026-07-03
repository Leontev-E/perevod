'use strict';
// Inject a form kit into a landing in place of the original lead form + its
// funnel block. Runs BEFORE the translation scan, so the injected kit markup
// flows through the whole pipeline (extraction -> structural gate -> polish ->
// render-check) and gets localized like any other HTML.
//
// Contract preservation (the heart of "reliability"): we read the original
// form's `action` and EVERY <input type="hidden"> (sub1..sub5, price, country,
// goodID, pay ...) and merge them into the kit form. Tracking/billing must not
// break. We then rewrite the kit's __MARKERS__ to the buyer's params and to
// real asset URLs, and splice the kit markup into the region located by locate.
const fs = require('fs');
const path = require('path');
const parse5 = require('parse5');
const kits = require('./index');
const { locateInSite } = require('./locate');

const ASSET_DIR_NAME = 'assets';          // created at site root, holds kit assets
const ASSET_PREFIX = '_formkit';          // e.g. assets/_formkit-door/

// ---- contract extraction from the original form region ----
// Parse the located region HTML and pull out action + hidden inputs.
function extractContract(regionHtml) {
  let doc;
  try { doc = parse5.parseFragment(regionHtml); } catch { return { action: '', hidden: [] }; }
  let form = null;
  (function walk(n) {
    if (form) return;
    if (n.tagName === 'form') { form = n; return; }
    for (const c of (n.childNodes || [])) walk(c);
  })(doc);
  if (!form) return { action: '', hidden: [] };

  const action = (form.attrs || []).find(a => a.name === 'action');
  const hidden = [];
  (function walk(n) {
    if (n.tagName === 'input') {
      const attrs = {};
      (n.attrs || []).forEach(a => attrs[a.name] = a.value);
      if ((attrs.type || '').toLowerCase() === 'hidden') {
        hidden.push(attrs);   // { name, value, ... }
      }
    }
    for (const c of (n.childNodes || [])) walk(c);
  })(form);
  return { action: action ? action.value : '', hidden };
}

// Render hidden inputs back to HTML strings, skipping names the kit already ships.
function hiddenInputsHtml(hidden, skipNames) {
  const skip = new Set((skipNames || []).map(s => s.toLowerCase()));
  const seen = new Set();
  const out = [];
  for (const h of hidden) {
    const name = (h.name || '').toLowerCase();
    if (!name) continue;
    if (skip.has(name) || seen.has(name)) continue;  // kit already has sub1..5 etc.
    seen.add(name);
    const attrs = Object.keys(h).map(k => `${k}="${String(h[k]).replace(/"/g, '&quot;')}"`).join(' ');
    out.push(`    <input type="hidden" ${attrs}>`);
  }
  return out.join('\n');
}

// ---- marker rewriting ----
function priceWithCurrency(params, which) {
  // newPrice/oldPrice are raw numbers; show them with the buyer's currency.
  const cur = params.currency || '';
  const v = String(which === 'old' ? (params.oldPrice || '') : (params.newPrice || '')).trim();
  return v ? (v + (cur ? ' ' + cur : '')) : '';
}

// Extract the numeric portion of a discount like "50%" -> "50".
function discountNum(d) {
  const m = String(d || '').match(/-?\d+(?:[.,]\d+)?/);
  return m ? m[0] : '';
}

// Fill the kit markup: asset paths + buyer params + transferred hidden fields.
function renderKit(id, kitHtml, assetUrlBase, action, hiddenFromOriginal) {
  let out = kitHtml;

  // 1) asset paths: __FORMKIT_ASSET__images/door.png -> <base>/images/door.png
  //    assetUrlBase is a web path ending with '/', so concat directly.
  const base = assetUrlBase.endsWith('/') ? assetUrlBase : assetUrlBase + '/';
  out = out.split('__FORMKIT_ASSET__').join(base);

  // 2) discount / price markers
  const discount = action.discount || '';
  out = out.split('__DISCOUNT__').join(discount);
  out = out.split('__DISCOUNT_NUM__').join(discountNum(discount));
  out = out.split('__DISCOUNT_ALT__').join('50%,20%');
  out = out.split('__NEW_PRICE__').join(priceWithCurrency(action, 'new'));
  out = out.split('__OLD_PRICE__').join(priceWithCurrency(action, 'old'));
  out = out.split('__OFFER_NAME__').join((action.offerName || '').replace(/"/g, '&quot;'));

  // 3) contract: replace the original action if the kit's form points at api.php
  //    but the original used a different endpoint. We KEEP api.php as default
  //    (both kit and landings use it); only override if original differs.
  if (action.actionFromOriginal && !/api\.php/i.test(action.actionFromOriginal)) {
    out = out.replace(/(<form[^>]*action=")api\.php(")/i, `$1${action.actionFromOriginal}$2`);
  }

  // 4) hidden tracking fields from the original form (sub1..5 + extras). The kit
  //    already declares sub1..sub5; carry over anything else (price, country,
  //    goodID, pay) so tracking/billing keeps working. Replace the bare token
  //    anywhere it appears (it may sit inside a descriptive comment).
  const extra = hiddenInputsHtml(hiddenFromOriginal, ['sub1', 'sub2', 'sub3', 'sub4', 'sub5']);
  out = out.split('__FORMKIT_HIDDEN_FIELDS__').join(extra || '');

  return out;
}

// ---- asset copying ----
// Always create the kit's asset dir (even for kits with no shipped images),
// because the kit CSS/JS are written there too.
function copyAssets(id, siteRoot) {
  const assets = kits.listAssets(id);
  const dirRel = path.posix.join(ASSET_DIR_NAME, ASSET_PREFIX + '-' + id);
  const dirAbs = path.join(siteRoot, dirRel);
  fs.mkdirSync(dirAbs, { recursive: true });
  const k = kits.get(id);
  for (const rel of assets) {
    const src = path.join(k.dir, rel.split('/').join(path.sep));
    const dst = path.join(dirAbs, rel.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    try { fs.copyFileSync(src, dst); } catch { /* skip unreadable asset */ }
  }
  // Web path (forward slashes), relative to site root.
  return { urlBase: dirRel + '/', dir: dirAbs };
}

// ---- main entry: inject a kit into a site, return a report ----
// params: { formKit, discount, newPrice, oldPrice, currency, offerName, ... }
// offerPhotos: optional array of Buffers (buyer-uploaded product photos). The
// first one is written as product.png into the kit asset dir so the kit's
// <img src="__FORMKIT_ASSET__product.png"> resolves to the real new product.
function injectFormKit(siteRoot, params, offerPhotos) {
  const id = String(params.formKit || '').trim();
  const kit = kits.get(id);
  if (!kit) return { ok: false, reason: 'unknown kit' };

  const loc = locateInSite(siteRoot);
  if (!loc.found) return { ok: false, reason: 'no lead form found' };

  // Pull the original contract out of the located region (masked HTML region).
  const regionHtml = loc.html.slice(loc.region.start, loc.region.end);
  const contract = extractContract(regionHtml);

  // Copy kit assets into the site.
  const assetInfo = copyAssets(id, siteRoot);

  // If the buyer uploaded offer photos, write the first one as product.png in
  // the kit asset dir. Wheel/medboxes kits show this image in the order form;
  // without it the <img> would 404 (the "broken offer photo" bug).
  let hasProductImage = false;
  if (Array.isArray(offerPhotos) && offerPhotos.length) {
    try {
      fs.writeFileSync(path.join(assetInfo.dir, 'product.png'), offerPhotos[0]);
      hasProductImage = true;
    } catch { /* ignore — kit will hide the image below */ }
  } else {
    // No buyer photo: fall back to the kit's own shipped product image if it
    // has one (door ships images/med.png). Copy it as product.png so the kit
    // <img src=...product.png> still resolves.
    const k = kits.get(id);
    const fallbacks = { door: 'images/med.png' };
    const fb = fallbacks[id];
    if (fb) {
      const fbPath = path.join(k.dir, fb.split('/').join(path.sep));
      try { if (fs.existsSync(fbPath)) { fs.copyFileSync(fbPath, path.join(assetInfo.dir, 'product.png')); hasProductImage = true; } } catch { /* noop */ }
    }
  }

  // Render the kit markup.
  const kitHtml = kits.readHtml(id);
  const action = {
    discount: params.discount || '',
    offerName: params.offerName || '',
    actionFromOriginal: contract.action
  };
  let rendered = renderKit(id, kitHtml, assetInfo.urlBase, action, contract.hidden);

  // If there is no product image for this kit, drop the product <img> entirely
  // (a broken img icon is worse than no image). We target the kit's product img
  // by the __FORMKIT_ASSET__product.png src that the kits declare.
  if (!hasProductImage) {
    rendered = rendered.replace(/<img[^>]*src="(?:[^"]*\/)?_formkit-[^"]*\/product\.png"[^>]*>/gi, '');
  }

  // Splice the rendered kit into the masked HTML, then restore PHP into the
  // full source string, and write it back.
  const newHtml = loc.html.slice(0, loc.region.start) + rendered + loc.html.slice(loc.region.end);
  let newSource;
  if (loc.restore) newSource = loc.prologue + loc.restore(newHtml);
  else newSource = loc.prologue + newHtml;

  fs.writeFileSync(loc.filePath, newSource);

  // Also drop the kit CSS/JS as external assets so the page can <link>/<script>
  // them. We write them next to the other kit assets.
  const cssRel = path.posix.join(ASSET_DIR_NAME, ASSET_PREFIX + '-' + id, 'kit.css');
  const jsRel = path.posix.join(ASSET_DIR_NAME, ASSET_PREFIX + '-' + id, 'kit.js');
  fs.writeFileSync(path.join(siteRoot, cssRel), kits.readCss(id));
  fs.writeFileSync(path.join(siteRoot, jsRel), kits.readJs(id));

  // Inject the <link> into <head> and the <script defer> before </body> of the
  // SAME file we just wrote (so assets are actually loaded). Re-read & edit.
  injectAssetTags(loc.filePath, cssRel, jsRel);

  return {
    ok: true,
    kit: id,
    file: loc.relpath,
    hiddenFieldsCarried: contract.hidden.length,
    extrasAdded: contract.hidden.filter(h => !/^sub[1-5]$/i.test(h.name || '')).length,
    cssPath: cssRel,
    jsPath: jsRel
  };
}

// Insert <link rel=stylesheet> in <head> and <script defer> before </body>, but
// only once (idempotent) and only if the tags exist. Falls back to appending
// near the kit markup if the document has no head/body (fragment).
function injectAssetTags(filePath, cssRel, jsRel) {
  let src = fs.readFileSync(filePath, 'utf8');
  const cssTag = `<link rel="stylesheet" href="${cssRel}">`;
  const jsTag = `<script defer src="${jsRel}"></script>`;
  let changed = false;

  if (!src.includes(cssRel)) {
    if (/<head[^>]*>/i.test(src)) {
      src = src.replace(/(<head[^>]*>)/i, `$1\n    ${cssTag}`);
      changed = true;
    } else if (/<html[^>]*>/i.test(src)) {
      // has <html> but no <head> — unusual; place after <html>
      src = src.replace(/(<html[^>]*>)/i, `$1\n  ${cssTag}`);
      changed = true;
    }
  }
  if (!src.includes(jsRel)) {
    if (/<\/body>/i.test(src)) {
      src = src.replace(/<\/body>/i, `    ${jsTag}\n  </body>`);
      changed = true;
    } else if (/<\/html>/i.test(src)) {
      src = src.replace(/<\/html>/i, `  ${jsTag}\n</html>`);
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(filePath, src);
}

module.exports = { injectFormKit, extractContract, renderKit };
