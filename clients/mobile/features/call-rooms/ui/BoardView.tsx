import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, LayoutChangeEvent, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import Svg, { Defs, G, Path, Pattern, Rect, Text as SvgText } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAccounts } from '../../../account/AccountContext';
import { saveToVault } from '../../../services/vault-save';
import type { CallEngine } from '../CallEngine';
import { BOARD_LIMITS, BRUSHES, fillableAt, pathFor, strokeAt, textAt, type Brush, type Stroke, type TextItem } from '../board';
import { BRUSH_LABELS, BrushSample, StrokeShape } from './boardBrushes';
import {
  apply, clampScale, clampSkew, IDENTITY_VIEW, invert, matrixString, normalizeDegrees, viewMatrix, ZOOM_STEPS, type BoardTransform,
} from './boardView.math';
import { useCalls, useEngineState } from './CallProvider';
import { Icon, theme } from './kit';

const FLUSH_MS = 40;
const WIDTHS = [0.003, 0.006, 0.011, 0.018];
const TEXT_SIZES = [0.035, 0.055, 0.085];
const BOARD_COLOR = '#15171C';
const PALETTE = [
  '#F5F5F7', '#9AA0A6', '#202124', '#FF6B6B', '#E53935', '#FF9F43', '#FFD60A', '#A3E635',
  '#4CD3A5', '#22A06B', '#5AA9FF', '#1D4ED8', '#C08BFF', '#7E3FF2', '#FF7EB6', '#8D6E63',
];

type Tool = 'pencil' | 'eraser' | 'fill' | 'picker' | 'magnifier' | 'text';
type Panel = null | 'brushes' | 'image' | 'save';

/** What I did, so Undo and Redo can reverse it. */
type Act =
  | { k: 'stroke'; stroke: Stroke }
  | { k: 'erase'; stroke: Stroke }
  | { k: 'text'; item: TextItem }
  | { k: 'erase-text'; item: TextItem }
  | { k: 'fill'; strokeId: string | null; prev: string | null; next: string | null };

const TOOLS: Array<{ id: Tool; label: string; key: string; icon: string }> = [
  { id: 'pencil', label: 'Pencil', key: 'P', icon: 'pencil' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: 'eraser' },
  { id: 'fill', label: 'Fill', key: 'B', icon: 'format-color-fill' },
  { id: 'picker', label: 'Colour picker', key: 'I', icon: 'eyedropper' },
  { id: 'magnifier', label: 'Magnifier', key: 'M', icon: 'magnify-plus-outline' },
  { id: 'text', label: 'Text', key: 'T', icon: 'format-text' },
];

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function BoardView({ engine, onHide }: { engine: CallEngine; onHide: () => void }) {
  const s = useEngineState(engine);
  const { people } = useCalls();
  const { active } = useAccounts();
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [tool, setTool] = useState<Tool>('pencil');
  const [brush, setBrush] = useState<Brush>('pen');
  const [color, setColor] = useState<string>(BOARD_LIMITS.colors[1]);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [textSize, setTextSize] = useState(TEXT_SIZES[1]);
  const [view, setView] = useState<BoardTransform>(IDENTITY_VIEW);
  const [transparent, setTransparent] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; value: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const shot = useRef<View>(null);

  const me = s.self.participantId;
  const isOpener = s.board.openedBy === me;
  const board = s.board;

  // Undo and Redo only reverse what this person did.
  const undoStack = useRef<Act[]>([]);
  const redoStack = useRef<Act[]>([]);
  const bump = () => setTick((n) => n + 1);
  const say = (message: string) => {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? null : t)), 2600);
  };
  const record = (act: Act) => {
    undoStack.current.push(act);
    if (undoStack.current.length > 200) undoStack.current.shift();
    redoStack.current = [];
    bump();
  };

  // The responder is created once, so it reads everything through this ref.
  const latest = useRef({ tool, brush, color, width, textSize, view, size, board, me, isOpener });
  latest.current = { tool, brush, color, width, textSize, view, size, board, me, isOpener };

  const live = useRef<{ id: string; buf: number[]; all: number[]; timer?: ReturnType<typeof setTimeout>; brush: Brush; color: string; width: number } | null>(null);
  const gesture = useRef<{ sx: number; sy: number; lx: number; ly: number; moved: boolean; warned: boolean } | null>(null);
  useEffect(() => () => { clearTimeout(live.current?.timer); live.current = null; }, []);

  const toCanvas = (tx: number, ty: number) => {
    const { view: v, size: sz } = latest.current;
    const inv = invert(viewMatrix(v, sz.w, sz.h));
    return inv ? apply(inv, tx, ty) : { x: tx, y: ty };
  };

  const flush = () => {
    const l = live.current;
    if (!l || !l.buf.length) return;
    const pts = l.buf.splice(0, BOARD_LIMITS.maxPtsPerMessage);
    engine.drawPoints(l.id, l.color, l.width, pts, l.brush);
    if (l.buf.length) flush();
  };

  const pushPoint = (cx: number, cy: number) => {
    const l = live.current;
    if (!l) return;
    const { w, h } = latest.current.size;
    const nx = +Math.min(1, Math.max(0, cx / w)).toFixed(4);
    const ny = +Math.min(1, Math.max(0, cy / h)).toFixed(4);
    l.buf.push(nx, ny);
    l.all.push(nx, ny);
    if (!l.timer) {
      l.timer = setTimeout(() => {
        if (live.current) live.current.timer = undefined;
        flush();
      }, FLUSH_MS);
    }
  };

  const finishDrawing = () => {
    const l = live.current;
    if (!l) return;
    clearTimeout(l.timer);
    flush();
    engine.finishStroke(l.id);
    live.current = null;
    const stroke: Stroke = { id: l.id, author: latest.current.me, color: l.color, width: l.width, points: l.all, done: true, brush: l.brush };
    record({ k: 'stroke', stroke });
  };

  const eraseAt = (cx: number, cy: number) => {
    const { board: b, size: sz, view: v, me: who, isOpener: opener } = latest.current;
    const tol = 14 / (v.scale * v.zoom);
    const hit = strokeAt(b.strokes, cx, cy, sz.w, sz.h, tol);
    const textHit = hit ? null : textAt(b.texts, cx, cy, sz.w, sz.h);
    if (hit) {
      if (hit.author !== who && !opener) {
        if (!gesture.current?.warned) { if (gesture.current) gesture.current.warned = true; say('You can only erase your own drawing.'); }
        return;
      }
      engine.sendBoardOp({ t: 'stroke-erase', id: hit.id });
      record({ k: 'erase', stroke: hit });
    } else if (textHit) {
      if (textHit.author !== who && !opener) { say('You can only erase your own text.'); return; }
      engine.sendBoardOp({ t: 'text-remove', id: textHit.id });
      record({ k: 'erase-text', item: textHit });
    }
  };

  const doFill = (cx: number, cy: number) => {
    const { board: b, size: sz, color: c } = latest.current;
    const shape = fillableAt(b.strokes, cx, cy, sz.w, sz.h);
    if (shape) {
      const prev = b.fills[shape.id] ?? null;
      engine.sendBoardOp({ t: 'stroke-fill', id: shape.id, color: c });
      record({ k: 'fill', strokeId: shape.id, prev, next: c });
    } else {
      const prev = b.bg;
      engine.sendBoardOp({ t: 'board-bg', color: c });
      record({ k: 'fill', strokeId: null, prev, next: c });
      setTransparent(false);
    }
  };

  const pickColor = (cx: number, cy: number) => {
    const { board: b, size: sz, view: v } = latest.current;
    const tol = 14 / (v.scale * v.zoom);
    const hit = strokeAt(b.strokes, cx, cy, sz.w, sz.h, tol);
    const textHit = hit ? null : textAt(b.texts, cx, cy, sz.w, sz.h);
    const shape = hit || textHit ? null : fillableAt(b.strokes, cx, cy, sz.w, sz.h);
    const picked = hit?.color ?? textHit?.color ?? (shape ? b.fills[shape.id] : undefined) ?? b.bg ?? BOARD_COLOR;
    if (/^#[0-9a-fA-F]{6}$/.test(picked)) setColor(picked);
    setTool('pencil');
    say('Colour picked');
  };

  const zoomAt = (tx: number, ty: number) => {
    const { view: v, size: sz } = latest.current;
    const point = toCanvas(tx, ty);
    const next = ZOOM_STEPS[(ZOOM_STEPS.indexOf(v.zoom) + 1) % ZOOM_STEPS.length] ?? 1;
    let nv: BoardTransform = { ...v, zoom: next, panX: next === 1 ? 0 : v.panX, panY: next === 1 ? 0 : v.panY };
    if (next !== 1) {
      const moved = apply(viewMatrix(nv, sz.w, sz.h), point.x, point.y);
      nv = { ...nv, panX: nv.panX + tx - moved.x, panY: nv.panY + ty - moved.y };
    }
    setView(nv);
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX: tx, locationY: ty } = e.nativeEvent;
        gesture.current = { sx: tx, sy: ty, lx: tx, ly: ty, moved: false, warned: false };
        const c = toCanvas(tx, ty);
        const t = latest.current.tool;
        if (t === 'pencil') {
          const { brush: bs, color: col, width: wd } = latest.current;
          live.current = { id: uid(), buf: [], all: [], brush: bs, color: col, width: wd };
          pushPoint(c.x, c.y);
          flush();
        } else if (t === 'eraser') {
          eraseAt(c.x, c.y);
        }
      },
      onPanResponderMove: (e) => {
        const g = gesture.current;
        if (!g) return;
        const { locationX: tx, locationY: ty } = e.nativeEvent;
        if (Math.hypot(tx - g.sx, ty - g.sy) > 8) g.moved = true;
        const t = latest.current.tool;
        if (t === 'pencil') {
          const c = toCanvas(tx, ty);
          pushPoint(c.x, c.y);
        } else if (t === 'eraser') {
          const c = toCanvas(tx, ty);
          eraseAt(c.x, c.y);
        } else if (t === 'magnifier' && latest.current.view.zoom > 1) {
          const dx = tx - g.lx;
          const dy = ty - g.ly;
          setView((v) => ({ ...v, panX: v.panX + dx, panY: v.panY + dy }));
        }
        g.lx = tx;
        g.ly = ty;
      },
      onPanResponderRelease: () => end(),
      onPanResponderTerminate: () => end(),
    }),
  ).current;

  function end() {
    const g = gesture.current;
    gesture.current = null;
    const t = latest.current.tool;
    if (t === 'pencil') { finishDrawing(); return; }
    if (!g || g.moved) return;
    const c = toCanvas(g.sx, g.sy);
    if (t === 'fill') doFill(c.x, c.y);
    else if (t === 'picker') pickColor(c.x, c.y);
    else if (t === 'magnifier') zoomAt(g.sx, g.sy);
    else if (t === 'text') {
      const { w, h } = latest.current.size;
      setTextDraft({ x: Math.min(0.98, Math.max(0, c.x / w)), y: Math.min(0.98, Math.max(0.04, c.y / h)), value: '' });
    }
  }

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  /* ---------------- undo / redo ---------------- */

  const readdStroke = useCallback((k: Stroke) => {
    for (let i = 0; i < Math.max(2, k.points.length); i += BOARD_LIMITS.maxPtsPerMessage) {
      engine.drawPoints(k.id, k.color, k.width, k.points.slice(i, i + BOARD_LIMITS.maxPtsPerMessage), k.brush);
    }
    engine.finishStroke(k.id);
  }, [engine]);

  const reverse = (act: Act, forward: boolean) => {
    switch (act.k) {
      case 'stroke':
        if (forward) readdStroke(act.stroke); else engine.sendBoardOp({ t: 'stroke-erase', id: act.stroke.id });
        break;
      case 'erase':
        if (forward) engine.sendBoardOp({ t: 'stroke-erase', id: act.stroke.id }); else readdStroke(act.stroke);
        break;
      case 'text':
        if (forward) engine.sendBoardOp({ t: 'text-add', id: act.item.id, x: act.item.x, y: act.item.y, text: act.item.text, color: act.item.color, size: act.item.size });
        else engine.sendBoardOp({ t: 'text-remove', id: act.item.id });
        break;
      case 'erase-text':
        if (forward) engine.sendBoardOp({ t: 'text-remove', id: act.item.id });
        else engine.sendBoardOp({ t: 'text-add', id: act.item.id, x: act.item.x, y: act.item.y, text: act.item.text, color: act.item.color, size: act.item.size });
        break;
      case 'fill': {
        const value = forward ? act.next : act.prev;
        if (act.strokeId) engine.sendBoardOp({ t: 'stroke-fill', id: act.strokeId, color: value });
        else engine.sendBoardOp({ t: 'board-bg', color: value });
        break;
      }
    }
  };

  const undo = () => {
    const act = undoStack.current.pop();
    if (!act) return;
    reverse(act, false);
    redoStack.current.push(act);
    bump();
  };
  const redo = () => {
    const act = redoStack.current.pop();
    if (!act) return;
    reverse(act, true);
    undoStack.current.push(act);
    bump();
  };

  const addText = () => {
    const d = textDraft;
    setTextDraft(null);
    if (!d || !d.value.trim()) return;
    const item: TextItem = { id: uid(), author: me, x: d.x, y: d.y, text: d.value.trim().slice(0, BOARD_LIMITS.maxTextLength), color, size: textSize };
    engine.sendBoardOp({ t: 'text-add', id: item.id, x: item.x, y: item.y, text: item.text, color: item.color, size: item.size });
    record({ k: 'text', item });
  };

  /* ---------------- save and share ---------------- */

  const exportPng = async (): Promise<string> => {
    const uri = await captureRef(shot, { format: 'png', quality: 1, result: 'tmpfile' });
    return uri;
  };

  const saveToPhone = async () => {
    setBusy(true);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) { say('Allow photo access to save the drawing.'); return; }
      await MediaLibrary.saveToLibraryAsync(await exportPng());
      say('Saved to your phone.');
    } catch { say('The drawing could not be saved. Try again.'); } finally { setBusy(false); setPanel(null); }
  };

  const saveVault = async () => {
    if (!active?.userId) { say('Sign in to save to LinqaVault.'); return; }
    setBusy(true);
    try {
      const { File } = await import('expo-file-system');
      const base64 = await new File(await exportPng()).base64();
      await saveToVault({ accountId: active.userId, plainBase64: base64, details: { name: `whiteboard-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`, mimeType: 'image/png', kind: 'PHOTO' } });
      say('Encrypted and saved to LinqaVault.');
    } catch (e) { say(e instanceof Error ? e.message : 'The vault could not save this drawing.'); } finally { setBusy(false); setPanel(null); }
  };

  const share = async () => {
    setBusy(true);
    try {
      if (!(await Sharing.isAvailableAsync())) { say('Sharing is not available on this phone.'); return; }
      await Sharing.shareAsync(await exportPng(), { mimeType: 'image/png', dialogTitle: 'Share drawing' });
    } catch { say('The drawing could not be shared.'); } finally { setBusy(false); setPanel(null); }
  };

  /* ---------------- drawing ---------------- */

  const { w, h } = size;
  const matrix = viewMatrix(view, w, h);
  const bgColor = board.bg ?? BOARD_COLOR;
  const openerName = isOpener ? 'You' : people.displayName(s.peers[board.openedBy ?? '']?.userId ?? '');
  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;
  const rotate = (deg: number) => setView((v) => ({ ...v, rotation: normalizeDegrees(v.rotation + deg) }));

  return (
    <View style={[st.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={st.top}>
        <Pressable onPress={onHide} hitSlop={10} accessibilityLabel="Back to call" style={st.topBtn}>
          <Icon name="chevron-down" />
        </Pressable>
        <Text style={st.title} numberOfLines={1}>Board · {openerName}</Text>
        <Pressable onPress={undo} disabled={!canUndo} accessibilityLabel="Undo" style={[st.topBtn, !canUndo && st.off]}><MCI name="undo" size={24} color={theme.text} /></Pressable>
        <Pressable onPress={redo} disabled={!canRedo} accessibilityLabel="Redo" style={[st.topBtn, !canRedo && st.off]}><MCI name="redo" size={24} color={theme.text} /></Pressable>
        <Pressable onPress={() => setPanel('save')} accessibilityLabel="Save or share" style={st.topBtn}><MCI name="content-save-outline" size={24} color={theme.text} /></Pressable>
        {isOpener ? (
          <Pressable
            onPress={() => Alert.alert('Close the board?', 'The board closes for everyone and the drawing is cleared. Save it first if you want to keep it.', [
              { text: 'Cancel', style: 'cancel' }, { text: 'Close for all', style: 'destructive', onPress: () => engine.closeBoard() },
            ])}
            accessibilityLabel="Close board for everyone"
            style={st.topBtn}
          ><Icon name="x-circle" size={22} color={theme.danger} /></Pressable>
        ) : null}
      </View>

      <View style={st.canvas} onLayout={onLayout} {...responder.panHandlers} accessibilityLabel="Shared board. Draw with one finger.">
        {transparent ? (
          <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
              <Pattern id="chk" width="24" height="24" patternUnits="userSpaceOnUse">
                <Rect width="24" height="24" fill="#2A2D34" />
                <Rect width="12" height="12" fill="#3A3E47" />
                <Rect x="12" y="12" width="12" height="12" fill="#3A3E47" />
              </Pattern>
            </Defs>
            <Rect width={w} height={h} fill="url(#chk)" />
          </Svg>
        ) : null}
        <View ref={shot} collapsable={false} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width={w} height={h}>
            {!transparent ? <Rect width={w} height={h} fill={bgColor} /> : null}
            <G transform={matrixString(matrix)}>
              {board.strokes.map((k) => (board.fills[k.id] ? <Path key={`f${k.id}`} d={`${pathFor(k.points, w, h)} Z`} fill={board.fills[k.id]} stroke="none" /> : null))}
              {board.strokes.map((k) => <StrokeShape key={k.id} k={k} w={w} h={h} />)}
              {board.texts.map((t) => (
                <SvgText key={t.id} x={t.x * w} y={t.y * h} fill={t.color} fontSize={t.size * w} fontWeight="600">{t.text}</SvgText>
              ))}
            </G>
          </Svg>
        </View>
        {view.zoom > 1 ? <View style={st.zoomTag} pointerEvents="none"><Text style={st.zoomText}>{view.zoom}×</Text></View> : null}
        {toast ? <Text style={st.toast} pointerEvents="none">{toast}</Text> : null}
      </View>

      <View style={st.toolRow}>
        {TOOLS.map((t) => (
          <Pressable key={t.id} onPress={() => setTool(t.id)} accessibilityRole="button" accessibilityLabel={`${t.label} (${t.key})`} accessibilityState={{ selected: tool === t.id }} style={[st.tool, tool === t.id && st.toolOn]}>
            <MCI name={t.icon as never} size={24} color={tool === t.id ? theme.accentText : theme.text} />
            <Text style={[st.toolKey, tool === t.id && { color: theme.accentText }]}>{t.label}{'\n'}({t.key})</Text>
          </Pressable>
        ))}
      </View>

      <View style={st.optionRow}>
        <Pressable onPress={() => setPanel('brushes')} accessibilityRole="button" accessibilityLabel={`Brush: ${BRUSH_LABELS[brush]}`} style={st.brushBtn}>
          <Svg width={72} height={28}><BrushSample brush={brush} color={color} /></Svg>
          <Text style={st.brushName} numberOfLines={1}>{BRUSH_LABELS[brush]}</Text>
        </Pressable>
        <Pressable onPress={() => setPanel('image')} accessibilityRole="button" accessibilityLabel="Image: rotate, resize, skew, background" style={st.imageBtn}>
          <MCI name="image-edit-outline" size={22} color={theme.text} /><Text style={st.imageText}>Image</Text>
        </Pressable>
        {isOpener ? (
          <Pressable onPress={() => Alert.alert('Clear the board?', 'This removes everything on the board for everyone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: () => { engine.clearBoard(); undoStack.current = []; redoStack.current = []; bump(); } }])} accessibilityLabel="Clear board" style={st.imageBtn}>
            <Icon name="trash-2" size={20} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.colorsScroll} contentContainerStyle={st.colors}>
        {PALETTE.map((c) => (
          <Pressable key={c} onPress={() => setColor(c)} accessibilityLabel={`Colour ${c}`} accessibilityState={{ selected: color === c }} style={[st.swatch, { backgroundColor: c }, color === c && st.swatchOn]} />
        ))}
        <View style={st.sep} />
        {(tool === 'text' ? TEXT_SIZES : WIDTHS).map((v, i) => {
          const chosen = tool === 'text' ? textSize === v : width === v;
          return (
            <Pressable key={v} onPress={() => (tool === 'text' ? setTextSize(v) : setWidth(v))} accessibilityLabel={`${tool === 'text' ? 'Text' : 'Size'} ${i + 1}`} style={[st.widthBtn, chosen && { backgroundColor: theme.surfaceHi }]}>
              <View style={{ width: 5 + i * 5, height: 5 + i * 5, borderRadius: 10, backgroundColor: theme.text }} />
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Brushes */}
      <Modal visible={panel === 'brushes'} transparent animationType="slide" onRequestClose={() => setPanel(null)}>
        <Pressable style={st.backdrop} onPress={() => setPanel(null)}>
          <Pressable accessible={false} style={[st.sheet, { paddingBottom: 18 + insets.bottom }]} onPress={() => undefined}>
            <Text accessibilityRole="header" style={st.sheetTitle}>Brushes</Text>
            {BRUSHES.map((b) => (
              <Pressable key={b} onPress={() => { setBrush(b); setTool('pencil'); setPanel(null); }} accessibilityRole="button" accessibilityState={{ selected: brush === b }} style={[st.brushRow, brush === b && st.brushRowOn]}>
                <Svg width={72} height={28}><BrushSample brush={b} color={color} /></Svg>
                <Text style={st.sheetText}>{BRUSH_LABELS[b]}</Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Image: rotate, resize, skew, background */}
      <Modal visible={panel === 'image'} transparent animationType="slide" onRequestClose={() => setPanel(null)}>
        <Pressable style={st.backdrop} onPress={() => setPanel(null)}>
          <Pressable accessible={false} style={[st.sheet, { paddingBottom: 18 + insets.bottom }]} onPress={() => undefined}>
            <Text accessibilityRole="header" style={st.sheetTitle}>Image</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={st.hint}>These change how the drawing looks on your phone and in what you save. Everyone else keeps their own view.</Text>
            <View style={st.row}>
              <Chip label="Rotate left 90°" icon="rotate-left" onPress={() => rotate(-90)} />
              <Chip label="Rotate right 90°" icon="rotate-right" onPress={() => rotate(90)} />
              <Chip label="Rotate 180°" icon="rotate-3d-variant" onPress={() => rotate(180)} />
            </View>
            <Stepper label="Custom rotate" value={`${Math.round(view.rotation)}°`} steps={[['−15', () => rotate(-15)], ['−1', () => rotate(-1)], ['+1', () => rotate(1)], ['+15', () => rotate(15)]]} />
            <Stepper label="Resize" value={`${Math.round(view.scale * 100)}%`} steps={[['−10%', () => setView((v) => ({ ...v, scale: clampScale(v.scale - 0.1) }))], ['+10%', () => setView((v) => ({ ...v, scale: clampScale(v.scale + 0.1) }))]]} />
            <Stepper label="Skew across" value={`${Math.round(view.skewX)}°`} steps={[['−5', () => setView((v) => ({ ...v, skewX: clampSkew(v.skewX - 5) }))], ['+5', () => setView((v) => ({ ...v, skewX: clampSkew(v.skewX + 5) }))]]} />
            <Stepper label="Skew down" value={`${Math.round(view.skewY)}°`} steps={[['−5', () => setView((v) => ({ ...v, skewY: clampSkew(v.skewY - 5) }))], ['+5', () => setView((v) => ({ ...v, skewY: clampSkew(v.skewY + 5) }))]]} />
            <View style={st.row}>
              <Chip label={transparent ? 'Restore background' : 'Remove background'} icon={transparent ? 'image-filter-hdr' : 'image-off-outline'} onPress={() => setTransparent((t) => !t)} />
              <Chip label="Reset view" icon="restore" onPress={() => { setView(IDENTITY_VIEW); setTransparent(false); }} />
            </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Save and share */}
      <Modal visible={panel === 'save'} transparent animationType="slide" onRequestClose={() => setPanel(null)}>
        <Pressable style={st.backdrop} onPress={() => (busy ? undefined : setPanel(null))}>
          <Pressable accessible={false} style={[st.sheet, { paddingBottom: 18 + insets.bottom }]} onPress={() => undefined}>
            <Text accessibilityRole="header" style={st.sheetTitle}>Save or share</Text>
            <Text style={st.hint}>{transparent ? 'The background is removed, so the picture is saved with a transparent background.' : 'Saves the drawing as a picture, as you see it now.'}</Text>
            <Pressable disabled={busy} onPress={() => void saveToPhone()} accessibilityRole="button" style={st.saveRow}><MCI name="cellphone" size={24} color={theme.text} /><Text style={st.sheetText}>Save to phone</Text></Pressable>
            <Pressable disabled={busy} onPress={() => void saveVault()} accessibilityRole="button" style={st.saveRow}><MCI name="lock-outline" size={24} color={theme.text} /><Text style={st.sheetText}>Save to LinqaVault (encrypted)</Text></Pressable>
            <Pressable disabled={busy} onPress={() => void share()} accessibilityRole="button" style={st.saveRow}><MCI name="share-variant-outline" size={24} color={theme.text} /><Text style={st.sheetText}>Share…</Text></Pressable>
            {busy ? <Text style={st.hint}>Working…</Text> : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Text */}
      <Modal visible={!!textDraft} transparent animationType="fade" onRequestClose={() => setTextDraft(null)}>
        <View style={st.backdrop}>
          <View style={[st.sheet, { paddingBottom: 18 + insets.bottom }]}>
            <Text accessibilityRole="header" style={st.sheetTitle}>Add text</Text>
            <TextInput
              autoFocus
              value={textDraft?.value ?? ''}
              onChangeText={(value) => setTextDraft((d) => (d ? { ...d, value } : d))}
              placeholder="Type here"
              placeholderTextColor={theme.textDim}
              maxLength={BOARD_LIMITS.maxTextLength}
              style={st.input}
            />
            <View style={st.row}>
              <Chip label="Cancel" icon="close" onPress={() => setTextDraft(null)} />
              <Chip label="Add" icon="check" onPress={addText} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Chip({ label, icon, onPress }: { label: string; icon: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={st.chip}>
      <MCI name={icon as never} size={20} color={theme.text} />
      <Text style={st.chipText}>{label}</Text>
    </Pressable>
  );
}

function Stepper({ label, value, steps }: { label: string; value: string; steps: Array<[string, () => void]> }) {
  return (
    <View style={st.stepper}>
      <Text style={st.stepLabel}>{label}</Text>
      <View style={st.stepButtons}>
        {steps.slice(0, Math.ceil(steps.length / 2)).map(([t, f]) => <Pressable key={t} onPress={f} accessibilityRole="button" accessibilityLabel={`${label} ${t}`} style={st.stepBtn}><Text style={st.stepText}>{t}</Text></Pressable>)}
        <Text style={st.stepValue}>{value}</Text>
        {steps.slice(Math.ceil(steps.length / 2)).map(([t, f]) => <Pressable key={t} onPress={f} accessibilityRole="button" accessibilityLabel={`${label} ${t}`} style={st.stepBtn}><Text style={st.stepText}>{t}</Text></Pressable>)}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: theme.bg, zIndex: 150 },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, gap: 2 },
  topBtn: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  off: { opacity: 0.3 },
  title: { flex: 1, color: theme.text, fontSize: 16, fontWeight: '600' },
  canvas: { flex: 1, marginHorizontal: 10, marginVertical: 4, borderRadius: 14, backgroundColor: '#0B0C0F', overflow: 'hidden' },
  zoomTag: { position: 'absolute', left: 10, top: 10, backgroundColor: '#000A', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  zoomText: { color: '#fff', fontWeight: '700' },
  toast: { position: 'absolute', alignSelf: 'center', bottom: 12, color: theme.text, backgroundColor: '#000C', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, overflow: 'hidden' },
  toolRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 6, paddingTop: 4 },
  tool: { width: 56, paddingVertical: 6, borderRadius: 14, alignItems: 'center', gap: 2 },
  toolOn: { backgroundColor: theme.accent },
  toolKey: { color: theme.textDim, fontSize: 10, textAlign: 'center', lineHeight: 12 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 6 },
  brushBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.surfaceHi, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, flex: 1 },
  brushName: { color: theme.text, fontSize: 13, flexShrink: 1 },
  imageBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.surfaceHi, borderRadius: 14, paddingHorizontal: 12, height: 36 },
  imageText: { color: theme.text, fontSize: 13 },
  colorsScroll: { flexGrow: 0, flexShrink: 0 },
  colors: { alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: '#FFFFFF33' },
  swatchOn: { borderWidth: 3, borderColor: theme.accent },
  sep: { width: 1, height: 24, backgroundColor: theme.line, marginHorizontal: 4 },
  widthBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: '#0009', justifyContent: 'flex-end' },
  sheet: { backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, gap: 8, maxHeight: '85%' },
  sheetTitle: { color: theme.text, fontSize: 19, fontWeight: '700', marginBottom: 2 },
  sheetText: { color: theme.text, fontSize: 16 },
  hint: { color: theme.textDim, fontSize: 13, lineHeight: 18 },
  brushRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 46, paddingHorizontal: 8, borderRadius: 12 },
  brushRowOn: { backgroundColor: theme.surfaceHi },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.surfaceHi, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  chipText: { color: theme.text, fontSize: 14 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 46 },
  stepLabel: { color: theme.text, fontSize: 15, flex: 1 },
  stepButtons: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: { minWidth: 46, height: 38, borderRadius: 12, backgroundColor: theme.surfaceHi, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  stepText: { color: theme.text, fontSize: 14, fontWeight: '600' },
  stepValue: { color: theme.accent, fontSize: 15, fontWeight: '700', minWidth: 54, textAlign: 'center' },
  input: { color: theme.text, backgroundColor: theme.surfaceHi, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 18 },
});
