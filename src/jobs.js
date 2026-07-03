'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { nanoid } = require('nanoid');
const cfg = require('./config');

const jobs = new Map();        // id -> job
const buses = new Map();       // id -> EventEmitter

// ---- eviction policy ----
// Completed jobs are kept in memory only up to MAX_JOBS_IN_MEMORY (LRU), and on
// disk only up to JOBS_TTL_HOURS. Without this, the in-memory Maps and the
// per-job directory tree (uploads, originals, result.zip, render screenshots)
// grow without bound across a long-running single-tenant deployment. Active
// (queued/running) jobs are never evicted.
const MAX_JOBS_IN_MEMORY = parseInt(process.env.MAX_JOBS_IN_MEMORY || '50', 10);
const JOBS_TTL_HOURS = parseInt(process.env.JOBS_TTL_HOURS || '72', 10);
const GC_INTERVAL_MS = parseInt(process.env.JOBS_GC_INTERVAL_MS || String(6 * 3600 * 1000), 10); // 6h
const ACTIVE = new Set(['queued', 'running']);

function jobDir(id) { return path.join(cfg.dataDir, 'jobs', id); }

function createJob(params) {
  const id = nanoid(12);
  const dir = jobDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const job = {
    id, status: 'queued', params,
    createdAt: Date.now(), updatedAt: Date.now(),
    events: [], stats: {}, result: null, error: null
  };
  jobs.set(id, job);
  buses.set(id, new EventEmitter());
  persist(job);
  evictFromMemory();
  return job;
}

function getJob(id) { return jobs.get(id) || loadJob(id); }

function loadJob(id) {
  const f = path.join(jobDir(id), 'state.json');
  if (!fs.existsSync(f)) return null;
  try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); jobs.set(id, j); if (!buses.has(id)) buses.set(id, new EventEmitter()); return j; }
  catch { return null; }
}

function persist(job) {
  try { fs.writeFileSync(path.join(jobDir(job.id), 'state.json'), JSON.stringify(job, null, 2)); } catch { /* noop */ }
}

// event: { type: 'progress'|'step'|'warn'|'error'|'done'|'file'|'image', msg, ...data }
function emit(id, event) {
  const job = jobs.get(id);
  if (!job) return;
  const ev = Object.assign({ t: Date.now() }, event);
  job.events.push(ev);
  if (job.events.length > 2000) job.events.splice(0, job.events.length - 2000);
  job.updatedAt = Date.now();
  const bus = buses.get(id);
  if (bus) bus.emit('event', ev);
  // persist lightly (not every tick to disk would be heavy; persist on meaningful events)
  if (['step', 'done', 'error', 'status'].includes(event.type)) persist(job);
}

function setStatus(id, status, extra) {
  const job = jobs.get(id);
  if (!job) return;
  job.status = status;
  if (extra) Object.assign(job, extra);
  emit(id, { type: 'status', status, msg: extra && extra.statusMsg });
  persist(job);
  // A job just turned inactive (done/error) -> a good moment to trim memory.
  if (!ACTIVE.has(status)) evictFromMemory();
}

function subscribe(id, listener) {
  const bus = buses.get(id);
  if (!bus) return () => {};
  bus.on('event', listener);
  return () => bus.off('event', listener);
}

function listJobs(limit = 50) {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
    .map(j => ({ id: j.id, status: j.status, createdAt: j.createdAt, params: j.params, stats: j.stats }));
}

// ---- eviction: bounded memory + on-disk TTL ----
// Drop the oldest INACTIVE jobs from memory until we're under the cap. Active
// (queued/running) jobs are always retained, even if that briefly exceeds cap.
function evictFromMemory() {
  if (jobs.size <= MAX_JOBS_IN_MEMORY) return;
  const inactive = [...jobs.values()]
    .filter(j => !ACTIVE.has(j.status))
    .sort((a, b) => a.updatedAt - a.updatedAt);
  let removed = 0;
  for (const j of inactive) {
    if (jobs.size <= MAX_JOBS_IN_MEMORY) break;
    jobs.delete(j.id);
    const bus = buses.get(j.id);
    if (bus) { bus.removeAllListeners(); buses.delete(j.id); }
    removed++;
  }
  if (removed) console.log(`[perevod] evicted ${removed} finished jobs from memory (${jobs.size} remain)`);
}

// Remove job directories older than JOBS_TTL_HOURS from disk. A job whose
// state.json is missing or shows an active status is left alone. Safe to call
// repeatedly; deletes only whole per-job dirs under data/jobs/<id>.
function evictExpiredFromDisk() {
  const root = path.join(cfg.dataDir, 'jobs');
  let dir;
  try { dir = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  const cutoff = Date.now() - JOBS_TTL_HOURS * 3600 * 1000;
  let removed = 0;
  for (const e of dir) {
    if (!e.isDirectory()) continue;
    const jd = path.join(root, e.name);
    let st;
    try { st = JSON.parse(fs.readFileSync(path.join(jd, 'state.json'), 'utf8')); }
    catch { continue; }                // unreadable/missing -> leave untouched
    if (ACTIVE.has(st.status)) continue;
    const ts = st.updatedAt || st.createdAt || 0;
    if (ts && ts < cutoff) {
      try { fs.rmSync(jd, { recursive: true, force: true }); removed++; } catch { /* noop */ }
    }
  }
  if (removed) console.log(`[perevod] purged ${removed} job dirs older than ${JOBS_TTL_HOURS}h`);
}

// Run once at startup (clean up after a long downtime), then on an interval.
function startGc() {
  evictExpiredFromDisk();
  evictFromMemory();
  if (GC_INTERVAL_MS > 0) setInterval(() => { evictExpiredFromDisk(); evictFromMemory(); }, GC_INTERVAL_MS);
  // setInterval keeps the event loop alive; that's fine — server.js app.listen
  // already does the same, so there is no graceful-shutdown regression.
}

module.exports = { createJob, getJob, emit, setStatus, subscribe, jobDir, persist, listJobs, evictFromMemory, evictExpiredFromDisk, startGc };
