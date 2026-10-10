// The call screen: video, screen share with annotation on top, and a shared
// whiteboard. Same controls you'd expect from Zoom or Webex, sized for a phone.

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { RTCView } from "react-native-webrtc";
import { captureRef } from "react-native-view-shot";
import { LiveSession, SessionSnapshot } from "./LiveSession";
import { useSharedBoards } from "./useSharedBoards";
import { Style, Tool, WhiteboardCanvas, WhiteboardCanvasHandle } from "../whiteboard/WhiteboardCanvas";
import { WhiteboardToolbar } from "../whiteboard/WhiteboardToolbar";
import { Board, Op } from "../whiteboard/model";
import { PrepareInput } from "../attachments/AttachmentService";
import { palette as c, space } from "../ui/tokens";

type Stage = "call" | "screen" | "board";
const SCREEN_WORLD = 1000;

interface Props {
  session: LiveSession;
  selfId: string;
  selfName: string;
  peerName: string;
  /** Sends a whiteboard snapshot to the chat as an encrypted image. */
  onSaveBoard: (input: PrepareInput) => Promise<void>;
  onLeave: () => void;
}

export function LiveSessionScreen({ session, selfId, selfName, peerName, onSaveBoard, onLeave }: Props) {
  const snap = useSyncExternalStore(
    (fn) => session.subscribe(fn),
    () => session.getSnapshot()
  );
  const shared = useSharedBoards(session, selfId, selfName, peerName);
  const [stage, setStage] = useState<Stage>("call");
  const [annotate, setAnnotate] = useState(false);

  // Jump to the shared screen when the other person starts sharing.
  useEffect(() => {
    if (snap.remoteSharing) setStage("screen");
    else if (stage === "screen" && !snap.sharingScreen) setStage("call");
  }, [snap.remoteSharing]);

  useEffect(() => {
    if (snap.state === "ended") onLeave();
    if (snap.state === "failed") Alert.alert("Call dropped", "The connection was lost.", [{ text: "OK", onPress: onLeave }]);
  }, [snap.state]);

  const toggleShare = async () => {
    if (snap.sharingScreen) return session.stopScreenShare();
    Alert.alert(
      "Share your screen?",
      `${peerName} will see everything on your screen, including notifications, until you stop. Turn on Do Not Disturb first if you can.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Start sharing",
          onPress: async () => {
            const ok = await session.startScreenShare();
            if (!ok) Alert.alert("Not sharing", "Screen sharing didn't start. You may need to allow it in the system prompt.");
          },
        },
      ]
    );
  };

  return (
    <View style={styles.wrap}>
      <Header snap={snap} peerName={peerName} stage={stage} setStage={setStage} />

      <View style={styles.stage}>
        {stage === "call" ? <CallStage snap={snap} peerName={peerName} /> : null}
        {stage === "screen" ? (
          <ScreenStage
            snap={snap}
            peerName={peerName}
            board={shared.boards.screen}
            annotate={annotate}
            setAnnotate={setAnnotate}
            locked={shared.lockedByPeer}
            peers={shared.peers}
            onOps={shared.sendOps("screen")}
            onPointer={shared.sendPointer}
          />
        ) : null}
        {stage === "board" ? (
          <BoardStage
            board={shared.boards.board}
            locked={shared.lockedByPeer}
            lockedByMe={shared.lockedByMe}
            setLocked={shared.setLocked}
            peers={shared.peers}
            onOps={shared.sendOps("board")}
            onPointer={shared.sendPointer}
            onSave={onSaveBoard}
            onBack={() => setStage(snap.remoteSharing || snap.sharingScreen ? "screen" : "call")}
          />
        ) : null}
      </View>

      {stage !== "board" ? (
        <Controls
          snap={snap}
          stage={stage}
          onMic={() => session.setMic(!snap.micOn)}
          onCamera={() => session.setCamera(!snap.cameraOn)}
          onFlip={() => session.flipCamera()}
          onShare={toggleShare}
          onBoard={() => setStage("board")}
          onLeave={() => session.end()}
        />
      ) : null}
    </View>
  );
}

function Header({ snap, peerName, stage, setStage }: { snap: SessionSnapshot; peerName: string; stage: Stage; setStage: (s: Stage) => void }) {
  const status = snap.state === "connected" ? "Encrypted call" : snap.state === "reconnecting" ? "Reconnecting" : "Connecting";
  const tabs: { id: Stage; label: string; show: boolean }[] = [
    { id: "call", label: "Call", show: true },
    { id: "screen", label: snap.sharingScreen ? "Your screen" : `${peerName}'s screen`, show: snap.remoteSharing || snap.sharingScreen },
    { id: "board", label: "Whiteboard", show: true },
  ];
  return (
    <View style={styles.header}>
      <View style={styles.headRow}>
        {snap.sharingScreen ? (
          <View style={styles.live}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>SHARING</Text>
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{peerName}</Text>
          <Text style={[styles.sub, snap.state !== "connected" && { color: c.warnOnNight }]} accessibilityLiveRegion="polite">
            {status}
          </Text>
        </View>
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {tabs.filter((t) => t.show).map((t) => (
          <Pressable key={t.id} onPress={() => setStage(t.id)} accessibilityRole="tab" accessibilityState={{ selected: stage === t.id }} style={[styles.tab, stage === t.id && styles.tabOn]}>
            <Text style={[styles.tabText, stage === t.id && { color: c.night }]} numberOfLines={1}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function CallStage({ snap, peerName }: { snap: SessionSnapshot; peerName: string }) {
  return (
    <View style={styles.fill}>
      {snap.remoteStream ? (
        <RTCView streamURL={snap.remoteStream.toURL()} style={styles.fill} objectFit="cover" />
      ) : (
        <View style={styles.waiting}>
          <Text style={styles.waitText}>Waiting for {peerName}</Text>
        </View>
      )}
      {snap.localStream && snap.cameraOn ? (
        <RTCView streamURL={snap.localStream.toURL()} style={styles.pip} objectFit="cover" mirror zOrder={1} />
      ) : null}
    </View>
  );
}

function ScreenStage(p: {
  snap: SessionSnapshot;
  peerName: string;
  board: Board;
  annotate: boolean;
  setAnnotate: (b: boolean) => void;
  locked: boolean;
  peers: ReturnType<typeof useSharedBoards>["peers"];
  onOps: (ops: Op[]) => void;
  onPointer: (x: number, y: number, laser: boolean) => void;
}) {
  const [tool, setTool] = useState<Tool>("pen");
  const [style, setStyle] = useState<Style>({ color: "#C2410C", width: 4, fill: false, stickyColor: "#FFE48A", fontSize: 22 });
  const [box, setBox] = useState({ width: 0, height: 0 });
  const canvas = useRef<WhiteboardCanvasHandle>(null);
  const version = useSyncExternalStore((f) => p.board.subscribe(f), () => p.board.getVersion());

  if (p.snap.sharingScreen) {
    return (
      <View style={styles.sharingSelf}>
        <Text style={styles.waitText}>You're sharing your screen</Text>
        <Text style={styles.sub}>Switch to the app you want to show. {p.peerName} sees everything on your screen until you stop.</Text>
      </View>
    );
  }
  const stream = p.snap.remoteScreen;
  // Fit a 16:9 frame (or the track's real aspect) inside the stage so the
  // annotation layer covers exactly the video, on both phones.
  const settings = stream?.getVideoTracks()[0]?.getSettings?.() as { width?: number; height?: number } | undefined;
  const aspect = settings?.width && settings?.height ? settings.width / settings.height : 16 / 9;
  const fitW = Math.min(box.width, box.height * aspect);
  const fitH = fitW / aspect;

  return (
    <View style={styles.fill}>
      <View style={styles.fill} onLayout={(e) => setBox(e.nativeEvent.layout)}>
        {stream ? (
          <View style={{ width: fitW, height: fitH, alignSelf: "center", marginTop: (box.height - fitH) / 2 }}>
            <RTCView streamURL={stream.toURL()} style={StyleSheet.absoluteFill} objectFit="contain" />
            <View style={StyleSheet.absoluteFill} pointerEvents={p.annotate ? "auto" : "none"}>
              <WhiteboardCanvas
                ref={canvas}
                board={p.board}
                tool={tool}
                style={style}
                transparent
                fixedCamera
                worldWidth={SCREEN_WORLD}
                readOnly={!p.annotate || p.locked}
                peers={p.peers}
                onOps={p.onOps}
                onPointer={p.onPointer}
              />
            </View>
          </View>
        ) : (
          <View style={styles.waiting}>
            <Text style={styles.waitText}>Loading {p.peerName}'s screen</Text>
          </View>
        )}
      </View>
      {p.annotate ? (
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
          onFit={() => p.setAnnotate(false)}
          canUndo={p.board.canUndo()}
          canRedo={p.board.canRedo()}
          onUndo={() => p.onOps(p.board.undo())}
          onRedo={() => p.onOps(p.board.redo())}
          hasSelection={false}
          onDeleteSelection={() => {}}
          onRecolorSelection={() => {}}
          locked={p.locked}
        />
      ) : null}
      <Pressable onPress={() => p.setAnnotate(!p.annotate)} accessibilityRole="button" style={styles.annotateBtn}>
        <Text style={styles.annotateText}>{p.annotate ? "Done annotating" : "Annotate"}</Text>
      </Pressable>
    </View>
  );
}

function BoardStage(p: {
  board: Board;
  locked: boolean;
  lockedByMe: boolean;
  setLocked: (b: boolean) => void;
  peers: ReturnType<typeof useSharedBoards>["peers"];
  onOps: (ops: Op[]) => void;
  onPointer: (x: number, y: number, laser: boolean) => void;
  onSave: (input: PrepareInput) => Promise<void>;
  onBack: () => void;
}) {
  const [tool, setTool] = useState<Tool>("pen");
  const [style, setStyle] = useState<Style>({ color: "#1C2833", width: 4, fill: false, stickyColor: "#FFE48A", fontSize: 22 });
  const [zoom, setZoom] = useState(1);
  const [hasSel, setHasSel] = useState(false);
  const [saving, setSaving] = useState(false);
  const canvas = useRef<WhiteboardCanvasHandle>(null);
  const shot = useRef<View>(null);
  const version = useSyncExternalStore((f) => p.board.subscribe(f), () => p.board.getVersion());

  const save = async () => {
    if (!p.board.elements().length) return;
    setSaving(true);
    const prev = canvas.current?.getCamera();
    try {
      canvas.current?.fit();
      await new Promise((r) => setTimeout(r, 60)); // let the fitted frame render
      const uri = await captureRef(shot, { format: "png", result: "tmpfile" });
      await p.onSave({ uri, name: "whiteboard.png", mime: "image/png", kind: "image", caption: "Whiteboard" });
      Alert.alert("Saved to chat", "A copy of the whiteboard was sent to the conversation.");
    } catch {
      Alert.alert("Not saved", "The whiteboard couldn't be saved. Try again.");
    } finally {
      if (prev) canvas.current?.setCamera(prev);
      setSaving(false);
    }
  };

  const clear = () =>
    Alert.alert("Clear the whiteboard?", "Clear removes your drawings. Clear all removes everyone's.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear mine", onPress: () => p.onOps(p.board.clear("mine")) },
      ...(p.lockedByMe ? [{ text: "Clear all", style: "destructive" as const, onPress: () => p.onOps(p.board.clear("all")) }] : []),
    ]);

  return (
    <View style={styles.fill}>
      <View style={styles.boardBar}>
        <SmallBtn label="Back to call" onPress={p.onBack} />
        <SmallBtn label={p.lockedByMe ? "Let both draw" : "Only I draw"} onPress={() => p.setLocked(!p.lockedByMe)} disabled={p.locked} />
        <SmallBtn label="Clear" onPress={clear} disabled={p.locked} />
        <SmallBtn label={saving ? "Saving" : "Save to chat"} onPress={save} disabled={saving} />
      </View>
      <View ref={shot} collapsable={false} style={styles.fill}>
        <WhiteboardCanvas
          ref={canvas}
          board={p.board}
          tool={p.locked ? "laser" : tool}
          style={style}
          readOnly={p.locked}
          peers={p.peers}
          onOps={p.onOps}
          onPointer={p.onPointer}
          onSelectionChange={(ids) => setHasSel(ids.length > 0)}
          onCameraChange={(cam) => setZoom(cam.zoom)}
        />
      </View>
      <WhiteboardToolbar
        key={version}
        tool={tool}
        onTool={setTool}
        style={style}
        onStyle={setStyle}
        zoom={zoom}
        onZoomIn={() => canvas.current?.zoomBy(1.25)}
        onZoomOut={() => canvas.current?.zoomBy(0.8)}
        onFit={() => canvas.current?.fit()}
        canUndo={p.board.canUndo()}
        canRedo={p.board.canRedo()}
        onUndo={() => p.onOps(p.board.undo())}
        onRedo={() => p.onOps(p.board.redo())}
        hasSelection={hasSel}
        onDeleteSelection={() => canvas.current?.deleteSelection()}
        onRecolorSelection={(color) => canvas.current?.restyleSelection({ color })}
        locked={p.locked}
      />
    </View>
  );
}

function Controls(p: { snap: SessionSnapshot; stage: Stage; onMic: () => void; onCamera: () => void; onFlip: () => void; onShare: () => void; onBoard: () => void; onLeave: () => void }) {
  return (
    <View style={styles.controls}>
      <Ctl label={p.snap.micOn ? "Mute" : "Unmute"} on={!p.snap.micOn} onPress={p.onMic} />
      <Ctl label={p.snap.cameraOn ? "Camera off" : "Camera on"} on={!p.snap.cameraOn} onPress={p.onCamera} />
      <Ctl label="Flip" onPress={p.onFlip} disabled={!p.snap.cameraOn} />
      <Ctl label={p.snap.sharingScreen ? "Stop share" : "Share screen"} on={p.snap.sharingScreen} onPress={p.onShare} />
      <Ctl label="Whiteboard" onPress={p.onBoard} />
      <Ctl label="Leave" danger onPress={p.onLeave} />
    </View>
  );
}

function Ctl({ label, onPress, on, danger, disabled }: { label: string; onPress: () => void; on?: boolean; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ selected: !!on, disabled: !!disabled }} style={[styles.ctl, on && styles.ctlOn, danger && styles.ctlDanger, disabled && { opacity: 0.4 }]}>
      <Text style={[styles.ctlText, on && { color: c.night }]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

function SmallBtn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={[styles.small, disabled && { opacity: 0.4 }]}>
      <Text style={styles.smallText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: c.night },
  fill: { flex: 1 },
  header: { paddingTop: 52, paddingHorizontal: space.l, paddingBottom: space.s, gap: space.s },
  headRow: { flexDirection: "row", alignItems: "center", gap: space.m },
  live: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: c.danger, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#fff" },
  liveText: { color: "#fff", fontSize: 12, fontWeight: "600", letterSpacing: 0.6 },
  title: { color: c.nightInk, fontSize: 17, fontWeight: "600" },
  sub: { color: c.nightMuted, fontSize: 13, textAlign: "center" },
  tabs: { flexDirection: "row", backgroundColor: c.nightSurface, borderRadius: 12, padding: 4, gap: 4 },
  tab: { flex: 1, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  tabOn: { backgroundColor: c.nightInk },
  tabText: { color: "#C3CED7", fontSize: 13, fontWeight: "600" },
  stage: { flex: 1 },
  waiting: { flex: 1, alignItems: "center", justifyContent: "center" },
  waitText: { color: c.nightInk, fontSize: 16, fontWeight: "600", textAlign: "center" },
  pip: { position: "absolute", right: space.m, bottom: space.m, width: 110, height: 160, borderRadius: 14, overflow: "hidden" },
  sharingSelf: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.s, padding: space.xl },
  annotateBtn: { position: "absolute", top: space.m, right: space.m, backgroundColor: c.nightInk, borderRadius: 18, paddingHorizontal: 14, height: 36, justifyContent: "center" },
  annotateText: { color: c.night, fontWeight: "600", fontSize: 13 },
  boardBar: { flexDirection: "row", gap: space.s, paddingHorizontal: space.m, paddingVertical: space.s, backgroundColor: c.surface },
  small: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1.5, borderColor: c.line, justifyContent: "center" },
  smallText: { fontSize: 13, fontWeight: "600", color: c.ink },
  controls: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: space.m, paddingTop: space.m, paddingBottom: 34, gap: 6 },
  ctl: { flex: 1, minHeight: 56, borderRadius: 14, backgroundColor: c.nightSurface, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  ctlOn: { backgroundColor: c.nightInk },
  ctlDanger: { backgroundColor: c.danger },
  ctlText: { color: c.nightInk, fontSize: 11, fontWeight: "600", textAlign: "center" },
});
