'use strict';
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const ui = require('./ui');
const jobsStore = require('./jobs');
const pipeline = require('./pipeline');
const settings = require('./settings');
const { stripPhpSafe } = require('./extract/mask');
const { defaultsFor } = require('./util/lang');

const app = express();
app.disable('x-powered-by');
app.use(cookieParser(cfg.sessionSecret));
app.use(express.urlencoded({ extended: true }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: cfg.maxUploadMb * 1024 * 1024 } });

// ---- auth ----
function isAuthed(req) { return req.signedCookies && req.signedCookies.auth === '1'; }
function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  return res.redirect('/login');
}

app.get('/health', (req, res) => res.type('text').send('ok'));

// ---- brute-force throttle on /login ----
// No external dep: a small in-memory per-IP failure tracker. After MAX_FAILS
// within the window, the IP is locked out for a cooldown that grows with
// repeated lockouts. Sufficient for a single-tenant gate on a public domain.
const LOGIN_MAX_FAILS = parseInt(process.env.LOGIN_MAX_FAILS || '5', 10);
const LOGIN_WINDOW_MS = parseInt(process.env.LOGIN_WINDOW_MS || String(10 * 60 * 1000), 10); // 10 min
const LOGIN_BASE_LOCK_MS = parseInt(process.env.LOGIN_BASE_LOCK_MS || String(60 * 1000), 10); // 1 min
const loginFails = new Map(); // ip -> { count: n, first: ts, lockedUntil: ts, locks: n }
function clientIp(req) {
  // Behind Apache reverse-proxy; trust X-Forwarded-For leftmost when present.
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  return req.ip || req.socket.remoteAddress || 'unknown';
}
function loginLockState(ip, now) {
  const r = loginFails.get(ip);
  if (!r) return { locked: false };
  if (r.lockedUntil && r.lockedUntil > now) return { locked: true, retryAfterMs: r.lockedUntil - now };
  return { locked: false };
}
function noteLoginFail(ip, now) {
  let r = loginFails.get(ip);
  if (!r || (r.first && now - r.first > LOGIN_WINDOW_MS)) r = { count: 0, first: now, locks: 0 };
  r.count++;
  if (r.count >= LOGIN_MAX_FAILS) {
    // Exponential-ish backoff: 1m, 2m, 4m ... capped at 15m.
    r.locks = (r.locks || 0) + 1;
    const lockMs = Math.min(LOGIN_BASE_LOCK_MS * Math.pow(2, r.locks - 1), 15 * 60 * 1000);
    r.lockedUntil = now + lockMs;
    r.count = 0; // window resets after a lock so a legit user isn't punished forever
  }
  loginFails.set(ip, r);
}
function clearLoginFails(ip) { loginFails.delete(ip); }

app.get('/login', (req, res) => {
  const st = loginLockState(clientIp(req), Date.now());
  if (st.locked) {
    res.setHeader('Retry-After', Math.ceil(st.retryAfterMs / 1000));
    return res.status(429).type('text').send('Слишком много попыток. Попробуйте позже.');
  }
  res.send(ui.loginPage(req.query.e));
});
app.post('/login', (req, res) => {
  const ip = clientIp(req);
  const st = loginLockState(ip, Date.now());
  if (st.locked) {
    res.setHeader('Retry-After', Math.ceil(st.retryAfterMs / 1000));
    return res.status(429).type('text').send('Слишком много попыток. Попробуйте позже.');
  }
  // trim() so a stray space/newline from copy-paste never blocks a correct password
  if ((req.body.password || '').trim() === (cfg.password || '').trim()) {
    clearLoginFails(ip);
    res.cookie('auth', '1', { signed: true, httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
    return res.redirect('/');
  }
  noteLoginFail(ip, Date.now());
  return res.redirect('/login?e=1');
});
app.post('/logout', (req, res) => { res.clearCookie('auth'); res.redirect('/login'); });
app.get('/logout', (req, res) => { res.clearCookie('auth'); res.redirect('/login'); });

// ---- settings (kie.ai API key) ----
app.get('/settings', requireAuth, (req, res) => {
  res.send(ui.settingsPage({ masked: settings.maskedKieKey(), saved: req.query.saved, nokey: req.query.nokey }));
});
app.post('/settings', requireAuth, (req, res) => {
  const key = (req.body.kieKey || '').trim();
  if (key) settings.set({ kieKey: key });   // blank submit keeps the current key
  res.redirect('/settings?saved=1');
});

// ---- pages ----
app.get('/', requireAuth, (req, res) => res.send(ui.uploadPage({ hasKey: settings.hasKieKey() })));

const uploadFields = upload.fields([{ name: 'archive', maxCount: 1 }, { name: 'offerPhotos', maxCount: 8 }]);
app.post('/upload', requireAuth, uploadFields, (req, res) => {
  if (!settings.hasKieKey()) return res.redirect('/settings?nokey=1');
  const archive = req.files && req.files.archive && req.files.archive[0];
  if (!archive) return res.status(400).send('Нет файла архива');
  const b = req.body || {};
  const params = {
    country: (b.country || '').trim(),
    language: (b.language || '').trim(),
    script: (b.script || '').trim(),
    currency: (b.currency || '').trim(),
    offerName: (b.offerName || '').trim(),
    newPrice: (b.newPrice || '').trim(),
    oldPrice: (b.oldPrice || '').trim(),
    discount: (b.discount || '').trim(),
    translateImages: b.translateImages != null,
    formKit: (b.formKitToggle != null && b.formKit ? String(b.formKit).trim() : '')
  };
  const job = jobsStore.createJob(params);
  const jd = jobsStore.jobDir(job.id);
  fs.writeFileSync(path.join(jd, 'upload.zip'), archive.buffer);
  const offer = (req.files && req.files.offerPhotos) || [];
  if (offer.length) {
    const od = path.join(jd, 'offer');
    fs.mkdirSync(od, { recursive: true });
    offer.forEach((f, i) => {
      const ext = (path.extname(f.originalname || '') || '.png').toLowerCase();
      fs.writeFileSync(path.join(od, `offer${i}${ext}`), f.buffer);
    });
  }
  setImmediate(() => pipeline.runJob(jobsStore.getJob(job.id)));
  res.redirect('/job/' + job.id);
});

app.get('/job/:id', requireAuth, (req, res) => {
  const job = jobsStore.getJob(req.params.id);
  if (!job) return res.status(404).send('Задача не найдена');
  res.send(ui.jobPage(job));
});

// ---- SSE progress ----
app.get('/events/:id', requireAuth, (req, res) => {
  const job = jobsStore.getJob(req.params.id);
  if (!job) return res.status(404).end();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = (ev) => res.write('data: ' + JSON.stringify(ev) + '\n\n');
  for (const ev of job.events) send(ev);                       // replay history
  if (job.status === 'done' && job.result) send({ type: 'done', msg: 'Готово', result: job.result });
  const unsub = jobsStore.subscribe(job.id, send);
  const hb = setInterval(() => res.write(': hb\n\n'), 20000);
  req.on('close', () => { clearInterval(hb); unsub(); });
});

// ---- download ----
app.get('/download/:id', requireAuth, (req, res) => {
  const zip = path.join(jobsStore.jobDir(req.params.id), 'result.zip');
  if (!fs.existsSync(zip)) return res.status(404).send('Архив не готов');
  const p = jobsStore.getJob(req.params.id);
  const name = (p && p.params && p.params.offerName ? p.params.offerName.replace(/[^\w.-]+/g, '_') : 'landing') + '_' + (p && p.params && p.params.country || '') + '.zip';
  res.download(zip, name);
});

// ---- live preview (renders .php by stripping PHP for viewing) ----
function safeJoin(base, rel) {
  const target = path.resolve(base, '.' + path.sep + rel.replace(/^[/\\]+/, ''));
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

app.get('/preview/:id/*', requireAuth, (req, res) => {
  const job = jobsStore.getJob(req.params.id);
  if (!job || !job.siteRoot) return res.status(404).send('нет превью');
  const base = path.resolve(job.siteRoot);
  let rel = req.params[0] || '';
  let target = safeJoin(base, rel);
  if (!target) return res.status(403).end();
  if (!rel || rel.endsWith('/') || (fs.existsSync(target) && fs.statSync(target).isDirectory())) {
    for (const idx of ['index.php', 'index.html', 'index.htm']) {
      const cand = path.join(target, idx);
      if (fs.existsSync(cand)) { target = cand; break; }
    }
  }
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) return res.status(404).send('не найдено');
  const ext = path.extname(target).toLowerCase();
  if (ext === '.php' || ext === '.phtml') {
    const html = stripPhpSafe(fs.readFileSync(target, 'utf8'));
    return res.type('html').send(html);
  }
  return res.sendFile(target);
});

// render-reviewer screenshots (full-page) of original vs translated
app.get('/render/:id/:which', requireAuth, (req, res) => {
  const w = req.params.which === 'out' ? 'render_out.png' : 'render_orig.png';
  const p = path.join(jobsStore.jobDir(req.params.id), w);
  if (!fs.existsSync(p)) return res.status(404).end();
  return res.sendFile(p);
});

// original (pre-translation) assets for before/after comparison
app.get('/original/:id/*', requireAuth, (req, res) => {
  const base = path.resolve(path.join(jobsStore.jobDir(req.params.id), 'originals'));
  const target = safeJoin(base, req.params[0] || '');
  if (!target || !fs.existsSync(target)) return res.status(404).end();
  return res.sendFile(target);
});

app.listen(cfg.port, () => {
  console.log(`[perevod] listening on :${cfg.port}  data=${cfg.dataDir}  model(text)=${cfg.kie.claudeModel} model(orch)=${cfg.kie.gptModel} model(img)=${cfg.kie.imageModel}`);
  if (!cfg.kie.key) console.warn('[perevod] WARNING: KIE_API_KEY is empty');
  jobsStore.startGc();
});
