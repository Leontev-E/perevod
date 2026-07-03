'use strict';
// Registry of built-in form kits. A kit is a self-contained "discount game +
// order form" bundle (CSS scoped under its root class, JS in an IIFE) that the
// injector can drop into a landing in place of the original lead form.
//
// Each kit lives in src/formkits/<id>/ with:
//   kit.html  - markup with __FORMKIT_ASSET__ / __DISCOUNT__ / ... markers
//   kit.css   - scoped styles (loaded as an external <link>)
//   kit.js    - behaviour IIFE (loaded as an external <script defer>)
//   <assets>  - images / extra files copied verbatim into the site
const fs = require('fs');
const path = require('path');

const KITS_DIR = __dirname;

// id -> { id, label, root, assets: [relative paths of non-kit.* files] }
const KITS = {
  door: { id: 'door', label: 'Двери (Door)', root: '.door-kit' },
  wheel: { id: 'wheel', label: 'Колесо (Wheel)', root: '.wheel-kit' },
  medboxes: { id: 'medboxes', label: 'Коробки (Medboxes)', root: '.medboxes-kit' }
};

function list() {
  return Object.values(KITS).map(k => ({ id: k.id, label: k.label }));
}

function get(id) {
  const k = KITS[id];
  if (!k) return null;
  const dir = path.join(KITS_DIR, id);
  return Object.assign({}, k, { dir });
}

// Read kit.html (markup). Throws if the kit is missing.
function readHtml(id) {
  const k = get(id);
  if (!k) throw new Error('unknown form kit: ' + id);
  return fs.readFileSync(path.join(k.dir, 'kit.html'), 'utf8');
}
function readCss(id) {
  const k = get(id);
  if (!k) throw new Error('unknown form kit: ' + id);
  return fs.readFileSync(path.join(k.dir, 'kit.css'), 'utf8');
}
function readJs(id) {
  const k = get(id);
  if (!k) throw new Error('unknown form kit: ' + id);
  return fs.readFileSync(path.join(k.dir, 'kit.js'), 'utf8');
}

// List every file inside the kit dir EXCEPT kit.html/css/js — those are assets
// (images etc.) to copy verbatim into the target site. Returns relative paths.
function listAssets(id) {
  const k = get(id);
  if (!k) return [];
  const out = [];
  (function walk(rel) {
    const abs = path.join(k.dir, rel);
    let ents;
    try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const child = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(child);
      else if (!/^kit\.(html|css|js)$/i.test(e.name)) out.push(child);
    }
  })('');
  return out;
}

module.exports = { KITS, list, get, readHtml, readCss, readJs, listAssets };
