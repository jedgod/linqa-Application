import { describe, expect, it } from "vitest";
import { applyBoardOp, emptyBoard, onParticipantGone } from '../../../clients/mobile/services/call-actions/board';

const open = () => applyBoardOp(emptyBoard(), { t: 'board-open', by: 'a', at: 1 }, 'a');

describe('board', () => {
  it('only the opener can close or clear', () => {
    const s = open();
    expect(applyBoardOp(s, { t: 'board-close', by: 'b' }, 'b')).toBe(s);
    expect(applyBoardOp(s, { t: 'board-close', by: 'a' }, 'a').open).toBe(false);
  });

  it('authors can only extend their own strokes', () => {
    let s = open();
    s = applyBoardOp(s, { t: 'stroke-pts', id: 'k1', color: '#FFD60A', width: 0.01, pts: [0.1, 0.1, 0.2, 0.2] }, 'b');
    const hijack = applyBoardOp(s, { t: 'stroke-pts', id: 'k1', color: '#FFD60A', width: 0.01, pts: [0.9, 0.9] }, 'c');
    expect(hijack).toBe(s);
    s = applyBoardOp(s, { t: 'stroke-pts', id: 'k1', color: '#FFD60A', width: 0.01, pts: [0.3, 0.3] }, 'b');
    expect(s.strokes[0].points).toEqual([0.1, 0.1, 0.2, 0.2, 0.3, 0.3]);
  });

  it('rejects bad input and clamps coordinates', () => {
    let s = open();
    expect(applyBoardOp(s, { t: 'stroke-pts', id: 'x', color: 'red', width: 0.01, pts: [0, 0] }, 'b')).toBe(s);
    expect(applyBoardOp(s, { t: 'stroke-pts', id: 'x', color: '#FFFFFF', width: 0.01, pts: [0] }, 'b')).toBe(s);
    s = applyBoardOp(s, { t: 'stroke-pts', id: 'x', color: '#FFFFFF', width: 9, pts: [-1, 2] }, 'b');
    expect(s.strokes[0]).toMatchObject({ points: [0, 1], width: 0.05 });
  });

  it('sync from the opener rebuilds state for late joiners', () => {
    let s = open();
    s = applyBoardOp(s, { t: 'stroke-pts', id: 'k', color: '#5AA9FF', width: 0.01, pts: [0.5, 0.5] }, 'b');
    const late = applyBoardOp(
      emptyBoard(),
      { t: 'board-sync', openedBy: 'a', openedAt: 1, strokes: s.strokes },
      'a',
    );
    expect(late.strokes).toHaveLength(1);
    expect(applyBoardOp(emptyBoard(), { t: 'board-sync', openedBy: 'a', openedAt: 1, strokes: [] }, 'b').open).toBe(false);
  });

  it('opener leaving closes it, opener switching device keeps it', () => {
    const s = open();
    expect(onParticipantGone(s, 'a').open).toBe(false);
    expect(onParticipantGone(s, 'a', 'a2').openedBy).toBe('a2');
  });
});
