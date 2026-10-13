// Screen-capture protection for the protected photo viewer.
//
// While `active`:
//  - BLOCKS capture: iOS 13+ shows a blank screenshot/recording; Android sets
//    FLAG_SECURE so screenshots and recordings come out black.
//  - DETECTS screenshots (expo-screen-capture) and screen recording/mirroring
//    (local ScreenRecordingDetector module) and calls onCapture.

import { useEffect, useRef } from 'react';

// Loaded defensively: an app build without the native module must not crash the chat. In that
// case protected photos refuse to open (see captureProtectionAvailable) instead of showing unprotected.
type ScreenCaptureModule = typeof import('expo-screen-capture');
let ScreenCapture: ScreenCaptureModule | null = null;
try {
  ScreenCapture = require('expo-screen-capture') as ScreenCaptureModule;
} catch {
  ScreenCapture = null;
}

/** False when this build cannot block screenshots; the viewer must not open a photo then. */
export function captureProtectionAvailable(): boolean {
  return ScreenCapture !== null;
}
import {
  addCaptureListener,
  isScreenBeingCaptured,
} from '../../modules/screen-recording-detector';

const KEY = 'linqa-protected-viewer';

export type CaptureKind = 'screenshot' | 'recording';

/** Call before opening the viewer. On Android 13 and older, screenshot detection needs a media permission. */
export async function prepareCaptureDetection(): Promise<{ screenshotDetection: boolean }> {
  try {
    if (!ScreenCapture) return { screenshotDetection: false };
    const perm = await ScreenCapture.getPermissionsAsync();
    if (perm.granted) return { screenshotDetection: true };
    if (!perm.canAskAgain) return { screenshotDetection: false };
    const req = await ScreenCapture.requestPermissionsAsync();
    return { screenshotDetection: req.granted };
  } catch {
    return { screenshotDetection: false };
  }
}

export { isScreenBeingCaptured };

export function useCaptureGuard(active: boolean, onCapture: (kind: CaptureKind) => void) {
  const handler = useRef(onCapture);
  handler.current = onCapture;

  useEffect(() => {
    if (!active || !ScreenCapture) return;
    const guard = ScreenCapture;
    let fired = false;
    const fire = (kind: CaptureKind) => {
      if (fired) return; // one report per viewing session
      fired = true;
      handler.current(kind);
    };

    void guard.preventScreenCaptureAsync(KEY);
    const shot = guard.addScreenshotListener(() => fire('screenshot'));
    const rec = addCaptureListener((captured) => {
      if (captured) fire('recording');
    });
    // Recording may have started before the viewer opened.
    if (isScreenBeingCaptured()) fire('recording');

    return () => {
      shot.remove();
      rec.remove();
      void guard.allowScreenCaptureAsync(KEY);
    };
  }, [active]);
}
