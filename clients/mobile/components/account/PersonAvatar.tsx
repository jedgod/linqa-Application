// A person's round avatar: their Linqa profile photo when they have one, their initials otherwise.
// Pass a userId to look the photo up (the server only serves it to people connected to them), or a ready
// photoUri when the screen already has the versioned link.

import React from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { API_URL } from '../../lib/profileApi';
import { useAvatarImage } from './Avatar';

export const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join('') || '?';

type Props = {
  name: string;
  userId?: string | null;
  photoUri?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
  textColor?: string;
  backgroundColor?: string;
};

export function PersonAvatar({ name, userId, photoUri, size = 44, style, textColor = '#FFFFFF', backgroundColor = '#3A2BB0' }: Props) {
  const uri = photoUri ?? (userId ? `${API_URL}/v1/profile/${encodeURIComponent(userId)}/avatar` : null);
  const { displayUri, onError } = useAvatarImage(uri);
  const round = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View style={[styles.base, round, { backgroundColor }, style]} accessible accessibilityLabel={`${name} profile photo`} accessibilityRole="image">
      <Text style={{ color: textColor, fontSize: size * 0.38, fontWeight: '600' }}>{initialsOf(name)}</Text>
      {displayUri ? (
        <Image source={{ uri: displayUri }} style={[StyleSheet.absoluteFill, round]} resizeMode="cover" onError={onError} accessibilityIgnoresInvertColors />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
