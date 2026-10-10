// One live session = a WebRTC peer connection carrying audio, video, an
// optional screen share, and a data channel for the whiteboard.
//
// Why this stays end-to-end encrypted: WebRTC encrypts media with keys
// negotiated directly between the two phones (DTLS-SRTP). The only thing an
// attacker in the middle could swap is the DTLS fingerprint inside the
// offer/answer, and those travel only as MLS-encrypted rtc_signal messages,
// so the server and any TURN relay see ciphertext only.
//
// Negotiation uses the "perfect negotiation" pattern so both sides can add
// or remove a screen share at any time without glare.

import type {
  MediaStream,
  MediaStreamTrack,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
} from "react-native-webrtc";
import { ContentTransport, RtcSignalContent } from "../content/types";
import { WireMessage } from "../whiteboard/model";
import { newId } from "../content/codec";
import { WireAssembler } from "./WireAssembler";

export interface LiveSessionOptions {
  sessionId: string;
  conversationId: string;
  selfId: string;
  peerId: string;
  transport: ContentTransport;
  /** STUN/TURN from your server. TURN credentials should be short-lived. */
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
  audio?: boolean;
  video?: boolean;
}

export type SessionState = "connecting" | "connected" | "reconnecting" | "ended" | "failed";

export interface SessionSnapshot {
  state: SessionState;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micOn: boolean;
  cameraOn: boolean;
  sharingScreen: boolean;
  remoteSharing: boolean;
  remoteScreen: MediaStream | null;
  boardOpen: boolean;
}

type Listener = (s: SessionSnapshot) => void;
type WireListener = (m: WireMessage, from: string) => void;

const CHUNK = 15_000;

// react-native-webrtc objects are event-target-shim EventTargets at runtime,
// but its typings don't resolve under Expo's "bundler" module resolution.
// These helpers keep the event wiring type-safe on our side.
type Evented = {
  addEventListener(type: string, fn: (e: any) => void): void; // eslint-disable-line @typescript-eslint/no-explicit-any
  removeEventListener(type: string, fn: (e: any) => void): void; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const on = <E,>(target: unknown, type: string, fn: (e: E) => void) => (target as Evented).addEventListener(type, fn);
const off = <E,>(target: unknown, type: string, fn: (e: E) => void) => (target as Evented).removeEventListener(type, fn);

export class LiveSession {
  private pc: RTCPeerConnection;
  private channel: ReturnType<RTCPeerConnection["createDataChannel"]>;
  private polite: boolean;
  private makingOffer = false;
  private ignoreOffer = false;
  private pendingCandidates: RTCIceCandidate[] = [];
  private cameraTrack: MediaStreamTrack | null = null;
  private cameraStarting = false;
  private screenStarting = false;
  private screenStream: MediaStream | null = null;
  private screenSender: ReturnType<RTCPeerConnection["addTrack"]> | null = null;
  private assembler = new WireAssembler();
  private listeners = new Set<Listener>();
  private wireListeners = new Set<WireListener>();
  private snap: SessionSnapshot = {
    state: "connecting",
    localStream: null,
    remoteStream: null,
    micOn: true,
    cameraOn: true,
    sharingScreen: false,
    remoteSharing: false,
    remoteScreen: null,
    boardOpen: false,
  };
  private remoteTracks = new Map<string, MediaStreamTrack>();
  private remoteScreenTrackId: string | null = null;
  private iceRestarted = false;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private expireAfter(ms: number) {
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = setTimeout(() => { void this.end(); }, ms);
  }

  static async create(o: LiveSessionOptions) { return new LiveSession(o, await import("react-native-webrtc")); }
  constructor(private o: LiveSessionOptions, private rtc: typeof import("react-native-webrtc")) {
    this.snap.micOn = o.audio !== false; this.snap.cameraOn = o.video !== false;
    this.polite = o.selfId > o.peerId; // deterministic, opposite on each side
    this.pc = new rtc.RTCPeerConnection({ iceServers: o.iceServers, bundlePolicy: "max-bundle", iceTransportPolicy: "relay" });

    // Pre-negotiated channel: both sides create it with the same id, no extra round trip.
    this.channel = this.pc.createDataChannel("board", { negotiated: true, id: 0, ordered: true });
    on<{ data: string }>(this.channel, "message", (e) => this.onChannelMessage(e.data));

    on(this.pc, "negotiationneeded", () => { void this.negotiate().catch(() => this.update({ state: "failed" })); });
    on<{ candidate: RTCIceCandidate | null }>(this.pc, "icecandidate", (e) => {
      if (e.candidate) void this.signal({ kind: "candidate", candidate: e.candidate.toJSON() }).catch(() => this.update({ state: "failed" }));
    });
    on<{ streams: MediaStream[]; track: MediaStreamTrack }>(this.pc, "track", (e) => {
      this.remoteTracks.set(e.track.id, e.track);
      // The other side tells us over the data channel which track is its
      // screen; everything else is the camera/mic stream.
      if (e.track.id === this.remoteScreenTrackId) this.attachRemoteScreen();
      else if (e.streams[0] && !this.snap.remoteStream) this.update({ remoteStream: e.streams[0] });
    });
    on(this.pc, "connectionstatechange", () => {
      if (this.snap.state === "ended") return;
      const s = this.pc.connectionState;
      if (s === "connected") {
        if (this.deadline) clearTimeout(this.deadline); this.deadline = null;
        this.iceRestarted = false;
        this.update({ state: "connected" });
      } else if (s === "disconnected") { this.update({ state: "reconnecting" }); this.expireAfter(30_000); }
      else if (s === "failed") {
        // One ICE restart before giving up: covers Wi-Fi to cellular switches.
        if (this.iceRestarted) this.update({ state: "failed" });
        else {
          this.iceRestarted = true;
          this.update({ state: "reconnecting" });
          this.pc.restartIce();
          this.expireAfter(30_000);
        }
      }
    });
  }
  get sessionId() { return this.o.sessionId; }

  // --- lifecycle ---------------------------------------------------------------

  async start(): Promise<void> {
    if (this.snap.state === "ended") return;
    const stream = await this.rtc.mediaDevices.getUserMedia({
      audio: this.o.audio !== false,
      video: this.o.video !== false ? { facingMode: "user", width: 1280, height: 720, frameRate: 30 } : false,
    });
    if (this.getSnapshot().state === "ended") { stream.getTracks().forEach(t => t.stop()); return; }
    this.cameraTrack = stream.getVideoTracks()[0] ?? null;
    stream.getTracks().forEach((t) => this.pc.addTrack(t, stream));
    this.update({ localStream: stream, cameraOn: !!this.cameraTrack });
    if (this.snap.state !== "connected") this.expireAfter(60_000);
  }

  /** Feed every rtc_signal for this session from the other participant. */
  async handleSignal(msg: RtcSignalContent, from: string): Promise<void> {
    if (this.snap.state === "ended" || msg.sessionId !== this.o.sessionId || from !== this.o.peerId) return;
    const s = msg.signal;
    if (s.kind === "hangup") return this.end(false);

    if (s.kind === "description") {
      const desc = new this.rtc.RTCSessionDescription(s.sdp as never);
      const collision = desc.type === "offer" && (this.makingOffer || this.pc.signalingState !== "stable");
      this.ignoreOffer = !this.polite && collision;
      if (this.ignoreOffer) return;
      await this.pc.setRemoteDescription(desc);
      for (const c of this.pendingCandidates.splice(0)) await this.pc.addIceCandidate(c).catch(() => {});
      if (desc.type === "offer") {
        await this.pc.setLocalDescription();
        await this.signal({ kind: "description", sdp: this.pc.localDescription!.toJSON() as never });
      }
      return;
    }

    if (s.kind === "candidate") {
      if (this.ignoreOffer) return;
      const cand = new this.rtc.RTCIceCandidate(s.candidate as never);
      if (!this.pc.remoteDescription) { if (this.pendingCandidates.length < 256) this.pendingCandidates.push(cand); }
      else await this.pc.addIceCandidate(cand).catch((e) => {
        if (!this.ignoreOffer) throw e;
      });
    }
  }

  async end(notifyPeer = true): Promise<void> {
    if (this.snap.state === "ended") return;
    if (this.deadline) clearTimeout(this.deadline); this.deadline = null;
    this.stopScreenShare(false);
    this.snap.localStream?.getTracks().forEach((t) => t.stop());
    this.channel.close();
    this.pc.close();
    this.assembler.clear(); this.pendingCandidates = []; this.remoteTracks.clear(); this.cameraTrack = null;
    this.update({ state: "ended", localStream: null, remoteStream: null, remoteScreen: null, sharingScreen: false, remoteSharing: false, micOn: false, cameraOn: false });
    if (notifyPeer) void this.signal({ kind: "hangup" }).catch(() => {});
  }

  // --- controls --------------------------------------------------------------------

  setMic(on: boolean) {
    this.snap.localStream?.getAudioTracks().forEach((t) => (t.enabled = on));
    this.update({ micOn: on });
  }

  async setCamera(on: boolean): Promise<boolean> {
    if (this.snap.state === "ended" || !this.snap.localStream) return false;
    if (on && !this.cameraTrack) {
      if (this.cameraStarting) return false;
      this.cameraStarting = true;
      let acquired: MediaStream | null = null;
      try {
        acquired = await this.rtc.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: 1280, height: 720, frameRate: 30 } });
        if (this.getSnapshot().state === "ended") { acquired.getTracks().forEach(t => t.stop()); return false; }
        const track = acquired.getVideoTracks()[0];
        if (!track) { acquired.getTracks().forEach(t => t.stop()); return false; }
        this.snap.localStream!.addTrack(track);
        this.pc.addTrack(track, this.snap.localStream!);
        this.cameraTrack = track;
      } catch { acquired?.getTracks().forEach(t => t.stop()); return false; }
      finally { this.cameraStarting = false; }
    }
    if (this.cameraTrack) this.cameraTrack.enabled = on;
    this.update({ cameraOn: on });
    return true;
  }

  flipCamera() {
    (this.cameraTrack as unknown as { _switchCamera?: () => void })?._switchCamera?.();
  }

  /**
   * Starts sharing this phone's screen. Android shows the system "start
   * recording" prompt; iOS needs a Broadcast Upload Extension for sharing
   * outside the app (see README).
   */
  async startScreenShare(): Promise<boolean> {
    if (this.snap.state === "ended") return false;
    if (this.snap.sharingScreen) return true;
    if (this.screenStarting) return false;
    this.screenStarting = true;
    try {
      const display = await this.rtc.mediaDevices.getDisplayMedia({});
      if (this.getSnapshot().state === "ended") { display.getTracks().forEach(t => t.stop()); return false; }
      const track = display.getVideoTracks()[0];
      if (!track) { display.getTracks().forEach(t => t.stop()); return false; }
      this.screenStream = display;
      this.screenSender = this.pc.addTrack(track, display);
      on(track, "ended", () => this.stopScreenShare()); // user stopped from system UI
      this.update({ sharingScreen: true });
      this.announceScreen(true, track.id);
      return true;
    } catch {
      return false; // user declined the system prompt
    } finally { this.screenStarting = false; }
  }

  stopScreenShare(update = true) {
    if (this.screenSender) {
      try {
        this.pc.removeTrack(this.screenSender);
      } catch {}
      this.screenSender = null;
    }
    const stream = this.screenStream;
    this.screenStream = null;
    stream?.getTracks().forEach((t) => t.stop());
    if (update) {
      this.update({ sharingScreen: false });
      this.announceScreen(false);
    }
  }

  private announceScreen(on: boolean, trackId?: string) {
    // Sent now and again when the channel opens, in case it isn't open yet.
    const msg = { t: "screen", on, trackId } as WireMessage;
    if (!this.send(msg)) this.onChannelOpen(() => this.send(msg));
  }

  private attachRemoteScreen() {
    const t = this.remoteScreenTrackId ? this.remoteTracks.get(this.remoteScreenTrackId) : undefined;
    if (t) this.update({ remoteSharing: true, remoteScreen: new this.rtc.MediaStream([t]) });
  }

  getScreenStream() {
    return this.screenStream;
  }

  setBoardOpen(open: boolean) {
    this.update({ boardOpen: open });
  }

  // --- whiteboard data channel ---------------------------------------------------------

  send(m: WireMessage) {
    if (this.channel.readyState !== "open") return false;
    const data = JSON.stringify(m);
    if (data.length > 3_840_000 || this.channel.bufferedAmount > 1_000_000) return false;
    if (data.length <= CHUNK) {
      this.channel.send(data);
      return true;
    }
    const id = newId();
    const n = Math.ceil(data.length / CHUNK);
    for (let i = 0; i < n; i++) this.channel.send(JSON.stringify({ t: "chunk", id, i, n, d: data.slice(i * CHUNK, (i + 1) * CHUNK) }));
    return true;
  }

  onWire(fn: WireListener): () => void {
    this.wireListeners.add(fn);
    return () => this.wireListeners.delete(fn);
  }

  onChannelOpen(fn: () => void): () => void {
    const h = () => fn();
    on(this.channel, "open", h);
    if (this.channel.readyState === "open") fn();
    return () => off(this.channel, "open", h);
  }

  private onChannelMessage(raw: string) {
    if (this.snap.state === "ended") return;
    const assembled = this.assembler.accept(raw);
    if (!assembled) return;
    const msg: unknown = assembled;
    const m = msg as { t?: string; id?: string; i?: number; n?: number; d?: string; on?: boolean; trackId?: string };
    if (m.t === "screen") {
      if (m.on && typeof m.trackId === "string") {
        this.remoteScreenTrackId = m.trackId;
        this.attachRemoteScreen();
      } else {
        this.remoteScreenTrackId = null;
        this.update({ remoteSharing: false, remoteScreen: null });
      }
      return;
    }
    if (m.t === "ops" || m.t === "sync" || m.t === "presence" || m.t === "lock") {
      for (const fn of this.wireListeners) fn(msg as WireMessage, this.o.peerId);
    }
  }

  // --- state -----------------------------------------------------------------------------

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snap);
    return () => this.listeners.delete(fn);
  }

  getSnapshot() {
    return this.snap;
  }

  private update(p: Partial<SessionSnapshot>) {
    if (this.snap.state === "ended" && p.state !== "ended") return;
    this.snap = { ...this.snap, ...p };
    for (const fn of this.listeners) fn(this.snap);
  }

  private async negotiate() {
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      await this.signal({ kind: "description", sdp: this.pc.localDescription!.toJSON() as never });
    } finally {
      this.makingOffer = false;
    }
  }

  private signal(signal: RtcSignalContent["signal"]) {
    return this.o.transport.sendContent(this.o.conversationId, { type: "rtc_signal", sessionId: this.o.sessionId, signal });
  }
}
