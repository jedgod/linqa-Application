import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityActionEvent, Animated, BackHandler, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAccounts } from "../../account/AccountContext";
import { clampOffsets, DEFAULT_POSITION, isDrag, parsePosition, serializePosition, snapPosition, toOffsets, type FabPosition, type Offsets, type Size } from "../../services/fab-position";
import { fonts } from "../../theme/tokens";
import { M } from "./module-ui";

const MARGIN = 16;
export type FabAction = { label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void };

/**
 * A floating action button the person can drag anywhere on the screen. A tap runs `onPress`, or, when `actions` are given, opens a
 * small menu of quick actions beside the button (the "+" turns into "x" while it is open). Dragging moves it, and on release it
 * settles against the nearer side edge. Where it was left is remembered per screen and account. With `zoomOnFocus` it grows in
 * each time the screen becomes the active one. The button gives touch feedback by shrinking slightly while pressed. Screen readers
 * get "move to the left/right edge" actions instead of a drag.
 */
export function DraggableFab({ label, icon = "add", onPress, actions, storageKey, zoomOnFocus = false, disabled = false }: {
  label: string; icon?: keyof typeof Ionicons.glyphMap; onPress?: () => void; actions?: FabAction[]; storageKey: string; zoomOnFocus?: boolean; disabled?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { active } = useAccounts();
  const key = `linqa.fab.v1.${storageKey}.${active?.userId ?? "anon"}`.replace(/[^A-Za-z0-9._-]/g, "_");
  const [bounds, setBounds] = useState<Size | null>(null);
  const [fab, setFab] = useState<Size>({ w: 92, h: 36 });
  const [position, setPosition] = useState<FabPosition>(DEFAULT_POSITION);
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [menuAt, setMenuAt] = useState<Offsets | null>(null);
  const xy = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const scale = useRef(new Animated.Value(zoomOnFocus ? 0.4 : 1)).current;
  const press = useRef(new Animated.Value(1)).current;
  const menu = useRef(new Animated.Value(0)).current;
  const current = useRef<Offsets>({ x: 0, y: 0 });
  const startAt = useRef<Offsets>({ x: 0, y: 0 });
  const dragging = useRef(false);
  const geometry = useRef({ bounds, fab, inset: insets.bottom });
  geometry.current = { bounds, fab, inset: insets.bottom };
  const open = menuAt !== null;

  useEffect(() => {
    const id = xy.addListener((v) => { current.current = v; });
    return () => xy.removeListener(id);
  }, [xy]);

  // The saved spot. A missing or unreadable value just leaves the button in the default corner.
  useEffect(() => {
    let live = true;
    setLoaded(false);
    SecureStore.getItemAsync(key).then((v) => { const p = parsePosition(v); if (live && p) setPosition(p); }).catch(() => undefined).finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [key]);

  // Put the button where the stored position says, whenever the screen's size or the position changes.
  useEffect(() => {
    if (!bounds || !loaded) return;
    const o = toOffsets(position, bounds, fab, MARGIN, insets.bottom);
    if (dragging.current) return;
    if (!ready) { xy.setValue(o); setReady(true); return; }
    Animated.spring(xy, { toValue: o, useNativeDriver: false, friction: 8, tension: 90 }).start();
  }, [bounds, loaded, ready, fab, position, insets.bottom, xy]);

  // The grow-in plays when the button first appears, and again each time the screen becomes active.
  useEffect(() => {
    if (!ready || !zoomOnFocus) return;
    scale.setValue(0.4);
    Animated.spring(scale, { toValue: 1, friction: 5, tension: 140, useNativeDriver: false }).start();
  }, [ready, zoomOnFocus, scale]);

  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (!zoomOnFocus) return;
    if (first.current) { first.current = false; return; } // the first appearance is handled above
    scale.setValue(0.4);
    Animated.spring(scale, { toValue: 1, friction: 5, tension: 140, useNativeDriver: false }).start();
  }, [zoomOnFocus, scale]));

  const settle = useCallback((p: FabPosition) => {
    setPosition(p);
    SecureStore.setItemAsync(key, serializePosition(p)).catch(() => undefined);
  }, [key]);

  const closeMenu = useCallback(() => {
    Animated.timing(menu, { toValue: 0, duration: 120, useNativeDriver: false }).start(() => setMenuAt(null));
  }, [menu]);
  const openMenu = () => {
    setMenuAt({ ...current.current });
    Animated.spring(menu, { toValue: 1, friction: 7, tension: 140, useNativeDriver: false }).start();
  };
  // The phone's Back button closes the menu first.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { closeMenu(); return true; });
    return () => sub.remove();
  }, [open, closeMenu]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponderCapture: (_e, g) => isDrag(g.dx, g.dy),
    onPanResponderGrant: () => { dragging.current = true; xy.stopAnimation(); startAt.current = { ...current.current }; },
    onPanResponderMove: (_e, g) => {
      const { bounds: b, fab: f, inset } = geometry.current;
      if (!b) return;
      xy.setValue(clampOffsets({ x: startAt.current.x + g.dx, y: startAt.current.y + g.dy }, b, f, MARGIN, inset));
    },
    onPanResponderRelease: () => {
      dragging.current = false;
      const { bounds: b, fab: f, inset } = geometry.current;
      if (b) settle(snapPosition(current.current, b, f, MARGIN, inset));
    },
    onPanResponderTerminate: () => {
      dragging.current = false;
      const { bounds: b, fab: f, inset } = geometry.current;
      if (b) settle(snapPosition(current.current, b, f, MARGIN, inset));
    }
  }), [xy, settle]);

  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === "moveLeft") settle({ ...position, side: "left" });
    if (e.nativeEvent.actionName === "moveRight") settle({ ...position, side: "right" });
  };

  const squeeze = (to: number) => Animated.spring(press, { toValue: to, friction: 6, tension: 220, useNativeDriver: false }).start();
  const spin = menu.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "45deg"] });

  // The menu opens above the button when it is in the lower half of the screen, below it otherwise, on the button's own side.
  const above = !bounds || !menuAt || menuAt.y + fab.h / 2 > bounds.h / 2;
  const sideStyle = position.side === "left" ? { left: MARGIN, alignItems: "flex-start" as const } : { right: MARGIN, alignItems: "flex-end" as const };
  const placement = menuAt && bounds ? (above ? { bottom: bounds.h - menuAt.y + 8 } : { top: menuAt.y + fab.h + 8 }) : null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={(e) => setBounds({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {open ? <Pressable accessibilityRole="button" accessibilityLabel="Close menu" style={s.scrim} onPress={closeMenu} /> : null}
      {open && placement && actions ? (
        <Animated.View style={[s.menu, sideStyle, placement, { opacity: menu, transform: [{ translateY: menu.interpolate({ inputRange: [0, 1], outputRange: [above ? 10 : -10, 0] }) }] }]}>
          {(above ? [...actions].reverse() : actions).map((a) => (
            <Pressable key={a.label} accessibilityRole="button" accessibilityLabel={a.label} onPress={() => { closeMenu(); a.onPress(); }} style={({ pressed }) => [s.item, pressed && { backgroundColor: M.cardAlt }]}>
              <Ionicons name={a.icon} size={16} color={M.accent} />
              <Text style={s.itemText}>{a.label}</Text>
            </Pressable>
          ))}
        </Animated.View>
      ) : null}
      <Animated.View {...pan.panHandlers} pointerEvents={ready ? "auto" : "none"} style={[s.mover, { opacity: ready ? 1 : 0, transform: xy.getTranslateTransform() }]} onLayout={(e) => setFab({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        <Animated.View style={{ transform: [{ scale }, { scale: press }] }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={actions ? { expanded: open } : undefined}
            accessibilityHint={actions ? "Opens quick actions. This button can be moved: use the actions to move it to the left or right edge." : "Double tap to open. This button can be moved: use the actions to move it to the left or right edge."}
            accessibilityActions={[{ name: "moveLeft", label: "Move to left edge" }, { name: "moveRight", label: "Move to right edge" }]}
            onAccessibilityAction={onAccessibilityAction}
            disabled={disabled}
            onPressIn={() => squeeze(0.9)}
            onPressOut={() => squeeze(1)}
            onPress={() => { if (actions) { if (open) closeMenu(); else openMenu(); } else onPress?.(); }}
            style={[s.fab, disabled && { opacity: 0.5 }]}
          >
            <Animated.View style={{ transform: [{ rotate: spin }] }}><Ionicons name={icon} size={16} color={M.text} /></Animated.View>
            <Text style={s.text}>{label}</Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  mover: { position: "absolute", left: 0, top: 0 },
  fab: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: M.accent, borderRadius: 999, paddingHorizontal: 12, minHeight: 36, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  text: { fontFamily: fonts.bold, fontSize: 12.5, color: M.text },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.35)" },
  menu: { position: "absolute", gap: 6 },
  item: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: M.card, borderWidth: 1, borderColor: M.border, borderRadius: 999, paddingHorizontal: 14, minHeight: 36 },
  itemText: { fontFamily: fonts.semibold, fontSize: 12.5, color: M.text }
});
