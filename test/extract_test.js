'use strict';
// Sanity test: extract units, apply a fake transform, verify structure is intact.
const fs = require('fs');
const path = require('path');
const { makeFileProcessor } = require('../src/extract');
const parse5 = require('parse5');

function countTags(html) {
  const doc = /<html[\s>]/i.test(html) ? parse5.parse(html) : parse5.parseFragment(html);
  const counts = {};
  (function walk(n) {
    if (n.tagName) counts[n.tagName] = (counts[n.tagName] || 0) + 1;
    const kids = n.content ? n.content.childNodes : (n.childNodes || []);
    kids.forEach(walk);
  })(doc);
  return counts;
}

function run(rel) {
  const abs = path.join(__dirname, 'sample', rel);
  const content = fs.readFileSync(abs, 'utf8');
  const p = makeFileProcessor(rel, content);
  console.log('\n===== ' + rel + '  (type=' + (p && p.type) + ') =====');
  if (!p) { console.log('  (not processed)'); return; }
  console.log('  units: ' + p.units.length);
  for (const u of p.units) {
    console.log(`   [${u.id}] (${u.kind}) ${JSON.stringify(u.text).slice(0, 70)}`);
  }
  // fake "translation": wrap each unit text with «» markers, preserve placeholders
  const map = {};
  for (const u of p.units) map[u.id] = '«' + u.text + '»';
  const { content: out, failures } = p.apply(map);
  if (failures && failures.length) console.log('  FAILURES:', failures);

  // structure check for html/php
  if (p.type === 'html' || p.type === 'php') {
    const before = countTags(content.replace(/<\?[\s\S]*?\?>/g, ''));
    const after = countTags(out.replace(/<\?[\s\S]*?\?>/g, ''));
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    let mism = 0;
    for (const k of keys) if ((before[k] || 0) !== (after[k] || 0)) { console.log(`  TAG MISMATCH ${k}: ${before[k]||0} -> ${after[k]||0}`); mism++; }
    console.log(mism === 0 ? '  ✓ tag counts preserved' : '  ✗ tag mismatch');
  }
  const outPath = abs + '.out';
  fs.writeFileSync(outPath, out);
  console.log('  wrote ' + outPath);
}

run('index.php');
run('js/app.js');
