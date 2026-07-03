'use strict';
// Runtime settings stored on the data volume (survive restarts/rebuilds; never in
// the image or .env). Currently holds the kie.ai API key entered via the UI.
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const FILE = path.join(cfg.dataDir, 'settings.json');

function get() {
  try { const o = JSON.parse(fs.readFileSync(FILE, 'utf8')); return (o && typeof o === 'object') ? o : {}; }
  catch { return {}; }
}
function set(patch) {
  const next = Object.assign({}, get(), patch);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}
// UI-saved key wins; env is only a legacy/dev fallback.
function getKieKey() { return String((get().kieKey || process.env.KIE_API_KEY || '')).trim(); }
function hasKieKey() { return getKieKey().length > 0; }
// Show only the tail so the key is never fully exposed in the UI.
function maskedKieKey() {
  const k = getKieKey();
  if (!k) return '';
  return k.length <= 8 ? '••••' : '••••••••' + k.slice(-4);
}

module.exports = { get, set, getKieKey, hasKieKey, maskedKieKey, FILE };
