import React, { useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { buildSharedAttachment, type SharedAttachment } from "../../services/shared-attachment";
import type { Theme } from "../../services/conversation-engine";
import { SubHeader } from "./SubHeader";

export function SharedAttachmentForm({ kind, theme: t, peerFirstName, onSend, onBack }: {
  kind: "LOCATION" | "CONTACT"; theme: Theme; peerFirstName: string;
  onSend: (payload: SharedAttachment) => Promise<unknown>; onBack: () => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const location = kind === "LOCATION";
  const inputs = location
    ? [["title", "Location label"], ["address", "Address (optional)"], ["latitude", "Latitude (-90 to 90)"], ["longitude", "Longitude (-180 to 180)"]]
    : [["title", "Contact name"], ["role", "Role (optional)"], ["phone", "Phone number"], ["handle", "Linqa handle"]];
  async function send() {
    if (sending.current) return;
    setError(null);
    try {
      const payload = buildSharedAttachment(kind, fields);
      sending.current = true; setBusy(true);
      const result = await onSend(payload);
      if (result === false) { setError("Couldn't share. Return to the chat to check the attachment and retry."); return; }
      onBack();
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't share. Please try again."); }
    finally { sending.current = false; setBusy(false); }
  }
  return <View style={{ flex: 1, backgroundColor: t.surface }}>
    <SubHeader theme={t} title={location ? "Share location" : "Share contact"} subtitle={`Shared with ${peerFirstName}, encrypted`} onBack={() => { if (!sending.current) onBack(); }} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 22, gap: 16 }}>
      <Text style={{ color: t.muted }}>{location ? "Enter a location pin to review and share. This does not track your live location." : "Enter only the contact details you want to share."}</Text>
      {inputs.map(([key, label]) => <View key={key} style={{ gap: 6 }}>
        <Text style={{ color: t.ink }}>{label}</Text>
        <TextInput accessibilityLabel={label} editable={!busy} value={fields[key] ?? ""} onChangeText={value => setFields(previous => ({ ...previous, [key]: value }))} maxLength={key === "address" ? 300 : 120} autoCapitalize={key === "handle" ? "none" : "sentences"} keyboardType={key === "phone" ? "phone-pad" : "default"} placeholderTextColor={t.muted} style={{ color: t.ink, borderColor: t.line, borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 48 }} />
      </View>)}
      {error ? <Text accessibilityRole="alert" style={{ color: t.warn }}>{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void send()} style={{ backgroundColor: t.accent, padding: 16, borderRadius: 14, alignItems: "center", opacity: busy ? 0.5 : 1 }}>
        <Text style={{ color: t.onAccent, fontWeight: "600" }}>{busy ? "Sharing…" : location ? "Share location pin" : "Share contact"}</Text>
      </Pressable>
    </ScrollView>
  </View>;
}
