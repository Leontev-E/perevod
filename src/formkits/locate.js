'use strict';
// Locate the original lead form (and its preceding funnel block) inside a
// landing's index file, so the injector can replace exactly that region with a
// form kit — nothing else.
//
// "Lead form" contract on arbitrage landings: <form action="api.php"> with a
// name + phone input and hidden tracking fields (sub1..sub5). We prefer a form
// that posts to api.php (or success/order). If several match, pick the one with
// a phone input + a sub1 field.
//
// The "funnel" is the discount-game block that normally sits above/around the
// form (wheel/door/box). We detect it by known root classes and only treat it
// as the same unit when it shares a common ancestor section with the form — so
// we never delete an unrelated game elsewhere on the page.
//
// Returns { found, filePath, form: {start,end}, region: {start,end}, html }
// where start/end are CHARACTER offsets into the file source (for a precise
// splice), or { found:false } when no usable form is present.
const fs = require('fs');
const path = require('path');
const parse5 = require('parse5');
const { maskPhp } = require('../extract/mask');
const { splitDocument } = require('../extract');

// Known funnel-root class names (the game wrapper above the order form).
const FUNNEL_CLASSES = ['door-kit', 'wheel-kit', 'medboxes-kit', 'wheel-section', 'door__wrapper', 'box_block'];

// PHP-aware parse: returns a parse5 document for the <body> portion, plus the
// byte ranges of the whole document so we can map offsets.
function parseForLocation(source) {
  const { prologue, doc: middle, epilogue } = splitDocument(source);
  let html = middle, restore = null;
  // For PHP, mask code blocks so parse5 sees clean HTML and we keep offsets
  // stable (a placeholder is the same length-agnostic token the pipeline uses).
  if (/<\?/.test(middle)) {
    try { const m = maskPhp(middle); html = m.masked; restore = m.restore; } catch { /* fall back to raw */ }
  }
  const full = /<!doctype/i.test(html) || /<html[\s>]/i.test(html);
  let doc;
  // sourceCodeLocationInfo MUST be on: we depend on element spans (startOffset/
  // endOffset) to splice the kit markup into exactly the right region.
  try { doc = full ? parse5.parse(html, { sourceCodeLocationInfo: true }) : parse5.parseFragment(html, { sourceCodeLocationInfo: true }); } catch { return null; }
  return { prologue, html, restore, doc, docOffset: prologue.length };
}

function getAttr(node, name) {
  const a = (node.attrs || []).find(x => x.name === name);
  return a ? a.value : '';
}
function hasInputNamed(form, re) {
  let found = false;
  (function walk(n) {
    if (found) return;
    if (n.tagName === 'input' && re.test(getAttr(n, 'name'))) { found = true; return; }
    const kids = n.childNodes || [];
    for (const c of kids) walk(c);
  })(form);
  return found;
}

// Recursively collect <form> nodes, scoring each by how strongly it looks like
// the lead form. Returns the best candidate (or null).
function findLeadForm(doc) {
  const forms = [];
  (function walk(n) {
    if (n.tagName === 'form') forms.push(n);
    const kids = n.childNodes || [];
    for (const c of kids) walk(c);
  })(doc);
  if (!forms.length) return null;

  function score(f) {
    const action = getAttr(f, 'action').toLowerCase();
    let s = 0;
    if (action.includes('api.php')) s += 5;
    if (action.includes('order') || action.includes('success') || action.includes('lead')) s += 2;
    if (hasInputNamed(f, /^phone$/i)) s += 3;
    if (hasInputNamed(f, /^name$/i)) s += 2;
    if (hasInputNamed(f, /^sub1$/i)) s += 3;
    if (hasInputNamed(f, /^sub[1-5]$/i)) s += 1;
    return s;
  }
  let best = null, bestScore = 0;
  for (const f of forms) {
    const sc = score(f);
    if (sc > bestScore) { best = f; bestScore = sc; }
  }
  // Require at least an action hint + a phone field, else it's not a lead form.
  if (bestScore < 5) return null;
  return best;
}

// Find the smallest region that contains the form AND (optionally) a funnel
// block that is an ancestor or sibling-within-common-section. We prefer to
// replace the funnel + form together when they share a wrapping section.
function findRegion(form) {
  // The form's own span:
  const formLoc = form.sourceCodeLocation;
  if (!formLoc) return null;
  let start = formLoc.startOffset, end = formLoc.endOffset;

  // Walk up ancestors looking for a wrapping element that also contains a
  // funnel-root node. If found, expand the region to that ancestor's span
  // (replaces game + form as one unit).
  let node = form.parentNode;
  while (node) {
    const loc = node.sourceCodeLocation;
    const tag = node.tagName;
    // Stop at document/fragment roots.
    if (!tag) break;
    // Does this subtree contain a funnel root?
    let hasFunnel = false;
    (function walk(n) {
      if (hasFunnel) return;
      const cls = getAttr(n, 'class') || '';
      const id = getAttr(n, 'id') || '';
      if (FUNNEL_CLASSES.some(c => cls.split(/\s+/).includes(c) || id === c)) { hasFunnel = true; return; }
      for (const c of (n.childNodes || [])) walk(c);
    })(node);
    if (hasFunnel && loc) {
      // Only adopt this ancestor if it is a "section"-ish wrapper, to avoid
      // swallowing the whole <body>. Limit to common section containers.
      if (/^(section|div|main|article)$/i.test(tag)) {
        start = loc.startOffset;
        end = loc.endOffset;
      }
    }
    node = node.parentNode;
  }
  return { start, end };
}

function locateInSource(source) {
  const parsed = parseForLocation(source);
  if (!parsed) return { found: false };
  const { prologue, html, restore, doc, docOffset } = parsed;
  const form = findLeadForm(doc);
  if (!form) return { found: false };
  const region = findRegion(form);
  if (!region) return { found: false };
  // The offsets are in the parsed `html`; the file source has the prologue in
  // front. If we masked PHP, the masked html is a different string than the
  // source middle, so offsets are valid only within the masked html. We splice
  // on the masked html and then restore -> we still get a correct source.
  return {
    found: true,
    docOffset,            // add to map offsets back to the full source string we edit
    html,                 // the masked HTML we edit (then restore PHP)
    restore,
    region,               // { start, end } within `html`
    prologue,
    hasPhone: hasInputNamed(form, /^phone$/i),
    hasSub: hasInputNamed(form, /^sub1$/i)
  };
}

// Convenience: locate inside an index file on disk (index.php preferred).
function locateInSite(siteRoot) {
  const cands = ['index.php', 'index.html', 'index.htm', 'index.phtml'];
  for (const rel of cands) {
    const fp = path.join(siteRoot, rel);
    if (!fs.existsSync(fp)) continue;
    let source;
    try { source = fs.readFileSync(fp, 'utf8'); } catch { continue; }
    const loc = locateInSource(source);
    if (loc.found) return Object.assign({ filePath: fp, relpath: rel, source }, loc);
  }
  return { found: false };
}

module.exports = { locateInSource, locateInSite, FUNNEL_CLASSES };
