'use strict';
// Translate human-readable string VALUES inside JSON content files (e.g. quiz
// questions.json). Keys, numbers, booleans and structure are never changed.
// Re-serialized JSON is re-parsed as a safety gate.
const { looksLikeText } = require('./js');

function detectIndent(src) {
  const m = src.match(/\n(\s+)\S/);
  if (!m) return 2;
  const ws = m[1];
  if (ws.includes('\t')) return '\t';
  return Math.min(ws.length, 8) || 2;
}

// Keys whose string values are usually config, not display text.
const SKIP_KEYS = new Set(['id', 'url', 'href', 'src', 'type', 'name', 'key', 'code', 'class', 'icon', 'action', 'method', 'target', 'rel', 'lang', 'locale', 'color', 'bg', 'font']);

function extractJson(source) {
  let data;
  try { data = JSON.parse(source); } catch { return { ok: false, units: [], apply: () => ({ content: source, failures: ['json-parse-failed'] }) }; }
  const indent = detectIndent(source);
  const paths = []; // { path:[...], value }
  let n = 0;

  function walk(node, path, keyName) {
    if (typeof node === 'string') {
      if (!(keyName && SKIP_KEYS.has(String(keyName).toLowerCase())) && looksLikeText(node)) {
        paths.push({ id: 'n' + (n++), path: path.slice(), text: node });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, path.concat(i), keyName));
    } else if (node && typeof node === 'object') {
      for (const k of Object.keys(node)) walk(node[k], path.concat(k), k);
    }
  }
  walk(data, [], null);

  const units = paths.map(p => ({ id: p.id, kind: 'json', text: p.text, ctx: 'json:' + p.path.filter(x => typeof x === 'string').slice(-1)[0] }));

  function setByPath(obj, path, val) {
    let cur = obj;
    for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
    cur[path[path.length - 1]] = val;
  }

  function apply(map) {
    // work on a fresh clone to avoid mutating shared state
    const clone = JSON.parse(JSON.stringify(data));
    for (const p of paths) {
      if (map[p.id] != null) setByPath(clone, p.path, map[p.id]);
    }
    let out;
    try { out = JSON.stringify(clone, null, indent); } catch { return { content: source, failures: ['json-stringify-failed'] }; }
    try { JSON.parse(out); } catch { return { content: source, failures: ['json-reparse-failed'] }; }
    return { content: out, failures: [] };
  }

  return { ok: true, units, apply };
}

module.exports = { extractJson };
