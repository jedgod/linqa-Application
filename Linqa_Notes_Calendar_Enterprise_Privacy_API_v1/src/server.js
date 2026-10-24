const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const crypto = require('node:crypto');
const knexFactory = require('knex');
const db = knexFactory(require('../knexfile'));
const app = express();

app.use(helmet());
app.use(cors({ origin: (process.env.CORS_ORIGINS || '').split(',').filter(Boolean) }));
app.use(express.json({ limit: '256kb' }));

const now = () => new Date().toISOString();
const makeId = () => crypto.randomUUID();
const isBool = v => v === true || v === false;
const parseJson = v => { try { return JSON.parse(v || '[]'); } catch { return []; } };
const getUserId = req => req.user && (req.user.id || req.user.sub) || null;

// Mount Linqa's existing verified JWT/session middleware before this guard.
// This code deliberately does not decode bearer tokens or trust a body user ID.
function requireUser(req, res, next) {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } });
  req.authUserId = String(uid);
  next();
}
function fail(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}
function textError(value, max, field, required) {
  if (required && (typeof value !== 'string' || !value.trim())) return field + ' is required.';
  if (value !== undefined && (typeof value !== 'string' || value.length > max)) return field + ' must be text no longer than ' + max + ' characters.';
}
function validDate(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
function noteOut(row) {
  const out = { ...row, tags: parseJson(row.tags_json) }; delete out.tags_json; return out;
}
function eventOut(row) {
  const out = { ...row, attendees: parseJson(row.attendees_json) }; delete out.attendees_json; return out;
}
async function membership(orgId, uid) {
  return db('linqa_org_members').where({ organization_id: orgId, user_id: uid, status: 'active' }).first();
}
const isAdmin = m => m && (m.role === 'owner' || m.role === 'admin');
async function addAudit(orgId, actor, action, type, targetId) {
  return db('linqa_audit_log').insert({
    id: makeId(), organization_id: orgId, actor_user_id: actor, action,
    target_type: type || '', target_id: targetId || '', created_at: now()
  });
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/v1', requireUser);

// Notes
app.get('/api/v1/notes', async (req, res, next) => {
  try {
    const rows = await db('linqa_notes').where({ user_id: req.authUserId })
      .orderBy('pinned', 'desc').orderBy('updated_at', 'desc').limit(200);
    res.json({ data: rows.map(noteOut) });
  } catch (e) { next(e); }
});
app.post('/api/v1/notes', async (req, res, next) => {
  try {
    const b = req.body || {}, title = b.title || '', body = b.body || '', category = b.category || 'Personal';
    const err = textError(title, 200, 'title') || textError(body, 100000, 'body') || textError(category, 40, 'category', true);
    if (err || !Array.isArray(b.tags || []) || (b.tags || []).length > 20 ||
        (b.tags || []).some(x => typeof x !== 'string' || x.length > 40) ||
        (b.pinned !== undefined && !isBool(b.pinned)) || (b.locked !== undefined && !isBool(b.locked)))
      return fail(res, 400, 'INVALID_NOTE', err || 'Invalid tags, pinned, or locked value.');
    const row = {
      id: makeId(), user_id: req.authUserId, title: title.trim(), body, category,
      tags_json: JSON.stringify(b.tags || []), pinned: b.pinned || false, locked: b.locked || false,
      created_at: now(), updated_at: now()
    };
    await db('linqa_notes').insert(row);
    res.status(201).json({ data: noteOut(row) });
  } catch (e) { next(e); }
});
app.patch('/api/v1/notes/:noteId', async (req, res, next) => {
  try {
    const current = await db('linqa_notes').where({ id: req.params.noteId, user_id: req.authUserId }).first();
    if (!current) return fail(res, 404, 'NOTE_NOT_FOUND', 'Note not found.');
    const b = req.body || {}, patch = {};
    for (const f of ['title', 'body', 'category']) {
      if (b[f] !== undefined) {
        const err = textError(b[f], f === 'body' ? 100000 : f === 'title' ? 200 : 40, f, f === 'category');
        if (err) return fail(res, 400, 'INVALID_NOTE', err);
        patch[f] = f === 'title' ? b[f].trim() : b[f];
      }
    }
    if (b.tags !== undefined) {
      if (!Array.isArray(b.tags) || b.tags.length > 20 || b.tags.some(x => typeof x !== 'string' || x.length > 40))
        return fail(res, 400, 'INVALID_NOTE', 'tags must be up to 20 strings of at most 40 characters.');
      patch.tags_json = JSON.stringify(b.tags);
    }
    for (const f of ['pinned', 'locked']) {
      if (b[f] !== undefined) {
        if (!isBool(b[f])) return fail(res, 400, 'INVALID_NOTE', f + ' must be boolean.');
        patch[f] = b[f];
      }
    }
    if (!Object.keys(patch).length) return fail(res, 400, 'EMPTY_UPDATE', 'Provide at least one editable field.');
    patch.updated_at = now();
    await db('linqa_notes').where({ id: current.id, user_id: req.authUserId }).update(patch);
    res.json({ data: noteOut({ ...current, ...patch }) });
  } catch (e) { next(e); }
});
app.delete('/api/v1/notes/:noteId', async (req, res, next) => {
  try {
    const n = await db('linqa_notes').where({ id: req.params.noteId, user_id: req.authUserId }).delete();
    if (!n) return fail(res, 404, 'NOTE_NOT_FOUND', 'Note not found.');
    res.status(204).end();
  } catch (e) { next(e); }
});

// Calendar
app.get('/api/v1/calendar/events', async (req, res, next) => {
  try {
    let q = db('linqa_calendar_events').where({ user_id: req.authUserId });
    if (req.query.from) {
      if (!validDate(req.query.from)) return fail(res, 400, 'INVALID_DATE', 'from must be an ISO date.');
      q = q.where('start_at', '>=', new Date(req.query.from).toISOString());
    }
    if (req.query.to) {
      if (!validDate(req.query.to)) return fail(res, 400, 'INVALID_DATE', 'to must be an ISO date.');
      q = q.where('start_at', '<', new Date(req.query.to).toISOString());
    }
    res.json({ data: (await q.orderBy('start_at').limit(300)).map(eventOut) });
  } catch (e) { next(e); }
});
app.post('/api/v1/calendar/events', async (req, res, next) => {
  try {
    const b = req.body || {};
    const err = textError(b.title, 200, 'title', true) || textError(b.description || '', 10000, 'description') ||
      textError(b.timeZone || 'UTC', 80, 'timeZone', true) || textError(b.location || '', 300, 'location') ||
      textError(b.meetingUrl || '', 1000, 'meetingUrl') || textError(b.recurrence || '', 200, 'recurrence');
    if (err || !validDate(b.startAt) || !validDate(b.endAt) || Date.parse(b.endAt) <= Date.parse(b.startAt) ||
        !Array.isArray(b.attendees || []) || (b.attendees || []).length > 100 ||
        (b.attendees || []).some(x => typeof x !== 'string' || x.length > 254))
      return fail(res, 400, 'INVALID_EVENT', err || 'Provide valid startAt/endAt with endAt after startAt, and valid attendees.');
    const row = {
      id: makeId(), user_id: req.authUserId, title: b.title.trim(), description: b.description || '',
      start_at: new Date(b.startAt).toISOString(), end_at: new Date(b.endAt).toISOString(),
      time_zone: b.timeZone || 'UTC', location: b.location || '', meeting_url: b.meetingUrl || '',
      recurrence: b.recurrence || '', attendees_json: JSON.stringify(b.attendees || []),
      created_at: now(), updated_at: now()
    };
    await db('linqa_calendar_events').insert(row);
    res.status(201).json({ data: eventOut(row) });
  } catch (e) { next(e); }
});
app.patch('/api/v1/calendar/events/:eventId', async (req, res, next) => {
  try {
    const current = await db('linqa_calendar_events').where({ id: req.params.eventId, user_id: req.authUserId }).first();
    if (!current) return fail(res, 404, 'EVENT_NOT_FOUND', 'Event not found.');
    const b = req.body || {}, patch = {};
    const fields = {
      title: ['title', 200, true], description: ['description', 10000],
      timeZone: ['time_zone', 80, true], location: ['location', 300],
      meetingUrl: ['meeting_url', 1000], recurrence: ['recurrence', 200]
    };
    for (const [input, spec] of Object.entries(fields)) {
      if (b[input] !== undefined) {
        const err = textError(b[input], spec[1], input, spec[2]);
        if (err) return fail(res, 400, 'INVALID_EVENT', err);
        patch[spec[0]] = b[input];
      }
    }
    for (const [input, column] of [['startAt', 'start_at'], ['endAt', 'end_at']]) {
      if (b[input] !== undefined) {
        if (!validDate(b[input])) return fail(res, 400, 'INVALID_EVENT', input + ' must be an ISO date.');
        patch[column] = new Date(b[input]).toISOString();
      }
    }
    if (b.attendees !== undefined) {
      if (!Array.isArray(b.attendees) || b.attendees.length > 100 || b.attendees.some(x => typeof x !== 'string' || x.length > 254))
        return fail(res, 400, 'INVALID_EVENT', 'attendees must be up to 100 email strings.');
      patch.attendees_json = JSON.stringify(b.attendees);
    }
    if (Date.parse(patch.end_at || current.end_at) <= Date.parse(patch.start_at || current.start_at))
      return fail(res, 400, 'INVALID_EVENT', 'endAt must be after startAt.');
    if (!Object.keys(patch).length) return fail(res, 400, 'EMPTY_UPDATE', 'Provide at least one editable field.');
    patch.updated_at = now();
    await db('linqa_calendar_events').where({ id: current.id, user_id: req.authUserId }).update(patch);
    res.json({ data: eventOut({ ...current, ...patch }) });
  } catch (e) { next(e); }
});
app.delete('/api/v1/calendar/events/:eventId', async (req, res, next) => {
  try {
    const n = await db('linqa_calendar_events').where({ id: req.params.eventId, user_id: req.authUserId }).delete();
    if (!n) return fail(res, 404, 'EVENT_NOT_FOUND', 'Event not found.');
    res.status(204).end();
  } catch (e) { next(e); }
});

// Enterprise: records must be provisioned from the trusted identity/admin system.
app.get('/api/v1/enterprise/organizations', async (req, res, next) => {
  try {
    const rows = await db('linqa_organizations as o').join('linqa_org_members as m', 'o.id', 'm.organization_id')
      .where({ 'm.user_id': req.authUserId, 'm.status': 'active' })
      .select('o.id', 'o.name', 'o.slug', 'o.status', 'o.plan', 'o.data_region', 'm.role');
    res.json({ data: rows });
  } catch (e) { next(e); }
});
app.get('/api/v1/enterprise/organizations/:orgId', async (req, res, next) => {
  try {
    const m = await membership(req.params.orgId, req.authUserId);
    if (!m) return fail(res, 404, 'ORGANIZATION_NOT_FOUND', 'Organization not found.');
    const org = await db('linqa_organizations').where({ id: req.params.orgId }).first();
    res.json({ data: { ...org, role: m.role } });
  } catch (e) { next(e); }
});
app.get('/api/v1/enterprise/organizations/:orgId/directory', async (req, res, next) => {
  try {
    if (!await membership(req.params.orgId, req.authUserId)) return fail(res, 404, 'ORGANIZATION_NOT_FOUND', 'Organization not found.');
    const rows = await db('linqa_org_members').where({ organization_id: req.params.orgId, status: 'active' })
      .select('user_id', 'display_name', 'role').orderBy('display_name').limit(1000);
    res.json({ data: rows });
  } catch (e) { next(e); }
});
app.get('/api/v1/enterprise/organizations/:orgId/policies', async (req, res, next) => {
  try {
    if (!await membership(req.params.orgId, req.authUserId)) return fail(res, 404, 'ORGANIZATION_NOT_FOUND', 'Organization not found.');
    const rows = await db('linqa_org_policies').where({ organization_id: req.params.orgId })
      .select('id', 'name', 'description', 'enabled', 'updated_at');
    res.json({ data: rows });
  } catch (e) { next(e); }
});
app.patch('/api/v1/enterprise/organizations/:orgId/policies/:policyId', async (req, res, next) => {
  try {
    const m = await membership(req.params.orgId, req.authUserId);
    if (!m) return fail(res, 404, 'ORGANIZATION_NOT_FOUND', 'Organization not found.');
    if (!isAdmin(m)) return fail(res, 403, 'ADMIN_REQUIRED', 'Organization admin role required.');
    if (!isBool(req.body && req.body.enabled)) return fail(res, 400, 'INVALID_POLICY', 'enabled must be boolean.');
    const changed = await db('linqa_org_policies').where({ id: req.params.policyId, organization_id: req.params.orgId })
      .update({ enabled: req.body.enabled, updated_at: now() });
    if (!changed) return fail(res, 404, 'POLICY_NOT_FOUND', 'Policy not found.');
    await addAudit(req.params.orgId, req.authUserId, 'policy.updated', 'policy', req.params.policyId);
    res.json({ data: await db('linqa_org_policies').where({ id: req.params.policyId }).first() });
  } catch (e) { next(e); }
});
app.get('/api/v1/enterprise/organizations/:orgId/audit-log', async (req, res, next) => {
  try {
    const m = await membership(req.params.orgId, req.authUserId);
    if (!m) return fail(res, 404, 'ORGANIZATION_NOT_FOUND', 'Organization not found.');
    if (!isAdmin(m)) return fail(res, 403, 'ADMIN_REQUIRED', 'Organization admin role required.');
    const rows = await db('linqa_audit_log').where({ organization_id: req.params.orgId }).orderBy('created_at', 'desc').limit(200);
    res.json({ data: rows });
  } catch (e) { next(e); }
});

// Privacy
app.get('/api/v1/privacy/preferences', async (req, res, next) => {
  try {
    let row = await db('linqa_privacy_preferences').where({ user_id: req.authUserId }).first();
    if (!row) {
      row = { user_id: req.authUserId, discoverable: true, read_receipts: true, contact_sync: false, personalized_recommendations: true, updated_at: now() };
      await db('linqa_privacy_preferences').insert(row);
    }
    res.json({ data: {
      discoverable: row.discoverable, readReceipts: row.read_receipts, contactSync: row.contact_sync,
      personalizedRecommendations: row.personalized_recommendations, updatedAt: row.updated_at
    } });
  } catch (e) { next(e); }
});
app.patch('/api/v1/privacy/preferences', async (req, res, next) => {
  try {
    const names = { discoverable: 'discoverable', readReceipts: 'read_receipts', contactSync: 'contact_sync', personalizedRecommendations: 'personalized_recommendations' };
    const patch = {};
    for (const [input, column] of Object.entries(names)) {
      if (req.body && req.body[input] !== undefined) {
        if (!isBool(req.body[input])) return fail(res, 400, 'INVALID_PREFERENCE', input + ' must be boolean.');
        patch[column] = req.body[input];
      }
    }
    if (!Object.keys(patch).length) return fail(res, 400, 'EMPTY_UPDATE', 'Provide at least one privacy preference.');
    patch.updated_at = now();
    await db('linqa_privacy_preferences').insert({
      user_id: req.authUserId, discoverable: true, read_receipts: true, contact_sync: false,
      personalized_recommendations: true, ...patch
    }).onConflict('user_id').merge(patch);
    const row = await db('linqa_privacy_preferences').where({ user_id: req.authUserId }).first();
    res.json({ data: {
      discoverable: row.discoverable, readReceipts: row.read_receipts, contactSync: row.contact_sync,
      personalizedRecommendations: row.personalized_recommendations, updatedAt: row.updated_at
    } });
  } catch (e) { next(e); }
});
app.get('/api/v1/privacy/export', async (req, res, next) => {
  try {
    const [notes, events, preferences, organizations] = await Promise.all([
      db('linqa_notes').where({ user_id: req.authUserId }),
      db('linqa_calendar_events').where({ user_id: req.authUserId }),
      db('linqa_privacy_preferences').where({ user_id: req.authUserId }).first(),
      db('linqa_organizations as o').join('linqa_org_members as m', 'o.id', 'm.organization_id')
        .where({ 'm.user_id': req.authUserId }).select('o.id', 'o.name', 'o.slug', 'm.role', 'm.status')
    ]);
    res.setHeader('Content-Disposition', 'attachment; filename="linqa-data-export.json"');
    res.json({
      exportedAt: now(), accountId: req.authUserId,
      notes: notes.map(noteOut), calendarEvents: events.map(eventOut),
      privacyPreferences: preferences || null, enterpriseMemberships: organizations
    });
  } catch (e) { next(e); }
});
app.post('/api/v1/privacy/deletion-requests', async (req, res, next) => {
  try {
    if (!req.body || req.body.confirmation !== 'DELETE MY ACCOUNT')
      return fail(res, 400, 'CONFIRMATION_REQUIRED', 'Type DELETE MY ACCOUNT to request account deletion.');
    const pending = await db('linqa_account_deletion_requests').where({ user_id: req.authUserId })
      .whereIn('status', ['confirmation_required', 'queued']).first();
    if (pending) return res.status(202).json({ data: pending });
    const row = { id: makeId(), user_id: req.authUserId, status: 'confirmation_required', requested_at: now(), confirmed_at: null };
    await db('linqa_account_deletion_requests').insert(row);
    res.status(202).json({ data: row, message: 'Request recorded for the account-lifecycle workflow.' });
  } catch (e) { next(e); }
});
app.get('/api/v1/privacy/deletion-requests/latest', async (req, res, next) => {
  try {
    const row = await db('linqa_account_deletion_requests').where({ user_id: req.authUserId }).orderBy('requested_at', 'desc').first();
    res.json({ data: row || null });
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } });
});
if (require.main === module) {
  const port = Number(process.env.PORT || 6055);
  app.listen(port, () => console.log('Linqa module API listening on :' + port));
}
module.exports = { app, db };
