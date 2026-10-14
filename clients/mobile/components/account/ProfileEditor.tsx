// Avatar + @username editor. Place <ProfileEditor name={...} /> at the top of
// your existing /account/manage screen, above the current account options.

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { COLORS as C } from '../../constants/theme';
import { useProfile } from '../../hooks/useProfile';
import {
  avatarUri,
  checkUsername,
  removeAvatar,
  updateUsername,
  uploadAvatar,
} from '../../lib/profileApi';
import { normalizeUsername, usernameFormatError, USERNAME_MAX } from '../../lib/username';
import { Avatar } from './Avatar';

type Status =
  | { kind: 'idle' }
  | { kind: 'invalid'; message: string }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken'; message: string }
  | { kind: 'error'; message: string };

type Props = {
  /** The account's display name, from wherever your app already gets it. */
  name: string;
};

export function ProfileEditor({ name }: Props) {
  const { profile, imageHeaders, loading, error, refresh, setProfile } = useProfile();

  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [savingName, setSavingName] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Load the saved username into the field once the profile arrives.
  useEffect(() => {
    setDraft(profile?.username ?? '');
  }, [profile?.username]);

  const current = profile?.username ?? '';
  const normalized = normalizeUsername(draft);
  const changed = normalized !== current;

  // Check format right away, then availability after the user pauses typing.
  useEffect(() => {
    abortRef.current?.abort();
    if (!changed) {
      setStatus({ kind: 'idle' });
      return;
    }
    const formatError = usernameFormatError(draft);
    if (formatError) {
      setStatus({ kind: 'invalid', message: formatError });
      return;
    }

    setStatus({ kind: 'checking' });
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(async () => {
      try {
        const res = await checkUsername(normalized, controller.signal);
        if (controller.signal.aborted) return;
        setStatus(
          res.available
            ? { kind: 'available' }
            : { kind: 'taken', message: res.reason ?? 'That username is taken.' },
        );
      } catch (e) {
        if (controller.signal.aborted) return;
        setStatus({ kind: 'error', message: 'Could not check right now. Try again.' });
      }
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft, normalized, changed]);

  const saveUsername = async () => {
    if (status.kind !== 'available') return;
    setSavingName(true);
    try {
      const updated = await updateUsername(normalized);
      await setProfile(updated);
      setStatus({ kind: 'idle' });
    } catch (e) {
      setStatus({ kind: 'taken', message: e instanceof Error ? e.message : 'Could not save.' });
    } finally {
      setSavingName(false);
    }
  };

  const pickPhoto = async () => {
    if (savingPhoto) return;
    setSavingPhoto(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Photo access needed', 'Allow photo access in Settings to choose a profile photo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      await setProfile(await uploadAvatar(asset.uri, asset.mimeType ?? 'image/jpeg'));
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSavingPhoto(false);
    }
  };

  const deletePhoto = async () => {
    setSavingPhoto(true);
    try {
      await setProfile(await removeAvatar());
    } catch (e) {
      Alert.alert('Could not remove photo', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSavingPhoto(false);
    }
  };

  const onPhotoPress = () => {
    if (!profile?.avatarUrl) {
      void pickPhoto();
      return;
    }
    Alert.alert('Profile photo', undefined, [
      { text: 'Choose new photo', onPress: () => void pickPhoto() },
      { text: 'Remove photo', style: 'destructive', onPress: () => void deletePhoto() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  if (!profile && loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  if (!profile && error) {
    return (
      <View style={styles.card}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={() => void refresh()} accessibilityRole="button" style={styles.retry}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const hint = statusText(status);

  return (
    <View style={styles.card}>
      {/* Avatar */}
      <Pressable
        onPress={onPhotoPress}
        disabled={savingPhoto}
        accessibilityRole="button"
        accessibilityLabel={profile?.avatarUrl ? 'Change or remove profile photo' : 'Add profile photo'}
        style={styles.avatarWrap}
      >
        <Avatar name={name} uri={avatarUri(profile?.avatarUrl)} headers={imageHeaders} size={96} />
        <View style={styles.cameraBadge}>
          {savingPhoto ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name="camera" size={16} color="#FFFFFF" />
          )}
        </View>
      </Pressable>
      <Text style={styles.name}>{name}</Text>
      <Pressable onPress={onPhotoPress} disabled={savingPhoto} accessibilityRole="button" style={styles.photoButton}>
        <Text style={styles.retryText}>{savingPhoto ? 'Uploading photo…' : profile?.avatarUrl ? 'Change profile photo' : 'Upload profile photo'}</Text>
      </Pressable>

      {/* Username */}
      <Text style={styles.label} nativeID="usernameLabel">
        Username
      </Text>
      <View style={[styles.field, hint?.tone === 'bad' && { borderColor: C.danger }]}>
        <Text style={styles.at}>@</Text>
        <TextInput
          value={draft}
          onChangeText={(t) => setDraft(t.replace(/^@+/, ''))}
          placeholder="choose_a_username"
          placeholderTextColor={C.muted}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          maxLength={USERNAME_MAX + 1}
          returnKeyType="done"
          onSubmitEditing={() => void saveUsername()}
          accessibilityLabelledBy="usernameLabel"
          accessibilityLabel="Username"
          style={styles.input}
        />
        {status.kind === 'checking' && <ActivityIndicator size="small" color={C.muted} />}
      </View>
      <Text
        style={[
          styles.hint,
          hint?.tone === 'good' && { color: C.success },
          hint?.tone === 'bad' && { color: C.danger },
        ]}
        accessibilityLiveRegion="polite"
      >
        {hint?.text ?? 'People can find you by your username. Your phone number stays private.'}
      </Text>

      <Pressable
        onPress={() => void saveUsername()}
        disabled={status.kind !== 'available' || savingName}
        accessibilityRole="button"
        accessibilityState={{ disabled: status.kind !== 'available' || savingName }}
        style={({ pressed }) => [
          styles.saveBtn,
          (status.kind !== 'available' || savingName) && styles.saveBtnDisabled,
          pressed && { opacity: 0.85 },
        ]}
      >
        {savingName ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.saveText}>{current ? 'Save username' : 'Claim username'}</Text>
        )}
      </Pressable>
    </View>
  );
}

function statusText(s: Status): { text: string; tone: 'good' | 'bad' | 'neutral' } | null {
  switch (s.kind) {
    case 'invalid':
    case 'taken':
    case 'error':
      return { text: s.message, tone: 'bad' };
    case 'checking':
      return { text: 'Checking…', tone: 'neutral' };
    case 'available':
      return { text: 'Available', tone: 'good' };
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 20,
    alignItems: 'stretch',
    gap: 6,
  },
  avatarWrap: { alignSelf: 'center', marginBottom: 6 },
  photoButton: { alignSelf: 'center', padding: 12, marginBottom: 8 },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.accent,
    borderWidth: 3,
    borderColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { textAlign: 'center', fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: C.muted },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: C.field,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: 2,
  },
  at: { fontSize: 16, color: C.muted, fontWeight: '600' },
  input: { flex: 1, fontSize: 16, color: C.text, paddingVertical: 10 },
  hint: { fontSize: 13, color: C.muted, minHeight: 18 },
  saveBtn: {
    marginTop: 10,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { backgroundColor: '#9AA8CC' },
  saveText: { color: C.accentText, fontSize: 16, fontWeight: '600' },
  errorText: { color: C.danger, textAlign: 'center' },
  retry: { alignSelf: 'center', padding: 12 },
  retryText: { color: C.accent, fontWeight: '600' },
});
