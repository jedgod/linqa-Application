// Screen recording / mirroring detection.
//   iOS:     UIScreen.isCaptured (recording, AirPlay mirroring, QuickTime capture)
//   Android: WindowManager screen recording callback (Android 15 / API 35+)
// On older Android versions recording cannot be detected; FLAG_SECURE from
// expo-screen-capture still makes recordings show a black screen there.

import { requireOptionalNativeModule } from 'expo-modules-core';

type Subscription = { remove(): void };

type NativeModule = {
  isSupported: boolean;
  isCaptured(): boolean;
  addListener(event: 'onChange', listener: (e: { isCaptured: boolean }) => void): Subscription;
};

const Native = requireOptionalNativeModule<NativeModule>('ScreenRecordingDetector');

/** True when this device can report screen recording. */
export function isRecordingDetectionSupported(): boolean {
  return !!Native?.isSupported;
}

/** True when the screen is being recorded or mirrored right now. */
export function isScreenBeingCaptured(): boolean {
  try {
    return Native?.isCaptured() ?? false;
  } catch {
    return false;
  }
}

export function addCaptureListener(listener: (isCaptured: boolean) => void): Subscription {
  if (!Native) return { remove() {} };
  return Native.addListener('onChange', (e) => listener(!!e?.isCaptured));
}
