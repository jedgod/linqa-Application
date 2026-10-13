// Animated side drawer for the Linqa Chats screen.
//
// Opens:  onOpen() from the hamburger button, or a right swipe from the left edge.
// Closes: tap the dimmed overlay, swipe the drawer left, Android back button,
//         or the parent calling onClose() (close button, tapping a menu row).

import React, { useEffect } from 'react';
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { DRAWER_COLORS } from './drawerItems';

type Props = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** The drawer panel content, usually <DrawerMenu />. */
  drawerContent: React.ReactNode;
  /** The screen behind the drawer (your Chats page). */
  children: React.ReactNode;
  /** Width of the invisible strip on the left edge that accepts the open swipe. */
  edgeWidth?: number;
};

const MAX_WIDTH = 320;

export function SideDrawer({
  open,
  onOpen,
  onClose,
  drawerContent,
  children,
  edgeWidth = 20,
}: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const drawerWidth = Math.min(Math.round(screenWidth * 0.8), MAX_WIDTH);

  const reduceMotion = useReducedMotion();
  const timing = { duration: reduceMotion ? 0 : 260, easing: Easing.out(Easing.cubic) };

  // 0 = fully open, -drawerWidth = fully closed.
  const offset = useSharedValue(-drawerWidth);
  const dragStart = useSharedValue(0);

  // Animate whenever the parent flips `open` (or the screen width changes).
  useEffect(() => {
    offset.value = withTiming(open ? 0 : -drawerWidth, timing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, drawerWidth, reduceMotion]);

  // Android hardware back closes the drawer instead of leaving the screen.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [open, onClose]);

  // Swipe the open drawer to the left to close it.
  const closePan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onStart(() => {
      dragStart.value = offset.value;
    })
    .onUpdate((e) => {
      offset.value = Math.min(0, Math.max(-drawerWidth, dragStart.value + e.translationX));
    })
    .onEnd((e) => {
      const shouldClose = offset.value < -drawerWidth * 0.35 || e.velocityX < -600;
      offset.value = withTiming(shouldClose ? -drawerWidth : 0, timing);
      if (shouldClose) runOnJS(onClose)();
    });

  // Swipe right from the left screen edge to open it.
  const openPan = Gesture.Pan()
    .enabled(!open)
    .activeOffsetX(12)
    .failOffsetY([-15, 15])
    .onUpdate((e) => {
      offset.value = Math.min(0, Math.max(-drawerWidth, -drawerWidth + e.translationX));
    })
    .onEnd((e) => {
      const shouldOpen = offset.value > -drawerWidth * 0.65 || e.velocityX > 600;
      offset.value = withTiming(shouldOpen ? 0 : -drawerWidth, timing);
      if (shouldOpen) runOnJS(onOpen)();
    });

  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(offset.value, [-drawerWidth, 0], [0, 1], Extrapolation.CLAMP),
  }));

  return (
    <View style={styles.root}>
      {/* Screen behind the drawer. Hidden from screen readers while the menu is open. */}
      <View
        style={styles.root}
        importantForAccessibility={open ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={open}
      >
        {children}
      </View>

      {/* Edge strip that catches the open swipe. Only present while closed. */}
      {!open && (
        <GestureDetector gesture={openPan}>
          <View style={[styles.edge, { width: edgeWidth }]} collapsable={false} />
        </GestureDetector>
      )}

      {/* Dim overlay. Tapping it closes the drawer. */}
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]}
        pointerEvents={open ? 'auto' : 'none'}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
        />
      </Animated.View>

      {/* The drawer panel. */}
      <GestureDetector gesture={closePan}>
        <Animated.View
          style={[styles.drawer, { width: drawerWidth }, drawerStyle]}
          accessibilityViewIsModal={open}
          accessibilityLabel="Main menu"
        >
          {drawerContent}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  edge: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  overlay: { backgroundColor: DRAWER_COLORS.overlay },
  drawer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: DRAWER_COLORS.surface,
    borderTopRightRadius: 24,
    borderBottomRightRadius: 24,
    // No overflow:'hidden' here: it would clip the iOS shadow.
    // DrawerMenu rounds its own header corner instead.
    // iOS shadow
    shadowColor: '#0C101C',
    shadowOffset: { width: 8, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    // Android shadow
    elevation: 16,
  },
});
