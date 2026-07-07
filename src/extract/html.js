'use strict';
// Structure-preserving HTML extraction/reinsertion via parse5.
// We only ever mutate text-node .value and whitelisted attribute values; tags,
// classes, ids, scripts, styles and DOM shape are never altered here.
const parse5 = require('parse5');
const { extractJsUnits } = require('./js');
const { isPlaceholderOnly } = require('./mask');

const LETTER = /\p{L}/u;

// Text inside these elements is code/markup, never translate.
const SKIP_TEXT_PARENTS = new Set(['script', 'style', 'code', 'pre', 'kbd', 'samp', 'var', 'textarea-noop']);
// Attributes that carry human text, per element.
const GLOBAL_TEXT_ATTRS = new Set(['title', 'alt', 'placeholder', 'aria-label', 'aria-description', 'aria-placeholder', 'aria-roledescription', 'data-placeholder']);
const META_CONTENT_KEYS = new Set(['description', 'keywords', 'author', 'product', 'application-name', 'apple-mobile-web-app-title', 'subject', 'title']);
const META_PROP_KEYS = new Set(['og:title', 'og:description', 'og:site_name', 'og:image:alt', 'twitter:title', 'twitter:description', 'twitter:image:alt']);

function getAttr(node, name) {
  if (!node.attrs) return undefined;
  const a = node.attrs.find(x => x.name === name);
  return a ? a.value : undefined;
}

function isTranslatableText(v) {
  if (!v) return false;
  if (!v.trim()) return false;
  if (isPlaceholderOnly(v)) return false;
  // has a letter (any script) or a multi-digit run (prices/discounts)
  return LETTER.test(v) || /\d{2,}/.test(v);
}

function isFullDocument(src) {
  return /<!doctype/i.test(src) || /<html[\s>]/i.test(src);
}

function extractHtml(source) {
  const isFragment = !isFullDocument(source);
  const doc = isFragment ? parse5.parseFragment(source) : parse5.parse(source);

  const units = [];
  const textNodes = new Map(); // id -> textNode
  const attrRefs = new Map();  // id -> {attr}
  const scripts = [];          // {node, textNode, extractor, idMap}
  let n = 0;
  // Coarse section index: bumped on entering a semantic sectioning element, so
  // units in the same section share a `sec`. Used only to keep related fragments
  // (a heading + its body) in the same translation batch — never affects the
  // extracted text or reinsertion.
  let secCounter = 0;
  const SECTION_TAGS = new Set(['section', 'article', 'main', 'header', 'footer', 'aside']);

  function walk(node, parentTag, sec) {
    const name = node.tagName || node.nodeName;

    if (name === '#text') {
      if (!SKIP_TEXT_PARENTS.has(parentTag) && isTranslatableText(node.value)) {
        const id = 't' + (n++);
        textNodes.set(id, node);
        units.push({ id, kind: 'text', text: node.value, ctx: parentTag || '', sec });
      }
      return;
    }
    if (name === '#comment' || name === '#documentType') return;

    // respect translate="no" / class="notranslate"
    if (node.attrs) {
      const tr = getAttr(node, 'translate');
      const cls = getAttr(node, 'class') || '';
      if (tr === 'no' || /\bnotranslate\b/.test(cls)) {
        // still descend for scripts? no — skip entire subtree for text
        return;
      }
      collectAttrs(node, sec);
    }

    if (name === 'script') {
      handleScript(node, sec);
      return; // don't descend into script text as text
    }
    if (name === 'style') return;

    // A new semantic section gets its own index; everything else inherits.
    const childSec = SECTION_TAGS.has(name) ? ++secCounter : sec;
    const kids = node.childNodes || node.content && node.content.childNodes || [];
    // <template> content lives under node.content
    const childList = node.content ? node.content.childNodes : kids;
    for (const c of childList) walk(c, name, childSec);
  }

  function collectAttrs(node, sec) {
    const tag = node.tagName;
    for (const attr of node.attrs) {
      const an = attr.name;
      let take = false;
      if (GLOBAL_TEXT_ATTRS.has(an)) take = true;
      else if (an === 'value' && (tag === 'button' || (tag === 'input' && /^(submit|button|reset)$/i.test(getAttr(node, 'type') || '')))) take = true;
      else if (an === 'content' && tag === 'meta') {
        const nm = (getAttr(node, 'name') || '').toLowerCase();
        const pr = (getAttr(node, 'property') || '').toLowerCase();
        if (META_CONTENT_KEYS.has(nm) || META_PROP_KEYS.has(pr)) take = true;
      }
      if (take && isTranslatableText(attr.value)) {
        const id = 'a' + (n++);
        attrRefs.set(id, attr);
        units.push({ id, kind: 'attr', text: attr.value, ctx: `${tag}[${an}]`, sec });
      }
    }
  }

  function handleScript(node, sec) {
    const type = (getAttr(node, 'type') || '').toLowerCase();
    const isJs = !type || /javascript|module|ecmascript|^text\/js$/.test(type);
    if (!isJs) return; // JSON-LD, templates, etc. — leave alone
    const textNode = (node.childNodes || []).find(c => c.nodeName === '#text');
    if (!textNode || !textNode.value.trim()) return;
    const code = textNode.value;
    const ex = extractJsUnits(code, 's' + scripts.length + '_');
    if (!ex.ok || ex.units.length === 0) return;
    const idMap = new Map();
    for (const u of ex.units) {
      const gid = 'js_' + (n++);
      idMap.set(gid, u.localId);
      units.push({ id: gid, kind: 'js', text: u.text, ctx: 'inline-script', sec });
    }
    scripts.push({ textNode, extractor: ex, idMap });
  }

  walk(doc, null, 0);

  function applyAndSerialize(translationMap) {
    const failures = [];
    for (const [id, node] of textNodes) {
      if (translationMap[id] != null) node.value = translationMap[id];
    }
    for (const [id, attr] of attrRefs) {
      if (translationMap[id] != null) attr.value = translationMap[id];
    }
    for (const sc of scripts) {
      const local = {};
      for (const [gid, lid] of sc.idMap) {
        if (translationMap[gid] != null) local[lid] = translationMap[gid];
      }
      if (Object.keys(local).length === 0) continue;
      const res = sc.extractor.rebuild(local);
      if (res.ok) sc.textNode.value = res.code;
      else failures.push(...sc.idMap.keys()); // JS rebuild failed -> keep original script
    }
    const html = parse5.serialize(doc);
    return { html, scriptFailures: failures };
  }

  return { units, isFragment, applyAndSerialize };
}

module.exports = { extractHtml };
