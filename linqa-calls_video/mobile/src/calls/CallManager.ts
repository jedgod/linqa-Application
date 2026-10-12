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
import { CallEngine } from './CallEngine';

export interface ManagerState {
  incoming: RingEvt | null;
  incomingHandoff: HandoffIncomingEvt | null;
  engine: CallEngine | null;
  busy: boolean;
  error: string | null;
}

const MLS_WELCOME_TIMEOUT_MS = 8000;
const SIGNAL_BUFFER_MS = 30_000;

export class CallManager {
  readonly signaling: SignalingClient;
  state: ManagerState = { incoming: null, incomingHandoff: null, engine: null, busy: false, error: null };
  private listeners = new Set<(s: ManagerState) => void>();
  /** Signals that arrive before the engine for that call exists. */
  private early = new Map<string, { from: string; ciphertext: string; at: number }[]>();

  constructor(readonly session: CallSession, readonly crypto: CallCrypto) {
    this.signaling = new SignalingClient(session);
    const s = this.signaling;

    s.on('call:ring', (e: RingEvt) => {
      if (this.state.engine && this.state.engine.state.status !== 'ended') {
        // Already on a call. Let it ring out on this device; others may answer.
        return;
      }
      this.set({ incoming: e });
    });
    s.on('call:ring-cancelled', (e) => {
      if (this.state.incoming?.callId === e.callId) this.set({ incoming: null });
    });
    s.on('call:ended', (e) => {
      if (this.state.incoming?.callId === e.callId) this.set({ incoming: null });
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
    s.on('call:handoff:incoming', (e: HandoffIncomingEvt) => this.set({ incomingHandoff: e }));
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
      const mlsGroupId = await this.crypto.createCallGroup([this.session.userId, ...inviteeUserIds]);
      const call = await this.signaling.request<CallSummary>(C2S.create, {
        conversationId,
        kind,
        mlsGroupId,
        inviteeUserIds,
      });
      return this.launch(call);
    });
  }

  /* ------------------------------------------------------------ incoming */

  async answer(): Promise<CallEngine> {
    const ring = this.state.incoming;
    if (!ring) throw new Error('no-incoming-call');
    return this.guard(async () => {
      await this.crypto.waitForGroup(ring.mlsGroupId, MLS_WELCOME_TIMEOUT_MS);
      const call = await this.signaling.request<CallSummary>(C2S.join, { callId: ring.callId });
      this.set({ incoming: null });
      return this.launch(call);
    });
  }

  async decline(): Promise<void> {
    const ring = this.state.incoming;
    if (!ring) return;
    this.set({ incoming: null });
    await this.signaling.request(C2S.decline, { callId: ring.callId }).catch(() => {});
  }

  /* ------------------------------------------------------------ switch device (target side) */

  /** The user tapped "Take call here". This is the confirm on the receiving device. */
  async acceptHandoff(): Promise<CallEngine> {
    const h = this.state.incomingHandoff;
    if (!h) throw new Error('no-handoff');
    return this.guard(async () => {
      await this.crypto.waitForGroup(h.mlsGroupId, MLS_WELCOME_TIMEOUT_MS);
      const res = await this.signaling.request<HandoffAcceptRes>(C2S.handoffAccept, {
        callId: h.callId,
        token: h.token,
      });
      this.set({ incomingHandoff: null });
      return this.launch(res.call, res.transferState);
    });
  }

  async declineHandoff(): Promise<void> {
    const h = this.state.incomingHandoff;
    if (!h) return;
    this.set({ incomingHandoff: null });
    await this.signaling.request(C2S.handoffCancel, { callId: h.callId, token: h.token }).catch(() => {});
  }

  /* ------------------------------------------------------------ internals */

  private async launch(call: CallSummary, transfer?: HandoffAcceptRes['transferState']): Promise<CallEngine> {
    const engine = new CallEngine(this.signaling, this.crypto, this.session, call, transfer);
    this.set({ engine });
    await engine.start();
    for (const s of this.early.get(call.callId) ?? []) engine.handleSignal(s.from, s.ciphertext);
    this.early.delete(call.callId);
    const off = engine.subscribe((st) => {
      if (st.status === 'ended') {
        off();
        // Leave the ended engine in place briefly so the UI can show why.
        setTimeout(() => this.state.engine === engine && this.set({ engine: null }), 1500);
      }
    });
    return engine;
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
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
