// Share a place. The coordinates travel inside the encrypted message; the
// card shows a drawn preview instead of loading map tiles, because fetching
// tiles for a received location would tell the map provider where it is.
// "Open in Maps" hands off to the system maps app only when the user taps it.

import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as ExpoLocation from "expo-location";
import Svg, { Circle, Path, Pattern, Rect, Defs } from "react-native-svg";
import { LocationContent } from "../../content/types";
import { FormShell } from "../../ui/Form";
import { Field, ToggleRow } from "../polls/Poll";
import { palette as light, space } from "../../ui/tokens";
import { Palette, useThemed } from "../../ui/ThreadPalette";

export function LocationComposer({ onSend, onCancel }: { onSend: (l: LocationContent) => Promise<void>; onCancel: () => void }) {
  const { c, styles } = useThemed(makeStyles);
  const [pos, setPos] = useState<ExpoLocation.LocationObject | null>(null);
  const [address, setAddress] = useState<string | undefined>();
  const [label, setLabel] = useState("");
  const [precise, setPrecise] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const perm = await ExpoLocation.requestForegroundPermissionsAsync();
      if (!active) return;
      if (!perm.granted) {
        setError("Allow location access in Settings to share where you are.");
        return;
      }
      const p = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.High });
      if (!active) return;
      setPos(p);
      // Reverse geocoding uses the phone's built-in service, only for the sender.
      const [place] = await ExpoLocation.reverseGeocodeAsync(p.coords).catch(() => []);
      if (place && active) setAddress([place.name, place.street, place.city].filter(Boolean).join(", "));
    })().catch(() => { if (active) setError("Your location isn't available right now. Try again outside or near a window."); });
    return () => { active = false; };
  }, []);

  const send = async () => {
    if (!pos) return;
    setBusy(true);
    // "Approximate" rounds to about 1 km so the exact spot isn't shared.
    const round = (n: number) => (precise ? n : Math.round(n * 100) / 100);
    try {
      await onSend({
        type: "location",
        latitude: round(pos.coords.latitude),
        longitude: round(pos.coords.longitude),
        accuracyM: precise ? Math.round(pos.coords.accuracy ?? 0) || undefined : 1000,
        label: label.trim() || undefined,
        address: precise ? address : address?.split(", ").slice(-1)[0],
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormShell title="Share location" onCancel={onCancel} cta={busy ? "Sending" : "Send location"} ctaDisabled={!pos || busy} onSubmit={send}>
      <View style={styles.form}>
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : !pos ? (
          <View style={styles.loading}>
            <ActivityIndicator color={c.secure} />
            <Text style={styles.hint}>Finding your location</Text>
          </View>
        ) : (
          <>
            <MapPreview height={180} />
            <Text style={styles.coords}>
              {address ?? `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`}
              {pos.coords.accuracy ? `  (within ${Math.round(pos.coords.accuracy)} m)` : ""}
            </Text>
          </>
        )}
        <Field label="Name this place (optional)">
          <TextInput value={label} onChangeText={setLabel} placeholder="North gate" maxLength={120} style={styles.input} accessibilityLabel="Name this place" />
        </Field>
        <View style={styles.card}>
          <ToggleRow label="Share exact spot" hint={precise ? "They see the precise location" : "Shared to about 1 km"} value={precise} onChange={setPrecise} />
        </View>
        <Text style={styles.hint}>This sends where you are right now. It doesn't keep updating.</Text>
      </View>
    </FormShell>
  );
}

export function LocationCard({ loc, outgoing }: { loc: LocationContent; outgoing: boolean }) {
  const { c, styles } = useThemed(makeStyles);
  const open = () => {
    const q = encodeURIComponent(loc.label ?? loc.address ?? "Shared location");
    const url =
      Platform.OS === "ios"
        ? `http://maps.apple.com/?ll=${loc.latitude},${loc.longitude}&q=${q}`
        : `geo:${loc.latitude},${loc.longitude}?q=${loc.latitude},${loc.longitude}(${q})`;
    Linking.openURL(url);
  };
  return (
    <View style={[styles.bubble, outgoing ? styles.bubbleOut : styles.bubbleIn]}>
      <MapPreview height={120} />
      <View style={styles.cardBody}>
        <Text style={[styles.title, outgoing && { color: c.outgoingInk }]}>{loc.label ?? "Shared location"}</Text>
        {loc.address ? <Text style={[styles.sub, outgoing && { color: "#C9DBE0" }]}>{loc.address}</Text> : null}
        {loc.accuracyM && loc.accuracyM >= 1000 ? <Text style={[styles.sub, outgoing && { color: "#C9DBE0" }]}>Approximate area</Text> : null}
      </View>
      <Pressable onPress={open} accessibilityRole="link" style={[styles.openBtn, outgoing && { backgroundColor: "#2B6573" }]}>
        <Text style={[styles.openText, outgoing && { color: c.outgoingInk }]}>Open in Maps</Text>
      </Pressable>
    </View>
  );
}

/** Drawn placeholder: a grid with a pin. No network requests. */
function MapPreview({ height }: { height: number }) {
  return (
    <View style={{ height, borderRadius: 14, overflow: "hidden" }} accessibilityElementsHidden>
      <Svg width="100%" height={height}>
        <Defs>
          <Pattern id="g" width={22} height={22} patternUnits="userSpaceOnUse">
            <Path d="M22 0H0V22" stroke="#C9D7D1" strokeWidth={1} fill="none" />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="#DCE6E2" />
        <Rect width="100%" height="100%" fill="url(#g)" />
        <Circle cx="50%" cy={height / 2} r={18} fill="#96560F" opacity={0.18} />
        <Circle cx="50%" cy={height / 2} r={7} fill="#96560F" stroke="#fff" strokeWidth={2.5} />
      </Svg>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  form: { padding: space.l, gap: space.m },
  loading: { height: 180, alignItems: "center", justifyContent: "center", gap: space.s, backgroundColor: c.surface, borderRadius: 14 },
  coords: { fontSize: 14, color: c.ink },
  input: { minHeight: 44, fontSize: 16, color: c.ink },
  card: { backgroundColor: c.surface, borderRadius: 14, padding: space.l },
  hint: { fontSize: 13, color: c.muted },
  error: { fontSize: 15, color: c.warn, backgroundColor: c.warnSurface, padding: space.l, borderRadius: 12 },
  bubble: { width: 260, borderRadius: 18, padding: 4 },
  bubbleIn: { backgroundColor: c.surface, borderBottomLeftRadius: 6 },
  bubbleOut: { backgroundColor: c.outgoing, borderBottomRightRadius: 6 },
  cardBody: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6 },
  title: { fontSize: 15, fontWeight: "600", color: c.ink },
  sub: { fontSize: 13, color: c.muted },
  openBtn: { margin: 6, marginTop: 2, height: 36, borderRadius: 12, backgroundColor: c.secureTint, alignItems: "center", justifyContent: "center" },
  openText: { fontSize: 14, fontWeight: "600", color: c.secure },
});
