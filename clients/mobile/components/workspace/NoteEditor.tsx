import { useEffect, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { dictationAvailable, startDictation } from "../../services/dictation";
import { MAX_NOTE_BODY, NOTE_CATEGORIES, noteKind, parseTags, type Attachment, type ChecklistItem, type NoteContent } from "../../services/workspace-model";
import { fonts } from "../../theme/tokens";
import { DrawingPad } from "./DrawingPad";
import { Banner, Chip, M, ModuleScreen, moduleStyles } from "./module-ui";

export type EditorState = { id: string | null; draft: NoteContent; tags: string; original: string };

/** Everything that decides whether an editor has unsaved changes. */
export const editorSnapshot = (n: NoteContent, tags: string) => JSON.stringify([n.kind ?? "NOTE", n.title, n.body, n.category, n.pinned, n.locked, parseTags(tags), (n.items ?? []).filter((i) => i.text.trim()), n.strokes ?? [], n.attachments ?? []]);

let nextItem = 0;
export const newItem = (): ChecklistItem => ({ id: `i${Date.now().toString(36)}${(nextItem++).toString(36)}`, text: "", done: false });
const kb = (b: number) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/**
 * The editor for a note, a checklist or a drawing. A note can also be dictated (on-device speech to text) and can link files saved
 * to LinqaVault. Saving is done by the parent, which seals the content on this phone first.
 */
export function NoteEditor({ state, setState, saving, error, attaching, autoDictate, onSave, onDelete, onClose, onAttach, onOpenAttachment, onToggleLock }: {
  state: EditorState; setState: (s: EditorState) => void; saving: boolean; error: string; attaching: boolean; autoDictate?: boolean;
  onSave: () => void; onDelete?: () => void; onClose: () => void; onAttach: () => void; onOpenAttachment: (a: Attachment) => void; onToggleLock: (v: boolean) => void;
}) {
  const d = state.draft;
  const kind = noteKind(d);
  const latest = useRef(state);
  latest.current = state;
  const set = (patch: Partial<NoteContent>) => setState({ ...latest.current, draft: { ...latest.current.draft, ...patch } });
  const [scrollLocked, setScrollLocked] = useState(false);
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const stop = useRef<null | (() => void)>(null);
  const [focusItem, setFocusItem] = useState<string | null>(() => (!state.id && noteKind(state.draft) === "CHECKLIST" ? state.draft.items?.[0]?.id ?? null : null));

  async function toggleDictation() {
    if (stop.current) { stop.current(); stop.current = null; setListening(false); setPartial(""); return; }
    try {
      setListening(true);
      stop.current = await startDictation((text, final) => {
        if (!final) { setPartial(text); return; }
        const body = latest.current.draft.body;
        setPartial("");
        const next = (body && !/\s$/.test(body) ? body + " " : body) + text.trim();
        if (next.length <= MAX_NOTE_BODY) setState({ ...latest.current, draft: { ...latest.current.draft, body: next } });
        stop.current = null; setListening(false);
      });
    } catch (e) {
      stop.current = null; setListening(false);
      Alert.alert("Voice dictation", e instanceof Error ? e.message : "Voice input isn't available right now.");
    }
  }
  useEffect(() => { if (autoDictate && kind === "NOTE") void toggleDictation(); return () => { stop.current?.(); stop.current = null; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const items = d.items ?? [];
  const setItems = (next: ChecklistItem[]) => set({ items: next });
  const title = state.id ? (kind === "CHECKLIST" ? "Edit checklist" : kind === "DRAWING" ? "Edit drawing" : "Edit note") : kind === "CHECKLIST" ? "New checklist" : kind === "DRAWING" ? "New drawing" : "New note";

  return (
    <ModuleScreen title={title} subtitle="Encrypted on this phone before it's saved" onBack={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView scrollEnabled={!scrollLocked} contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
          {error ? <Banner tone="error">{error}</Banner> : null}
          <TextInput accessibilityLabel="Title" value={d.title} onChangeText={(v) => set({ title: v })} placeholder="Title" placeholderTextColor={M.faint} maxLength={200} style={s.titleInput} />

          {kind === "NOTE" ? (
            <>
              <TextInput accessibilityLabel="Note" value={d.body} onChangeText={(v) => set({ body: v })} placeholder="Write something…" placeholderTextColor={M.faint} multiline textAlignVertical="top" maxLength={MAX_NOTE_BODY} style={s.body} />
              {listening ? <Text accessibilityLiveRegion="polite" style={s.listening}>Listening… {partial}</Text> : null}
              <View style={s.row}>
                <Pressable accessibilityRole="button" accessibilityState={{ selected: listening }} onPress={() => void toggleDictation()} style={[s.tool, listening && { borderColor: M.accent }]}>
                  <Ionicons name={listening ? "stop-circle" : "mic-outline"} size={15} color={listening ? M.accent : M.text} />
                  <Text style={s.toolText}>{listening ? "Stop" : dictationAvailable() ? "Dictate" : "Dictate (not on this phone)"}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: attaching }} disabled={attaching} onPress={onAttach} style={[s.tool, attaching && { opacity: 0.5 }]}>
                  <Ionicons name="attach" size={15} color={M.text} /><Text style={s.toolText}>{attaching ? "Saving file…" : "Attach file"}</Text>
                </Pressable>
              </View>
              {(d.attachments ?? []).map((a) => (
                <Pressable key={a.vaultId} accessibilityRole="button" accessibilityLabel={`Open ${a.name} in your Vault`} onPress={() => onOpenAttachment(a)} style={s.file}>
                  <Ionicons name="document-outline" size={18} color={M.accent} />
                  <View style={{ flex: 1 }}><Text style={s.fileName} numberOfLines={1}>{a.name}</Text><Text style={s.fileMeta}>{kb(a.size)} · encrypted in your Vault</Text></View>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${a.name} from this note`} hitSlop={8} onPress={() => set({ attachments: (d.attachments ?? []).filter((x) => x.vaultId !== a.vaultId) })}><Ionicons name="close" size={18} color={M.muted} /></Pressable>
                </Pressable>
              ))}
            </>
          ) : null}

          {kind === "CHECKLIST" ? (
            <View style={s.list}>
              {items.map((it, i) => (
                <View key={it.id} style={s.item}>
                  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: it.done }} accessibilityLabel={it.text || "Item"} hitSlop={6} onPress={() => setItems(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))}>
                    <Ionicons name={it.done ? "checkbox" : "square-outline"} size={21} color={it.done ? M.accent : M.muted} />
                  </Pressable>
                  <TextInput accessibilityLabel={`Item ${i + 1}`} autoFocus={focusItem === it.id} value={it.text} onChangeText={(v) => setItems(items.map((x) => (x.id === it.id ? { ...x, text: v } : x)))} placeholder="Item" placeholderTextColor={M.faint} maxLength={300} blurOnSubmit={false}
                    onSubmitEditing={() => { const n = newItem(); setFocusItem(n.id); setItems([...items.slice(0, i + 1), n, ...items.slice(i + 1)]); }}
                    style={[s.itemInput, it.done && { textDecorationLine: "line-through", color: M.faint }]} />
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove item ${i + 1}`} hitSlop={8} onPress={() => setItems(items.filter((x) => x.id !== it.id))}><Ionicons name="close" size={18} color={M.muted} /></Pressable>
                </View>
              ))}
              <Pressable accessibilityRole="button" onPress={() => { const n = newItem(); setFocusItem(n.id); setItems([...items, n]); }} style={s.addItem}>
                <Ionicons name="add-circle-outline" size={18} color={M.accent} /><Text style={[s.toolText, { color: M.accent }]}>Add item</Text>
              </Pressable>
            </View>
          ) : null}

          {kind === "DRAWING" ? (
            <DrawingPad strokes={d.strokes ?? []} onChange={(next) => set({ strokes: next })} onTouching={setScrollLocked} onTooMuch={() => Alert.alert("Drawing is too detailed", "Undo some strokes or clear the drawing to keep drawing.")} />
          ) : null}

          <Text style={moduleStyles.label}>Category</Text>
          <View style={s.chips}>{NOTE_CATEGORIES.map((c) => <Chip key={c} label={c} selected={d.category === c} onPress={() => set({ category: c })} />)}</View>
          <Text style={moduleStyles.label}>Tags</Text>
          <TextInput accessibilityLabel="Tags" value={state.tags} onChangeText={(v) => setState({ ...latest.current, tags: v })} placeholder="planning, travel" placeholderTextColor={M.faint} autoCapitalize="none" style={moduleStyles.input} />

          <View style={s.switchRow}>
            <View style={{ flex: 1 }}><Text style={s.switchTitle}>Pin to top</Text></View>
            <Switch accessibilityLabel="Pin to top" value={d.pinned} onValueChange={(v) => set({ pinned: v })} trackColor={{ true: M.accent }} />
          </View>
          <View style={s.switchRow}>
            <View style={{ flex: 1 }}><Text style={s.switchTitle}>Lock</Text><Text style={s.hint}>Asks for your fingerprint, face or screen lock before it opens.</Text></View>
            <Switch accessibilityLabel="Lock note" value={d.locked} onValueChange={onToggleLock} trackColor={{ true: M.accent }} />
          </View>

          <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving} style={[moduleStyles.primary, saving && { opacity: 0.6 }]} onPress={onSave}>
            <Text style={moduleStyles.primaryText}>{saving ? "Saving…" : kind === "CHECKLIST" ? "Save checklist" : kind === "DRAWING" ? "Save drawing" : "Save note"}</Text>
          </Pressable>
          {onDelete ? <Pressable accessibilityRole="button" onPress={onDelete} style={moduleStyles.danger}><Ionicons name="trash-outline" size={15} color={M.danger} /><Text style={moduleStyles.dangerText}>Delete</Text></Pressable> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </ModuleScreen>
  );
}

const s = StyleSheet.create({
  form: { paddingHorizontal: 16, paddingBottom: 36, gap: 8 },
  titleInput: { fontFamily: fonts.bold, fontSize: 17, color: M.text, borderBottomWidth: 1, borderBottomColor: M.border, paddingVertical: 6 },
  body: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 20, color: M.text, minHeight: 100, backgroundColor: M.card, borderWidth: 1, borderColor: M.border, borderRadius: 12, padding: 10 },
  listening: { fontFamily: fonts.medium, fontSize: 12, color: M.accent },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  tool: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: M.border, backgroundColor: M.card, borderRadius: 999, paddingHorizontal: 12, minHeight: 32 },
  toolText: { fontFamily: fonts.semibold, fontSize: 12, color: M.text },
  file: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: M.card, borderWidth: 1, borderColor: M.border, borderRadius: 12, padding: 8 },
  fileName: { fontFamily: fonts.semibold, fontSize: 12.5, color: M.text },
  fileMeta: { fontFamily: fonts.regular, fontSize: 11, color: M.muted, marginTop: 1 },
  list: { gap: 6 },
  item: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: M.card, borderWidth: 1, borderColor: M.border, borderRadius: 10, paddingHorizontal: 10, minHeight: 40 },
  itemInput: { flex: 1, fontFamily: fonts.regular, fontSize: 13.5, color: M.text, paddingVertical: 6 },
  addItem: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 36, paddingHorizontal: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: M.card, borderWidth: 1, borderColor: M.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  switchTitle: { fontFamily: fonts.semibold, fontSize: 13, color: M.text },
  hint: { fontFamily: fonts.regular, fontSize: 11, color: M.muted, marginTop: 1 }
});
