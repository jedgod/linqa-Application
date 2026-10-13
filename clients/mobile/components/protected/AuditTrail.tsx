// Audit trail sheet for a protected photo: who did what, when, plus an
// integrity check of the server's hash chain. Also hosts the sender's Revoke button.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShieldAlert, ShieldCheck, X } from './icons';
import { COLORS as C } from '../../constants/theme';
import { getAuditTrail, revokeMedia, type AuditEvent, type AuditTrail as Trail } from '../../lib/protectedMedia/api';
import { policyLabel } from '../../lib/protectedMedia/policy';

const LABELS: Record<string, string> = {
  CREATED: 'Sent',
  VIEW_GRANTED: 'Opened',
  BLOB_DELIVERED: 'Photo delivered',
  VIEW_ENDED: 'Closed',
  ACCESS_DENIED: 'Tried to open (denied)',
  SCREENSHOT_DETECTED: 'Screenshot detected',
  SCREEN_RECORDING_DETECTED: 'Screen recording detected',
  EXHAUSTED: 'All views used',
  EXPIRED: 'Expired',
  REVOKED_BY_SENDER: 'Revoked by sender',
  CAPTURE_REVOKED: 'Access removed after capture',
  BLOB_DELETED: 'Encrypted file deleted from server',
};

const ALARM = new Set(['SCREENSHOT_DETECTED', 'SCREEN_RECORDING_DETECTED', 'CAPTURE_REVOKED', 'ACCESS_DENIED']);

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function eventLine(e: AuditEvent): string {
  const who = e.actor === 'sender' ? 'You' : e.actor === 'recipient' ? 'Recipient' : 'System';
  const parts = [who];
  if (e.viewNumber) parts.push(`view ${e.viewNumber}`);
  const d = e.detail ?? {};
  if (typeof d.platform === 'string') parts.push(d.platform);
  if (typeof d.reason === 'string') parts.push(d.reason);
  if (typeof d.durationMs === 'number') parts.push(`${Math.round(d.durationMs / 1000)}s on screen`);
  return parts.join(' · ');
}

type Props = { mediaId: string; visible: boolean; onClose: () => void };

export function AuditTrailSheet({ mediaId, visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [trail, setTrail] = useState<Trail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setTrail(await getAuditTrail(mediaId));
    } catch {
      setError('Could not load the activity log.');
    }
  }, [mediaId]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const confirmRevoke = () => {
    Alert.alert('Revoke this photo?', 'It will be deleted from the server and can no longer be opened.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          setRevoking(true);
          try {
            await revokeMedia(mediaId);
            await load();
          } catch {
            Alert.alert('Could not revoke', 'Please try again.');
          } finally {
            setRevoking(false);
          }
        },
      },
    ]);
  };

  const m = trail?.media;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            Photo activity
          </Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={styles.iconBtn}>
            <X size={22} color={C.text} strokeWidth={1.8} />
          </Pressable>
        </View>

        {!trail && !error && <ActivityIndicator style={{ marginTop: 40 }} color={C.accent} />}
        {error && <Text style={styles.error}>{error}</Text>}

        {trail && m && (
          <FlatList
            data={trail.events}
            keyExtractor={(e) => String(e.seq)}
            contentContainerStyle={{ padding: 16, gap: 8 }}
            ListHeaderComponent={
              <View style={{ gap: 10, marginBottom: 8 }}>
                <View style={styles.summary}>
                  <Text style={styles.summaryTitle}>{policyLabel(m)}</Text>
                  <Text style={styles.summaryText}>
                    Status: {m.status.replace('_', ' ').toLowerCase()} · opened {m.viewCount}
                    {m.maxViews !== null ? ` of ${m.maxViews}` : ''} {m.viewCount === 1 ? 'time' : 'times'}
                  </Text>
                </View>
                <View style={[styles.integrity, !trail.integrity.valid && styles.integrityBad]}>
                  {trail.integrity.valid ? (
                    <ShieldCheck size={18} color={C.success} strokeWidth={2} />
                  ) : (
                    <ShieldAlert size={18} color={C.danger} strokeWidth={2} />
                  )}
                  <Text style={[styles.integrityText, { color: trail.integrity.valid ? C.success : C.danger }]}>
                    {trail.integrity.valid
                      ? 'Log verified: no entries changed or removed'
                      : `Log failed verification at entry ${trail.integrity.brokenAtSeq}`}
                  </Text>
                </View>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.event}>
                <View style={[styles.dot, ALARM.has(item.type) && { backgroundColor: C.danger }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.eventTitle, ALARM.has(item.type) && { color: C.danger }]}>
                    {LABELS[item.type] ?? item.type}
                  </Text>
                  <Text style={styles.eventMeta}>{eventLine(item)}</Text>
                </View>
                <Text style={styles.eventTime}>{formatTime(item.at)}</Text>
              </View>
            )}
            ListFooterComponent={
              m.role === 'sender' && m.status === 'ACTIVE' ? (
                <Pressable
                  onPress={confirmRevoke}
                  disabled={revoking}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.revoke, pressed && { opacity: 0.85 }]}
                >
                  {revoking ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.revokeText}>Revoke photo now</Text>}
                </Pressable>
              ) : null
            }
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  title: { fontSize: 20, fontWeight: '700', color: C.text },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  error: { color: C.danger, textAlign: 'center', marginTop: 40 },
  summary: { backgroundColor: C.surface, borderRadius: 16, padding: 16, gap: 4 },
  summaryTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  summaryText: { fontSize: 14, color: C.muted },
  integrity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#E8F5EE',
  },
  integrityBad: { backgroundColor: '#FDECEA' },
  integrityText: { flex: 1, fontSize: 13, fontWeight: '600' },
  event: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 12,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent, marginTop: 6 },
  eventTitle: { fontSize: 15, fontWeight: '600', color: C.text },
  eventMeta: { fontSize: 13, color: C.muted, marginTop: 2 },
  eventTime: { fontSize: 12, color: C.muted },
  revoke: {
    marginTop: 12,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: C.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  revokeText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
