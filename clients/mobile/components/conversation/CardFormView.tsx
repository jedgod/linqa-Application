import React, { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { Payload, Theme } from "../../services/conversation-engine";
import { buildCardPayload, defaultCardForm, type CardForm } from "../../services/conversation-thread";
import { SubHeader } from "./SubHeader";
import { radius, space, type } from "./theme";

interface Props {
  theme: Theme;
  kind: "EVENT" | "MEETING";
  peerFirstName: string;
  /** Resolves true when the card was sealed and sent. */
  onSend: (payload: Payload) => Promise<boolean>;
  onBack: () => void;
}

/** A small form for an event or a meeting. The date and time are read in the phone's own time zone. */
export function CardFormView({ theme: t, kind, peerFirstName, onSend, onBack }: Props) {
  const meeting = kind === "MEETING";
  const [form, setForm] = useState<CardForm>(() => defaultCardForm());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const set = (patch: Partial<CardForm>) => setForm((old) => ({ ...old, ...patch }));

  async function submit() {
    if (sending.current) return;
    const built = buildCardPayload(kind, form);
    if (!built.ok) { setError(built.error); return; }
    sending.current = true;
    setError(null); setBusy(true);
    try {
      if (await onSend(built.payload)) onBack();
      else setError("Couldn't send it. Check your connection and try again.");
    } catch { setError("Couldn't send it. Check your connection and try again."); }
    finally { sending.current = false; setBusy(false); }
  }

  const field = (label: string, value: string, onChange: (v: string) => void, extra: { placeholder?: string; keyboard?: "default" | "numeric"; max?: number } = {}) => (
    <View style={styles.field}>
      <Text style={[type.meta, { color: t.muted }]}>{label}</Text>
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={extra.placeholder} placeholderTextColor={t.muted} keyboardType={extra.keyboard ?? "default"} maxLength={extra.max ?? 120} autoCapitalize="sentences" style={[type.body, styles.input, { color: t.ink, backgroundColor: t.surface, borderColor: t.line }]} />
    </View>
  );

  return (
    <View style={[styles.fill, { backgroundColor: t.background }]}>
      <SubHeader theme={t} title={meeting ? "Schedule meeting" : "New event"} subtitle={`Shared with ${peerFirstName}, encrypted`} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {field("Title", form.title, (title) => set({ title }), { placeholder: meeting ? "Site walkthrough" : "Team dinner" })}
        <View style={styles.row}>
          <View style={{ flex: 1.4 }}>{field("Date (YYYY-MM-DD)", form.date, (date) => set({ date }), { max: 10 })}</View>
          <View style={{ flex: 1 }}>{field("Time (24 h)", form.time, (time) => set({ time }), { max: 5 })}</View>
        </View>
        {meeting ? field("Length in minutes", form.durationMinutes, (durationMinutes) => set({ durationMinutes: durationMinutes.replace(/\D/g, "") }), { keyboard: "numeric", max: 3 }) : field("Place (optional)", form.place, (place) => set({ place }), { placeholder: "Where is it?" })}
        {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[type.body, { color: t.danger }]}>{error}</Text> : null}
        <Text style={[type.meta, { color: t.muted }]}>It is sealed on your phone before it is sent, so only you and {peerFirstName} can read it.</Text>
      </ScrollView>
      <View style={styles.footer}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void submit()} style={[styles.send, { backgroundColor: t.outgoing }]}>
          <Text style={[type.title, { color: t.onOutgoing }]}>{busy ? "Sending…" : meeting ? "Share meeting" : "Share event"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: space.l, gap: space.m },
  row: { flexDirection: "row", gap: space.m },
  field: { gap: space.xs },
  input: { borderWidth: 1, borderRadius: radius.control, paddingHorizontal: space.l, paddingVertical: space.s + 2, minHeight: 48 },
  footer: { padding: space.l },
  send: { minHeight: 54, borderRadius: 16, alignItems: "center", justifyContent: "center" }
});
