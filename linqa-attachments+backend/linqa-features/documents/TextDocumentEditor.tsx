// Plain-text documents (.txt, .md, .csv, .json, code) are viewed and edited
// in place. "Send new version" writes the edit to a private temp file and
// hands it back for encryption; the original message is never changed.

import React, { useEffect, useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as FileSystem from "expo-file-system";
import { PrepareInput } from "../attachments/AttachmentService";
import { newId } from "../content/codec";
import { palette as c, space } from "../ui/tokens";

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|yaml|yml|log|ini|js|ts|tsx|jsx|py|rs|kt|swift|java|html|css)$/i;
const MAX_EDIT_BYTES = 2 * 1024 * 1024;

export function isEditableText(mime: string, name: string): boolean {
  return mime.startsWith("text/") || mime === "application/json" || mime === "application/xml" || TEXT_EXT.test(name);
}

interface Props {
  sourcePath: string;
  name: string;
  mime: string;
  readOnly?: boolean;
  onCancel?: () => void;
  onDone?: (input: Omit<PrepareInput, "replaces">) => Promise<void>;
}

export function TextDocumentEditor({ sourcePath, name, mime, readOnly, onCancel, onDone }: Props) {
  const [original, setOriginal] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [find, setFind] = useState("");

  useEffect(() => {
    (async () => {
      const info = await FileSystem.getInfoAsync(sourcePath);
      if ((info as { size?: number }).size! > MAX_EDIT_BYTES) {
        setError("This file is too large to edit here. Save it and use another app.");
        return;
      }
      const body = await FileSystem.readAsStringAsync(sourcePath, { encoding: FileSystem.EncodingType.UTF8 });
      setOriginal(body);
      setText(body);
    })().catch(() => setError("This file isn't readable text."));
  }, [sourcePath]);

  const matches = useMemo(() => {
    if (!find) return 0;
    const needle = find.toLowerCase();
    let n = 0;
    let i = text.toLowerCase().indexOf(needle);
    while (i >= 0) {
      n++;
      i = text.toLowerCase().indexOf(needle, i + needle.length);
    }
    return n;
  }, [find, text]);

  const changed = original !== null && text !== original;

  const send = async () => {
    if (!onDone || !changed) return;
    setBusy(true);
    const out = `${FileSystem.cacheDirectory}linqa-secure/out/${newId()}-${name}`;
    try {
      await FileSystem.makeDirectoryAsync(`${FileSystem.cacheDirectory}linqa-secure/out/`, { intermediates: true }).catch(() => {});
      await FileSystem.writeAsStringAsync(out, text, { encoding: FileSystem.EncodingType.UTF8 });
      await onDone({ uri: out, name, mime, kind: "document", caption: "Edited version" });
    } catch {
      Alert.alert("Not sent", "The new version couldn't be sent. Try again.");
    } finally {
      await FileSystem.deleteAsync(out, { idempotent: true });
      setBusy(false);
    }
  };

  const cancel = () => {
    if (!changed) return onCancel?.();
    Alert.alert("Discard your changes?", undefined, [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onCancel },
    ]);
  };

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{error}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {!readOnly ? (
        <View style={styles.bar}>
          <Pressable onPress={cancel} accessibilityRole="button" style={styles.barBtn}>
            <Text style={styles.barText}>Cancel</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {name}
          </Text>
          <Pressable onPress={send} disabled={!changed || busy} accessibilityRole="button" style={styles.barBtn}>
            <Text style={[styles.barText, styles.primary, (!changed || busy) && { opacity: 0.4 }]}>
              {busy ? "Sending" : "Send new version"}
            </Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.findRow}>
        <TextInput
          value={find}
          onChangeText={setFind}
          placeholder="Find in document"
          placeholderTextColor={c.muted}
          style={styles.find}
          accessibilityLabel="Find in document"
        />
        {find ? <Text style={styles.muted}>{matches} found</Text> : null}
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        editable={!readOnly}
        multiline
        autoCorrect={false}
        autoCapitalize="none"
        textAlignVertical="top"
        style={styles.editor}
        accessibilityLabel={`Contents of ${name}`}
      />
      {!readOnly ? (
        <Text style={styles.footer}>
          {text.split("\n").length} lines{changed ? ", edited" : ""}. The original stays in the chat.
        </Text>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: c.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl },
  bar: { flexDirection: "row", alignItems: "center", paddingTop: 52, paddingHorizontal: space.m, paddingBottom: space.s, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line },
  barBtn: { minHeight: 44, justifyContent: "center" },
  barText: { fontSize: 15, color: c.ink },
  primary: { color: c.secure, fontWeight: "600" },
  title: { flex: 1, textAlign: "center", fontSize: 16, fontWeight: "600", color: c.ink, marginHorizontal: space.s },
  findRow: { flexDirection: "row", alignItems: "center", gap: space.s, padding: space.s },
  find: { flex: 1, height: 40, borderRadius: 20, backgroundColor: c.bg, paddingHorizontal: space.l, color: c.ink },
  editor: { flex: 1, paddingHorizontal: space.l, paddingTop: space.s, fontSize: 15, lineHeight: 22, color: c.ink, fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) },
  footer: { fontSize: 12, color: c.muted, paddingHorizontal: space.l, paddingVertical: space.s, paddingBottom: 30 },
  muted: { color: c.muted, fontSize: 13 },
});
