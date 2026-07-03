'use strict';
// Per-file processor factory. Each processor exposes translatable `units`
// (each with a stable `id`) and an `apply(map)` that returns the rebuilt file
// content, mutating only text — never structure.
const path = require('path');
const { extractHtml } = require('./html');
const { extractJsUnits } = require('./js');
const { extractJson } = require('./json');
const { maskPhp } = require('./mask');

// Split a full-document source into [prologue][doc][epilogue] where doc runs from
// the first <!doctype / <html to the last </html>. Prologue/epilogue are kept
// byte-exact (they hold PHP guards, not translatable HTML). If no document
// wrapper is found, everything is treated as doc (a fragment/include).
function splitDocument(content) {
  const mDoc = content.match(/<!doctype/i) || content.match(/<html[\s>]/i);
  if (!mDoc) return { prologue: '', doc: content, epilogue: '' };
  const start = mDoc.index;
  const closeIdx = content.toLowerCase().lastIndexOf('</html>');
  const end = closeIdx >= 0 ? closeIdx + '</html>'.length : content.length;
  return { prologue: content.slice(0, start), doc: content.slice(start, end), epilogue: content.slice(end) };
}

function fileType(relpath) {
  const base = path.basename(relpath).toLowerCase();
  // Mirror/wget-saved assets keep a real content extension before a trailing
  // .html (e.g. css2.css.html, cross.svg.html, sprite.png.html, font.eot.html).
  // These are NOT real HTML — never run them through the HTML pipeline.
  if (/\.(css|scss|less|svg|png|jpe?g|webp|gif|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|pdf|zip|map|xml|txt)\.html?$/i.test(base)) return 'other';
  const ext = path.extname(relpath).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.php' || ext === '.phtml') return 'php';
  if (ext === '.js' || ext === '.mjs') return 'js';
  if (ext === '.json') return 'json';
  return 'other';
}

// content: string. Returns { type, units:[{id,kind,text,ctx}], apply(map)->{content,failures} } or null.
function makeFileProcessor(relpath, content) {
  const type = fileType(relpath);

  if (type === 'html') {
    const ex = extractHtml(content);
    return {
      type,
      units: ex.units,
      apply(map) {
        const { html, scriptFailures } = ex.applyAndSerialize(map);
        return { content: html, failures: scriptFailures };
      }
    };
  }

  if (type === 'php') {
    // Landings almost always start with a PHP prologue (redirect/guard) BEFORE
    // <!DOCTYPE html>. If we mask+parse the whole file, that leading placeholder
    // sits before the doctype and parse5 relocates <head> into <body> (breaks
    // viewport/charset/mobile layout). So we split off the verbatim prologue/
    // epilogue and only parse the <!doctype…</html> document in the middle.
    const { prologue, doc, epilogue } = splitDocument(content);
    let masked;
    try { masked = maskPhp(doc); }
    catch (e) { return { type, units: [], apply: () => ({ content, failures: ['php-mask-failed'] }), error: String(e.message || e) }; }
    const ex = extractHtml(masked.masked);
    return {
      type,
      units: ex.units,
      apply(map) {
        const { html, scriptFailures } = ex.applyAndSerialize(map);
        return { content: prologue + masked.restore(html) + epilogue, failures: scriptFailures };
      }
    };
  }

  if (type === 'json') {
    const ex = extractJson(content);
    return {
      type,
      units: ex.units,
      apply(map) { return ex.apply(map); }
    };
  }

  if (type === 'js') {
    const ex = extractJsUnits(content, 'j');
    if (!ex.ok) return { type, units: [], apply: () => ({ content, failures: ['js-parse-failed'] }) };
    return {
      type,
      units: ex.units.map(u => ({ id: u.localId, kind: 'js', text: u.text, ctx: 'js-file' })),
      apply(map) {
        const res = ex.rebuild(map);
        return { content: res.ok ? res.code : content, failures: res.ok ? [] : ['js-rebuild-failed'] };
      }
    };
  }

  return null; // 'other' — not processed
}

module.exports = { makeFileProcessor, fileType, splitDocument };
