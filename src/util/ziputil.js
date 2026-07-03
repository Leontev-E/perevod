'use strict';
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

// Safe extract with zip-slip protection. Returns the root dir that actually
// contains the site (unwraps a single top-level wrapper folder).
function extractZip(zipPath, destDir) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const base = path.resolve(destDir);
  const prefix = base + path.sep;
  fs.mkdirSync(destDir, { recursive: true });
  for (const e of entries) {
    // Normalise entry separators (zip entries always use '/'); a backslash in
    // a name is a legit file character on Windows but path.resolve treats it
    // as a separator, which is exactly what a zip-slip attack exploits.
    const safeName = e.entryName.replace(/\\/g, '/');
    const target = path.resolve(base, safeName);
    // Hard zip-slip guard: resolved target must be base itself or under it.
    if (target !== base && !target.startsWith(prefix)) {
      throw new Error('zip-slip blocked: ' + e.entryName);
    }
    // isDirectory is a METHOD on AdmZip entries (a plain property lookup is
    // always truthy on the function object). Call it to detect dir entries.
    const isDir = typeof e.isDirectory === 'function' ? e.isDirectory() : e.isDirectory;
    if (isDir) { fs.mkdirSync(target, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, e.getData());
  }
  return unwrapRoot(destDir);
}

// If the archive is a single folder containing everything, use that folder.
function unwrapRoot(destDir) {
  const entries = fs.readdirSync(destDir, { withFileTypes: true }).filter(e => e.name !== '__MACOSX');
  if (entries.length === 1 && entries[0].isDirectory()) {
    const inner = path.join(destDir, entries[0].name);
    // only unwrap if the inner dir holds an index-ish file
    const innerFiles = fs.readdirSync(inner).map(s => s.toLowerCase());
    if (innerFiles.some(f => /^index\.(php|html?|phtml)$/.test(f)) || innerFiles.length > 2) return inner;
  }
  return destDir;
}

function zipDir(srcDir, zipPath) {
  const zip = new AdmZip();
  zip.addLocalFolder(srcDir);
  zip.writeZip(zipPath);
  return zipPath;
}

module.exports = { extractZip, zipDir };
