import React, { useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { validatePayload, type Payload, type Theme } from "../../services/conversation-engine";
import type { DecisionSummary } from "../../services/conversation-state";
import { radius, space, type } from "./theme";
import { SubHeader } from "./SubHeader";

interface Props {
  theme: Theme;
  peerName: string;
  peerFirstName: string;
  /** Voting and creating are only possible while secure messaging is live. */
  live: boolean;
  decisions: { open: DecisionSummary[]; decided: DecisionSummary[] };
  onVote: (decisionId: string, choice: number) => void;
  onCreate: (payload: Payload) => Promise<boolean>;
  onBack: () => void;
  /** Open with the new-decision form already showing (from the ✦ menu). */
  startCreating?: boolean;
}

/** Decisions shared in this conversation: Open (someone still has to vote) and Decided (both have). */
export function DecisionsView({ theme: t, peerName, peerFirstName, live, decisions, onVote, onCreate, onBack, startCreating }: Props) {
  const [tab, setTab] = useState<"open" | "decided">("open");
  const [creating, setCreating] = useState(Boolean(startCreating));
  const [title, setTitle] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [busy, setBusy] = useState(false);
  const sharing = useRef(false);
  const list = tab === "open" ? decisions.open : decisions.decided;

  async function share() {
    if (!live || sharing.current) return;
    sharing.current = true;
    setBusy(true);
    try {
      const payload = validatePayload({ type: "decision", title: title.trim(), options: options.map((o) => o.trim()) });
      if (await onCreate(payload)) { setCreating(false); setTitle(""); setOptions(["", ""]); setTab("open"); }
      else Alert.alert("Unable to share decision", "Check your connection and try again.");
    } catch (cause) { Alert.alert("Check your decision", cause instanceof Error ? cause.message : "Invalid decision"); }
    finally { sharing.current = false; setBusy(false); }
  }

  const tabButton = (key: "open" | "decided", label: string, count: number) => (
    <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={[styles.tab, tab === key && { borderBottomColor: t.accent }]}>
      <Text style={[type.body, { color: tab === key ? t.accent : t.muted, fontWeight: "600" }]}>{label} ({count})</Text>
    </Pressable>
  );

  return (
    <View style={[styles.fill, { backgroundColor: t.background }]}>
      <SubHeader theme={t} title="Decisions" subtitle={`Shared with ${peerName}, encrypted`} centered onBack={onBack} />
      <View style={[styles.tabs, { backgroundColor: t.surface, borderBottomColor: t.line }]}>{tabButton("open", "Open", decisions.open.length)}{tabButton("decided", "Decided", decisions.decided.length)}</View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!live ? (
          <View style={[styles.card, { backgroundColor: t.warnSurface }]}>
            <Text style={[type.body, { color: "#302342", fontWeight: "600" }]}>Decisions are sealed on this device</Text>
            <Text style={[type.meta, { color: "#302342", marginTop: 2 }]}>They open, and you can vote and add new ones, once secure messaging is available.</Text>
          </View>
        ) : null}

        {creating && live ? (
          <View style={[styles.card, { backgroundColor: t.surface }]}>
            <TextInput accessibilityLabel="Decision title" placeholder="What are you deciding?" placeholderTextColor={t.muted} maxLength={200} value={title} onChangeText={setTitle} style={[type.body, styles.input, { color: t.ink, backgroundColor: t.background }]} />
            {options.map((o, i) => <TextInput key={i} accessibilityLabel={`Option ${i + 1}`} placeholder={`Option ${i + 1}`} placeholderTextColor={t.muted} maxLength={100} value={o} onChangeText={(v) => setOptions((old) => old.map((x, j) => (j === i ? v : x)))} style={[type.body, styles.input, { color: t.ink, backgroundColor: t.background }]} />)}
            <View style={styles.row}>
              {options.length < 5 ? <Pressable accessibilityRole="button" onPress={() => setOptions((old) => [...old, ""])} style={[styles.small, { borderColor: t.line }]}><Text style={[type.meta, { color: t.ink, fontWeight: "600" }]}>Add option</Text></Pressable> : null}
              <Pressable accessibilityRole="button" onPress={() => setCreating(false)} style={[styles.small, { borderColor: t.line }]}><Text style={[type.meta, { color: t.muted, fontWeight: "600" }]}>Cancel</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={busy || !live} accessibilityState={{ disabled: busy || !live }} onPress={() => void share()} style={[styles.small, { backgroundColor: t.accent, borderColor: t.accent }]}><Text style={[type.meta, { color: t.onAccent, fontWeight: "700" }]}>{busy ? "Sharing…" : "Share"}</Text></Pressable>
            </View>
          </View>
        ) : null}

        {live && list.length === 0 && !creating ? (
          <Text style={[type.body, { color: t.muted, textAlign: "center", marginTop: space.xl }]}>{tab === "open" ? "Nothing to decide right now." : "No decisions have been settled yet."}</Text>
        ) : null}

        {live ? list.map((d) => (
          <View key={d.id} style={[styles.card, { backgroundColor: t.surface }]}>
            <Text accessibilityRole="header" style={[type.title, { color: t.ink, fontSize: 19 }]}>{d.title}</Text>
            <Text style={[type.body, { color: t.muted, marginTop: 2, marginBottom: space.s }]}>
              {d.decided && d.winner !== null ? `Decided: ${d.options[d.winner]}` : d.status}
            </Text>
            {d.options.map((option, i) => {
              const chosenByMe = d.mine === i;
              const chosenByThem = d.theirs === i;
              return (
                <Pressable
                  key={i}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: chosenByMe, disabled: d.decided }}
                  accessibilityLabel={`${option}${chosenByMe ? ", your vote" : ""}${chosenByThem ? `, ${peerFirstName}'s vote` : ""}`}
                  disabled={d.decided}
                  onPress={() => onVote(d.id, i)}
                  style={[styles.option, i > 0 && { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }]}
                >
                  <View style={[styles.radio, { borderColor: chosenByMe ? t.accent : t.line, backgroundColor: chosenByMe ? t.accent : "transparent" }]}>
                    {chosenByMe ? <Ionicons name="checkmark" size={18} color={t.onAccent} /> : null}
                  </View>
                  <Text style={[type.body, { color: t.ink, flex: 1 }]}>{option}</Text>
                  {chosenByMe ? <Text style={[type.body, { color: t.accent, fontWeight: "600" }]}>You</Text> : chosenByThem ? <Text style={[type.body, { color: t.muted }]}>{peerFirstName}</Text> : null}
                  {chosenByMe && chosenByThem ? <Text style={[type.body, { color: t.muted, marginLeft: space.s }]}>{peerFirstName}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        )) : null}
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: t.background }]}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: !live }} disabled={!live} onPress={() => setCreating(true)} style={[styles.newButton, { backgroundColor: live ? t.accent : t.line }]}>
          <Text style={[type.title, { color: live ? t.onAccent : t.muted }]}>New decision</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  tabs: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: "center", paddingVertical: space.m, borderBottomWidth: 3, borderBottomColor: "transparent" },
  content: { padding: space.l, gap: space.m },
  card: { borderRadius: radius.bubble, padding: space.l, gap: 2 },
  option: { flexDirection: "row", alignItems: "center", gap: space.m, minHeight: 56 },
  radio: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  input: { paddingHorizontal: space.l, paddingVertical: space.s + 2, borderRadius: radius.control, minHeight: 44, marginBottom: space.s },
  row: { flexDirection: "row", gap: space.s, flexWrap: "wrap" },
  small: { paddingHorizontal: space.l, minHeight: 38, borderRadius: radius.control, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  footer: { padding: space.l },
  newButton: { minHeight: 54, borderRadius: 16, alignItems: "center", justifyContent: "center" }
});
