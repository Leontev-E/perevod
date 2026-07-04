'use strict';
const fs = require('fs');
const path = require('path');
const pLimit = require('p-limit');
const cfg = require('./config');
const jobsStore = require('./jobs');
const { extractZip, zipDir } = require('./util/ziputil');
const files = require('./util/files');
const { makeFileProcessor } = require('./extract');
const { compareStructure } = require('./verify/structure');
const { renderCheck, compareRenders } = require('./verify/render');
const geoforms = require('./geoforms');
const kie = require('./kie');
const { applyDiscount } = require('./discount');
const { adaptJsPromo } = require('./agents/jsPromo');
const textAgent = require('./agents/textAgent');
const controller = require('./agents/controller');
const imageAgent = require('./agents/imageAgent');
const lessons = require('./lessons');
const { injectFormKit } = require('./formkits/inject');

function log(id, type, msg, extra) { jobsStore.emit(id, Object.assign({ type, msg }, extra)); }

async function runJob(job) {
  const id = job.id;
  const dir = jobsStore.jobDir(id);
  const outDir = path.join(dir, 'out');
  const backupDir = path.join(dir, 'originals');
  fs.mkdirSync(backupDir, { recursive: true });
  const report = { files: [], images: [], totals: {}, credits: 0 };

  // Optional real product photo(s) of the new offer, uploaded by the buyer.
  const offerPhotos = loadOfferPhotos(path.join(dir, 'offer'));

  try {
    jobsStore.setStatus(id, 'running');
    log(id, 'step', 'Распаковка архива…');
    const siteRoot = extractZip(path.join(dir, 'upload.zip'), outDir);
    job.siteRoot = siteRoot;

    // ---- 0.5 form-kit replacement (optional) ----
    // If the buyer asked to swap the lead form for a kit (door/wheel/medboxes),
    // do it BEFORE the scan so the kit markup is translated + gated + rendered
    // like any other part of the site. Graceful: a miss/throw never aborts the job.
    if (job.params.formKit) {
      try {
        const fk = injectFormKit(siteRoot, job.params, offerPhotos);
        if (fk.ok) log(id, 'progress', `Замена формы: kit «${fk.kit}» вставлен в ${fk.file} (перенесено ${fk.hiddenFieldsCarried} скрытых полей, ${fk.extrasAdded} доп.). Стили/JS изолированы, форма пройдёт через перевод и проверку.`);
        else log(id, 'warn', `Замена формы пропущена: ${fk.reason}. Сайт переводится как есть.`);
      } catch (e) {
        log(id, 'warn', `Замена формы: ${e.message}. Сайт переводится как есть.`);
      }
    }

    // ---- 1. scan ----
    log(id, 'step', 'Сканирование файлов…');
    const all = files.walkFiles(siteRoot);
    const textFiles = [], imageFiles = [];
    let excludedCount = 0;
    for (const f of all) {
      if (files.isExcludedFile(f.relpath)) { excludedCount++; continue; }
      const ext = path.extname(f.relpath).toLowerCase();
      if (['.html', '.htm', '.php', '.phtml', '.js', '.mjs', '.json'].includes(ext)) textFiles.push(f);
      else if (files.isEditableRaster(f.relpath)) imageFiles.push(f);
    }
    log(id, 'progress', `Файлов всего: ${all.length}; на перевод текста: ${textFiles.length}; картинок: ${imageFiles.length}; исключено (api/error/success): ${excludedCount}`);

    // ---- 2. build processors + collect units ----
    const perFile = [];
    let gidCounter = 0;
    const allUnits = [];
    for (let i = 0; i < textFiles.length; i++) {
      const f = textFiles[i];
      let read;
      try { read = files.readTextFile(f.abspath); } catch (e) { log(id, 'warn', `Не прочитан ${f.relpath}: ${e.message}`); continue; }
      let proc;
      try { proc = makeFileProcessor(f.relpath, read.text); } catch (e) { log(id, 'warn', `Пропуск ${f.relpath}: ${e.message}`); continue; }
      if (!proc) continue;
      const nUnits = (proc.units && proc.units.length) || 0;
      // Keep files even with 0 translatable units IF they may need promo/geo edits
      // (e.g. doors.js holds only `discount="99%"`; a php form with only a country
      // <select>). Skip truly irrelevant zero-unit files to save work.
      const needsPost = /\d\s*%|discount|sale|скидк|rabat|price|цена|initialCountry|country|phone|тел/i.test(read.text);
      if (nUnits === 0 && !needsPost) continue;
      const units = (proc.units || []).map(u => {
        const gid = 'g' + (gidCounter++);
        allUnits.push({ gid, text: u.text, ctx: u.ctx, kind: u.kind });
        return Object.assign({ gid }, u);
      });
      perFile.push({ relpath: f.relpath, abspath: f.abspath, type: proc.type, enc: read.enc, originalText: read.text, processor: proc, units });
    }
    log(id, 'progress', `Текстовых фрагментов на перевод: ${allUnits.length} в ${perFile.length} файлах`);

    if (allUnits.length === 0 && imageFiles.length === 0) {
      throw new Error('В архиве не найдено переводимого контента.');
    }

    // ---- 3. localization brief (GPT 5.5) ----
    log(id, 'step', 'Изучаем лендинг и готовим план перевода…');
    const sampleTexts = allUnits.slice(0, 300).map(u => u.text);
    const imageNames = imageFiles.map(f => path.basename(f.relpath));
    const brief = await controller.buildBrief(job.params, sampleTexts, imageNames);
    const pricingMode = computePricingMode(job.params);
    brief.pricingMode = pricingMode;
    if (!brief.localeRules) brief.localeRules = {};
    if (!brief.localeRules.phonePrefix) brief.localeRules.phonePrefix = dialCode(job.params.country);
    if (brief.sourceLanguageGuess) log(id, 'progress', `Исходный язык (оценка): ${brief.sourceLanguageGuess}`);
    if (brief.sourceOfferNames && brief.sourceOfferNames.length) log(id, 'progress', `Имя оффера в источнике: ${brief.sourceOfferNames.join(', ')} → ${job.params.offerName}`);
    log(id, 'progress', `Режим цены: ${pricingMode === 'free' ? 'БЕСПЛАТНО' : 'скидка'} · гео: ${brief.localeRules.countryNativeName || job.params.country}, тел ${brief.localeRules.phonePrefix || ''}`);
    if (brief.notes) log(id, 'progress', `Заметки к переводу: ${brief.notes}`);
    job.brief = brief;

    // ---- 4. translate all text (Claude Sonnet 5 -> GPT 5.5 fallback) ----
    log(id, 'step', 'Переводим и локализуем тексты под ГЕО…');
    const { translations, missing } = await textAgent.translateUnits(allUnits, job.params, brief, (ev) => log(id, ev.type, ev.msg));
    if (missing.length) log(id, 'warn', `Не переведено фрагментов: ${missing.length} (оставлены как есть)`);

    // deterministic safety net: force the old brand -> new offer name everywhere.
    // Only blind-replace brand-like names that actually RECUR in the source (>=3x),
    // so a one-off review author name or stray phrase is never corrupted.
    const srcJoined = allUnits.map(u => u.text).join('\n');
    const brandFreq = (name) => { try { const m = srcJoined.match(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')); return m ? m.length : 0; } catch { return 0; } };
    const brandNames = filterBrandNames(brief.sourceOfferNames || [], job.params.offerName).filter(n => brandFreq(n) >= 3);
    if (brandNames.length) log(id, 'progress', `Замена бренда (детерм.): ${brandNames.join(', ')} → ${job.params.offerName}`);
    if (brandNames.length) {
      let hits = 0;
      for (const gid of Object.keys(translations)) {
        const before = translations[gid];
        const after = replaceBrands(before, brandNames, job.params.offerName);
        if (after !== before) { translations[gid] = after; hits++; }
      }
      if (hits) log(id, 'progress', `Детерминированная замена бренда: ${hits} фрагм.`);
    }

    // free-mode: kill leftover "with a discount" wording (contradicts a free offer)
    if (pricingMode === 'free') {
      const lr = brief.localeRules || {};
      const freeWord = (lr.freeWord || 'бесплатно').trim();
      const phrases = (Array.isArray(lr.discountPhrases) ? lr.discountPhrases : [])
        .map(s => String(s || '').trim()).filter(s => s.length >= 4).sort((a, b) => b.length - a.length);
      if (phrases.length) {
        let fhits = 0;
        for (const gid of Object.keys(translations)) {
          let v = translations[gid], changed = false;
          for (const p of phrases) { const nv = v.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => m === m.toUpperCase() ? freeWord.toUpperCase() : freeWord); if (nv !== v) { v = nv; changed = true; } }
          if (changed) { translations[gid] = v; fhits++; }
        }
        if (fhits) log(id, 'progress', `Free-режим: «со скидкой»→«${freeWord}» в ${fhits} фрагм.`);
      }
    }

    // ---- 5. apply per file + deterministic structural gate + GPT QA ----
    log(id, 'step', 'Вносим перевод и следим, чтобы вёрстка не поехала…');
    const reviewLimit = pLimit(3);
    await Promise.all(perFile.map((pf) => reviewLimit(async () => {
      await applyAndVerifyFile(id, pf, translations, job.params, brief, backupDir, siteRoot, report);
    })));

    // ---- 6. images (Claude vision -> GPT Image 2 -> resize guard) ----
    // Only touch images actually referenced by the site (html/php/js/json/css),
    // so we don't spend credits on orphan export artifacts (e.g. _preview.png).
    let imagesToDo = imageFiles;
    if (imageFiles.length) {
      const refBlob = buildReferenceBlob(all);
      const referenced = imageFiles.filter(f => isReferenced(f.relpath, refBlob));
      if (referenced.length) {
        if (referenced.length < imageFiles.length) log(id, 'progress', `Картинок по ссылкам: ${referenced.length}/${imageFiles.length} (orphan-файлы пропущены)`);
        imagesToDo = referenced;
      }
    }
    // Detect images that sit INSIDE a review/testimonial/comments block (by
    // scanning the source HTML for <img> within .comments__item / .review /
    // .otzyv etc.). Such photos must NEVER be flat-replaced with the offer pack
    // — they are user-generated review photos and must stay alive (brand-edit
    // in place). Filename heuristics miss numeric names like 108.jpg.
    const reviewImages = collectReviewImages(all, siteRoot);
    if (offerPhotos.length) log(id, 'progress', `Загружено фото оффера: ${offerPhotos.length} — продуктовые изображения будут заменены`);
    if (job.params.translateImages !== false && imagesToDo.length) {
      log(id, 'step', 'Переводим и подгоняем картинки…');
      await processImages(id, imagesToDo, siteRoot, backupDir, job.params, brief, report, offerPhotos, reviewImages);
    } else {
      log(id, 'progress', 'Картинки пропущены (отключено).');
    }

    // ---- 6.5 render-reviewer: browser-based regression check (orchestrator helper) ----
    let renderVerdict = { verdict: 'skipped' };
    try {
      log(id, 'step', 'Открываем результат в настоящем браузере и сверяем с оригиналом…');
      const origTmp = path.join(dir, '_render_orig');
      try { fs.rmSync(origTmp, { recursive: true, force: true }); } catch { /* noop */ }
      const oroot = extractZip(path.join(dir, 'upload.zip'), origTmp);
      const ro = await renderCheck(oroot, path.join(dir, 'render_orig.png'));
      const rt = await renderCheck(siteRoot, path.join(dir, 'render_out.png'));
      renderVerdict = compareRenders(ro, rt, { formKit: !!job.params.formKit });
      try { fs.rmSync(origTmp, { recursive: true, force: true }); } catch { /* noop */ }
      if (renderVerdict.verdict === 'regression') {
        log(id, 'warn', `⚠ Проверка в браузере: что-то могло поехать — ${JSON.stringify({ newErrors: renderVerdict.newErrors, funnel: renderVerdict.origBubbles + '→' + renderVerdict.outBubbles, formLost: renderVerdict.formLost }).slice(0, 220)}`);
        // Self-improving memory: a concrete regression becomes a house rule the
        // agents read on future jobs. Keep the rule generic + actionable.
        try {
          const bits = [];
          if (renderVerdict.newErrors && renderVerdict.newErrors.length) bits.push(`introduced new JS errors: ${renderVerdict.newErrors.slice(0, 3).join('; ')}`);
          if (renderVerdict.funnelRegressed) bits.push(`funnel depth dropped (${renderVerdict.origBubbles}→${renderVerdict.outBubbles})`);
          if (renderVerdict.formLost) bits.push('order form became unreachable');
          if (bits.length) lessons.add('structure', `A past localized landing showed a browser regression: ${bits.join('; ')}. When editing similar files, double-check the affected selectors/JS still fire and the form stays reachable.`);
        } catch { /* never let a lesson write break the job */ }
      }
      else if (renderVerdict.verdict === 'ok') log(id, 'progress', `Проверка в браузере: всё на месте (шаги ${renderVerdict.origBubbles}→${renderVerdict.outBubbles}, форма ${renderVerdict.outForm ? 'видна' : 'нет'}, новых ошибок 0)`);
      else log(id, 'progress', `Проверка в браузере пропущена (${renderVerdict.note || 'нет браузера'})`);
    } catch (e) { log(id, 'warn', `Проверка в браузере: ${e.message}`); }
    report.render = renderVerdict;

    // ---- 7. repack + preview ----
    log(id, 'step', 'Сборка ZIP и превью…');
    const zipPath = path.join(dir, 'result.zip');
    zipDir(siteRoot, zipPath);

    // ---- 8. final sign-off ----
    const summary = {
      files: report.files.map(f => ({ f: f.relpath, changed: f.changed, rolledBack: f.rolledBack, structure: f.structureOk, verdict: f.controllerVerdict })),
      images: report.images.map(i => ({ f: i.relpath, changed: i.changed })),
      missing: missing.length
    };
    const signoff = await controller.finalSignoff(summary);

    report.totals = {
      textFiles: perFile.length,
      units: allUnits.length,
      missing: missing.length,
      filesRolledBack: report.files.filter(f => f.rolledBack).length,
      imagesChanged: report.images.filter(i => i.changed).length,
      imagesTotal: imageFiles.length
    };
    job.result = {
      zip: `/download/${id}`,
      preview: `/preview/${id}/`,
      report, signoff
    };
    jobsStore.setStatus(id, 'done', { statusMsg: signoff.message || 'Готово' });
    log(id, 'done', 'Готово! Архив собран.', { result: job.result });
    jobsStore.persist(job);
  } catch (e) {
    job.error = String(e && e.stack || e);
    jobsStore.setStatus(id, 'error', { statusMsg: String(e && e.message || e) });
    log(id, 'error', 'Ошибка: ' + (e && e.message || e));
    jobsStore.persist(job);
  }
}

async function applyAndVerifyFile(id, pf, translations, params, brief, backupDir, siteRoot, report) {
  const rec = { relpath: pf.relpath, type: pf.type, changed: 0, rolledBack: false, structureOk: true, controllerVerdict: 'n/a' };
  // build local map
  const map = {};
  let changed = 0;
  const changes = [];
  for (const u of pf.units) {
    const t = translations[u.gid];
    if (t != null && t !== u.text) { map[u.id] = t; changed++; if (changes.length < 200) changes.push({ id: u.id, before: u.text.slice(0, 120), after: String(t).slice(0, 120) }); }
    else if (t != null) { map[u.id] = t; }
  }
  // Start from the original; only run the (parse5) apply when there are actual
  // translations, so zero-unit files (e.g. doors.js) still reach the promo/geo
  // passes without an unnecessary re-serialization round-trip.
  let applied = { content: pf.originalText, failures: [] };
  if (changed > 0) {
    try { applied = pf.processor.apply(map); }
    catch (e) { log(id, 'warn', `apply ${pf.relpath} упал: ${e.message}`); rec.rolledBack = true; report.files.push(rec); return; }
    // deterministic structural gate (html/php only)
    if (pf.type === 'html' || pf.type === 'php') {
      const cmp = compareStructure(pf.originalText, applied.content, pf.type);
      rec.structureOk = cmp.ok;
      if (!cmp.ok) {
        rec.rolledBack = true;
        log(id, 'warn', `Структура ${pf.relpath} изменилась — файл ОТКАЧЕН к оригиналу (${JSON.stringify(cmp.tagDiffs).slice(0, 120)})`);
        // Record the structural drift so future runs learn what to avoid.
        try {
          const d = cmp.tagDiffs && cmp.tagDiffs[0];
          if (d) lessons.add('structure', `A translated ${pf.type} file changed its DOM skeleton (${d.tag}: ${d.before}→${d.after}) and had to be rolled back. Prefer translations that keep the same tag/attribute structure; if a fragment would change markup, leave it untouched.`);
        } catch { /* noop */ }
        report.files.push(rec);
        return; // leave the original file on disk untouched
      }
    }
  }

  // Orchestrator polish pass: rewrite the translated fragments to be natural,
  // human, consistent (offer name, geo, no free/discount contradictions) and
  // fully in the target language. Applied only if structure still holds.
  if (changes.length) {
    try {
      const fragments = pf.units
        .filter(u => map[u.id] != null)
        .map(u => ({ id: u.id, src: String(u.text).slice(0, 300), cur: String(map[u.id]).slice(0, 300) }));
      const { improved } = await controller.polishFile(pf.relpath, fragments, params, brief, brief.pricingMode);
      const nImproved = Object.keys(improved).length;
      if (nImproved) {
        const trial = Object.assign({}, map);
        for (const k of Object.keys(improved)) trial[k] = improved[k];
        const reApplied = pf.processor.apply(trial);
        let ok = true;
        if (pf.type === 'html' || pf.type === 'php') ok = compareStructure(pf.originalText, reApplied.content, pf.type).ok;
        if (ok) { applied = reApplied; Object.assign(map, improved); rec.controllerVerdict = `polished ${nImproved}`; log(id, 'file', `✎ ${pf.relpath}: доработали ${nImproved} фрагм.`); }
        else { rec.controllerVerdict = 'polish-skipped-structure'; log(id, 'warn', `Polish ${pf.relpath} сломал бы структуру — пропущен`); }
      } else { rec.controllerVerdict = 'ok'; }
    } catch (e) { log(id, 'warn', `Polish ${pf.relpath}: ${e.message}`); }
  }

  // Apply the buyer's discount to promo values the text pipeline can't see.
  // (1) deterministic regex for common `discount = "99%"` patterns (all files);
  // (2) AI JS-promo agent for .js files — reads the script and adapts discount/
  // prices/brand however THIS landing hard-codes them (safe: re-parsed after).
  if (params.discount) {
    const d = applyDiscount(applied.content, params.discount);
    if (d.hits) { applied.content = d.content; log(id, 'progress', `Скидка → ${params.discount}% в ${pf.relpath} (${d.hits} мест)`); }
  }
  if (pf.type === 'js') {
    try {
      const r = await adaptJsPromo(applied.content, params, brief);
      if (r.edits) { applied.content = r.code; rec.promoEdits = r.edits; log(id, 'progress', `Обновили промо в скрипте ${pf.relpath} (${r.edits} правок)`); }
    } catch (e) { log(id, 'warn', `JS-промо ${pf.relpath}: ${e.message}`); }
  }

  // geo-adapt the lead form (country <select> default, phone prefix, hidden
  // country) — intentional structural edit, after the translation gate.
  if (pf.type === 'html' || pf.type === 'php') {
    try {
      const geo = geoforms.adaptForms(applied.content, pf.type, params, (brief && brief.localeRules) || {});
      if (geo.changes.length) {
        // structural gate on the geo edit itself — never ship a geo change that
        // alters the DOM skeleton (defends against a bad serialize/round-trip).
        if (compareStructure(applied.content, geo.content, pf.type).ok) {
          applied.content = geo.content; log(id, 'progress', `Гео-форма ${pf.relpath}: ${geo.changes.join('; ')}`);
        } else { log(id, 'warn', `Гео-форма ${pf.relpath} изменила бы структуру — пропущена`); }
      }
    } catch (e) { log(id, 'warn', `Гео-форма ${pf.relpath}: ${e.message}`); }
  }

  // free-mode cleanup: a discount value split from its "%" (e.g. <span>100</span>%)
  // becomes "<freeWord></span>%" after we convert the number to "free" — leaving a
  // nonsensical orphan "%". Strip a "%" that directly follows the free word
  // (optionally across one closing tag / whitespace).
  if (brief && brief.pricingMode === 'free') {
    const fw = ((brief.localeRules && brief.localeRules.freeWord) || 'бесплатно').trim();
    if (fw) {
      const esc = fw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp('(' + esc + ')(\\s*</[^>]{1,40}>)?[\\s\\u00a0]*%', 'gi');
      const nv = applied.content.replace(re, '$1$2');
      if (nv !== applied.content) { applied.content = nv; log(id, 'progress', `Free-режим: убран орфан «%» после «${fw}» в ${pf.relpath}`); }
    }
  }

  // nothing actually changed (no translation, no promo/geo edit) -> leave file as-is
  if (applied.content === pf.originalText) { rec.changed = 0; report.files.push(rec); return; }

  // backup original then write
  try {
    const bpath = path.join(backupDir, pf.relpath);
    fs.mkdirSync(path.dirname(bpath), { recursive: true });
    fs.copyFileSync(pf.abspath, bpath);
  } catch { /* noop */ }
  files.writeTextFile(pf.abspath, applied.content, pf.enc);
  rec.changed = changed;
  if (applied.failures && applied.failures.length) log(id, 'warn', `${pf.relpath}: ${applied.failures.length} JS/JSON фрагм. не применены (safety)`);
  log(id, 'file', `✓ ${pf.relpath}: переведено ${changed} фрагм.${rec.promoEdits ? ', промо-правок ' + rec.promoEdits : ''}${rec.controllerVerdict !== 'n/a' ? ' · ' + rec.controllerVerdict : ''}`);
  report.files.push(rec);
}

async function processImages(id, imageFiles, siteRoot, backupDir, params, brief, report, offerPhotos, reviewImages) {
  // group png/webp/jpg siblings by dir+basename(no ext)
  const groups = new Map();
  for (const f of imageFiles) {
    const ext = path.extname(f.relpath);
    const key = f.relpath.slice(0, -ext.length);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(Object.assign({ ext: ext.toLowerCase() }, f));
  }

  const limit = pLimit(cfg.imageConcurrency);
  let edited = 0, analyzed = 0, skipped = 0, replaced = 0, left = 0;
  const hasOfferPhoto = offerPhotos && offerPhotos.length > 0;
  const groupList = [...groups.values()];

  // Upload the buyer's offer photo once so lifestyle/review photos can have the
  // NEW offer package composited into the living scene (not just relabeled).
  let offerRefUrl = null;
  if (hasOfferPhoto) {
    try { offerRefUrl = await kie.uploadBase64(offerPhotos[0], 'offerref.png', 'image/png', 'perevod-src'); }
    catch (e) { log(id, 'warn', `Загрузка референс-фото оффера: ${e.message}`); }
  }

  async function writeGroup(grp, primary, buf, dims) {
    backupFile(primary.abspath, primary.relpath, backupDir);
    fs.writeFileSync(primary.abspath, buf);
    for (const sib of grp.slice(1)) {
      try {
        backupFile(sib.abspath, sib.relpath, backupDir);
        const reBuf = await imageAgent.reencode(buf, sib.ext, dims);
        fs.writeFileSync(sib.abspath, reBuf);
      } catch (e) { log(id, 'warn', `Сиблинг ${sib.relpath}: ${e.message}`); }
    }
  }

  await Promise.all(groupList.map((grp) => limit(async () => {
    // The hard cap covers BOTH edited and replaced images, so an offer with many
    // product_hero slots can't burn unlimited credits. analyzed/left/skipped are
    // not billed AI edits, so they don't count toward the cap.
    if ((edited + replaced) >= cfg.maxImages) { skipped++; return; }
    // pick primary raster to analyze/edit
    const order = { '.png': 0, '.jpg': 1, '.jpeg': 1, '.webp': 2 };
    grp.sort((a, b) => (order[a.ext] ?? 9) - (order[b.ext] ?? 9));
    const primary = grp[0];
    let buf;
    try { buf = fs.readFileSync(primary.abspath); } catch { return; }
    const mime = imageAgent.mimeForExt(primary.ext);

    // skip tiny icons
    let dims;
    try { dims = await imageAgent.meta(buf); } catch { dims = { width: 0, height: 0 }; }
    if ((dims.width && dims.width < 64) && (dims.height && dims.height < 64)) { skipped++; return; }

    let analysis;
    try { analysis = await imageAgent.analyzeImage(buf, mime, params); analyzed++; }
    catch (e) { log(id, 'warn', `Анализ ${primary.relpath}: ${e.message}`); return; }

    const rec = { relpath: primary.relpath, changed: false, reason: analysis.note || '', category: analysis.category };
    const hasWords = (analysis.textItems || []).some(t => /\p{L}{2,}/u.test(String(t)));
    // Review/testimonial images stay "alive" — always edit in place, never flat-replace.
    // Detect by BOTH filename heuristic AND DOM context (image sits inside a
    // .comments__item / .review / .otzyv block) — the DOM check catches numeric
    // names like 108.jpg that the filename regex misses.
    const reviewSet = reviewImages || new Set();
    const relPosix = primary.relpath.split(path.sep).join('/');
    const isReviewImg = /otz|otziv|otzyv|review|testimon|feedback|foto|photo\d/i.test(primary.relpath)
      || reviewSet.has(relPosix)
      || reviewSet.has(path.basename(relPosix));

    // product_hero (clean isolated product shot): replace with the buyer's real
    // offer photo when provided — the only case where flat replacement is right.
    if (analysis.category === 'product_hero' && hasOfferPhoto && !isReviewImg) {
      try {
        const outBuf = await imageAgent.fitReplace(offerPhotos[0], dims, dims.format || primary.ext.replace('.', ''));
        await writeGroup(grp, primary, outBuf, dims);
        rec.changed = true; rec.kind = 'product-replaced';
        rec.preview = `/preview/${id}/${primary.relpath}`;
        rec.original = `/original/${id}/${primary.relpath}`;
        replaced++;
        log(id, 'image', `✓ ${primary.relpath}: главный продукт заменён на фото оффера`);
      } catch (e) { log(id, 'warn', `Замена продукта ${primary.relpath}: ${e.message}`); rec.reason = 'replace failed: ' + e.message; }
      report.images.push(rec);
      return;
    }

    // NO offer photo uploaded: never attempt to relabel/redraw a product image.
    // product_hero (the package/jar itself) and lifestyle (a person holding the
    // package) both depict the OLD product. GPT Image 2 cannot cleanly rewrite a
    // brand on a small jar label, so a "relabel" pass leaves a half-changed,
    // inconsistent brand on the same old package — worse than leaving it alone.
    // Only pure text graphics (banners, discount %) are translated here. The
    // right fix is for the buyer to upload the offer photo; without it, product
    // images pass through untouched.
    if (!hasOfferPhoto && (analysis.category === 'product_hero' || analysis.category === 'lifestyle')) {
      left++; rec.kind = 'left-no-offer-photo';
      log(id, 'image', `↩ ${primary.relpath} (${analysis.category}): пропущено — нет фото оффера, продукт оставлен как есть`);
      report.images.push(rec);
      return;
    }

    // Everything with words or a brand name (lifestyle/review photos, banners,
    // product shots without an offer photo, labelled diagrams): EDIT in place so
    // the real photo stays alive — never flat-replace. Badges/decor/logos/person-
    // only (no words, no brand) are left untouched.
    if (!(hasWords || analysis.brandOnImage)) { left++; rec.kind = 'left'; report.images.push(rec); return; }
    if ((edited + replaced) >= cfg.maxImages) { skipped++; report.images.push(rec); return; }

    try {
      const what = analysis.category === 'lifestyle' ? 'живое фото: смена бренда' : (analysis.brandOnImage ? 'текст+бренд' : 'перевод текста');
      log(id, 'image', `Картинка ${primary.relpath} (${analysis.category}): ${what}…`);
      const res = await imageAgent.editImage(buf, path.basename(primary.relpath), mime, analysis, params, brief, { offerRefUrl });
      report.credits += res.credits || 0;
      await writeGroup(grp, primary, res.buffer, res.dims);
      rec.changed = true; rec.kind = 'edited'; rec.via = res.via;
      rec.preview = `/preview/${id}/${primary.relpath}`;
      rec.original = `/original/${id}/${primary.relpath}`;
      edited++;
      log(id, 'image', `✓ ${primary.relpath} адаптирована через ${res.via}${grp.length > 1 ? ' (+' + (grp.length - 1) + ' вариант)' : ''}`);
    } catch (e) {
      log(id, 'warn', `Правка ${primary.relpath}: ${e.message}`);
      rec.reason = 'edit failed: ' + e.message;
    }
    report.images.push(rec);
  })));

  log(id, 'progress', `Картинки: проанализировано ${analyzed}, отредактировано ${edited}, продукт заменён на фото оффера ${replaced}, оставлено без изменений ${left}, пропущено ${skipped}. Кредиты kie.ai: ~${report.credits.toFixed(1)}`);
}

const REF_SCAN_EXT = new Set(['.html', '.htm', '.php', '.phtml', '.js', '.mjs', '.json', '.css']);
function buildReferenceBlob(all) {
  let blob = '';
  for (const f of all) {
    const ext = path.extname(f.relpath).toLowerCase();
    if (!REF_SCAN_EXT.has(ext)) continue;
    try { blob += '\n' + fs.readFileSync(f.abspath, 'latin1'); } catch { /* noop */ }
    if (blob.length > 8 * 1024 * 1024) break;
  }
  return blob;
}
function isReferenced(relpath, blob) {
  const base = path.basename(relpath);
  return blob.includes(base) || blob.includes(relpath.replace(/\\/g, '/'));
}

function computePricingMode(params) {
  const np = String(params.newPrice || '').trim().toLowerCase();
  const disc = String(params.discount || '').trim();
  const priceFree = np === '' || np === '0' || np === '0.0' || np === 'free' || np === 'бесплатно' || /^0[.,]0*$/.test(np);
  const discFull = /(^|\D)100\s*%?/.test(disc);
  return (priceFree || discFull) ? 'free' : 'discount';
}

const { dialCode } = require('./util/lang');

// Keep only brand-like names (multi-word / has digits / multi-caps), length>=4,
// distinct from the new offer name — safe for a blind case-insensitive replace.
function filterBrandNames(names, offerName) {
  const on = String(offerName || '').trim().toLowerCase();
  const out = [];
  for (const raw of names || []) {
    const n = String(raw || '').trim();
    if (n.length < 4) continue;
    if (n.toLowerCase() === on) continue;
    const brandLike = /\s/.test(n) || /\d/.test(n) || /[A-ZА-Я].*[A-ZА-Я]/.test(n);
    if (brandLike) out.push(n);
  }
  return out.sort((a, b) => b.length - a.length); // longest first
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function replaceBrands(text, names, offerName) {
  let out = String(text);
  for (const n of names) out = out.replace(new RegExp(escapeRe(n), 'gi'), offerName);
  return out;
}

function loadOfferPhotos(dir) {
  const out = [];
  try {
    for (const name of fs.readdirSync(dir)) {
      const ext = path.extname(name).toLowerCase();
      if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        try { out.push(fs.readFileSync(path.join(dir, name))); } catch { /* noop */ }
      }
    }
  } catch { /* no offer dir */ }
  return out;
}

function backupFile(abspath, relpath, backupDir) {
  try {
    const bpath = path.join(backupDir, relpath);
    fs.mkdirSync(path.dirname(bpath), { recursive: true });
    if (!fs.existsSync(bpath)) fs.copyFileSync(abspath, bpath);
  } catch { /* noop */ }
}

// Scan the site's HTML/PHP for <img> that lives INSIDE a review/testimonial/
// comments block, and return the set of their relative paths (posix). Such
// photos are user-generated and must NEVER be flat-replaced with the offer
// studio pack — the filename-only heuristic in processImages misses numeric
// names (108.jpg). We detect the enclosing review container by class.
const REVIEW_CONTAINER_RE = /class="[^"]*\b(comments?(?:__\w+)?|reviews?(?:__\w+)?|otzyv\w*|otz\w*|testimon\w*|feedback|recalls?|client[-_]?(?:photo|review|comment))\b[^"]*"/i;
function collectReviewImages(allFiles, siteRoot) {
  const out = new Set();
  const htmlFiles = allFiles.filter(f => /\.(html?|php|phtml)$/i.test(f.relpath));
  for (const f of htmlFiles) {
    let src;
    try { src = fs.readFileSync(f.abspath, 'utf8'); } catch { continue; }
    // Walk: split by review-container opening tags; for each container, grab
    // the imgs up to the matching close (best-effort depth count on the
    // container tag). Cheaper than a full parse and good enough here.
    const re = /<(\w+)[^>]*class="[^"]*\b(?:comments?(?:__\w+)?|reviews?(?:__\w+)?|otzyv\w*|otz\w*|testimon\w*|feedback|recalls?|client[-_]?(?:photo|review|comment))\b[^"]*"[^>]*>/gi;
    let m;
    while ((m = re.exec(src))) {
      const tag = m[1];
      const blockStart = m.index;
      // find matching close by depth counting this tag
      let depth = 1, pos = m.index + m[0].length;
      const openRe = new RegExp('<' + tag + '\\b', 'gi');
      const closeRe = new RegExp('</' + tag + '\\s*>', 'gi');
      while (depth > 0 && pos < src.length) {
        openRe.lastIndex = pos;
        closeRe.lastIndex = pos;
        const o = openRe.exec(src);
        const c = closeRe.exec(src);
        if (c === null) break;
        if (o !== null && o.index < c.index) { depth++; pos = o.index + o[0].length; }
        else { depth--; pos = c.index + c[0].length; }
      }
      const block = src.slice(blockStart, pos);
      // collect img src within this review block
      const imgRe = /<img[^>]+src="([^"]+)"|<img[^>]+src='([^']+)'/gi;
      let im;
      while ((im = imgRe.exec(block))) {
        let p = (im[1] || im[2] || '').trim();
        if (!p || /^data:/i.test(p)) continue;
        // normalise to posix relative (strip leading ./ ../ and query/hash)
        p = p.replace(/[?#].*$/, '');
        out.add(p.split('/').filter(x => x && x !== '.').join('/'));
      }
    }
  }
  return out;
}

module.exports = { runJob };
