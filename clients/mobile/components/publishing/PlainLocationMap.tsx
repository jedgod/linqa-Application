// A clean, plain map of one place: street tiles and a pin, nothing else. No search box, buttons, logos or link footers, and it
// cannot be moved or tapped. Drawn by Leaflet from OpenStreetMap tiles inside a WebView.
//
// Tap the small map to enlarge it: the enlarged map can be moved and zoomed, and closed with the X or the back button.
// Directions open LinqaMapFollowScreen, which draws the driving route from where the person is to the pin and follows them.
// The only text on it is the small "© Linqa Map" credit.

import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MapFrame } from "./LeafletMap";
import LinqaMapFollowScreen from "./LinqaMapFollowScreen";

/**
 * A small, plain map. Tapping it opens a full-screen map that can be moved and zoomed; the same component is used for the
 * publisher (while writing) and for anyone reading the post. `enlargeable={false}` keeps it fixed.
 */
export function PlainLocationMap({ latitude, longitude, height = 200, zoom = 15, enlargeable = true, label, name, directions = true, onEnlarge }: { latitude: number; longitude: number; height?: number; zoom?: number; enlargeable?: boolean; /** The place name, shown in the directions prompt. */ label?: string; /** The program / event name, shown above the address on the enlarged map. */ name?: string; /** Show the Directions buttons (default). */ directions?: boolean; /** Open the enlarged map somewhere else (e.g. inside a screen, under its heading) instead of full screen. */ onEnlarge?: (request: { latitude: number; longitude: number; label?: string; name?: string; autoStart: boolean }) => void }) {
  const [open, setOpen] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  return (
    <View style={{ height }}>
      <MapFrame latitude={latitude} longitude={longitude} height={height} zoom={zoom} interactive={false} />
      {enlargeable ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={() => { if (onEnlarge) onEnlarge({ latitude, longitude, label, name, autoStart: false }); else { setAutoStart(false); setOpen(true); } }} accessibilityRole="button" accessibilityLabel="Enlarge map">
          <View style={styles.expand}><Ionicons name="expand" size={16} color="#17151C" /></View>
        </Pressable>
      ) : null}
      {directions ? (
        <Pressable onPress={() => { if (onEnlarge) onEnlarge({ latitude, longitude, label, name, autoStart: true }); else { setAutoStart(true); setOpen(true); } }} accessibilityRole="button" accessibilityLabel="Get driving directions" hitSlop={6} style={styles.navMini}>
          <Ionicons name="navigate" size={16} color="#FFFFFF" />
        </Pressable>
      ) : null}
      <Modal visible={open} animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent navigationBarTranslucent>
        <SafeAreaProvider>
          {open ? <LinqaMapFollowScreen destination={{ latitude, longitude }} destinationTitle={label} destinationName={name} autoStart={autoStart} showDirections={directions} onClose={() => setOpen(false)} /> : <View style={styles.full} />}
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: "#E9EBE8" },
  navMini: { position: "absolute", top: 44, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: "#2478B7", alignItems: "center", justifyContent: "center" },
  expand: { position: "absolute", top: 8, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.9)", alignItems: "center", justifyContent: "center" },
});
