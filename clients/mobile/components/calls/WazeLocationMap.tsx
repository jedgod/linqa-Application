import React, { useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { WebView } from "react-native-webview";
import { buildWazeMapUrl, isWazeMapNavigation } from "../../config/waze";

/** Waze destination preview with a local place label and no contact identity props. */
export function WazeLocationMap({ latitude, longitude, placeLabel, height: fixedHeight, rounded = true }: { latitude: number; longitude: number; placeLabel: string; /** A fixed height; by default the map sizes itself to the screen. */ height?: number; rounded?: boolean }) {
  const { height } = useWindowDimensions();
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(false);
  const source = useMemo(() => {
    try { return { uri: buildWazeMapUrl(latitude, longitude) }; }
    catch { return null; }
  }, [latitude, longitude]);
  const error = <View style={styles.error}><Text style={styles.text}>{source ? "Waze map could not be loaded." : "Waze map configuration is unavailable."}</Text>{source ? <Pressable accessibilityRole="button" onPress={() => { setFailed(false); setRetry(value => value + 1); }}><Text style={styles.retry}>Retry map</Text></Pressable> : null}</View>;
  return <View style={[styles.map, { height: fixedHeight ?? Math.min(330, Math.max(160, height * 0.4)) }, !rounded && { borderRadius: 0 }]}>
    {!source || failed ? error : Platform.OS === "web" ? React.createElement("iframe", {
      key: `${source.uri}:${retry}`, src: source.uri, title: "Shared location on Waze", referrerPolicy: "no-referrer",
      style: { width: "100%", height: "100%", border: 0, pointerEvents: "none" },
    }) : <WebView
      key={`${source.uri}:${retry}`}
      source={source}
      style={styles.fill}
      pointerEvents="none"
      originWhitelist={["*"]}
      onShouldStartLoadWithRequest={request => isWazeMapNavigation(request.url)}
      onOpenWindow={() => undefined}
      onError={() => setFailed(true)}
      onHttpError={() => setFailed(true)}
      startInLoadingState
      renderLoading={() => <View style={styles.loading}><ActivityIndicator color="#00A6FF" /></View>}
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      geolocationEnabled={false}
      allowsInlineMediaPlayback={false}
      setSupportMultipleWindows={false}
    />}
    {source && !failed ? <View pointerEvents="none" style={styles.pinLabel}><Text numberOfLines={2} style={styles.pinText}>{placeLabel}</Text></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#15212A" }, map: { height: 330, borderRadius: 28, overflow: "hidden", backgroundColor: "#15212A" },
  loading: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: "#15212A" },
  error: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 }, text: { color: "#B5B5B5", textAlign: "center", fontSize: 15 }, retry: { color: "#58BEFF", fontSize: 16, padding: 12 },
  pinLabel: { position: "absolute", top: "32%", alignSelf: "center", maxWidth: "80%", backgroundColor: "#15212AEF", borderRadius: 12, borderWidth: 1, borderColor: "#ffffff30", paddingHorizontal: 14, paddingVertical: 8 }, pinText: { color: "white", fontSize: 14, fontWeight: "600", textAlign: "center" },
});
