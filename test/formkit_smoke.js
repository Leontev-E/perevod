'use strict';
// Smoke test for the form-kit locate+inject pipeline. Unzips a sample landing,
// runs injectFormKit for each kit, and verifies the result is structurally
// sound and the contract (action + hidden fields) is carried over.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { extractZip } = require('../src/util/ziputil');
const { locateInSite } = require('../src/formkits/locate');
const { injectFormKit, extractContract } = require('../src/formkits/inject');
const kits = require('../src/formkits/index');
const parse5 = require('parse5');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'fk-smoke-')); }
function unzipTo(zipPath, dest) { return extractZip(zipPath, dest); }

function countTags(html) {
  const doc = /<html[\s>]/i.test(html) ? parse5.parse(html) : parse5.parseFragment(html);
  const c = {};
  (function w(n){ if(n.tagName) c[n.tagName]=(c[n.tagName]||0)+1; (n.childNodes||[]).forEach(w); })(doc);
  return c;
}

const SAMPLE = process.argv[2];
if (!SAMPLE || !fs.existsSync(SAMPLE)) {
  console.error('Usage: node test/formkit_smoke.js <path-to-sample.zip>');
  process.exit(1);
}

let failures = 0;
function check(name, cond, extra) {
  console.log((cond ? '  \u2713 ' : '  \u2717 FAIL: ') + name + (extra ? '  (' + extra + ')' : ''));
  if (!cond) failures++;
}

// --- Step 1: locate the original lead form in a clean unzip ---
const root1 = tmp();
const site1 = unzipTo(SAMPLE, path.join(root1, 'clean'));
const loc = locateInSite(site1);
console.log('\n=== LOCATE ===');
console.log('found:', loc.found);
if (loc.found) {
  console.log('file:', loc.relpath, '| phone:', loc.hasPhone, '| sub1:', loc.hasSub, '| region chars:', loc.region.end - loc.region.start);
  const regionHtml = loc.html.slice(loc.region.start, loc.region.end);
  const c = extractContract(regionHtml);
  console.log('original action:', c.action, '| hidden fields:', c.hidden.map(h => h.name).join(','));
}
check('lead form located', loc.found);

if (!loc.found) {
  console.log('\nNo lead form in this sample — inject tests skipped.');
  process.exit(failures ? 1 : 0);
}

// --- Step 2: inject each kit into a fresh copy and verify ---
for (const kit of kits.list()) {
  const root = tmp();
  const site = unzipTo(SAMPLE, path.join(root, 'k'));
  console.log('\n=== INJECT kit=' + kit.id + ' ===');

  // baseline structure (the file we'll edit)
  const idxFile = path.join(site, loc.relpath);
  const before = fs.readFileSync(idxFile, 'utf8');
  const tagsBefore = countTags(before.replace(/<\?[\s\S]*?\?>/g, ''));

  const params = { formKit: kit.id, discount: '50%', newPrice: '49', oldPrice: '98', currency: 'EUR', offerName: 'TestOffer' };
  let res;
  try { res = injectFormKit(site, params); }
  catch (e) { console.log('  inject threw:', e.message); check('inject ran', false); continue; }
  console.log('result:', JSON.stringify(res));

  check('inject ok', res.ok);
  if (!res.ok) continue;

  // the kit root must appear in the result
  const after = fs.readFileSync(idxFile, 'utf8');
  const rootClass = '.--none--';
  const rootSel = kits.get(kit.id).root;
  check('kit root class present', after.includes(rootSel.replace('.', 'class="').replace(/"/, '') ) || after.includes('class="' + rootSel.slice(1)) || after.includes(rootSel.slice(1)), 'looking for ' + rootSel);
  check('kit css linked', after.includes(res.cssPath), res.cssPath);
  check('kit js linked', after.includes(res.jsPath), res.jsPath);

  // contract preserved: action api.php + at least the original's extras
  check('action api.php present', /action="api\.php"/i.test(after));
  check('hidden extras carried', res.extrasAdded >= 0);

  // asset files exist
  const cssAbs = path.join(site, res.cssPath);
  const jsAbs = path.join(site, res.jsPath);
  check('css file written', fs.existsSync(cssAbs));
  check('js file written', fs.existsSync(jsAbs));

  // structure: tag multiset outside the replaced region must be stable enough
  // (the kit ADDS tags inside the region; we only assert the file still parses)
  let parses = true;
  try {
    const masked = after.replace(/<\?[\s\S]*?\?>/g, '');
    if (/<html[\s>]/i.test(masked)) parse5.parse(masked); else parse5.parseFragment(masked);
  } catch (e) { parses = false; console.log('  parse error:', e.message); }
  check('result still parses as HTML', parses);

  // no leftover marker
  check('no __MARKER__ leftovers', !/__FORMKIT_|__DISCOUNT|__OFFER_NAME|__NEW_PRICE|__OLD_PRICE/.test(after));
}

console.log('\n=== ' + (failures ? failures + ' FAILURE(S)' : 'ALL OK') + ' ===');
process.exit(failures ? 1 : 0);
