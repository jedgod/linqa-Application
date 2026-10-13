import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getApiBaseUrl } from '../../../config/api';
import { accessTokenProvider } from '../../../services/session';
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
import { CallContactPanel, CallLocationButton } from '../../../components/calls/CallContactPanel';
import { DoubleTapVideo, FloatingCallVideo } from '../../../components/calls/FloatingCallVideo';

type Panel = 'more' | 'add' | 'switch' | 'info' | 'report' | null;
interface PendingConfirm {
  spec: ConfirmSpec;
  run: () => Promise<void> | void;
}

export function CallScreen({ engine }: { engine: CallEngine }) {
  const s = useEngineState(engine);
  const { people } = useCalls();
  const [panel, setPanel] = useState<Panel>(null);
  const [contactVisible, setContactVisible] = useState(false);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [boardVisible, setBoardVisible] = useState(false);
  const [selfMinimized, setSelfMinimized] = useState(false);
  const [selfFullScreen, setSelfFullScreen] = useState(false);
  const [stageBounds, setStageBounds] = useState({ width: 0, height: 0 });
  const [toast, setToast] = useState<string | null>(null);
  const now = useNow(1000, s.status === 'active');
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  // Voice call: the screen can be tucked away behind a small tap-to-return pill while the call keeps running.
  const [minimized, setMinimized] = useState(false);
  // The other person's own verified country (never a guess from their connection). Fetched once they have joined.
  const [place, setPlace] = useState<CallerLocation | null>(null);
  const callId = s.callId;
  const joinedCount = Object.keys(s.peers).length;
  React.useEffect(() => { setPlace(null); setContactVisible(false); setSelfFullScreen(false); setSelfMinimized(false); }, [callId]);
  React.useEffect(() => {
    if (!callId || joinedCount === 0 || place) return;
    let live = true;
    void (async () => {
      try {
        const token = await accessTokenProvider.getAccessToken();
        const response = await fetch(`${getApiBaseUrl()}/v1/calls/${callId}`, { headers: { authorization: `Bearer ${token}` } });
        if (!response.ok || !live) return;
        const details = (await response.json()) as { peerCountryCode?: string | null; peerCountryName?: string | null };
        const code = details.peerCountryCode;
        if (!code || !/^[A-Za-z]{2}$/.test(code) || !details.peerCountryName) return;
        const flag = String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
        if (live) setPlace({ countryCode: code.toUpperCase(), flag, area: details.peerCountryName.toUpperCase() });
      } catch { /* the location line is optional */ }
    })();
    return () => { live = false; };
  }, [callId, joinedCount, place]);

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
  const location: CallerLocation | undefined = (primaryPeerId ? people.location?.(primaryPeerId) : undefined) ?? place ?? undefined;
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
  const canSwap = videoLayout && peers.length === 1 && s.self.cameraOn && !selfMinimized && !sharer && !s.self.sharingScreen;
  const selfIsMain = canSwap && selfFullScreen;
  const swapVideos = canSwap ? () => setSelfFullScreen(value => !value) : undefined;
  const voiceSolo = !videoLayout && peers.length <= 1 && !sharer && !s.handoff;
  const avatarSize = Math.min(screenWidth * 0.5, 230);

  if (minimized && !videoLayout) {
    return (
      <Pressable
        style={[st.returnPill, { top: insets.top + 8 }]}
        onPress={() => setMinimized(false)}
        accessibilityRole="button"
        accessibilityLabel="Return to call"
      >
        <Icon name="phone" size={16} color="#fff" />
        <Text style={st.returnText}>{title} · {status} · Tap to return</Text>
      </Pressable>
    );
  }

  return (
    <View style={st.root}>
      <ScreenSharePicker />
      <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View style={[st.header, videoLayout && st.headerVideo]}>
          {videoLayout ? (
            <>
              <View style={st.signalBlock}>
                <Text style={st.kicker}>SIGNAL</Text>
                <View style={st.pill}><Text style={st.pillText}>{network}</Text></View>
              </View>
              <View style={st.locationBlock}>
                <CallLocationButton flag={location?.flag} area={location?.area} onPress={() => setContactVisible(true)} />
              </View>
              <View style={st.identity}>
                <Text style={st.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{title}</Text>
                <View style={st.statusRow}>
                  <Icon name="lock" size={12} color={theme.ok} />
                  <Text style={st.status} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>End-to-end · {status}</Text>
                </View>
              </View>
            </>
          ) : (
            <>
              <Pressable style={st.minimize} onPress={() => setMinimized(true)} accessibilityRole="button" accessibilityLabel="Minimize call" hitSlop={12}>
                <Icon name="chevron-down" size={30} color="#B8BBC2" />
              </Pressable>
              <View style={st.identityCenter}>
                <Text style={st.titleVoice} numberOfLines={1}>{title}</Text>
                <View style={st.statusRow}>
                  <Icon name="lock" size={14} color={theme.ok} />
                  <Text style={st.statusVoice}>End-to-end · {status}</Text>
                </View>
              </View>
              <View style={st.pillVoice}>
                <Icon name="radio" size={16} color="#3DCE7A" />
                <Text style={st.pillVoiceText}>{network}</Text>
              </View>
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

        {voiceSolo ? (
          <View style={st.voiceStage}>
            <View style={[st.voiceAvatar, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }]}>
              <Text style={st.voiceAvatarText}>{initials(peers[0] ? people.displayName(peers[0].userId) : title)}</Text>
            </View>
            {peers[0] && peers[0].connection !== 'connected' ? <Text style={st.tileState}>{connText(peers[0].connection)}</Text> : null}
            {s.self.handRaisedAt ? (
              <View style={st.selfHandInline}>
                <Icon name="hand" size={16} color={theme.warn} />
                <Text style={st.chipText}>Your hand is raised</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {voiceSolo ? null : (
        <View style={[st.stage, videoLayout && st.stageVideo]} onLayout={event => {
          const { width, height } = event.nativeEvent.layout;
          setStageBounds(previous => previous.width === width && previous.height === height ? previous : { width, height });
        }}>
          {sharer ? (
            <Tile peer={sharer} name={people.displayName(sharer.userId)} hand={handOrder.get(sharer.participantId)} large />
          ) : selfIsMain ? (
            <DoubleTapVideo onSwap={swapVideos}><SelfView engine={engine} minimized={false} onToggle={() => setSelfFullScreen(false)} full hand={handOrder.get(s.self.participantId)} /></DoubleTapVideo>
          ) : (
            <DoubleTapVideo onSwap={swapVideos}><View style={st.grid}>
              {peers.map((p) => (
                <Tile
                  key={p.participantId}
                  peer={p}
                  name={people.displayName(p.userId)}
                  hand={handOrder.get(p.participantId)}
                  count={peers.length}
                  full={videoLayout}
                />
              ))}
              {peers.length === 0
                ? s.ringing.map((u) => <RingingTile key={u} name={people.displayName(u)} />)
                : null}
            </View></DoubleTapVideo>
          )}

          {s.self.cameraOn || s.self.sharingScreen ? (
            <FloatingCallVideo bounds={stageBounds} minimized={selfMinimized} onSwap={swapVideos}>
            {selfIsMain ? <Tile peer={peers[0]} name={people.displayName(peers[0].userId)} hand={handOrder.get(peers[0].participantId)} floating /> : <SelfView
              engine={engine}
              minimized={selfMinimized}
              onToggle={() => setSelfMinimized((m) => !m)}
              hand={handOrder.get(s.self.participantId)}
              embedded
            />}
            </FloatingCallVideo>
          ) : s.self.handRaisedAt ? (
            <View style={st.selfHand}>
              <Icon name="hand" size={16} color={theme.warn} />
              <Text style={st.chipText}>Your hand is raised</Text>
            </View>
          ) : null}
        </View>

        )}

        {toast || s.notice ? <Text style={st.toast}>{toast ?? s.notice}</Text> : null}

        {voiceSolo ? (
          <View style={st.voiceCard}>
            <View style={st.voiceRow}>
              <VoiceKey icon="video" label="Video" onPress={() => attempt(() => engine.setCamera(true))} />
              <VoiceKey icon="volume-2" label="Speaker" active={s.self.speakerOn} onPress={() => engine.setSpeaker(!s.self.speakerOn)} />
              <VoiceKey icon="mic-off" label={s.self.muted ? 'Unmute' : 'Mute'} active={s.self.muted} onPress={() => engine.setMuted(!s.self.muted)} />
            </View>
            <View style={st.voiceRow}>
              <VoiceKey icon="more-horizontal" label="More" onPress={() => setPanel('more')} />
              <View style={st.voiceKey}>
                <Pressable accessibilityRole="button" accessibilityLabel="End call" onPress={() => engine.hangUp()} style={({ pressed }) => [st.voiceEnd, { opacity: pressed ? 0.85 : 1 }]}>
                  <Icon name="phone-off" size={30} color="#fff" />
                </Pressable>
                <Text style={st.voiceEndLabel}>End</Text>
              </View>
              <VoiceKey
                icon="monitor"
                label={s.self.sharingScreen ? 'Stop share' : 'Share\nscreen'}
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
            </View>
          </View>
        ) : (
        <View style={[st.bar, videoLayout && st.barVideo]}>
          <BarButton
            icon={s.self.cameraOn ? 'video' : 'video-off'}
            label={s.self.cameraOn ? 'Video on' : 'Video'}
            active={s.self.cameraOn}
            flat={videoLayout}
            onPress={() => attempt(() => engine.setCamera(!s.self.cameraOn))}
          />
          <BarButton
            icon={s.self.speakerOn ? 'volume-2' : 'volume-1'}
            label="Speaker"
            active={s.self.speakerOn}
            flat={videoLayout}
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
          {videoLayout ? <BarButton icon="phone-off" label="End" danger flat onPress={() => engine.hangUp()} /> : null}
          <BarButton
            icon={s.self.muted ? 'mic-off' : 'mic'}
            label={s.self.muted ? 'Muted' : 'Mute'}
            active={s.self.muted}
            flat={videoLayout}
            onPress={() => engine.setMuted(!s.self.muted)}
          />
          {!videoLayout ? <BarButton icon="phone-off" label="End" danger onPress={() => engine.hangUp()} /> : null}
          <BarButton icon="more-horizontal" label="More" flat={videoLayout} onPress={() => setPanel('more')} />
        </View>
        )}
      </View>

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
      <CallContactPanel visible={contactVisible} onClose={() => setContactVisible(false)} name={primaryPeerId ? people.displayName(primaryPeerId) : title} peerId={primaryPeerId} flag={location?.flag} area={location?.area} avatarUrl={primaryPeerId ? people.avatarUrl?.(primaryPeerId) : undefined} />
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
  full,
  floating,
}: {
  peer: PeerView;
  name: string;
  hand?: number;
  large?: boolean;
  count?: number;
  /** Video layout: one person fills the whole stage, edge to edge. */
  full?: boolean;
  floating?: boolean;
}) {
  const showVideo = peer.cameraOn && peer.streamUrl;
  const basis = large || count <= 1 ? '100%' : count <= 4 ? '48%' : '31%';
  return (
    <View style={[st.tile, { flexBasis: basis, aspectRatio: large || count <= 1 ? undefined : 3 / 4 }, large && { flex: 1 }, full && count <= 1 && st.tileFull, floating && st.embeddedVideo]}>
      {showVideo ? (
        <RTCView
          streamURL={peer.streamUrl!}
          style={StyleSheet.absoluteFill}
          objectFit={peer.screenSharing ? 'contain' : 'cover'}
          zOrder={floating ? 1 : 0}
          pointerEvents="none"
        />
      ) : (
        <View style={st.avatar}>
          <Text style={st.avatarText}>{initials(name)}</Text>
        </View>
      )}
      <View style={st.tileFooter}>
        {peer.muted ? <Icon name="mic-off" size={14} /> : null}
        {full && count <= 1 && showVideo && !peer.screenSharing ? null : (
          <Text style={st.tileName} numberOfLines={1}>
            {name}
            {peer.screenSharing ? ' · sharing screen' : ''}
          </Text>
        )}
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
  full,
  embedded,
}: {
  engine: CallEngine;
  minimized: boolean;
  onToggle: () => void;
  hand?: number;
  full?: boolean;
  embedded?: boolean;
}) {
  const s = useEngineState(engine);
  if (minimized) {
    return (
      <Pressable style={embedded ? st.selfMiniEmbedded : st.selfMini} onPress={onToggle} accessibilityLabel="Show self view">
        <Icon name="user" size={18} />
      </Pressable>
    );
  }
  return (
    <View style={full || embedded ? st.embeddedVideo : st.self}>
      {s.self.previewUrl && !s.self.sharingScreen ? (
        <RTCView
          streamURL={s.self.previewUrl}
          style={StyleSheet.absoluteFill}
          objectFit="cover"
          mirror={s.self.facing === 'user'}
          zOrder={full ? 0 : 1}
          pointerEvents="none"
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
      <Pressable style={st.selfBtnR} onPress={onToggle} accessibilityLabel={full ? "Show other person full screen" : "Hide self view"} hitSlop={8}>
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

function VoiceKey({ icon, label, onPress, active }: { icon: string; label: string; onPress: () => void; active?: boolean }) {
  return (
    <View style={st.voiceKey}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label.replace('\n', ' ')}
        accessibilityState={{ selected: !!active }}
        style={({ pressed }) => [st.voiceIcon, active && st.voiceIconOn, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Icon name={icon} size={40} color={active ? '#FFFFFF' : '#A5A8AF'} />
      </Pressable>
      <Text style={st.voiceLabel}>{label}</Text>
    </View>
  );
}

function BarButton({
  icon,
  label,
  onPress,
  active,
  danger,
  flat,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
  /** Video layout: plain icons on the bar (green when on), only End is a filled circle. */
  flat?: boolean;
}) {
  const bg = danger ? theme.danger : flat ? 'transparent' : active ? theme.text : theme.surfaceHi;
  const fg = danger ? '#fff' : flat ? (active ? '#3DCE7A' : '#FFFFFF') : active ? theme.bg : theme.text;
  return (
    <View style={{ flex: 1, minWidth: 0, maxWidth: 88, alignItems: 'center', gap: 6 }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: !!active }}
        style={({ pressed }) => [st.barBtn, danger && flat && st.endBtn, { backgroundColor: bg, opacity: pressed ? 0.8 : 1 }]}
      >
        <Icon name={icon} size={flat && !danger ? 28 : 24} color={fg} />
      </Pressable>
      <Text style={[st.barLabel, flat && st.barLabelFlat]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{label}</Text>
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
  root: { ...StyleSheet.absoluteFill, backgroundColor: theme.bg, zIndex: 100 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingTop: 12, paddingHorizontal: 14 },
  signalBlock: { width: '20%', maxWidth: 78, minWidth: 52 },
  locationBlock: { width: '29%', maxWidth: 112, minWidth: 0, alignItems: 'center', paddingHorizontal: 4 },
  identity: { flex: 1, minWidth: 0, alignItems: 'flex-end', paddingLeft: 6 },
  kicker: { color: theme.textDim, fontSize: 11, letterSpacing: 1, marginBottom: 4 },
  pill: { backgroundColor: '#ececec', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { color: '#222', fontWeight: '600', fontSize: 13 },
  area: { color: theme.text, fontWeight: '700', fontSize: 13 },
  title: { color: theme.text, fontSize: 22, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  status: { color: theme.ok, fontSize: 12, fontVariant: ['tabular-nums'], flexShrink: 1 },
  minimize: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  identityCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
  titleVoice: { color: '#FFFFFF', fontSize: 30, fontWeight: '700' },
  statusVoice: { color: theme.ok, fontSize: 16, fontVariant: ['tabular-nums'] },
  pillVoice: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#25272C', borderRadius: 22, paddingHorizontal: 14, paddingVertical: 10 },
  pillVoiceText: { color: '#FFFFFF', fontSize: 17 },
  voiceStage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  voiceAvatar: { backgroundColor: '#D4D6DA', alignItems: 'center', justifyContent: 'center' },
  voiceAvatarText: { color: '#243041', fontSize: 64, fontWeight: '700' },
  selfHandInline: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.surfaceHi, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  voiceCard: { backgroundColor: '#232428', borderRadius: 28, marginHorizontal: 16, marginBottom: 12, paddingVertical: 20 },
  voiceRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-around', marginVertical: 8 },
  voiceKey: { width: '30%', alignItems: 'center', gap: 8 },
  voiceIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  voiceIconOn: { backgroundColor: '#3A3D44' },
  voiceLabel: { color: '#C9CCD2', fontSize: 17, textAlign: 'center' },
  voiceEnd: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#E5342D', alignItems: 'center', justifyContent: 'center' },
  voiceEndLabel: { color: '#E5342D', fontSize: 18, fontWeight: '600' },
  returnPill: { position: 'absolute', alignSelf: 'center', zIndex: 120, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#12A150', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
  returnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  headerVideo: { backgroundColor: '#07080A', paddingTop: 10, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flag: { fontSize: 22 },
  stage: { flex: 1, padding: 12 },
  stageVideo: { padding: 0 },
  tileFull: { width: '100%', height: '100%', borderRadius: 0, flexBasis: undefined, flexGrow: 1 },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignContent: 'center', justifyContent: 'center' },
  tile: {
    backgroundColor: theme.surface,
    borderRadius: theme.radius,
    overflow: 'hidden',
    minHeight: 140,
    flexGrow: 0,
  },
  embeddedVideo: { flex: 1, width: '100%', height: '100%', minHeight: 0, flexBasis: undefined, borderRadius: 0, overflow: 'hidden', backgroundColor: theme.surfaceHi },
  selfMiniEmbedded: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
    width: 150,
    height: 196,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: theme.surfaceHi,
    borderWidth: 1,
    borderColor: theme.line,
  },
  selfBtnL: { position: 'absolute', right: 8, bottom: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, padding: 10 },
  selfBtnR: { position: 'absolute', right: 6, top: 6, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 14, padding: 6 },
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
  barLabelFlat: { color: '#FFFFFF', fontSize: 14 },
  barVideo: { backgroundColor: '#14161A', borderRadius: 26, marginHorizontal: 12, marginTop: 10, marginBottom: 8, paddingVertical: 14, alignItems: 'flex-end' },
  endBtn: { width: 68, height: 68, borderRadius: 34 },
});
