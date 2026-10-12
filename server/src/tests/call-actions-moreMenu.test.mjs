import { describe, expect, it } from "vitest";
import { BAR_ITEMS, buildMoreMenu, SENDS_TO_CALL } from '../../../clients/mobile/services/call-actions/moreMenu';

const base = {
  kind: 'voice',
  cameraOn: false,
  selfViewHasFlip: false,
  sharingScreen: false,
  handRaised: false,
  boardOpen: false,
  blurOn: false,
  blurSupported: true,
  screenShareSupported: true,
  participantCount: 2,
  ringingCount: 0,
  maxParticipants: 8,
};
const ids = (c) => buildMoreMenu({ ...base, ...c }).map((i) => i.id);

describe('More menu', () => {
  it('voice call has exactly the voice items, in order', () => {
    expect(ids({})).toEqual(['add-person', 'raise-hand', 'switch-device', 'board', 'call-info', 'report']);
  });

  it('video call has the video items, flip only when self-view lacks it', () => {
    expect(ids({ kind: 'video', cameraOn: true })).toEqual([
      'share-screen', 'raise-hand', 'add-person', 'board', 'flip-camera', 'blur', 'switch-device', 'call-info', 'report',
    ]);
    expect(ids({ kind: 'video', cameraOn: true, selfViewHasFlip: true })).not.toContain('flip-camera');
    expect(ids({ kind: 'video', cameraOn: false })).not.toContain('flip-camera');
  });

  it('never contains bar controls', () => {
    for (const c of [{}, { kind: 'video', cameraOn: true }]) {
      for (const bar of BAR_ITEMS) expect(ids(c)).not.toContain(bar);
    }
  });

  it('every item that starts sending to the call asks once; nothing else does', () => {
    const all = [
      ...buildMoreMenu({ ...base }),
      ...buildMoreMenu({ ...base, kind: 'video', cameraOn: true }),
    ];
    for (const i of all) {
      if (SENDS_TO_CALL.includes(i.id)) expect(i.confirm).toBeDefined();
      else expect(i.confirm).toBeUndefined();
    }
  });

  it('stopping or rejoining does not ask again', () => {
    const m = buildMoreMenu({ ...base, kind: 'video', cameraOn: true, sharingScreen: true, boardOpen: true });
    const share = m.find((i) => i.id === 'share-screen');
    const board = m.find((i) => i.id === 'board');
    expect([share.label, share.confirm]).toEqual(['Stop sharing', undefined]);
    expect([board.label, board.confirm]).toEqual(['Open board', undefined]);
  });

  it('add person is disabled when the call is full', () => {
    const m = buildMoreMenu({ ...base, participantCount: 6, ringingCount: 2 });
    expect(m.find((i) => i.id === 'add-person')?.disabled).toBe(true);
  });

  it('blur needs the camera on', () => {
    const m = buildMoreMenu({ ...base, kind: 'video', cameraOn: false });
    expect(m.find((i) => i.id === 'blur')?.disabled).toBe(true);
  });
});
