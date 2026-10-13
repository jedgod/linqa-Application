// "Send protected photo" flow for the chat screen.
//
//   <ProtectedPhotoComposer
//     visible={open}
//     recipientId={otherUserId}
//     conversationId={chatId}
//     onSent={(payload) => linqaCore.sendStructured(chatId, payload)}   // your send function
//     onClose={() => setOpen(false)}
//   />

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { ImagePlus, Lock, X } from './icons';
import { COLORS as C } from '../../constants/theme';
import { DEFAULT_POLICIES, type ProtectionPolicy } from '../../lib/protectedMedia/policy';
import { discardPickedCopy, sendProtectedPhoto, type ProtectedMediaPayload } from '../../lib/protectedMedia/send';
import { PolicyPicker } from './PolicyPicker';

type Props = {
  visible: boolean;
  recipientId: string;
  conversationId: string;
  /** Send this payload as an end-to-end encrypted linqa-core message. */
  onSent: (payload: ProtectedMediaPayload) => void | Promise<void>;
  onClose: () => void;
};

type Picked = { uri: string; width: number; height: number };

export function ProtectedPhotoComposer({ visible, recipientId, conversationId, onSent, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [photo, setPhoto] = useState<Picked | null>(null);
  const [policy, setPolicy] = useState<ProtectionPolicy>(DEFAULT_POLICIES.MULTI_VIEW);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible) {
      if (photo) discardPickedCopy(photo.uri);
      setPhoto(null);
      setPolicy(DEFAULT_POLICIES.MULTI_VIEW);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photo access needed', 'Allow photo access in Settings to send a photo.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    if (photo) discardPickedCopy(photo.uri);
    setPhoto({ uri: a.uri, width: a.width, height: a.height });
  };

  const send = async () => {
    if (!photo || sending) return;
    setSending(true);
    try {
      const { payload } = await sendProtectedPhoto({ image: photo, recipientId, conversationId, policy });
      await onSent(payload);
      onClose();
    } catch (e) {
      Alert.alert('Could not send', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={8} style={styles.iconBtn}>
            <X size={22} color={C.text} strokeWidth={1.8} />
          </Pressable>
          <Text style={styles.title} accessibilityRole="header">
            Protected photo
          </Text>
          <View style={styles.iconBtn} />
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 20 }}>
          <Pressable
            onPress={() => void pick()}
            accessibilityRole="button"
            accessibilityLabel={photo ? 'Choose a different photo' : 'Choose a photo'}
            style={styles.photoBox}
          >
            {photo ? (
              <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="cover" accessibilityIgnoresInvertColors />
            ) : (
              <View style={styles.placeholder}>
                <ImagePlus size={32} color={C.accent} strokeWidth={1.8} />
                <Text style={styles.placeholderText}>Choose a photo</Text>
              </View>
            )}
          </Pressable>

          <PolicyPicker value={policy} onChange={setPolicy} />
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable
            onPress={() => void send()}
            disabled={!photo || sending}
            accessibilityRole="button"
            accessibilityState={{ disabled: !photo || sending }}
            style={({ pressed }) => [styles.sendBtn, (!photo || sending) && styles.sendDisabled, pressed && { opacity: 0.85 }]}
          >
            {sending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Lock size={18} color="#FFFFFF" strokeWidth={2} />
                <Text style={styles.sendText}>Encrypt and send</Text>
              </>
            )}
          </Pressable>
        </View>
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
    paddingHorizontal: 8,
    paddingTop: 12,
  },
  title: { fontSize: 17, fontWeight: '700', color: C.text },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  photoBox: { borderRadius: 18, overflow: 'hidden', backgroundColor: C.surface, height: 220 },
  preview: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  placeholderText: { fontSize: 15, fontWeight: '600', color: C.accent },
  footer: { paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: C.divider, backgroundColor: C.surface },
  sendBtn: {
    flexDirection: 'row',
    gap: 8,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { backgroundColor: '#9AA8CC' },
  sendText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
