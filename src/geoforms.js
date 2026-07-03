'use strict';
// Geo-adapt the lead form to the target country: select the target country in a
// country <select>, set the phone prefix, and update a hidden country field.
// This is an intentional STRUCTURAL edit (moves `selected`, changes values), run
// AFTER the translation structural gate — so it never trips that gate.
const parse5 = require('parse5');
const { maskPhp } = require('./extract/mask');
const { splitDocument } = require('./extract');

// Common ISO-3166 alpha-2 set (enough to recognize a country <select>).
const ISO2 = new Set(('af ax al dz as ad ao ai aq ag ar am aw au at az bs bh bd bb by be bz bj bm bt bo ba bw br bn bg bf bi kh cm ca cv cf td cl cn co km cg cd cr ci hr cu cy cz dk dj dm do ec eg sv gq er ee et fi fr ga gm ge de gh gr gl gt gn gw gy ht hn hk hu is in id ir iq ie il it jm jp jo kz ke kr kw kg la lv lb ls lr ly li lt lu mo mk mg mw my mv ml mt mx md mc mn me ma mz mm na np nl nz ni ne ng no om pk pa py pe ph pl pt qa ro ru rw sa rs sg sk si za es lk sd se ch sy tw tj th tr tm ua ae gb us uy uz ve vn ye zm zw uk').split(' '));

function getAttr(node, name) { const a = (node.attrs || []).find(x => x.name === name); return a ? a.value : undefined; }
function setAttr(node, name, value) { const a = (node.attrs || []).find(x => x.name === name); if (a) a.value = value; else (node.attrs = node.attrs || []).push({ name, value }); }
function delAttr(node, name) { if (node.attrs) node.attrs = node.attrs.filter(x => x.name !== name); }
function textOf(node) { return (node.childNodes || []).filter(c => c.nodeName === '#text').map(c => c.value).join('').trim(); }
function setText(node, value) {
  const t = (node.childNodes || []).find(c => c.nodeName === '#text');
  if (t) t.value = value; else (node.childNodes = node.childNodes || []).push({ nodeName: '#text', value, parentNode: node });
}

function isFull(src) { return /<!doctype/i.test(src) || /<html[\s>]/i.test(src); }

function adaptForms(content, type, params, localeRules) {
  // Keep the verbatim prologue (e.g. a PHP redirect BEFORE <!doctype) and epilogue
  // out of parse5 — otherwise a masked-PHP placeholder before the doctype makes
  // parse5 drop the doctype and hoist <head> into <body> (breaks styles/quirks mode).
  const { prologue, doc: middle, epilogue } = splitDocument(content);
  let source = middle, restore = (s) => s;
  if (type === 'php') { try { const m = maskPhp(middle); source = m.masked; restore = m.restore; } catch { return { content, changes: [] }; } }
  const fullDoc = isFull(source);   // full document -> parse(); fragment -> parseFragment()
  let doc;
  try { doc = fullDoc ? parse5.parse(source) : parse5.parseFragment(source); } catch { return { content, changes: [] }; }

  const cc = String(params.country || '').toLowerCase();
  const nativeNameRaw = (localeRules && localeRules.countryNativeName) || params.country || '';
  const nativeName = nativeNameRaw.toLowerCase();
  const prefix = (localeRules && localeRules.phonePrefix) || '';
  const changes = [];

  const selects = [], inputs = [];
  (function walk(n) {
    const tag = n.tagName;
    if (tag === 'select') selects.push(n);
    else if (tag === 'input') inputs.push(n);
    const kids = n.content ? n.content.childNodes : (n.childNodes || []);
    for (const c of kids) walk(c);
  })(doc);

  // ---- country <select> ----
  for (const sel of selects) {
    const options = [];
    (function collect(n) { for (const c of (n.childNodes || [])) { if (c.tagName === 'option') options.push(c); else collect(c); } })(sel);
    if (options.length < 3) continue;
    const isoCount = options.filter(o => ISO2.has(String(getAttr(o, 'value') || '').toLowerCase())).length;
    const nameHint = /country|strana|страна|geo|region|kraj|land|pais|paese|state/i.test((getAttr(sel, 'name') || '') + ' ' + (getAttr(sel, 'id') || ''));
    const looksCountry = nameHint || isoCount >= Math.max(3, Math.floor(options.length * 0.5));
    if (!looksCountry) continue;
    let target = options.find(o => String(getAttr(o, 'value') || '').toLowerCase() === cc);
    if (!target && nativeName) target = options.find(o => textOf(o).toLowerCase() === nativeName);
    if (!target && nativeName) target = options.find(o => textOf(o).toLowerCase().includes(nativeName));
    let repurposed = false;
    if (!target) {
      // The list has no option for the target country — repurpose the currently
      // selected one (or the first) so the form shows & submits the target GEO.
      target = options.find(o => getAttr(o, 'selected') !== undefined) || options[0];
      setAttr(target, 'value', cc);
      setText(target, nativeNameRaw);
      repurposed = true;
    }
    for (const o of options) delAttr(o, 'selected');
    setAttr(target, 'selected', 'selected');
    changes.push('select[' + (getAttr(sel, 'name') || '?') + ']=' + cc + (repurposed ? '(repurposed→' + nativeNameRaw + ')' : ''));
  }

  // ---- phone + hidden country inputs ----
  for (const inp of inputs) {
    const name = (getAttr(inp, 'name') || '').toLowerCase();
    const typ = (getAttr(inp, 'type') || '').toLowerCase();
    const val = getAttr(inp, 'value');
    const ph = getAttr(inp, 'placeholder');
    // phone prefix
    if (prefix && (typ === 'tel' || /phone|tel|телефон|phone_code|dialcode/.test(name))) {
      if (val != null && /^\s*\+?\d[\d\s()-]{0,6}$/.test(val)) { setAttr(inp, 'value', prefix); changes.push('phone.value=' + prefix); }
      if (ph != null && /^\s*\+?\d/.test(ph)) { setAttr(inp, 'placeholder', ph.replace(/^\s*\+?\d[\d\s()-]*/, prefix + ' ')); }
    }
    // hidden country code
    if (/^country$|country_code|geo$/.test(name) && val != null && /^[a-z]{2}$/i.test(val)) {
      setAttr(inp, 'value', params.country.toUpperCase()); changes.push('hidden country=' + params.country.toUpperCase());
    }
  }

  let out = prologue + restore(parse5.serialize(doc)) + epilogue;

  // Patch JS phone-widget defaults (intl-tel-input etc.) to the target country.
  if (cc.length === 2) {
    const before = out;
    out = out.replace(/(initialCountry\s*:\s*['"])(auto|[a-zA-Z]{2})(['"])/g, `$1${cc}$3`);
    out = out.replace(/(defaultCountry\s*:\s*['"])(auto|[a-zA-Z]{2})(['"])/g, `$1${cc}$3`);
    out = out.replace(/(\.setCountry\(\s*['"])[a-zA-Z]{2}(['"]\s*\))/g, `$1${cc}$2`);
    if (out !== before) changes.push('phone.initialCountry=' + cc);
  }

  if (!changes.length) return { content, changes: [] };
  return { content: out, changes };
}

module.exports = { adaptForms };
