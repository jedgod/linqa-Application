// Scenario tests for ProtectedMediaService against an in-memory fake of the Prisma calls it uses.
// Run after `npx tsc` builds to ./dist:  node test/protected-media.scenarios.js
process.env.AUDIT_SECRET = 'x'.repeat(40);
process.env.PROTECTED_MEDIA_DIR = require('path').join(__dirname, 'blobs');
require('reflect-metadata');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { ProtectedMediaService } = require('../dist/protected-media/protected-media.service');
const { MediaEventsService } = require('../dist/protected-media/media-events.service');
const { verifyChain } = require('../dist/protected-media/audit-chain');

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o), (k, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v) : v)));
function match(row, where) {
  for (const [k, cond] of Object.entries(where || {})) {
    if (k === 'OR') { if (!cond.some((c) => match(row, c))) return false; continue; }
    if (k === 'media') { if (!match(db.protectedMedia.rows.find((m) => m.id === row.mediaId), cond)) return false; continue; }
    const v = row[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('lte' in cond && !(v != null && v <= cond.lte)) return false;
    } else if (cond === null) { if (v != null) return false; }
    else if (v instanceof Date ? v.getTime() !== cond.getTime() : v !== cond) return false;
  }
  return true;
}
function table(defaults = {}) {
  return {
    rows: [],
    async create({ data }) { const r = { id: data.id ?? require('crypto').randomUUID(), ...defaults, ...data }; this.rows.push(r); return clone(r); },
    async findUnique({ where }) { return clone(this.rows.find((r) => match(r, where)) ?? null); },
    async findFirst({ where, orderBy }) { let rs = this.rows.filter((r) => match(r, where)); if (orderBy?.seq === 'desc') rs.sort((a, b) => b.seq - a.seq); return clone(rs[0] ?? null); },
    async findMany({ where, orderBy }) { let rs = this.rows.filter((r) => match(r, where)); if (orderBy?.seq === 'asc') rs.sort((a, b) => a.seq - b.seq); return clone(rs); },
    async updateMany({ where, data }) { const rs = this.rows.filter((r) => match(r, where)); rs.forEach((r) => Object.assign(r, data)); return { count: rs.length }; },
  };
}
const db = {
  user: { async findUnique({ where }) { return ['alice', 'bob', 'carol'].includes(where.id) ? { id: where.id } : null; } },
  protectedMedia: table({ viewCount: 0, status: 'ACTIVE', firstViewedAt: null, closedAt: null, closeReason: null, conversationId: null }),
  mediaView: table({ blobFetchedAt: null, endedAt: null, endReason: null }),
  mediaAuditEvent: table(),
  async $transaction(fn) { return fn(this); },
};
const origAuditCreate = db.mediaAuditEvent.create.bind(db.mediaAuditEvent);
db.mediaAuditEvent.create = async (a) => {
  if (db.mediaAuditEvent.rows.some((r) => r.mediaId === a.data.mediaId && r.seq === a.data.seq)) { const e = new Error('dup'); e.code = 'P2002'; throw e; }
  return origAuditCreate(a);
};

const events = new MediaEventsService();
const alerts = [];
events.emit = (userId, alert) => alerts.push({ userId, ...alert });
const svc = new ProtectedMediaService(db, events);
const file = { buffer: Buffer.from('CIPHERTEXT-BYTES'), size: 16 };
const types = (id) => db.mediaAuditEvent.rows.filter((r) => r.mediaId === id).sort((a, b) => a.seq - b.seq).map((r) => r.type);
const blobExists = (id) => fs.existsSync(path.join(process.env.PROTECTED_MEDIA_DIR, `${id}.bin`));
const status = (e) => e?.response?.status ?? e?.getStatus?.();
async function view(id, user = 'bob') { const g = await svc.requestView(id, user, { platform: 'ios' }); const bytes = await svc.fetchCiphertext(id, g.viewId, user, g.token); await svc.endView(id, g.viewId, user, 'timer'); return { g, bytes }; }

(async () => {
  let pass = 0; const ok = (name) => { pass++; console.log('  ✓', name); };

  console.log('1. Multi-view limit with audit trail');
  const m1 = await svc.create('alice', { recipientId: 'bob', policy: JSON.stringify({ mode: 'MULTI_VIEW', maxViews: 2 }) }, file);
  await assert.rejects(svc.requestView(m1.id, 'carol', {}), (e) => e.getStatus() === 404); ok('stranger cannot view (404)');
  await assert.rejects(svc.requestView(m1.id, 'alice', {}), (e) => e.getStatus() === 404); ok('sender cannot spend views');
  const v1 = await view(m1.id); assert.equal(v1.bytes.toString(), 'CIPHERTEXT-BYTES'); assert.equal(v1.g.remainingViews, 1); ok('view 1 returns ciphertext, 1 left');
  await assert.rejects(svc.fetchCiphertext(m1.id, v1.g.viewId, 'bob', v1.g.token), (e) => e.getStatus() === 410); ok('download token is single-use');
  const v2 = await view(m1.id); assert.equal(v2.g.remainingViews, 0); ok('view 2 allowed');
  assert.equal(blobExists(m1.id), false); assert.equal((await svc.getStatus(m1.id, 'alice')).status, 'EXHAUSTED'); ok('after last view: EXHAUSTED and file deleted');
  await assert.rejects(svc.requestView(m1.id, 'bob', {}), (e) => e.getStatus() === 410); ok('view 3 denied (410)');
  assert.deepEqual(types(m1.id), ['CREATED','VIEW_GRANTED','BLOB_DELIVERED','VIEW_ENDED','VIEW_GRANTED','BLOB_DELIVERED','EXHAUSTED','BLOB_DELETED','VIEW_ENDED','ACCESS_DENIED']); ok('every step is in the audit trail, in order');
  const a1 = await svc.getAudit(m1.id, 'alice'); assert.equal(a1.integrity.valid, true); assert.ok(a1.events.every((e) => e.at)); ok('audit chain verifies, events carry timestamps + user ids');
  const row = db.mediaAuditEvent.rows.find((r) => r.mediaId === m1.id && r.seq === 2); const orig = row.actorId; row.actorId = 'mallory';
  assert.equal((await svc.getAudit(m1.id, 'alice')).integrity.valid, false); row.actorId = orig; ok('editing an audit row is detected');
  assert.ok(alerts.some((a) => a.userId === 'alice' && a.type === 'VIEWED' && a.viewNumber === 2)); ok('sender alerted on each view');

  console.log('2. Time-limited viewing with dynamic expiry');
  const m2 = await svc.create('alice', { recipientId: 'bob', policy: { mode: 'TIMED', windowSeconds: 30, expiryStart: 'ON_FIRST_VIEW' } }, file);
  assert.equal((await svc.getStatus(m2.id, 'bob')).expiresAt, null); ok('first-view mode: clock not started at send');
  const t1 = await view(m2.id); assert.ok(t1.g.expiresAt); assert.ok(t1.g.displaySeconds <= 30); ok('clock starts on first view (30s window)');
  await view(m2.id); await view(m2.id); ok('multiple views allowed inside the window');
  db.protectedMedia.rows.find((r) => r.id === m2.id).expiresAt = new Date(Date.now() - 1000);
  await assert.rejects(svc.requestView(m2.id, 'bob', {}), (e) => e.getStatus() === 410); assert.equal(blobExists(m2.id), false); ok('after the window: denied and file deleted');
  const m3 = await svc.create('alice', { recipientId: 'bob', policy: { mode: 'TIMED', windowSeconds: 45, expiryStart: 'ON_SEND' } }, file);
  assert.ok((await svc.getStatus(m3.id, 'bob')).expiresAt); ok('send mode: clock starts at send');
  db.protectedMedia.rows.find((r) => r.id === m3.id).expiresAt = new Date(Date.now() - 1);
  assert.equal(await svc.sweep(), 1); assert.equal((await svc.getStatus(m3.id, 'alice')).status, 'EXPIRED'); ok('sweeper expires unopened media');
  await assert.rejects(svc.create('alice', { recipientId: 'bob', policy: { mode: 'TIMED', windowSeconds: 90 } }, file), (e) => e.getStatus() === 400); ok('window outside 30-60s rejected');

  console.log('3. Ephemeral with screenshot detection');
  const m4 = await svc.create('alice', { recipientId: 'bob', policy: { mode: 'EPHEMERAL', maxViews: 2 } }, file);
  const e1 = await svc.requestView(m4.id, 'bob', {}); await svc.fetchCiphertext(m4.id, e1.viewId, 'bob', e1.token);
  const r = await svc.reportCapture(m4.id, 'bob', 'screenshot', e1.viewId, { platform: 'android' });
  assert.equal(r.revoked, true); assert.equal(blobExists(m4.id), false); ok('screenshot revokes access immediately and deletes file');
  assert.ok(alerts.some((a) => a.mediaId === m4.id && a.type === 'SCREENSHOT')); assert.ok(alerts.some((a) => a.mediaId === m4.id && a.type === 'CAPTURE_REVOKED')); ok('sender alerted: screenshot + revoked');
  await assert.rejects(svc.requestView(m4.id, 'bob', {}), (e) => e.getStatus() === 410); ok('second view denied after capture');
  await assert.rejects(svc.create('alice', { recipientId: 'bob', policy: { mode: 'EPHEMERAL', maxViews: 3 } }, file), (e) => e.getStatus() === 400); ok('ephemeral capped at 2 views');
  const m5 = await svc.create('alice', { recipientId: 'bob', policy: { mode: 'MULTI_VIEW', maxViews: 3 } }, file);
  assert.equal((await svc.reportCapture(m5.id, 'bob', 'recording', null, {})).revoked, false); ok('other modes: capture logged + alerted, not revoked');

  console.log('Race: two devices take the last view at once');
  const m6 = await svc.create('alice', { recipientId: 'bob', policy: { mode: 'MULTI_VIEW', maxViews: 1 } }, file);
  const results = await Promise.allSettled([svc.requestView(m6.id, 'bob', {}), svc.requestView(m6.id, 'bob', {})]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1); ok('only one of two simultaneous requests wins');

  console.log('Sender revoke');
  const m7 = await svc.create('alice', { recipientId: 'bob', policy: { mode: 'MULTI_VIEW' } }, file);
  await assert.rejects(svc.revoke(m7.id, 'bob'), (e) => e.getStatus() === 403); ok('recipient cannot revoke');
  assert.equal((await svc.revoke(m7.id, 'alice')).status, 'REVOKED'); assert.equal(blobExists(m7.id), false); ok('sender revoke deletes file');

  for (const id of [m1.id, m2.id, m3.id, m4.id, m5.id, m6.id, m7.id]) assert.equal((await svc.getAudit(id, 'alice')).integrity.valid, true);
  ok('all audit chains valid at the end');
  console.log(`\n${pass} checks passed`);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
