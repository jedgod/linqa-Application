// Draws the board with react-native-svg and turns touches into edits.
// One finger uses the current tool; two fingers always pinch-zoom and pan,
// like the Zoom and Webex whiteboards.

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Image, LayoutChangeEvent, StyleSheet, TextInput, View } from "react-native";
import Svg, { Circle, Ellipse, G, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Board, Element, Op, Point, ShapeEl, StrokeEl } from "./model";
import { Camera, arrowHead, elementBounds, fitCamera, inMarquee, pan, pick, screenToWorld, simplify, strokePath, worldToScreen, zoomAt } from "./geometry";
import { newId } from "../content/codec";

export type Tool = "select" | "hand" | "pen" | "highlighter" | "eraser" | "rect" | "ellipse" | "line" | "arrow" | "text" | "sticky" | "laser";

export interface Style { color: string; width: number; fill: boolean; stickyColor: string; fontSize: number }

export interface Peer { id: string; name: string; color: string; x: number; y: number; laser: boolean; at: number }

export interface WhiteboardCanvasHandle {
  zoomBy(factor: number): void;
  fit(): void;
  getCamera(): Camera;
  setCamera(c: Camera): void;
  deleteSelection(): void;
  restyleSelection(patch: Partial<Element>): void;
  selection(): string[];
}

interface Props {
  board: Board;
  tool: Tool;
  style: Style;
  readOnly?: boolean;
  /** Transparent canvas for annotating over a shared screen or a photo. */
  transparent?: boolean;
  backgroundUri?: string;
  /** Lock the camera so annotations stay aligned with what's underneath. */
  fixedCamera?: boolean;
  /** With fixedCamera: world units across the view (screen-share layer uses 1000). */
  worldWidth?: number;
  peers?: Peer[];
  onOps: (ops: Op[]) => void;
  onPointer?: (x: number, y: number, laser: boolean) => void;
  onSelectionChange?: (ids: string[]) => void;
  onCameraChange?: (cam: Camera) => void;
}

type Draft =
  | { kind: "stroke"; points: Point[] }
  | { kind: "shape"; tool: "rect" | "ellipse" | "line" | "arrow"; a: Point; b: Point }
  | { kind: "marquee"; a: Point; b: Point }
  | { kind: "move"; last: Point }
  | { kind: "erase" }
  | null;

export const WhiteboardCanvas = forwardRef<WhiteboardCanvasHandle, Props>(function WhiteboardCanvas(props, ref) {
  const { board, tool, style, readOnly, transparent, backgroundUri, fixedCamera, peers = [], onOps } = props;
  const version = useSyncExternalStore(
    (fn) => board.subscribe(fn),
    () => board.getVersion()
  );
  const elements = useMemo(() => board.elements(), [board, version]);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [cam, setCam] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [draft, setDraft] = useState<Draft>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [laserTrail, setLaserTrail] = useState<{ p: Point; t: number }[]>([]);

  // Live values for gesture callbacks.
  const live = useRef({ cam, tool, style, selected, readOnly, draft });
  live.current = { cam, tool, style, selected, readOnly, draft };
  const pinchStart = useRef<{ cam: Camera; scale: number } | null>(null);
  const twoPanLast = useRef<{ x: number; y: number } | null>(null);

  const updateCam = useCallback(
    (c: Camera) => {
      setCam(c);
      props.onCameraChange?.(c);
    },
    [props.onCameraChange]
  );

  useEffect(() => props.onSelectionChange?.(selected), [selected]);
  // Drop selection of things that were erased remotely.
  useEffect(() => setSelected((s) => s.filter((id) => board.get(id))), [version]);

  const emit = (ops: Op[]) => ops.length && onOps(ops);

  useImperativeHandle(ref, () => ({
    zoomBy: (f) => updateCam(zoomAt(live.current.cam, f, size.width / 2, size.height / 2)),
    fit: () => updateCam(fitCamera(board.elements(), size.width, size.height)),
    getCamera: () => live.current.cam,
    setCamera: updateCam,
    deleteSelection: () => {
      emit(board.remove(live.current.selected));
      setSelected([]);
    },
    restyleSelection: (patch) => emit(board.update(live.current.selected.map((id) => ({ id, patch })))),
    selection: () => live.current.selected,
  }));

  const toWorld = (x: number, y: number) => screenToWorld(live.current.cam, x, y);

  // --- one-finger tool gesture --------------------------------------------
  const onBegin = (sx: number, sy: number) => {
    const { tool: t, readOnly: ro } = live.current;
    const p = toWorld(sx, sy);
    props.onPointer?.(p[0], p[1], t === "laser");
    if (t === "laser") {
      setLaserTrail([{ p, t: Date.now() }]);
      return;
    }
    if (ro || t === "hand") return;
    const slop = 8 / live.current.cam.zoom;
    switch (t) {
      case "pen":
      case "highlighter":
        setDraft({ kind: "stroke", points: [p] });
        break;
      case "eraser": {
        const hit = pick(board.elements(), p[0], p[1], slop);
        if (hit) emit(board.remove([hit.id]));
        setDraft({ kind: "erase" });
        break;
      }
      case "rect":
      case "ellipse":
      case "line":
      case "arrow":
        setDraft({ kind: "shape", tool: t, a: p, b: p });
        break;
      case "select": {
        const hit = pick(board.elements(), p[0], p[1], slop);
        if (hit) {
          if (!live.current.selected.includes(hit.id)) setSelected([hit.id]);
          setDraft({ kind: "move", last: p });
        } else {
          setSelected([]);
          setDraft({ kind: "marquee", a: p, b: p });
        }
        break;
      }
    }
  };

  const onMove = (sx: number, sy: number) => {
    const p = toWorld(sx, sy);
    const d = live.current.draft;
    props.onPointer?.(p[0], p[1], live.current.tool === "laser");
    if (live.current.tool === "laser") {
      const now = Date.now();
      setLaserTrail((tr) => [...tr.filter((x) => now - x.t < 700), { p, t: now }]);
      return;
    }
    if (live.current.tool === "hand") return; // handled by pan gesture below
    if (!d) return;
    if (d.kind === "stroke") setDraft({ kind: "stroke", points: [...d.points, p] });
    else if (d.kind === "shape" || d.kind === "marquee") setDraft({ ...d, b: p });
    else if (d.kind === "erase") {
      const hit = pick(board.elements(), p[0], p[1], 8 / live.current.cam.zoom);
      if (hit) emit(board.remove([hit.id]));
    } else if (d.kind === "move") {
      // Moves are shown live locally and committed on release as one undo step.
      setDraft({ kind: "move", last: p });
      setMoveOffset((o) => [o[0] + p[0] - d.last[0], o[1] + p[1] - d.last[1]]);
    }
  };

  const [moveOffset, setMoveOffset] = useState<Point>([0, 0]);

  const onEnd = () => {
    const d = live.current.draft;
    const { style: st, tool: t } = live.current;
    setDraft(null);
    if (!d) return;
    if (d.kind === "stroke") {
      const pts = simplify(d.points, 0.6 / live.current.cam.zoom);
      emit(
        board.add<StrokeEl>({
          id: newId("s"),
          kind: "stroke",
          points: pts.map(([x, y]) => [round(x), round(y)] as Point),
          color: st.color,
          width: (t === "highlighter" ? st.width * 4 : st.width) / live.current.cam.zoom,
          highlighter: t === "highlighter" || undefined,
        })
      );
    } else if (d.kind === "shape") {
      if (Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) < 4 / live.current.cam.zoom) return;
      emit(
        board.add<ShapeEl>({
          id: newId("h"),
          kind: d.tool,
          x1: round(d.a[0]), y1: round(d.a[1]), x2: round(d.b[0]), y2: round(d.b[1]),
          color: st.color,
          width: st.width / live.current.cam.zoom,
          fill: st.fill && (d.tool === "rect" || d.tool === "ellipse") ? st.color + "33" : undefined,
        })
      );
    } else if (d.kind === "marquee") {
      setSelected(inMarquee(board.elements(), d.a, d.b).map((e) => e.id));
    } else if (d.kind === "move") {
      const [dx, dy] = moveOffset;
      setMoveOffset([0, 0]);
      if (dx || dy) emit(board.update(live.current.selected.map((id) => ({ id, patch: shifted(board.get(id)!, dx, dy) }))));
    }
  };

  const onTap = (sx: number, sy: number) => {
    const { tool: t, readOnly: ro, style: st, cam: c } = live.current;
    if (ro) return;
    const p = toWorld(sx, sy);
    if (t === "text") {
      const id = newId("t");
      emit(board.add({ id, kind: "text", x: round(p[0]), y: round(p[1]), text: "", color: st.color, size: st.fontSize / c.zoom }));
      setEditing(id);
    } else if (t === "sticky") {
      const id = newId("n");
      const w = 180 / c.zoom;
      emit(board.add({ id, kind: "sticky", x: round(p[0] - w / 2), y: round(p[1] - w / 2), w, h: w, text: "", color: st.stickyColor }));
      setEditing(id);
    } else if (t === "select") {
      const hit = pick(board.elements(), p[0], p[1], 8 / c.zoom);
      if (hit && (hit.kind === "text" || hit.kind === "sticky")) setEditing(hit.id);
    }
  };

  const toolGesture = Gesture.Pan()
    .runOnJS(true)
    .maxPointers(1)
    .minDistance(0)
    .onBegin((e) => onBegin(e.x, e.y))
    .onChange((e) => {
      if (live.current.tool === "hand" && !fixedCamera) updateCam(pan(live.current.cam, e.changeX, e.changeY));
      else onMove(e.x, e.y);
    })
    .onFinalize(() => onEnd());

  const tapGesture = Gesture.Tap().runOnJS(true).onEnd((e) => onTap(e.x, e.y));

  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .enabled(!fixedCamera)
    .onBegin(() => (pinchStart.current = { cam: live.current.cam, scale: 1 }))
    .onUpdate((e) => {
      const s = pinchStart.current;
      if (s) updateCam(zoomAt(s.cam, e.scale, e.focalX, e.focalY));
    })
    .onEnd(() => {
      pinchStart.current = null;
    });

  const twoFingerPan = Gesture.Pan()
    .runOnJS(true)
    .enabled(!fixedCamera)
    .minPointers(2)
    .onBegin(() => {
      setDraft(null); // a second finger cancels whatever the first started
      twoPanLast.current = null;
    })
    .onUpdate((e) => {
      const last = twoPanLast.current;
      if (last) updateCam(pan(live.current.cam, e.translationX - last.x, e.translationY - last.y));
      twoPanLast.current = { x: e.translationX, y: e.translationY };
    });

  const gesture = Gesture.Simultaneous(pinch, twoFingerPan, Gesture.Exclusive(tapGesture, toolGesture));

  // Laser trail fades out.
  useEffect(() => {
    if (!laserTrail.length) return;
    const id = setTimeout(() => setLaserTrail((tr) => tr.filter((x) => Date.now() - x.t < 700)), 120);
    return () => clearTimeout(id);
  }, [laserTrail]);

  // Center the origin on first layout.
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (fixedCamera) {
      // Annotation layers map the view onto a fixed world width so marks line
      // up on both phones even when their screens are different sizes.
      updateCam({ x: 0, y: 0, zoom: props.worldWidth ? width / props.worldWidth : 1 });
    } else if (!size.width) {
      updateCam({ x: -width / 2, y: -height / 2, zoom: 1 });
    }
    setSize({ width, height });
  };

  const transform = `scale(${cam.zoom}) translate(${-cam.x} ${-cam.y})`;
  const editingEl = editing ? board.get(editing) : undefined;

  return (
    <View style={[styles.fill, !transparent && styles.paper]} onLayout={onLayout}>
      {backgroundUri ? <Image source={{ uri: backgroundUri }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}
      <GestureDetector gesture={gesture}>
        <View style={styles.fill} collapsable={false}>
          <Svg width={size.width} height={size.height}>
            {!transparent ? <Grid cam={cam} width={size.width} height={size.height} /> : null}
            <G transform={transform}>
              {elements.map((el) => (
                <ElementView
                  key={el.id}
                  el={el}
                  offset={selected.includes(el.id) ? moveOffset : undefined}
                  hidden={el.id === editing}
                />
              ))}
              {draft?.kind === "stroke" ? (
                <Path
                  d={strokePath(draft.points)}
                  stroke={style.color}
                  strokeOpacity={tool === "highlighter" ? 0.35 : 1}
                  strokeWidth={(tool === "highlighter" ? style.width * 4 : style.width) / cam.zoom}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              ) : null}
              {draft?.kind === "shape" ? (
                <ElementView
                  el={{ id: "draft", author: "", clock: { c: 0, a: "" }, z: 0, kind: draft.tool, x1: draft.a[0], y1: draft.a[1], x2: draft.b[0], y2: draft.b[1], color: style.color, width: style.width / cam.zoom }}
                />
              ) : null}
              {draft?.kind === "marquee" ? (
                <Rect
                  x={Math.min(draft.a[0], draft.b[0])}
                  y={Math.min(draft.a[1], draft.b[1])}
                  width={Math.abs(draft.b[0] - draft.a[0])}
                  height={Math.abs(draft.b[1] - draft.a[1])}
                  stroke="#1F5FA8"
                  strokeDasharray={`${4 / cam.zoom} ${4 / cam.zoom}`}
                  strokeWidth={1 / cam.zoom}
                  fill="#1F5FA81A"
                />
              ) : null}
              {selected.map((id) => {
                const el = board.get(id);
                return el ? <SelectionBox key={id} el={el} zoom={cam.zoom} offset={moveOffset} /> : null;
              })}
              {laserTrail.length > 1 ? (
                <Path d={strokePath(laserTrail.map((x) => x.p))} stroke="#E5484D" strokeOpacity={0.7} strokeWidth={6 / cam.zoom} strokeLinecap="round" fill="none" />
              ) : null}
            </G>
            {peers
              .filter((p) => Date.now() - p.at < 5000)
              .map((p) => {
                const [sx, sy] = worldToScreen(cam, p.x, p.y);
                return (
                  <G key={p.id}>
                    <Circle cx={sx} cy={sy} r={p.laser ? 9 : 5} fill={p.laser ? "#E5484D" : p.color} opacity={p.laser ? 0.85 : 1} />
                    <SvgText x={sx + 10} y={sy - 8} fontSize={12} fontWeight="600" fill={p.color}>
                      {p.name}
                    </SvgText>
                  </G>
                );
              })}
          </Svg>
        </View>
      </GestureDetector>

      {editingEl && (editingEl.kind === "text" || editingEl.kind === "sticky") ? (
        <InlineEditor
          el={editingEl}
          cam={cam}
          onDone={(text) => {
            setEditing(null);
            if (!text.trim()) emit(board.remove([editingEl.id]));
            else if (text !== editingEl.text) emit(board.update([{ id: editingEl.id, patch: { text } }]));
          }}
        />
      ) : null}
    </View>
  );
});

function ElementView({ el, offset, hidden }: { el: Element; offset?: Point; hidden?: boolean }) {
  if (hidden) return null;
  const t = offset && (offset[0] || offset[1]) ? `translate(${offset[0]} ${offset[1]})` : undefined;
  switch (el.kind) {
    case "stroke":
      return (
        <Path
          transform={t}
          d={strokePath(el.points)}
          stroke={el.color}
          strokeOpacity={el.highlighter ? 0.35 : 1}
          strokeWidth={el.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      );
    case "rect":
      return <Rect transform={t} x={Math.min(el.x1, el.x2)} y={Math.min(el.y1, el.y2)} width={Math.abs(el.x2 - el.x1)} height={Math.abs(el.y2 - el.y1)} stroke={el.color} strokeWidth={el.width} fill={el.fill ?? "none"} rx={el.width} />;
    case "ellipse":
      return <Ellipse transform={t} cx={(el.x1 + el.x2) / 2} cy={(el.y1 + el.y2) / 2} rx={Math.abs(el.x2 - el.x1) / 2} ry={Math.abs(el.y2 - el.y1) / 2} stroke={el.color} strokeWidth={el.width} fill={el.fill ?? "none"} />;
    case "line":
      return <Line transform={t} x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke={el.color} strokeWidth={el.width} strokeLinecap="round" />;
    case "arrow":
      return (
        <G transform={t}>
          <Line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke={el.color} strokeWidth={el.width} strokeLinecap="round" />
          <Path d={arrowHead(el.x1, el.y1, el.x2, el.y2, el.width)} fill={el.color} />
        </G>
      );
    case "text":
      return (
        <G transform={t}>
          {el.text.split("\n").map((line, i) => (
            <SvgText key={i} x={el.x} y={el.y + el.size * (i + 1)} fontSize={el.size} fill={el.color}>
              {line}
            </SvgText>
          ))}
        </G>
      );
    case "sticky": {
      const fs = Math.max(10, el.w / 10);
      return (
        <G transform={t}>
          <Rect x={el.x + 2} y={el.y + 3} width={el.w} height={el.h} fill="#00000014" rx={6} />
          <Rect x={el.x} y={el.y} width={el.w} height={el.h} fill={el.color} rx={6} />
          {wrap(el.text, Math.floor(el.w / (fs * 0.55))).slice(0, Math.floor((el.h - fs) / (fs * 1.3))).map((line, i) => (
            <SvgText key={i} x={el.x + fs * 0.8} y={el.y + fs * 1.6 + i * fs * 1.3} fontSize={fs} fill="#1C2833">
              {line}
            </SvgText>
          ))}
        </G>
      );
    }
  }
}

function SelectionBox({ el, zoom, offset }: { el: Element; zoom: number; offset: Point }) {
  const b = elementBounds(el);
  const pad = 6 / zoom;
  return (
    <Rect
      x={b.minX - pad + offset[0]}
      y={b.minY - pad + offset[1]}
      width={b.maxX - b.minX + pad * 2}
      height={b.maxY - b.minY + pad * 2}
      stroke="#1F5FA8"
      strokeWidth={1.5 / zoom}
      strokeDasharray={`${5 / zoom} ${4 / zoom}`}
      fill="none"
    />
  );
}

function Grid({ cam, width, height }: { cam: Camera; width: number; height: number }) {
  // Dot grid that stays put in world space; spacing adapts to zoom level.
  let step = 40;
  while (step * cam.zoom < 18) step *= 2;
  while (step * cam.zoom > 80) step /= 2;
  const dots: React.ReactElement[] = [];
  const startX = Math.floor(cam.x / step) * step;
  const startY = Math.floor(cam.y / step) * step;
  const endX = cam.x + width / cam.zoom;
  const endY = cam.y + height / cam.zoom;
  if ((endX - startX) / step * ((endY - startY) / step) > 4000) return null;
  for (let x = startX; x < endX; x += step) {
    for (let y = startY; y < endY; y += step) {
      const [sx, sy] = worldToScreen(cam, x, y);
      dots.push(<Circle key={`${x}:${y}`} cx={sx} cy={sy} r={1.1} fill="#C3CDD6" />);
    }
  }
  return <G>{dots}</G>;
}

function InlineEditor({ el, cam, onDone }: { el: Extract<Element, { kind: "text" | "sticky" }>; cam: Camera; onDone: (t: string) => void }) {
  const [text, setText] = useState(el.text);
  const [sx, sy] = worldToScreen(cam, el.x, el.y);
  const isSticky = el.kind === "sticky";
  const fontSize = (isSticky ? Math.max(10, el.w / 10) : el.size) * cam.zoom;
  return (
    <TextInput
      autoFocus
      multiline
      value={text}
      onChangeText={setText}
      onBlur={() => onDone(text)}
      placeholder={isSticky ? "Note" : "Type"}
      accessibilityLabel={isSticky ? "Sticky note text" : "Text"}
      style={{
        position: "absolute",
        left: sx,
        top: sy,
        minWidth: 120,
        width: isSticky ? el.w * cam.zoom : undefined,
        height: isSticky ? el.h * cam.zoom : undefined,
        padding: isSticky ? fontSize * 0.8 : 2,
        fontSize,
        color: isSticky ? "#1C2833" : el.color,
        backgroundColor: isSticky ? el.color : "rgba(255,255,255,0.9)",
        borderRadius: 6,
        borderWidth: 1.5,
        borderColor: "#1F5FA8",
        textAlignVertical: "top",
      }}
    />
  );
}

export function shifted(el: Element, dx: number, dy: number): Partial<Element> {
  switch (el.kind) {
    case "stroke":
      return { points: el.points.map(([x, y]) => [round(x + dx), round(y + dy)] as Point) };
    case "text":
    case "sticky":
      return { x: round(el.x + dx), y: round(el.y + dy) };
    default:
      return { x1: round(el.x1 + dx), y1: round(el.y1 + dy), x2: round(el.x2 + dx), y2: round(el.y2 + dy) };
  }
}

function wrap(text: string, perLine: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      if ((line + " " + word).trim().length > perLine && line) {
        out.push(line);
        line = word;
      } else line = (line + " " + word).trim();
    }
    out.push(line);
  }
  return out;
}

const round = (n: number) => Math.round(n * 10) / 10;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  paper: { backgroundColor: "#FBFCFD" },
});
