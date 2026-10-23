import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useWorkspace } from "../services/use-workspace";
import type { PrivacyControls } from "../services/workspace.service";

type Audience = PrivacyControls["profileVisibility"];
const AUDIENCES: Array<[Audience, string]> = [["EVERYONE", "Everyone"], ["CONTACTS", "Contacts"], ["NOBODY", "Nobody"]];
const TOGGLES: Array<[keyof Pick<PrivacyControls, "readReceipts" | "typingIndicators" | "phoneDiscoverability" | "emailDiscoverability" | "usernameDiscoverability">, string, string]> = [
  ["readReceipts", "Read receipts", "Let people see when you've read their messages."],
  ["typingIndicators", "Typing indicators", "Let people see when you're typing."],
  ["phoneDiscoverability", "Find me by phone number", "People who have your number can find you."],
  ["emailDiscoverability", "Find me by email", "People who have your email can find you."],
  ["usernameDiscoverability", "Find me by username", "People can find you by searching your username."]
];

/**
 * The privacy settings the account already stores (audience for your profile and last seen, receipts, typing, and who can find
 * you). A change is saved straight away and put back if saving fails, so the switches always show what is really saved.
 */
export function PrivacyControlsSection() {
  const ws = useWorkspace();
  const [controls, setControls] = useState<PrivacyControls | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const run = useRef(0);

  useEffect(() => {
    if (!ws) return;
    const mine = ++run.current;
    setControls(null); setError("");
    ws.privacyControls().then((c) => { if (mine === run.current) setControls(c); }).catch(() => { if (mine === run.current) setError("Couldn't load your privacy controls."); });
    return () => { run.current++; };
  }, [ws]);

  async function change(next: PrivacyControls) {
    if (!ws || !controls || saving) return;
    const previous = controls;
    setControls(next); setSaving(true); setError("");
    try { await ws.savePrivacyControls(next); }
    catch { setControls(previous); setError("Couldn't save that change. Nothing was changed."); }
    finally { setSaving(false); }
  }

  const Audience = ({ label, field }: { label: string; field: "profileVisibility" | "lastSeenVisibility" }) => (
    <View style={s.item}>
      <Text style={s.title}>{label}</Text>
      <View style={s.segments}>
        {AUDIENCES.map(([value, text]) => {
          const on = controls![field] === value;
          return (
            <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: on, disabled: saving }} disabled={saving} style={[s.segment, on && s.segmentOn]} onPress={() => void change({ ...controls!, [field]: value })}>
              <Text style={[s.segmentText, on && s.segmentTextOn]}>{text}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Privacy controls</Text>
      {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
      {!controls ? (error ? null : <Text style={s.muted}>Loading…</Text>) : (
        <>
          <Audience label="Who can see my profile" field="profileVisibility" />
          <Audience label="Who can see when I was last online" field="lastSeenVisibility" />
          {TOGGLES.map(([field, title, help]) => (
            <View key={field} style={[s.item, s.row]}>
              <View style={{ flex: 1 }}><Text style={s.title}>{title}</Text><Text style={s.muted}>{help}</Text></View>
              <Switch accessibilityLabel={title} value={controls[field]} disabled={saving} onValueChange={(v) => void change({ ...controls, [field]: v })} trackColor={{ true: "#12D6AE" }} />
            </View>
          ))}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  section: { marginTop: 18 },
  sectionTitle: { color: "#6F889A", fontSize: 12, fontWeight: "800", letterSpacing: 1, marginBottom: 8 },
  item: { backgroundColor: "#082536", borderWidth: 1, borderColor: "#17445A", borderRadius: 15, padding: 12, marginBottom: 8, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { color: "#EFF7FC", fontSize: 14, fontWeight: "800" },
  muted: { color: "#718A9C", fontSize: 12, marginTop: 2 },
  error: { color: "#FF8B97", fontSize: 12, marginBottom: 8 },
  segments: { flexDirection: "row", gap: 6 },
  segment: { flex: 1, minHeight: 36, borderRadius: 10, borderWidth: 1, borderColor: "#17445A", backgroundColor: "#061E2C", alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: "#12D6AE", borderColor: "#12D6AE" },
  segmentText: { color: "#9BB0BF", fontSize: 12.5, fontWeight: "700" },
  segmentTextOn: { color: "#00212A" }
});
