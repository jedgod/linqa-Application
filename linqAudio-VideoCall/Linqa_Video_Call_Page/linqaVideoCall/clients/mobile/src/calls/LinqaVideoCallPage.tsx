import { Image, Pressable, StyleSheet, Text, View } from "react-native";

export type CallPrivacy = "End-to-end" | "Relay only";
export type CallNetwork = "Good" | "Weak" | "Reconnecting";

export function LinqaVideoCallPage(props: {
  name: string;
  elapsed: string;
  privacy: CallPrivacy;
  network: CallNetwork;
  countryCode: string;
  countryFlag: string;
  area: string;
  remoteUri?: string;
  selfUri?: string;
  videoOn: boolean;
  speakerOn: boolean;
  muted: boolean;
  onFlipCamera: () => void;
  onToggleVideo: () => void;
  onSpeaker: () => void;
  onMute: () => void;
  onMore: () => void;
  onEnd: () => void;
}) {
  return (
    <View style={styles.screen}>
      <View style={styles.remote}>
        {props.remoteUri ? <Image source={{ uri: props.remoteUri }} style={styles.fill} /> : null}
      </View>

      <View style={styles.top}>
        <View style={styles.signalBlock}>
          <Text style={styles.kicker}>SIGNAL</Text>
          <View style={styles.pill}><Text style={styles.pillText}>{props.network}</Text></View>
        </View>
        <View style={styles.locationBlock}>
          <Text style={styles.kicker}>LOCATION</Text>
          <View style={styles.locationRow}>
            <Text style={styles.flag}>{props.countryFlag}</Text>
            <Text style={styles.area}>{props.area}</Text>
          </View>
        </View>
        <View style={styles.identity}>
          <Text style={styles.name}>{props.name}</Text>
          <Text style={styles.status}>🔒  {props.privacy}  ·  {props.elapsed}</Text>
        </View>
      </View>

      <View style={styles.self}>
        {props.selfUri ? <Image source={{ uri: props.selfUri }} style={styles.fill} /> : <View style={styles.fill} />}
        <Pressable onPress={props.onFlipCamera} style={styles.flip}>
          <Text style={styles.flipIcon}>↻</Text>
        </Pressable>
      </View>

      <View style={styles.bar}>
        <BarKey label={props.videoOn ? "Video on" : "Video off"} active={props.videoOn} onPress={props.onToggleVideo} />
        <BarKey label="Speaker" active={props.speakerOn} onPress={props.onSpeaker} />
        <Pressable onPress={props.onEnd} style={styles.end}>
          <Text style={styles.endIcon}>☎</Text>
          <Text style={styles.endLabel}>End</Text>
        </Pressable>
        <BarKey label={props.muted ? "Muted" : "Mute"} active={props.muted} onPress={props.onMute} />
        <BarKey label="More" onPress={props.onMore} />
      </View>
    </View>
  );
}

function BarKey(props: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={styles.key}>
      <Text style={[styles.keyMark, props.active && styles.keyOn]}>●</Text>
      <Text style={styles.keyLabel}>{props.label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#111" },
  remote: { ...StyleSheet.absoluteFillObject, backgroundColor: "#1b1b1b" },
  fill: { width: "100%", height: "100%" },
  top: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingTop: 54,
    paddingHorizontal: 14,
    backgroundColor: "#000",
    paddingBottom: 10,
  },
  signalBlock: { width: 78 },
  locationBlock: { flex: 1, alignItems: "center" },
  identity: { alignItems: "flex-end", maxWidth: 150 },
  kicker: { color: "#cfcfcf", fontSize: 11, letterSpacing: 1, marginBottom: 4 },
  pill: { backgroundColor: "#ececec", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start" },
  pillText: { color: "#222", fontWeight: "600" },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  flag: { fontSize: 16 },
  area: { color: "#fff", fontWeight: "700", fontSize: 13 },
  name: { color: "#fff", fontSize: 28, fontWeight: "700" },
  status: { color: "#3dce7a", fontSize: 12, marginTop: 2 },
  self: {
    position: "absolute",
    right: 16,
    bottom: 128,
    width: 132,
    height: 168,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#333",
  },
  flip: {
    position: "absolute",
    right: 8,
    bottom: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#111c",
    alignItems: "center",
    justifyContent: "center",
  },
  flipIcon: { color: "#fff" },
  bar: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 24,
    height: 92,
    borderRadius: 28,
    backgroundColor: "#1c1e22",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
  },
  key: { alignItems: "center", width: 64 },
  keyMark: { color: "#9aa", fontSize: 18 },
  keyOn: { color: "#3dce7a" },
  keyLabel: { color: "#fff", fontSize: 12, marginTop: 4 },
  end: { width: 64, alignItems: "center" },
  endIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#ff3b30",
    color: "#fff",
    textAlign: "center",
    lineHeight: 56,
    overflow: "hidden",
  },
  endLabel: { color: "#fff", fontSize: 12, marginTop: 4 },
});
