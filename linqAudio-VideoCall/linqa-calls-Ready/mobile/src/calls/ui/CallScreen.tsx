import React, { useMemo, useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { CallEngine, deviceCapabilities, PeerView } from '../CallEngine';
import { buildMoreMenu, ConfirmSpec, confirmAddPerson, MoreItem } from '../moreMenu';
import { LIMITS } from '../protocol';
import type { CallerLocation } from '../ports';
import { errorText } from '../signaling';
import { useCalls, useEngineState } from './CallProvider';
import { ConfirmDialog, formatDuration, Icon, theme, useNow } from './kit';
import { MoreSheet } from './MoreSheet';
import { AddPersonSheet } from './AddPersonSheet';
import { SwitchDeviceSheet } from './SwitchDeviceSheet';
import { CallInfoSheet } from './CallInfoSheet';
import { ReportSheet } from './ReportSheet';
import { BoardView } from './BoardView';
import { ScreenSharePicker } from '../native/ScreenSharePicker';

type Panel = 'more' | 'add' | 'switch' | 'info' | 'report' | null;
interface PendingConfirm {
  spec: ConfirmSpec;
  run: () => Promise<void> | void;
}

export function CallScreen({ engine }: { engine: CallEngine }) {
  const s = useEngineState(engine);
  const { people } = useCalls();
  const [panel, setPanel] = useState<Panel>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [boardVisible, setBoardVisible] = useState(false);
  const [selfMinimized, setSelfMinimized] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const now = useNow(1000, s.status === 'active');

  const peers = Object.values(s.peers);
  const selfViewShown = s.self.cameraOn && !selfMinimized;
  const boardOpen = s.board.open;

  // My own board opens for me; someone else's shows a chip until I tap it.
  React.useEffect(() => {
    if (boardOpen && s.board.openedBy === s.self.participantId) setBoardVisible(true);
    if (!boardOpen) setBoardVisible(false);
  }, [boardOpen, s.board.openedBy, s.self.participantId]);

  const say = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3500);
  };
  const attempt = async (fn: () => Promise<void> | void) => {
    try {
      await fn();
    } catch (e: any) {
      say(e?.code ? errorText(e.code) : 'That did not work. Try again.');
    }
  };

  const items = buildMoreMenu({
    kind: s.kind,
    cameraOn: s.self.cameraOn,
    selfViewHasFlip: selfViewShown,
    sharingScreen: s.self.sharingScreen,
    handRaised: !!s.self.handRaisedAt,
    boardOpen,
    blurOn: s.self.blurOn,
    blurSupported: deviceCapabilities.blur,
    screenShareSupported: deviceCapabilities.screenShare,
    participantCount: peers.length + 1,
    ringingCount: s.ringing.length,
    maxParticipants: LIMITS.maxParticipants,
  });

  const onItem = (item: MoreItem) => {
    setPanel(null);
    switch (item.id) {
      case 'share-screen':
        if (s.self.sharingScreen) return attempt(() => engine.stopScreenShare());
        return setConfirm({ spec: item.confirm!, run: () => engine.startScreenShare() });
      case 'board':
        if (boardOpen) return setBoardVisible(true);
        return setConfirm({ spec: item.confirm!, run: () => engine.openBoard() });
      case 'add-person':
        return setPanel('add'); // confirm comes after picking, with names
      case 'raise-hand':
        return attempt(() => engine.toggleHand());
      case 'flip-camera':
        return attempt(() => engine.flipCamera());
      case 'blur':
        return engine.setBlur(!s.self.blurOn);
      case 'switch-device':
        return setPanel('switch');
      case 'call-info':
        return setPanel('info');
      case 'report':
        return setPanel('report');
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    await attempt(confirm.run);
    setConfirmBusy(false);
    setConfirm(null);
  };

  const handOrder = useMemo(() => {
    const raised = [
      ...peers.filter((p) => p.handRaisedAt).map((p) => ({ id: p.participantId, at: p.handRaisedAt! })),
      ...(s.self.handRaisedAt ? [{ id: s.self.participantId, at: s.self.handRaisedAt }] : []),
    ].sort((a, b) => a.at - b.at);
    return new Map(raised.map((r, i) => [r.id, i + 1]));
  }, [peers, s.self.handRaisedAt, s.self.participantId]);

  const title = peers.length
    ? peers.map((p) => people.displayName(p.userId)).join(', ')
    : s.ringing.length
      ? s.ringing.map((u) => people.displayName(u)).join(', ')
      : 'Call';

  const primaryPeerId = peers[0]?.userId ?? s.ringing[0];
  const location: CallerLocation | undefined = primaryPeerId ? people.location?.(primaryPeerId) : undefined;
  const videoLayout = s.kind === 'video' || s.self.cameraOn;
  const network = s.status === 'connecting' ? 'Reconnecting' : s.status === 'active' ? 'Good' : 'Waiting';
  const status =
    s.status === 'ended'
      ? endedText(s.endReason)
      : s.status === 'switching'
        ? 'Switching device…'
        : s.status === 'waiting'
          ? s.ringing.length ? 'Ringing…' : 'Waiting for others…'
          : s.status === 'connecting'
            ? 'Connecting…'
            : formatDuration(now - (s.connectedAt ?? now));

  const sharer = peers.find((p) => p.screenSharing);

  return (
    <View style={st.root}>
      <ScreenSharePicker />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={st.header}>
          {videoLayout ? (
            <>
              <View style={st.signalBlock}>
                <Text style={st.kicker}>SIGNAL</Text>
                <View style={st.pill}><Text style={st.pillText}>{network}</Text></View>
              </View>
              <View style={st.locationBlock}>
                <Text style={st.kicker}>LOCATION</Text>
                <Text style={st.area} numberOfLines={1}>
                  {location ? `${location.flag}  ${location.area}` : 'Area unavailable'}
                </Text>
              </View>
              <View style={st.identity}>
                <Text style={st.title} numberOfLines={1}>{title}</Text>
                <View style={st.statusRow}>
                  <Icon name="lock" size={12} color={theme.ok} />
                  <Text style={st.status}>End-to-end · {status}</Text>
                </View>
              </View>
            </>
          ) : (
            <>
              <View style={{ width: 36 }} />
              <View style={st.identity}>
                <Text style={st.title} numberOfLines={1}>{title}</Text>
                <View style={st.statusRow}>
                  <Icon name="lock" size={12} color={theme.ok} />
                  <Text style={st.status}>End-to-end · {status}</Text>
                </View>
              </View>
              <View style={st.pill}><Text style={st.pillText}>{network}</Text></View>
            </>
          )}
        </View>

        {boardOpen && !boardVisible ? (
          <Pressable style={st.chip} onPress={() => setBoardVisible(true)} accessibilityRole="button">
            <Icon name="edit-3" size={16} />
            <Text style={st.chipText}>
              {people.displayName(s.peers[s.board.openedBy!]?.userId ?? '')} opened a board · View
            </Text>
          </Pressable>
        ) : null}

        {s.handoff ? (
          <View style={st.banner}>
            <Text style={st.bannerText}>Answer on your other device to move the call there.</Text>
            <Pressable onPress={() => attempt(() => engine.cancelSwitch())} hitSlop={10}>
              <Text style={[st.bannerText, { color: theme.accent, fontWeight: '600' }]}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={st.stage}>
          {sharer ? (
            <Tile peer={sharer} name={people.displayName(sharer.userId)} hand={handOrder.get(sharer.participantId)} large />
          ) : (
            <View style={st.grid}>
              {peers.map((p) => (
                <Tile
                  key={p.participantId}
                  peer={p}
                  name={people.displayName(p.userId)}
                  hand={handOrder.get(p.participantId)}
                  count={peers.length}
                />
              ))}
              {peers.length === 0
                ? s.ringing.map((u) => <RingingTile key={u} name={people.displayName(u)} />)
                : null}
            </View>
          )}

          {s.self.cameraOn || s.self.sharingScreen ? (
            <SelfView
              engine={engine}
              minimized={selfMinimized}
              onToggle={() => setSelfMinimized((m) => !m)}
              hand={handOrder.get(s.self.participantId)}
            />
          ) : s.self.handRaisedAt ? (
            <View style={st.selfHand}>
              <Icon name="hand" size={16} color={theme.warn} />
              <Text style={st.chipText}>Your hand is raised</Text>
            </View>
          ) : null}
        </View>

        {toast || s.notice ? <Text style={st.toast}>{toast ?? s.notice}</Text> : null}

        <View style={st.bar}>
          <BarButton
            icon={s.self.cameraOn ? 'video' : 'video-off'}
            label={s.self.cameraOn ? 'Video on' : 'Video'}
            active={s.self.cameraOn}
            onPress={() => attempt(() => engine.setCamera(!s.self.cameraOn))}
          />
          <BarButton
            icon={s.self.speakerOn ? 'volume-2' : 'volume-1'}
            label="Speaker"
            active={s.self.speakerOn}
            onPress={() => engine.setSpeaker(!s.self.speakerOn)}
          />
          {!videoLayout ? (
            <BarButton
              icon="monitor"
              label={s.self.sharingScreen ? 'Stop share' : 'Share screen'}
              active={s.self.sharingScreen}
              onPress={() => {
                if (s.self.sharingScreen) return attempt(() => engine.stopScreenShare());
                setConfirm({
                  spec: {
                    title: 'Share your screen?',
                    body: 'Everyone in this call will see everything on your screen, including notifications, until you stop.',
                    confirmLabel: 'Share',
                  },
                  run: () => engine.startScreenShare(),
                });
              }}
            />
          ) : null}
          <BarButton
            icon={s.self.muted ? 'mic-off' : 'mic'}
            label={s.self.muted ? 'Muted' : 'Mute'}
            active={s.self.muted}
            onPress={() => engine.setMuted(!s.self.muted)}
          />
          <BarButton icon="phone-off" label="End" danger onPress={() => engine.hangUp()} />
          <BarButton icon="more-horizontal" label="More" onPress={() => setPanel('more')} />
        </View>
      </SafeAreaView>

      {boardVisible && boardOpen ? <BoardView engine={engine} onHide={() => setBoardVisible(false)} /> : null}

      <MoreSheet visible={panel === 'more'} items={items} onClose={() => setPanel(null)} onSelect={onItem} />

      <AddPersonSheet
        visible={panel === 'add'}
        excludeUserIds={[...peers.map((p) => p.userId), ...s.ringing]}
        maxNew={LIMITS.maxParticipants - peers.length - 1 - s.ringing.length}
        onClose={() => setPanel(null)}
        onPicked={(picked) => {
          setPanel(null);
          setConfirm({
            spec: confirmAddPerson(picked.map((p) => p.name), s.self.cameraOn || s.kind === 'video' ? 'video' : 'voice'),
            run: () => engine.addPeople(picked.map((p) => p.userId)),
          });
        }}
      />

      <SwitchDeviceSheet visible={panel === 'switch'} engine={engine} onClose={() => setPanel(null)} />
      <CallInfoSheet visible={panel === 'info'} engine={engine} onClose={() => setPanel(null)} />
      <ReportSheet
        visible={panel === 'report'}
        engine={engine}
        onClose={() => setPanel(null)}
        onDone={(msg) => say(msg)}
      />

      <ConfirmDialog
        visible={!!confirm}
        title={confirm?.spec.title ?? ''}
        body={confirm?.spec.body ?? ''}
        confirmLabel={confirm?.spec.confirmLabel ?? 'OK'}
        busy={confirmBusy}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
    </View>
  );
}

function endedText(reason: string | null): string {
  switch (reason) {
    case 'moved':
      return 'Moved to your other device';
    case 'no-answer':
      return 'No answer';
    case 'declined':
      return 'Declined';
    case 'error':
      return 'Call dropped';
    default:
      return 'Call ended';
  }
}

function Tile({
  peer,
  name,
  hand,
  large,
  count = 1,
}: {
  peer: PeerView;
  name: string;
  hand?: number;
  large?: boolean;
  count?: number;
}) {
  const showVideo = peer.cameraOn && peer.streamUrl;
  const basis = large || count <= 1 ? '100%' : count <= 4 ? '48%' : '31%';
  return (
    <View style={[st.tile, { flexBasis: basis, aspectRatio: large || count <= 1 ? undefined : 3 / 4 }, large && { flex: 1 }]}>
      {showVideo ? (
        <RTCView
          streamURL={peer.streamUrl!}
          style={StyleSheet.absoluteFill}
          objectFit={peer.screenSharing ? 'contain' : 'cover'}
        />
      ) : (
        <View style={st.avatar}>
          <Text style={st.avatarText}>{initials(name)}</Text>
        </View>
      )}
      <View style={st.tileFooter}>
        {peer.muted ? <Icon name="mic-off" size={14} /> : null}
        <Text style={st.tileName} numberOfLines={1}>
          {name}
          {peer.screenSharing ? ' · sharing screen' : ''}
        </Text>
        {peer.connection !== 'connected' ? <Text style={st.tileState}>{connText(peer.connection)}</Text> : null}
      </View>
      {hand ? (
        <View style={st.handBadge} accessibilityLabel={`${name} raised their hand, number ${hand}`}>
          <Icon name="hand" size={14} color={theme.accentText} />
          <Text style={st.handText}>{hand}</Text>
        </View>
      ) : null}
    </View>
  );
}

function RingingTile({ name }: { name: string }) {
  return (
    <View style={[st.tile, { flexBasis: '100%' }]}>
      <View style={st.avatar}>
        <Text style={st.avatarText}>{initials(name)}</Text>
      </View>
      <View style={st.tileFooter}>
        <Text style={st.tileName}>{name} · ringing</Text>
      </View>
    </View>
  );
}

function SelfView({
  engine,
  minimized,
  onToggle,
  hand,
}: {
  engine: CallEngine;
  minimized: boolean;
  onToggle: () => void;
  hand?: number;
}) {
  const s = useEngineState(engine);
  if (minimized) {
    return (
      <Pressable style={st.selfMini} onPress={onToggle} accessibilityLabel="Show self view">
        <Icon name="user" size={18} />
      </Pressable>
    );
  }
  return (
    <View style={st.self}>
      {s.self.previewUrl && !s.self.sharingScreen ? (
        <RTCView
          streamURL={s.self.previewUrl}
          style={StyleSheet.absoluteFill}
          objectFit="cover"
          mirror={s.self.facing === 'user'}
          zOrder={1}
        />
      ) : (
        <View style={st.avatar}>
          <Icon name="monitor" size={20} />
        </View>
      )}
      {/* This is the self-view flip. While it is visible, More does not show Flip camera. */}
      {s.self.cameraOn && !s.self.sharingScreen ? (
        <Pressable style={st.selfBtnL} onPress={() => engine.flipCamera()} accessibilityLabel="Flip camera" hitSlop={8}>
          <Icon name="refresh-cw" size={16} />
        </Pressable>
      ) : null}
      <Pressable style={st.selfBtnR} onPress={onToggle} accessibilityLabel="Hide self view" hitSlop={8}>
        <Icon name="minimize-2" size={16} />
      </Pressable>
      {hand ? (
        <View style={[st.handBadge, { top: 6, left: 6 }]}>
          <Icon name="hand" size={12} color={theme.accentText} />
          <Text style={st.handText}>{hand}</Text>
        </View>
      ) : null}
    </View>
  );
}

function BarButton({
  icon,
  label,
  onPress,
  active,
  danger,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  const bg = danger ? theme.danger : active ? theme.text : theme.surfaceHi;
  const fg = danger ? '#fff' : active ? theme.bg : theme.text;
  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: !!active }}
        style={({ pressed }) => [st.barBtn, { backgroundColor: bg, opacity: pressed ? 0.8 : 1 }]}
      >
        <Icon name={icon} size={24} color={fg} />
      </Pressable>
      <Text style={st.barLabel}>{label}</Text>
    </View>
  );
}

const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

const connText = (c: PeerView['connection']) =>
  c === 'disconnected' ? 'Reconnecting…' : c === 'failed' ? 'Connection lost' : 'Connecting…';

const st = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg, zIndex: 100 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingTop: 12, paddingHorizontal: 14 },
  signalBlock: { width: 78 },
  locationBlock: { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
  identity: { alignItems: 'flex-end', maxWidth: 160 },
  kicker: { color: theme.textDim, fontSize: 11, letterSpacing: 1, marginBottom: 4 },
  pill: { backgroundColor: '#ececec', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { color: '#222', fontWeight: '600', fontSize: 13 },
  area: { color: theme.text, fontWeight: '700', fontSize: 13 },
  title: { color: theme.text, fontSize: 22, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  status: { color: theme.ok, fontSize: 12, fontVariant: ['tabular-nums'] },
  stage: { flex: 1, padding: 12 },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignContent: 'center', justifyContent: 'center' },
  tile: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    overflow: 'hidden',
    minHeight: 140,
    flexGrow: 0,
  },
  avatar: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  avatarText: { color: theme.text, fontSize: 34, fontWeight: '600' },
  tileFooter: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tileName: { color: theme.text, fontSize: 14, fontWeight: '500', flexShrink: 1 },
  tileState: { color: theme.warn, fontSize: 12 },
  handBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.warn,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  handText: { color: theme.accentText, fontWeight: '700', fontSize: 13 },
  self: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 108,
    height: 152,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: theme.surfaceHi,
    borderWidth: 1,
    borderColor: theme.line,
  },
  selfBtnL: { position: 'absolute', left: 6, bottom: 6, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 14, padding: 6 },
  selfBtnR: { position: 'absolute', right: 6, bottom: 6, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 14, padding: 6 },
  selfMini: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.surfaceHi,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selfHand: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.surfaceHi,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chip: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.surfaceHi,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 10,
  },
  chipText: { color: theme.text, fontSize: 14 },
  banner: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: theme.surfaceHi,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bannerText: { color: theme.text, fontSize: 14, flexShrink: 1 },
  toast: {
    alignSelf: 'center',
    color: theme.text,
    backgroundColor: theme.surfaceHi,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    marginBottom: 8,
    overflow: 'hidden',
  },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  barBtn: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  barLabel: { color: theme.textDim, fontSize: 12 },
});
