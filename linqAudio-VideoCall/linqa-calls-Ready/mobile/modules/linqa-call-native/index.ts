import { Platform } from 'react-native';
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

type Action = { action: 'decline' | 'end'; callId: string };

interface LinqaCallNativeModule {
  blurSupported: boolean;
  screenShareSupported: boolean;
  getVoipToken(): string | null;
  stopScreenShareBroadcast(): void;
  // Android only
  getPushToken?(): Promise<string | null>;
  takeDeclinedCalls?(): string[];
  cancelIncomingCall?(callId: string): void;
  startCallService?(callId: string, video: boolean): void;
  stopCallService?(): void;
  addListener(event: 'onVoipToken' | 'onPushToken', fn: (e: { token: string }) => void): EventSubscription;
  addListener(event: 'onCallAction', fn: (e: Action) => void): EventSubscription;
}

/** Null in Expo Go or in a build made before this module was added. */
const native = requireOptionalNativeModule<LinqaCallNativeModule>('LinqaCallNative');

export const callNative = {
  available: !!native,
  blurSupported: !!native?.blurSupported,
  screenShareSupported: !!native?.screenShareSupported,

  /** iOS: PushKit token (kind "voip"). Android: FCM token (kind "fcm"). */
  async getPushToken(): Promise<{ kind: 'voip' | 'fcm'; token: string } | null> {
    if (!native) return null;
    if (Platform.OS === 'ios') {
      const t = native.getVoipToken();
      return t ? { kind: 'voip', token: t } : null;
    }
    const t = (await native.getPushToken?.()) ?? null;
    return t ? { kind: 'fcm', token: t } : null;
  },

  onPushToken(fn: (p: { kind: 'voip' | 'fcm'; token: string }) => void): () => void {
    const kind = Platform.OS === 'ios' ? 'voip' : 'fcm';
    const event = Platform.OS === 'ios' ? 'onVoipToken' : 'onPushToken';
    const sub = native?.addListener(event, (e: { token: string }) => fn({ kind, token: e.token }));
    return () => sub?.remove();
  },

  /** Android: Decline/End tapped on a notification while JS is running. */
  onCallAction(fn: (a: Action) => void): () => void {
    const sub = native?.addListener('onCallAction', fn);
    return () => sub?.remove();
  },

  /** Android: declines tapped while the app was closed. */
  takeDeclinedCalls: (): string[] => native?.takeDeclinedCalls?.() ?? [],
  cancelIncomingCall: (callId: string) => native?.cancelIncomingCall?.(callId),
  startCallService: (callId: string, video: boolean) => native?.startCallService?.(callId, video),
  stopCallService: () => native?.stopCallService?.(),
  stopScreenShareBroadcast: () => native?.stopScreenShareBroadcast(),
};
