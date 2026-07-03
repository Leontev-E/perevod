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

module.exports = { maskPhp, splitPhp, isPlaceholderOnly, hasPlaceholder, PH_RE };
