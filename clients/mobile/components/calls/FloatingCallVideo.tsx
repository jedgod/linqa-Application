import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, Pressable, StyleSheet } from "react-native";
import { clampVideoPosition, initialVideoPosition, videoTileSize, type VideoBounds } from "./video-layout";

export function DoubleTapVideo({ children, onSwap, resetKey }: { children: React.ReactNode; onSwap?: () => void; resetKey?: number }) {
  const lastTap = useRef<number | null>(null);
  useEffect(() => { lastTap.current = null; }, [resetKey]);
  const onPress = () => {
    const now = Date.now();
    if (lastTap.current !== null && now - lastTap.current <= 300) { lastTap.current = null; onSwap?.(); }
    else lastTap.current = now;
  };
  return <Pressable style={styles.fill} onPress={onSwap ? onPress : undefined}
    accessible={!!onSwap} accessibilityRole={onSwap ? "button" : undefined}
    accessibilityLabel="Swap large and small videos" accessibilityHint="Double tap the video to swap views."
    accessibilityActions={onSwap ? [{ name: "activate", label: "Swap videos" }] : undefined}
    onAccessibilityAction={() => onSwap?.()}>{children}</Pressable>;
}

/** Position belongs to the measured video stage, keeping the tile clear of call controls. */
export function FloatingCallVideo({ children, bounds, minimized, onSwap }: {
  children: React.ReactNode; bounds: VideoBounds; minimized?: boolean; onSwap?: () => void;
}) {
  const size = minimized ? Math.min(44, videoTileSize(bounds)) : videoTileSize(bounds);
  const position = useRef(initialVideoPosition(bounds, size));
  const origin = useRef(position.current);
  const initialized = useRef(false);
  const [dragVersion, setDragVersion] = useState(0);
  const offset = useRef(new Animated.ValueXY(position.current)).current;
  const current = useRef({ bounds, size });
  current.current = { bounds, size };
  useEffect(() => {
    if (!bounds.width || !bounds.height) return;
    position.current = initialized.current ? clampVideoPosition(position.current, bounds, size) : initialVideoPosition(bounds, size);
    initialized.current = true;
    offset.setValue(position.current);
  }, [bounds.width, bounds.height, size, offset]);
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6,
    onPanResponderGrant: () => { origin.current = position.current; setDragVersion(value => value + 1); },
    onPanResponderMove: (_, gesture) => {
      const { bounds: stage, size: side } = current.current;
      position.current = clampVideoPosition({ x: origin.current.x + gesture.dx, y: origin.current.y + gesture.dy }, stage, side);
      offset.setValue(position.current);
    },
    onPanResponderTerminationRequest: () => false,
  }), [offset]);
  if (!bounds.width || !bounds.height) return null;
  return <Animated.View {...responder.panHandlers} style={[styles.tile, { width: size, height: size, borderRadius: minimized ? size / 2 : 18, transform: offset.getTranslateTransform() }]}>
    <DoubleTapVideo onSwap={onSwap} resetKey={dragVersion}>{children}</DoubleTapVideo>
  </Animated.View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  tile: { position: "absolute", left: 0, top: 0, overflow: "hidden", backgroundColor: "#25282F", borderWidth: 1, borderColor: "#ffffff30", zIndex: 5, elevation: 5 },
});
