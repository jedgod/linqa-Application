// A clean, plain map of one place: street tiles and a pin, nothing else. No search box, buttons, logos or link footers, and it
// cannot be moved or tapped. Drawn by Leaflet from OpenStreetMap tiles inside a WebView.
//
// Tap the small map to enlarge it: the enlarged map can be moved and zoomed, and closed with the X or the back button.
// The only text on it is the small "© Linqa Map" credit.

import React, { useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4";
const TILE_HOST = /^https:\/\/([a-c]\.)?tile\.openstreetmap\.org\//;

function pageFor(latitude: number, longitude: number, zoom: number, interactive: boolean) {
  // Numbers are validated by the caller, so nothing from the user is ever placed into this page as text.
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="${LEAFLET}/leaflet.min.css">
<style>
 html,body,#m{margin:0;height:100%;width:100%;background:#E9EBE8;overflow:hidden}
 .leaflet-control-container .leaflet-control-attribution{font:9px sans-serif;background:rgba(255,255,255,.7);padding:0 4px;margin:0}
 .leaflet-control-attribution a{pointer-events:none;color:#555;text-decoration:none}
 .pin{width:26px;height:26px;margin:-26px 0 0 -13px;background:#D84A59;border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,.35)}
 .pin i{position:absolute;top:6px;left:6px;width:8px;height:8px;border-radius:50%;background:#fff}
</style></head><body><div id="m"></div>
<script src="${LEAFLET}/leaflet.min.js"></script>
<script>
 var map=L.map('m',{zoomControl:false,attributionControl:true,dragging:${interactive},touchZoom:${interactive},doubleClickZoom:${interactive},scrollWheelZoom:false,boxZoom:false,keyboard:false,tap:false})
   .setView([${latitude},${longitude}],${zoom});
 map.attributionControl.setPrefix(false);
 L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,subdomains:'abc',attribution:'© Linqa Map'}).addTo(map);
 L.marker([${latitude},${longitude}],{icon:L.divIcon({className:'',html:'<div class="pin"><i></i></div>',iconSize:[0,0]}),interactive:false,keyboard:false}).addTo(map);
</script></body></html>`;
}

/** The map itself. `interactive` lets it be moved and zoomed (used in the enlarged view only). */
function MapFrame({ latitude, longitude, height, zoom, interactive }: { latitude: number; longitude: number; height?: number | "100%"; zoom: number; interactive: boolean }) {
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(false);
  const valid = Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  const html = useMemo(() => (valid ? pageFor(latitude, longitude, Math.min(18, Math.max(3, Math.round(zoom))), interactive) : ""), [valid, latitude, longitude, zoom, interactive]);

  if (!valid || failed) {
    return (
      <View style={[styles.box, height === "100%" ? { flex: 1 } : { height }, styles.center]}>
        <Text style={styles.hint}>Map unavailable</Text>
        {valid ? <Pressable accessibilityRole="button" onPress={() => { setFailed(false); setRetry((n) => n + 1); }}><Text style={styles.retry}>Try again</Text></Pressable> : null}
      </View>
    );
  }
  return (
    <View style={[styles.box, height === "100%" ? { flex: 1 } : { height }]} pointerEvents={interactive ? "auto" : "none"}>
      <WebView
        key={`${latitude},${longitude},${retry}`}
        source={{ html, baseUrl: "https://linqa.app/" }}
        style={styles.fill}
        originWhitelist={["https://*", "about:*"]}
        // Only the map library and the street tiles may load; any other address is refused.
        onShouldStartLoadWithRequest={(request) => request.url === "https://linqa.app/" || request.url.startsWith("about:") || request.url.startsWith(LEAFLET) || TILE_HOST.test(request.url)}
        onOpenWindow={() => undefined}
        onError={() => setFailed(true)}
        onHttpError={() => setFailed(true)}
        scrollEnabled={interactive}
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        startInLoadingState
        renderLoading={() => <View style={[styles.fill, styles.center]}><ActivityIndicator color="#9A97A6" /></View>}
        sharedCookiesEnabled={false}
        thirdPartyCookiesEnabled={false}
        geolocationEnabled={false}
        allowsInlineMediaPlayback={false}
        setSupportMultipleWindows={false}
      />
    </View>
  );
}

function EnlargedBar({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close map" hitSlop={12} style={[styles.close, { top: insets.top + 10 }]}>
      <Ionicons name="close" size={26} color="#17151C" />
    </Pressable>
  );
}

/**
 * A small, plain map. Tapping it opens a full-screen map that can be moved and zoomed; the same component is used for the
 * publisher (while writing) and for anyone reading the post. `enlargeable={false}` keeps it fixed.
 */
export function PlainLocationMap({ latitude, longitude, height = 200, zoom = 15, enlargeable = true }: { latitude: number; longitude: number; height?: number; zoom?: number; enlargeable?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ height }}>
      <MapFrame latitude={latitude} longitude={longitude} height={height} zoom={zoom} interactive={false} />
      {enlargeable ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Enlarge map">
          <View style={styles.expand}><Ionicons name="expand" size={16} color="#17151C" /></View>
        </Pressable>
      ) : null}
      <Modal visible={open} animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent navigationBarTranslucent>
        <SafeAreaProvider>
          <View style={styles.full}>
            {open ? <MapFrame latitude={latitude} longitude={longitude} height="100%" zoom={zoom} interactive /> : null}
            <EnlargedBar onClose={() => setOpen(false)} />
          </View>
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: "#E9EBE8" },
  close: { position: "absolute", right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", elevation: 6, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  expand: { position: "absolute", top: 8, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.9)", alignItems: "center", justifyContent: "center" },
  box: { width: "100%", backgroundColor: "#E9EBE8", overflow: "hidden" },
  fill: { flex: 1, backgroundColor: "#E9EBE8" },
  center: { alignItems: "center", justifyContent: "center", gap: 8 },
  hint: { color: "#77727F", fontSize: 13 },
  retry: { color: "#6041B8", fontWeight: "700", fontSize: 13 },
});
