/**
 * Linqa Calls — Production Integration v2
 *
 * Place beside CallsHomeScreen.tsx and update its import path below.
 * This layer owns authenticated API access, refresh/pagination, call creation,
 * runtime permissions, idempotency, lifecycle-safe state and navigation.
 *
 * Required:
 *   npx expo install expo-av expo-device
 *   npm install @react-native-async-storage/async-storage
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
import CallsHomeScreen, {
  CallRecord,
  ScheduledCall,
} from "./Linqa_Calls_Home_Screen";

const API_BASE_URL = process.env.EXPO_PUBLIC_LINQA_API_URL;
const PAGE_SIZE = 25;

type ApiCall = {
  id: string;
  peer_name: string;
  peer_avatar_url?: string;
  peer_country?: string;
  peer_country_flag?: string;
  started_at: string;
  media: "audio" | "video" | "group";
  direction: "incoming" | "outgoing" | "missed";
  e2ee: boolean;
};

type CallPage = { items: ApiCall[]; next_cursor: string | null };
type ApiSchedule = {
  id: string;
  title: string;
  starts_at: string;
  participant_avatar_urls: string[];
  participant_count: number;
};

type Session = {
  accessToken: string;
  userId: string;
  profileAvatar?: string;
};

type Router = {
  push: (route: string, params?: Record<string, unknown>) => void;
  replace: (route: string, params?: Record<string, unknown>) => void;
};

type Props = { session: Session; router: Router };

class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

async function request<T>(
  session: Session,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!API_BASE_URL) throw new Error("EXPO_PUBLIC_LINQA_API_URL is not configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
        ...init.headers,
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(response.status, payload.message ?? "Request failed", payload.code);
    }
    return payload as T;
  } finally {
    clearTimeout(timer);
  }
}

const callsApi = {
  history: (session: Session, cursor?: string) =>
    request<CallPage>(
      session,
      `/v1/calls/history?limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  upcoming: (session: Session) => request<{ item: ApiSchedule | null }>(session, "/v1/calls/upcoming"),
  create: (
    session: Session,
    body: { peerId: string; media: "audio" | "video"; idempotencyKey: string },
  ) => request<{ callId: string; joinToken: string; expiresAt: string; callType: string; privacyMode: string }>(
    session,
    "/v1/calls/place",
    {
      method: "POST",
      headers: { "Idempotency-Key": body.idempotencyKey },
      body: JSON.stringify({ peerUserId: body.peerId, media: body.media.toUpperCase(), privacyMode: "RELAY_ONLY" }),
    },
  ),
  join: (session: Session, scheduledId: string, idempotencyKey: string) =>
    request<{ callId: string; joinToken: string; expiresAt: string; callType: string; privacyMode: string }>(
      session,
      `/v1/calls/scheduled/${encodeURIComponent(scheduledId)}/join-token`,
      { method: "POST", headers: { "Idempotency-Key": idempotencyKey } },
    ),
};

function relativeTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function mapCall(item: ApiCall): CallRecord {
  return {
    id: item.id,
    name: item.peer_name,
    avatar: item.peer_avatar_url,
    country: item.peer_country,
    flag: item.peer_country_flag,
    occurredAt: relativeTime(item.started_at),
    kind: item.media,
    direction: item.direction,
    encrypted: item.e2ee,
  };
}

function mapSchedule(item: ApiSchedule): ScheduledCall {
  return {
    id: item.id,
    title: item.title,
    displayTime: new Date(item.starts_at).toLocaleString([], {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }),
    participantAvatars: item.participant_avatar_urls,
    remainingParticipants: Math.max(0, item.participant_count - item.participant_avatar_urls.length),
  };
}

function idempotencyKey(action: string): string {
  return `${action}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

async function ensureMicrophonePermission(): Promise<boolean> {
  const current = await Audio.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) {
    Alert.alert("Microphone access required", "Enable microphone access in device settings to place calls.");
    return false;
  }
  const result = await Audio.requestPermissionsAsync();
  return result.granted;
}

function ActionSheet({
  visible,
  busy,
  onClose,
  onStart,
}: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onStart: (peerId: string, media: "audio" | "video") => void;
}) {
  const [peerId, setPeerId] = useState("");
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.sheetTitle}>Start a secure call</Text>
        <Text style={styles.sheetCopy}>Enter the resolved Linqa user ID. Replace this field with your contact picker.</Text>
        <TextInput
          value={peerId}
          onChangeText={setPeerId}
          placeholder="Linqa user ID"
          placeholderTextColor="#7180A3"
          autoCapitalize="none"
          style={styles.input}
        />
        <View style={styles.sheetActions}>
          <Pressable disabled={busy || !peerId.trim()} style={styles.action} onPress={() => onStart(peerId.trim(), "audio")}>
            <Text style={styles.actionText}>Audio call</Text>
          </Pressable>
          <Pressable disabled={busy || !peerId.trim()} style={[styles.action, styles.videoAction]} onPress={() => onStart(peerId.trim(), "video")}>
            {busy ? <ActivityIndicator color="white" /> : <Text style={styles.actionText}>Video call</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export default function CallsHomeContainer({ session, router }: Props) {
  const mounted = useRef(true);
  const actionLock = useRef(false);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [upcoming, setUpcoming] = useState<ScheduledCall>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setError(undefined);
    try {
      const [history, scheduled] = await Promise.all([
        callsApi.history(session),
        callsApi.upcoming(session),
      ]);
      if (!mounted.current) return;
      setCalls(history.items.map(mapCall));
      setCursor(history.next_cursor);
      setUpcoming(scheduled.item ? mapSchedule(scheduled.item) : undefined);
      await AsyncStorage.setItem("linqa.calls.cache", JSON.stringify(history.items));
    } catch (cause) {
      const cached = await AsyncStorage.getItem("linqa.calls.cache");
      if (cached && mounted.current) setCalls((JSON.parse(cached) as ApiCall[]).map(mapCall));
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Unable to load calls");
    } finally {
      if (mounted.current) { setLoading(false); setRefreshing(false); }
    }
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const listener = (state: AppStateStatus) => { if (state === "active") void load(true); };
    const subscription = AppState.addEventListener("change", listener);
    return () => subscription.remove();
  }, [load]);

  const beginCall = useCallback(async (peerId: string, media: "audio" | "video") => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      if (!(await ensureMicrophonePermission())) return;
      const created = await callsApi.create(session, {
        peerId,
        media,
        idempotencyKey: idempotencyKey(`create:${peerId}:${media}`),
      });
      setSheetOpen(false);
      router.push("CallSession", {
        callId: created.callId,
        roomToken: created.joinToken,
        media: created.callType.toLowerCase() === "video" ? "video" : "audio",
      });
    } catch (cause) {
      const message = cause instanceof ApiError && cause.status === 409
        ? "This call is already active."
        : cause instanceof Error ? cause.message : "Call could not start.";
      Alert.alert("Unable to start call", message);
    } finally {
      actionLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [router, session]);

  const joinScheduled = useCallback(async (scheduled: ScheduledCall) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      if (!(await ensureMicrophonePermission())) return;
      const joined = await callsApi.join(session, scheduled.id, idempotencyKey(`join:${scheduled.id}`));
      router.push("CallSession", { callId: joined.callId, roomToken: joined.joinToken, media: joined.callType.toLowerCase() === "video" ? "video" : "audio" });
    } catch (cause) {
      Alert.alert("Unable to join", cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      actionLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [router, session]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await callsApi.history(session, cursor);
      if (!mounted.current) return;
      setCalls((current) => {
        const unique = new Map(current.map((item) => [item.id, item]));
        page.items.map(mapCall).forEach((item) => unique.set(item.id, item));
        return [...unique.values()];
      });
      setCursor(page.next_cursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load more calls");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [cursor, loading, session]);

  if (loading && calls.length === 0) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#08C7F7" /><Text style={styles.loadingText}>Loading secure calls…</Text></View>;
  }

  return (
    <View style={styles.container}>
      <CallsHomeScreen
        calls={calls}
        scheduledCall={upcoming ?? null}
        profileAvatar={session.profileAvatar}
        onNewCall={() => setSheetOpen(true)}
        onSearch={() => router.push("CallSearch")}
        onOpenCalendar={() => router.push("CallCalendar")}
        onOpenProfile={() => router.push("Profile")}
        onScheduleCall={() => router.push("ScheduleCall")}
        onJoinScheduledCall={joinScheduled}
        onStartAudioCall={(call) => router.push("ContactCallOptions", { callId: call.id, media: "audio" })}
        onStartVideoCall={(call) => router.push("ContactCallOptions", { callId: call.id, media: "video" })}
        onOpenCallDetails={(call) => router.push("CallDetails", { callId: call.id })}
        onOpenAllCalls={() => void loadMore()}
        onNavigate={(route) => route !== "Calls" && router.replace(route)}
      />
      {error && (
        <Pressable style={styles.errorBanner} onPress={() => void load(true)}>
          <Text style={styles.errorText}>{error} · Tap to retry</Text>
        </Pressable>
      )}
      {refreshing && <View style={styles.refreshBadge}><ActivityIndicator color="#08C7F7" /></View>}
      <ActionSheet visible={sheetOpen} busy={busy} onClose={() => setSheetOpen(false)} onStart={beginCall} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#020B20" },
  center: { flex: 1, backgroundColor: "#020B20", alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: "#AAB6D5", fontSize: 14 },
  errorBanner: { position: "absolute", left: 16, right: 16, top: 76, padding: 11, borderRadius: 12, backgroundColor: "#5A2030", alignItems: "center" },
  errorText: { color: "#FFE5E9", fontSize: 12, fontWeight: "700" },
  refreshBadge: { position: "absolute", alignSelf: "center", top: 72, width: 40, height: 40, borderRadius: 20, backgroundColor: "#0C1934", alignItems: "center", justifyContent: "center" },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.65)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 22, paddingBottom: 36, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: "#091630", borderWidth: 1, borderColor: "#1D2A48" },
  handle: { width: 42, height: 4, borderRadius: 2, backgroundColor: "#516080", alignSelf: "center", marginBottom: 19 },
  sheetTitle: { color: "#F7FAFF", fontSize: 22, fontWeight: "800" },
  sheetCopy: { color: "#AAB6D5", fontSize: 13, lineHeight: 19, marginTop: 6 },
  input: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: "#2C3D63", backgroundColor: "#061027", color: "white", paddingHorizontal: 15, marginTop: 18 },
  sheetActions: { flexDirection: "row", gap: 11, marginTop: 14 },
  action: { flex: 1, height: 50, borderRadius: 14, backgroundColor: "#17325C", alignItems: "center", justifyContent: "center" },
  videoAction: { backgroundColor: "#1478FF" },
  actionText: { color: "white", fontSize: 15, fontWeight: "800" },
});

/**
 * Required server contract:
 * GET  /v1/calls/history?limit=25&cursor=...
 * GET  /v1/calls/upcoming
 * POST /v1/calls                         (Idempotency-Key required)
 * POST /v1/calls/scheduled/:id/join      (Idempotency-Key required)
 *
 * Security requirements:
 * - Server resolves the authenticated caller; never trust a client user_id.
 * - Room tokens must be short-lived, audience-bound and single-call scoped.
 * - Enforce block lists, contact policy, device trust and rate limits server-side.
 * - Store call metadata only; never log room tokens, SDP, ICE credentials or media.
 * - Camera permission belongs in CallSession and is requested only for video.
 */
