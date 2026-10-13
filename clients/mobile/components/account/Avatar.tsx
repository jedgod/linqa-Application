// Round avatar: the user's photo when there is one, otherwise their initial.

import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../../constants/theme';

type Props = {
  name: string;
  uri?: string | null;
  headers?: Record<string, string>;
  size?: number;
};

export function Avatar({ name, uri, headers, size = 60 }: Props) {
  const [failed, setFailed] = useState(false);
  const round = { width: size, height: size, borderRadius: size / 2 };

  if (uri && !failed) {
    return (
      <Image
        source={{ uri, headers }}
        style={round}
        onError={() => setFailed(true)}
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
