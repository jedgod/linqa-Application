import { CallEmitter, ConversationsPort, AuthContext, NoopRingNotifier } from './calls.ports';
import { CallsService, CallError } from './calls.service';
import { CallsStore } from './calls.store';
import { TurnService } from './turn.service';
import { LIMITS, S2C } from './calls.protocol';
import { InMemoryReportsRepository, ReportsService } from './reports.service';

type Sent = { to: string; event: string; payload: any };

class FakeEmitter implements CallEmitter {
  sent: Sent[] = [];
  online: Record<string, { deviceId: string; name: string; platform: 'ios' }[]> = {};
  toUser(userId: string, event: string, payload: unknown, opts?: { exceptDeviceId?: string }) {
    this.sent.push({ to: `u:${userId}${opts?.exceptDeviceId ? `!${opts.exceptDeviceId}` : ''}`, event, payload });
  }
  toDevice(userId: string, deviceId: string, event: string, payload: unknown) {
    this.sent.push({ to: `d:${userId}:${deviceId}`, event, payload });
  }
  onlineDevices(userId: string) {
    return this.online[userId] ?? [];
  }
  of(event: string) {
    return this.sent.filter((s) => s.event === event);
  }
}

class Convos implements ConversationsPort {
  blocked = new Set<string>();
  async isMember(_c: string, u: string) {
    return ['alice', 'bob', 'cara', 'dan'].includes(u);
  }
  async canCall(a: string, b: string) {
    return !this.blocked.has(`${a}>${b}`);
  }
}

const ctx = (userId: string, deviceId = 'phone'): AuthContext => ({
  userId,
  deviceId,
  deviceName: deviceId,
  platform: 'ios',
});

describe('CallsService', () => {
  let svc: CallsService;
  let em: FakeEmitter;
  let convos: Convos;

  beforeEach(() => {
    jest.useFakeTimers();
    em = new FakeEmitter();
    convos = new Convos();
    svc = new CallsService(new CallsStore(), new TurnService(), em, convos, new NoopRingNotifier());
  });
  afterEach(() => {
    svc.onModuleDestroy();
    jest.useRealTimers();
  });

  const start = (kind: 'voice' | 'video' = 'voice', invitees = ['bob']) =>
    svc.create(ctx('alice'), { conversationId: 'c1', kind, mlsGroupId: 'g1', inviteeUserIds: invitees });

  it('rings invitees and connects on join', async () => {
    const call = await start();
    expect(em.of(S2C.ring).map((s) => s.to)).toEqual(['u:bob']);
    const joined = svc.join(ctx('bob'), call.callId);
    expect(joined.participants.map((p) => p.participantId).sort()).toEqual(['alice:phone', 'bob:phone']);
    expect(em.of(S2C.participantJoined)[0].to).toBe('d:alice:phone');
    // other bob devices stop ringing
    expect(em.of(S2C.ringCancelled)[0]).toMatchObject({ to: 'u:bob!phone', payload: { reason: 'answered-elsewhere' } });
  });

  it('ends with no-answer after ring timeout', async () => {
    const call = await start();
    jest.advanceTimersByTime(LIMITS.ringTimeoutMs + 1);
    expect(em.of(S2C.ended)[0].payload).toMatchObject({ callId: call.callId, reason: 'no-answer' });
  });

  it('ends with declined when the only invitee declines', async () => {
    const call = await start();
    svc.decline(ctx('bob'), call.callId);
    expect(em.of(S2C.ended)[0].payload.reason).toBe('declined');
  });

  it('keeps a group call alive while others still ring', async () => {
    const call = await start('voice', ['bob', 'cara']);
    svc.decline(ctx('bob'), call.callId);
    expect(em.of(S2C.ended)).toHaveLength(0);
  });

  it('only relays signals between participants and never reads them', async () => {
    const call = await start();
    expect(() =>
      svc.signal(ctx('bob'), { callId: call.callId, to: 'alice:phone', ciphertext: 'x' }),
    ).toThrow(CallError);
    svc.join(ctx('bob'), call.callId);
    svc.signal(ctx('bob'), { callId: call.callId, to: 'alice:phone', ciphertext: 'opaque' });
    expect(em.of(S2C.signal)[0]).toEqual({
      to: 'd:alice:phone',
      event: S2C.signal,
      payload: { callId: call.callId, from: 'bob:phone', ciphertext: 'opaque' },
    });
  });

  it('add person: rings the new user, enforces blocks and capacity', async () => {
    const call = await start();
    svc.join(ctx('bob'), call.callId);
    await svc.invite(ctx('alice'), call.callId, ['cara']);
    expect(em.of(S2C.ring).map((s) => s.to)).toContain('u:cara');

    convos.blocked.add('alice>dan');
    await expect(svc.invite(ctx('alice'), call.callId, ['dan'])).rejects.toThrow('cannot-call-user');

    const many = Array.from({ length: LIMITS.maxParticipants }, (_, i) => `x${i}`);
    await expect(svc.invite(ctx('alice'), call.callId, many)).rejects.toThrow('call-full');
  });

  it('rejects a second device of the same user joining without a handoff', async () => {
    const call = await start();
    svc.join(ctx('bob'), call.callId);
    expect(() => svc.join(ctx('bob', 'laptop'), call.callId)).toThrow('in-call-on-other-device');
  });

  it('switch device: offer, accept on target, old device replaced', async () => {
    const call = await start();
    svc.join(ctx('bob'), call.callId);
    em.online.alice = [
      { deviceId: 'phone', name: 'iPhone', platform: 'ios' },
      { deviceId: 'desk', name: 'MacBook', platform: 'ios' },
    ];
    const { token } = svc.handoffOffer(ctx('alice'), {
      callId: call.callId,
      toDeviceId: 'desk',
      transferState: { muted: true, cameraOn: false },
    });
    expect(em.of(S2C.handoffIncoming)[0].to).toBe('d:alice:desk');

    expect(() => svc.handoffAccept(ctx('alice', 'other'), call.callId, token)).toThrow('bad-handoff');
    const res = svc.handoffAccept(ctx('alice', 'desk'), call.callId, token);
    expect(res.transferState).toEqual({ muted: true, cameraOn: false });
    expect(res.call.participants.map((p) => p.participantId).sort()).toEqual(['alice:desk', 'bob:phone']);

    const joined = em.of(S2C.participantJoined).find((s) => s.payload.replaces);
    expect(joined).toMatchObject({ to: 'd:bob:phone', payload: { replaces: 'alice:phone' } });
    expect(em.of(S2C.handoffCompleted)[0].to).toBe('d:alice:phone');
    expect(em.of(S2C.ended)).toHaveLength(0);
    // token is single use
    expect(() => svc.handoffAccept(ctx('alice', 'desk'), call.callId, token)).toThrow('bad-handoff');
  });

  it('switch device: offer expires', async () => {
    const call = await start();
    svc.join(ctx('bob'), call.callId);
    em.online.alice = [{ deviceId: 'desk', name: 'Mac', platform: 'ios' }];
    const { token } = svc.handoffOffer(ctx('alice'), {
      callId: call.callId,
      toDeviceId: 'desk',
      transferState: { muted: false, cameraOn: false },
    });
    jest.advanceTimersByTime(LIMITS.handoffTtlMs + 1);
    expect(em.of(S2C.handoffCancelled)).toHaveLength(2);
    expect(() => svc.handoffAccept(ctx('alice', 'desk'), call.callId, token)).toThrow('bad-handoff');
  });

  it('call info: duration counts from answer, only for people in the call', async () => {
    jest.setSystemTime(1_000_000);
    const call = await start();
    jest.setSystemTime(1_005_000);
    svc.join(ctx('bob'), call.callId);
    jest.setSystemTime(1_065_000);
    const info = svc.callInfo('alice', call.callId);
    expect(info.durationMs).toBe(60_000);
    expect(info.participantCount).toBe(2);
    expect(() => svc.callInfo('dan', call.callId)).toThrow('not-found');
  });

  it('drops a device after the reconnect grace period, keeps it if it rejoins', async () => {
    const call = await start('voice', ['bob', 'cara']);
    svc.join(ctx('bob'), call.callId);
    svc.join(ctx('cara'), call.callId);
    svc.deviceDisconnected('cara', 'phone');
    svc.join(ctx('cara'), call.callId); // reconnect
    jest.advanceTimersByTime(LIMITS.reconnectGraceMs + 1);
    expect(em.of(S2C.participantLeft)).toHaveLength(0);

    svc.deviceDisconnected('cara', 'phone');
    jest.advanceTimersByTime(LIMITS.reconnectGraceMs + 1);
    expect(em.of(S2C.participantLeft)[0].payload.participantId).toBe('cara:phone');
  });

  it('reports: metadata only, must have been in the call, no duplicates', async () => {
    const repo = new InMemoryReportsRepository();
    const reports = new ReportsService(svc, repo);
    const call = await start();
    svc.join(ctx('bob'), call.callId);
    svc.leave(ctx('bob'), call.callId);

    await expect(reports.create('dan', call.callId, { reportedUserIds: ['bob'], reason: 'spam' })).rejects.toThrow(
      'not-found',
    );
    await expect(
      reports.create('alice', call.callId, { reportedUserIds: ['bob'], reason: 'nope' as any }),
    ).rejects.toThrow('bad-reason');

    const { id } = await reports.create('alice', call.callId, {
      reportedUserIds: ['bob'],
      reason: 'harassment',
      note: '  said threatening things  ',
    });
    expect(repo.rows[0]).toMatchObject({ id, reportedUserIds: ['bob'], note: 'said threatening things' });
    await expect(
      reports.create('alice', call.callId, { reportedUserIds: ['bob'], reason: 'harassment' }),
    ).rejects.toThrow('already-reported');
  });
});
