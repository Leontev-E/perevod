'use strict';
// Apply the buyer's discount to values that the text pipeline can't touch:
// discount/sale variables in JS and data-attributes (e.g. `let discount = "99%"`
// driving an interactive "pick a door" widget). Targeted so it never rewrites
// unrelated numbers/percentages (like a "99% natural" claim).

// Names (multi-lang) that denote a promo discount variable/field.
const KEY = '(?:discount|sale|скидк[а-я]*|rabat[a-z]*|zni[zż]k[a-z]*|sconto|descuento|desconto|remise|indirim|ceny?rabat)';

function pct(discountRaw) {
  const s = String(discountRaw || '').trim();
  if (!s) return null;
  const m = s.match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const num = m[0];
  // Discounts are always rendered as "N%" in the UI, regardless of whether
  // the buyer typed the percent sign.
  return { num, pctStr: num + '%' };
}

function applyDiscount(content, discountRaw) {
  const p = pct(discountRaw);
  if (!p) return { content, hits: 0 };
  let hits = 0;
  let out = String(content);

  // 1) quoted percent value:  discount = "99%"  /  "sale": '-99 %'
  out = out.replace(new RegExp(`(\\b${KEY}\\w*\\s*[:=]\\s*)(['"])\\s*-?\\d+\\s*%\\s*(['"])`, 'gi'),
    (m, pre, q1) => { hits++; return `${pre}${q1}${p.pctStr}${q1}`; });

  // 2) quoted bare number:  discount = "99"
  out = out.replace(new RegExp(`(\\b${KEY}\\w*\\s*[:=]\\s*)(['"])\\s*-?\\d+\\s*(['"])`, 'gi'),
    (m, pre, q1) => { hits++; return `${pre}${q1}${p.num}${q1}`; });

  // 3) unquoted number:  discount = 99  /  "discount": 99
  out = out.replace(new RegExp(`(\\b${KEY}\\w*\\s*[:=]\\s*)(-?\\d+)(\\s*[;,)\\n\\r}]|$)`, 'gi'),
    (m, pre, n, tail) => { hits++; return `${pre}${p.num}${tail}`; });

  // 4) data-discount="99" / data-sale="99%"
  out = out.replace(new RegExp(`(data-(?:discount|sale)\\s*=\\s*)(['"])\\s*-?\\d+\\s*%?\\s*(['"])`, 'gi'),
    (m, pre, q1) => { hits++; return `${pre}${q1}${p.pctStr}${q1}`; });

  return { content: out, hits };
}

module.exports = { applyDiscount };
