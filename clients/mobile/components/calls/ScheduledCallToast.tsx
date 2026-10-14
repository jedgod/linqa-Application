// "Your call is ready to join": a banner five minutes before a scheduled call starts, on any screen.
// Each call alerts once per app session. The server's join window decides whether Join works.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAccounts } from "../../account/AccountContext";
import { getApiBaseUrl } from "../../config/api";
import { CallsService, type ScheduledCall } from "../../services/calls.service";
import { ALERT_LEAD_MINUTES, joinScheduledCallNow, minutesUntil } from "../../services/scheduled-call-join";
import { accessTokenProvider } from "../../services/session";

const CHECK_EVERY_MS = 30_000;
const SHOW_FOR_MS = 12_000;
const alerted = new Set<string>();

export function ScheduledCallToast() {
  const { active, loaded } = useAccounts();
  const insets = useSafeAreaInsets();
  const [call, setCall] = useState<ScheduledCall | null>(null);
  const slide = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userId = active?.userId ?? null;

  const dismiss = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    Animated.timing(slide, { toValue: 0, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => setCall(null));
  }, [slide]);

  useEffect(() => {
    if (!loaded || !userId) return;
    alerted.clear();
    let alive = true;
    const service = new CallsService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken());
    const check = async () => {
      try {
        const rows = await service.listScheduled(20);
        const due = rows.find((r) => r.joinable && !alerted.has(r.id) && minutesUntil(r) <= ALERT_LEAD_MINUTES);
        if (!alive || !due) return;
        alerted.add(due.id);
        setCall(due);
        slide.setValue(0);
        Animated.timing(slide, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(dismiss, SHOW_FOR_MS);
      } catch { /* offline or signed out: try again on the next tick */ }
    };
    void check();
    const timer = setInterval(() => void check(), CHECK_EVERY_MS);
    return () => { alive = false; clearInterval(timer); if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [loaded, userId, slide, dismiss]);

  if (!call) return null;
  const who = call.isOrganizer ? call.participantNames.join(", ") : call.organizerName;
  const join = async () => {
    const target = call;
    dismiss();
    const problem = await joinScheduledCallNow(target);
    if (problem) Alert.alert("Call", problem);
  };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insets.top + 8, opacity: slide, transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }] }]}
    >
      <View style={styles.card} accessibilityLiveRegion="polite">
        <Ionicons name={call.callType === "VIDEO" ? "videocam" : "call"} size={24} color="#10D8EA" />
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={2}>Your call with {who || "your contact"} is ready to join</Text>
          <Pressable onPress={() => void join()} style={styles.join} accessibilityRole="button" accessibilityLabel="Join call now">
            <Text style={styles.joinText}>Join now</Text>
          </Pressable>
        </View>
        <Pressable onPress={dismiss} hitSlop={12} accessibilityRole="button" accessibilityLabel="Dismiss">
          <Ionicons name="close" size={20} color="#A6B4DC" />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12, zIndex: 1000, elevation: 20 },
  card: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14, borderRadius: 16, backgroundColor: "#0A1935", borderWidth: 1, borderColor: "#203357", shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  copy: { flex: 1 },
  title: { color: "#F7F9FF", fontSize: 14, fontWeight: "700", lineHeight: 19 },
  join: { alignSelf: "flex-start", marginTop: 10, backgroundColor: "#068BFF", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  joinText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
});
