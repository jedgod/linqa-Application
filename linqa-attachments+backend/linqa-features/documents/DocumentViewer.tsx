// Opens any FileContent: decrypts it, picks the right viewer, and offers
// Edit / Mark up / Save. Edits are sent as a new file message that points
// back at the original (`replaces`), so both people keep the history.

import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Pdf from "react-native-pdf";
import { useVideoPlayer, VideoView } from "expo-video";
import * as Sharing from "expo-sharing";
import { FileContent } from "../content/types";
import { AttachmentError, AttachmentService, PrepareInput, formatBytes } from "../attachments/AttachmentService";
import { TextDocumentEditor, isEditableText } from "./TextDocumentEditor";
import { ImageEditor } from "./ImageEditor";
import { MarkupEditor } from "./MarkupEditor";
import { VoicePlayer } from "../features/voice/Voice";
import { palette as c, space } from "../ui/tokens";

type Mode = "view" | "edit" | "markup";

interface Props {
  file: FileContent;
  attachments: AttachmentService;
  /** Sends an edited copy. The caller runs prepare() + sendContent(). */
  onSendNewVersion: (input: PrepareInput) => Promise<void>;
  onClose: () => void;
}

export function DocumentViewer({ file, attachments, onSendNewVersion, onClose }: Props) {
  const [path, setPath] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setError(null);
    attachments
      .open(file, (f) => alive && setProgress(f))
      .then((p) => alive && setPath(p))
      .catch((e) => alive && setError(e instanceof AttachmentError ? e.message : "This file couldn't be opened."));
    return () => {
      alive = false;
    };
  }, [attachments, file]);

  const save = async () => {
    setSaving(true);
    try {
      const where = await attachments.saveToDevice(file);
      if (where === "photos") Alert.alert("Saved", "Saved to your photos.");
    } catch {
      Alert.alert("Not saved", "The file couldn't be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const openWith = () => {
    Alert.alert(
      "Open in another app?",
      "The other app gets an unencrypted copy that Linqa can't protect or delete.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Open", onPress: () => path && Sharing.shareAsync(path, { mimeType: file.mime }) },
      ]
    );
  };

  const sendVersion = async (input: Omit<PrepareInput, "replaces">) => {
    await onSendNewVersion({ ...input, replaces: file.blobId });
    setMode("view");
  };

  if (error) {
    return (
      <Shell title={file.name} onClose={onClose}>
        <Centered>
          <Text style={styles.errorTitle}>Can't open this file</Text>
          <Text style={styles.muted}>{error}</Text>
        </Centered>
      </Shell>
    );
  }
  if (!path) {
    return (
      <Shell title={file.name} onClose={onClose}>
        <Centered>
          <ActivityIndicator color={c.secure} />
          <Text style={styles.muted}>Decrypting {Math.round(progress * 100)}%</Text>
        </Centered>
      </Shell>
    );
  }

  if (mode === "edit" && file.fileKind === "image") {
    return <ImageEditor sourceUri={path} name={file.name} onCancel={() => setMode("view")} onDone={sendVersion} />;
  }
  if (mode === "edit" && isEditableText(file.mime, file.name)) {
    return <TextDocumentEditor sourcePath={path} name={file.name} mime={file.mime} onCancel={() => setMode("view")} onDone={sendVersion} />;
  }
  if (mode === "markup") {
    return <MarkupEditor backgroundUri={path} name={file.name} onCancel={() => setMode("view")} onDone={sendVersion} />;
  }

  const canEdit = file.fileKind === "image" || isEditableText(file.mime, file.name);
  const canMarkup = file.fileKind === "image";

  return (
    <Shell
      title={file.name}
      subtitle={`${formatBytes(file.size)}${file.replaces ? ", edited version" : ""}`}
      onClose={onClose}
      actions={[
        canEdit && { label: "Edit", onPress: () => setMode("edit") },
        canMarkup && { label: "Mark up", onPress: () => setMode("markup") },
        { label: saving ? "Saving" : "Save", onPress: save, disabled: saving },
        { label: "Open in", onPress: openWith },
      ]}
    >
      <Body file={file} path={path} />
      {file.aiPrompt ? <Text style={styles.prompt}>AI image. Prompt: {file.aiPrompt}</Text> : null}
      {file.caption ? <Text style={styles.caption}>{file.caption}</Text> : null}
    </Shell>
  );
}

function Body({ file, path }: { file: FileContent; path: string }) {
  if (file.fileKind === "image") {
    // ScrollView zoom gives pinch-to-zoom and pan on iOS; Android uses the
    // same component with react-native-gesture-handler's ScrollView.
    return (
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.zoomContent}
        maximumZoomScale={5}
        minimumZoomScale={1}
        centerContent
        accessibilityLabel={file.caption ?? file.name}
      >
        <Image source={{ uri: path }} style={styles.image} resizeMode="contain" />
      </ScrollView>
    );
  }
  if (file.mime === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return <PdfBody path={path} />;
  }
  if (file.fileKind === "video") return <VideoBody path={path} />;
  if (file.fileKind === "voice") {
    return (
      <Centered>
        <VoicePlayer path={path} durationMs={file.durationMs} waveform={file.waveform} />
      </Centered>
    );
  }
  if (isEditableText(file.mime, file.name)) {
    return <TextDocumentEditor sourcePath={path} name={file.name} mime={file.mime} readOnly />;
  }
  return (
    <Centered>
      <Text style={styles.errorTitle}>No preview for this file type</Text>
      <Text style={styles.muted}>Use Save or Open in to view it in another app.</Text>
    </Centered>
  );
}

function PdfBody({ path }: { path: string }) {
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  return (
    <View style={styles.fill}>
      <Pdf
        source={{ uri: path }}
        style={styles.fill}
        enablePaging={false}
        maxScale={6}
        onLoadComplete={(n) => setPages(n)}
        onPageChanged={(p) => setPage(p)}
        // Links in a received PDF could reveal that it was opened, so they
        // only open after the user confirms.
        onPressLink={(url) =>
          Alert.alert("Open link?", url, [
            { text: "Cancel", style: "cancel" },
            { text: "Open", onPress: () => Linking.openURL(url) },
          ])
        }
      />
      {pages > 0 ? (
        <View style={styles.pageChip} accessibilityLiveRegion="polite">
          <Text style={styles.pageChipText}>
            Page {page} of {pages}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function VideoBody({ path }: { path: string }) {
  const player = useVideoPlayer(path, (p) => {
    p.loop = false;
  });
  return <VideoView player={player} style={styles.fill} nativeControls allowsFullscreen contentFit="contain" />;
}

// --- layout helpers --------------------------------------------------------

interface Action {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

export function Shell(props: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  actions?: (Action | false)[];
  children: React.ReactNode;
}) {
  const actions = (props.actions ?? []).filter(Boolean) as Action[];
  return (
    <View style={styles.shell}>
      <View style={styles.bar}>
        <Pressable onPress={props.onClose} accessibilityRole="button" style={styles.barBtn} hitSlop={8}>
          <Text style={styles.barBtnText}>Close</Text>
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>
            {props.title}
          </Text>
          {props.subtitle ? <Text style={styles.subtitle}>{props.subtitle}</Text> : null}
        </View>
        <View style={styles.barBtn} />
      </View>
      <View style={styles.fill}>{props.children}</View>
      {actions.length ? (
        <View style={styles.actions}>
          {actions.map((a) => (
            <Pressable
              key={a.label}
              onPress={a.onPress}
              disabled={a.disabled}
              accessibilityRole="button"
              style={[styles.action, a.disabled && { opacity: 0.5 }]}
            >
              <Text style={styles.actionText}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: c.night },
  fill: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", paddingTop: 52, paddingBottom: space.s, paddingHorizontal: space.m },
  barBtn: { minWidth: 64, minHeight: 44, justifyContent: "center" },
  barBtnText: { color: c.nightInk, fontSize: 16 },
  titleWrap: { flex: 1, alignItems: "center" },
  title: { color: c.nightInk, fontSize: 16, fontWeight: "600" },
  subtitle: { color: c.nightMuted, fontSize: 12, marginTop: 2 },
  zoomContent: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  image: { width: "100%", height: "100%" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.s },
  errorTitle: { color: c.nightInk, fontSize: 17, fontWeight: "600", textAlign: "center" },
  muted: { color: c.nightMuted, fontSize: 14, textAlign: "center" },
  caption: { color: c.nightInk, fontSize: 15, padding: space.l },
  prompt: { color: c.warnOnNight, fontSize: 13, paddingHorizontal: space.l, paddingTop: space.s },
  pageChip: { position: "absolute", bottom: space.m, alignSelf: "center", backgroundColor: "rgba(16,22,28,0.8)", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4 },
  pageChipText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  actions: { flexDirection: "row", justifyContent: "space-around", paddingTop: space.s, paddingBottom: 34, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.nightLine },
  action: { minHeight: 44, minWidth: 64, alignItems: "center", justifyContent: "center", paddingHorizontal: space.s },
  actionText: { color: c.secureOnNight, fontSize: 15, fontWeight: "600" },
});
