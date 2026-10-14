// Round avatar: the user's photo when there is one, otherwise their initial.

import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../../constants/theme';
import { API_URL, getAuthToken } from '../../lib/profileApi';
import { bytesToBase64 } from '../../services/secure-core';
import { accountScopeGeneration } from '../../services/account-scope';

type Props = {
  name: string;
  uri?: string | null;
  headers?: Record<string, string>;
  size?: number;
};

export function useAvatarImage(uri?: string | null, headers?: Record<string, string>) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState<{ source: string; data: string } | null>(null);
  const authorization = headers?.Authorization;
  const privateAvatar = !!uri && uri.startsWith(`${API_URL}/v1/profile/`);
  useEffect(() => {
    setFailed(false);
    setLoaded(null);
    if (!uri || !privateAvatar) return;
    const generation = accountScopeGeneration();
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await getAuthToken();
        if (!token || controller.signal.aborted || generation !== accountScopeGeneration()) return;
        const response = await fetch(uri, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok) throw new Error('Avatar unavailable');
        const mime = response.headers.get('content-type')?.split(';')[0];
        if (!mime || !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('Invalid avatar');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('Invalid avatar size');
        const data = `data:${mime};base64,${bytesToBase64(bytes)}`;
        bytes.fill(0);
        if (!controller.signal.aborted && generation === accountScopeGeneration()) setLoaded({ source: uri, data });
      } catch {
        if (!controller.signal.aborted && generation === accountScopeGeneration()) setFailed(true);
      }
    })();
    return () => controller.abort();
  }, [uri, authorization, privateAvatar]);
  const displayUri = privateAvatar ? (loaded?.source === uri ? loaded.data : null) : uri;
  return { displayUri: failed ? null : displayUri, privateAvatar, onError: () => setFailed(true) };
}

export function Avatar({ name, uri, headers, size = 60 }: Props) {
  const { displayUri, privateAvatar, onError } = useAvatarImage(uri, headers);
  const round = { width: size, height: size, borderRadius: size / 2 };

  if (displayUri) {
    return (
      <Image
        source={{ uri: displayUri, ...(privateAvatar ? {} : { headers }) }}
        style={round}
        onError={onError}
        accessibilityLabel={`${name} profile photo`}
        accessibilityIgnoresInvertColors
      />
    );
  }

  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <View style={[round, styles.fallback]} accessibilityLabel={`${name} profile photo`}>
      <Text style={[styles.initial, { fontSize: size * 0.4 }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: COLORS.avatarBg, alignItems: 'center', justifyContent: 'center' },
  initial: { color: '#FFFFFF', fontWeight: '700' },
});
