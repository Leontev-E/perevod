'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { nanoid } = require('nanoid');
const cfg = require('./config');

const jobs = new Map();        // id -> job
const buses = new Map();       // id -> EventEmitter

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

module.exports = { createJob, getJob, emit, setStatus, subscribe, jobDir, persist, listJobs };
