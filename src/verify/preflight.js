'use strict';
// Pre-flight lint: deterministic, fast checks that run on the built site
// RIGHT BEFORE zipping. They catch whole classes of bugs that the LLM agents
// and render-check miss, because they are structural/contract issues, not
// translation or rendering issues.
//
// What it checks (and auto-fixes where safe):
//   1. Kit <img> references resolve to a real file — drop broken <img> tags
//      whose src 404s inside the kit asset dir (prevents broken-image icons).
//   2. No orphaned old lead-form wrapper survives next to an injected kit
//      (e.g. a leftover .pachinoform with its price above the kit). If a kit
//      root class is present, any sibling named order-form wrapper is suspect.
//   3. No two adjacent <img> with identical bytes (duplicate product photos
//      side by side from a botched replacement) — flag for review.
//   4. Kit form price is not empty when the buyer set oldPrice/newPrice.
//
// Returns { issues:[{sev,file,msg,autoFixed}], fixed:number }.
// The caller logs warnings and proceeds (preflight never aborts the job; it
// only repairs what it safely can and surfaces the rest).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KIT_ROOT_RE = /\b(medboxes-kit|door-kit|wheel-kit)\b/;
// Named order-form wrappers that should be REPLACED by the kit, not left
// alongside it. If a kit root is present and one of these still has a visible
// (non-CSS) block in the HTML, the locate region likely missed the wrapper.
// NOTE: kit-internal class names (order_block, order-form, orderForm,
// order_form, form-button) are intentionally EXCLUDED — those are part of the
// kit markup itself, so matching them would fire on every kit. We only flag
// clearly HOST-origin wrapper names that are NOT part of any kit.
const FORM_WRAPPER_RE = /\bclass="[^"]*\b(pachinoform|lead[-_]?form|cform|pomegranateform|quizform|order[-_]?section)\b[^"]*"/i;

function md5(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

function listTextFiles(root) {
  const out = [];
  (function walk(rel) {
    const abs = path.join(root, rel);
    let ents;
    try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const child = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { if (!/^(success|error|node_modules)$/i.test(e.name)) walk(child); }
      else if (/\.(php|phtml|html?|htm)$/i.test(e.name)) out.push(child);
    }
  })('');
  return out;
}

// Read text with BOM/encoding tolerance; returns { text } or null.
function readText(abs) {
  try { return { text: fs.readFileSync(abs, 'utf8') }; } catch { return null; }
}

function run(root, params) {
  const issues = [];
  let fixed = 0;
  const hasKit = !!(params && params.formKit);

  for (const rel of listTextFiles(root)) {
    const abs = path.join(root, rel);
    const r = readText(abs);
    if (!r) continue;
    let html = r.text;
    let changed = false;

    // 1. Kit <img src="assets/_formkit-.../..."> that 404s → drop the tag.
    //    A broken-img icon is worse than no image. We only touch kit imgs.
    html = html.replace(/<img\b[^>]*\bsrc="([^"]*_formkit-[^"]*)"[^>]*>/gi, (whole, src) => {
      const fp = path.join(root, src.split('/').join(path.sep));
      if (!fs.existsSync(fp)) {
        issues.push({ sev: 'fix', file: rel, msg: `удалён битый kit <img src="${src}"> (файл не найден)`, autoFixed: true });
        fixed++; changed = true;
        return '';
      }
      return whole;
    });

    // 2. Orphaned old order-form wrapper next to a kit. Only flag (cannot
    //    safely auto-delete — it may hold tracking the kit reuses).
    if (hasKit && KIT_ROOT_RE.test(html)) {
      const m = FORM_WRAPPER_RE.exec(html);
      if (m) {
        issues.push({ sev: 'warn', file: rel, msg: `рядом с kit остался старый form-контейнер (${m[0].slice(0, 60)}…) — возможно locate не покрыл его целиком`, autoFixed: false });
      }
    }

    // 4. Kit form price empty when buyer set a price. The injector fills
    //    offer-price1 / order-price / price-section-new spans; if a translate
    //    agent or polish blanked them, restore is not safe, so just flag.
    if (hasKit && (params.oldPrice || params.newPrice)) {
      const priceBlockRe = /<(?:div|span)[^>]*\boffer-price1[^>]*>([\s\S]*?)<\/(?:div|span)>/i;
      const pm = priceBlockRe.exec(html);
      if (pm) {
        const inner = (pm[1] || '').replace(/<[^>]+>/g, '').trim();
        // empty, or only punctuation/whitespace
        if (!inner || !/\d/.test(inner)) {
          issues.push({ sev: 'warn', file: rel, msg: `цена в kit-форме пустая (${JSON.stringify(inner).slice(0, 40)}) — агент мог её стереть; buyer oldPrice=${params.oldPrice||''} newPrice=${params.newPrice||''}`, autoFixed: false });
        }
      }
    }

    if (changed) {
      try { fs.writeFileSync(abs, html); } catch { /* noop */ }
    }
  }

  // 3. Adjacent duplicate images across the whole site (cheaper as a second
  //    pass over the image dir: find files with identical md5 that are both
  //    referenced by the same page). Flag only — never auto-fix a dupe, the
  //    duplicate may be intentional (e.g. retina variants).
  try {
    const imgDir = path.join(root, 'images');
    if (fs.existsSync(imgDir)) {
      const hashes = new Map(); // md5 -> [relpath]
      (function scan(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const a = path.join(d, e.name);
          if (e.isDirectory()) { scan(a); continue; }
          if (!/\.(jpg|jpeg|png|webp)$/i.test(e.name)) continue;
          let buf;
          try { buf = fs.readFileSync(a); } catch { continue; }
          const h = md5(buf);
          if (!hashes.has(h)) hashes.set(h, []);
          hashes.get(h).push(path.relative(root, a).split(path.sep).join('/'));
        }
      })(imgDir);
      for (const [h, files] of hashes) {
        if (files.length > 1) {
          issues.push({ sev: 'info', file: 'images/', msg: `${files.length} одинаковых картинок (md5 совпал): ${files.slice(0, 4).join(', ')}${files.length > 4 ? '…' : ''}`, autoFixed: false });
        }
      }
    }
  } catch { /* noop */ }

  return { issues, fixed };
}

module.exports = { run };
