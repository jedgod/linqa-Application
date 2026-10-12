/**
 * App-wide entry point for calls. Owns the signaling socket, incoming rings,
 * incoming device switches, and the active CallEngine.
 *
 *   const calls = new CallManager(session, crypto);
 *   <CallProvider manager={calls} people={directory}> ... </CallProvider>
 */
import {
  C2S,
  CallKind,
  CallSummary,
  HandoffAcceptRes,
  HandoffIncomingEvt,
  RingEvt,
} from './protocol';
import type { CallCrypto, CallSession } from './ports';
import { SignalingClient } from './signaling';
import { CallDirection, CallEngine } from './CallEngine';

export interface ManagerState {
  incoming: RingEvt | null;
  incomingHandoff: HandoffIncomingEvt | null;
  engine: CallEngine | null;
  busy: boolean;
  error: string | null;
}

const SIGNAL_BUFFER_MS = 30_000;

export class CallManager {
  readonly signaling: SignalingClient;
  state: ManagerState = { incoming: null, incomingHandoff: null, engine: null, busy: false, error: null };
  /** True when the OS shows incoming calls (CallKit), so the in-app ring card is skipped. */
  systemRingUi = false;
  private listeners = new Set<(s: ManagerState) => void>();
  /** Signals that arrive before the engine for that call exists. */
  private early = new Map<string, { from: string; ciphertext: string; at: number }[]>();
  private disposed = false;
  private cancelled = new Set<string>();
  private ringGeneration = 0;
  private ringListeners = new Set<(e: RingEvt) => void>();

  constructor(readonly session: CallSession, readonly crypto: CallCrypto) {
    this.signaling = new SignalingClient(session);
    const s = this.signaling;

    s.on('call:ring', async (e: RingEvt) => {
      if (this.disposed || this.cancelled.has(e.callId)) return;
      const generation = ++this.ringGeneration;
      if (this.state.engine && this.state.engine.state.status !== 'ended') {
        // Already on a call. Let it ring out on this device; others may answer.
        return;
      }
      if (this.state.incoming?.callId === e.callId) return; // re-sent after reconnect
      try {
        // Open and verify the sealed call key before showing anything.
        await this.crypto.acceptEnvelope(e.keyId, e.fromUserId, e.fromDeviceId, e.keyEnvelope);
      } catch (err) {
        console.warn('[call] rejected ring with bad key envelope', err);
        return;
      }
      if (this.disposed || generation !== this.ringGeneration || this.cancelled.has(e.callId) || this.state.busy || (this.state.engine && this.state.engine.state.status !== 'ended')) {
        await this.crypto.forget(e.keyId); return;
      }
      this.set({ incoming: e });
      this.ringListeners.forEach((l) => l(e));
    });
    s.on('call:ring-cancelled', (e) => {
      this.rememberCancellation(e.callId);
      const r = this.state.incoming;
      if (!r || r.callId !== e.callId) return;
      this.set({ incoming: null });
      this.crypto.forget(r.keyId).catch(() => {});
    });
    s.on('call:ended', (e) => {
      this.rememberCancellation(e.callId);
      const r = this.state.incoming;
      if (r && r.callId === e.callId) {
        this.set({ incoming: null });
        this.crypto.forget(r.keyId).catch(() => {});
      }
      this.early.delete(e.callId);
    });
    s.on('call:signal', (e) => {
      const engine = this.state.engine;
      if (engine && engine.state.callId === e.callId && engine.state.status !== 'ended') {
        engine.handleSignal(e.from, e.ciphertext);
        return;
      }
      const now = Date.now();
      const list = (this.early.get(e.callId) ?? []).filter((x) => now - x.at < SIGNAL_BUFFER_MS);
      if (list.length < 200) list.push({ from: e.from, ciphertext: e.ciphertext, at: now });
      this.early.set(e.callId, list);
    });
    s.on('call:handoff:incoming', async (e: HandoffIncomingEvt) => {
      try {
        await this.crypto.acceptEnvelope(e.keyId, this.session.userId, e.fromDeviceId, e.keyEnvelope);
      } catch (err) {
        console.warn('[call] rejected device switch with bad key envelope', err);
        return;
      }
      this.set({ incomingHandoff: e });
    });
    s.on('call:handoff:cancelled', (e) => {
      if (this.state.incomingHandoff?.token === e.token) this.set({ incomingHandoff: null });
    });
  }

  subscribe(fn: (s: ManagerState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  /* ------------------------------------------------------------ outgoing */

  async startCall(conversationId: string, kind: CallKind, inviteeUserIds: string[]): Promise<CallEngine> {
    return this.guard(async () => {
      const keyId = await this.crypto.createCallKey();
      try {
      const keyEnvelopes = await this.crypto.envelopesFor(keyId, inviteeUserIds);
      const call = await this.signaling.request<CallSummary>(C2S.create, {
        conversationId,
        kind,
        keyId,
        inviteeUserIds,
        keyEnvelopes,
      });
      return await this.launch(call, 'outgoing');
      } catch (error) { await this.crypto.forget(keyId); throw error; }
    });
  }

  /* ------------------------------------------------------------ incoming */

  async answer(): Promise<CallEngine> {
    const ring = this.state.incoming;
    if (!ring) throw new Error('no-incoming-call');
    return this.guard(async () => {
      if (!this.crypto.hasKey(ring.keyId)) throw new Error('no-call-key');
      const call = await this.signaling.request<CallSummary>(C2S.join, { callId: ring.callId });
      this.set({ incoming: null });
      return this.launch(call, 'incoming');
    });
  }

  async decline(): Promise<void> {
    const ring = this.state.incoming;
    if (!ring) return;
    this.set({ incoming: null });
    this.crypto.forget(ring.keyId).catch(() => {});
    await this.signaling.request(C2S.decline, { callId: ring.callId }).catch(() => {});
  }

  /**
   * Answer from the system call UI (CallKit / ConnectionService). The app may
   * have just been woken by a push, so wait briefly for the ring to arrive
   * over the socket (the server re-sends it on connect).
   */
  async answerById(callId: string, timeoutMs = 15_000): Promise<CallEngine> {
    const ready = () => this.state.incoming?.callId === callId;
    if (!ready()) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => (off(), reject(new Error('ring-not-received'))), timeoutMs);
        const off = this.subscribe(() => ready() && (clearTimeout(t), off(), resolve()));
      });
    }
    return this.answer();
  }

  async declineById(callId: string): Promise<void> {
    if (this.state.incoming?.callId === callId) return this.decline();
    await this.signaling.request(C2S.decline, { callId }).catch(() => {});
  }

  /** Fires for every verified incoming ring. Used by the CallKit bridge. */
  onRing(fn: (e: RingEvt) => void): () => void {
    this.ringListeners.add(fn);
    return () => this.ringListeners.delete(fn);
  }

  /* ------------------------------------------------------------ switch device (target side) */

  /** The user tapped "Take call here". This is the confirm on the receiving device. */
  async acceptHandoff(): Promise<CallEngine> {
    const h = this.state.incomingHandoff;
    if (!h) throw new Error('no-handoff');
    return this.guard(async () => {
      if (!this.crypto.hasKey(h.keyId)) throw new Error('no-call-key');
      const res = await this.signaling.request<HandoffAcceptRes>(C2S.handoffAccept, {
        callId: h.callId,
        token: h.token,
      });
      this.set({ incomingHandoff: null });
      return this.launch(res.call, 'handoff', res.transferState);
    });
  }

  async declineHandoff(): Promise<void> {
    const h = this.state.incomingHandoff;
    if (!h) return;
    this.set({ incomingHandoff: null });
    await this.signaling.request(C2S.handoffCancel, { callId: h.callId, token: h.token }).catch(() => {});
  }

  /* ------------------------------------------------------------ internals */

  private async launch(
    call: CallSummary,
    direction: CallDirection,
    transfer?: HandoffAcceptRes['transferState'],
  ): Promise<CallEngine> {
    const engine = new CallEngine(this.signaling, this.crypto, this.session, call, direction, transfer);
    this.set({ engine });
    try { await engine.start(); } catch (error) {
      await engine.hangUp();
      if (this.state.engine === engine) this.set({ engine: null });
      throw error;
    }
    if (this.disposed) { await engine.hangUp(); throw new Error('calls-disposed'); }
    for (const s of this.early.get(call.callId) ?? []) engine.handleSignal(s.from, s.ciphertext);
    this.early.delete(call.callId);
    let off = () => {};
    off = engine.subscribe((st) => {
      if (st.status === 'ended') {
        
        off();
        // Leave the ended engine in place briefly so the UI can show why.
        setTimeout(() => this.state.engine === engine && this.set({ engine: null }), 1500);
      }
    });
    if (engine.state.status === "ended") off();
    return engine;
  }

  private rememberCancellation(callId: string): void {
    this.cancelled.add(callId);
    if (this.cancelled.size > 1024) this.cancelled.delete(this.cancelled.values().next().value!);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.ringGeneration++;
    
    const engine = this.state.engine;
    if (engine && engine.state.status !== 'ended') void engine.hangUp();
    if (this.state.incoming) void this.crypto.forget(this.state.incoming.keyId);
    if (this.state.incomingHandoff) void this.crypto.forget(this.state.incomingHandoff.keyId);
    this.early.clear(); this.listeners.clear(); this.ringListeners.clear();
    this.signaling.close();
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    if (this.disposed || this.state.busy || (this.state.engine && this.state.engine.state.status !== 'ended')) throw new Error('call-already-active');

    this.ringGeneration++;
    this.set({ busy: true, error: null });
    try {
      return await fn();
    } catch (e: any) {
      this.set({ error: e?.code ?? e?.message ?? 'error' });
      throw e;
    } finally {
      this.set({ busy: false });
    }
  }

  private set(patch: Partial<ManagerState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }
}