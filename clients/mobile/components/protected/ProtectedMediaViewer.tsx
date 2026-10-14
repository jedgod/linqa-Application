// Full-screen viewer for a protected photo (recipient side).
//
// Flow: check for recording → request a view (server counts + audits it) →
// download ciphertext once → decrypt in memory → show with countdown.
// Ends on timer, close, app backgrounding, window expiry, or capture.
// The decrypted image only ever lives in memory, never on disk.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, Clock, EyeOff, Lock, X } from './icons';
import {
  endView,
  fetchCiphertext,
  getMediaStatus,
  MediaApiError,
  reportCapture,
  requestView,
  type EndReason,
  type ViewGrant,
} from '../../lib/protectedMedia/api';
import { bytesToBase64, decryptMedia } from '../../lib/protectedMedia/crypto';
import { forgetMediaKey, getMediaKey } from '../../lib/protectedMedia/keyStore';
import {
  captureProtectionAvailable,
  enableCaptureProtection,
  disableCaptureProtection,
  isScreenBeingCaptured,
  prepareCaptureDetection,
  useCaptureGuard,
  type CaptureKind,
} from '../../lib/protectedMedia/captureGuard';

type Phase =
  | { k: 'starting' }
  | { k: 'recording-active' }
  | { k: 'loading' }
  | { k: 'showing'; uri: string; endsAt: number; total: number }
  | { k: 'captured'; kind: CaptureKind; revoked: boolean | null }
  | { k: 'unavailable'; message: string }
  | { k: 'error'; message: string };

const UNAVAILABLE_TEXT: Record<string, string> = {
  EXHAUSTED: 'You have used all the views for this photo.',
  EXPIRED: 'The viewing window for this photo has ended.',
  REVOKED: 'The sender removed this photo.',
  CAPTURE_REVOKED: 'Access was removed after a screen capture.',
  DELETED: 'This photo has been deleted.',
};

type Props = {
  mediaId: string;
  visible: boolean;
  /** Called when the viewer closes. Refresh the bubble's status here. */
  onClose: () => void;
};

export function ProtectedMediaViewer({ mediaId, visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>({ k: 'starting' });
  const [now, setNow] = useState(Date.now());
  const grantRef = useRef<ViewGrant | null>(null);
  const endedRef = useRef(false);
  const aliveRef = useRef(false);
  const interruptedRef = useRef(false);

  const reset = () => {
    grantRef.current = null;
    endedRef.current = false;
    interruptedRef.current = false;
    setPhase({ k: 'starting' });
  };

  /** Report the end of the view once, then clean up the key if access is over. */
  const finishView = useCallback(
    async (reason: EndReason) => {
      const grant = grantRef.current;
      if (grant && !endedRef.current) {
        endedRef.current = true;
        try {
          await endView(mediaId, grant.viewId, reason);
        } catch {
          // Audit end-event is best effort; the server already logged the view itself.
        }
      }
      try {
        const status = await getMediaStatus(mediaId);
        if (status.status !== 'ACTIVE') await forgetMediaKey(mediaId);
      } catch {
        // offline; the key is removed next time status is checked
      }
    },
    [mediaId],
  );

  const close = useCallback(
    (reason: EndReason = 'closed') => {
      // Drop the image from state first so it disappears immediately.
      aliveRef.current = false;
      interruptedRef.current = true;
      setPhase({ k: 'starting' });
      void finishView(reason).finally(() => {
        reset();
        onClose();
      });
    },
    [finishView, onClose],
  );

  // ----- open ------------------------------------------------------------------
  useEffect(() => {
    if (!visible) return;
    aliveRef.current = true;
    reset();

    (async () => {
      // Never show a photo on a build that cannot block screenshots.
      if (!captureProtectionAvailable()) {
        setPhase({ k: 'unavailable', message: 'Update Linqa to open protected photos on this phone.' });
        return;
      }
      // Do not spend a view while the screen is being recorded or mirrored.
      if (isScreenBeingCaptured()) {
        setPhase({ k: 'recording-active' });
        return;
      }
      await prepareCaptureDetection();
      try {
        await enableCaptureProtection();
      } catch {
        if (aliveRef.current) setPhase({ k: 'unavailable', message: 'Screenshot protection could not be enabled. Please update Linqa and try again.' });
        return;
      }
      if (!aliveRef.current || interruptedRef.current) {
        await disableCaptureProtection().catch(() => undefined);
        return;
      }

      const secret = await getMediaKey(mediaId);
      if (!aliveRef.current || interruptedRef.current) return;
      if (!secret) {
        setPhase({ k: 'unavailable', message: 'This photo can no longer be opened on this device.' });
        return;
      }

      setPhase({ k: 'loading' });
      try {
        const grant = await requestView(mediaId);
        grantRef.current = grant;
        const cipher = await fetchCiphertext(mediaId, grant);
        const plain = decryptMedia(cipher, secret);
        const uri = `data:image/jpeg;base64,${bytesToBase64(plain)}`;
        plain.fill(0);
        if (!aliveRef.current || interruptedRef.current) return;

        let endsAt = Date.now() + grant.displaySeconds * 1000;
        if (grant.expiresAt) endsAt = Math.min(endsAt, new Date(grant.expiresAt).getTime());
        setPhase({ k: 'showing', uri, endsAt, total: Math.max(1, endsAt - Date.now()) });
      } catch (e) {
        if (!aliveRef.current || interruptedRef.current) return;
        if (e instanceof MediaApiError && e.status === 410) {
          await forgetMediaKey(mediaId);
          setPhase({
            k: 'unavailable',
            message: UNAVAILABLE_TEXT[e.mediaStatus ?? ''] ?? 'This photo is no longer available.',
          });
        } else if (e instanceof MediaApiError && e.status === 404) {
          setPhase({ k: 'unavailable', message: 'This photo is not available to you.' });
        } else {
          setPhase({ k: 'error', message: 'Could not open the photo. Check your connection and try again.' });
        }
      }
    })();

    return () => {
      aliveRef.current = false;
      void disableCaptureProtection().catch(() => undefined);
    };
  }, [visible, mediaId]);

  // ----- capture detection -----------------------------------------------------
  const guardActive = visible;
  useCaptureGuard(guardActive, (kind) => {
    // Remove the image from the screen first, then report.
    interruptedRef.current = true;
    setPhase({ k: 'captured', kind, revoked: null });
    void (async () => {
      let revoked = false;
      try {
        revoked = (await reportCapture(mediaId, kind, grantRef.current?.viewId)).revoked;
      } catch {
        // If the report fails the server still enforces the view limit and expiry.
      }
      await finishView('capture');
      if (revoked) await forgetMediaKey(mediaId);
      if (aliveRef.current) setPhase({ k: 'captured', kind, revoked });
    })();
  });

  // ----- countdown -------------------------------------------------------------
  useEffect(() => {
    if (phase.k !== 'showing') return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= phase.endsAt) close('timer');
    }, 200);
    return () => clearInterval(t);
  }, [phase, close]);

  // ----- leaving the app ends the view -------------------------------------------
  useEffect(() => {
    if (phase.k !== 'showing' && phase.k !== 'loading') return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') close('background');
    });
    return () => sub.remove();
  }, [phase.k, close]);

  // ----- render ------------------------------------------------------------------
  const remainingMs = phase.k === 'showing' ? Math.max(0, phase.endsAt - now) : 0;
  const progress = phase.k === 'showing' ? remainingMs / phase.total : 0;
  const grant = grantRef.current;

  return (
    // Android dialogs inherit FLAG_SECURE when created, so mount only after native blocking succeeds.
    <Modal visible={visible && phase.k !== 'starting'} animationType="fade" presentationStyle="fullScreen" onRequestClose={() => close('closed')}>
      <StatusBar barStyle="light-content" />
      <View style={styles.root}>
        {phase.k === 'showing' && (
          <>
            <Image
              source={{ uri: phase.uri }}
              style={StyleSheet.absoluteFill}
              resizeMode="contain"
              accessibilityLabel="Protected photo"
              accessibilityIgnoresInvertColors
            />
            <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
              </View>
              <View style={styles.topRow}>
                <View style={styles.pill}>
                  <Clock size={14} color="#FFFFFF" strokeWidth={2} />
                  <Text style={styles.pillText} accessibilityLiveRegion="polite">
                    {Math.ceil(remainingMs / 1000)}s
                  </Text>
                </View>
                {grant?.remainingViews !== null && grant?.remainingViews !== undefined && (
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>
                      {grant.remainingViews === 0 ? 'Last view' : `${grant.remainingViews} left`}
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1 }} />
                <CloseButton onPress={() => close('closed')} />
              </View>
            </View>
          </>
        )}

        {phase.k !== 'showing' && (
          <View style={[styles.center, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            {(phase.k === 'starting' || phase.k === 'loading') && (
              <>
                <ActivityIndicator color="#FFFFFF" size="large" />
                <Text style={styles.msg}>Opening protected photo…</Text>
              </>
            )}

            {phase.k === 'recording-active' && (
              <Notice
                icon={<EyeOff size={34} color="#FFFFFF" strokeWidth={1.8} />}
                title="Stop screen recording to view"
                text="This photo can't be opened while your screen is being recorded or mirrored. No view was used."
                onDone={() => close('closed')}
              />
            )}

            {phase.k === 'captured' && (
              <Notice
                icon={<Camera size={34} color="#FFFFFF" strokeWidth={1.8} />}
                title={phase.kind === 'screenshot' ? 'Screenshot detected' : 'Screen recording detected'}
                text={
                  phase.revoked === null
                    ? 'Notifying the sender…'
                    : phase.revoked
                      ? 'The sender was notified and your access to this photo has ended.'
                      : 'The sender was notified.'
                }
                onDone={() => close('capture')}
              />
            )}

            {phase.k === 'unavailable' && (
              <Notice
                icon={<Lock size={34} color="#FFFFFF" strokeWidth={1.8} />}
                title="Photo unavailable"
                text={phase.message}
                onDone={() => close('closed')}
              />
            )}

            {phase.k === 'error' && (
              <Notice
                icon={<Lock size={34} color="#FFFFFF" strokeWidth={1.8} />}
                title="Something went wrong"
                text={phase.message}
                onDone={() => close('closed')}
              />
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}

function CloseButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Close photo" hitSlop={8} style={styles.closeBtn}>
      <X size={22} color="#FFFFFF" strokeWidth={2} />
    </Pressable>
  );
}

function Notice({ icon, title, text, onDone }: { icon: React.ReactNode; title: string; text: string; onDone: () => void }) {
  return (
    <View style={styles.notice}>
      <View style={styles.noticeIcon}>{icon}</View>
      <Text style={styles.noticeTitle}>{title}</Text>
      <Text style={styles.msg}>{text}</Text>
      <Pressable onPress={onDone} accessibilityRole="button" style={({ pressed }) => [styles.doneBtn, pressed && { opacity: 0.85 }]}>
        <Text style={styles.doneText}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  topBar: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 12, gap: 10 },
  progressTrack: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  progressFill: { height: 3, backgroundColor: '#FFFFFF' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  pillText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  msg: { color: '#D3D8E4', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  notice: { alignItems: 'center', gap: 12, maxWidth: 320 },
  noticeIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  doneBtn: {
    marginTop: 8,
    minWidth: 160,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: '#3D6BF0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
