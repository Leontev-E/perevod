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

// Discount words as they attach to a percentage in prose (multi-lang), used to
// find natural-language promo phrases the variable-based applyDiscount misses —
// e.g. a pick-a-door / wheel prize or a fake "someone just won 50% off" popup:
// "Wygrał 50% rabatu", "descuento del 50%", "50% off".
const DISC_WORD = '(?:rabat\\w*|zni[zż]k\\w*|obni[zż]\\w*|discount\\w*|\\boff\\b|скидк\\w*|скидо\\w*|descuento\\w*|desconto\\w*|sconto\\w*|remise\\w*|indirim\\w*|kedvezm\\w*|slev\\w*|zľav\\w*|popust\\w*|nuolaid\\w*|atlaid\\w*|reducere\\w*|rabatt\\w*|korting\\w*)';

// FREE-offer promo normalization. When the offer is free (newPrice 0 / 100% off),
// ANY "N% discount" left in the copy (a door/wheel prize, a fake win-notification,
// a badge) contradicts "free". This rewrites every discount-adjacent percentage to
// 100% (= free) across HTML text, inline scripts AND .js — so a "won 50% off" prize
// can never survive on a free landing. No-op unless the offer is free.
function normalizePromoFree(content, params) {
  const isFree = String((params && params.newPrice) || '').trim().replace(',', '.').replace(/^0+(?=\d)/, '') === '0'
    || /(^|\D)100(\D|$)/.test(String((params && params.discount) || ''))
    || String((params && params.newPrice) || '').trim() === '0';
  if (!isFree) return { content, hits: 0 };
  const target = '100';
  let hits = 0, out = String(content);
  // "50% rabatu" / "50 % off" / "50% zniżki" (number → discount word within ~2 words)
  out = out.replace(new RegExp('(\\d{1,3})(\\s*%\\s*(?:[\\p{L}’\'-]+\\s+){0,2}?' + DISC_WORD + ')', 'giu'),
    (m, n, tail) => { if (n === target) return m; hits++; return target + tail; });
  // "rabat 50%" / "descuento del 50%" / "off 50 %" (discount word → number)
  out = out.replace(new RegExp('(' + DISC_WORD + '(?:\\s+[\\p{L}’\'-]+){0,2}?\\s+)(\\d{1,3})(\\s*%)', 'giu'),
    (m, pre, n, pct) => { if (n === target) return m; hits++; return pre + target + pct; });
  return { content: out, hits };
}

module.exports = { applyDiscount, normalizePromoFree };
