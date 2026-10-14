import { createHash, randomUUID } from 'node:crypto';
import { BOOKS_SOURCE, REPORT_SOURCE, queryAll, projectBookRecord, projectReportRecord, composeLibrary, retrieveBookRecord } from './library.mjs';

const SCHEMA = 1;
const RECONCILE_MS = 24 * 60 * 60 * 1000;
const OVERLAP_MS = 2 * 60 * 1000;
const COMMIT = `if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[2], ARGV[2]); redis.call('DEL', KEYS[1]); return 1 else return 0 end`;
const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;
export function syncKeys(token) {
  // A token rotation cannot accidentally reuse another connection's cached dataset.
  const namespace = createHash('sha256').update(`${BOOKS_SOURCE}:${REPORT_SOURCE}:${token}`).digest('hex').slice(0, 24);
  const key = `library:sync:v${SCHEMA}:${namespace}`;
  return { snapshot: key, lock: `${key}:lock` };
}
function decode(value) {
  if (!value) return null;
  try {
    const item = typeof value === 'string' ? JSON.parse(value) : value;
    return item.schema === SCHEMA && Array.isArray(item.records) && Array.isArray(item.report)
      && Number.isFinite(Date.parse(item.watermark)) && Number.isFinite(Date.parse(item.fullAt)) ? item : null;
  } catch { return null; }
}
function merge(previous, pages, project) {
  const records = new Map(previous.map(record => [record.id, record]));
  for (const page of pages) {
    if (!page.id) throw new Error('Missing Notion page ID');
    const record = project(page);
    if (record) records.set(page.id, record); else records.delete(page.id);
  }
  return [...records.values()];
}
function payload(snapshot) {
  const data = composeLibrary(snapshot.records, snapshot.report);
  data.config.updatedAt = snapshot.syncedAt;
  data.config.fullUpdatedAt = snapshot.fullSyncedAt || snapshot.fullAt;
  return data;
}
export async function syncLibrary(token, redis, { forceFull = false, fetchImpl = fetch, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const keys = syncKeys(token), owner = randomUUID(), requestedAt = now();
  let acquired = await redis('SET', keys.lock, owner, 'NX', 'PX', 60000);
  if (acquired !== 'OK') {
    // Coalesce overlapping work, but never satisfy a forced full request with a delta.
    for (let i = 0; i < 36; i++) {
      const latest = decode(await redis('GET', keys.snapshot));
      const finishedAt = latest && (forceFull ? latest.fullSyncedAt : latest.syncedAt);
      if (finishedAt && Date.parse(finishedAt) >= requestedAt) return payload(latest);
      if (forceFull) {
        acquired = await redis('SET', keys.lock, owner, 'NX', 'PX', 60000);
        if (acquired === 'OK') break;
      }
      await sleep(500);
    }
    if (acquired !== 'OK') throw new Error('Library sync busy');
  }
  let committed = false;
  try {
    const previous = decode(await redis('GET', keys.snapshot));
    const startedAt = now(), deadline = Date.now() + 20000;
    const full = forceFull || !previous || startedAt - Date.parse(previous.fullAt) >= RECONCILE_MS;
    // Use run START time, not finish time; overlap guards timestamp boundaries/index lag.
    const since = full ? null : new Date(Date.parse(previous.watermark) - OVERLAP_MS).toISOString();
    const [bookPages, reportPages] = await Promise.all([
      queryAll(BOOKS_SOURCE, token, fetchImpl, since, deadline),
      queryAll(REPORT_SOURCE, token, fetchImpl, since, deadline)
    ]);
    let records = merge(full ? [] : previous.records, bookPages, projectBookRecord);
    const report = merge(full ? [] : previous.report, reportPages, projectReportRecord);
    if (!full) {
      const changedIds = new Set(bookPages.map(page => page.id));
      // Expired signed URLs are not data edits, but must be renewed before display.
      for (const record of [...records]) {
        if (changedIds.has(record.id) || !record.coverExpiresAt || Date.parse(record.coverExpiresAt) > startedAt + 60000) continue;
        const fresh = await retrieveBookRecord(record.id, token, fetchImpl, deadline);
        records = records.filter(item => item.id !== record.id);
        if (fresh) records.push(fresh);
      }
    }
    records.sort((a,b)=>new Date(a.createdTime)-new Date(b.createdTime) || a.id.localeCompare(b.id));
    report.sort((a,b)=>new Date(a.createdTime)-new Date(b.createdTime) || a.id.localeCompare(b.id));
    const syncedAt = new Date(now()).toISOString();
    const snapshot = { schema:SCHEMA, records, report, watermark:new Date(startedAt).toISOString(),
      fullAt:full ? new Date(startedAt).toISOString() : previous.fullAt, fullSyncedAt:full ? syncedAt : (previous.fullSyncedAt || previous.fullAt), syncedAt };
    const result = await redis('EVAL', COMMIT, 2, keys.lock, keys.snapshot, owner, JSON.stringify(snapshot));
    if (Number(result) !== 1) throw new Error('Library sync lock expired');
    committed = true;
    return payload(snapshot);
  } finally {
    if (!committed) await redis('EVAL', RELEASE, 1, keys.lock, owner).catch(() => {});
  }
}
