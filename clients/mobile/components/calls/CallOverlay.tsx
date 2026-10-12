import { BoardView } from "./BoardView";
import { buildMoreMenu, type MoreItem } from "../../services/call-actions/moreMenu";
import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Alert, Platform, Modal, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { callController, type CallState } from "../../services/call-controller";

// Loaded lazily by name: the native video view only exists once the call engine is built into the app.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RTCViewCache: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rtcView(): any {
  if (RTCViewCache === null) {
    try { RTCViewCache = require("react-native-webrtc").RTCView; } catch { RTCViewCache = false; }
  }
  return RTCViewCache || null;
}

export function useCallState(): CallState {
  return useSyncExternalStore(callController.subscribe, callController.getState, callController.getState);
}

function elapsed(since: number | null, now: number): string {
  if (!since) return "00:00";
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

const GREEN = "#3DCE7A";
const RED = "#FF3B30";

/** One round key: an icon on a dark face, lit when it is switched on, with its label underneath. */
function Key({ icon, label, on = false, dim = false, compact = false, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; on?: boolean; dim?: boolean; compact?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label.replace("\n", " ")} accessibilityState={{ selected: on }} onPress={onPress} style={[styles.key, compact && styles.compactKey, dim && { opacity: 0.45 }]}>
      <View style={[styles.keyFace, on && styles.keyOn]}><Ionicons name={icon} size={24} color={on ? "#111214" : "#FFFFFF"} /></View>
      <Text style={styles.keyLabel}>{label}</Text>
    </Pressable>
  );
}

function EndKey({ onPress, compact = false }: { onPress: () => void; compact?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="End call" onPress={onPress} style={[styles.endWrap, compact && styles.compactKey]}>
      <View style={styles.end}><Ionicons name="call" size={26} color="#FFFFFF" style={{ transform: [{ rotate: "135deg" }] }} /></View>
      <Text style={styles.endLabel}>End</Text>
    </Pressable>
  );
}

function NetworkPill({ network }: { network: CallState["network"] }) {
  const colour = network === "Good" ? GREEN : network === "Weak" ? "#F5A524" : RED;
  return (
    <View accessibilityLabel={`Connection ${network}`} style={styles.network}>
      <View style={[styles.networkDot, { backgroundColor: colour }]} />
      <Text style={styles.networkText}>{network}</Text>
    </View>
  );
}

/** The full-screen call: voice and video layouts, ringing, and the Return-to-call bar while minimised. */
export function CallOverlay() {
  const call = useCallState();
  const [now, setNow] = useState(() => Date.now());
  const [boardVisible, setBoardVisible] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportNote, setReportNote] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportCategory, setReportCategory] = useState("HARASSMENT");
  const [moreOpen, setMoreOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (call.phase !== "active") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [call.phase]);
  useEffect(() => {
    if (!call.note) return;
    const id = setTimeout(() => callController.clearNote(), 3500);
    return () => clearTimeout(id);
  }, [call.note]);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(null), 3500); return () => clearTimeout(id); }, [notice]);
  useEffect(() => { if (call.phase === "idle") { setMoreOpen(false); setBoardVisible(false); setReportOpen(false); setReportNote(""); setNotice(null); } }, [call.phase]);

  const RTC = call.phase !== "idle" && (call.callType === "VIDEO" || call.sharingScreen) ? rtcView() : null;
  const video = call.callType === "VIDEO" || call.sharingScreen;
  const live = call.phase !== "idle";
  const time = elapsed(call.connectedAt, now);
  const status = call.phase === "ringing" ? `Incoming ${video ? "video" : "voice"} call`
    : call.phase === "calling" ? "Calling…"
    : call.phase === "connecting" ? "Connecting…"
    : call.phase === "active" ? time
    : call.note ?? "";
  const privacyLine = `End-to-end  ·  ${call.phase === "active" ? time : status}`;
  const visible = (live && !call.minimized) || (!live && Boolean(call.note));
  const initial = (call.peerName || "?").trim().charAt(0).toUpperCase();
  const remoteShown = video && RTC && call.remoteStreamUrl;

  const back = () => {
    if (call.phase === "ringing") void callController.decline();
    else if (live) callController.setMinimized(true);
  };

  const toggleRecord = () => {
    setMoreOpen(false);
    if (call.recording === "on") void callController.stopRecording();
    else callController.requestRecording();
  };

  const menu = buildMoreMenu({ kind: video ? "video" : "voice", cameraOn: video && !call.cameraOff,
    selfViewHasFlip: video, sharingScreen: call.sharingScreen, handRaised: call.handRaised,
    boardOpen: call.board.open, blurOn: false, blurSupported: false, screenShareSupported: Platform.OS === "android",
    participantCount: 2, ringingCount: 0, maxParticipants: 2 }).map(item => {
      if (item.id === "add-person") return { ...item, disabled: true, hint: "Group calling is not enabled yet" };
      if (item.id === "switch-device") return { ...item, disabled: true, hint: "Device handoff is not enabled yet" };
      return item;
    });
  const act = (item: MoreItem) => {
    if (item.disabled || call.phase !== "active") return;
    setMoreOpen(false);
    const run = () => {
      if (item.id === "share-screen") void callController.toggleScreenShare();
      if (item.id === "raise-hand") callController.toggleHand();
      if (item.id === "board") {
        if (call.board.open || callController.boardAction({ t: "board-open", by: "self", at: Date.now() })) setBoardVisible(true);
      }
      if (item.id === "call-info") Alert.alert("Call info", `${video ? "Video" : "Voice"} call\nWith ${call.peerName}\nDuration: ${time}\nConnection: ${call.network}\nMedia: DTLS-SRTP encrypted\nCall ID: ${call.callId}`);
      if (item.id === "report") { setReportNote(""); setReportOpen(true); }
    };
    if (item.confirm) Alert.alert(item.confirm.title, item.confirm.body, [{ text: "Cancel", style: "cancel" }, { text: item.confirm.confirmLabel, onPress: run }]);
    else run();
  };

  const recordingBanner = (
    <>
      {call.recording === "on" ? (
        <View accessibilityLabel="Recording in progress" style={styles.recPill}><View style={styles.recDot} /><Text style={styles.recText}>REC {elapsed(call.recordingStartedAt, now)}</Text></View>
      ) : null}
      {call.recording === "requesting" ? <Text style={styles.note}>Asking {call.peerName || "them"} to allow recording…</Text> : null}
      {call.recordingNote && call.recording !== "asking" ? <Text accessibilityLiveRegion="polite" style={styles.note}>{call.recordingNote}</Text> : null}
      {call.peerHandRaised ? <Text style={styles.note}>{call.peerName} raised a hand</Text> : null}
      {live && call.note ? <Text accessibilityLiveRegion="polite" style={styles.note}>{call.note}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.note}>{notice}</Text> : null}
    </>
  );

  const consent = call.recording === "asking" ? (
    <View accessibilityRole="alert" style={styles.consent}>
      <Text style={styles.consentTitle}>{call.peerName || "They"} wants to record this call</Text>
      <Text style={styles.consentBody}>If you allow it, your phone records your own voice and turns it into text on the device. Transcript lines are shared with the other person over the encrypted call connection. You can stop at any time.</Text>
      <View style={styles.consentRow}>
        <Pressable accessibilityRole="button" onPress={() => void callController.respondRecording(false)} style={[styles.consentButton, { backgroundColor: "#FFFFFF26" }]}><Text style={styles.consentLabel}>Not now</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => void callController.respondRecording(true)} style={[styles.consentButton, { backgroundColor: "#12A150" }]}><Text style={styles.consentLabel}>Allow</Text></Pressable>
      </View>
    </View>
  ) : null;

  const ringing = call.phase === "ringing" ? (
    <View style={styles.ringRow}>
      <Pressable accessibilityRole="button" accessibilityLabel="Decline" onPress={() => void callController.decline()} style={styles.ringItem}>
        <View style={[styles.ringButton, { backgroundColor: RED }]}><Ionicons name="close" size={30} color="#FFFFFF" /></View>
        <Text style={styles.keyLabel}>Decline</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Accept" onPress={() => void callController.accept()} style={styles.ringItem}>
        <View style={[styles.ringButton, { backgroundColor: "#12A150" }]}><Ionicons name={video ? "videocam" : "call"} size={28} color="#FFFFFF" /></View>
        <Text style={styles.keyLabel}>Accept</Text>
      </Pressable>
    </View>
  ) : null;


  return (
    <>
      {live && call.minimized ? (
        <SafeAreaView edges={["top"]} pointerEvents="box-none" style={styles.bannerWrap}>
          <Pressable accessibilityRole="button" accessibilityLabel="Return to call" onPress={() => callController.setMinimized(false)} style={styles.banner}>
            <Ionicons name={video ? "videocam" : "call"} size={16} color="#FFFFFF" />
            <Text style={styles.bannerText} numberOfLines={1}>{call.peerName || "Linqa call"} · {call.phase === "active" ? time : status} · Tap to return</Text>
          </Pressable>
        </SafeAreaView>
      ) : null}

      <Modal visible={visible} animationType="fade" transparent={false} onRequestClose={back}>
        <StatusBar barStyle="light-content" />
        {video && live ? (
          // ---------------------------------------------------------------- video layout
          <View style={[styles.root, { backgroundColor: "#000" }]}>
            {remoteShown ? <RTC streamURL={call.remoteStreamUrl} style={StyleSheet.absoluteFill} objectFit="cover" /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: "#1B1B1B" }]} />}
            <SafeAreaView style={styles.safe}>
              <View style={styles.videoTop}>
                <Pressable accessibilityRole="button" accessibilityLabel="Minimise call" onPress={back} hitSlop={8} style={styles.videoMinimize}>
                  <Ionicons name="chevron-down" size={24} color="#FFFFFF" />
                </Pressable>
                <View style={styles.metaCol}>
                  <Text style={styles.metaLabel}>SIGNAL</Text>
                  <NetworkPill network={call.network} />
                </View>
                <View style={styles.metaCol}>
                  <Text style={styles.metaLabel}>LOCATION</Text>
                  <Text style={styles.location} numberOfLines={2}>{call.peerPlace ? `${call.peerPlace.flag} ${call.peerPlace.name}`.trim() : "—"}</Text>
                </View>
                <View style={styles.videoIdentity}>
                  <Text style={styles.nameBig} numberOfLines={1}>{call.peerName || "Linqa call"}</Text>
                  <Text style={styles.statusGreen}>ðŸ”’  {privacyLine}</Text>
                </View>
              </View>
              <View style={{ alignItems: "center" }}>{recordingBanner}</View>

              {call.localStreamUrl && call.phase !== "ringing" && RTC ? (
                <View style={styles.self}>
                  {call.cameraOff && !call.sharingScreen ? <View style={[StyleSheet.absoluteFill, { backgroundColor: "#333" }]} /> : <RTC streamURL={call.localStreamUrl} style={StyleSheet.absoluteFill} objectFit="cover" mirror={!call.sharingScreen} zOrder={1} />}
                  {!call.sharingScreen ? <Pressable accessibilityRole="button" accessibilityLabel="Flip camera" onPress={() => callController.flipCamera()} style={styles.flip}><Ionicons name="camera-reverse-outline" size={18} color="#FFFFFF" /></Pressable> : null}
                </View>
              ) : null}

              <View style={styles.bottom}>
                {consent}
                {ringing ?? (
                  <View style={styles.bar}>
                    <Key compact icon={call.cameraOff ? "videocam-off" : "videocam"} label={call.cameraOff ? "Video off" : "Video on"} on={!call.cameraOff} onPress={() => callController.toggleCamera()} />
                    <Key compact icon={call.speaker ? "volume-high" : "volume-low"} label="Speaker" on={call.speaker} onPress={() => void callController.toggleSpeaker()} />
                    <EndKey compact onPress={() => void callController.hangUp()} />
                    <Key compact icon={call.muted ? "mic-off" : "mic"} label={call.muted ? "Unmute" : "Mute"} on={call.muted} onPress={() => callController.toggleMute()} />
                    <Key compact icon="ellipsis-horizontal" label="More" onPress={() => setMoreOpen(true)} />
                  </View>
                )}
              </View>
            </SafeAreaView>
          </View>
        ) : (
          // ---------------------------------------------------------------- voice layout (also the "call ended" note)
          <View style={[styles.root, { backgroundColor: "#111214" }]}>
            <SafeAreaView style={styles.safe}>
              <View style={styles.voiceHeader}>
                {live && call.phase !== "ringing" ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Minimise call" onPress={back} hitSlop={12} style={styles.minimize}>
                    <Ionicons name="chevron-down" size={26} color="#FFFFFF" />
                  </Pressable>
                ) : <View style={styles.minimize} />}
                <View style={styles.voiceIdentity}>
                  <Text accessibilityRole="header" style={styles.nameBig} numberOfLines={1}>{call.peerName || "Linqa call"}</Text>
                  <Text accessibilityLiveRegion="polite" style={styles.statusGreen}>{live ? `🔒  ${privacyLine}` : status}</Text>
                  {call.peerPlace && live ? <Text style={styles.place}>{`${call.peerPlace.flag} ${call.peerPlace.name}`.trim()}</Text> : null}
                </View>
                {live && call.phase === "active" ? <NetworkPill network={call.network} /> : <View style={{ width: 36 }} />}
              </View>

              <View style={styles.avatarWrap}>
                <View style={styles.avatar}><Text style={styles.initials}>{call.peerName ? initial : "?"}</Text></View>
                {recordingBanner}
              </View>

              <View style={styles.bottom}>
                {consent}
                {ringing ?? (live ? (
                  <View style={styles.card}>
                    <View style={styles.row}>
                      <Key icon="videocam" label="Video" dim={call.mediaBusy} onPress={() => void callController.toggleCamera()} />
                      <Key icon={call.speaker ? "volume-high" : "volume-low"} label="Speaker" on={call.speaker} onPress={() => void callController.toggleSpeaker()} />
                      <Key icon={call.muted ? "mic-off" : "mic"} label={call.muted ? "Unmute" : "Mute"} on={call.muted} onPress={() => callController.toggleMute()} />
                    </View>
                    <View style={styles.row}>
                      <Key icon="ellipsis-horizontal" label="More" onPress={() => setMoreOpen(true)} />
                      <EndKey onPress={() => void callController.hangUp()} />
                      <Key icon="tv-outline" label={"Share\nscreen"} dim={Platform.OS !== "android" || call.mediaBusy} onPress={() => {
                    if (call.sharingScreen) void callController.toggleScreenShare();
                    else Alert.alert("Share your screen?", "Everyone in this call will see everything on your screen, including notifications, until you stop.", [{ text: "Cancel", style: "cancel" }, { text: "Share", onPress: () => void callController.toggleScreenShare() }]);
                  }} />
                    </View>
                  </View>
                ) : null)}
              </View>
            </SafeAreaView>
          </View>
        )}

        {boardVisible && call.board.open ? <BoardView onHide={() => setBoardVisible(false)} /> : null}
        <Modal visible={reportOpen} transparent animationType="slide" onRequestClose={() => { if (!reportBusy) setReportOpen(false); }}>
          <View style={styles.sheetBackdrop}><View style={styles.sheet}>
            <Text style={styles.sheetLabel}>Report this call</Text>
            <Text style={styles.sheetHint}>Only the call reference and your report are sent. No audio, video, or board content is attached.</Text>
            <ScrollView style={{ maxHeight: 160 }}>{["HARASSMENT", "IMPERSONATION", "THREATS", "SCAM", "SEXUAL_CONTENT", "HATE", "MINOR_SAFETY", "OTHER"].map(category => <Pressable key={category} disabled={reportBusy} onPress={() => setReportCategory(category)} style={styles.sheetRow}><Text style={[styles.sheetLabel, reportCategory === category && { color: GREEN }]}>{category.replaceAll("_", " ")}</Text></Pressable>)}</ScrollView>
            <TextInput accessibilityLabel="Report details" multiline maxLength={1000} value={reportNote} onChangeText={setReportNote} editable={!reportBusy} placeholder="Describe what happened (at least 10 characters)" placeholderTextColor="#aaa" style={{ color: "white", minHeight: 80, padding: 12 }} />
            <Pressable accessibilityRole="button" disabled={reportBusy || reportNote.trim().length < 10} style={styles.sheetRow} onPress={() => {
              setReportBusy(true);
              void callController.report(reportCategory, reportNote.trim()).then(() => { setReportOpen(false); Alert.alert("Report submitted", "Your report has been sent for review."); }).catch(() => Alert.alert("Report not sent", "Please try again.")).finally(() => setReportBusy(false));
            }}><Text style={styles.sheetLabel}>{reportBusy ? "Sending?" : "Submit report"}</Text></Pressable>
            <Pressable disabled={reportBusy} onPress={() => setReportOpen(false)} style={styles.sheetRow}><Text style={styles.sheetLabel}>Cancel</Text></Pressable>
          </View></View>
        </Modal>
        <Modal visible={moreOpen} transparent animationType="slide" onRequestClose={() => setMoreOpen(false)}>
          <Pressable accessibilityLabel="Close menu" onPress={() => setMoreOpen(false)} style={styles.sheetBackdrop}>
            <Pressable accessible={false} onPress={() => undefined} style={styles.sheet}>
              <ScrollView style={{ maxHeight: 340 }}>
              {menu.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ disabled: item.disabled || call.phase !== "active" }} disabled={item.disabled || call.phase !== "active"} onPress={() => act(item)} style={[styles.sheetRow, item.disabled && { opacity: 0.45 }]}><View><Text style={[styles.sheetLabel, item.destructive && { color: RED }]}>{item.label}</Text>{item.hint ? <Text style={styles.sheetHint}>{item.hint}</Text> : null}</View></Pressable>)}
              </ScrollView>
              {call.phase === "active" && call.recordingAvailable ? (
                <Pressable accessibilityRole="button" onPress={toggleRecord} disabled={call.recording === "requesting" || call.recording === "asking"} style={styles.sheetRow}>
                  <Ionicons name={call.recording === "on" ? "stop-circle" : "radio-button-on"} size={24} color={call.recording === "on" ? RED : "#FFFFFF"} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetLabel}>{call.recording === "on" ? "Stop recording" : "Record call"}</Text>
                    <Text style={styles.sheetHint}>{call.recording === "on" ? "Saved to Calls > Recordings" : "The other person has to allow it first"}</Text>
                  </View>
                </Pressable>
              ) : (
                <View style={styles.sheetRow}><Text style={styles.sheetHint}>Recording starts once the call is connected.</Text></View>
              )}
              <Pressable accessibilityRole="button" onPress={() => setMoreOpen(false)} style={styles.sheetRow}><Text style={[styles.sheetLabel, { textAlign: "center", flex: 1 }]}>Close</Text></Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  // voice
  voiceHeader: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  minimize: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  voiceIdentity: { flex: 1, alignItems: "center" },
  nameBig: { color: "#FFFFFF", fontSize: 28, fontWeight: "700" },
  statusGreen: { color: GREEN, marginTop: 4, fontSize: 14 },
  place: { color: "#D0D5DD", marginTop: 4, fontSize: 13 },
  network: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#2A2D33", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  networkDot: { width: 8, height: 8, borderRadius: 4 },
  networkText: { color: "#FFFFFF", fontSize: 13 },
  avatarWrap: { alignItems: "center", marginTop: 36, gap: 8 },
  avatar: { width: 168, height: 168, borderRadius: 84, backgroundColor: "#D9D9D9", alignItems: "center", justifyContent: "center" },
  initials: { fontSize: 56, color: "#243041", fontWeight: "700" },
  bottom: { marginTop: "auto", gap: 12, paddingBottom: 24 },
  card: { marginHorizontal: 18, backgroundColor: "#232428", borderRadius: 28, paddingTop: 18, paddingBottom: 12, gap: 8 },
  row: { flexDirection: "row", justifyContent: "space-evenly", alignItems: "flex-start" },
  key: { width: 88, alignItems: "center" },
  compactKey: { width: undefined, flex: 1, minWidth: 0, maxWidth: 88 },
  keyFace: { width: 54, height: 54, borderRadius: 27, backgroundColor: "#111214", alignItems: "center", justifyContent: "center" },
  keyOn: { backgroundColor: "#FFFFFF" },
  keyLabel: { color: "#ECECEC", textAlign: "center", marginTop: 6, fontSize: 13 },
  endWrap: { width: 88, alignItems: "center" },
  end: { width: 64, height: 64, borderRadius: 32, backgroundColor: RED, alignItems: "center", justifyContent: "center" },
  endLabel: { color: RED, textAlign: "center", marginTop: 6, fontSize: 13, fontWeight: "600" },
  // video
  videoTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", paddingTop: 12, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: "#000", gap: 8 },
  metaCol: { width: 74 },
  videoMinimize: { width: 24, minHeight: 36, justifyContent: "center" },
  metaLabel: { color: "#FFFFFF", fontSize: 11, letterSpacing: 1, marginBottom: 6 },
  location: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  videoIdentity: { flex: 1, alignItems: "flex-end" },
  self: { position: "absolute", right: 16, bottom: 150, width: 132, height: 168, borderRadius: 18, overflow: "hidden", backgroundColor: "#333" },
  flip: { position: "absolute", right: 8, bottom: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: "#111", alignItems: "center", justifyContent: "center" },
  bar: { marginHorizontal: 12, minHeight: 92, borderRadius: 28, backgroundColor: "#1C1E22", flexDirection: "row", alignItems: "center", justifyContent: "space-evenly", paddingVertical: 8 },
  // ringing
  ringRow: { flexDirection: "row", justifyContent: "space-evenly", paddingHorizontal: 24 },
  ringItem: { alignItems: "center" },
  ringButton: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  // recording
  recPill: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#D92D2033", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: "#F04438" },
  recText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  note: { color: "#E4E7EC", fontSize: 13, textAlign: "center", paddingHorizontal: 24, textShadowColor: "#0008", textShadowRadius: 4 },
  consent: { backgroundColor: "#101828F2", borderRadius: 18, padding: 16, gap: 8, marginHorizontal: 12 },
  consentTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "700" },
  consentBody: { color: "#D0D5DD", fontSize: 14, lineHeight: 20 },
  consentRow: { flexDirection: "row", gap: 10, marginTop: 6 },
  consentButton: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  consentLabel: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  // more menu
  sheetBackdrop: { flex: 1, backgroundColor: "#0008", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#232428", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 12, paddingBottom: 28 },
  sheetRow: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 56, paddingHorizontal: 12 },
  sheetLabel: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  sheetHint: { color: "#98A2B3", fontSize: 13 },
  // return-to-call bar
  bannerWrap: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 50 },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#12A150", marginHorizontal: 12, marginTop: 4, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14 },
  bannerText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600", flex: 1 }
});
