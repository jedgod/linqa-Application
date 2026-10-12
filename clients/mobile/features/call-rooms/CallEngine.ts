/**
 * One call on one device. Full-mesh WebRTC (up to LIMITS.maxParticipants).
 *
 * Why this is end-to-end encrypted:
 *  - SDP and ICE are encrypted with the per-call key (linqa-core) and signed
 *    by the sending device before they reach the server. The verified sender
 *    is checked against the claimed peer.
 *  - SDP carries each side's DTLS fingerprint, so the media keys are bound to
 *    linqa-core device identities. A TURN relay only forwards SRTP it cannot read.
 *  - Hand raises, board strokes and camera state ride the WebRTC data channel.
 */
import { Platform } from 'react-native';
import {
  mediaDevices,
  MediaStream,
  MediaStreamTrack,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
} from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';
import {
  C2S,
  CallKind,
  CallSummary,
  DeviceInfo,
  EndReason,
  HandoffOfferRes,
  LIMITS,
  ParticipantInfo,
  TransferState,
} from './protocol';
import type { CallCrypto, CallSession } from './ports';
import type { SignalingClient } from './signaling';
import { applyBoardOp, Brush, BoardOp, BoardState, emptyBoard, onParticipantGone } from './board';
import { utf8Decode, utf8Encode } from './callApi';
import { callNative } from '../../modules/linqa-call-native';
import { showBroadcastPicker } from './native/ScreenSharePicker';

type RTCDataChannel = ReturnType<RTCPeerConnection['createDataChannel']>;
type RTCRtpTransceiver = ReturnType<RTCPeerConnection['addTransceiver']>;

export type Route = 'direct' | 'relay' | 'unknown';

export interface PeerView {
  participantId: string;
  userId: string;
  deviceId: string;
  connection: 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';
  route: Route;
  streamUrl: string | null;
  muted: boolean;
  cameraOn: boolean;
  screenSharing: boolean;
  handRaisedAt: number | null;
}

export interface SelfView {
  participantId: string;
  muted: boolean;
  speakerOn: boolean;
  cameraOn: boolean;
  facing: 'user' | 'environment';
  blurOn: boolean;
  sharingScreen: boolean;
  handRaisedAt: number | null;
  previewUrl: string | null;
}

export type CallDirection = 'outgoing' | 'incoming' | 'handoff';

export type EngineStatus = 'connecting' | 'waiting' | 'active' | 'switching' | 'ended';

export interface EngineState {
  callId: string;
  kind: CallKind;
  status: EngineStatus;
  connectedAt: number | null;
  self: SelfView;
  peers: Record<string, PeerView>;
  /** Users this device rang via Add person who have not answered yet. */
  ringing: string[];
  board: BoardState;
  handoff: { token: string; toDeviceId: string; expiresAt: number } | null;
  endReason: EndReason | 'moved' | null;
  notice: string | null;
}

type DataMsg =
  | { t: 'state'; muted: boolean; cameraOn: boolean; screen: boolean }
  | { t: 'hand'; raisedAt: number | null }
  | BoardOp;

interface SignalMsg {
  v: 1;
  desc?: { type: string; sdp: string };
  ice?: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null };
}

interface Peer {
  info: ParticipantInfo;
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  /** Null on the answering side until the first offer arrives. */
  audioTx: RTCRtpTransceiver | null;
  videoTx: RTCRtpTransceiver | null;
  /** The impolite side creates the media lines; the other side adopts them. */
  initiator: boolean;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  pendingIce: RTCIceCandidate[];
  queue: Promise<void>;
  remote: MediaStream;
  restartTimer?: ReturnType<typeof setTimeout>;
}

const BLUR_EFFECT = 'linqa-blur';
const VIDEO_CONSTRAINTS = { width: 1280, height: 720, frameRate: 24 };

export const deviceCapabilities = {
  blur: callNative.blurSupported,
  screenShare: callNative.screenShareSupported,
};

export class CallEngine {
  state: EngineState;
  private listeners = new Set<(s: EngineState) => void>();
  private peers = new Map<string, Peer>();
  private unsubs: (() => void)[] = [];
  private localStream = new MediaStream();
  private mic: MediaStreamTrack | null = null;
  private camera: MediaStreamTrack | null = null;
  private screen: MediaStreamTrack | null = null;
  private iceServers: CallSummary['iceServers'];
  private statsTimer?: ReturnType<typeof setInterval>;
  private readonly me: string;

  constructor(
    private readonly signaling: SignalingClient,
    private readonly crypto: CallCrypto,
    private readonly session: CallSession,
    private readonly call: CallSummary,
    readonly direction: CallDirection,
    private readonly transfer?: TransferState,
  ) {
    this.me = `${session.userId}:${session.deviceId}`;
    this.iceServers = call.iceServers;
    const video = call.kind === 'video';
    this.state = {
      callId: call.callId,
      kind: call.kind,
      status: 'connecting',
      connectedAt: null,
      self: {
        participantId: this.me,
        muted: transfer?.muted ?? false,
        speakerOn: video,
        cameraOn: transfer ? transfer.cameraOn : video,
        facing: 'user',
        blurOn: false,
        sharingScreen: false,
        handRaisedAt: null,
        previewUrl: null,
      },
      peers: {},
      ringing: [],
      board: emptyBoard(),
      handoff: null,
      endReason: null,
      notice: null,
    };
  }

  /* ================================================================ lifecycle */

  subscribe(fn: (s: EngineState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private cameraOpening = false;
  private screenOpening = false;
  private isEnded(): boolean { return this.state.status === 'ended'; }

  async start(): Promise<void> {
    InCallManager.start({ media: this.call.kind === 'video' ? 'video' : 'audio' });
    InCallManager.setForceSpeakerphoneOn(this.state.self.speakerOn);

    this.unsubs.push(this.signaling.on('call:ended', (e) => e.callId === this.call.callId && this.teardown(e.reason)));
    const media = await mediaDevices.getUserMedia({ audio: true, video: false });
    if (this.isEnded()) { media.getTracks().forEach(t => t.stop()); return; }
    this.mic = media.getAudioTracks()[0];
    if (!this.mic) { media.getTracks().forEach(t => t.stop()); throw new Error('no-audio-track'); }
    this.mic.enabled = !this.state.self.muted;
    this.localStream.addTrack(this.mic);
    if (this.state.self.cameraOn) await this.openCamera();

    if (this.isEnded()) return;
    const s = this.signaling;
    this.unsubs.push(
      s.on('call:participant-joined', (e) => e.callId === this.call.callId && this.onJoined(e.participant, e.replaces)),
      s.on('call:participant-left', (e) => e.callId === this.call.callId && this.onLeft(e.participantId)),
      s.on('call:declined', (e) => e.callId === this.call.callId && this.dropRinging(e.userId)),

      s.on('call:handoff:completed', (e) => e.callId === this.call.callId && this.teardown('moved')),
      s.on('call:handoff:cancelled', (e) => {
        if (e.callId !== this.call.callId || this.state.handoff?.token !== e.token) return;
        this.set({ handoff: null, status: this.hasConnectedPeer() ? 'active' : 'waiting', notice: 'Switch cancelled' });
      }),
      s.onReconnect(() => this.rejoinAfterReconnect()),
    );

    for (const p of this.call.participants) if (p.participantId !== this.me) this.addPeer(p);
    this.set({ status: this.peers.size ? 'connecting' : 'waiting' });
    this.statsTimer = setInterval(() => this.refreshRoutes(), 5000);
  }

  /** Called by CallManager for every signal addressed to this call. */
  handleSignal(from: string, ciphertext: string): void {
    if (this.isEnded()) return;
    let peer = this.peers.get(from);
    if (!peer) {
      // Signal raced ahead of participant-joined. Create from the id.
      const [userId, deviceId] = splitPid(from);
      if (!userId || !deviceId) return;
      peer = this.addPeer({ participantId: from, userId, deviceId, joinedAt: Date.now() });
    }
    const p = peer;
    p.queue = p.queue.then(() => this.processSignal(p, ciphertext)).catch((e) => console.warn('[call] signal', e));
  }

  async hangUp(): Promise<void> {
    this.teardown('hangup');
    try {
      await this.signaling.request(C2S.leave, { callId: this.call.callId }, 4000);
    } catch {}
  }

  /* ================================================================ bar controls */

  setMuted(muted: boolean): void {
    if (this.mic) this.mic.enabled = !muted;
    this.setSelf({ muted });
    this.broadcastState();
  }

  setSpeaker(on: boolean): void {
    InCallManager.setForceSpeakerphoneOn(on);
    this.setSelf({ speakerOn: on });
  }

  async setCamera(on: boolean): Promise<void> {
    if (this.isEnded() || this.cameraOpening || on === this.state.self.cameraOn) return;
    if (on) {
      await this.openCamera();
      if (this.isEnded()) return;
    } else {
      this.closeCamera();
      if (this.state.self.blurOn) this.setSelf({ blurOn: false });
    }
    this.setSelf({ cameraOn: on });
    if (!this.screen) await this.sendVideo(on ? this.camera : null);
    this.broadcastState();
  }

  /* ================================================================ More menu */

  async toggleHand(): Promise<void> {
    const raisedAt = this.state.self.handRaisedAt ? null : Date.now();
    this.setSelf({ handRaisedAt: raisedAt });
    this.broadcast({ t: 'hand', raisedAt });
  }

  /** Confirm happens in the UI before this is called. */
  async startScreenShare(): Promise<void> {
    if (this.screen || this.screenOpening || this.isEnded()) return;
    this.screenOpening = true;
    try {
    // Android: asks for capture consent; react-native-webrtc runs the
    // mediaProjection foreground service (switched on by linqa-call-native).
    // iOS: opens the app-side socket; frames start once the user taps
    // Start Broadcast in the system picker shown below.
    const display = await mediaDevices.getDisplayMedia({});
    if (this.isEnded()) { display.getTracks().forEach(t => t.stop()); return; }
    const track = display.getVideoTracks()[0];
    if (!track) { display.getTracks().forEach(t => t.stop()); throw new Error('no-screen-track'); }
    this.screen = track;
    listen(track, 'ended', () => this.stopScreenShare());
    if (Platform.OS === 'ios') showBroadcastPicker();
    await this.sendVideo(track);
    this.setSelf({ sharingScreen: true });
    if (!this.isEnded()) this.broadcastState();
    } finally { this.screenOpening = false; }
  }

  async stopScreenShare(): Promise<void> {
    if (!this.screen) return;
    if (Platform.OS === 'ios') callNative.stopScreenShareBroadcast(); // ends the extension
    const screen = this.screen;
    this.screen = null;
    screen.stop();
    await this.sendVideo(this.state.self.cameraOn ? this.camera : null);
    this.setSelf({ sharingScreen: false });
    this.broadcastState();
  }

  async flipCamera(): Promise<void> {
    if (!this.camera) return;
    const facing = this.state.self.facing === 'user' ? 'environment' : 'user';
    try {
      await this.camera.applyConstraints({ facingMode: facing } as any);
    } catch {
      this.camera._switchCamera();
    }
    this.setSelf({ facing });
  }

  setBlur(on: boolean): void {
    if (!this.camera || !deviceCapabilities.blur) return;
    this.camera._setVideoEffects(on ? [BLUR_EFFECT] : []);
    this.setSelf({ blurOn: on });
  }

  /** Confirm happens in the UI before this is called. */
  async addPeople(userIds: string[]): Promise<void> {
    const fresh = userIds.filter((u) => !this.state.ringing.includes(u));
    if (!fresh.length) return;
    const keyEnvelopes = await this.crypto.envelopesFor(this.call.keyId, fresh);
    await this.signaling.request(C2S.invite, { callId: this.call.callId, userIds: fresh, keyEnvelopes });
    this.set({ ringing: [...this.state.ringing, ...fresh] });
    for (const u of fresh) setTimeout(() => this.dropRinging(u), LIMITS.ringTimeoutMs);
  }

  /* ---------- board (confirm for opening happens in the UI) */

  openBoard(): void {
    this.applyBoard({ t: 'board-open', by: this.me, at: Date.now() }, this.me, true);
  }
  closeBoard(): void {
    this.applyBoard({ t: 'board-close', by: this.me }, this.me, true);
  }
  clearBoard(): void {
    this.applyBoard({ t: 'board-clear', by: this.me }, this.me, true);
  }
  drawPoints(id: string, color: string, width: number, pts: number[], brush?: Brush): void {
    this.applyBoard({ t: 'stroke-pts', id, color, width, pts, ...(brush ? { brush } : {}) }, this.me, true);
  }
  /** Any other board change (erase, fill, text, background): applied here and sent to the others. */
  sendBoardOp(op: BoardOp): void {
    this.applyBoard(op, this.me, true);
  }
  finishStroke(id: string): void {
    this.applyBoard({ t: 'stroke-done', id }, this.me, true);
  }
  undoStroke(): void {
    const mine = [...this.state.board.strokes].reverse().find((k) => k.author === this.me);
    if (mine) this.applyBoard({ t: 'stroke-undo', id: mine.id }, this.me, true);
  }

  /* ---------- switch device */

  async listOtherDevices(): Promise<DeviceInfo[]> {
    return this.signaling.request<DeviceInfo[]>(C2S.devices, { callId: this.call.callId });
  }

  async switchTo(deviceId: string): Promise<void> {
    const keyEnvelope = await this.crypto.envelopeForOwnDevice(this.call.keyId, deviceId);
    const res = await this.signaling.request<HandoffOfferRes>(C2S.handoffOffer, {
      callId: this.call.callId,
      toDeviceId: deviceId,
      transferState: { muted: this.state.self.muted, cameraOn: this.state.self.cameraOn },
      keyEnvelope,
    });
    this.set({ status: 'switching', handoff: { token: res.token, toDeviceId: deviceId, expiresAt: res.expiresAt } });
  }

  async cancelSwitch(): Promise<void> {
    const h = this.state.handoff;
    if (!h) return;
    this.set({ handoff: null, status: this.hasConnectedPeer() ? 'active' : 'waiting' });
    await this.signaling.request(C2S.handoffCancel, { callId: this.call.callId, token: h.token }).catch(() => {});
  }

  /* ---------- call info */

  async verificationCode(): Promise<string | null> {
    return this.crypto.verificationCode(this.call.keyId).catch(() => null);
  }

  /** 'relay' if any peer goes through TURN. */
  overallRoute(): Route {
    const routes = Object.values(this.state.peers).map((p) => p.route);
    if (routes.includes('relay')) return 'relay';
    if (routes.length && routes.every((r) => r === 'direct')) return 'direct';
    return 'unknown';
  }

  async refreshRoutes(): Promise<void> {
    for (const peer of this.peers.values()) {
      const route = await routeOf(peer.pc).catch((): Route => 'unknown');
      if (this.state.peers[peer.info.participantId]?.route !== route) this.patchPeer(peer.info.participantId, { route });
    }
  }

  /* ================================================================ peers */

  private addPeer(info: ParticipantInfo): Peer {
    const existing = this.peers.get(info.participantId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle', iceTransportPolicy: 'relay' } as any);
    const polite = this.me < info.participantId;
    const initiator = !polite;
    let audioTx: RTCRtpTransceiver | null = null;
    let videoTx: RTCRtpTransceiver | null = null;
    if (initiator) {
      audioTx = pc.addTransceiver(this.mic ?? 'audio', { direction: 'sendrecv', streams: [this.localStream] });
      // Video line always exists so camera on/off, screen share and voice->video
      // are a replaceTrack, not a renegotiation.
      videoTx = pc.addTransceiver('video', { direction: 'sendrecv', streams: [this.localStream] });
      const v = this.outgoingVideo();
      if (v) videoTx.sender.replaceTrack(v);
    }

    const dc = pc.createDataChannel('linqa', { negotiated: true, id: 0, ordered: true });
    const peer: Peer = {
      info,
      pc,
      dc,
      audioTx,
      videoTx,
      initiator,
      polite,
      makingOffer: false,
      ignoreOffer: false,
      pendingIce: [],
      queue: Promise.resolve(),
      remote: new MediaStream(),
    };
    this.peers.set(info.participantId, peer);
    this.patchPeer(info.participantId, {
      participantId: info.participantId,
      userId: info.userId,
      deviceId: info.deviceId,
      connection: 'new',
      route: 'unknown',
      streamUrl: null,
      muted: false,
      cameraOn: false,
      screenSharing: false,
      handRaisedAt: null,
    });

    listen(pc, 'negotiationneeded', async () => {
      // The answering side waits for the first offer instead of racing it.
      if (!peer.initiator && !pc.remoteDescription) return;
      try {
        peer.makingOffer = true;
        const offer = await pc.createOffer({});
        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription(offer);
        await this.sendSignal(peer, { v: 1, desc: { type: offer.type, sdp: offer.sdp! } });
      } catch (e) {
        console.warn('[call] offer', e);
      } finally {
        peer.makingOffer = false;
      }
    });

    listen(pc, 'icecandidate', (e: any) => {
      const c = e.candidate;
      if (!c) return;
      this.sendSignal(peer, {
        v: 1,
        ice: { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null },
      }).catch(() => {});
    });

    listen(pc, 'track', (e: any) => {
      const track: MediaStreamTrack = e.track;
      if (!peer.remote.getTracks().some((t) => t.id === track.id)) peer.remote.addTrack(track);
      this.patchPeer(info.participantId, { streamUrl: peer.remote.toURL() });
    });

    listen(pc, 'connectionstatechange', () => {
      const st = pc.connectionState as PeerView['connection'];
      this.patchPeer(info.participantId, { connection: st });
      if (st === 'connected') {
        clearTimeout(peer.restartTimer);
        if (!this.state.connectedAt) this.set({ connectedAt: Date.now() });
        if (this.state.status === 'connecting' || this.state.status === 'waiting') this.set({ status: 'active' });
        this.refreshRoutes();
      }
      if (st === 'disconnected') {
        clearTimeout(peer.restartTimer);
        peer.restartTimer = setTimeout(() => pc.connectionState !== 'connected' && this.restartIce(peer), 4000);
      }
      if (st === 'failed') this.restartIce(peer);
    });

    listen(dc, 'open', () => {
      this.sendTo(peer, this.stateMsg());
      if (this.state.self.handRaisedAt) this.sendTo(peer, { t: 'hand', raisedAt: this.state.self.handRaisedAt });
      const b = this.state.board;
      if (b.open && b.openedBy === this.me) {
        this.sendTo(peer, { t: 'board-sync', openedBy: this.me, openedAt: b.openedAt, strokes: b.strokes, texts: b.texts, fills: b.fills, bg: b.bg });
      }
    });
    listen(dc, 'message', (e: any) => this.onData(peer, e.data));

    return peer;
  }

  private async processSignal(peer: Peer, ciphertext: string): Promise<void> {
    const { senderUserId, senderDeviceId, plaintext } = await this.crypto.decrypt(this.call.keyId, ciphertext);
    // The server says who sent it; the device signature proves it. They must match.
    if (`${senderUserId}:${senderDeviceId}` !== peer.info.participantId) {
      console.warn('[call] dropped signal with mismatched sender');
      return;
    }
    const msg = JSON.parse(utf8Decode(plaintext)) as SignalMsg;
    const pc = peer.pc;
    if (this.isEnded() || this.peers.get(peer.info.participantId) !== peer) return;

    if (msg.desc) {
      const desc = new RTCSessionDescription(msg.desc as any);
      const collision = desc.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;
      if (collision) await pc.setLocalDescription({ type: 'rollback' } as any);
      await pc.setRemoteDescription(desc);
      if (this.isEnded() || this.peers.get(peer.info.participantId) !== peer) return;
      if (desc.type === 'offer' && !peer.audioTx) this.adoptTransceivers(peer);
      for (const c of peer.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      if (desc.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await this.sendSignal(peer, { v: 1, desc: { type: answer.type, sdp: answer.sdp! } });
      }
    } else if (msg.ice) {
      const cand = new RTCIceCandidate(msg.ice as any);
      if (!pc.remoteDescription) {
        peer.pendingIce.push(cand);
        return;
      }
      try {
        await pc.addIceCandidate(cand);
      } catch (e) {
        if (!peer.ignoreOffer) throw e;
      }
    }
  }

  /** Answering side: take over the offerer's audio/video lines and send on them. */
  private adoptTransceivers(peer: Peer): void {
    for (const t of peer.pc.getTransceivers()) {
      const kind = t.receiver.track?.kind;
      if (kind === 'audio' && !peer.audioTx) peer.audioTx = t;
      if (kind === 'video' && !peer.videoTx) peer.videoTx = t;
    }
    if (peer.audioTx) {
      peer.audioTx.direction = 'sendrecv';
      if (this.mic) peer.audioTx.sender.replaceTrack(this.mic);
    }
    if (peer.videoTx) {
      peer.videoTx.direction = 'sendrecv';
      const v = this.outgoingVideo();
      if (v) peer.videoTx.sender.replaceTrack(v);
    }
  }

  private outgoingVideo(): MediaStreamTrack | null {
    return this.screen ?? (this.state.self.cameraOn ? this.camera : null);
  }

  private async sendSignal(peer: Peer, msg: SignalMsg): Promise<void> {
    const ciphertext = await this.crypto.encrypt(this.call.keyId, utf8Encode(JSON.stringify(msg)));
    await this.signaling.request(C2S.signal, { callId: this.call.callId, to: peer.info.participantId, ciphertext });
  }

  private restartIce(peer: Peer): void {
    if (peer.pc.connectionState === 'closed') return;
    // Only the impolite side restarts, so both ends don't fight over it.
    if (!peer.polite) peer.pc.restartIce();
  }

  private onJoined(info: ParticipantInfo, replaces?: string): void {
    if (info.participantId === this.me) return;
    if (replaces && replaces !== this.me) {
      const old = this.state.peers[replaces];
      this.closePeer(replaces);
      this.set({ board: onParticipantGone(this.state.board, replaces, info.participantId) });
      this.addPeer(info);
      if (old?.handRaisedAt) this.patchPeer(info.participantId, { handRaisedAt: old.handRaisedAt });
    } else {
      this.addPeer(info);
      this.dropRinging(info.userId);
    }
  }

  private onLeft(participantId: string): void {
    this.closePeer(participantId);
    this.set({ board: onParticipantGone(this.state.board, participantId) });
    if (this.peers.size === 0 && this.state.status !== 'ended') this.set({ status: 'waiting' });
  }

  private closePeer(participantId: string): void {
    const p = this.peers.get(participantId);
    if (!p) return;
    clearTimeout(p.restartTimer);
    try {
      p.dc.close();
      p.pc.close();
    } catch {}
    this.peers.delete(participantId);
    const { [participantId]: _gone, ...rest } = this.state.peers;
    this.set({ peers: rest });
  }

  private dropRinging(userId: string): void {
    if (this.state.ringing.includes(userId)) this.set({ ringing: this.state.ringing.filter((u) => u !== userId) });
  }

  private async rejoinAfterReconnect(): Promise<void> {
    if (this.isEnded()) return;
    try {
      await this.signaling.request(C2S.join, { callId: this.call.callId });
    } catch {
      this.teardown('error');
    }
  }

  /* ================================================================ data channel */

  private onData(peer: Peer, raw: unknown): void {
    if (typeof raw !== 'string' || raw.length > 64 * 1024) return;
    let msg: DataMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const from = peer.info.participantId;
    if (!msg || typeof msg !== "object" || this.isEnded() || this.peers.get(peer.info.participantId) !== peer) return;
    switch (msg.t) {
      case 'state':
        this.patchPeer(from, { muted: !!msg.muted, cameraOn: !!msg.cameraOn, screenSharing: !!msg.screen });
        return;
      case 'hand':
        this.patchPeer(from, { handRaisedAt: typeof msg.raisedAt === 'number' && Number.isFinite(msg.raisedAt) && msg.raisedAt > 0 ? msg.raisedAt : null });
        return;
      default:
        this.applyBoard(msg, from, false);
    }
  }

  private applyBoard(op: BoardOp, from: string, local: boolean): void {
    const next = applyBoardOp(this.state.board, op, from);
    if (next === this.state.board) return;
    this.set({ board: next });
    if (local) this.broadcast(op);
  }

  private stateMsg(): DataMsg {
    const s = this.state.self;
    return { t: 'state', muted: s.muted, cameraOn: s.cameraOn || s.sharingScreen, screen: s.sharingScreen };
  }

  private broadcastState(): void {
    this.broadcast(this.stateMsg());
  }

  private broadcast(msg: DataMsg): void {
    for (const p of this.peers.values()) this.sendTo(p, msg);
  }

  private sendTo(peer: Peer, msg: DataMsg): void {
    if (peer.dc.readyState !== 'open') return;
    try {
      peer.dc.send(JSON.stringify(msg));
    } catch {}
  }

  /* ================================================================ media */

  private async openCamera(): Promise<void> {
    if (this.camera || this.cameraOpening || this.isEnded()) return;
    this.cameraOpening = true;
    try {
    const s = await mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: this.state.self.facing, ...VIDEO_CONSTRAINTS },
    } as any);
    if (this.isEnded()) { s.getTracks().forEach(t => t.stop()); return; }
    this.camera = s.getVideoTracks()[0];
    if (!this.camera) { s.getTracks().forEach(t => t.stop()); throw new Error('no-camera-track'); }
    this.localStream.addTrack(this.camera);
    this.setSelf({ previewUrl: new MediaStream([this.camera]).toURL() });
    } finally { this.cameraOpening = false; }
  }

  private closeCamera(): void {
    if (!this.camera) return;
    this.localStream.removeTrack(this.camera);
    this.camera.stop();
    this.camera = null;
    this.setSelf({ previewUrl: null });
  }

  private async sendVideo(track: MediaStreamTrack | null): Promise<void> {
    await Promise.all([...this.peers.values()].map((p) => p.videoTx?.sender.replaceTrack(track).catch(() => {})));
  }

  /* ================================================================ teardown */

  private teardown(reason: EndReason | 'moved'): void {
    if (this.isEnded()) return;
    clearInterval(this.statsTimer);
    this.unsubs.forEach((u) => u());
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.screen?.stop();
    this.camera?.stop();
    this.mic?.stop();
    this.screen = this.camera = this.mic = null;
    InCallManager.stop();
    this.crypto.forget(this.call.keyId).catch(() => {});
    this.set({ status: 'ended', endReason: reason, handoff: null });
  }

  /* ================================================================ state helpers */

  private hasConnectedPeer(): boolean {
    return Object.values(this.state.peers).some((p) => p.connection === 'connected');
  }

  private set(patch: Partial<EngineState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }

  private setSelf(patch: Partial<SelfView>): void {
    this.set({ self: { ...this.state.self, ...patch } });
  }

  private patchPeer(id: string, patch: Partial<PeerView>): void {
    const prev = this.state.peers[id];
    if (!prev && !patch.participantId) return;
    this.set({ peers: { ...this.state.peers, [id]: { ...(prev as PeerView), ...patch } } });
  }
}

/**
 * react-native-webrtc 124's published .d.ts files reference a vendored
 * event-target-shim that isn't shipped, so addEventListener is missing from
 * the types even though it exists at runtime.
 */
function listen(target: unknown, event: string, fn: (e: any) => void): void {
  (target as { addEventListener(e: string, f: (e: any) => void): void }).addEventListener(event, fn);
}

function splitPid(pid: string): [string, string] {
  const i = pid.lastIndexOf(':');
  return [pid.slice(0, i), pid.slice(i + 1)];
}

/** Reads the selected ICE candidate pair to tell direct from TURN relay. */
async function routeOf(pc: RTCPeerConnection): Promise<Route> {
  if (pc.connectionState !== 'connected') return 'unknown';
  const report: Map<string, any> = await pc.getStats();
  let pair: any;
  report.forEach((s) => {
    if (s.type === 'transport' && s.selectedCandidatePairId) pair = report.get(s.selectedCandidatePairId);
  });
  if (!pair) {
    report.forEach((s) => {
      if (s.type === 'candidate-pair' && s.state === 'succeeded' && (s.nominated || s.selected)) pair = s;
    });
  }
  if (!pair) return 'unknown';
  const local = report.get(pair.localCandidateId);
  const remote = report.get(pair.remoteCandidateId);
  return local?.candidateType === 'relay' || remote?.candidateType === 'relay' ? 'relay' : 'direct';
}
