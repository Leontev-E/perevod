'use strict';
// Self-improving memory: accumulated "house rules" the agents read on every job,
// plus new lessons appended when a job reveals a mistake. Stored on the data
// volume so it survives restarts/redeploys.
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const FILE = path.join(cfg.dataDir, 'lessons.json');

const SEED = [
  { scope: 'text', rule: 'The product/brand is renamed to the offer name. Never keep the source brand and never translate it into a descriptive phrase; use the offer name verbatim.' },
  { scope: 'text', rule: 'Localize ALL personal names, cities, country and phone codes to the target GEO. Use ONE consistent localized name for a recurring person (e.g. a doctor named in the header and in the dialogue must get the same localized name everywhere).' },
  { scope: 'text', rule: 'If the offer is free (price 0 or 100% off), never mix "free" with "discount/paid" wording; say it is free.' },
  { scope: 'text', rule: 'Make pricing consistent with the chosen params in BOTH directions: if the SOURCE is free/gratis/100%/0 but paid price+discount are set, convert it to that paid promo; never leave leftover "free/gratis/100%/0" for the product price.' },
  { scope: 'text', rule: 'Free-mode: a discount value and its "%" can live in SEPARATE nodes (e.g. <span>100</span>%). When the number becomes the free word, never leave an orphan "%" ("free%") — strip the trailing "%".' },
  { scope: 'text', rule: 'Localize a recurring person to ONE consistent name across header, chat and reviews (do not give the same doctor two different localized names).' },
  { scope: 'text', rule: 'Never translate CSS classes, ids, selectors, JS keys, event names, URLs or file names — only human-readable copy.' },
  { scope: 'image', rule: 'Keep review/lifestyle photos alive: edit the brand on the real photo (or composite the new package in); never replace a living photo with a flat studio pack. Do not touch badges, seals, icons, first-aid symbols or portraits without a product.' },
  { scope: 'image', rule: 'Write on-image text strictly in the TARGET language (not the local ethnic language) and keep the exact original dimensions.' },
  { scope: 'files', rule: 'Never run non-HTML assets through the HTML pipeline, incl. mirror-suffixed files like x.css.html / x.svg.html / x.png.html / font.eot.html.' },
  { scope: 'files', rule: 'Never touch api.php / error.php / success.php or the success/ error/ dictionary folders.' },
  { scope: 'structure', rule: 'Any edit (translation, geo-form, discount) must preserve the DOM skeleton; if it would change tags/structural attributes, roll it back.' },
  // Learned from a 37-offer training sweep (2026-07-03):
  { scope: 'structure', rule: 'When a form kit replaces the lead form, the order form is hidden until the kit game is played. The render-check must click the kit game element (.door-face / .spin-button / medboxes .box) before testing form visibility, otherwise a working kit looks broken.' },
  { scope: 'structure', rule: 'When a form kit replaces the lead form, the host page own JS often errors (Cannot read/set properties of null on .style/.textContent) because its old form/quiz targets are gone. This is expected swap noise, not a kit defect: funnel-depth changes and stale-ref JS errors are not regressions when a kit is in play; only flag a regression if the kit form itself is unreachable.' },
  { scope: 'text', rule: 'The same person can appear in several inflected/partial forms on a landing (e.g. "Jan Kowalski", "Kowalski", "dr Kowalski", "panem Janem Kowalskim"). The name glossary must GROUP all forms of one person into ONE canonical localized name, so a recurring doctor/testimonial author is never shown with two different names across the page.' },
  { scope: 'files', rule: 'When injecting a form kit, every hidden field of the original lead form must be carried over (sub1-5 plus any extras: price, country, goodID, flow, offer, subid, pay). Dropping a tracking/billing field silently breaks the lead pipeline.' }
];

function load() {
  try { const a = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (Array.isArray(a) && a.length) return a; } catch { /* seed */ }
  return SEED;
}

// Compact text block injected into agent prompts.
function promptBlock(scope) {
  const all = load().filter(l => !scope || l.scope === scope || l.scope === 'all');
  if (!all.length) return '';
  return 'HOUSE RULES (learned from past jobs — follow strictly):\n' + all.map((l, i) => `${i + 1}. ${l.rule}`).join('\n');
}

function add(scope, rule) {
  try {
    const cur = (() => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return SEED.slice(); } })();
    if (cur.some(l => l.rule === rule)) return false;
    cur.push({ scope: scope || 'all', rule, added: new Date().toISOString().slice(0, 10) });
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cur, null, 2));
    return true;
  } catch { return false; }
}

module.exports = { load, promptBlock, add, SEED, FILE };
