import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import {
  CallInfoRes,
  CallSummary,
  CreateCallReq,
  DeviceInfo,
  EndReason,
  HandoffAcceptRes,
  HandoffOfferRes,
  HandoffOfferReq,
  KeyEnvelope,
  LIMITS,
  ParticipantInfo,
  S2C,
  SignalReq,
} from './calls.protocol';
import {
  AuthContext,
  CALL_EMITTER,
  CallEmitter,
  CONVERSATIONS_PORT,
  ConversationsPort,
  RING_NOTIFIER,
  RingNotifier,
} from './calls.ports';
import { CallRecord, CallsStore, ParticipantRecord } from './calls.store';
import { TurnService } from './turn.service';

export class CallError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

const pid = (userId: string, deviceId: string) => `${userId}:${deviceId}`;
const validEnvelope = (e: unknown): e is string =>
  typeof e === 'string' && e.length > 0 && e.length <= LIMITS.maxEnvelopeBytes && /^[A-Za-z0-9+/=_-]+$/.test(e);

@Injectable()
export class CallsService implements OnModuleDestroy {
  private readonly log = new Logger(CallsService.name);
  private ringTimers = new Map<string, NodeJS.Timeout>(); // `${callId}|${userId}`
  private graceTimers = new Map<string, NodeJS.Timeout>(); // `${callId}|${participantId}`
  private handoffTimers = new Map<string, NodeJS.Timeout>(); // token
  private sweeper: NodeJS.Timeout;

  constructor(
    private readonly store: CallsStore,
    private readonly turn: TurnService,
    @Inject(CALL_EMITTER) private readonly emitter: CallEmitter,
    @Inject(CONVERSATIONS_PORT) private readonly conversations: ConversationsPort,
    @Inject(RING_NOTIFIER) private readonly ringNotifier: RingNotifier,
  ) {
    this.sweeper = setInterval(() => this.sweep(), 60 * 60 * 1000);
    this.sweeper.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
    for (const t of [...this.ringTimers.values(), ...this.graceTimers.values(), ...this.handoffTimers.values()]) {
      clearTimeout(t);
    }
  }

  /* ------------------------------------------------------------ create */

  async create(ctx: AuthContext, req: CreateCallReq): Promise<CallSummary> {
    if (req.kind !== 'voice' && req.kind !== 'video') throw new CallError('bad-kind');
    if (!req.keyId || typeof req.keyId !== 'string' || req.keyId.length > 64) throw new CallError('missing-key-id');
    const invitees = [...new Set(req.inviteeUserIds)].filter((u) => u !== ctx.userId);
    if (invitees.length === 0) throw new CallError('no-invitees');
    if (invitees.length + 1 > LIMITS.maxParticipants) throw new CallError('too-many-participants');

    if (!(await this.conversations.isMember(req.conversationId, ctx.userId))) throw new CallError('forbidden');
    for (const u of invitees) {
      if (!(await this.conversations.isMember(req.conversationId, u))) throw new CallError('invitee-not-member');
      if (!(await this.conversations.canCall(ctx.userId, u))) throw new CallError('cannot-call-user');
    }

    const envelopes = this.checkEnvelopes(req.keyEnvelopes, invitees);

    const now = Date.now();
    const call: CallRecord = {
      callId: randomUUID(),
      conversationId: req.conversationId,
      kind: req.kind,
      keyId: req.keyId,
      createdBy: ctx.userId,
      createdAt: now,
      answeredAt: null,
      endedAt: null,
      endReason: null,
      participants: new Map(),
      invited: new Set(),
      everJoined: new Set([ctx.userId]),
      everInvited: new Set(),
      envelopes: new Map(),
    };
    this.addParticipant(call, ctx, now);
    this.store.put(call);
    for (const u of invitees) this.ring(call, u, ctx, envelopes.filter((e) => e.userId === u));
    return this.summary(call, ctx.userId);
  }

  /* ------------------------------------------------------------ join / decline / leave */

  join(ctx: AuthContext, callId: string): CallSummary {
    const call = this.live(callId);
    const me = pid(ctx.userId, ctx.deviceId);
    const existing = call.participants.get(me);

    if (existing) {
      // Same device reconnecting after a dropped socket.
      existing.disconnectedAt = undefined;
      this.clearGrace(call.callId, me);
      return this.summary(call, ctx.userId);
    }

    if (!call.invited.has(ctx.userId) && !call.everJoined.has(ctx.userId)) throw new CallError('not-invited');
    if (this.userParticipant(call, ctx.userId)) throw new CallError('in-call-on-other-device');
    if (call.participants.size >= LIMITS.maxParticipants) throw new CallError('call-full');

    const now = Date.now();
    this.stopRinging(call, ctx.userId, 'answered-elsewhere', ctx.deviceId);
    const participant = this.addParticipant(call, ctx, now);
    if (!call.answeredAt && call.participants.size >= 2) call.answeredAt = now;

    this.broadcast(call, S2C.participantJoined, { callId, participant: this.info(participant) }, me);
    return this.summary(call, ctx.userId);
  }

  decline(ctx: AuthContext, callId: string): void {
    const call = this.live(callId);
    if (!call.invited.has(ctx.userId)) return;
    this.stopRinging(call, ctx.userId, 'answered-elsewhere', ctx.deviceId);
    this.broadcast(call, S2C.declined, { callId, userId: ctx.userId });
    this.maybeEndAfterChange(call, 'declined');
  }

  leave(ctx: AuthContext, callId: string): void {
    const call = this.store.get(callId);
    if (!call || call.endedAt) return;
    this.removeParticipant(call, pid(ctx.userId, ctx.deviceId), true);
  }

  /** Socket dropped. Give the device a short window to come back. */
  deviceDisconnected(userId: string, deviceId: string): void {
    const me = pid(userId, deviceId);
    for (const call of this.store.activeCallsForDevice(userId, deviceId)) {
      const p = call.participants.get(me);
      if (!p) continue;
      p.disconnectedAt = Date.now();
      const key = `${call.callId}|${me}`;
      this.clearGrace(call.callId, me);
      const t = setTimeout(() => {
        this.graceTimers.delete(key);
        const still = call.participants.get(me);
        if (still?.disconnectedAt) this.removeParticipant(call, me, true);
      }, LIMITS.reconnectGraceMs);
      t.unref?.();
      this.graceTimers.set(key, t);
    }
  }

  /* ------------------------------------------------------------ signaling relay */

  signal(ctx: AuthContext, req: SignalReq): void {
    const call = this.live(req.callId);
    const from = pid(ctx.userId, ctx.deviceId);
    if (!call.participants.has(from)) throw new CallError('not-in-call');
    const target = call.participants.get(req.to);
    if (!target) throw new CallError('peer-not-in-call');
    if (typeof req.ciphertext !== 'string' || req.ciphertext.length > LIMITS.maxSignalBytes) {
      throw new CallError('bad-signal');
    }
    // Opaque ciphertext signed by the sender's device key. The server cannot read or alter SDP/ICE.
    this.emitter.toDevice(target.userId, target.deviceId, S2C.signal, {
      callId: call.callId,
      from,
      ciphertext: req.ciphertext,
    });
  }

  /* ------------------------------------------------------------ add person */

  async invite(ctx: AuthContext, callId: string, userIds: string[], keyEnvelopes: KeyEnvelope[]): Promise<void> {
    const call = this.live(callId);
    if (!call.participants.has(pid(ctx.userId, ctx.deviceId))) throw new CallError('not-in-call');
    const fresh = [...new Set(userIds)].filter(
      (u) => u !== ctx.userId && !call.invited.has(u) && !this.userParticipant(call, u),
    );
    if (fresh.length === 0) return;
    if (call.participants.size + call.invited.size + fresh.length > LIMITS.maxParticipants) {
      throw new CallError('call-full');
    }
    for (const u of fresh) {
      if (!(await this.conversations.canCall(ctx.userId, u))) throw new CallError('cannot-call-user');
    }
    const envelopes = this.checkEnvelopes(keyEnvelopes, fresh);
    for (const u of fresh) this.ring(call, u, ctx, envelopes.filter((e) => e.userId === u));
  }

  /* ------------------------------------------------------------ switch device */

  otherDevices(ctx: AuthContext): DeviceInfo[] {
    return this.emitter.onlineDevices(ctx.userId).filter((d) => d.deviceId !== ctx.deviceId);
  }

  handoffOffer(ctx: AuthContext, req: HandoffOfferReq): HandoffOfferRes {
    const call = this.live(req.callId);
    const from = pid(ctx.userId, ctx.deviceId);
    if (!call.participants.has(from)) throw new CallError('not-in-call');
    if (req.toDeviceId === ctx.deviceId) throw new CallError('same-device');
    if (!this.emitter.onlineDevices(ctx.userId).some((d) => d.deviceId === req.toDeviceId)) {
      throw new CallError('device-offline');
    }
    if (!validEnvelope(req.keyEnvelope)) throw new CallError('bad-envelope');
    // One pending handoff per source device.
    for (const h of this.store.handoffsForCall(call.callId)) {
      if (h.fromParticipantId === from) this.cancelHandoffInternal(h.token);
    }

    const token = randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + LIMITS.handoffTtlMs;
    this.store.putHandoff({
      token,
      callId: call.callId,
      userId: ctx.userId,
      fromParticipantId: from,
      fromDeviceId: ctx.deviceId,
      toDeviceId: req.toDeviceId,
      transferState: {
        muted: !!req.transferState?.muted,
        cameraOn: !!req.transferState?.cameraOn,
      },
      keyEnvelope: req.keyEnvelope,
      expiresAt,
    });
    const t = setTimeout(() => this.cancelHandoffInternal(token), LIMITS.handoffTtlMs);
    t.unref?.();
    this.handoffTimers.set(token, t);

    this.emitter.toDevice(ctx.userId, req.toDeviceId, S2C.handoffIncoming, {
      callId: call.callId,
      token,
      fromDeviceId: ctx.deviceId,
      fromDeviceName: ctx.deviceName,
      kind: call.kind,
      keyId: call.keyId,
      keyEnvelope: req.keyEnvelope,
      expiresAt,
    });
    return { token, expiresAt };
  }

  handoffAccept(ctx: AuthContext, callId: string, token: string): HandoffAcceptRes {
    const h = this.store.getHandoff(token);
    if (!h || h.callId !== callId || h.userId !== ctx.userId || h.toDeviceId !== ctx.deviceId) {
      throw new CallError('bad-handoff');
    }
    if (h.expiresAt < Date.now()) {
      this.cancelHandoffInternal(token);
      throw new CallError('handoff-expired');
    }
    const call = this.live(callId);
    const old = call.participants.get(h.fromParticipantId);
    if (!old) {
      this.cancelHandoffInternal(token);
      throw new CallError('source-left');
    }
    this.store.deleteHandoff(token);
    this.clearHandoffTimer(token);

    const now = Date.now();
    call.participants.delete(old.participantId);
    this.clearGrace(call.callId, old.participantId);
    const fresh = this.addParticipant(call, ctx, now);

    this.broadcast(
      call,
      S2C.participantJoined,
      { callId, participant: this.info(fresh), replaces: old.participantId },
      fresh.participantId,
    );
    this.emitter.toDevice(old.userId, old.deviceId, S2C.handoffCompleted, { callId, toDeviceId: ctx.deviceId });
    return { call: this.summary(call, ctx.userId), transferState: h.transferState };
  }

  handoffCancel(ctx: AuthContext, callId: string, token: string): void {
    const h = this.store.getHandoff(token);
    if (!h || h.callId !== callId || h.userId !== ctx.userId) return;
    this.cancelHandoffInternal(token);
  }

  /* ------------------------------------------------------------ info / reports support */

  info(p: ParticipantRecord): ParticipantInfo {
    return { participantId: p.participantId, userId: p.userId, deviceId: p.deviceId, joinedAt: p.joinedAt };
  }

  callInfo(userId: string, callId: string, now = Date.now()): CallInfoRes {
    const call = this.store.get(callId);
    if (!call || (!call.everJoined.has(userId) && !call.everInvited.has(userId))) throw new CallError('not-found');
    const end = call.endedAt ?? now;
    return {
      callId: call.callId,
      kind: call.kind,
      createdAt: call.createdAt,
      answeredAt: call.answeredAt,
      endedAt: call.endedAt,
      durationMs: call.answeredAt ? Math.max(0, end - call.answeredAt) : 0,
      participantCount: call.participants.size,
      maxParticipants: LIMITS.maxParticipants,
    };
  }

  /** Read-only view for the reports service. */
  getRecord(callId: string): CallRecord | undefined {
    return this.store.get(callId);
  }

  /* ------------------------------------------------------------ internals */

  private live(callId: string): CallRecord {
    const call = this.store.get(callId);
    if (!call) throw new CallError('not-found');
    if (call.endedAt) throw new CallError('call-ended');
    return call;
  }

  private addParticipant(call: CallRecord, ctx: AuthContext, now: number): ParticipantRecord {
    const p: ParticipantRecord = {
      participantId: pid(ctx.userId, ctx.deviceId),
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      joinedAt: now,
    };
    call.participants.set(p.participantId, p);
    call.everJoined.add(ctx.userId);
    return p;
  }

  private userParticipant(call: CallRecord, userId: string): ParticipantRecord | undefined {
    for (const p of call.participants.values()) if (p.userId === userId) return p;
    return undefined;
  }

  private removeParticipant(call: CallRecord, participantId: string, notify: boolean): void {
    const p = call.participants.get(participantId);
    if (!p) return;
    call.participants.delete(participantId);
    this.clearGrace(call.callId, participantId);
    for (const h of this.store.handoffsForCall(call.callId)) {
      if (h.fromParticipantId === participantId) this.cancelHandoffInternal(h.token);
    }
    if (notify) this.broadcast(call, S2C.participantLeft, { callId: call.callId, participantId });
    this.maybeEndAfterChange(call, 'hangup');
  }

  /**
   * Ends the call when nobody can talk to anybody:
   *  - no one left, or
   *  - one person left and no one is still ringing.
   */
  private maybeEndAfterChange(call: CallRecord, reason: EndReason): void {
    if (call.endedAt) return;
    const n = call.participants.size;
    if (n === 0 || (n === 1 && call.invited.size === 0)) {
      this.end(call, call.answeredAt ? 'hangup' : reason);
    }
  }

  private end(call: CallRecord, reason: EndReason): void {
    if (call.endedAt) return;
    call.endedAt = Date.now();
    call.endReason = reason;
    for (const u of [...call.invited]) this.stopRinging(call, u, 'ended');
    for (const p of call.participants.values()) this.clearGrace(call.callId, p.participantId);
    for (const h of this.store.handoffsForCall(call.callId)) this.cancelHandoffInternal(h.token);
    this.broadcast(call, S2C.ended, { callId: call.callId, reason });
    call.participants.clear();
  }

  /**
   * Rings each device that has a sealed key. A device with no envelope could
   * not decrypt the call, so it is not rung.
   */
  private ring(call: CallRecord, userId: string, from: AuthContext, envelopes: KeyEnvelope[]): void {
    call.invited.add(userId);
    call.everInvited.add(userId);
    for (const e of envelopes) {
      call.envelopes.set(`${e.userId}:${e.deviceId}`, {
        envelope: e.envelope,
        fromUserId: from.userId,
        fromDeviceId: from.deviceId,
      });
      this.emitRing(call, e.userId, e.deviceId);
    }
    const deviceIds = envelopes.map((e) => e.deviceId);
    this.ringNotifier
      .ring(userId, deviceIds, { callId: call.callId, kind: call.kind, fromUserId: from.userId })
      .catch((e) => this.log.warn(`ring push failed: ${e}`));

    const key = `${call.callId}|${userId}`;
    const t = setTimeout(() => {
      this.ringTimers.delete(key);
      if (call.endedAt || !call.invited.has(userId)) return;
      this.stopRinging(call, userId, 'timeout');
      this.maybeEndAfterChange(call, 'no-answer');
    }, LIMITS.ringTimeoutMs);
    t.unref?.();
    this.ringTimers.set(key, t);
  }

  private emitRing(call: CallRecord, userId: string, deviceId: string): void {
    const sealed = call.envelopes.get(`${userId}:${deviceId}`);
    if (!sealed) return;
    this.emitter.toDevice(userId, deviceId, S2C.ring, {
      callId: call.callId,
      conversationId: call.conversationId,
      kind: call.kind,
      keyId: call.keyId,
      fromUserId: sealed.fromUserId,
      fromDeviceId: sealed.fromDeviceId,
      keyEnvelope: sealed.envelope,
    });
  }

  /**
   * A device just connected (often woken by a VoIP push). Re-send any ring
   * it is still owed so the app can show or answer the call.
   */
  resendRings(userId: string, deviceId: string): void {
    for (const call of this.store.ringingFor(userId)) this.emitRing(call, userId, deviceId);
  }

  /** Envelopes must target the given users, be well-formed and bounded. */
  private checkEnvelopes(list: unknown, userIds: string[]): KeyEnvelope[] {
    if (!Array.isArray(list) || list.length > LIMITS.maxEnvelopesPerRequest) throw new CallError('bad-envelope');
    const allowed = new Set(userIds);
    const out: KeyEnvelope[] = [];
    for (const e of list as KeyEnvelope[]) {
      if (!e || typeof e.userId !== 'string' || typeof e.deviceId !== 'string' || !validEnvelope(e.envelope)) {
        throw new CallError('bad-envelope');
      }
      if (!allowed.has(e.userId)) throw new CallError('bad-envelope');
      out.push({ userId: e.userId, deviceId: e.deviceId, envelope: e.envelope });
    }
    for (const u of userIds) if (!out.some((e) => e.userId === u)) throw new CallError('missing-envelope');
    return out;
  }

  private stopRinging(
    call: CallRecord,
    userId: string,
    reason: 'answered-elsewhere' | 'ended' | 'timeout',
    exceptDeviceId?: string,
  ): void {
    if (!call.invited.delete(userId)) return;
    const key = `${call.callId}|${userId}`;
    const t = this.ringTimers.get(key);
    if (t) clearTimeout(t);
    this.ringTimers.delete(key);
    this.emitter.toUser(userId, S2C.ringCancelled, { callId: call.callId, reason }, { exceptDeviceId });
    this.ringNotifier.cancel(userId, call.callId).catch(() => undefined);
  }

  private cancelHandoffInternal(token: string): void {
    const h = this.store.getHandoff(token);
    if (!h) return;
    this.store.deleteHandoff(token);
    this.clearHandoffTimer(token);
    const payload = { callId: h.callId, token };
    this.emitter.toDevice(h.userId, h.toDeviceId, S2C.handoffCancelled, payload);
    this.emitter.toDevice(h.userId, h.fromDeviceId, S2C.handoffCancelled, payload);
  }

  private clearHandoffTimer(token: string): void {
    const t = this.handoffTimers.get(token);
    if (t) clearTimeout(t);
    this.handoffTimers.delete(token);
  }

  private clearGrace(callId: string, participantId: string): void {
    const key = `${callId}|${participantId}`;
    const t = this.graceTimers.get(key);
    if (t) clearTimeout(t);
    this.graceTimers.delete(key);
  }

  private broadcast(call: CallRecord, event: string, payload: unknown, exceptParticipantId?: string): void {
    for (const p of call.participants.values()) {
      if (p.participantId === exceptParticipantId) continue;
      this.emitter.toDevice(p.userId, p.deviceId, event, payload);
    }
  }

  private summary(call: CallRecord, forUserId: string): CallSummary {
    return {
      callId: call.callId,
      conversationId: call.conversationId,
      kind: call.kind,
      keyId: call.keyId,
      createdBy: call.createdBy,
      createdAt: call.createdAt,
      participants: [...call.participants.values()].map((p) => this.info(p)),
      iceServers: this.turn.iceServersFor(forUserId),
    };
  }

  private sweep(now = Date.now()): void {
    for (const c of [...this.store.all()]) {
      if (c.endedAt && now - c.endedAt > LIMITS.endedCallRetentionMs) this.store.delete(c.callId);
    }
  }
}
