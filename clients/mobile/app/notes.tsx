import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, BackHandler, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as LocalAuthentication from "expo-local-authentication";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAccounts } from "../account/AccountContext";
import { DraggableFab } from "../components/workspace/DraggableFab";
import { DrawingThumb } from "../components/workspace/DrawingPad";
import { NoteEditor, editorSnapshot, newItem, type EditorState } from "../components/workspace/NoteEditor";
import { Banner, Busy, Chip, M, ModuleScreen } from "../components/workspace/module-ui";
import { failureText } from "../components/workspace/kit";
import { accountScopeGeneration } from "../services/account-scope";
import { dictationAvailable } from "../services/dictation";
import { saveToVault } from "../services/vault-save";
import { useWorkspace } from "../services/use-workspace";
import {
  checklistProgress, emptyNote, noteHeading, noteKind, noteProblem, notePreview, orderNotes, parseTags, searchNotes, timeAgo,
  NOTE_CATEGORIES, type Attachment, type Note, type NoteContent, type NoteFilter, type NoteKind
} from "../services/workspace-model";
import { fonts } from "../theme/tokens";

const MAX_FILE = 25 * 1024 * 1024;
const CATEGORY_LOOK: Record<string, { color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  Work: { color: "#8B5CF6", icon: "document-text-outline" }, Meeting: { color: "#1677FF", icon: "people-outline" },
  Ideas: { color: "#F5A524", icon: "bulb-outline" }, Personal: { color: "#22C55E", icon: "checkbox-outline" }, Lists: { color: "#12D6AE", icon: "list-outline" }
};
const look = (c: string) => CATEGORY_LOOK[c] ?? { color: M.muted, icon: "pricetag-outline" as const };
const contentOf = (n: Note): NoteContent => { const { id: _id, createdAt: _c, updatedAt: _u, ...content } = n; return content; };

/** A locked note asks for the phone's own fingerprint, face or screen lock before it opens. False if that can't be done here. */
async function deviceUnlock(prompt: string): Promise<boolean> {
  try {
    if (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync())) return false;
    return (await LocalAuthentication.authenticateAsync({ promptMessage: prompt })).success;
  } catch { return false; }
}

/**
 * Notes. Each note, checklist and drawing is encrypted on this phone before it is saved, so the server holds only ciphertext.
 * A locked note adds a fingerprint / screen-lock check before it opens here. Files attached to a note are saved encrypted in
 * LinqaVault and linked from the note.
 */
export default function NotesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ new?: string }>();
  const ws = useWorkspace();
  const { active } = useAccounts();
  const insets = useSafeAreaInsets();
  const [notes, setNotes] = useState<Note[]>([]);
  const [unreadable, setUnreadable] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<NoteFilter>("all");
  const [category, setCategory] = useState<string | null>(null);
  const [showCategories, setShowCategories] = useState(false);
  const [editing, setEditing] = useState<EditorState | null>(null);
  const [dictate, setDictate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [formError, setFormError] = useState("");
  const [menuFor, setMenuFor] = useState<Note | null>(null);
  const run = useRef(0);
  const searchRef = useRef<TextInput>(null);

  const back = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/linqa"));

  const load = useCallback(async () => {
    if (!ws) return;
    const mine = ++run.current;
    setLoading(true); setError("");
    try {
      const result = await ws.notes();
      if (mine !== run.current) return;
      setNotes(result.notes); setUnreadable(result.unreadable);
    } catch (e) { if (mine === run.current) setError(failureText(e, "load your notes")); }
    finally { if (mine === run.current) setLoading(false); }
  }, [ws]);
  useEffect(() => { setNotes([]); setEditing(null); void load(); return () => { run.current++; }; }, [load]);

  // The Create sheet opens this page with ?new=1: go straight to a blank note, once.
  useEffect(() => {
    if (!params.new || !ws) return;
    begin("NOTE");
    router.setParams({ new: "" }); // undefined would leave it set, and the same shortcut would then do nothing next time
  }, [params.new, ws]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => orderNotes(searchNotes(notes, query, category, filter)), [notes, query, category, filter]);

  function begin(kind: NoteKind, options: { dictate?: boolean; attachments?: Attachment[] } = {}) {
    setFormError(""); setDictate(!!options.dictate);
    const draft = { ...emptyNote(kind), ...(kind === "CHECKLIST" ? { items: [newItem()] } : {}), ...(options.attachments ? { attachments: options.attachments } : {}) };
    setEditing({ id: null, draft, tags: "", original: editorSnapshot(emptyNote(kind), "") });
  }

  async function open(note: Note) {
    if (note.locked && !(await deviceUnlock("Unlock this note"))) {
      Alert.alert("Note is locked", "Use your fingerprint, face or screen lock to open it. If this phone has none set up, add a screen lock in Settings first.");
      return;
    }
    setFormError(""); setDictate(false);
    const draft = contentOf(note);
    setEditing({ id: note.id, draft, tags: note.tags.join(", "), original: editorSnapshot(draft, note.tags.join(", ")) });
  }

  /** Picks a file and saves it encrypted to LinqaVault. Returns the link to store in the note, or null if nothing was saved. */
  async function pickAndSave(): Promise<Attachment | null> {
    if (!active) return null;
    const generation = accountScopeGeneration();
    let uri: string | null = null;
    try {
      const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
      if (picked.canceled || !picked.assets[0]) return null;
      const asset = picked.assets[0];
      uri = asset.uri;
      const file = new File(asset.uri);
      if (!file.exists || !file.size || file.size > MAX_FILE) throw new Error("Choose a nonempty file under 25 MB.");
      setAttaching(true);
      const data = await file.base64();
      if (generation !== accountScopeGeneration()) return null;
      const mime = asset.mimeType ?? "application/octet-stream";
      const vaultId = await saveToVault({ accountId: active.userId, plainBase64: data, details: { name: asset.name, mimeType: mime, kind: mime.startsWith("image/") ? "PHOTO" : "FILE" } });
      return { vaultId, name: asset.name, size: file.size };
    } catch (e) {
      Alert.alert("Couldn't attach the file", e instanceof Error ? e.message : "Try again.");
      return null;
    } finally {
      setAttaching(false);
      if (uri) { try { const f = new File(uri); if (f.exists) f.delete(); } catch { /* the cache copy is cleaned up by the system */ } }
    }
  }

  async function attachFromTile() {
    const a = await pickAndSave();
    if (a) begin("NOTE", { attachments: [a] });
  }
  async function attachInEditor() {
    const a = await pickAndSave();
    if (a && editing) setEditing({ ...editing, draft: { ...editing.draft, attachments: [...(editing.draft.attachments ?? []), a] } });
  }

  async function setLocked(value: boolean) {
    if (!editing) return;
    if (value && !(await LocalAuthentication.isEnrolledAsync().catch(() => false))) {
      Alert.alert("Set up a screen lock first", "Locked notes use your phone's fingerprint, face or screen lock. Add one in your phone's Settings, then lock this note.");
      return;
    }
    setEditing({ ...editing, draft: { ...editing.draft, locked: value } });
  }

  async function save() {
    if (!ws || !editing || saving) return;
    const d = editing.draft;
    const content: NoteContent = { ...d, title: d.title.trim(), tags: parseTags(editing.tags), ...(d.items ? { items: d.items.filter((i) => i.text.trim()) } : {}) };
    const problem = noteProblem(content);
    if (problem) { setFormError(problem); return; }
    setSaving(true); setFormError("");
    try {
      const saved = editing.id ? await ws.saveNote(editing.id, content) : await ws.createNote(content);
      setNotes((list) => [saved, ...list.filter((n) => n.id !== saved.id)]);
      setEditing(null);
    } catch (e) { setFormError(failureText(e, "save this")); }
    finally { setSaving(false); }
  }

  async function togglePin(note: Note) {
    if (!ws) return;
    const next = { ...note, pinned: !note.pinned };
    setNotes((list) => list.map((n) => (n.id === note.id ? next : n)));
    try { await ws.saveNote(note.id, contentOf(next)); }
    catch (e) { setNotes((list) => list.map((n) => (n.id === note.id ? note : n))); setError(failureText(e, "update that note")); }
  }

  function confirmDelete(id: string, fromEditor: boolean) {
    if (!ws) return;
    Alert.alert("Delete this?", "It will be removed from your account. This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await ws.deleteNote(id); setNotes((list) => list.filter((n) => n.id !== id)); if (fromEditor) setEditing(null); }
        catch (e) { const message = failureText(e, "delete that"); if (fromEditor) setFormError(message); else setError(message); }
      } }
    ]);
  }

  function closeEditor() {
    if (editing && editorSnapshot(editing.draft, editing.tags) !== editing.original) {
      Alert.alert("Discard changes?", "Your edits haven't been saved.", [{ text: "Keep editing", style: "cancel" }, { text: "Discard", style: "destructive", onPress: () => setEditing(null) }]);
    } else setEditing(null);
  }

  // The phone's Back button closes the editor (asking first if there are unsaved changes) rather than leaving the page.
  useEffect(() => {
    if (!editing) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { closeEditor(); return true; });
    return () => sub.remove();
  });

  if (editing) {
    return (
      <NoteEditor state={editing} setState={setEditing} saving={saving} error={formError} attaching={attaching} autoDictate={dictate}
        onSave={() => void save()} onDelete={editing.id ? () => confirmDelete(editing.id!, true) : undefined} onClose={closeEditor}
        onAttach={() => void attachInEditor()} onOpenAttachment={() => router.push("/vault/files" as never)} onToggleLock={(v) => void setLocked(v)} />
    );
  }

  const count = notes.length;
  const canDictate = dictationAvailable();
  const tiles: Array<{ key: string; icon: keyof typeof Ionicons.glyphMap; label: string; full: string; color: string; onPress: () => void; disabled?: boolean; note?: string }> = [
    { key: "checklist", icon: "checkmark-circle-outline", label: "Checklist", full: "Checklist", color: "#F5A524", onPress: () => begin("CHECKLIST") },
    { key: "drawing", icon: "brush-outline", label: "Drawing", full: "Drawing", color: "#1677FF", onPress: () => begin("DRAWING") },
    { key: "voice", icon: "mic-outline", label: "Voice", full: "Voice dictation", color: "#8B5CF6", onPress: () => begin("NOTE", { dictate: true }), disabled: !canDictate, note: "Not on this phone" },
    { key: "attach", icon: "document-outline", label: "Attach", full: "Attach file", color: "#F59E0B", onPress: () => void attachFromTile(), disabled: attaching }
  ];

  const header = (
    <View style={s.top}>
      <View style={s.searchBar}>
        <Ionicons name="search" size={16} color={M.muted} />
        <TextInput ref={searchRef} accessibilityLabel="Search notes" value={query} onChangeText={setQuery} placeholder="Search notes…" placeholderTextColor={M.faint} autoCapitalize="none" style={s.searchInput} />
        <Pressable accessibilityRole="button" accessibilityLabel="Filter by category" accessibilityState={{ selected: showCategories }} hitSlop={8} onPress={() => setShowCategories((v) => !v)}>
          <Ionicons name="options-outline" size={18} color={showCategories || category ? M.accent : M.muted} />
        </Pressable>
      </View>
      {showCategories ? (
        <View style={s.chips}>
          <Chip label="Any category" selected={!category} onPress={() => setCategory(null)} />
          {NOTE_CATEGORIES.map((c) => <Chip key={c} label={c} selected={category === c} onPress={() => setCategory(category === c ? null : c)} />)}
        </View>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel="New note" style={s.newRow} onPress={() => begin("NOTE")}>
        <View style={s.newIcon}><Ionicons name="create-outline" size={15} color={M.accent} /></View>
        <Text style={s.newText}>New Note</Text>
        <Ionicons name="chevron-forward" size={16} color={M.muted} />
      </Pressable>
      <View style={s.tiles}>
        {tiles.map((t) => (
          <Pressable key={t.key} accessibilityRole="button" accessibilityLabel={t.full} accessibilityState={{ disabled: !!t.disabled }} accessibilityHint={t.disabled && t.note ? t.note : undefined} disabled={t.disabled} onPress={t.onPress} style={[s.tile, t.disabled && { opacity: 0.45 }]}>
            <View style={[s.tileIcon, { backgroundColor: `${t.color}26` }]}><Ionicons name={t.icon} size={16} color={t.color} /></View>
            <Text style={s.tileText} numberOfLines={1}>{t.label}</Text>
            {t.disabled && t.note ? <Text style={s.tileNote}>{t.note}</Text> : null}
          </Pressable>
        ))}
      </View>
      <View style={s.filters}>
        <Chip label="All" selected={filter === "all"} onPress={() => setFilter("all")} />
        <Chip label="Pinned" icon="pin-outline" selected={filter === "pinned"} onPress={() => setFilter("pinned")} />
        <Chip label="Locked" icon="lock-closed-outline" selected={filter === "locked"} onPress={() => setFilter("locked")} />
      </View>
    </View>
  );

  return (
    <ModuleScreen title="Notes" subtitle={loading && !count ? "Loading your notes…" : count ? `Welcome back! You have ${count} ${count === 1 ? "note" : "notes"}.` : "Encrypted on this phone. Write your first note."} onBack={back}
      actions={[{ icon: "search", label: "Search", onPress: () => searchRef.current?.focus() }, { icon: "options-outline", label: "Filter", active: showCategories || !!category, onPress: () => setShowCategories((v) => !v) }]}>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {unreadable ? <Banner tone="info">{unreadable === 1 ? "1 item" : `${unreadable} items`} can't be opened on this device. They were saved with a different key, so they are hidden rather than shown garbled.</Banner> : null}
      {loading && !count ? <Busy /> : (
        <FlatList
          data={visible}
          keyExtractor={(n) => n.id}
          ListHeaderComponent={header}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, gap: 8 }}
          ListEmptyComponent={<Text style={s.none}>{count ? "No notes match." : error ? "" : "No notes yet. Tap New Note to write your first one."}</Text>}
          renderItem={({ item }) => <NoteCard note={item} onOpen={() => void open(item)} onPin={() => void togglePin(item)} onMenu={() => setMenuFor(item)} />}
        />
      )}
      <DraggableFab label="Note" icon="add" storageKey="notes" actions={[{ label: "New note", icon: "document-text-outline", onPress: () => begin("NOTE") }, { label: "Checklist", icon: "checkmark-circle-outline", onPress: () => begin("CHECKLIST") }, { label: "Drawing", icon: "brush-outline", onPress: () => begin("DRAWING") }]} />

      <Modal transparent visible={!!menuFor} animationType="fade" onRequestClose={() => setMenuFor(null)}>
        <Pressable style={s.scrim} onPress={() => setMenuFor(null)} accessibilityLabel="Close menu">
          <View style={[s.sheet, { paddingBottom: 28 + insets.bottom }]}>
            <Text style={s.sheetTitle} numberOfLines={1}>{menuFor ? noteHeading(menuFor) : ""}</Text>
            {menuFor ? (
              <>
                <MenuItem icon="create-outline" label="Open" onPress={() => { const n = menuFor; setMenuFor(null); void open(n); }} />
                <MenuItem icon={menuFor.pinned ? "pin" : "pin-outline"} label={menuFor.pinned ? "Unpin" : "Pin to top"} onPress={() => { const n = menuFor; setMenuFor(null); void togglePin(n); }} />
                <MenuItem icon="trash-outline" label="Delete" danger onPress={() => { const n = menuFor; setMenuFor(null); confirmDelete(n.id, false); }} />
              </>
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </ModuleScreen>
  );
}

function MenuItem({ icon, label, onPress, danger }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={s.menuItem}>
      <Ionicons name={icon} size={18} color={danger ? M.danger : M.text} /><Text style={[s.menuText, danger && { color: M.danger }]}>{label}</Text>
    </Pressable>
  );
}

function NoteCard({ note, onOpen, onPin, onMenu }: { note: Note; onOpen: () => void; onPin: () => void; onMenu: () => void }) {
  const c = look(note.category);
  const kind = noteKind(note);
  const progress = kind === "CHECKLIST" ? checklistProgress(note.items) : null;
  const kindIcon: keyof typeof Ionicons.glyphMap = note.locked ? "lock-closed" : kind === "CHECKLIST" ? "checkbox-outline" : kind === "DRAWING" ? "brush-outline" : "document-text-outline";
  const preview = notePreview(note);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={noteHeading(note)} style={({ pressed }) => [s.card, { borderLeftColor: c.color }, pressed && { backgroundColor: M.cardAlt }]} onPress={onOpen}>
      <View style={[s.kind, { backgroundColor: `${c.color}1F` }]}>
        {kind === "DRAWING" && !note.locked ? <DrawingThumb strokes={note.strokes ?? []} size={24} /> : <Ionicons name={kindIcon} size={16} color={c.color} />}
      </View>
      <View style={s.body}>
        <Text style={s.cardTitle} numberOfLines={1}>{noteHeading(note)}</Text>
        {preview ? <Text style={s.cardPreview} numberOfLines={1}>{preview}</Text> : null}
        <View style={s.meta}>
          <Text style={[s.metaCategory, { color: c.color }]} numberOfLines={1}>{note.category}</Text>
          <Text style={s.metaDot}>·</Text>
          <Text style={s.metaTime} numberOfLines={1}>{timeAgo(note.updatedAt)}</Text>
          {progress && progress.total && !note.locked ? (
            <View style={s.track}><View style={[s.fill, { width: `${Math.round((progress.done / progress.total) * 100)}%`, backgroundColor: c.color }]} /></View>
          ) : null}
        </View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={note.pinned ? "Unpin" : "Pin"} accessibilityState={{ selected: note.pinned }} hitSlop={8} onPress={onPin}>
        <Ionicons name={note.pinned ? "pin" : "pin-outline"} size={17} color={note.pinned ? M.warn : M.faint} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="More actions" hitSlop={8} onPress={onMenu}><Ionicons name="ellipsis-vertical" size={16} color={M.faint} /></Pressable>
    </Pressable>
  );
}

const s = StyleSheet.create({
  top: { gap: 8, paddingBottom: 6 },
  searchBar: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: M.card, borderWidth: 1, borderColor: M.border, borderRadius: 12, paddingHorizontal: 12, minHeight: 38 },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: M.text, paddingVertical: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  newRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: M.card, borderWidth: 1, borderColor: M.border, borderRadius: 12, paddingHorizontal: 10, minHeight: 38 },
  newIcon: { width: 26, height: 26, borderRadius: 8, backgroundColor: "#12315A", alignItems: "center", justifyContent: "center" },
  newText: { flex: 1, fontFamily: fonts.bold, fontSize: 13, color: M.text },
  tiles: { flexDirection: "row", gap: 6 },
  tile: { flex: 1, alignItems: "center", gap: 4, backgroundColor: M.card, borderWidth: 1, borderColor: M.border, borderRadius: 12, paddingVertical: 7, paddingHorizontal: 2, minHeight: 54 },
  tileIcon: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  tileText: { fontFamily: fonts.semibold, fontSize: 10.5, color: M.text, textAlign: "center" },
  tileNote: { fontFamily: fonts.regular, fontSize: 9, color: M.faint, textAlign: "center" },
  filters: { flexDirection: "row", gap: 6, marginBottom: 2 },
  none: { fontFamily: fonts.regular, fontSize: 12, color: M.muted, textAlign: "center", marginTop: 16 },
  card: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: M.card, borderWidth: 1, borderColor: M.border, borderLeftWidth: 3, borderRadius: 12, paddingVertical: 8, paddingLeft: 9, paddingRight: 10 },
  kind: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  body: { flex: 1, gap: 1 },
  cardTitle: { fontFamily: fonts.bold, fontSize: 13.5, color: M.text },
  cardPreview: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 15, color: M.muted },
  meta: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 1 },
  metaCategory: { fontFamily: fonts.semibold, fontSize: 10.5, flexShrink: 1 },
  metaDot: { fontFamily: fonts.regular, fontSize: 10.5, color: M.faint },
  metaTime: { fontFamily: fonts.regular, fontSize: 10.5, color: M.faint, flexShrink: 1 },
  track: { flex: 1, minWidth: 24, maxWidth: 70, height: 3, borderRadius: 2, backgroundColor: "#12315A", overflow: "hidden", marginLeft: 4 },
  fill: { height: 3, borderRadius: 2 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: M.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: M.border, padding: 16, paddingBottom: 28, gap: 4 },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 13, color: M.muted, marginBottom: 4 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 },
  menuText: { fontFamily: fonts.semibold, fontSize: 14, color: M.text }
});
