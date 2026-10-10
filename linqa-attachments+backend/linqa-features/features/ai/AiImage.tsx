// AI images are the one feature that can't be end-to-end encrypted: the
// prompt has to reach the image service. So it is off until the user turns it
// on for the chat, asks for consent the first time, says so on screen every
// time, and labels the result in the thread. The chosen image itself is
// encrypted like any other photo before it's sent.

import React, { useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { FormShell } from "../../ui/Form";
import { palette as c, space } from "../../ui/tokens";
import { PrepareInput } from "../../attachments/AttachmentService";

export interface AiImageProvider {
  /** Your server endpoint. Returns local file URIs of downloaded results. */
  generate(req: { prompt: string; style: AiStyle; count: number }): Promise<{ uri: string; width: number; height: number }[]>;
}

export type AiStyle = "Photo" | "Watercolor" | "Sketch" | "Diagram";
const STYLES: AiStyle[] = ["Photo", "Watercolor", "Sketch", "Diagram"];

interface Props {
  provider: AiImageProvider;
  /** Persisted per user: has the user accepted the "prompt leaves the device" notice? */
  consented: boolean;
  onConsent: () => void;
  onSend: (input: PrepareInput) => Promise<void>;
  onCancel: () => void;
}

export function AiImageComposer({ provider, consented, onConsent, onSend, onCancel }: Props) {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<AiStyle>("Photo");
  const [results, setResults] = useState<{ uri: string; width: number; height: number }[]>([]);
  const [picked, setPicked] = useState(0);
  const [state, setState] = useState<"idle" | "making" | "sending">("idle");

  const ask = () =>
    new Promise<boolean>((resolve) =>
      Alert.alert(
        "Your prompt leaves this phone",
        "To make the picture, what you type is sent to the image service and isn't end-to-end encrypted. Don't include private details. The image you choose is encrypted before it's sent.",
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "I understand", onPress: () => (onConsent(), resolve(true)) },
        ]
      )
    );

  const make = async () => {
    if (!prompt.trim()) return;
    if (!consented && !(await ask())) return;
    setState("making");
    try {
      const out = await provider.generate({ prompt: prompt.trim(), style, count: 4 });
      setResults(out);
      setPicked(0);
    } catch {
      Alert.alert("No images", "The image service didn't respond. Try again in a moment.");
    } finally {
      setState("idle");
    }
  };

  const send = async () => {
    const img = results[picked];
    if (!img) return;
    setState("sending");
    try {
      await onSend({ uri: img.uri, name: "ai-image.png", mime: "image/png", kind: "image", width: img.width, height: img.height, aiPrompt: `${style}: ${prompt.trim()}` });
    } finally {
      setState("idle");
    }
  };

  return (
    <FormShell
      title="Create an image"
      onCancel={onCancel}
      cta={results.length ? (state === "sending" ? "Sending" : "Send image") : state === "making" ? "Making images" : "Make images"}
      ctaDisabled={state !== "idle" || !prompt.trim()}
      onSubmit={results.length ? send : make}
    >
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <View style={styles.warn} accessibilityRole="alert">
          <Text style={styles.warnText}>Your prompt goes to the image service, so it isn't end-to-end encrypted. The image you pick is encrypted before it's sent.</Text>
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Describe the image</Text>
          <TextInput value={prompt} onChangeText={(t) => (setPrompt(t), setResults([]))} multiline maxLength={1000} placeholder="Watercolor of a lobby in morning light" style={styles.input} accessibilityLabel="Describe the image" />
        </View>
        <View style={styles.chips}>
          {STYLES.map((s) => (
            <Pressable key={s} onPress={() => (setStyle(s), setResults([]))} accessibilityRole="radio" accessibilityState={{ checked: s === style }} style={[styles.chip, s === style && styles.chipOn]}>
              <Text style={[styles.chipText, s === style && { color: c.outgoingInk }]}>{s}</Text>
            </Pressable>
          ))}
        </View>
        {state === "making" ? (
          <View style={styles.making}>
            <ActivityIndicator color={c.secure} />
          </View>
        ) : null}
        {results.length ? (
          <View style={styles.grid}>
            {results.map((r, i) => (
              <Pressable key={r.uri} onPress={() => setPicked(i)} accessibilityRole="radio" accessibilityState={{ checked: picked === i }} accessibilityLabel={`Option ${i + 1}`} style={[styles.tile, picked === i && styles.tileOn]}>
                <Image source={{ uri: r.uri }} style={styles.img} />
              </Pressable>
            ))}
          </View>
        ) : null}
        {results.length ? (
          <Pressable onPress={make} accessibilityRole="button" style={styles.again}>
            <Text style={styles.againText}>Try again</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </FormShell>
  );
}

const styles = StyleSheet.create({
  form: { padding: space.l, gap: space.m },
  warn: { padding: space.m, borderRadius: 12, backgroundColor: c.warnSurface, borderWidth: 1.5, borderStyle: "dashed", borderColor: c.warn },
  warnText: { fontSize: 13, lineHeight: 18, color: "#6E3F0B" },
  field: { backgroundColor: c.surface, borderRadius: 14, padding: space.m },
  label: { fontSize: 12, fontWeight: "600", color: c.muted },
  input: { minHeight: 72, fontSize: 16, color: c.ink, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
  chip: { height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1.5, borderColor: c.line, justifyContent: "center", backgroundColor: c.surface },
  chipOn: { backgroundColor: c.outgoing, borderColor: c.outgoing },
  chipText: { fontSize: 14, fontWeight: "600", color: c.ink },
  making: { height: 160, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.s },
  tile: { width: "48%", aspectRatio: 1, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: c.line },
  tileOn: { borderWidth: 3, borderColor: c.secure },
  img: { width: "100%", height: "100%" },
  again: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  againText: { color: c.secure, fontWeight: "600", fontSize: 15 },
});
