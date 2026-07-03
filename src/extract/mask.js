'use strict';
// PHP <-> pseudo-HTML masking, using the real PHP tokenizer for a byte-exact split.
const { spawnSync } = require('child_process');
const path = require('path');
const cfg = require('../config');

const TOKENIZER = path.join(__dirname, '..', '..', 'php-helpers', 'tokenize.php');

// Placeholder is pure alphanumeric so it is valid inside HTML text, attribute
// values and even tag positions, and survives HTML parse/serialize untouched.
const PH = (i) => `KIEPHP${i}ENDK`;
const PH_RE = /KIEPHP(\d+)ENDK/g;

function splitPhp(source) {
  const res = spawnSync(cfg.phpBin, [TOKENIZER], {
    input: source, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
  });
  if (res.status !== 0 || !res.stdout) {
    throw new Error('php tokenize failed: ' + (res.stderr || res.error || 'unknown'));
  }
  return JSON.parse(res.stdout);
}

// Returns { masked, restore(maskedString) -> phpSource }
function maskPhp(source) {
  const segments = splitPhp(source);
  const codes = [];
  let masked = '';
  for (const seg of segments) {
    if (seg.t === 'html') {
      masked += seg.v;
    } else {
      const idx = codes.length;
      codes.push(seg.v);
      masked += PH(idx);
    }
  }
  const restore = (str) => str.replace(PH_RE, (m, n) => {
    const i = parseInt(n, 10);
    return (i >= 0 && i < codes.length) ? codes[i] : m;
  });
  return { masked, restore, codeCount: codes.length };
}

// True if a string is only placeholders and whitespace/punctuation glue —
// i.e. nothing worth translating.
function isPlaceholderOnly(text) {
  if (!text) return true;
  const stripped = text.replace(PH_RE, '').replace(/[\s .,;:!?%$€₽#\-–—+*/\\()\[\]{}"'`|]/g, '');
  return stripped.length === 0;
}

// True if a string contains at least one placeholder (so JS extraction must be skipped).
function hasPlaceholder(text) {
  PH_RE.lastIndex = 0;
  return PH_RE.test(text || '');
}

// Strip PHP code blocks from a .php/.phtml source so it can be rendered as a
// static HTML preview. Used by the /preview route and the render-checker.
//
// We prefer the REAL PHP tokenizer (via splitPhp + maskPhp) because a naive
// regex like /<\?[\s\S]*?\?>/g breaks on a `?>` appearing inside a PHP string
// or comment — common on real landings — and silently truncates the page.
// If php-cli is unavailable (e.g. a host without PHP), we fall back to a
// SAFER regex that skips `?>` while inside single/double-quoted strings and
// // # /* */ comments. It's not byte-perfect, but it's far more accurate than
// the old non-stateful strip.
function stripPhpSafe(source) {
  if (typeof source !== 'string' || !source) return source || '';
  try {
    const { masked } = maskPhp(source);
    // The masked HTML still contains KIEPHP<n>ENDK placeholders where PHP
    // blocks lived; for a PREVIEW we just drop them (they hold no HTML output).
    return masked.replace(/KIEPHP\d+ENDK/g, '');
  } catch (_e) {
    // Fallback: stateful scan aware of PHP string/comment contexts.
    return stripPhpFallback(source);
  }
}

// Stateful regex fallback: removes <?php ... ?> and <?= ... ?> blocks but
// ignores `?>` that occurs inside a PHP string literal or a comment, so a
// stray `?>` in `"text?>"` no longer ends the block prematurely.
function stripPhpFallback(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    // Detect an opening PHP tag: <?php or <?=
    if (source[i] === '<' && source[i + 1] === '?') {
      // walk until the matching closing ?>, respecting strings/comments
      let j = i + 2;
      let inStr = null; // '"' | "'" | null
      let inLineCmt = false;
      let inBlockCmt = false;
      while (j < n) {
        const c = source[j];
        if (inLineCmt) {
          if (c === '\n') inLineCmt = false;
          j++; continue;
        }
        if (inBlockCmt) {
          if (c === '*' && source[j + 1] === '/') { inBlockCmt = false; j += 2; continue; }
          j++; continue;
        }
        if (inStr) {
          if (c === '\\') { j += 2; continue; }
          if (c === inStr) inStr = null;
          j++; continue;
        }
        // not in a string/comment
        if (c === '?' && source[j + 1] === '>') { j += 2; break; } // end of PHP block
        if (c === '/' && source[j + 1] === '/') { inLineCmt = true; j += 2; continue; }
        if (c === '/' && source[j + 1] === '*') { inBlockCmt = true; j += 2; continue; }
        if (c === '"' || c === "'") { inStr = c; j++; continue; }
        j++;
      }
      i = j; // skip past the closing ?> (or end of file)
      continue;
    }
    out += source[i];
    i++;
  }
  return out;
}

module.exports = { maskPhp, splitPhp, isPlaceholderOnly, hasPlaceholder, stripPhpSafe, PH_RE };
