import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { wallet, WalletHeader, WalletTabBar } from "../../components/wallet/theme";
import { getApiBaseUrl } from "../../config/api";
import { useAccounts } from "../../account/AccountContext";
import { accessTokenProvider } from "../../services/session";
import { looksSensitive, MAX_MESSAGE, sendSupportMessage, SupportChatError, supportChatMessage, SUGGESTIONS, type ChatMessage } from "../../services/wallet-support-chat";
import { fonts } from "../../theme/tokens";

let counter = 0;
const nextId = () => `m${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * Wallet support chat. Linqa AI answers questions about how the Wallet works. It is given only the conversation: no balance,
 * activity, recipients or account details, and it can't take any action. The conversation lives on this screen only and is gone
 * when it closes. Anything about a specific payment goes to Contact support.
 */
export default function WalletSupportChat() {
  const router = useRouter();
  const { active } = useAccounts();
  const userId = active?.userId;
  const owner = useRef(userId);
  owner.current = userId;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<{ code: string; text: string } | null>(null);
  const [warning, setWarning] = useState("");
  const scroll = useRef<ScrollView>(null);
  // While the keyboard is up the message box stays above it and the bottom tab bar steps aside, so typing is never hidden.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => { setTyping(true); setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50); });
    const hide = Keyboard.addListener("keyboardDidHide", () => setTyping(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // A different account never sees this account's conversation.
  useEffect(() => { setMessages([]); setInput(""); setProblem(null); setWarning(""); }, [userId]);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/wallet/more"));

  const ask = useCallback(async (conversation: ChatMessage[], failedId: string) => {
    setSending(true); setProblem(null);
    try {
      const reply = await sendSupportMessage({
        baseUrl: getApiBaseUrl(),
        getToken: async () => { if (!userId || owner.current !== userId) throw new Error("Sign in again to continue."); return accessTokenProvider.getAccessToken(); },
        messages: conversation
      });
      if (owner.current !== userId) return;
      setMessages((list) => [...list, { id: nextId(), role: "assistant", text: reply }]);
    } catch (error) {
      if (owner.current !== userId) return;
      const code = error instanceof SupportChatError ? error.code : "UNAVAILABLE";
      setMessages((list) => list.map((m) => (m.id === failedId ? { ...m, failed: true } : m)));
      setProblem({ code, text: supportChatMessage(code) });
    } finally { setSending(false); }
  }, [userId]);

  function send(raw: string) {
    const text = raw.trim();
    if (!text || sending) return;
    if (looksSensitive(text)) { setWarning(supportChatMessage("SENSITIVE_DATA")); return; }
    setWarning(""); setInput("");
    const message: ChatMessage = { id: nextId(), role: "user", text };
    const conversation = [...messages.filter((m) => !m.failed), message];
    setMessages([...messages, message]);
    void ask(conversation, message.id);
  }

  function retry(message: ChatMessage) {
    if (sending) return;
    const conversation = messages.map((m) => (m.id === message.id ? { ...m, failed: false } : m)).filter((m) => !m.failed);
    setMessages((list) => list.map((m) => (m.id === message.id ? { ...m, failed: false } : m)));
    void ask(conversation, message.id);
  }

  const empty = messages.length === 0;
  return (
    <Shell tabs={!typing}>
      <WalletHeader title="Linqa AI Support" onBack={goBack}>
        {!empty ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Start a new chat" hitSlop={8} onPress={() => { setMessages([]); setProblem(null); setWarning(""); }}>
            <Ionicons name="create-outline" size={20} color={wallet.teal} />
          </Pressable>
        ) : null}
      </WalletHeader>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView ref={scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          {empty ? (
            <View style={s.intro}>
              <View style={s.introIcon}><Ionicons name="sparkles" size={17} color={wallet.teal} /></View>
              <Text style={s.introTitle}>Ask Linqa AI</Text>
              <Text style={s.introCopy}>Quick answers about how the Wallet works: loading, sending, cashing out, fees, limits and reports.</Text>
              <View style={s.rules}>
                <Rule icon="eye-off-outline">It can't see your balance, activity or recipients.</Rule>
                <Rule icon="hand-left-outline">It can't send, cancel or change anything for you.</Rule>
                <Rule icon="lock-closed-outline">Never share passwords, PINs, codes or card numbers.</Rule>
              </View>
              <View style={s.chips}>
                {SUGGESTIONS.map((q) => (
                  <Pressable key={q} accessibilityRole="button" style={s.chip} onPress={() => send(q)}><Text style={s.chipText}>{q}</Text></Pressable>
                ))}
              </View>
            </View>
          ) : messages.map((m) => (
            <View key={m.id} style={[s.row, m.role === "user" && s.rowUser]}>
              <Pressable accessibilityRole={m.failed ? "button" : "text"} accessibilityHint={m.failed ? "Not sent. Double tap to try again." : undefined} disabled={!m.failed} onPress={() => retry(m)}
                style={[s.bubble, m.role === "user" ? s.bubbleUser : s.bubbleAi, m.failed && s.bubbleFailed]}>
                {m.role === "assistant" ? <Text style={s.who}>Linqa AI</Text> : null}
                <Text selectable style={[s.text, m.role === "user" && s.textUser]}>{m.text}</Text>
                {m.failed ? <Text style={s.failed}>Not sent. Tap to try again.</Text> : null}
              </Pressable>
            </View>
          ))}
          {sending ? <View style={s.row}><View style={[s.bubble, s.bubbleAi, s.typing]}><ActivityIndicator size="small" color={wallet.teal} /><Text style={s.typingText}>Linqa AI is typing…</Text></View></View> : null}
          {problem ? (
            <View accessibilityRole="alert" style={s.problem}>
              <Text style={s.problemText}>{problem.text}</Text>
              {problem.code === "AI_DISABLED" ? <Pressable accessibilityRole="button" style={s.problemAction} onPress={() => router.push("/settings/ai-privacy" as never)}><Text style={s.problemActionText}>Open AI privacy</Text></Pressable> : null}
              {["AI_NOT_CONFIGURED", "AI_UNAVAILABLE", "UNAVAILABLE"].includes(problem.code) ? <Pressable accessibilityRole="button" style={s.problemAction} onPress={() => router.push("/support" as never)}><Text style={s.problemActionText}>Contact support</Text></Pressable> : null}
            </View>
          ) : null}
        </ScrollView>

        <View style={s.composer}>
          {warning ? <Text accessibilityRole="alert" style={s.warning}>{warning}</Text> : null}
          <View style={s.inputRow}>
            <TextInput accessibilityLabel="Your question" value={input} onChangeText={(v) => { setInput(v); if (warning) setWarning(""); }} placeholder="Ask about the Wallet…" placeholderTextColor={wallet.faint}
              multiline maxLength={MAX_MESSAGE} style={s.input} editable={!sending} />
            <Pressable accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: sending || !input.trim() }} disabled={sending || !input.trim()} onPress={() => send(input)} style={[s.send, (sending || !input.trim()) && { opacity: 0.45 }]}>
              <Ionicons name="arrow-up" size={16} color={wallet.onTeal} />
            </Pressable>
          </View>
          <Text style={s.footer}>AI answers can be wrong. For a specific payment, <Text style={s.footerLink} onPress={() => router.push("/support" as never)}>contact support</Text>.</Text>
        </View>
      </KeyboardAvoidingView>
    </Shell>
  );
}

function Rule({ icon, children }: { icon: keyof typeof Ionicons.glyphMap; children: ReactNode }) {
  return <View style={s.rule}><Ionicons name={icon} size={13} color={wallet.muted} /><Text style={s.ruleText}>{children}</Text></View>;
}

function Shell({ children, tabs }: { children: ReactNode; tabs: boolean }) {
  return <SafeAreaView style={s.screen}><StatusBar style="light" />{children}{tabs ? <WalletTabBar active="more" /> : null}</SafeAreaView>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: wallet.bg },
  content: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10, gap: 8, flexGrow: 1 },
  intro: { alignItems: "flex-start", gap: 6, backgroundColor: wallet.card, borderColor: wallet.cardBorder, borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 4 },
  introIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: wallet.tealSoft, alignItems: "center", justifyContent: "center" },
  introTitle: { fontFamily: fonts.bold, fontSize: 14, color: wallet.text },
  introCopy: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16, color: wallet.muted },
  rules: { alignSelf: "stretch", gap: 4, marginTop: 2 },
  rule: { flexDirection: "row", alignItems: "center", gap: 8 },
  ruleText: { flex: 1, fontFamily: fonts.regular, fontSize: 10.5, lineHeight: 15, color: wallet.muted },
  chips: { alignSelf: "stretch", flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "flex-start", marginTop: 4 },
  chip: { borderWidth: 1, borderColor: wallet.tealDeep, borderRadius: 999, paddingHorizontal: 10, minHeight: 28, justifyContent: "center", backgroundColor: wallet.tealSoft },
  chipText: { fontFamily: fonts.medium, fontSize: 11, color: wallet.teal },
  row: { flexDirection: "row" },
  rowUser: { justifyContent: "flex-end" },
  bubble: { maxWidth: "86%", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, gap: 2 },
  bubbleUser: { backgroundColor: wallet.teal, borderBottomRightRadius: 4 },
  bubbleAi: { backgroundColor: wallet.card, borderColor: wallet.cardBorder, borderWidth: 1, borderBottomLeftRadius: 4 },
  bubbleFailed: { opacity: 0.7, borderWidth: 1, borderColor: wallet.danger },
  who: { fontFamily: fonts.bold, fontSize: 9.5, color: wallet.teal, letterSpacing: 0.4 },
  text: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: wallet.text },
  textUser: { color: wallet.onTeal, fontFamily: fonts.medium },
  failed: { fontFamily: fonts.medium, fontSize: 10.5, color: wallet.danger },
  typing: { flexDirection: "row", alignItems: "center", gap: 8 },
  typingText: { fontFamily: fonts.regular, fontSize: 11, color: wallet.muted },
  problem: { backgroundColor: wallet.card, borderColor: wallet.danger, borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
  problemText: { fontFamily: fonts.medium, fontSize: 11.5, lineHeight: 16, color: wallet.text },
  problemAction: { alignSelf: "flex-start", borderWidth: 1, borderColor: wallet.teal, borderRadius: 999, paddingHorizontal: 14, minHeight: 28, justifyContent: "center" },
  problemActionText: { fontFamily: fonts.semibold, fontSize: 11.5, color: wallet.teal },
  composer: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 6, gap: 4, borderTopWidth: 1, borderTopColor: wallet.cardBorder, backgroundColor: wallet.bg },
  warning: { fontFamily: fonts.medium, fontSize: 10.5, lineHeight: 15, color: wallet.danger },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: { flex: 1, maxHeight: 90, minHeight: 36, fontFamily: fonts.regular, fontSize: 12, color: wallet.text, backgroundColor: wallet.card, borderWidth: 1, borderColor: wallet.cardBorder, borderRadius: 14, paddingHorizontal: 12, paddingTop: 9, paddingBottom: 7 },
  send: { width: 36, height: 36, borderRadius: 18, backgroundColor: wallet.teal, alignItems: "center", justifyContent: "center" },
  footer: { fontFamily: fonts.regular, fontSize: 10, color: wallet.faint, textAlign: "center" },
  footerLink: { color: wallet.teal, fontFamily: fonts.semibold }
});
