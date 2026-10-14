// Tap a profile photo to see it larger, square and centred. Tap anywhere to close.

import React from 'react';
import { Image, Modal, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useAvatarImage } from './Avatar';

type Props = { uri: string | null | undefined; name: string; visible: boolean; onClose: () => void };

export function PhotoZoom({ uri, name, visible, onClose }: Props) {
  const { width, height } = useWindowDimensions();
  const { displayUri, onError } = useAvatarImage(visible ? uri : null);
  const side = Math.min(width - 48, height - 120, 520);
  return (
    <Modal visible={visible && !!displayUri} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={`Close ${name} photo`}>
        {displayUri ? (
          <Image
            source={{ uri: displayUri }}
            style={{ width: side, height: side, borderRadius: 14 }}
            resizeMode="cover"
            onError={onError}
            accessibilityLabel={`${name} profile photo`}
            accessibilityIgnoresInvertColors
          />
        ) : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(2,10,29,0.92)', alignItems: 'center', justifyContent: 'center' },
});
