'use strict';
// Server-rendered pages. Modern light "3D / glassmorphism" look: soft aurora
// gradient backdrop with floating blurred orbs (mouse-parallax), frosted glass
// cards that float on layered shadows, gradient glowing buttons, 3D-tilt logo.
const { MAP, LANGUAGES } = require('./util/lang');

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">`;

const CSS = `
:root{--bg:#eaeefb;--ink:#181b2c;--muted:#6a7090;--line:rgba(24,27,44,.08);
--glass:rgba(255,255,255,.62);--glassbrd:rgba(255,255,255,.85);
--grad:linear-gradient(135deg,#6366f1 0%,#8b5cf6 48%,#ec4899 100%);
--grad2:linear-gradient(135deg,#06b6d4,#3b82f6);
--grad3:linear-gradient(135deg,#10b981,#06b6d4);
--ring:rgba(124,92,246,.28);
--shadow:0 24px 50px -18px rgba(46,42,120,.42),0 10px 24px -16px rgba(46,42,120,.30)}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;color:var(--ink);font:16px/1.55 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
background:radial-gradient(60vw 55vh at 82% -12%,rgba(139,92,246,.30),transparent 60%),radial-gradient(52vw 48vh at -12% 18%,rgba(6,182,212,.24),transparent 60%),radial-gradient(58vw 55vh at 50% 122%,rgba(236,72,153,.22),transparent 60%),var(--bg);background-attachment:fixed;min-height:100vh;overflow-x:hidden}
.orbw{position:fixed;z-index:0;pointer-events:none;will-change:transform;transition:transform .35s cubic-bezier(.2,.6,.2,1)}
#ow1{top:-140px;right:-90px}#ow2{bottom:-160px;left:-110px}#ow3{top:42%;left:56%}
.orb{border-radius:50%;filter:blur(64px);opacity:.5;animation:float 10s ease-in-out infinite}
.o1{width:440px;height:440px;background:radial-gradient(circle at 32% 30%,#8b5cf6,#6366f1 70%)}
.o2{width:380px;height:380px;background:radial-gradient(circle at 32% 30%,#22d3ee,#3b82f6 70%);animation-duration:12s}
.o3{width:320px;height:320px;background:radial-gradient(circle at 32% 30%,#f472b6,#f43f5e 70%);animation-duration:14s}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-26px)}}
.wrap{position:relative;z-index:1;max-width:940px;margin:0 auto;padding:26px 18px 76px}
a{color:#6d5cf6;text-decoration:none;font-weight:600}a:hover{color:#8b5cf6}
h1,h2,.disp{font-family:"Space Grotesk",Inter,system-ui,sans-serif;letter-spacing:-.02em;line-height:1.04;margin:0}
h1{font-size:clamp(26px,4.6vw,34px);font-weight:700}
h2{font-size:22px;font-weight:600;margin:0 0 8px}
.grad-text{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:6px 0 30px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:16px;color:inherit}
.logo{width:56px;height:56px;flex:none;display:flex;align-items:center;justify-content:center;background:var(--grad);color:#fff;font:700 26px "Space Grotesk",sans-serif;border-radius:18px;box-shadow:0 16px 32px -10px rgba(99,102,241,.75),inset 0 1px 0 rgba(255,255,255,.55);transition:transform .12s ease-out;will-change:transform}
.sub{font-size:13.5px;font-weight:500;color:var(--muted);margin-top:5px;max-width:540px}
.card{position:relative;background:var(--glass);-webkit-backdrop-filter:blur(26px) saturate(165%);backdrop-filter:blur(26px) saturate(165%);border:1px solid var(--glassbrd);border-radius:24px;padding:30px;box-shadow:var(--shadow),inset 0 1px 0 rgba(255,255,255,.9);transition:transform .2s ease,box-shadow .2s ease}
.card+.card{margin-top:20px}
.lift:hover{transform:translateY(-3px);box-shadow:0 30px 60px -18px rgba(46,42,120,.5),inset 0 1px 0 rgba(255,255,255,.9)}
label{display:block;font-weight:600;font-size:12.5px;color:#464c66;margin:0 0 8px;letter-spacing:.01em}
.hint{display:block;font-weight:500;color:var(--muted);font-size:12px;margin-top:5px}
input[type=text],input[type=password],input[type=number],input[type=file],select{width:100%;padding:13px 15px;border:1px solid var(--glassbrd);border-radius:13px;background:rgba(255,255,255,.72);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:var(--ink);font:500 15px Inter,system-ui,sans-serif;box-shadow:inset 0 1px 2px rgba(46,42,120,.06);transition:border-color .15s,box-shadow .15s}
input[type=file]{padding:10px 13px;font-weight:500}
input:focus,select:focus{outline:none;border-color:rgba(139,92,246,.75);box-shadow:0 0 0 4px var(--ring),inset 0 1px 2px rgba(46,42,120,.06)}
::placeholder{color:#9aa0bd;font-weight:500}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
.field{margin-bottom:16px}
.btn{display:inline-flex;align-items:center;gap:8px;background:var(--grad);color:#fff;border:0;border-radius:14px;padding:13px 22px;font:700 14.5px Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 12px 26px -10px rgba(99,102,241,.65),inset 0 1px 0 rgba(255,255,255,.4);transition:transform .14s ease,box-shadow .14s ease,filter .14s}
.btn:hover{transform:translateY(-2px);box-shadow:0 18px 34px -10px rgba(99,102,241,.7),inset 0 1px 0 rgba(255,255,255,.45);filter:brightness(1.05)}
.btn:active{transform:translateY(0);box-shadow:0 8px 18px -10px rgba(99,102,241,.6)}
.btn[disabled]{opacity:.6;cursor:not-allowed;transform:none;filter:grayscale(.2)}
.btn.blue{background:var(--grad2);box-shadow:0 12px 26px -10px rgba(59,130,246,.6),inset 0 1px 0 rgba(255,255,255,.4)}
.btn.green{background:var(--grad3);box-shadow:0 12px 26px -10px rgba(16,185,129,.6),inset 0 1px 0 rgba(255,255,255,.4)}
.btn.ghost{background:rgba(255,255,255,.7);color:#3d4260;border:1px solid var(--glassbrd);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);box-shadow:0 10px 22px -12px rgba(46,42,120,.35)}
.btn.ghost:hover{filter:none;background:rgba(255,255,255,.9)}
.big{font-size:15.5px;padding:15px 28px;border-radius:16px}
.drop{border:2px dashed rgba(124,92,246,.4);border-radius:18px;padding:38px 20px;text-align:center;color:var(--muted);background:rgba(255,255,255,.42);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);cursor:pointer;transition:.15s}
.drop:hover{border-color:rgba(124,92,246,.6);background:rgba(255,255,255,.6)}
.drop.drag{border-color:#8b5cf6;border-style:solid;background:rgba(139,92,246,.12)}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.pill{display:inline-flex;align-items:center;gap:6px;padding:6px 13px;border-radius:999px;font-weight:600;font-size:12px;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.6)}
.pill::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor}
.pill.ok{background:rgba(16,185,129,.14);color:#059669}.pill.run{background:rgba(99,102,241,.14);color:#5b52e6}.pill.err{background:rgba(239,68,68,.14);color:#dc2626}.pill.warn{background:rgba(245,158,11,.16);color:#b45309}
.log{background:rgba(255,255,255,.58);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);color:#3a3f57;border:1px solid var(--glassbrd);border-radius:16px;box-shadow:var(--shadow);padding:18px;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;max-height:440px;overflow:auto;white-space:pre-wrap}
.log .l-step{color:#6d28d9;font-weight:700}
.log .l-file{color:#047857}.log .l-image{color:#be185d}.log .l-warn{color:#b45309}.log .l-error{color:#dc2626}.log .l-done{color:#047857;font-weight:700}
.muted{color:var(--muted);font-weight:500}
.kv{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding:11px 2px;font-weight:600}
.imgcmp{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
.imgcmp figure{margin:0}.imgcmp img{width:100%;border-radius:12px;border:1px solid var(--glassbrd);box-shadow:0 10px 24px -14px rgba(46,42,120,.4);background:#fff}
.imgcmp figcaption{font-size:12px;font-weight:600;color:var(--muted);margin-top:6px;text-align:center}
.note{font-size:13px;font-weight:500;color:var(--muted);margin-top:12px}
.foot{margin-top:32px;text-align:center;font-size:12.5px;font-weight:500;color:var(--muted)}
.alert{background:rgba(255,251,235,.82);border:1px solid rgba(251,191,36,.5);border-radius:14px;padding:14px 16px;font-weight:500;font-size:13.5px;color:#92400e;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);box-shadow:0 10px 24px -14px rgba(180,83,9,.4)}
.alert.ok{background:rgba(236,253,245,.85);border-color:rgba(16,185,129,.4);color:#065f46;box-shadow:0 10px 24px -14px rgba(5,150,105,.4)}
.tag{display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,.72);border:1px solid var(--glassbrd);color:#6d28d9;font-weight:600;font-size:12px;padding:6px 13px;border-radius:999px;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);box-shadow:0 8px 18px -12px rgba(46,42,120,.4)}
.tag::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--grad);box-shadow:0 0 10px rgba(139,92,246,.7)}
@media(max-width:640px){.grid3{grid-template-columns:1fr}.card{padding:22px;border-radius:20px}}
@media(prefers-reduced-motion:reduce){.orb{animation:none}.orbw{transition:none}}
`;

const PARALLAX = `<script>
(function(){var rm=matchMedia('(prefers-reduced-motion:reduce)').matches;if(rm)return;
var ows=[['ow1',34],['ow2',-26],['ow3',20]].map(function(a){return{el:document.getElementById(a[0]),k:a[1]};});
var logo=document.getElementById('heroLogo');
addEventListener('mousemove',function(e){var cx=e.clientX/innerWidth-.5,cy=e.clientY/innerHeight-.5;
ows.forEach(function(o){if(o.el)o.el.style.transform='translate('+(cx*o.k).toFixed(1)+'px,'+(cy*o.k).toFixed(1)+'px)';});
if(logo)logo.style.transform='perspective(520px) rotateX('+(cy*-15).toFixed(1)+'deg) rotateY('+(cx*15).toFixed(1)+'deg)';});
addEventListener('mouseleave',function(){if(logo)logo.style.transform='';});})();
</script>`;

function layout(title, body, opts) {
  const o = opts || {};
  const action = o.home === false ? `<a class="btn blue" href="/">＋ Новый</a>` : '';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Перевод лендингов</title>
${FONTS}<style>${CSS}</style></head><body>
<div class="orbw" id="ow1"><div class="orb o1"></div></div><div class="orbw" id="ow2"><div class="orb o2"></div></div><div class="orbw" id="ow3"><div class="orb o3"></div></div>
<div class="wrap">
<div class="top">
  <a class="brand" href="/">
    <div class="logo" id="heroLogo">П</div>
    <div><h1><span class="grad-text">Перевод лендингов</span></h1><div class="sub">Загрузите лендинг — получите готовую версию под нужное ГЕО. Тексты, цены, формы и картинки адаптированы, вёрстка остаётся целой.</div></div>
  </a>
  <div class="row">${action}<a class="btn ghost" href="/settings">⚙ Настройки</a></div>
</div>
${body}
<div class="foot">Локализация лендингов под любое ГЕО · <a href="/settings">ключ kie.ai</a> · <a href="/logout" onclick="return confirm('Выйти?')">выйти</a></div>
</div>${PARALLAX}</body></html>`;
}

function loginPage(err) {
  return layout('Вход', `<div class="card lift" style="max-width:430px;margin:9vh auto">
<div class="tag" style="margin-bottom:16px">Личный доступ</div>
<h2>С возвращением</h2>
<div class="note" style="margin:0 0 18px">Введите пароль, чтобы продолжить.</div>
<form method="post" action="/login">
<div class="field"><label>Пароль</label><input type="password" name="password" autofocus required></div>
${err ? `<div class="alert" style="margin-bottom:16px">Неверный пароль. Попробуйте ещё раз.</div>` : ''}
<button class="btn big" type="submit">Войти →</button></form></div>`);
}

function optionList(selected) {
  return Object.keys(MAP)
    .sort((a, b) => MAP[a].name.localeCompare(MAP[b].name, 'ru'))
    .map(cc => `<option value="${cc}"${cc === selected ? ' selected' : ''}>${esc(MAP[cc].name)} (${cc})</option>`)
    .join('');
}

function uploadPage(opts) {
  const noKey = opts && opts.hasKey === false;
  const banner = noKey
    ? `<div class="alert" style="margin-bottom:18px">Ключ kie.ai не задан — без него перевод не запустится. <a href="/settings"><b>Указать ключ →</b></a></div>`
    : '';
  return layout('Новый перевод', `${banner}<div class="card">
<div class="tag" style="margin-bottom:18px">Новый перевод</div>
<form method="post" action="/upload" enctype="multipart/form-data" id="f">
  <div class="field">
    <label>Лендинг (.zip)</label>
    <div class="drop" id="drop"><input type="file" name="archive" id="file" accept=".zip" required style="display:none">
      <div id="dropmsg" class="disp" style="font-size:19px;font-weight:600;color:var(--ink)">Перетащите ZIP сюда</div>
      <div style="margin-top:6px">или <a href="#" id="pick">выберите файл</a></div></div>
    <span class="hint">Загрузите архив целиком. Файлы api.php, error.php, success.php и папки success/ error/ не трогаем — это рабочая механика лендинга.</span>
  </div>
  <div class="grid3">
    <div class="field"><label>Страна (ГЕО)</label><select name="country" id="country">${optionList('ES')}</select></div>
    <div class="field"><label>Язык</label><input type="text" name="language" id="language" list="langs" placeholder="Spanish" required autocomplete="off">
      <datalist id="langs">${LANGUAGES.map(l => `<option value="${esc(l)}">`).join('')}</datalist></div>
    <div class="field"><label>Валюта</label><input type="text" name="currency" id="currency" placeholder="EUR" required></div>
  </div>
  <div class="grid3">
    <div class="field"><label>Алфавит</label>
      <select name="script" id="script"><option value="auto">Авто (как принято в языке)</option><option value="cyrillic">Кириллица</option><option value="latin">Латиница</option><option value="arabic">Арабская вязь</option></select>
      <span class="hint">Если у языка их несколько — узбекский, казахский, сербский…</span></div>
    <div class="field" style="grid-column:span 2"><label>Название оффера</label><input type="text" name="offerName" placeholder="Например: ArtroFlex" required>
      <span class="hint">Как назвать продукт в переводе — подставим везде: в текст, формы и на картинки.</span></div>
  </div>
  <div class="grid3">
    <div class="field"><label>Цена сейчас</label><input type="text" name="newPrice" placeholder="49" required></div>
    <div class="field"><label>Цена до скидки</label><input type="text" name="oldPrice" placeholder="98" required></div>
    <div class="field"><label>Скидка</label><input type="text" name="discount" placeholder="50%" required></div>
  </div>
  <div class="field">
    <label>Фото оффера <span class="hint" style="display:inline">— по желанию</span></label>
    <input type="file" name="offerPhotos" accept="image/*" multiple>
    <span class="hint">Реальные фото нового продукта — ими заменим товар на лендинге (баннеры с текстом переводим отдельно). Без них продуктовые фото останутся как есть.</span>
  </div>
  <div class="field"><label class="row" style="font-weight:600;font-size:14px;color:var(--ink)"><input type="checkbox" name="translateImages" checked style="width:auto;height:18px"> Переводить и адаптировать картинки</label></div>
  <button class="btn big" type="submit" id="go">Перевести лендинг →</button>
  <div class="note">Дальше всё в фоне: распакуем, переведём под ГЕО, адаптируем картинки и цены, соберём готовый ZIP. Прогресс — на следующем экране.</div>
</form></div>
<script>
var DEF=${JSON.stringify(MAP)};
var country=document.getElementById('country'),lang=document.getElementById('language'),cur=document.getElementById('currency');
function applyDef(){var d=DEF[country.value];if(d){if(!lang.value||lang.dataset.auto)lang.value=d.language,lang.dataset.auto=1;if(!cur.value||cur.dataset.auto)cur.value=d.currency,cur.dataset.auto=1;}}
country.addEventListener('change',function(){lang.dataset.auto=1;cur.dataset.auto=1;applyDef();});
lang.addEventListener('input',function(){lang.dataset.auto='';});cur.addEventListener('input',function(){cur.dataset.auto='';});
applyDef();
var drop=document.getElementById('drop'),file=document.getElementById('file'),msg=document.getElementById('dropmsg');
document.getElementById('pick').onclick=function(e){e.preventDefault();file.click();};
file.onchange=function(){if(file.files[0])msg.textContent='📦 '+file.files[0].name+' ('+Math.round(file.files[0].size/1024)+' КБ)';};
['dragover','dragenter'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.add('drag');});});
['dragleave','drop'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.classList.remove('drag');});});
drop.addEventListener('drop',function(e){if(e.dataTransfer.files[0]){file.files=e.dataTransfer.files;file.onchange();}});
document.getElementById('f').addEventListener('submit',function(){var g=document.getElementById('go');g.disabled=true;g.textContent='Загружаем…';});
</script>`);
}

function jobPage(job) {
  const p = job.params;
  return layout('Перевод', `<div class="card">
  <div class="row" style="justify-content:space-between">
    <div style="font-weight:600"><b>${esc(p.offerName)}</b> → <b>${esc(p.country)} / ${esc(p.language)}</b> · ${esc(p.newPrice)} ${esc(p.currency)} <span class="muted">(было ${esc(p.oldPrice)}, скидка ${esc(p.discount)})</span></div>
    <span class="pill run" id="status">${esc(job.status)}</span>
  </div>
  <div id="result" style="margin-top:16px"></div>
  <div class="log" id="log" style="margin-top:16px"></div>
</div>
<script>
var JOB=${JSON.stringify(job.id)};
var logEl=document.getElementById('log'),statusEl=document.getElementById('status'),resEl=document.getElementById('result');
function line(ev){var cls='l-'+(ev.type||'');var pre=ev.type==='step'?'▶ ':(ev.type==='warn'?'⚠ ':(ev.type==='error'?'✖ ':(ev.type==='file'?'':(ev.type==='image'?'':(ev.type==='done'?'✔ ':'· ')))));var d=document.createElement('div');d.className=cls;d.textContent=pre+(ev.msg||'');logEl.appendChild(d);logEl.scrollTop=logEl.scrollHeight;}
function setStatus(s){var m={done:'готово',error:'ошибка',running:'в работе',queued:'в очереди'};statusEl.textContent=m[s]||s;statusEl.className='pill '+(s==='done'?'ok':(s==='error'?'err':'run'));}
function showResult(r){if(!r)return;var h='<div class="card lift" style="box-shadow:0 24px 50px -18px rgba(5,150,105,.4),inset 0 1px 0 rgba(255,255,255,.9)"><div class="tag" style="margin-bottom:14px;color:#059669">Готово</div><h2>Готово 🎉</h2><div class="row" style="margin-top:14px"><a class="btn green" href="'+r.zip+'">⬇ Скачать ZIP</a> <a class="btn blue" href="'+r.preview+'" target="_blank">👁 Превью</a> <a class="btn ghost" href="/">＋ Новый перевод</a></div>';
if(r.report&&r.report.render&&r.report.render.verdict){var rv=r.report.render;if(rv.verdict==='regression'){h+='<div class="alert" style="margin-top:16px">Возможно, где-то поехал элемент — на всякий случай откройте превью и проверьте глазами.</div>';}else if(rv.verdict==='ok'){h+='<div class="alert ok" style="margin-top:16px">Проверили в настоящем браузере — вёрстка и форма на месте.</div>';}}
if(r.report&&r.report.totals){var t=r.report.totals;h+='<div style="margin-top:16px"><div class="kv"><span>Переведено фрагментов</span><b>'+(t.units-(t.missing||0))+' / '+t.units+'</b></div><div class="kv"><span>Откатов (защита вёрстки)</span><b>'+(t.filesRolledBack||0)+'</b></div><div class="kv"><span>Картинок обновлено</span><b>'+(t.imagesChanged||0)+' / '+(t.imagesTotal||0)+'</b></div></div>';}
if(r.report&&r.report.images){var imgs=r.report.images.filter(function(i){return i.changed;});if(imgs.length){h+='<div style="margin-top:18px"><b>Картинки: до / после</b>';imgs.forEach(function(i){h+='<div class="imgcmp"><figure><img src="'+i.original+'"><figcaption>до'+(i.kind==='product-replaced'?' · продукт':'')+'</figcaption></figure><figure><img src="'+i.preview+'"><figcaption>после</figcaption></figure></div>';});h+='</div>';}
var kept=r.report.images.filter(function(i){return i.kind==='product-kept';});if(kept.length){h+='<div class="alert" style="margin-top:16px">Продуктовые фото оставили без изменений ('+kept.map(function(i){return esc(i.relpath);}).join(', ')+'). Чтобы заменить их на реальный товар — загрузите «Фото оффера» и запустите заново.</div>';}}
h+='</div>';resEl.innerHTML=h;}
function esc(s){return String(s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
var es=new EventSource('/events/'+JOB);
es.onmessage=function(e){var ev=JSON.parse(e.data);if(ev.type==='status'){setStatus(ev.status);}else{line(ev);}if(ev.type==='done'&&ev.result){setStatus('done');showResult(ev.result);es.close();}if(ev.type==='error'){setStatus('error');es.close();}};
es.onerror=function(){};
</script>`, { home: false });
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function settingsPage(o) {
  o = o || {};
  const msg = o.saved ? `<div class="alert ok" style="margin-bottom:16px">✔ Готово, ключ сохранён.</div>`
    : (o.nokey ? `<div class="alert" style="margin-bottom:16px">Сначала укажите ключ kie.ai — без него перевод не запустится.</div>` : '');
  const cur = o.masked
    ? `<div class="note" style="margin:0 0 14px">Сейчас установлен: <b>${esc(o.masked)}</b> — введите новый, чтобы заменить. Пустое поле = оставить как есть.</div>`
    : `<div class="note" style="margin:0 0 14px">Ключ ещё не задан.</div>`;
  return layout('Настройки', `${msg}<div class="card lift" style="max-width:660px">
  <div class="tag" style="margin-bottom:16px">Доступ</div>
  <h2>Ключ kie.ai</h2>
  <div class="note" style="margin:0 0 18px">Ключ хранится на сервере и переживает обновления. Получить или пополнить: <a href="https://kie.ai?ref=f5a044e67d35962c997eed6db4e5aa75" target="_blank" rel="noopener">kie.ai</a> → API Keys.</div>
  ${cur}
  <form method="post" action="/settings">
    <div class="field"><label>Новый ключ</label>
      <input type="text" name="kieKey" placeholder="вставьте ключ" autocomplete="off" spellcheck="false" ${o.masked ? '' : 'autofocus'}></div>
    <button class="btn big" type="submit">Сохранить</button>
  </form>
</div>`);
}

module.exports = { layout, loginPage, uploadPage, jobPage, settingsPage };
