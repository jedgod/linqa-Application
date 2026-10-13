import React, { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { Theme } from "../../services/conversation-engine";

export type ReportCategory = "HARASSMENT" | "IMPERSONATION" | "THREATS" | "SCAM" | "SEXUAL_CONTENT" | "HATE" | "MINOR_SAFETY" | "OTHER";
const CATEGORIES: Array<{ id: ReportCategory; label: string }> = [
  { id: "HARASSMENT", label: "Harassment" }, { id: "SCAM", label: "Scam or fraud" }, { id: "THREATS", label: "Threats" },
  { id: "IMPERSONATION", label: "Pretending to be someone" }, { id: "SEXUAL_CONTENT", label: "Sexual content" }, { id: "HATE", label: "Hate" },
  { id: "MINOR_SAFETY", label: "A child's safety" }, { id: "OTHER", label: "Something else" }
];

function Sheet({ visible, theme: t, title, onClose, children }: { visible: boolean; theme: Theme; title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,.4)" }}>
        <View style={{ backgroundColor: t.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, maxHeight: "85%" }}>
          <Text accessibilityRole="header" style={{ color: t.ink, fontSize: 20, fontWeight: "700", marginBottom: 12 }}>{title}</Text>
          {children}
        </View>
      </View>
    </Modal>
  );
}

const field = (t: Theme) => ({ color: t.ink, borderColor: t.line, borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 48, backgroundColor: t.background });
const primary = (t: Theme, enabled: boolean) => ({ minHeight: 48, borderRadius: 14, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: enabled ? t.accent : t.line });

/** Report the person (or group) in this chat. The text the person writes is the only thing sent; messages stay encrypted. */
export function ReportChatSheet({ visible, theme: t, title, onClose, onSend }: { visible: boolean; theme: Theme; title: string; onClose: () => void; onSend: (category: ReportCategory, description: string) => Promise<void> }) {
  const [category, setCategory] = useState<ReportCategory>("HARASSMENT");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const ok = text.trim().length >= 10 && !busy;
  const close = () => { setText(""); setError(null); setSent(false); setCategory("HARASSMENT"); onClose(); };
  const send = async () => {
    setBusy(true); setError(null);
    try { await onSend(category, text.trim()); setSent(true); } catch { setError("The report could not be sent. Try again."); } finally { setBusy(false); }
  };
  return (
    <Sheet visible={visible} theme={t} title={sent ? "Report sent" : title} onClose={close}>
      {sent ? (
        <>
          <Text style={{ color: t.muted, marginBottom: 16 }}>Thank you. Our safety team will review it. Messages are end-to-end encrypted, so only what you wrote here is shared.</Text>
          <Pressable accessibilityRole="button" onPress={close} style={primary(t, true)}><Text style={{ color: t.onAccent, fontWeight: "700" }}>Done</Text></Pressable>
        </>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled">
          <Text style={{ color: t.muted, marginBottom: 8 }}>What is wrong?</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {CATEGORIES.map((c) => (
              <Pressable key={c.id} accessibilityRole="radio" accessibilityState={{ selected: category === c.id }} onPress={() => setCategory(c.id)} style={{ paddingHorizontal: 12, minHeight: 40, borderRadius: 20, justifyContent: "center", borderWidth: 1, borderColor: category === c.id ? t.accent : t.line, backgroundColor: category === c.id ? t.highlight : "transparent" }}>
                <Text style={{ color: t.ink }}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput accessibilityLabel="What happened" value={text} onChangeText={(v) => { setText(v); setError(null); }} multiline maxLength={4000} placeholder="Tell us what happened (at least 10 characters)" placeholderTextColor={t.muted} style={[field(t), { minHeight: 96, textAlignVertical: "top" }]} />
          {error ? <Text accessibilityRole="alert" style={{ color: t.danger, marginTop: 8 }}>{error}</Text> : null}
          <Pressable accessibilityRole="button" disabled={!ok} onPress={() => void send()} style={[primary(t, ok), { marginTop: 14 }]}>
            {busy ? <ActivityIndicator color={t.onAccent} /> : <Text style={{ color: ok ? t.onAccent : t.muted, fontWeight: "700" }}>Send report</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" onPress={close} style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}><Text style={{ color: t.muted }}>Cancel</Text></Pressable>
        </ScrollView>
      )}
    </Sheet>
  );
}

export interface PickPerson { userId: string; name: string }

/** Pick people from the ones this person already chats with, for a new group or to add to one. */
export function PeopleSheet({ visible, theme: t, title, confirm, people, maxPick, askName, onClose, onConfirm }: {
  visible: boolean; theme: Theme; title: string; confirm: string; people: PickPerson[]; maxPick: number; askName?: boolean;
  onClose: () => void; onConfirm: (userIds: string[], name: string) => Promise<void>;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = chosen.length > 0 && (!askName || name.trim().length > 0) && !busy;
  const close = () => { setChosen([]); setName(""); setError(null); onClose(); };
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < maxPick ? [...c, id] : c));
  const go = async () => {
    setBusy(true); setError(null);
    try { await onConfirm(chosen, name.trim()); setChosen([]); setName(""); onClose(); }
    catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "NOT_A_CONTACT" ? "Groups can only include people you already chat with." : code === "GROUP_FULL" ? "That group is full." : code === "NOT_ALLOWED" ? "Only the person who made the group, or an admin, can add people." : "That did not work. Try again.");
    } finally { setBusy(false); }
  };
  return (
    <Sheet visible={visible} theme={t} title={title} onClose={close}>
      <ScrollView keyboardShouldPersistTaps="handled">
        {askName ? <TextInput accessibilityLabel="Group name" value={name} onChangeText={setName} maxLength={60} placeholder="Group name" placeholderTextColor={t.muted} style={[field(t), { marginBottom: 12 }]} /> : null}
        <Text style={{ color: t.muted, marginBottom: 6 }}>{`Choose up to ${maxPick} people`}</Text>
        {people.length === 0 ? <Text style={{ color: t.muted, paddingVertical: 12 }}>You have no one to add yet. Start a chat with someone first.</Text> : people.map((p) => {
          const on = chosen.includes(p.userId);
          return (
            <Pressable key={p.userId} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(p.userId)} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, borderBottomWidth: 1, borderBottomColor: t.line }}>
              <Text style={{ color: t.accent, fontSize: 22 }}>{on ? "☑" : "□"}</Text>
              <Text style={{ color: t.ink, fontSize: 16 }}>{p.name}</Text>
            </Pressable>
          );
        })}
        {error ? <Text accessibilityRole="alert" style={{ color: t.danger, marginTop: 8 }}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={!ok} onPress={() => void go()} style={[primary(t, ok), { marginTop: 14 }]}>
          {busy ? <ActivityIndicator color={t.onAccent} /> : <Text style={{ color: ok ? t.onAccent : t.muted, fontWeight: "700" }}>{confirm}</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" onPress={close} style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}><Text style={{ color: t.muted }}>Cancel</Text></Pressable>
      </ScrollView>
    </Sheet>
  );
}

export interface ForwardTarget { conversationId: string; title: string }

/** Pick the chats to send a message to (up to 5). The message is sealed again for each one; nothing is shared with anyone else. */
export function ForwardSheet({ visible, theme: t, targets, onClose, onConfirm }: {
  visible: boolean; theme: Theme; targets: ForwardTarget[]; onClose: () => void; onConfirm: (conversationIds: string[]) => Promise<void>;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { setChosen([]); setError(null); onClose(); };
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < 5 ? [...c, id] : c));
  const go = async () => {
    setBusy(true); setError(null);
    try { await onConfirm(chosen); setChosen([]); onClose(); } catch { setError("Some chats could not receive the message. Retry sends only to unfinished chats."); } finally { setBusy(false); }
  };
  const ok = chosen.length > 0 && !busy;
  return (
    <Sheet visible={visible} theme={t} title="Forward to" onClose={close}>
      <ScrollView keyboardShouldPersistTaps="handled">
        {targets.length === 0 ? <Text style={{ color: t.muted, paddingVertical: 12 }}>You have no other chats to forward to.</Text> : targets.map((c) => {
          const on = chosen.includes(c.conversationId);
          return (
            <Pressable key={c.conversationId} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(c.conversationId)} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, borderBottomWidth: 1, borderBottomColor: t.line }}>
              <Text style={{ color: t.accent, fontSize: 22 }}>{on ? "☑" : "□"}</Text>
              <Text style={{ color: t.ink, fontSize: 16 }}>{c.title}</Text>
            </Pressable>
          );
        })}
        {error ? <Text accessibilityRole="alert" style={{ color: t.danger, marginTop: 8 }}>{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={!ok} onPress={() => void go()} style={[primary(t, ok), { marginTop: 14 }]}>
          {busy ? <ActivityIndicator color={t.onAccent} /> : <Text style={{ color: ok ? t.onAccent : t.muted, fontWeight: "700" }}>{chosen.length > 1 ? `Forward to ${chosen.length} chats` : "Forward"}</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" onPress={close} style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}><Text style={{ color: t.muted }}>Cancel</Text></Pressable>
      </ScrollView>
    </Sheet>
  );
}
