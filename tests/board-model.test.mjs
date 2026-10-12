import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from '../clients/mobile/node_modules/typescript/lib/typescript.js';

const base = new URL('../clients/mobile/features/call-rooms/', import.meta.url);
function load(file) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(new URL(file, base), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Math, Number, Object, Array, Date, Infinity });
  return module.exports;
}
const b = load('board.ts');
const m = load('ui/boardView.math.ts');

const A = 'alice:phone';
const B = 'bob:phone';
const opened = () => b.applyBoardOp(b.emptyBoard(), { t: 'board-open', by: A, at: 1 }, A);
const draw = (s, id, from, pts, extra = {}) => {
  let n = b.applyBoardOp(s, { t: 'stroke-pts', id, color: '#FF6B6B', width: 0.01, pts, ...extra }, from);
  return b.applyBoardOp(n, { t: 'stroke-done', id }, from);
};
const square = [0.2, 0.2, 0.6, 0.2, 0.6, 0.6, 0.2, 0.6, 0.2, 0.21];

test('a stroke keeps its brush, and an unknown brush falls back to the pen', () => {
  let s = draw(opened(), 's1', A, [0.1, 0.1, 0.2, 0.2], { brush: 'airbrush' });
  assert.equal(s.strokes[0].brush, 'airbrush');
  s = draw(s, 's2', A, [0.1, 0.1, 0.2, 0.2], { brush: 'not-a-brush' });
  assert.equal(s.strokes[1].brush, 'pen');
  s = draw(s, 's3', A, [0.1, 0.1, 0.2, 0.2]);
  assert.equal(s.strokes[2].brush, 'pen');
});

test('erase: an author erases their own stroke, the opener erases anyone, others cannot erase it', () => {
  let s = draw(opened(), 'bobs', B, [0.1, 0.1, 0.3, 0.3]);
  const carol = 'carol:phone';
  assert.equal(b.applyBoardOp(s, { t: 'stroke-erase', id: 'bobs' }, carol), s);
  assert.equal(b.applyBoardOp(s, { t: 'stroke-erase', id: 'bobs' }, A).strokes.length, 0);
  assert.equal(b.applyBoardOp(s, { t: 'stroke-erase', id: 'bobs' }, B).strokes.length, 0);
});

test('fill: only an existing stroke can be filled, bad colours are refused, and erasing drops the fill', () => {
  let s = draw(opened(), 'shape', A, square);
  assert.equal(b.applyBoardOp(s, { t: 'stroke-fill', id: 'missing', color: '#00FF00' }, B), s);
  assert.equal(b.applyBoardOp(s, { t: 'stroke-fill', id: 'shape', color: 'red' }, B), s);
  s = b.applyBoardOp(s, { t: 'stroke-fill', id: 'shape', color: '#00FF00' }, B);
  assert.equal(s.fills.shape, '#00FF00');
  s = b.applyBoardOp(s, { t: 'stroke-erase', id: 'shape' }, A);
  assert.equal(s.fills.shape, undefined);
});

test('text: added with limits, removed by its author or the opener, and empty or oversized text is refused', () => {
  let s = opened();
  const add = (id, from, text = 'hello') => b.applyBoardOp(s, { t: 'text-add', id, x: 0.3, y: 0.4, text, color: '#FFFFFF', size: 0.05 }, from);
  assert.equal(add('t1', B, '   '), s);
  s = add('t1', B);
  assert.equal(s.texts.length, 1);
  assert.equal(add('t1', B), s, 'a repeated id is ignored');
  assert.equal(b.applyBoardOp(s, { t: 'text-remove', id: 't1' }, 'carol:phone'), s);
  assert.equal(b.applyBoardOp(s, { t: 'text-remove', id: 't1' }, A).texts.length, 0);
  const long = add('t2', B, 'x'.repeat(500));
  assert.equal(long.texts[1].text.length, b.BOARD_LIMITS.maxTextLength);
});

test('background: a colour or none, nothing else', () => {
  let s = opened();
  s = b.applyBoardOp(s, { t: 'board-bg', color: '#1D4ED8' }, B);
  assert.equal(s.bg, '#1D4ED8');
  assert.equal(b.applyBoardOp(s, { t: 'board-bg', color: 'blue' }, B), s);
  assert.equal(b.applyBoardOp(s, { t: 'board-bg', color: null }, B).bg, null);
});

test('clear removes strokes, text, fills and the background; only the opener can clear', () => {
  let s = draw(opened(), 'shape', A, square);
  s = b.applyBoardOp(s, { t: 'stroke-fill', id: 'shape', color: '#00FF00' }, A);
  s = b.applyBoardOp(s, { t: 'board-bg', color: '#1D4ED8' }, A);
  assert.equal(b.applyBoardOp(s, { t: 'board-clear', by: B }, B), s);
  const cleared = b.applyBoardOp(s, { t: 'board-clear', by: A }, A);
  assert.equal(`${cleared.strokes.length},${cleared.texts.length},${Object.keys(cleared.fills).length},${cleared.bg}`, "0,0,0,null");
});

test('someone joining mid-board receives strokes, brushes, text, fills and the background', () => {
  let s = draw(opened(), 'shape', A, square, { brush: 'marker' });
  s = b.applyBoardOp(s, { t: 'stroke-fill', id: 'shape', color: '#00FF00' }, A);
  s = b.applyBoardOp(s, { t: 'text-add', id: 't1', x: 0.1, y: 0.9, text: 'note', color: '#FFFFFF', size: 0.05 }, A);
  s = b.applyBoardOp(s, { t: 'board-bg', color: '#1D4ED8' }, A);
  const sync = { t: 'board-sync', openedBy: A, openedAt: s.openedAt, strokes: s.strokes, texts: s.texts, fills: s.fills, bg: s.bg };
  const joined = b.applyBoardOp(b.emptyBoard(), sync, A);
  assert.equal(joined.strokes[0].brush, 'marker');
  assert.equal(joined.fills.shape, '#00FF00');
  assert.equal(joined.texts[0].text, 'note');
  assert.equal(joined.bg, '#1D4ED8');
  // an older sender that knows none of the new fields still syncs strokes
  const legacy = b.applyBoardOp(b.emptyBoard(), { t: 'board-sync', openedBy: A, openedAt: 1, strokes: [{ id: 'old', author: A, color: '#FFFFFF', width: 0.01, points: [0.1, 0.1, 0.2, 0.2], done: true }] }, A);
  assert.equal(legacy.strokes[0].brush, 'pen');
  assert.equal(legacy.texts.length, 0);
});

test('hit testing: strokes, text, and closed shapes', () => {
  const s = draw(opened(), 'shape', A, square);
  const stroke = s.strokes[0];
  assert.equal(b.strokeAt(s.strokes, 120, 120, 600, 600, 10)?.id, 'shape');
  assert.equal(b.strokeAt(s.strokes, 240, 240, 600, 600, 10), null, 'the middle of a hollow shape is not on the line');
  assert.equal(b.isClosedish(stroke, 600, 600), true);
  assert.equal(b.fillableAt(s.strokes, 240, 240, 600, 600)?.id, 'shape');
  assert.equal(b.fillableAt(s.strokes, 580, 580, 600, 600), null);
  const open = draw(opened(), 'line', A, [0.1, 0.1, 0.5, 0.1, 0.9, 0.1, 0.9, 0.2]);
  assert.equal(b.isClosedish(open.strokes[0], 600, 600), false);
  const t = b.applyBoardOp(opened(), { t: 'text-add', id: 't', x: 0.1, y: 0.5, text: 'hello', color: '#FFFFFF', size: 0.05 }, A);
  assert.equal(b.textAt(t.texts, 70, 295, 600, 600)?.id, 't');
  assert.equal(b.textAt(t.texts, 500, 100, 600, 600), null);
});

test('view maths: a point goes through the view and back to where it was', () => {
  const view = { rotation: 37, scale: 1.4, skewX: 12, skewY: -8, zoom: 2, panX: 15, panY: -20 };
  const matrix = m.viewMatrix(view, 600, 400);
  const inverse = m.invert(matrix);
  const there = m.apply(matrix, 123, 321);
  const back = m.apply(inverse, there.x, there.y);
  assert.ok(Math.abs(back.x - 123) < 1e-6 && Math.abs(back.y - 321) < 1e-6);
});

test('view maths: rotating right 90 degrees turns the board about its centre', () => {
  const matrix = m.viewMatrix({ ...m.IDENTITY_VIEW, rotation: 90 }, 400, 400);
  const p = m.apply(matrix, 400, 200); // the right edge, halfway down
  assert.ok(Math.abs(p.x - 200) < 1e-6 && Math.abs(p.y - 400) < 1e-6, 'it ends up at the bottom edge');
  const half = m.apply(m.viewMatrix({ ...m.IDENTITY_VIEW, rotation: 180 }, 400, 400), 0, 0);
  assert.ok(Math.abs(half.x - 400) < 1e-6 && Math.abs(half.y - 400) < 1e-6);
  assert.equal(m.normalizeDegrees(270), -90);
  assert.equal(m.clampScale(9), 3);
  assert.equal(m.clampSkew(-99), -60);
});
