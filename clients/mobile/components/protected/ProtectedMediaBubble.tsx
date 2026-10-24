// Chat bubble for a protected photo. Render it for linqa-core messages whose
// content type is "protected_media".
//   Recipient: tap to open the viewer.
//   Sender:    tap to see the activity log (and revoke).

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, Eye, Lock, Timer } from './icons';
import { COLORS as C } from '../../constants/theme';
import { getMediaStatus, type ProtectedMediaInfo } from '../../lib/protectedMedia/api';
import { forgetMediaKey } from '../../lib/protectedMedia/keyStore';
import { policyLabel, type ExpiryStart, type ProtectionMode } from '../../lib/protectedMedia/policy';
import { ProtectedMediaViewer } from './ProtectedMediaViewer';
import { AuditTrailSheet } from './AuditTrail';

type Props = {
  mediaId: string;
  /** From the message payload, so the bubble renders before status loads. */
  mode: ProtectionMode;
  maxViews: number | null;
  windowSeconds: number | null;
  expiryStart: ExpiryStart | null;
  isMine: boolean;
};

function statusLine(info: ProtectedMediaInfo | null, isMine: boolean): string {
  if (!info) return isMine ? 'Sent' : 'Tap to view';
  switch (info.status) {
    case 'EXHAUSTED':
      return isMine ? 'Opened · deleted' : 'Opened';
    case 'EXPIRED':
      return 'Expired';
    case 'REVOKED':
      return isMine ? 'You revoked it' : 'Removed by sender';
    case 'CAPTURE_REVOKED':
      return 'Screen capture · access removed';
    case 'ACTIVE':
      break;
  }
  if (info.mode === 'TIMED' && info.expiresAt) {
    const s = Math.max(0, Math.ceil((new Date(info.expiresAt).getTime() - Date.now()) / 1000));
    return isMine ? `Opened · ${s}s left` : `Tap to view · ${s}s left`;
  }
  if (info.remainingViews !== null) {
    if (isMine) return info.viewCount === 0 ? 'Not opened yet' : `Opened ${info.viewCount} of ${info.maxViews}`;
    return `Tap to view · ${info.remainingViews} ${info.remainingViews === 1 ? 'view' : 'views'} left`;
  }
  return isMine ? (info.viewCount ? `Opened ${info.viewCount}×` : 'Not opened yet') : 'Tap to view';
}

export function ProtectedMediaBubble(props: Props) {
  const { mediaId, isMine } = props;
  const [info, setInfo] = useState<ProtectedMediaInfo | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [, tick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const s = await getMediaStatus(mediaId);
      setInfo(s);
      if (!isMine && s.status !== 'ACTIVE') await forgetMediaKey(mediaId);
    } catch {
      // keep last known state
    }
  }, [mediaId, isMine]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Sender: check back every few seconds while the photo is still live, so views and
  // screenshots show up here without waiting for the next screen visit.
  const live = !info || info.status === 'ACTIVE';
  useEffect(() => {
    if (!isMine || !live) return;
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [isMine, live, refresh]);

  // Live countdown for timed photos.
  useEffect(() => {
    if (info?.mode !== 'TIMED' || !info.expiresAt || info.status !== 'ACTIVE') return;
    const t = setInterval(() => {
      tick((n) => n + 1);
      if (Date.now() >= new Date(info.expiresAt!).getTime()) void refresh();
    }, 1000);
    return () => clearInterval(t);
  }, [info, refresh]);

  const active = !info || info.status === 'ACTIVE';
  const canOpen = !isMine && active;
  const captured = info?.status === 'CAPTURE_REVOKED';
  const label = policyLabel(info ?? props);
  const line = statusLine(info, isMine);

  const Icon = captured ? Camera : props.mode === 'TIMED' ? Timer : active ? Eye : Lock;

  return (
    <>
      <Pressable
        onPress={() => (isMine ? setAuditOpen(true) : canOpen && setViewerOpen(true))}
        disabled={!isMine && !canOpen}
        accessibilityRole="button"
        accessibilityLabel={`Protected photo, ${label}. ${line}`}
        accessibilityHint={isMine ? 'Shows who opened it and when' : canOpen ? 'Opens the photo' : undefined}
        style={({ pressed }) => [
          styles.bubble,
          isMine ? styles.mine : styles.theirs,
          !active && (isMine ? styles.closedMine : styles.closedTheirs),
          pressed && { opacity: 0.85 },
        ]}
      >
        <View style={[styles.icon, isMine ? styles.iconMine : styles.iconTheirs, captured && { backgroundColor: C.danger }]}>
          <Icon size={20} color="#FFFFFF" strokeWidth={2} />
        </View>
        <View style={{ flexShrink: 1 }}>
          <Text style={[styles.title, isMine && { color: '#FFFFFF' }]}>Protected photo · {label}</Text>
          <Text style={[styles.sub, isMine && { color: '#DCE4FB' }]}>{line}</Text>
        </View>
      </Pressable>

      {!isMine && (
        <ProtectedMediaViewer
          mediaId={mediaId}
          visible={viewerOpen}
          onClose={() => {
            setViewerOpen(false);
            void refresh();
          }}
        />
      )}
      {isMine && (
        <AuditTrailSheet
          mediaId={mediaId}
          visible={auditOpen}
          onClose={() => {
            setAuditOpen(false);
            void refresh();
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 18,
    maxWidth: 300,
    minHeight: 56,
  },
  mine: { backgroundColor: C.accent, alignSelf: 'flex-end' },
  theirs: { backgroundColor: C.field, alignSelf: 'flex-start' },
  // A finished (opened, expired or deleted) photo is shown quieter by muting the bubble's colour, not by fading the
  // whole bubble: opacity also faded the text, which dropped it below readable contrast (3.1-3.9:1; these are 5.0+).
  closedMine: { backgroundColor: '#46598F' },
  closedTheirs: { backgroundColor: '#E9ECF3' },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  iconMine: { backgroundColor: 'rgba(255,255,255,0.2)' },
  iconTheirs: { backgroundColor: C.accent },
  title: { fontSize: 15, fontWeight: '600', color: C.text },
  sub: { fontSize: 13, color: C.muted, marginTop: 2 },
});
