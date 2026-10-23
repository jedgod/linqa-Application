import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { ModulesService } from '../services/modules.service.js';
import { Vertical2Service } from '../services/vertical-2.service.js';

// Runs only against a disposable database (the same switch as the wallet integration tests).
const suite = process.env.LINQA_WALLET_DISPOSABLE_TEST_DB === '1' ? describe : describe.skip;

suite('notes, calendar and enterprise views on PostgreSQL', () => {
  let db: pg.Pool, modules: ModulesService, vertical2: Vertical2Service;
  beforeAll(() => { db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 }); modules = new ModulesService(db as never); vertical2 = new Vertical2Service(db as never); });
  afterAll(async () => { await db.end(); });

  const person = async (name?: string) => {
    const id = randomUUID();
    await db.query(`INSERT INTO users(id,external_subject,status) VALUES($1::uuid,$1::text,'ACTIVE')`, [id]);
    if (name) await db.query(`INSERT INTO user_profiles(user_id,display_name) VALUES($1,$2)`, [id, name]);
    return id;
  };
  const seal = (text: string) => Buffer.from('sealed:' + text + ':'.padEnd(24, 'x'));
  const note = (owner: string, text: string) => vertical2.createNote({ ownerUserId: owner, noteType: 'NOTE', ciphertext: seal(text), collaborators: [] });
  const event = (owner: string, startsAt: string, endsAt: string) => vertical2.createCalendarEvent({ ownerUserId: owner, titleCiphertext: seal('t'), startsAt: new Date(startsAt), endsAt: new Date(endsAt), attendeeUserIds: [] });
  const rejects = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };

  it('returns only the owner\'s notes, newest edit first, as the exact bytes stored', async () => {
    const a = await person(), b = await person();
    const first = await note(a, 'one') as any, second = await note(a, 'two') as any;
    await note(b, 'not yours');
    await modules.replaceNote(a, first.id, seal('one, edited'));
    const list = await modules.listNotes(a);
    expect(list.map((n) => n.id)).toEqual([first.id, second.id]);
    expect(Buffer.from(list[0]!.ciphertextBase64, 'base64').equals(seal('one, edited'))).toBe(true);
    expect((await modules.listNotes(b))).toHaveLength(1);
  });

  it('will not replace or delete someone else\'s note', async () => {
    const a = await person(), b = await person();
    const mine = await note(a, 'mine') as any;
    expect(await modules.replaceNote(b, mine.id, seal('hijack'))).toBeNull();
    expect(await modules.deleteNote(b, mine.id)).toBe(false);
    expect(Buffer.from((await modules.listNotes(a))[0]!.ciphertextBase64, 'base64').equals(seal('mine'))).toBe(true);
    expect(await modules.deleteNote(a, mine.id)).toBe(true);
    expect(await modules.deleteNote(a, mine.id)).toBe(false);
  });

  it('filters events by start time and keeps them owner-only', async () => {
    const a = await person(), b = await person();
    await event(a, '2026-06-10T13:00:00Z', '2026-06-10T14:00:00Z');
    await event(a, '2026-07-02T13:00:00Z', '2026-07-02T14:00:00Z');
    await event(b, '2026-06-11T13:00:00Z', '2026-06-11T14:00:00Z');
    const june = await modules.listEvents(a, { from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-07-01T00:00:00Z') });
    expect(june).toHaveLength(1);
    expect(june[0]!.startsAt).toBe('2026-06-10T13:00:00.000Z');
    expect(await modules.listEvents(a, {})).toHaveLength(2);
  });

  it('updates an event\'s time, refuses an end before the start, and protects other people\'s events', async () => {
    const a = await person(), b = await person();
    const e = await event(a, '2026-06-10T13:00:00Z', '2026-06-10T14:00:00Z') as any;
    const moved = await modules.updateEvent(a, e.id, { startsAt: new Date('2026-06-10T15:00:00Z'), endsAt: new Date('2026-06-10T16:00:00Z') });
    expect(moved).toMatchObject({ startsAt: '2026-06-10T15:00:00.000Z', endsAt: '2026-06-10T16:00:00.000Z' });
    expect(await rejects(modules.updateEvent(a, e.id, { endsAt: new Date('2026-06-10T09:00:00Z') }))).toBe('INVALID_EVENT_TIME');
    expect(await modules.updateEvent(b, e.id, { startsAt: new Date('2026-06-12T15:00:00Z'), endsAt: new Date('2026-06-12T16:00:00Z') })).toBeNull();
    expect(await modules.deleteEvent(b, e.id)).toBe(false);
    expect(await modules.deleteEvent(a, e.id)).toBe(true);
  });

  async function organization(members: Array<[string, string, string]>) {
    const id = randomUUID();
    await db.query(`INSERT INTO organizations(id,name,slug,status) VALUES($1,'Acme',$2,'ACTIVE')`, [id, 'acme-' + id.slice(0, 8)]);
    for (const [user, role, status] of members) await db.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES($1,$2,$3,$4)`, [id, user, role, status]);
    await db.query(`INSERT INTO enterprise_policies(organization_id,policy_key,policy_value,enforced) VALUES($1,'retention.days','{"days":90}',true)`, [id]);
    await db.query(`INSERT INTO organization_audit_events(organization_id,actor_user_id,actor_subject,event_type,target_type,target_id) VALUES($1,$2,$3,'policy.updated','policy','retention.days')`, [id, members[0]![0], members[0]![0]]);
    return id;
  }

  it('shows an organization only to its active members', async () => {
    const admin = await person('Ada Admin'), member = await person('Mo Member'), suspended = await person('Sam Suspended'), outsider = await person();
    const org = await organization([[admin, 'ADMIN', 'ACTIVE'], [member, 'MEMBER', 'ACTIVE'], [suspended, 'MEMBER', 'SUSPENDED']]);
    expect((await modules.organizations(member)).map((o) => o.id)).toEqual([org]);
    expect(await modules.organizations(suspended)).toEqual([]);
    expect(await modules.organizations(outsider)).toEqual([]);
    for (const denied of [outsider, suspended]) {
      expect(await rejects(modules.organization(org, denied))).toBe('ORGANIZATION_NOT_FOUND');
      expect(await rejects(modules.directory(org, denied))).toBe('ORGANIZATION_NOT_FOUND');
      expect(await rejects(modules.policies(org, denied))).toBe('ORGANIZATION_NOT_FOUND');
      expect(await rejects(modules.auditLog(org, denied))).toBe('ORGANIZATION_NOT_FOUND');
    }
    expect(await modules.organization(org, member)).toMatchObject({ role: 'MEMBER', memberCount: 2, enforcedPolicyCount: 1 });
  });

  it('lists the active directory with display names and no suspended members', async () => {
    const admin = await person('Ada Admin'), member = await person('Mo Member'), suspended = await person('Sam Suspended');
    const org = await organization([[admin, 'ADMIN', 'ACTIVE'], [member, 'MEMBER', 'ACTIVE'], [suspended, 'MEMBER', 'SUSPENDED']]);
    expect((await modules.directory(org, member)).map((m) => m.displayName)).toEqual(['Ada Admin', 'Mo Member']);
    expect((await modules.policies(org, member))[0]).toMatchObject({ key: 'retention.days', value: { days: 90 }, enforced: true });
  });

  it('keeps the audit log for admin-level roles', async () => {
    const owner = await person(), compliance = await person(), member = await person();
    const org = await organization([[owner, 'OWNER', 'ACTIVE'], [compliance, 'COMPLIANCE_ADMIN', 'ACTIVE'], [member, 'MEMBER', 'ACTIVE']]);
    expect(await rejects(modules.auditLog(org, member))).toBe('ADMIN_REQUIRED');
    for (const user of [owner, compliance]) {
      const log = await modules.auditLog(org, user);
      expect(log[0]).toMatchObject({ eventType: 'policy.updated', targetId: 'retention.days' });
      expect(Object.keys(log[0]!)).not.toContain('metadata');
    }
  });
});
