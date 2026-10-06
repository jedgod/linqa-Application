import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { WorldScreen, world } from "../../components/countrylinqa/WorldUI";
import { getApiBaseUrl } from "../../config/api";
import { confirmCountryRoute, chatAccessOutcome, type ChatAccessOutcome } from "../../services/countrylinqa-activation";
import { ChatStartError, startDirectChat } from "../../services/countrylinqa-world";
import { accessTokenProvider } from "../../services/session";
import { fonts } from "../../theme/tokens";

const CHECKS = ["Existing conversation?", "Blocked / restricted?", "Country allowed?", "Chat access policy?"];

/**
 * 7. Chat Access Result. Tapping Message lands here. The server runs the CountryLinqa access check
 * (existing conversation, blocks and restrictions, country, the person's chat setting) and this screen
 * shows the answer: open the chat, or "Chat unavailable" and stay on Linqa World. Reasons are kept
 * general on purpose, so this never reveals whether someone blocked you or what their settings are.
 */
export default function CountryLinqaChatAccess() {
  const router = useRouter();
  const { userId, name } = useLocalSearchParams<{ userId?: string; name?: string }>();
  const [state, setState] = useState<{ kind: "CHECKING" } | { kind: "ALLOWED"; conversationId: string } | ChatAccessOutcome>({ kind: "CHECKING" });
  const started = useRef(false);

  const run = useCallback(async () => {
    if (!userId) { setState(chatAccessOutcome("USER_NOT_FOUND")); return; }
    setState({ kind: "CHECKING" });
    try {
      const conversationId = await startDirectChat(getApiBaseUrl(), () => accessTokenProvider.getAccessToken(), userId);
      setState({ kind: "ALLOWED", conversationId });
    } catch (cause) {
      setState(chatAccessOutcome(cause instanceof ChatStartError ? cause.code : "NETWORK"));
    }
  }, [userId]);
  useEffect(() => { if (started.current) return; started.current = true; void run(); }, [run]);

  const open = useCallback((conversationId: string) => router.replace({ pathname: "/modules/conversation", params: { conversationId } }), [router]);
  // Allowed: show the checks passing for a moment, then open the conversation.
  useEffect(() => {
    if (state.kind !== "ALLOWED") return;
    const timer = setTimeout(() => open(state.conversationId), 900);
    return () => clearTimeout(timer);
  }, [state, open]);

  const leave = () => (router.canGoBack() ? router.back() : router.replace("/countrylinqa/world"));
  const passed = state.kind === "ALLOWED";

  return (
    <WorldScreen>
      <View style={s.body} accessibilityLiveRegion="polite">
        {state.kind === "CHECKING" || state.kind === "ALLOWED" ? (
          <>
            <Text style={s.heading}>CountryLinqa Access Check</Text>
            <View style={s.checks}>
              {CHECKS.map((label) => (
                <View key={label} style={s.check}>
                  {passed ? <Ionicons name="checkmark" size={20} color="#12A150" /> : <ActivityIndicator size="small" color={world.purple} />}
                  <Text style={s.checkText}>{label}</Text>
                </View>
              ))}
            </View>
            {passed ? (
              <>
                <View style={[s.icon, { backgroundColor: "#E3F0FF" }]}><Ionicons name="chatbubble-ellipses" size={48} color="#2F7BEA" /></View>
                <Text style={s.title}>Opening conversation…</Text>
                <Text style={s.text}>{name ? `With ${name}` : "In your main Linqa chats"}</Text>
                <Pressable accessibilityRole="button" style={s.btn} onPress={() => open((state as { conversationId: string }).conversationId)}><Text style={s.btnText}>Go to Chat</Text></Pressable>
              </>
            ) : <Text style={s.text}>Checking whether you can message {name || "this person"}…</Text>}
          </>
        ) : (
          <>
            <View style={[s.icon, { backgroundColor: "#E5484D" }]}><Ionicons name={state.kind === "RETRY" ? "cloud-offline" : "close"} size={52} color="#FFFFFF" /></View>
            <Text style={s.title}>{state.title}</Text>
            <Text style={s.text}>{state.message}</Text>
            <View style={s.actions}>
              {state.kind === "RETRY" ? <Pressable accessibilityRole="button" style={s.btn} onPress={() => void run()}><Text style={s.btnText}>Try Again</Text></Pressable> : null}
              {state.kind === "VERIFY" ? <Pressable accessibilityRole="button" style={s.btn} onPress={() => router.replace(confirmCountryRoute("/countrylinqa/world"))}><Text style={s.btnText}>Confirm Country</Text></Pressable> : null}
              <Pressable accessibilityRole="button" style={state.kind === "UNAVAILABLE" ? s.btn : s.btnSecondary} onPress={leave}><Text style={state.kind === "UNAVAILABLE" ? s.btnText : s.btnSecondaryText}>OK</Text></Pressable>
            </View>
          </>
        )}
      </View>
    </WorldScreen>
  );
}

const s = StyleSheet.create({
  body: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, gap: 12 },
  heading: { color: world.purple, fontFamily: fonts.extrabold, fontSize: 20 },
  checks: { alignSelf: "stretch", borderRadius: 16, borderWidth: 1, borderColor: world.border, padding: 16, gap: 12, marginVertical: 8 },
  check: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 28 },
  checkText: { color: world.text, fontFamily: fonts.medium, fontSize: 15 },
  icon: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center", marginTop: 8 },
  title: { color: world.text, fontFamily: fonts.extrabold, fontSize: 22, textAlign: "center" },
  text: { color: world.muted, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: "center" },
  actions: { alignSelf: "stretch", gap: 10, marginTop: 18 },
  btn: { alignSelf: "stretch", height: 52, borderRadius: 14, backgroundColor: world.purple, alignItems: "center", justifyContent: "center", marginTop: 6 },
  btnText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 16 },
  btnSecondary: { height: 52, borderRadius: 14, backgroundColor: "#F1EEFF", alignItems: "center", justifyContent: "center" },
  btnSecondaryText: { color: world.purple, fontFamily: fonts.bold, fontSize: 16 }
});
