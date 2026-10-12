import { anotherCallActive } from "./call-ownership";
import { applyBoardOp, emptyBoard, type BoardOp, type BoardState } from "./call-actions/board";
import { DeviceEventEmitter, NativeModules, PermissionsAndroid, Platform } from "react-native";
import { getApiBaseUrl } from "../config/api";
import { CallsService, type PrivacyMode } from "./calls.service";
import { accessTokenProvider } from "./session";
import { newRecordingUri, saveRecording, type TranscriptLine } from "./call-recordings";

/**
 * One live call at a time: places or answers it, carries the WebRTC offer/answer/ICE over the server's signaling socket
 * (`/v1/calls/signaling`), and exposes its state to the call screen.
 *
 * Media is DTLS-SRTP encrypted between the two phones. The signaling messages (SDP and ICE candidates) pass through the server as
 * base64 JSON; they describe the connection, not the conversation, and the server never sees audio or video.
 */

export type CallKind = "AUDIO" | "VIDEO";
export type CallPhase = "idle" | "calling" | "ringing" | "connecting" | "active";
/** off -> requesting (waiting for the other person) or asking (they are asking you) -> on. */
export type RecordingPhase = "off" | "requesting" | "asking" | "on";

export interface CallState {
  phase: CallPhase;
  callId: string | null;
  peerName: string;
  callType: CallKind;
  incoming: boolean;
  muted: boolean;
  speaker: boolean;
  cameraOff: boolean;
  localStreamUrl: string | null;
  remoteStreamUrl: string | null;
  /** Shown briefly on the idle screen's way out, e.g. "Call declined". */
  note: string | null;
  connectedAt: number | null;
  recording: RecordingPhase;
  recordingStartedAt: number | null;
  /** Said once in the call screen, e.g. "Greene did not allow recording". */
  recordingNote: string | null;
  /** False where the phone has no recorder built in (iOS, older builds). */
  recordingAvailable: boolean;
  /** How the connection is doing, from the call's own statistics. */
  network: "Good" | "Weak" | "Reconnecting";
  /** The other person's own verified country, with its flag. Null when they have not verified one. */
  peerPlace: { name: string; flag: string } | null;
  /** The call keeps running but its screen is tucked away behind a Return-to-call bar. */
  minimized: boolean;
  handRaised: boolean;
  peerHandRaised: boolean;
  board: BoardState;
  sharingScreen: boolean;
  mediaBusy: boolean;
}

export interface IncomingCall {
  callId: string;
  callType: CallKind;
  privacyMode: PrivacyMode;
  callerUserId: string;
  callerDeviceId: string;
  callerName: string;
}

const IDLE: CallState = {
  phase: "idle", callId: null, peerName: "", callType: "AUDIO", incoming: false, muted: false, speaker: false, cameraOff: false,
  localStreamUrl: null, remoteStreamUrl: null, note: null, connectedAt: null,
  recording: "off", recordingStartedAt: null, recordingNote: null, recordingAvailable: Boolean(NativeModules.LinqaCallRecorder),
  network: "Good", peerPlace: null, minimized: false, handRaised: false, peerHandRaised: false, board: emptyBoard(), sharingScreen: false, mediaBusy: false
};

const RING_TIMEOUT_MS = 45_000;
const SIGNAL_READY_MS = 8_000;

type Listener = () => void;
type ReactNativeWebSocket = new (url: string, protocols?: string | string[], options?: { headers?: Record<string, string> }) => WebSocket;
// react-native-webrtc is loaded on first use so screens that never call do not pay for it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export class CallController {
  private state: CallState = IDLE;
  private listeners = new Set<Listener>();
  private calls = new CallsService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken());
  private socket: WebSocket | null = null;
  private pc: Any = null;
  private localStream: Any = null;
  private videoSender: Any = null;
  private displayStream: Any = null;
  private remoteStream: Any = null;
  private peerDeviceId: string | null = null;
  private privacy: PrivacyMode = "RELAY_ONLY";
  private sequence = 0;
  private seen = new Set<string>();
  private pendingIce: Any[] = [];
  private remoteSet = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private mediaStopped = false;
  private callManager: Any = null;
  private channel: Any = null;
  private transcriptSub: { remove(): void } | null = null;
  private recordingId: string | null = null;
  private recordingUri: string | null = null;
  private lines: TranscriptLine[] = [];
  private recordingStopping = false;
  private starting = false;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private lastLoss = { lost: 0, received: 0 };
  private generation = 0;
  private recordingStarting = false;
  private finishing = false;
  private signalQueue: Promise<void> = Promise.resolve();

  private isCurrent(callId: string): boolean { return this.state.callId === callId && this.state.phase !== "idle"; }

  getState = (): CallState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private set(patch: Partial<CallState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** The note that follows a finished call is shown once, then cleared. */
  clearNote = (): void => { if (this.state.note) this.set({ note: null }); };

  /**
   * Places a call. The call screen opens only after the server has accepted the call; until then nothing is shown, and a refusal comes
   * back as a plain-words message for the caller to display. Returns null on success.
   */
  async start(input: { peerUserId: string; peerName: string; callType: CallKind }): Promise<string | null> {
    if (anotherCallActive("legacy") || this.state.phase !== "idle" || this.starting || this.finishing || this.recordingStarting || this.recordingStopping) return "Another call is still starting or ending.";
    this.starting = true;
    // Match the existing call API and mobile hub privacy default; an incoming
    // STANDARD call must not change the next outgoing call's policy.
    this.privacy = "RELAY_ONLY";
    try {
      await this.ensurePermissions(input.callType);
      const placed = await this.calls.placeCall({ recipientUserId: input.peerUserId, callType: input.callType, privacyMode: this.privacy });
      this.peerDeviceId = placed.calleeDeviceId;
      this.set({ ...IDLE, phase: "calling", callId: placed.callId, peerName: input.peerName, callType: input.callType, speaker: input.callType === "VIDEO" });
      void this.loadPeerPlace(placed.callId);
      try {
        await this.prepareMedia(input.callType, true, placed.callId);
        if (!this.isCurrent(placed.callId)) return null;
        await this.openSignal(placed.callId);
        if (!this.isCurrent(placed.callId)) return null;
        this.timer = setTimeout(() => void this.hangUp("No answer"), RING_TIMEOUT_MS);
      } catch (error) {
        if (this.isCurrent(placed.callId)) await this.finish(error instanceof Error ? error.message : "Unable to start this call.", "FAILED");
      }
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Unable to start this call.";
    } finally {
      this.starting = false;
    }
  }

  private async loadPeerPlace(callId: string): Promise<void> {
    try {
      const details = await this.calls.details(callId);
      if (this.state.callId !== callId) return;
      const code = details.peerCountryCode;
      const flag = code && /^[A-Za-z]{2}$/.test(code) ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";
      this.set({ peerPlace: details.peerCountryName ? { name: details.peerCountryName, flag } : null });
    } catch { /* the place line is optional */ }
  }

  handleIncoming(call: IncomingCall): void {
    if (anotherCallActive("legacy") || this.state.phase !== "idle" || this.starting || this.finishing) return;
    this.peerDeviceId = call.callerDeviceId;
    this.privacy = call.privacyMode;
    this.set({ ...IDLE, phase: "ringing", callId: call.callId, peerName: call.callerName, callType: call.callType, incoming: true, speaker: call.callType === "VIDEO" });
    void this.loadCallManager().then((m) => { if (this.isCurrent(call.callId) && this.state.phase === "ringing") m?.startRingtone?.("_DEFAULT_"); });
    void this.loadPeerPlace(call.callId);
    this.timer = setTimeout(() => void this.decline(), RING_TIMEOUT_MS);
  }

  async accept(): Promise<void> {
    if (anotherCallActive("legacy")) { await this.decline(); return; }
    const { phase, callId, callType } = this.state;
    if (phase !== "ringing" || !callId) return;
    this.clearTimer();
    this.set({ phase: "connecting" });
    this.timer = setTimeout(() => { if (this.isCurrent(callId)) void this.hangUp("Connection timed out", "FAILED"); }, RING_TIMEOUT_MS);
    (await this.loadCallManager())?.stopRingtone?.();
    if (!this.isCurrent(callId)) return;
    try {
      await this.ensurePermissions(callType);
      if (!this.isCurrent(callId)) return;
      await this.calls.acceptCall(callId);
      if (!this.isCurrent(callId)) return;
      await this.prepareMedia(callType, false, callId);
      if (!this.isCurrent(callId)) return;
      await this.openSignal(callId);
      await this.send("CALL_ACCEPTED", {});
    } catch (error) {
      if (this.isCurrent(callId)) await this.finish(error instanceof Error ? error.message : "Unable to answer this call.", "FAILED");
    }
  }

  async decline(): Promise<void> {
    const { callId } = this.state;
    if (this.state.phase !== "ringing" || !callId) return;
    const notification = this.notifyPeerAndEnd("CALL_REJECTED", callId, "REJECTED");
    await this.finish("Call declined", false);
    void notification.catch(() => undefined);
  }

  async hangUp(note = "Call ended", reason?: "FAILED"): Promise<void> {
    const { callId, phase } = this.state;
    if (phase === "idle" || !callId) { await this.finish(note, false); return; }
    const notification = this.notifyPeerAndEnd("CALL_ENDED", callId, reason);
    await this.finish(note, false);
    void notification.catch(() => undefined);
  }

  setMinimized(minimized: boolean): void { if (this.state.phase !== "idle" && this.state.phase !== "ringing") this.set({ minimized }); }

  toggleMute(): void {
    const muted = !this.state.muted;
    this.localStream?.getAudioTracks?.().forEach((track: Any) => { track.enabled = !muted; });
    NativeModules.LinqaCallRecorder?.setMuted?.(muted);
    this.set({ muted });
  }

  async toggleCamera(): Promise<void> {
    if (this.state.phase !== "active" || this.state.mediaBusy || this.state.sharingScreen) return;
    const callId = this.state.callId!;
    const pc = this.pc;
    this.set({ mediaBusy: true });
    try {
      let track = this.localStream?.getVideoTracks?.()[0];
      if (!track) {
        if (!this.videoSender) throw new Error("Video is unavailable for this call. Start a new video call.");
        await this.ensurePermissions("VIDEO");
        if (!this.isCurrent(callId) || this.pc !== pc) return;
        const rtc = (await import("react-native-webrtc")) as Any;
        const stream = await rtc.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: 640, height: 480, frameRate: 24 } });
        if (!this.isCurrent(callId) || this.pc !== pc) { stream.getTracks().forEach((t: Any) => t.stop()); return; }
        track = stream.getVideoTracks()[0];
        if (!track) throw new Error("The camera could not start.");
        try { await this.videoSender.replaceTrack(track); } catch (error) { stream.getTracks().forEach((t: Any) => t.stop()); throw error; }
        if (!this.isCurrent(callId) || this.pc !== pc) { stream.getTracks().forEach((t: Any) => t.stop()); return; }
        this.localStream.addTrack(track);
        this.set({ callType: "VIDEO", cameraOff: false, localStreamUrl: this.localStream.toURL() });
      } else {
        track.enabled = !track.enabled;
        this.set({ cameraOff: !track.enabled });
      }
      this.sendPeer({ t: "call.video", cameraOn: !this.state.cameraOff });
    } catch (error) { if (this.isCurrent(callId)) this.set({ note: error instanceof Error ? error.message : "Unable to start video." }); }
    finally { if (this.isCurrent(callId)) this.set({ mediaBusy: false }); }
  }

  async toggleScreenShare(): Promise<void> {
    if (this.state.phase !== "active" || this.state.mediaBusy) return;
    const callId = this.state.callId!;
    const pc = this.pc;
    this.set({ mediaBusy: true });
    let acquired: Any = null;
    try {
      if (this.displayStream) {
        const display = this.displayStream;
        await this.videoSender.replaceTrack(this.localStream?.getVideoTracks?.()[0] ?? null);
        display.getTracks().forEach((t: Any) => t.stop());
        if (!this.isCurrent(callId) || this.pc !== pc) return;
        this.displayStream = null;
        this.set({ sharingScreen: false, localStreamUrl: this.state.callType === "VIDEO" ? this.localStream.toURL() : null });
        this.sendPeer({ t: "call.screen", sharing: false });
        return;
      }
      if (Platform.OS !== "android" || !this.videoSender) throw new Error("Screen sharing is unavailable on this device or call.");
      const rtc = (await import("react-native-webrtc")) as Any;
      acquired = await rtc.mediaDevices.getDisplayMedia({});
      if (!this.isCurrent(callId) || this.pc !== pc) { acquired.getTracks().forEach((t: Any) => t.stop()); return; }
      const track = acquired.getVideoTracks()[0];
      if (!track) throw new Error("Screen capture did not start.");
      await this.videoSender.replaceTrack(track);
      if (!this.isCurrent(callId) || this.pc !== pc) { acquired.getTracks().forEach((t: Any) => t.stop()); return; }
      this.displayStream = acquired;
      track.addEventListener("ended", () => { if (this.displayStream === acquired && this.isCurrent(callId)) void this.toggleScreenShare(); });
      this.set({ sharingScreen: true, localStreamUrl: acquired.toURL() });
      this.sendPeer({ t: "call.screen", sharing: true });
    } catch (error) {
      if (acquired && acquired !== this.displayStream) acquired.getTracks().forEach((t: Any) => t.stop());
      if (this.isCurrent(callId)) this.set({ note: error instanceof Error ? error.message : "Unable to share your screen." });
    } finally { if (this.isCurrent(callId)) this.set({ mediaBusy: false }); }
  }

  flipCamera(): void {
    this.localStream?.getVideoTracks?.().forEach((track: Any) => track._switchCamera?.());
  }

  async toggleSpeaker(): Promise<void> {
    const speaker = !this.state.speaker;
    (await this.loadCallManager())?.setForceSpeakerphone?.(speaker);
    this.set({ speaker });
  }

  toggleHand(): void {
    if (this.state.phase !== "active") return;
    const handRaised = !this.state.handRaised;
    if (this.sendPeer({ t: "call.hand", raised: handRaised })) this.set({ handRaised });
    else this.set({ note: "The shared call connection is not ready." });
  }

  boardAction(op: BoardOp): boolean {
    if (this.state.phase !== "active" || op.t === "board-sync") return false;
    const next = applyBoardOp(this.state.board, op, "self");
    if (next === this.state.board || !this.sendPeer({ t: "call.board", op })) return false;
    this.set({ board: next });
    return true;
  }

  report(category: string, description: string): Promise<unknown> {
    if (!this.state.callId) return Promise.reject(new Error("This call has ended."));
    return this.calls.reportCall(this.state.callId, category, description);
  }

  // ---- recording -------------------------------------------------------------------------------------------------------------

  /** Asks the other person to allow recording. Nothing is recorded until they agree. */
  requestRecording(): void {
    if (this.state.phase !== "active" || this.state.recording !== "off" || !this.state.recordingAvailable) return;
    if (!this.sendPeer({ t: "rec.request" })) { this.set({ recordingNote: "Recording is not available yet. Try again in a moment." }); return; }
    this.set({ recording: "requesting", recordingNote: null });
  }

  async respondRecording(allow: boolean): Promise<void> {
    if (this.state.recording !== "asking") return;
    this.sendPeer({ t: allow ? "rec.accept" : "rec.decline" });
    if (!allow) { this.set({ recording: "off" }); return; }
    await this.beginRecording();
  }

  async stopRecording(): Promise<void> {
    if (this.state.recording !== "on") return;
    // Our own last sentence is flushed (and sent) before the peer is told to stop, so it reaches them.
    const saving = this.endRecording(1500);
    await new Promise((resolve) => setTimeout(resolve, 400));
    this.sendPeer({ t: "rec.stop" });
    await saving;
  }

  private attachChannel(channel: Any): void {
    this.channel = channel;
    channel.addEventListener("message", (event: Any) => {
      if (this.channel !== channel || this.state.phase !== "active" || typeof event.data !== "string" || event.data.length > 4096) return;
      let message: Any;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      void this.onPeerMessage(message).catch(() => undefined);
    });
  }

  private sendPeer(message: Record<string, unknown>): boolean {
    try {
      if (!this.channel || this.channel.readyState !== "open") return false;
      this.channel.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  private async onPeerMessage(message: Any): Promise<void> {
    if (!message || typeof message !== "object") return;
    switch (message.t) {
      case "call.video":
        if (message.cameraOn === true) this.set({ callType: "VIDEO" });
        return;
      case "call.screen":
        if (message.sharing === true) this.set({ callType: "VIDEO" });
        return;
      case "call.hand":
        if (typeof message.raised === "boolean") this.set({ peerHandRaised: message.raised });
        return;
      case "call.board":
        if (!message.op || typeof message.op !== "object" || message.op.t === "board-sync") return;
        // If both open at once, the original caller wins on both phones.
        const board = message.op.t === "board-open" && this.state.board.openedBy === "self" && this.state.incoming
          ? emptyBoard() : this.state.board;
        this.set({ board: applyBoardOp(board, message.op, "peer") });
        return;
      case "rec.request":
        if (this.state.phase === "active" && this.state.recording === "off" && this.state.recordingAvailable) this.set({ recording: "asking", recordingNote: null });
        else this.sendPeer({ t: "rec.decline" });
        return;
      case "rec.accept":
        if (this.state.recording === "requesting") await this.beginRecording();
        return;
      case "rec.decline":
        if (this.state.recording === "requesting") this.set({ recording: "off", recordingNote: `${this.state.peerName || "They"} did not allow recording.` });
        return;
      case "rec.stop":
        if (this.state.recording === "on") await this.endRecording(1500);
        else if (this.state.recording !== "off") this.set({ recording: "off" });
        return;
      case "seg":
        if ((this.state.recording === "on" || this.recordingStopping) && typeof message.text === "string" && Number.isFinite(message.at) && message.at >= 0 && message.at <= 86_400_000 && this.lines.length < 20_000) {
          this.lines.push({ who: "peer", atMs: message.at, text: message.text.slice(0, 600) });
        }
        return;
      default:
    }
  }

  private async beginRecording(): Promise<void> {
    if (this.recordingStarting || this.recordingStopping || this.state.phase !== "active") return;
    this.recordingStarting = true;
    const generation = this.generation;
    const allowed = () => generation === this.generation && this.state.phase === "active" && (this.state.recording === "asking" || this.state.recording === "requesting");
    const recorder = NativeModules.LinqaCallRecorder;
    try {
      await recorder.prepare();
      if (!allowed()) return;
      this.recordingId = `${Date.now()}`;
      this.recordingUri = await newRecordingUri(this.recordingId);
      if (!allowed()) return;
      this.lines = [];
      this.transcriptSub?.remove();
      this.transcriptSub = DeviceEventEmitter.addListener("linqaTranscript", (event: { text: string; startMs: number }) => {
        if (typeof event.text !== "string" || !Number.isFinite(event.startMs) || event.startMs < 0 || this.lines.length >= 20_000) return;
        const text = event.text.slice(0, 600);
        this.lines.push({ who: "me", atMs: event.startMs, text });
        this.sendPeer({ t: "seg", at: event.startMs, text });
      });
      recorder.setMuted(this.state.muted);
      await recorder.start(this.recordingUri);
      if (!allowed()) { await recorder.stop(); this.transcriptSub?.remove(); this.transcriptSub = null; return; }
      this.set({ recording: "on", recordingStartedAt: Date.now(), recordingNote: null });
    } catch (error) {
      this.transcriptSub?.remove();
      this.transcriptSub = null;
      this.set({ recording: "off", recordingNote: error instanceof Error ? error.message : "Recording could not start." });
      this.sendPeer({ t: "rec.stop" });
    } finally {
      this.recordingStarting = false;
    }
  }

  /** Stops the recorder, waits `graceMs` for the other phone's last lines, and saves the recording. */
  private async endRecording(graceMs: number): Promise<void> {
    if (this.recordingStopping || this.state.recording !== "on") return;
    this.recordingStopping = true;
    const { callId, peerName, callType } = this.state;
    const startedAt = this.state.recordingStartedAt ?? Date.now();
    const id = this.recordingId;
    const uri = this.recordingUri;
    this.set({ recording: "off", recordingStartedAt: null, recordingNote: "Recording saved to Calls > Recordings." });
    try {
      const result = await NativeModules.LinqaCallRecorder.stop();
      if (graceMs > 0) await new Promise((resolve) => setTimeout(resolve, graceMs));
      this.transcriptSub?.remove();
      this.transcriptSub = null;
      if (id && uri) {
        await saveRecording({ id, callId, peerName, callType, startedAt, durationMs: Number(result?.durationMs ?? 0), audioUri: uri, lines: this.lines });
      }
    } catch {
      this.set({ recordingNote: "The recording could not be saved." });
    } finally {
      this.lines = [];
      this.recordingId = null;
      this.recordingUri = null;
      this.recordingStopping = false;
    }
  }

  // ---- internals -------------------------------------------------------------------------------------------------------------

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async loadCallManager(): Promise<Any> {
    if (this.callManager !== null) return this.callManager || null;
    try {
      const mod = (await import("react-native-incall-manager")) as Any;
      this.callManager = mod.default ?? mod;
    } catch {
      this.callManager = false;
    }
    return this.callManager || null;
  }

  private async ensurePermissions(kind: CallKind): Promise<void> {
    if (Platform.OS !== "android") return;
    const wanted = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, ...(kind === "VIDEO" ? [PermissionsAndroid.PERMISSIONS.CAMERA] : [])];
    const result = await PermissionsAndroid.requestMultiple(wanted);
    if (wanted.some((permission) => result[permission] !== PermissionsAndroid.RESULTS.GRANTED)) {
      throw new Error(kind === "VIDEO" ? "Allow camera and microphone access to make video calls." : "Allow microphone access to make calls.");
    }
  }

  private async iceServers(): Promise<Any[]> {
    const servers: Any[] = [{ urls: "stun:stun.l.google.com:19302" }];
    try {
      const turn = await this.calls.turnCredentials();
      const raw = (turn.urls as unknown) ?? [];
      const urls = (Array.isArray(raw) ? raw : String(raw).split(",")).map((u: string) => u.trim()).filter(Boolean);
      // A TURN address of 127.0.0.1 is this phone itself, not the server: it cannot relay anything.
      const usable = urls.filter((u: string) => !/(@|:)(127\.0\.0\.1|localhost)\b/.test(u));
      if (usable.length) servers.push({ urls: usable, username: turn.username, credential: turn.credential });
    } catch {
      // STUN alone still connects phones on the same network or with open NATs.
    }
    if (this.privacy === "RELAY_ONLY" && servers.length === 1) throw new Error("Private calling needs a reachable TURN relay. Please try again later.");
    return servers;
  }

  private async prepareMedia(kind: CallKind, caller: boolean, callId: string): Promise<void> {
    const webrtc = (await import("react-native-webrtc")) as Any;
    // Warm up the speech model now so Record starts instantly later (a no-op where there is no recorder).
    void Promise.resolve(NativeModules.LinqaCallRecorder?.prepare?.()).catch(() => undefined);
    const manager = await this.loadCallManager();
    if (!this.isCurrent(callId)) return;
    manager?.start?.({ media: kind === "VIDEO" ? "video" : "audio", auto: false, ringback: caller ? "_DTMF_" : "" });
    manager?.setForceSpeakerphone?.(kind === "VIDEO");
    this.mediaStopped = false;
    const stream = await webrtc.mediaDevices.getUserMedia({
      audio: true,
      video: kind === "VIDEO" ? { facingMode: "user", width: 640, height: 480, frameRate: 24 } : false
    });
    if (!this.isCurrent(callId)) { stream.getTracks().forEach((track: Any) => track.stop()); return; }
    this.localStream = stream;
    this.set({ localStreamUrl: kind === "VIDEO" ? this.localStream.toURL() : null });
  }

  private async createPeer(): Promise<Any> {
    const callId = this.state.callId;
    const webrtc = (await import("react-native-webrtc")) as Any;
    const iceServers = await this.iceServers();
    if (!callId || !this.isCurrent(callId) || !this.localStream) throw new Error("Call ended");
    const pc = new webrtc.RTCPeerConnection({
      iceServers,
      iceTransportPolicy: this.privacy === "RELAY_ONLY" ? "relay" : "all"
    });
    this.pc = pc;
    this.localStream.getTracks().forEach((track: Any) => pc.addTrack(track, this.localStream));
    this.videoSender = pc.getSenders?.().find((sender: Any) => sender.track?.kind === "video") ?? null;
    // Reserve a video slot in voice calls so upgrading never needs a conflicting offer.
    if (!this.videoSender && pc.addTransceiver) this.videoSender = pc.addTransceiver("video", { direction: "sendrecv" }).sender;
    // Recording consent and transcript lines travel on a data channel between the two phones (DTLS-encrypted), never through the server.
    if (!this.state.incoming) this.attachChannel(pc.createDataChannel("linqa", { ordered: true }));
    pc.addEventListener("datachannel", (event: Any) => this.attachChannel(event.channel));
    pc.addEventListener("icecandidate", (event: Any) => {
      if (event.candidate) void this.send("ICE_CANDIDATE", { candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate }).catch(() => undefined);
    });
    pc.addEventListener("track", (event: Any) => {
      if (this.pc !== pc || !this.isCurrent(callId)) return;
      const stream = event.streams?.[0];
      if (stream) this.remoteStream = stream;
      else if (event.track) {
        this.remoteStream ??= new webrtc.MediaStream();
        if (!this.remoteStream.getTracks().some((t: Any) => t.id === event.track.id)) this.remoteStream.addTrack(event.track);
      }
      if (this.remoteStream) this.set({ remoteStreamUrl: this.remoteStream.toURL() });
    });
    this.startQualityMonitor(pc);
    pc.addEventListener("connectionstatechange", () => {
      if (this.pc !== pc || !this.isCurrent(callId)) return;
      const connection = pc.connectionState;
      if (connection === "disconnected") {
        this.set({ network: "Reconnecting" });
        this.clearTimer();
        this.timer = setTimeout(() => { if (this.pc === pc) void this.hangUp("Connection lost", "FAILED"); }, 30_000);
      }
      if (connection === "connected") {
        this.clearTimer();
        void this.loadCallManager().then((m) => m?.stopRingback?.());
        this.set({ phase: "active", connectedAt: this.state.connectedAt ?? Date.now(), network: "Good" });
      } else if (connection === "failed") {
        void this.hangUp("Connection lost", "FAILED");
      }
    });
    return pc;
  }

  private openSignal(callId: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      void (async () => {
        let token: string;
        try { token = await accessTokenProvider.getAccessToken(); } catch (error) { reject(error); return; }
        if (!this.isCurrent(callId)) { reject(new Error("Call ended")); return; }
        const url = `${getApiBaseUrl().replace(/^http/, "ws")}/v1/calls/signaling?callId=${encodeURIComponent(callId)}`;
        const socket = new (WebSocket as unknown as ReactNativeWebSocket)(url, undefined, { headers: { authorization: `Bearer ${token}` } });
        this.socket = socket;
        const failTimer = setTimeout(() => { socket.close(); reject(new Error("Could not reach the call server.")); }, SIGNAL_READY_MS);
        socket.onmessage = (message) => {
          if (this.socket !== socket || !this.isCurrent(callId)) return;
          const text = String(message.data);
          if (text === "pong") return;
          let frame: Any;
          try { frame = JSON.parse(text); } catch { return; }
          if (frame.type === "ready") { clearTimeout(failTimer); resolve(); return; }
          if (frame.type === "signaling.event" && frame.callId === this.state.callId) {
            this.signalQueue = this.signalQueue.then(async () => { if (this.socket === socket && this.isCurrent(callId)) await this.onSignal(frame); }).catch(() => undefined);
          }
        };
        socket.onerror = () => { clearTimeout(failTimer); reject(new Error("Could not reach the call server.")); };
        socket.onclose = () => {
          clearTimeout(failTimer);
          if (this.socket === socket) this.socket = null;
          reject(new Error("The call server closed the connection."));
        };
      })();
    });
  }

  private async send(eventType: string, body: Record<string, unknown>): Promise<void> {
    const socket = this.socket;
    const callId = this.state.callId;
    if (!socket || socket.readyState !== WebSocket.OPEN || !callId || !this.peerDeviceId) return;
    this.sequence += 1;
    const json = JSON.stringify({ v: 1, t: eventType, ...body });
    socket.send(JSON.stringify({
      callId, recipientDeviceId: this.peerDeviceId, sequence: this.sequence, eventType, ciphertextBase64: btoa(json)
    }));
  }

  private async onSignal(frame: Any): Promise<void> {
    if (frame.callId !== this.state.callId || frame.senderDeviceId !== this.peerDeviceId || !Number.isSafeInteger(frame.sequence) || frame.sequence < 1 || typeof frame.ciphertextBase64 !== "string" || frame.ciphertextBase64.length > 131072) return;
    const callId = frame.callId as string;
    const key = `${frame.senderDeviceId}:${frame.sequence}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 4096) this.seen.delete(this.seen.values().next().value!);
    let body: Any = {};
    try { body = JSON.parse(atob(String(frame.ciphertextBase64))); } catch { /* an event without a body is still an event */ }

    switch (frame.eventType) {
      case "CALL_ACCEPTED": {
        if (this.state.incoming || this.pc) return;
        this.clearTimer();
        this.set({ phase: "connecting" });
        this.timer = setTimeout(() => { if (this.isCurrent(callId)) void this.hangUp("Connection timed out", "FAILED"); }, RING_TIMEOUT_MS);
        const pc = await this.createPeer();
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        if (this.pc !== pc || !this.isCurrent(callId)) return;
        await pc.setLocalDescription(offer);
        if (this.pc !== pc || !this.isCurrent(callId)) return;
        await this.send("OFFER", { sdp: { type: offer.type, sdp: offer.sdp } });
        return;
      }
      case "OFFER": {
        if (!this.state.incoming || !this.localStream || !body.sdp) return;
        const webrtc = (await import("react-native-webrtc")) as Any;
        const pc = this.pc ?? (await this.createPeer());
        await pc.setRemoteDescription(new webrtc.RTCSessionDescription(body.sdp));
        if (this.pc !== pc || !this.isCurrent(callId)) return;
        await this.flushIce();
        const answer = await pc.createAnswer();
        if (this.pc !== pc || !this.isCurrent(callId)) return;
        await pc.setLocalDescription(answer);
        if (this.pc !== pc || !this.isCurrent(callId)) return;
        await this.send("ANSWER", { sdp: { type: answer.type, sdp: answer.sdp } });
        return;
      }
      case "ANSWER": {
        if (!this.pc || !body.sdp) return;
        const webrtc = (await import("react-native-webrtc")) as Any;
        await this.pc.setRemoteDescription(new webrtc.RTCSessionDescription(body.sdp));
        await this.flushIce();
        return;
      }
      case "ICE_CANDIDATE": {
        if (!body.candidate) return;
        if (!this.pc || !this.remoteSet && !this.pc.remoteDescription) { if (this.pendingIce.length < 256) this.pendingIce.push(body.candidate); return; }
        const webrtc = (await import("react-native-webrtc")) as Any;
        await this.pc.addIceCandidate(new webrtc.RTCIceCandidate(body.candidate)).catch(() => undefined);
        return;
      }
      case "CALL_REJECTED":
        await this.finish("Call declined", true);
        return;
      case "CALL_ENDED":
        await this.finish(this.state.phase === "ringing" ? "Missed call" : "Call ended", true);
        return;
      default:
    }
  }

  private async flushIce(): Promise<void> {
    this.remoteSet = true;
    const webrtc = (await import("react-native-webrtc")) as Any;
    const queued = this.pendingIce;
    this.pendingIce = [];
    for (const candidate of queued) await this.pc.addIceCandidate(new webrtc.RTCIceCandidate(candidate)).catch(() => undefined);
  }

  /** Tells the other phone, then closes the call on the server (which writes both call histories). */
  /** Samples the connection every few seconds: round-trip time and the share of packets lost since the last sample. */
  private startQualityMonitor(pc: Any): void {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.lastLoss = { lost: 0, received: 0 };
    this.statsTimer = setInterval(() => {
      if (this.state.phase !== "active") return;
      void Promise.resolve(pc.getStats()).then((report: Any) => {
        if (this.pc !== pc || this.state.phase !== "active") return;
        let rtt: number | null = null;
        let lost = 0;
        let received = 0;
        report.forEach((entry: Any) => {
          if (entry.type === "candidate-pair" && entry.state === "succeeded" && entry.nominated && typeof entry.currentRoundTripTime === "number") rtt = entry.currentRoundTripTime;
          if (entry.type === "inbound-rtp") { lost += entry.packetsLost ?? 0; received += entry.packetsReceived ?? 0; }
        });
        const dLost = Math.max(0, lost - this.lastLoss.lost);
        const dReceived = Math.max(0, received - this.lastLoss.received);
        this.lastLoss = { lost, received };
        const share = dLost + dReceived > 0 ? dLost / (dLost + dReceived) : 0;
        const next = pc.connectionState === "disconnected" ? "Reconnecting" : (rtt !== null && rtt > 0.4) || share > 0.08 ? "Weak" : "Good";
        if (next !== this.state.network) this.set({ network: next });
      }).catch(() => undefined);
    }, 3000);
  }

  private async notifyPeerAndEnd(eventType: "CALL_REJECTED" | "CALL_ENDED", callId: string, reason?: "REJECTED" | "FAILED"): Promise<void> {
    try {
      // Never wait for a fresh socket while the microphone or camera is live.
      if (this.isCurrent(callId)) await this.send(eventType, {});
    } catch { /* the server end below still closes the call */ }
    await this.calls.endCall(callId, reason).catch(() => undefined);
  }

  private async finish(note: string | null, serverEnd: boolean | "FAILED"): Promise<void> {
    if (this.finishing) return;
    this.finishing = true;
    const callId = this.state.callId;
    this.generation += 1;
    this.clearTimer();
    if (this.statsTimer) { clearInterval(this.statsTimer); this.statsTimer = null; }
    const saving = this.state.recording === "on" ? this.endRecording(0) : Promise.resolve();
    this.channel = null;
    const display = this.displayStream;
    this.displayStream = null;
    display?.getTracks?.().forEach((track: Any) => track.stop());
    this.videoSender = null;
    this.remoteStream = null;
    const socket = this.socket;
    this.socket = null;
    try { socket?.close(); } catch { /* already closed */ }
    try { this.pc?.close(); } catch { /* already closed */ }
    this.pc = null;
    if (!this.mediaStopped) {
      this.mediaStopped = true;
      try { this.localStream?.getTracks?.().forEach((track: Any) => track.stop()); } catch { /* already stopped */ }
      const manager = await this.loadCallManager();
      try { manager?.stopRingtone?.(); manager?.stopRingback?.(); manager?.stop?.(); } catch { /* audio session already released */ }
    }
    this.localStream = null;
    this.peerDeviceId = null;
    this.sequence = 0;
    this.seen.clear();
    this.pendingIce = [];
    this.remoteSet = false;
    this.signalQueue = Promise.resolve();
    this.set({ ...IDLE, note });
    if (serverEnd && callId) void this.calls.endCall(callId, serverEnd === "FAILED" ? "FAILED" : undefined).catch(() => undefined);
    try { await saving; } finally { this.finishing = false; }
  }
}

export const callController = new CallController();
