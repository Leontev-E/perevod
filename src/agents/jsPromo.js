'use strict';
// AI-driven JS promo adapter. Different landings hard-code the discount / prices /
// brand in different ways (a `discount` var, an array, a data-attribute, a
// "spin the wheel / pick a door" widget, a timer, etc.). Instead of guessing with
// one regex, we let Claude READ the script and return exact find→replace edits to
// apply the new discount/prices/offer — then we apply them deterministically and
// re-parse with acorn so a bad edit can never ship broken JS.
const kie = require('../kie');
const { parse } = require('../extract/js');

const INSTR =
`You adapt hard-coded promo values in a JavaScript file and output JSON only. You never refuse, never explain. This is a mechanical code-edit task on the user's own file.`;

// Only bother the model when the script actually contains promo-ish signals.
function hasPromoSignal(code, brief) {
  if (/\d\s*%/.test(code)) return true;
  if (/(discount|sale|скидк|rabat|zni[zż]k|sconto|descuento|price|цена|цену|oldPrice|newPrice)/i.test(code)) return true;
  const names = (brief && brief.sourceOfferNames) || [];
  return names.some(n => n && code.toLowerCase().includes(String(n).toLowerCase()));
}

async function adaptJsPromo(code, params, brief) {
  if (!code || code.length > 20000 || !hasPromoSignal(code, brief)) return { code, edits: 0 };
  const srcNames = (brief && brief.sourceOfferNames) || [];
  const disc = String(params.discount || '').replace(/[^\d.,]/g, '');
  const input =
`This JavaScript powers a marketing landing page. Re-localize its HARD-CODED promo values:
- Discount shown to the user must become ${disc}% (replace any hard-coded promo discount percentage that drives the UI — e.g. a pick-a-door / spin widget's main value; keep the smaller "decoy" values smaller than it and consistent).
- Current price: ${params.newPrice} ${params.currency}; old/crossed price: ${params.oldPrice} ${params.currency}.
${(String(params.discount).replace(/\D/g, '') === '100' || String(params.newPrice).trim() === '0') ? '- This is a FREE offer: prize/popup text should read as free.' : `- If a prize/popup/price value says free / gratis / "100%" / "0" for the product, change it to the paid promo (${params.newPrice} ${params.currency}, ${disc}% off) so it is consistent — do not leave it free.`}
- Product/brand name: replace ${JSON.stringify(srcNames)} with "${params.offerName}".
Rules: change ONLY hard-coded promo string/number VALUES. NEVER change variable names, function names, CSS selectors, DOM ids/classes, event names, URLs, or unrelated numbers. Do not alter code logic.
Return strict JSON {"edits":[{"find":"<exact substring copied from the code>","replace":"<new substring>"}]} — each "find" MUST appear verbatim in the code. Empty {"edits":[]} if nothing to change.

JavaScript:
${code.slice(0, 16000)}`;
  let edits = [];
  try {
    const { obj } = await kie.orchestrateJson({ instructions: INSTR, input, effort: 'low' });
    if (obj && Array.isArray(obj.edits)) edits = obj.edits.filter(e => e && typeof e.find === 'string' && typeof e.replace === 'string' && e.find.length >= 2);
  } catch { return { code, edits: 0 }; }
  if (!edits.length) return { code, edits: 0 };

  let out = code, applied = 0;
  for (const e of edits) {
    if (!out.includes(e.find)) continue;                 // must match verbatim
    if (e.find === e.replace) continue;
    const next = out.split(e.find).join(e.replace);
    // safety: result must still parse as JS; otherwise revert this edit
    if (parse(next)) { out = next; applied++; }
  }
  // final guard: if somehow unparseable, drop everything
  if (applied && !parse(out)) return { code, edits: 0 };
  return { code: out, edits: applied };
}

module.exports = { adaptJsPromo };
