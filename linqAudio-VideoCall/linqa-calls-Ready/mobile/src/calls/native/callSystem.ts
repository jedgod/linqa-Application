/**
 * Connects Linqa calls to the phone's own call system.
 *
 *  iOS      CallKit through react-native-callkeep. PushKit pushes are reported
 *           natively (modules/linqa-call-native/ios/LinqaPushKit.m); this file
 *           handles what the user does on the CallKit screen.
 *  Android  FCM -> full-screen call notification (native). Answer opens the
 *           app with linqacall://answer?callId=…; a foreground service keeps
 *           the call alive in the background.
 *  Both     registers this device's push token with the API.
 */
import { AppState, Linking, PermissionsAndroid, Platform } from 'react-native';
import RNCallKeep from 'react-native-callkeep';
import { RTCAudioSession } from 'react-native-webrtc';
import { callNative } from '../../../modules/linqa-call-native';
import { callApi } from '../callApi';
import type { CallEngine } from '../CallEngine';
import type { CallManager } from '../CallManager';
import type { CallPeopleDirectory } from '../ports';

export function setupCallSystem(manager: CallManager, people: CallPeopleDirectory): () => void {
  const offs: (() => void)[] = [];
  offs.push(registerPushToken(manager));
  offs.push(Platform.OS === 'ios' ? setupIos(manager, people) : setupAndroid(manager));
  offs.push(trackEngines(manager));
  return () => offs.forEach((o) => o());
}

/* ------------------------------------------------------------------ push token */

function registerPushToken(manager: CallManager): () => void {
  let last = '';
  const send = (p: { kind: 'voip' | 'fcm'; token: string } | null) => {
    if (!p || p.token === last) return;
    last = p.token;
    callApi.registerPushToken(manager.session, p.kind, p.token).catch(() => (last = ''));
  };
  callNative.getPushToken().then(send, () => {});
  const off = callNative.onPushToken(send);
  // Retry on foreground in case the first attempt failed offline.
  const sub = AppState.addEventListener('change', (s) => s === 'active' && callNative.getPushToken().then(send, () => {}));
  return () => {
    off();
    sub.remove();
  };
}

/* ------------------------------------------------------------------ iOS: CallKit */

function setupIos(manager: CallManager, people: CallPeopleDirectory): () => void {
  manager.systemRingUi = true; // CallKit shows incoming calls; skip the in-app ring card

  RNCallKeep.setup({
    ios: { appName: 'Linqa', supportsVideo: true, maximumCallGroups: '1', maximumCallsPerCallGroup: '1', includesCallsInRecents: false },
    android: { alertTitle: '', alertDescription: '', cancelButton: '', okButton: '', additionalPermissions: [] },
  }).catch(() => {});

  const shown = new Set<string>();
  const handlers: Record<string, (e: any) => void> = {
    answerCall: ({ callUUID }) => {
      manager.answerById(callUUID.toLowerCase()).catch(() => RNCallKeep.endCall(callUUID));
    },
    endCall: ({ callUUID }) => {
      const id = callUUID.toLowerCase();
      const engine = manager.state.engine;
      if (engine && engine.state.callId === id) engine.hangUp();
      else manager.declineById(id);
    },
    didPerformSetMutedCallAction: ({ callUUID, muted }) => {
      const engine = manager.state.engine;
      if (engine && engine.state.callId === callUUID.toLowerCase()) engine.setMuted(muted);
    },
    didActivateAudioSession: () => RTCAudioSession.audioSessionDidActivate(),
    didDeactivateAudioSession: () => RTCAudioSession.audioSessionDidDeactivate(),
    didDisplayIncomingCall: ({ callUUID }) => shown.add(callUUID.toLowerCase()),
  };
  for (const [event, fn] of Object.entries(handlers)) RNCallKeep.addEventListener(event as any, fn);

  // Actions taken on the CallKit screen before JS finished loading (cold start from a push).
  const nativeNames: Record<string, string> = {
    RNCallKeepPerformAnswerCallAction: 'answerCall',
    RNCallKeepPerformEndCallAction: 'endCall',
    RNCallKeepDidPerformSetMutedCallAction: 'didPerformSetMutedCallAction',
    RNCallKeepDidActivateAudioSession: 'didActivateAudioSession',
    RNCallKeepDidDeactivateAudioSession: 'didDeactivateAudioSession',
    RNCallKeepDidDisplayIncomingCall: 'didDisplayIncomingCall',
  };
  RNCallKeep.addEventListener('didLoadWithEvents', (events) => {
    for (const e of events ?? []) {
      const key = nativeNames[e.name];
      if (key) handlers[key](e.data);
    }
  });

  // A ring that arrived over the socket (app open, or push-woken):
  // show it in CallKit if the push didn't already, and put the name on it.
  const offRing = manager.onRing((r) => {
    const name = people.displayName(r.fromUserId);
    if (!shown.has(r.callId)) {
      shown.add(r.callId);
      RNCallKeep.displayIncomingCall(r.callId, 'Linqa', name, 'generic', r.kind === 'video');
    } else {
      RNCallKeep.updateDisplay(r.callId, name, 'Linqa');
    }
  });

  // The other side hung up / someone else answered before we did.
  const offCancel = manager.signaling.on('call:ring-cancelled', (e) => {
    RNCallKeep.reportEndCallWithUUID(e.callId, e.reason === 'answered-elsewhere' ? 4 : e.reason === 'timeout' ? 3 : 2);
  });
  const offEnded = manager.signaling.on('call:ended', (e) => RNCallKeep.reportEndCallWithUUID(e.callId, 2));

  return () => {
    for (const event of [...Object.keys(handlers), 'didLoadWithEvents']) RNCallKeep.removeEventListener(event as any);
    offRing();
    offCancel();
    offEnded();
  };
}

/* ------------------------------------------------------------------ Android */

function setupAndroid(manager: CallManager): () => void {
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as any).catch(() => {});
  }

  const handleUrl = (url: string | null) => {
    if (!url || !url.startsWith('linqacall://')) return;
    const m = /^linqacall:\/\/(\w+)\?callId=([^&]+)/.exec(url);
    if (!m) return;
    const [, action, raw] = m;
    const callId = decodeURIComponent(raw);
    callNative.cancelIncomingCall(callId);
    if (action === 'answer') manager.answerById(callId).catch(() => {});
    // 'open' just brings the app up; the server re-sends the ring on connect.
  };
  Linking.getInitialURL().then(handleUrl, () => {});
  const linkSub = Linking.addEventListener('url', ({ url }) => handleUrl(url));

  for (const id of callNative.takeDeclinedCalls()) manager.declineById(id);
  const offAction = callNative.onCallAction(({ action, callId }) => {
    if (action === 'decline') manager.declineById(callId);
    if (action === 'end') {
      const engine = manager.state.engine;
      if (engine && engine.state.callId === callId) engine.hangUp();
    }
  });

  // Ring handled in-app: drop the system notification so it doesn't ring twice.
  const offRing = manager.onRing((r) => callNative.cancelIncomingCall(r.callId));
  const offCancel = manager.signaling.on('call:ring-cancelled', (e) => callNative.cancelIncomingCall(e.callId));

  return () => {
    linkSub.remove();
    offAction();
    offRing();
    offCancel();
  };
}

/* ------------------------------------------------------------------ both: active call */

/** Mirrors each call's lifecycle into CallKit (iOS) or the foreground service (Android). */
function trackEngines(manager: CallManager): () => void {
  let current: CallEngine | null = null;
  let offEngine: (() => void) | null = null;

  const off = manager.subscribe((s) => {
    if (s.engine === current) return;
    offEngine?.();
    current = s.engine;
    if (!current) return;
    const engine = current;
    const callId = engine.state.callId;
    const video = engine.state.kind === 'video';
    // Incoming calls are already in CallKit (answered there). Calls we start,
    // or take over from another device, are reported as outgoing.
    const reportOutgoing = Platform.OS === 'ios' && engine.direction !== 'incoming';
    let reportedConnected = false;

    if (reportOutgoing) RNCallKeep.startCall(callId, 'Linqa', 'Linqa call', 'generic', video);
    if (Platform.OS === 'android') callNative.startCallService(callId, video);

    offEngine = engine.subscribe((st) => {
      if (reportOutgoing && st.status === 'active' && !reportedConnected) {
        reportedConnected = true;
        RNCallKeep.reportConnectedOutgoingCallWithUUID(callId);
      }
      if (Platform.OS === 'ios') RNCallKeep.setMutedCall(callId, st.self.muted);
      if (st.status === 'ended') {
        if (Platform.OS === 'ios') RNCallKeep.endCall(callId);
        else callNative.stopCallService();
      }
    });
  });

  return () => {
    off();
    offEngine?.();
  };
}

