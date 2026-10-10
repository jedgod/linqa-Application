/**
 * Thread sheet + settings extensions.
 * Attachment sheet opens from the composer. Settings owns feature toggles,
 * background, and block/unblock.
 */
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { THREAD_ACTIONS, type ThreadAction } from "./thread-actions";
import { firstName } from "./settings-model";

export type ChatBackground = "CANVAS" | "MIST" | "FOREST" | "INK";

export const BACKGROUNDS: Record<ChatBackground, string> = {
  CANVAS: "#e7edf1",
  MIST: "#f4f1ea",
  FOREST: "#e5f0ec",
  INK: "#121820",
};

export function AttachmentSheet(props: {
  enabled: ThreadAction[];
  onPick: (action: ThreadAction) => void;
  onClose: () => void;
}) {
  const items = THREAD_ACTIONS.filter((item) => props.enabled.includes(item.id));
  return (
    <View style={styles.sheet}>
      <View style={styles.handle} />
      <Text style={styles.sheetTitle}>Add to chat</Text>
      <View style={styles.grid}>
        {items.map((item) => (
          <Pressable key={item.id} style={styles.cell} onPress={() => props.onPick(item.id)}>
            <View style={styles.icon}><Text style={styles.iconText}>{item.label.slice(0, 1)}</Text></View>
            <Text style={styles.cellLabel}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={props.onClose}><Text style={styles.close}>Close</Text></Pressable>
    </View>
  );
}

export function ThreadSettingsScreen(props: {
  displayName: string;
  enabled: ThreadAction[];
  background: ChatBackground;
  blocked: boolean;
  onToggleFeature: (action: ThreadAction, on: boolean) => void;
  onBackground: (background: ChatBackground) => void;
  onBlock: () => void;
  onUnblock: () => void;
  onBack: () => void;
}) {
  const name = firstName(props.displayName);
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={props.onBack} hitSlop={12}><Text style={styles.back}>‹</Text></Pressable>
        <Text style={styles.title}>Chat features</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>Add features</Text>
        <View style={styles.card}>
          {THREAD_ACTIONS.map((item) => (
            <View key={item.id} style={styles.row}>
              <View style={styles.copy}>
                <Text style={styles.rowTitle}>{item.label}</Text>
                <Text style={styles.hint}>{item.needsConsent ? "Asks before sharing" : "Available in the composer"}</Text>
              </View>
              <Switch
                value={props.enabled.includes(item.id)}
                onValueChange={(on) => props.onToggleFeature(item.id, on)}
              />
            </View>
          ))}
        </View>

        <Text style={styles.section}>Change background</Text>
        <View style={styles.bgRow}>
          {(Object.keys(BACKGROUNDS) as ChatBackground[]).map((id) => (
            <Pressable
              key={id}
              onPress={() => props.onBackground(id)}
              style={[styles.bg, { backgroundColor: BACKGROUNDS[id] }, props.background === id && styles.bgOn]}
            >
              <Text style={styles.bgLabel}>{id === "CANVAS" ? "Canvas" : id === "MIST" ? "Mist" : id === "FOREST" ? "Forest" : "Ink"}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.card}>
          {props.blocked ? (
            <Pressable onPress={props.onUnblock}><Text style={styles.unblock}>Unblock {name}</Text></Pressable>
          ) : (
            <Pressable onPress={props.onBlock}><Text style={styles.danger}>Block {name}</Text></Pressable>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

export function PollComposer(props: {
  question: string;
  options: string[];
  onQuestion: (value: string) => void;
  onOption: (index: number, value: string) => void;
  onSend: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.rowTitle}>Poll</Text>
      <TextInput value={props.question} onChangeText={props.onQuestion} placeholder="Ask a question" style={styles.input} />
      {props.options.map((option, index) => (
        <TextInput
          key={index}
          value={option}
          onChangeText={(value) => props.onOption(index, value)}
          placeholder={`Option ${index + 1}`}
          style={styles.input}
        />
      ))}
      <Pressable style={styles.send} onPress={props.onSend}><Text style={styles.sendText}>Send poll</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#d5dde5", marginBottom: 10 },
  sheetTitle: { fontSize: 16, fontWeight: "700", color: "#1c2430", marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "25%", alignItems: "center", marginBottom: 14 },
  icon: { width: 48, height: 48, borderRadius: 16, backgroundColor: "#e7f3ef", alignItems: "center", justifyContent: "center" },
  iconText: { color: "#1f6b52", fontWeight: "700" },
  cellLabel: { marginTop: 6, fontSize: 11, color: "#1c2430", textAlign: "center" },
  close: { textAlign: "center", color: "#5f6b76", padding: 8 },
  screen: { flex: 1, backgroundColor: "#eef2f5" },
  header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14, backgroundColor: "#fff" },
  back: { fontSize: 28, color: "#243041" },
  title: { fontSize: 20, fontWeight: "700", color: "#1c2430" },
  body: { padding: 16, paddingBottom: 32 },
  section: { color: "#5f6b76", marginBottom: 8 },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 14, marginBottom: 14 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8 },
  copy: { flex: 1, paddingRight: 8 },
  rowTitle: { fontSize: 16, fontWeight: "600", color: "#1c2430" },
  hint: { color: "#6d7c8a", fontSize: 12, marginTop: 2 },
  bgRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  bg: { flex: 1, height: 64, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#e1e7ee" },
  bgOn: { borderColor: "#1f6b52", borderWidth: 2 },
  bgLabel: { fontSize: 12, color: "#1c2430" },
  danger: { color: "#b42318", fontWeight: "700", fontSize: 16 },
  unblock: { color: "#1f6b52", fontWeight: "700", fontSize: 16 },
  input: { borderWidth: 1, borderColor: "#e1e7ee", borderRadius: 12, padding: 10, marginTop: 8 },
  send: { marginTop: 12, backgroundColor: "#1f6b52", borderRadius: 20, alignItems: "center", paddingVertical: 10 },
  sendText: { color: "#fff", fontWeight: "700" },
});
