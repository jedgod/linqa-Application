import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getApiBaseUrl } from "../../config/api";
import { accessTokenProvider } from "../../services/session";
import { VaultService, type VaultFolder } from "../../services/vault.service";
import { fonts } from "../../theme/tokens";
import { FolderIcon, vault } from "./ui";

export interface FolderChoice { id: string | null; path: string }

/** "Save to": the vault root or one of the user's folders, with a way to add a folder. */
export function FolderPicker({ value, onChange }: { value: FolderChoice; onChange: (choice: FolderChoice) => void }) {
  const client = useMemo(() => new VaultService(getApiBaseUrl(), () => accessTokenProvider.getAccessToken()), []);
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<VaultFolder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || folders) return;
    let active = true;
    client.listFolders().then(
      (result) => { if (active) setFolders(result.folders); },
      (cause) => { if (active) setError(cause instanceof Error ? cause.message.replace(/_/g, " ").toLowerCase() : "Unable to load folders"); }
    );
    return () => { active = false; };
  }, [open, folders, client]);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await client.createFolder(trimmed, value.id ?? undefined);
      const parentPath = value.id ? `${value.path} / ` : "";
      const next: VaultFolder = { id: created.id, parentId: created.parentId, name: created.name, path: `${parentPath}${created.name}` };
      setFolders((current) => [...(current ?? []), next]);
      setName("");
      setAdding(false);
      onChange({ id: next.id, path: next.path });
      setOpen(false);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "FOLDER_EXISTS" ? "A folder with that name already exists." : code === "INVALID_FOLDER_NAME" ? "That folder name is not allowed." : "Unable to create the folder.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Save to ${value.path}. Change folder`} accessibilityState={{ expanded: open }} style={s.field} onPress={() => setOpen((v) => !v)}>
        <FolderIcon size={26} />
        <Text style={s.fieldText} numberOfLines={1}>{value.path}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-forward"} size={18} color={vault.muted} />
      </Pressable>

      {open ? (
        <View style={s.list}>
          <Pressable accessibilityRole="button" style={s.item} onPress={() => { onChange({ id: null, path: "My Vault" }); setOpen(false); }}>
            <Text style={[s.itemText, value.id === null && s.itemOn]}>My Vault</Text>
            {value.id === null ? <Ionicons name="checkmark" size={18} color={vault.blueText} /> : null}
          </Pressable>
          {folders === null && !error ? <ActivityIndicator color={vault.blueText} style={{ padding: 12 }} /> : null}
          {folders?.map((folder) => (
            <Pressable key={folder.id} accessibilityRole="button" style={s.item} onPress={() => { onChange({ id: folder.id, path: folder.path }); setOpen(false); }}>
              <Text style={[s.itemText, value.id === folder.id && s.itemOn]} numberOfLines={1}>{folder.path}</Text>
              {value.id === folder.id ? <Ionicons name="checkmark" size={18} color={vault.blueText} /> : null}
            </Pressable>
          ))}
          {adding ? (
            <View style={s.add}>
              <TextInput autoFocus value={name} onChangeText={setName} placeholder={value.id ? `New folder in ${value.path}` : "New folder name"} placeholderTextColor={vault.faint} style={s.input} maxLength={100} onSubmitEditing={() => void add()} accessibilityLabel="New folder name" />
              <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !name.trim() }} disabled={busy || !name.trim()} style={[s.addButton, (busy || !name.trim()) && { opacity: 0.5 }]} onPress={() => void add()}>
                <Text style={s.addText}>Add</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable accessibilityRole="button" style={s.item} onPress={() => setAdding(true)}>
              <Ionicons name="add" size={18} color={vault.blueText} />
              <Text style={[s.itemText, { color: vault.blueText }]}>New folder</Text>
            </Pressable>
          )}
          {error ? <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  field: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: vault.border, backgroundColor: "#0A1827", paddingHorizontal: 12 },
  fieldText: { flex: 1, color: vault.text, fontFamily: fonts.regular, fontSize: 15 },
  list: { marginTop: 8, borderRadius: 14, borderWidth: 1, borderColor: vault.border, backgroundColor: "#0A1827", overflow: "hidden" },
  item: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, paddingHorizontal: 14 },
  itemText: { flex: 1, color: vault.text, fontFamily: fonts.regular, fontSize: 14 },
  itemOn: { color: vault.blueText, fontFamily: fonts.semibold },
  add: { flexDirection: "row", gap: 8, padding: 10 },
  input: { flex: 1, height: 44, borderRadius: 10, borderWidth: 1, borderColor: vault.border, color: vault.text, paddingHorizontal: 12, fontFamily: fonts.regular, fontSize: 14 },
  addButton: { height: 44, borderRadius: 10, backgroundColor: vault.blue, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  addText: { color: "#FFFFFF", fontFamily: fonts.bold, fontSize: 14 },
  error: { color: vault.amber, fontFamily: fonts.medium, fontSize: 13, padding: 12 }
});
