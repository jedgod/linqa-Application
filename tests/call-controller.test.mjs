import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../clients/mobile/node_modules/typescript/lib/typescript.js';

const code = ts.transpileModule(fs.readFileSync(new URL('../clients/mobile/services/call-controller.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const boardModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../clients/mobile/services/call-actions/board.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module: boardModule, exports: boardModule.exports, Date });
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function fixture() {
  const tracks = [{ enabled: true, stopped: false, stop() { this.stopped = true; } }];
  const stream = { getTracks: () => tracks, getAudioTracks: () => tracks, getVideoTracks: () => [], toURL: () => 'local' };
  const manager = { start() {}, stop() {}, stopRingback() {}, stopRingtone() {}, setForceSpeakerphone() {} };
  const calls = { placeCall: async () => ({ callId: 'call', calleeDeviceId: 'peer' }), endCall: async () => {}, details: async () => ({}), turnCredentials: async () => ({ urls: ['turn:relay.test:3478'], username: 'test', credential: 'test' }) };
  const recorder = { prepare: async () => {}, start: async () => {}, stop: async () => ({}), setMuted() {} };
  const rtc = { mediaDevices: { getUserMedia: async () => stream } };
  class Socket {
    static OPEN = 1;
    readyState = 1;
    constructor() { queueMicrotask(() => this.onmessage?.({ data: '{"type":"ready"}' })); }
    send() {}
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const native = { NativeModules: { LinqaCallRecorder: recorder }, DeviceEventEmitter: { addListener: () => ({ remove() {} }) }, Platform: { OS: 'ios' }, PermissionsAndroid: {} };
  const imports = { './call-ownership': { anotherCallActive: () => false }, './call-actions/board': boardModule.exports, 'react-native': native, '../config/api': { getApiBaseUrl: () => 'http://test' }, './calls.service': { CallsService: class { constructor() { return calls; } } }, './session': { accessTokenProvider: { getAccessToken: async () => 'token' } }, './call-recordings': { newRecordingUri: async () => 'file://record.wav', saveRecording: async () => {} }, 'react-native-webrtc': rtc, 'react-native-incall-manager': { default: manager } };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => { if (!(name in imports)) throw Error(name); return imports[name]; }, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, WebSocket: Socket, btoa, atob, console });
  return { controller: new module.exports.CallController(), tracks, stream, calls, recorder, rtc, native };
}
const turn = () => new Promise(resolve => setImmediate(resolve));

test('hangup stops media without waiting for an unresponsive backend', async () => {
  const f = fixture(); await f.controller.start({ peerUserId: 'user', peerName: 'Test', callType: 'AUDIO' });
  f.calls.endCall = () => new Promise(() => {});
  await f.controller.hangUp();
  assert.equal(f.controller.getState().phase, 'idle'); assert.ok(f.tracks.every(t => t.stopped));
});
test('media returned after hangup is stopped and never restores the call', async () => {
  const f = fixture(); const media = deferred(); f.rtc.mediaDevices.getUserMedia = () => media.promise;
  const starting = f.controller.start({ peerUserId: 'user', peerName: 'Test', callType: 'VIDEO' }); await turn();
  await f.controller.hangUp(); media.resolve(f.stream); await starting;
  assert.ok(f.tracks.every(t => t.stopped)); assert.equal(f.controller.getState().localStreamUrl, null); assert.equal(f.controller.getState().phase, 'idle');
});
test('decline releases the ring screen even when server termination is pending', async () => {
  const f = fixture(); f.calls.endCall = () => new Promise(() => {});
  f.controller.handleIncoming({ callId: 'call', callType: 'AUDIO', privacyMode: 'STANDARD', callerDeviceId: 'peer', callerName: 'Test' });
  await f.controller.decline(); assert.equal(f.controller.getState().phase, 'idle');
});
test('signaling rejects other call or peer identities and bounds queued ICE', async () => {
  const f = fixture(); await f.controller.start({ peerUserId: 'user', peerName: 'Test', callType: 'AUDIO' });
  const frame = { callId: 'call', senderDeviceId: 'intruder', sequence: 1, eventType: 'CALL_ENDED', ciphertextBase64: btoa('{}') };
  await f.controller.onSignal(frame); assert.equal(f.controller.getState().phase, 'calling');
  await f.controller.onSignal({ ...frame, senderDeviceId: 'peer', callId: 'old' }); assert.equal(f.controller.getState().phase, 'calling');
  for (let i = 1; i <= 300; i++) await f.controller.onSignal({ ...frame, senderDeviceId: 'peer', sequence: i, eventType: 'ICE_CANDIDATE', ciphertextBase64: btoa('{"candidate":{"candidate":"test"}}') });
  assert.equal(f.controller.pendingIce.length, 256); await f.controller.hangUp();
});
test('late connection callbacks cannot resurrect an ended call', async () => {
  const f = fixture(); const listeners = {};
  f.rtc.RTCPeerConnection = class { connectionState = 'new'; addTrack() {} createDataChannel() { return { addEventListener() {} }; } addEventListener(name, fn) { listeners[name] = fn; } close() {} getStats() { return Promise.resolve(new Map()); } };
  await f.controller.start({ peerUserId: 'user', peerName: 'Test', callType: 'AUDIO' }); const peer = await f.controller.createPeer();
  await f.controller.hangUp(); peer.connectionState = 'connected'; listeners.connectionstatechange();
  assert.equal(f.controller.getState().phase, 'idle'); assert.equal(f.controller.getState().connectedAt, null);
});
test('recorder preparation completing after hangup cannot start recording', async () => {
  const f = fixture(); await f.controller.start({ peerUserId: 'user', peerName: 'Test', callType: 'AUDIO' });
  f.controller.set({ phase: 'active', recording: 'asking' }); const prepared = deferred(); let starts = 0;
  f.recorder.prepare = () => prepared.promise; f.recorder.start = async () => { starts++; };
  const recording = f.controller.respondRecording(true); await turn(); await f.controller.hangUp(); prepared.resolve(); await recording;
  assert.equal(starts, 0); assert.equal(f.controller.getState().recording, 'off');
});
test('a native recorder start completing after hangup is stopped', async () => {
  const f = fixture(); await f.controller.start({ peerUserId: 'user', peerName: 'Test', callType: 'AUDIO' });
  f.controller.set({ phase: 'active', recording: 'asking' }); const started = deferred(); let stops = 0;
  f.recorder.start = () => started.promise; f.recorder.stop = async () => { stops++; return {}; };
  const recording = f.controller.respondRecording(true); await turn(); await f.controller.hangUp(); started.resolve(); await recording;
  assert.equal(stops, 1); assert.equal(f.controller.getState().recording, 'off'); assert.equal(f.controller.getState().phase, 'idle');
});
test('recording stop grace accepts final peer lines and rejects invalid or excessive input', async () => {
  const f = fixture(); f.controller.recordingStopping = true;
  await f.controller.onPeerMessage({ t: 'seg', text: 'last line', at: 100 });
  for (const at of [-1, NaN, Infinity, 86_400_001]) await f.controller.onPeerMessage({ t: 'seg', text: 'invalid', at });
  assert.equal(f.controller.lines.length, 1); assert.equal(f.controller.lines[0].text, 'last line');
  f.controller.lines = Array(20_000).fill({}); await f.controller.onPeerMessage({ t: 'seg', text: 'over limit', at: 101 }); assert.equal(f.controller.lines.length, 20_000);
  f.controller.recordingStopping = false; f.controller.lines = []; await f.controller.onPeerMessage({ t: 'seg', text: 'after stop', at: 102 }); assert.equal(f.controller.lines.length, 0);
});
test('unanswered call deadline releases the microphone', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const f = fixture();
  await f.controller.start({ peerUserId: 'user', peerName: 'Test', callType: 'AUDIO' }); t.mock.timers.tick(45_001); await turn();
  assert.equal(f.controller.getState().phase, 'idle'); assert.ok(f.tracks.every(track => track.stopped));
});
test('outgoing calls preserve relay-only privacy and fail closed without a usable relay', async () => {
  const f = fixture(); let privacy;
  f.controller.privacy = 'STANDARD';
  f.calls.placeCall = async input => { privacy = input.privacyMode; return { callId: 'call', calleeDeviceId: 'peer' }; };
  await f.controller.start({ peerUserId: 'user', peerName: 'Test', callType: 'AUDIO' }); assert.equal(privacy, 'RELAY_ONLY');
  f.calls.turnCredentials = async () => ({ urls: ['turn:127.0.0.1:3478'] });
  await assert.rejects(f.controller.iceServers(), /reachable TURN relay/); await f.controller.hangUp();
});

test('hand state changes only after delivery and ignores malformed peer messages', async () => {
  const { controller: c } = fixture(); c.set({ phase: 'active', callId: 'call' });
  c.toggleHand(); assert.equal(c.getState().handRaised, false);
  c.channel = { readyState: 'open', send() {} }; c.toggleHand(); assert.equal(c.getState().handRaised, true);
  await c.onPeerMessage(null); await c.onPeerMessage({ t: 'call.hand', raised: 'yes' });
  assert.equal(c.getState().peerHandRaised, false);
  await c.onPeerMessage({ t: 'call.hand', raised: true }); assert.equal(c.getState().peerHandRaised, true);
  await c.hangUp(); assert.equal(c.getState().handRaised, false);
});
test('board transport validates ownership and disallows peer snapshots', async () => {
  const { controller: c } = fixture(); c.set({ phase: 'active', callId: 'call' }); c.channel = { readyState: 'open', send() {} };
  assert.ok(c.boardAction({ t: 'board-open', by: 'self', at: 1 }));
  c.boardAction({ t: 'stroke-pts', id: 'one', color: '#ffffff', width: .01, pts: [0, 0, 1, 1] });
  await c.onPeerMessage({ t: 'call.board', op: { t: 'stroke-undo', id: 'one' } });
  await c.onPeerMessage({ t: 'call.board', op: { t: 'board-close', by: 'self' } });
  assert.equal(c.getState().board.strokes.length, 1); assert.ok(c.getState().board.open);
  await c.onPeerMessage({ t: 'call.board', op: { t: 'board-sync', openedBy: 'peer', strokes: [] } });
  assert.equal(c.getState().board.openedBy, 'self'); await c.hangUp(); assert.equal(c.getState().board.open, false);
});

test('camera permission completing after hangup never acquires media', async () => {
  const f = fixture(); const c = f.controller; const gate = deferred(); let acquisitions = 0;
  c.set({ phase: 'active', callId: 'call' }); c.pc = {}; c.localStream = f.stream;
  c.videoSender = { replaceTrack: async () => {} }; c.ensurePermissions = () => gate.promise;
  f.rtc.mediaDevices.getUserMedia = async () => { acquisitions++; return f.stream; };
  const operation = c.toggleCamera(); await turn(); await c.hangUp(); gate.resolve(); await operation;
  assert.equal(acquisitions, 0); assert.equal(c.getState().phase, 'idle');
});
test('late camera media is stopped after hangup', async () => {
  const f = fixture(); const c = f.controller; const gate = deferred(); const track = { stop() { this.stopped = true; } };
  c.set({ phase: 'active', callId: 'call' }); c.pc = {}; c.localStream = f.stream;
  c.videoSender = { replaceTrack: async () => {} }; c.ensurePermissions = async () => {};
  f.rtc.mediaDevices.getUserMedia = () => gate.promise;
  const operation = c.toggleCamera(); await turn(); await c.hangUp(); gate.resolve({ getTracks: () => [track] }); await operation;
  assert.equal(track.stopped, true); assert.equal(c.getState().phase, 'idle');
});
test('screen sharing fails closed on iOS without a broadcast extension', async () => {
  const { controller: c } = fixture(); c.set({ phase: 'active', callId: 'call' }); c.videoSender = {};
  await c.toggleScreenShare(); assert.equal(c.getState().sharingScreen, false); assert.equal(c.getState().mediaBusy, false);
  assert.match(c.getState().note, /unavailable/); await c.hangUp();
});
test('ending a call stops every display capture track', async () => {
  const { controller: c } = fixture(); let stopped = 0; c.set({ phase: 'active', callId: 'call', sharingScreen: true });
  c.displayStream = { getTracks: () => [{ stop() { stopped++; } }, { stop() { stopped++; } }] };
  await c.hangUp(); assert.equal(stopped, 2); assert.equal(c.getState().sharingScreen, false);
});

test('Android screen sharing replaces the video sender and restores the camera when stopped', async () => {
  const f = fixture(); const c = f.controller; f.native.Platform.OS = 'android';
  let stopped = false; const displayTrack = { addEventListener() {}, stop() { stopped = true; } };
  const display = { getTracks: () => [displayTrack], getVideoTracks: () => [displayTrack], toURL: () => 'display' };
  f.rtc.mediaDevices.getDisplayMedia = async () => display;
  const replacements = []; c.pc = {}; c.localStream = f.stream; c.videoSender = { replaceTrack: async track => replacements.push(track) };
  c.set({ phase: 'active', callId: 'call' }); c.channel = { readyState: 'open', send() {} };
  await c.toggleScreenShare(); assert.equal(c.getState().sharingScreen, true); assert.equal(c.getState().localStreamUrl, 'display');
  await c.toggleScreenShare(); assert.equal(stopped, true); assert.equal(c.getState().sharingScreen, false);
  assert.equal(replacements[0], displayTrack); assert.equal(replacements[1], null); await c.hangUp();
});
test('Android capture consent completing after hangup releases its stream', async () => {
  const f = fixture(); const c = f.controller; f.native.Platform.OS = 'android'; const gate = deferred();
  f.rtc.mediaDevices.getDisplayMedia = () => gate.promise;
  c.pc = {}; c.videoSender = {}; c.set({ phase: 'active', callId: 'call' });
  const operation = c.toggleScreenShare(); await turn(); await c.hangUp(); let stopped = false;
  gate.resolve({ getTracks: () => [{ stop() { stopped = true; } }] }); await operation;
  assert.equal(stopped, true); assert.equal(c.getState().phase, 'idle');
});
