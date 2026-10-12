import { JwtCallsAuth } from './jwt-calls-auth';
import { PrismaConversationsAdapter } from './prisma-conversations.adapter';
import { PrismaReportsRepository } from './prisma-reports.repository';
import { VoipPushNotifier } from '../push/voip-push.notifier';
import { CallsPrisma } from './calls-prisma';

function fakePrisma(over: Partial<Record<string, any>> = {}): CallsPrisma & { calls: any[] } {
  const calls: any[] = [];
  const rec = (name: string, ret: any) => jest.fn(async (args: any) => (calls.push([name, args]), typeof ret === 'function' ? ret(args) : ret));
  return {
    calls,
    conversationMember: { count: rec('member.count', over.memberCount ?? 1) },
    block: { count: rec('block.count', over.blockCount ?? 0) },
    device: { findFirst: rec('device.findFirst', over.device ?? null) },
    callReport: { create: rec('report.create', {}), count: rec('report.count', 0) },
    callPushToken: {
      upsert: rec('push.upsert', {}),
      findMany: rec('push.findMany', over.tokens ?? []),
      deleteMany: rec('push.deleteMany', {}),
    },
  };
}

describe('JwtCallsAuth', () => {
  const jwt = (payload: any) => ({ verifyAsync: jest.fn(async () => { if (!payload) throw new Error('bad'); return payload; }) }) as any;

  it('accepts a valid token for a live device of that user', async () => {
    const prisma = fakePrisma({ device: { id: 'd1', name: 'Keona iPhone', platform: 'IOS' } });
    const ctx = await new JwtCallsAuth(jwt({ sub: 'u1' }), prisma).verify('t', { deviceId: 'd1' });
    expect(ctx).toEqual({ userId: 'u1', deviceId: 'd1', deviceName: 'Keona iPhone', platform: 'ios' });
    expect(prisma.calls[0][1].where).toEqual({ id: 'd1', userId: 'u1', revokedAt: null });
  });

  it('rejects bad tokens, missing devices and devices of other users', async () => {
    expect(await new JwtCallsAuth(jwt(null), fakePrisma()).verify('t', { deviceId: 'd1' })).toBeNull();
    expect(await new JwtCallsAuth(jwt({ sub: 'u1' }), fakePrisma()).verify('t', {})).toBeNull();
    expect(await new JwtCallsAuth(jwt({ sub: 'u1' }), fakePrisma({ device: null })).verify('t', { deviceId: 'dX' })).toBeNull();
  });
});

describe('PrismaConversationsAdapter', () => {
  it('blocks in either direction stop a call', async () => {
    const prisma = fakePrisma({ blockCount: 1 });
    expect(await new PrismaConversationsAdapter(prisma).canCall('a', 'b')).toBe(false);
    expect(prisma.calls[0][1].where.OR).toHaveLength(2);
  });
  it('needs a shared conversation', async () => {
    expect(await new PrismaConversationsAdapter(fakePrisma({ memberCount: 0 })).canCall('a', 'b')).toBe(false);
    expect(await new PrismaConversationsAdapter(fakePrisma({ memberCount: 1 })).canCall('a', 'b')).toBe(true);
    expect(await new PrismaConversationsAdapter(fakePrisma()).canCall('a', 'a')).toBe(false);
  });
});

describe('PrismaReportsRepository', () => {
  it('stores dates as Date and checks duplicates with array has', async () => {
    const prisma = fakePrisma();
    const repo = new PrismaReportsRepository(prisma);
    await repo.insert({
      id: 'r', callId: 'c', conversationId: 'v', kind: 'voice', reporterUserId: 'a', reportedUserIds: ['b'],
      reason: 'spam', note: null, callCreatedAt: 1, callAnsweredAt: null, callEndedAt: 3,
      participantUserIds: ['a', 'b'], createdAt: 4, status: 'open',
    });
    const data = prisma.calls[0][1].data;
    expect(data.callCreatedAt).toBeInstanceOf(Date);
    expect(data.callAnsweredAt).toBeNull();
    await repo.exists('c', 'a', 'b');
    expect(prisma.calls[1][1].where.reportedUserIds).toEqual({ has: 'b' });
  });
});

describe('VoipPushNotifier', () => {
  it('sends VoIP to iOS and FCM to Android, ids only, and deletes dead tokens', async () => {
    const prisma = fakePrisma({
      tokens: [
        { deviceId: 'iphone', kind: 'voip', token: 'aa' },
        { deviceId: 'pixel', kind: 'fcm', token: 'bb' },
      ],
    });
    const apns = { sendVoip: jest.fn(async () => ({ ok: false, status: 410, unregistered: true })) } as any;
    const fcm = { sendData: jest.fn(async () => ({ ok: true, status: 200, unregistered: false })) } as any;
    const n = new VoipPushNotifier(prisma, apns, fcm);

    await n.ring('bob', ['iphone', 'pixel'], { callId: 'c1', kind: 'video', fromUserId: 'alice' });
    expect(apns.sendVoip).toHaveBeenCalledWith('aa', { linqa: { type: 'call-ring', callId: 'c1', kind: 'video', fromUserId: 'alice' } });
    expect(fcm.sendData).toHaveBeenCalledWith('bb', { type: 'call-ring', callId: 'c1', kind: 'video', fromUserId: 'alice' });
    expect(prisma.calls.find((c) => c[0] === 'push.deleteMany')![1].where).toEqual({ deviceId: 'iphone', kind: 'voip' });

    await n.ring('bob', [], { callId: 'c2', kind: 'voice', fromUserId: 'alice' });
    expect(apns.sendVoip).toHaveBeenCalledTimes(1);
  });
});
