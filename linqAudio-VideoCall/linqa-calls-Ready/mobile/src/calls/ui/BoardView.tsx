import React, { useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { CallEngine } from '../CallEngine';
import { BOARD_LIMITS, pathFor } from '../board';
import { useCalls, useEngineState } from './CallProvider';
import { Icon, theme } from './kit';

const FLUSH_MS = 40;
const WIDTHS = [0.004, 0.008, 0.016];

export function BoardView({ engine, onHide }: { engine: CallEngine; onHide: () => void }) {
  const s = useEngineState(engine);
  const { people } = useCalls();
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [color, setColor] = useState<string>(BOARD_LIMITS.colors[1]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const isOpener = s.board.openedBy === s.self.participantId;

  // Points are buffered and flushed so a fast finger doesn't flood the channel.
  const live = useRef<{ id: string; buf: number[]; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const opts = useRef({ color, width, size });
  opts.current = { color, width, size };

  const flush = () => {
    const l = live.current;
    if (!l || !l.buf.length) return;
    const pts = l.buf.splice(0, BOARD_LIMITS.maxPtsPerMessage);
    engine.drawPoints(l.id, opts.current.color, opts.current.width, pts);
    if (l.buf.length) flush();
  };

  const push = (x: number, y: number) => {
    const l = live.current;
    if (!l) return;
    const { w, h } = opts.current.size;
    l.buf.push(+(x / w).toFixed(4), +(y / h).toFixed(4));
    if (!l.timer) {
      l.timer = setTimeout(() => {
        if (live.current) live.current.timer = undefined;
        flush();
      }, FLUSH_MS);
    }
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        live.current = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, buf: [] };
        push(e.nativeEvent.locationX, e.nativeEvent.locationY);
        flush();
      },
      onPanResponderMove: (e) => push(e.nativeEvent.locationX, e.nativeEvent.locationY),
      onPanResponderRelease: () => end(),
      onPanResponderTerminate: () => end(),
    }),
  ).current;

  function end() {
    const l = live.current;
    if (!l) return;
    clearTimeout(l.timer);
    flush();
    engine.finishStroke(l.id);
    live.current = null;
  }

  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  const openerName = isOpener
    ? 'You'
    : people.displayName(s.peers[s.board.openedBy ?? '']?.userId ?? '');

  return (
    <View style={st.root}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={st.top}>
          <Pressable onPress={onHide} hitSlop={10} accessibilityLabel="Back to call" style={st.topBtn}>
            <Icon name="chevron-down" />
          </Pressable>
          <Text style={st.title} numberOfLines={1}>
            Board · opened by {openerName}
          </Text>
          {isOpener ? (
            <Pressable onPress={() => engine.closeBoard()} hitSlop={10} style={st.endBtn} accessibilityLabel="Close board for everyone">
              <Text style={{ color: theme.danger, fontWeight: '600' }}>Close for all</Text>
            </Pressable>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>

        <View style={st.canvas} onLayout={onLayout} {...responder.panHandlers} accessibilityLabel="Shared board. Draw with one finger.">
          <Svg width={size.w} height={size.h}>
            {s.board.strokes.map((k) => (
              <Path
                key={k.id}
                d={pathFor(k.points, size.w, size.h)}
                stroke={k.color}
                strokeWidth={Math.max(1, k.width * size.w)}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
          </Svg>
        </View>

        <View style={st.tools}>
          {BOARD_LIMITS.colors.map((c) => (
            <Pressable
              key={c}
              onPress={() => setColor(c)}
              accessibilityLabel={`Color ${c}`}
              accessibilityState={{ selected: color === c }}
              style={[st.swatch, { backgroundColor: c }, color === c && st.swatchOn]}
            />
          ))}
          <View style={st.sep} />
          {WIDTHS.map((w) => (
            <Pressable
              key={w}
              onPress={() => setWidth(w)}
              accessibilityLabel={`Pen size ${WIDTHS.indexOf(w) + 1}`}
              style={[st.widthBtn, width === w && { backgroundColor: theme.surfaceHi }]}
            >
              <View style={{ width: 4 + WIDTHS.indexOf(w) * 5, height: 4 + WIDTHS.indexOf(w) * 5, borderRadius: 10, backgroundColor: theme.text }} />
            </Pressable>
          ))}
          <View style={st.sep} />
          <Pressable onPress={() => engine.undoStroke()} accessibilityLabel="Undo my last stroke" style={st.widthBtn}>
            <Icon name="corner-up-left" size={20} />
          </Pressable>
          {isOpener ? (
            <Pressable onPress={() => engine.clearBoard()} accessibilityLabel="Clear board" style={st.widthBtn}>
              <Icon name="trash-2" size={20} />
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

const st = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.bg, zIndex: 150 },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  topBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  endBtn: { paddingHorizontal: 8, paddingVertical: 8 },
  title: { flex: 1, color: theme.text, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  canvas: { flex: 1, margin: 12, borderRadius: 16, backgroundColor: '#15171C', overflow: 'hidden' },
  tools: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
    justifyContent: 'center',
  },
  swatch: { width: 30, height: 30, borderRadius: 15 },
  swatchOn: { borderWidth: 3, borderColor: theme.accent },
  sep: { width: 1, height: 24, backgroundColor: theme.line, marginHorizontal: 4 },
  widthBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
