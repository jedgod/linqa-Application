// A clean, plain map of one place: street tiles and a pin, nothing else. No search box, buttons, logos or link footers, and it
// cannot be moved or tapped. Drawn by Leaflet from OpenStreetMap tiles inside a WebView.
//
// Tap the small map to enlarge it: the enlarged map can be moved and zoomed, and closed with the X or the back button.
// Directions draw the driving route from where the person is to the pin on this same map, and follow them as they move.
// The only text on it is the small "© Linqa Map" credit.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import { WebView } from "react-native-webview";
import { distanceText, durationText, fetchRoute, type DrivingRoute } from "./route";

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
 .me{width:18px;height:18px;margin:-9px 0 0 -9px;background:#2478B7;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 6px rgba(36,120,183,.25),0 2px 6px rgba(0,0,0,.35)}
 .pin i{position:absolute;top:6px;left:6px;width:8px;height:8px;border-radius:50%;background:#fff}
</style></head><body><div id="m"></div>
<script src="${LEAFLET}/leaflet.min.js"></script>
<script>
 var map=L.map('m',{zoomControl:false,attributionControl:true,dragging:${interactive},touchZoom:${interactive},doubleClickZoom:${interactive},scrollWheelZoom:false,boxZoom:false,keyboard:false,tap:false})
   .setView([${latitude},${longitude}],${zoom});
 map.attributionControl.setPrefix(false);
 L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,subdomains:'abc',attribution:'© Linqa Map'}).addTo(map);
 L.marker([${latitude},${longitude}],{icon:L.divIcon({className:'',html:'<div class="pin"><i></i></div>',iconSize:[0,0]}),interactive:false,keyboard:false}).addTo(map);
 var routeLine=null,me=null;
 window.setRoute=function(c){ if(routeLine){map.removeLayer(routeLine);routeLine=null;} if(!c||!c.length)return;
   routeLine=L.polyline(c,{color:'#2478B7',weight:6,opacity:.9,lineJoin:'round'}).addTo(map); map.fitBounds(routeLine.getBounds(),{padding:[60,60]}); };
 window.setMe=function(la,lo,follow){ if(!me){me=L.marker([la,lo],{icon:L.divIcon({className:'',html:'<div class="me"></div>',iconSize:[0,0]}),interactive:false,keyboard:false}).addTo(map);} else {me.setLatLng([la,lo]);} if(follow)map.panTo([la,lo],{animate:true}); };
 window.clearRoute=function(){ if(routeLine){map.removeLayer(routeLine);routeLine=null;} if(me){map.removeLayer(me);me=null;} map.setView([${latitude},${longitude}],${zoom}); };
</script></body></html>`;
}

/** The map itself. `interactive` lets it be moved and zoomed (used in the enlarged view only). */
function MapFrame({ latitude, longitude, height, zoom, interactive, route, me }: { latitude: number; longitude: number; height?: number | "100%"; zoom: number; interactive: boolean; route?: DrivingRoute | null; me?: { latitude: number; longitude: number } | null }) {
  const web = useRef<WebView>(null);
  const [loaded, setLoaded] = useState(false);
  const sentRoute = useRef<DrivingRoute | null>(null);
  // The route and the person's dot are pushed into the page whenever they change (and once the page has loaded).
  useEffect(() => {
    if (!loaded || !web.current) return;
    if (route && sentRoute.current !== route) { sentRoute.current = route; web.current.injectJavaScript(`window.setRoute(${JSON.stringify(route.coords)});true;`); }
    if (!route && sentRoute.current) { sentRoute.current = null; web.current.injectJavaScript("window.clearRoute();true;"); }
  }, [route, loaded]);
  useEffect(() => {
    if (loaded && web.current && me && route) web.current.injectJavaScript(`window.setMe(${me.latitude},${me.longitude},true);true;`);
  }, [me, route, loaded]);
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
        ref={web}
        onLoadEnd={() => setLoaded(true)}
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

type Nav =
  | { state: "idle" }
  | { state: "locating" }
  | { state: "routing" }
  | { state: "active"; route: DrivingRoute }
  | { state: "error"; message: string };

/** Finds the person, draws the driving route to the pin and keeps their dot (and the map) following them. */
function useDirections(latitude: number, longitude: number) {
  const [nav, setNav] = useState<Nav>({ state: "idle" });
  const [me, setMe] = useState<{ latitude: number; longitude: number } | null>(null);
  const watcher = useRef<Location.LocationSubscription | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; watcher.current?.remove(); }, []);

  const stop = useCallback(() => { watcher.current?.remove(); watcher.current = null; setMe(null); setNav({ state: "idle" }); }, []);
  const start = useCallback(async () => {
    setNav({ state: "locating" });
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) { if (alive.current) setNav({ state: "error", message: "Allow location access for Linqa to get directions." }); return; }
      const here = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (!alive.current) return;
      setNav({ state: "routing" });
      const route = await fetchRoute({ latitude: here.coords.latitude, longitude: here.coords.longitude }, { latitude, longitude });
      if (!alive.current) return;
      setMe({ latitude: here.coords.latitude, longitude: here.coords.longitude });
      setNav({ state: "active", route });
      watcher.current?.remove();
      watcher.current = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 10 }, (p) => {
        if (alive.current) setMe({ latitude: p.coords.latitude, longitude: p.coords.longitude });
      });
    } catch (error) {
      const message = error instanceof Error && (error.message === "NO_ROUTE" || error.message === "ROUTE_UNAVAILABLE") ? "No driving route was found to this place." : "Could not get directions. Check your connection and try again.";
      if (alive.current) setNav({ state: "error", message });
    }
  }, [latitude, longitude]);
  return { nav, me, start, stop };
}

function DirectionsBar({ nav, onStart, onStop }: { nav: Nav; onStart: () => void; onStop: () => void }) {
  const insets = useSafeAreaInsets();
  const busy = nav.state === "locating" || nav.state === "routing";
  return (
    <View style={[styles.dirBar, { bottom: insets.bottom + 24 }]} pointerEvents="box-none">
      {nav.state === "active" ? (
        <View style={styles.dirCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dirMain}>{durationText(nav.route.seconds)}</Text>
            <Text style={styles.dirSub}>{distanceText(nav.route.meters)} · driving</Text>
          </View>
          <Pressable onPress={onStop} accessibilityRole="button" accessibilityLabel="Stop directions" style={styles.dirStop}><Text style={styles.dirStopText}>Stop</Text></Pressable>
        </View>
      ) : busy ? (
        <View style={styles.dirCard}><ActivityIndicator color="#2478B7" /><Text style={[styles.dirSub, { marginLeft: 12 }]}>{nav.state === "locating" ? "Finding your location…" : "Finding the best route…"}</Text></View>
      ) : (
        <>
          {nav.state === "error" ? <View style={[styles.dirCard, { marginBottom: 10 }]}><Text style={[styles.dirSub, { flex: 1, color: "#B42318" }]}>{nav.message}</Text></View> : null}
          <Pressable onPress={onStart} accessibilityRole="button" accessibilityLabel="Get driving directions" style={styles.directions}>
            <Ionicons name="navigate" size={20} color="#FFFFFF" />
            <Text style={styles.directionsText}>{nav.state === "error" ? "Try again" : "Directions"}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close map" hitSlop={12} style={[styles.close, { top: insets.top + 10 }]}>
      <Ionicons name="close" size={26} color="#17151C" />
    </Pressable>
  );
}

/** The enlarged map: movable and zoomable, with the Directions button. `autoStart` begins the route as soon as it opens. */
function EnlargedMap({ latitude, longitude, zoom, directions, autoStart, onClose }: { latitude: number; longitude: number; zoom: number; directions: boolean; autoStart: boolean; onClose: () => void }) {
  const { nav, me, start, stop } = useDirections(latitude, longitude);
  useEffect(() => { if (autoStart && directions) void start(); }, [autoStart, directions, start]);
  return (
    <View style={styles.full}>
      <MapFrame latitude={latitude} longitude={longitude} height="100%" zoom={zoom} interactive route={nav.state === "active" ? nav.route : null} me={me} />
      {directions ? <DirectionsBar nav={nav} onStart={() => void start()} onStop={stop} /> : null}
      <CloseButton onClose={onClose} />
    </View>
  );
}

/**
 * A small, plain map. Tapping it opens a full-screen map that can be moved and zoomed; the same component is used for the
 * publisher (while writing) and for anyone reading the post. `enlargeable={false}` keeps it fixed.
 */
export function PlainLocationMap({ latitude, longitude, height = 200, zoom = 15, enlargeable = true, label, directions = true }: { latitude: number; longitude: number; height?: number; zoom?: number; enlargeable?: boolean; /** The place name, shown in the directions prompt. */ label?: string; /** Show the Directions buttons (default). */ directions?: boolean }) {
  const [open, setOpen] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  return (
    <View style={{ height }}>
      <MapFrame latitude={latitude} longitude={longitude} height={height} zoom={zoom} interactive={false} />
      {enlargeable ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={() => { setAutoStart(false); setOpen(true); }} accessibilityRole="button" accessibilityLabel="Enlarge map">
          <View style={styles.expand}><Ionicons name="expand" size={16} color="#17151C" /></View>
        </Pressable>
      ) : null}
      {directions ? (
        <Pressable onPress={() => { setAutoStart(true); setOpen(true); }} accessibilityRole="button" accessibilityLabel="Get driving directions" hitSlop={6} style={styles.navMini}>
          <Ionicons name="navigate" size={16} color="#FFFFFF" />
        </Pressable>
      ) : null}
      <Modal visible={open} animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent navigationBarTranslucent>
        <SafeAreaProvider>
          {open ? <EnlargedMap latitude={latitude} longitude={longitude} zoom={zoom} directions={directions} autoStart={autoStart} onClose={() => setOpen(false)} /> : <View style={styles.full} />}
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, backgroundColor: "#E9EBE8" },
  close: { position: "absolute", right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", elevation: 6, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  dirBar: { position: "absolute", left: 16, right: 16, alignItems: "center" },
  dirCard: { flexDirection: "row", alignItems: "center", alignSelf: "stretch", backgroundColor: "#FFFFFF", borderRadius: 18, padding: 16, elevation: 6, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  dirMain: { fontSize: 22, fontWeight: "800", color: "#17151C" },
  dirSub: { fontSize: 14, color: "#4B5563" },
  dirStop: { backgroundColor: "#FEE2E2", borderRadius: 18, paddingHorizontal: 18, paddingVertical: 10 },
  dirStopText: { color: "#B42318", fontWeight: "700" },
  directions: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#2478B7", borderRadius: 26, paddingHorizontal: 22, paddingVertical: 14, elevation: 6, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  directionsText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
  navMini: { position: "absolute", top: 44, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: "#2478B7", alignItems: "center", justifyContent: "center" },
  expand: { position: "absolute", top: 8, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.9)", alignItems: "center", justifyContent: "center" },
  box: { width: "100%", backgroundColor: "#E9EBE8", overflow: "hidden" },
  fill: { flex: 1, backgroundColor: "#E9EBE8" },
  center: { alignItems: "center", justifyContent: "center", gap: 8 },
  hint: { color: "#77727F", fontSize: 13 },
  retry: { color: "#6041B8", fontWeight: "700", fontSize: 13 },
});
