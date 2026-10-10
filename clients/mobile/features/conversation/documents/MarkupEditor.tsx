// Draw, highlight, add arrows and text over a photo or a document page, then
// send the result as a new image. Reuses the whiteboard canvas with a fixed
// camera so marks stay aligned with the picture underneath.

import React, { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { captureRef } from "react-native-view-shot";
import * as FS from "expo-file-system/legacy";
import { Board } from "../whiteboard/model";
import { Style, Tool, WhiteboardCanvas, WhiteboardCanvasHandle } from "../whiteboard/WhiteboardCanvas";
import { WhiteboardToolbar } from "../whiteboard/WhiteboardToolbar";
import { PrepareInput } from "../attachments/AttachmentService";
import { palette as c, space } from "../ui/tokens";

interface Props {
  backgroundUri: string;
  name: string;
  onCancel: () => void;
  onDone: (input: Omit<PrepareInput, "replaces">) => Promise<void>;
}

export function MarkupEditor({ backgroundUri, name, onCancel, onDone }: Props) {
  const board = useMemo(() => new Board("me"), []);
  const version = useSyncExternalStore((f) => board.subscribe(f), () => board.getVersion());
  const canvas = useRef<WhiteboardCanvasHandle>(null);
  const shot = useRef<View>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [style, setStyle] = useState<Style>({ color: "#A12C2C", width: 4, fill: false, stickyColor: "#FFE48A", fontSize: 22 });
  const [hasSel, setHasSel] = useState(false);
  const [busy, setBusy] = useState(false);

  const done = async () => {
    setBusy(true);
    let uri: string | undefined;
    try {
      uri = await captureRef(shot, { format: "jpg", quality: 0.92, result: "tmpfile" });
      await onDone({ uri, name: name.replace(/\.\w+$/, "") + "-marked-up.jpg", mime: "image/jpeg", kind: "image" });
    } catch {
      Alert.alert("Not sent", "The marked-up copy couldn't be sent. Try again.");
    } finally {
      if (uri) await FS.deleteAsync(uri, {idempotent:true}).catch(() => undefined);
      setBusy(false);
    }
  };

  const cancel = () => {
    if (!board.elements().length) return onCancel();
    Alert.alert("Discard your markup?", undefined, [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onCancel },
    ]);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <Pressable onPress={cancel} style={styles.barBtn} accessibilityRole="button">
          <Text style={styles.barText}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>Mark up</Text>
        <Pressable onPress={done} disabled={busy || !board.elements().length} style={styles.barBtn} accessibilityRole="button">
          <Text style={[styles.barText, styles.primary, (busy || !board.elements().length) && { opacity: 0.4 }]}>{busy ? "Sending" : "Send"}</Text>
        </Pressable>
      </View>
      <View ref={shot} collapsable={false} style={styles.stage}>
        <WhiteboardCanvas
          ref={canvas}
          board={board}
          tool={tool}
          style={style}
          transparent
          fixedCamera
          backgroundUri={backgroundUri}
          onOps={() => {}}
          onSelectionChange={(ids) => setHasSel(ids.length > 0)}
        />
      </View>
      <WhiteboardToolbar
        key={version}
        compact
        tool={tool}
        onTool={setTool}
        style={style}
        onStyle={setStyle}
        zoom={1}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onFit={() => {}}
        canUndo={board.canUndo()}
        canRedo={board.canRedo()}
        onUndo={() => board.undo()}
        onRedo={() => board.redo()}
        hasSelection={hasSel}
        onDeleteSelection={() => canvas.current?.deleteSelection()}
        onRecolorSelection={(color) => canvas.current?.restyleSelection({ color })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: c.night },
  bar: { flexDirection: "row", alignItems: "center", paddingTop: 52, paddingHorizontal: space.l, paddingBottom: space.s },
  barBtn: { minWidth: 60, minHeight: 44, justifyContent: "center" },
  barText: { color: c.nightInk, fontSize: 16 },
  primary: { color: c.secureOnNight, fontWeight: "600", textAlign: "right" },
  title: { flex: 1, textAlign: "center", color: c.nightInk, fontSize: 17, fontWeight: "600" },
  stage: { flex: 1, backgroundColor: "#000" },
});
