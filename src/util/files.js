'use strict';
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const cfg = require('../config');

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const RASTER_EDITABLE = new Set(['.png', '.jpg', '.jpeg', '.webp']); // gif/svg not edited

function walkFiles(root) {
  const out = [];
  (function rec(dir, rel) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (cfg.excludedDirs.includes(e.name.toLowerCase())) continue;
        rec(abs, r);
      } else if (e.isFile()) {
        out.push({ relpath: r, abspath: abs });
      }
    }
  })(root, '');
  return out;
}

function isExcludedFile(relpath) {
  const base = path.basename(relpath).toLowerCase();
  if (cfg.excludedBasenames.includes(base)) return true;
  const parts = relpath.toLowerCase().split(/[\\/]/);
  for (const p of parts.slice(0, -1)) if (cfg.excludedDirs.includes(p)) return true;
  return false;
}

function isImage(relpath) { return IMAGE_EXTS.has(path.extname(relpath).toLowerCase()); }
function isEditableRaster(relpath) { return RASTER_EDITABLE.has(path.extname(relpath).toLowerCase()); }

function validUtf8(buf) {
  try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return true; } catch { return false; }
}

// Returns { text, enc } where enc in {'utf8','utf8bom','win1251'}
function readTextFile(abspath) {
  const buf = fs.readFileSync(abspath);
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return { text: iconv.decode(buf.slice(3), 'utf8'), enc: 'utf8bom' };
  }
  const head = buf.slice(0, 3000).toString('latin1');
  if (/charset\s*=\s*["']?\s*(windows-1251|cp1251)/i.test(head)) {
    return { text: iconv.decode(buf, 'win1251'), enc: 'win1251' };
  }
  if (validUtf8(buf)) return { text: iconv.decode(buf, 'utf8'), enc: 'utf8' };
  return { text: iconv.decode(buf, 'win1251'), enc: 'win1251' };
}

function writeTextFile(abspath, text, enc) {
  let buf;
  if (enc === 'win1251') buf = iconv.encode(text, 'win1251');
  else if (enc === 'utf8bom') buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), iconv.encode(text, 'utf8')]);
  else buf = iconv.encode(text, 'utf8');
  fs.writeFileSync(abspath, buf);
}

module.exports = { walkFiles, isExcludedFile, isImage, isEditableRaster, readTextFile, writeTextFile };
