'use strict';
// Deterministic structural gate. Compares the DOM skeleton (tags + structural
// attributes) of the original vs translated file. Any drift => reject the file
// and keep the original. This is the hard safety net; the AI QA is advisory.
const parse5 = require('parse5');
const { maskPhp } = require('../extract/mask');

// Attributes that affect layout/behavior/routing and must never change.
const STRUCT_ATTRS = ['id', 'name', 'action', 'method', 'href', 'src', 'type', 'for', 'class', 'rel', 'data-goal'];

function toDoc(content, type) {
  let html = content;
  if (type === 'php') {
    try { html = maskPhp(content).masked; } catch { /* fall back to regex strip */ html = content.replace(/<\?[\s\S]*?\?>/g, 'KIEPHPXENDK'); }
  }
  return /<html[\s>]/i.test(html) || /<!doctype/i.test(html)
    ? parse5.parse(html)
    : parse5.parseFragment(html);
}

function signature(doc) {
  const tags = {};        // tagName -> count
  const attrs = [];       // "tag|attr=value"
  (function walk(n) {
    if (n.tagName) {
      tags[n.tagName] = (tags[n.tagName] || 0) + 1;
      if (n.attrs) {
        for (const a of n.attrs) {
          if (STRUCT_ATTRS.includes(a.name)) attrs.push(`${n.tagName}|${a.name}=${a.value}`);
        }
      }
    }
    const kids = n.content ? n.content.childNodes : (n.childNodes || []);
    kids.forEach(walk);
  })(doc);
  return { tags, attrs: attrs.sort() };
}

function multisetDiff(a, b) {
  const ca = new Map(), cb = new Map();
  for (const x of a) ca.set(x, (ca.get(x) || 0) + 1);
  for (const x of b) cb.set(x, (cb.get(x) || 0) + 1);
  const removed = [], added = [];
  for (const [k, v] of ca) { const d = v - (cb.get(k) || 0); for (let i = 0; i < d; i++) removed.push(k); }
  for (const [k, v] of cb) { const d = v - (ca.get(k) || 0); for (let i = 0; i < d; i++) added.push(k); }
  return { removed, added };
}

// Returns { ok, tagDiffs:[...], attrDiff:{removed,added} }
function compareStructure(original, translated, type) {
  const sa = signature(toDoc(original, type));
  const sb = signature(toDoc(translated, type));
  const tagDiffs = [];
  const keys = new Set([...Object.keys(sa.tags), ...Object.keys(sb.tags)]);
  for (const k of keys) {
    const x = sa.tags[k] || 0, y = sb.tags[k] || 0;
    if (x !== y) tagDiffs.push({ tag: k, before: x, after: y });
  }
  const attrDiff = multisetDiff(sa.attrs, sb.attrs);
  // A dropped <!doctype> throws the browser into quirks mode (breaks layout/forms).
  const doctypeLost = /<!doctype/i.test(original) && !/<!doctype/i.test(translated);
  if (doctypeLost) tagDiffs.push({ tag: '!doctype', before: 1, after: 0 });
  const ok = !doctypeLost && tagDiffs.length === 0 && attrDiff.removed.length === 0 && attrDiff.added.length === 0;
  return { ok, tagDiffs, attrDiff };
}

module.exports = { compareStructure };
