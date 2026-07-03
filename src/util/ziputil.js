'use strict';
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

// Safe extract with zip-slip protection. Returns the root dir that actually
// contains the site (unwraps a single top-level wrapper folder).
function extractZip(zipPath, destDir) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  fs.mkdirSync(destDir, { recursive: true });
  for (const e of entries) {
    const target = path.resolve(destDir, e.entryName);
    if (!target.startsWith(path.resolve(destDir) + path.sep) && target !== path.resolve(destDir)) {
      throw new Error('zip-slip blocked: ' + e.entryName);
    }
    if (e.isDirectory) { fs.mkdirSync(target, { recursive: true }); continue; }
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
