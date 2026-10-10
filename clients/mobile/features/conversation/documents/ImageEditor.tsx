// Crop (free, square, 4:3, 16:9), rotate and flip. The edited image is
// re-encoded with expo-image-manipulator, which also drops EXIF metadata.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import * as FS from "expo-file-system/legacy";
import { PrepareInput } from "../attachments/AttachmentService";
import { Rect, Size, containRect, initialCrop, moveCrop, resizeCrop, toImagePixels } from "./cropMath";
import { palette as c, space } from "../ui/tokens";

const RATIOS: { label: string; value: number | null }[] = [
  { label: "Free", value: null },
  { label: "Square", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "16:9", value: 16 / 9 },
];

interface Props {
  sourceUri: string;
  name: string;
  onCancel: () => void;
  onDone: (input: Omit<PrepareInput, "replaces">) => Promise<void>;
}

export function ImageEditor({ sourceUri, name, onCancel, onDone }: Props) {
  // Rotation and flips are applied for real (new working image) so the crop
  // always operates on what the user sees.
  const [working, setWorking] = useState<{ uri: string; size: Size } | null>(null);
  const [box, setBox] = useState<Size | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const history = useRef<{ uri: string; size: Size }[]>([]);
  const temporary = useRef(new Set<string>());
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; for (const uri of temporary.current) void FS.deleteAsync(uri, {idempotent:true}).catch(() => undefined); temporary.current.clear(); }; }, []);

  useEffect(() => {
    Image.getSize(sourceUri, (width, height) => setWorking({ uri: sourceUri, size: { width, height } }), () =>
      Alert.alert("Can't edit", "This image couldn't be loaded.", [{ text: "OK", onPress: onCancel }])
    );
  }, [sourceUri, onCancel]);

  const displayed = useMemo(() => (working && box ? containRect(working.size, box) : null), [working, box]);

  useEffect(() => {
    if (displayed) setCrop(initialCrop(displayed, aspect));
  }, [displayed, aspect]);

  // Refs so the PanResponders (created once) see current values.
  const live = useRef({ crop, displayed, aspect });
  live.current = { crop, displayed, aspect };
  const start = useRef<Rect | null>(null);

  const moveResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => (start.current = live.current.crop),
        onPanResponderMove: (_, g) => {
          const { displayed: d } = live.current;
          if (start.current && d) setCrop(moveCrop(start.current, g.dx, g.dy, d));
        },
      }),
    []
  );
  const resizeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => (start.current = live.current.crop),
        onPanResponderMove: (_, g) => {
          const { displayed: d, aspect: a } = live.current;
          if (start.current && d) setCrop(resizeCrop(start.current, g.dx, g.dy, d, a));
        },
      }),
    []
  );

  const apply = async (action: ImageManipulator.Action) => {
    if (!working) return;
    setBusy(true);
    try {
      const out = await ImageManipulator.manipulateAsync(working.uri, [action], { compress: 1, format: ImageManipulator.SaveFormat.JPEG });
      if (!active.current) { await FS.deleteAsync(out.uri, {idempotent:true}); return; }
      temporary.current.add(out.uri);
      history.current.push(working);
      setWorking({ uri: out.uri, size: { width: out.width, height: out.height } });
    } catch {
      if (active.current) Alert.alert("Can't edit", "The photo couldn't be changed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const undo = () => {
    const prev = history.current.pop();
    if (prev) setWorking(prev);
  };

  const done = async () => {
    if (!working || !crop || !displayed) return;
    setBusy(true);
    let output: string | undefined;
    try {
      const px = toImagePixels(crop, displayed, working.size);
      const out = await ImageManipulator.manipulateAsync(working.uri, [{ crop: px }], {
        compress: 0.9,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      output = out.uri;
      if (!active.current) return;
      await onDone({
        uri: out.uri,
        name: name.replace(/\.\w+$/, "") + "-edited.jpg",
        mime: "image/jpeg",
        kind: "image",
        width: out.width,
        height: out.height,
      });
    } catch {
      Alert.alert("Not sent", "The edited photo couldn't be sent. Try again.");
    } finally {
      if (output) await FS.deleteAsync(output, {idempotent:true}).catch(() => undefined);
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <Pressable onPress={onCancel} style={styles.barBtn} accessibilityRole="button">
          <Text style={styles.barText}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>Edit photo</Text>
        <Pressable onPress={undo} disabled={!history.current.length} style={styles.barBtn} accessibilityRole="button">
          <Text style={[styles.barText, !history.current.length && { opacity: 0.4 }]}>Undo</Text>
        </Pressable>
      </View>

      <View style={styles.stage} onLayout={(e: LayoutChangeEvent) => setBox(e.nativeEvent.layout)}>
        {working ? <Image source={{ uri: working.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}
        {crop ? (
          <>
            {/* Dim outside the crop with four bands. */}
            <View pointerEvents="none" style={[styles.dim, { left: 0, right: 0, top: 0, height: crop.y }]} />
            <View pointerEvents="none" style={[styles.dim, { left: 0, right: 0, top: crop.y + crop.height, bottom: 0 }]} />
            <View pointerEvents="none" style={[styles.dim, { left: 0, width: crop.x, top: crop.y, height: crop.height }]} />
            <View pointerEvents="none" style={[styles.dim, { left: crop.x + crop.width, right: 0, top: crop.y, height: crop.height }]} />
            <View
              {...moveResponder.panHandlers}
              accessibilityLabel="Crop area. Drag to move."
              style={[styles.crop, { left: crop.x, top: crop.y, width: crop.width, height: crop.height }]}
            >
              <View style={[styles.third, { left: "33.3%", top: 0, bottom: 0, width: 1 }]} />
              <View style={[styles.third, { left: "66.6%", top: 0, bottom: 0, width: 1 }]} />
              <View style={[styles.third, { top: "33.3%", left: 0, right: 0, height: 1 }]} />
              <View style={[styles.third, { top: "66.6%", left: 0, right: 0, height: 1 }]} />
              <View {...resizeResponder.panHandlers} style={styles.handle} accessibilityLabel="Resize crop" hitSlop={16} />
            </View>
          </>
        ) : null}
      </View>

      <View style={styles.row}>
        {RATIOS.map((r) => {
          const on = aspect === r.value;
          return (
            <Pressable key={r.label} onPress={() => setAspect(r.value)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{r.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.row}>
        <Tool label="Rotate" onPress={() => apply({ rotate: -90 })} disabled={busy} />
        <Tool label="Flip" onPress={() => apply({ flip: ImageManipulator.FlipType.Horizontal })} disabled={busy} />
        <Pressable onPress={done} disabled={busy} accessibilityRole="button" style={[styles.send, busy && { opacity: 0.5 }]}>
          <Text style={styles.sendText}>{busy ? "Working" : "Send"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Tool({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={[styles.tool, disabled && { opacity: 0.5 }]}>
      <Text style={styles.toolText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: c.night },
  bar: { flexDirection: "row", alignItems: "center", paddingTop: 52, paddingHorizontal: space.l, paddingBottom: space.s },
  barBtn: { minWidth: 60, minHeight: 44, justifyContent: "center" },
  barText: { color: c.nightInk, fontSize: 16 },
  title: { flex: 1, textAlign: "center", color: c.nightInk, fontSize: 17, fontWeight: "600" },
  stage: { flex: 1, margin: space.l, overflow: "hidden" },
  dim: { position: "absolute", backgroundColor: "rgba(16,22,28,0.6)" },
  crop: { position: "absolute", borderWidth: 1.5, borderColor: "#fff" },
  third: { position: "absolute", backgroundColor: "rgba(255,255,255,0.45)" },
  handle: { position: "absolute", right: -8, bottom: -8, width: 28, height: 28, borderRightWidth: 4, borderBottomWidth: 4, borderColor: "#fff" },
  row: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: space.s, paddingHorizontal: space.l, paddingBottom: space.m },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: "#3A4956", justifyContent: "center" },
  chipOn: { backgroundColor: c.nightInk, borderColor: c.nightInk },
  chipText: { color: "#C3CED7", fontSize: 13, fontWeight: "600" },
  chipTextOn: { color: c.night },
  tool: { minHeight: 44, paddingHorizontal: space.l, justifyContent: "center", borderRadius: 22, backgroundColor: c.nightSurface },
  toolText: { color: c.nightInk, fontSize: 15, fontWeight: "600" },
  send: { minHeight: 44, paddingHorizontal: space.xl, justifyContent: "center", borderRadius: 22, backgroundColor: c.secure, marginLeft: "auto" },
  sendText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
