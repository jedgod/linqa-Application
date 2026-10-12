/**
 * What goes in the call's More sheet, and what never does.
 * Pure so it can be unit tested without React Native.
 */
import type { CallKind } from './protocol';

/** These live on the call bar. They never appear in More. */
export const BAR_ITEMS = ['mute', 'speaker', 'video', 'end'] as const;

export type MoreItemId =
  | 'share-screen'
  | 'raise-hand'
  | 'add-person'
  | 'board'
  | 'flip-camera'
  | 'blur'
  | 'switch-device'
  | 'call-info'
  | 'report';

/**
 * Items that start sending something new to everyone in the call.
 * Each one asks once, in a single confirm, before it starts.
 */
export const SENDS_TO_CALL: readonly MoreItemId[] = ['share-screen', 'board', 'add-person'];

export interface ConfirmSpec {
  title: string;
  body: string;
  confirmLabel: string;
}

export interface MoreItem {
  id: MoreItemId;
  label: string;
  icon: string; // Feather icon name
  active?: boolean;
  disabled?: boolean;
  hint?: string;
  /** Present when tapping must be confirmed before anything is sent. */
  confirm?: ConfirmSpec;
  destructive?: boolean;
}

export interface MoreMenuContext {
  kind: CallKind;
  cameraOn: boolean;
  /** True when the self-view tile already shows a flip button. */
  selfViewHasFlip: boolean;
  sharingScreen: boolean;
  handRaised: boolean;
  /** A board is open in this call (started by anyone). */
  boardOpen: boolean;
  blurOn: boolean;
  blurSupported: boolean;
  screenShareSupported: boolean;
  participantCount: number;
  ringingCount: number;
  maxParticipants: number;
}

/**
 * A voice call where someone turned their camera on behaves like a video
 * call, so it gets the video menu (share screen, flip, blur).
 */
export function menuMode(ctx: Pick<MoreMenuContext, 'kind' | 'cameraOn'>): CallKind {
  return ctx.kind === 'video' || ctx.cameraOn ? 'video' : 'voice';
}

export function buildMoreMenu(ctx: MoreMenuContext): MoreItem[] {
  const full = ctx.participantCount + ctx.ringingCount >= ctx.maxParticipants;
  const video = menuMode(ctx) === 'video';

  const item: Record<MoreItemId, () => MoreItem | null> = {
    'share-screen': () =>
      ctx.sharingScreen
        ? { id: 'share-screen', label: 'Stop sharing', icon: 'monitor', active: true }
        : {
            id: 'share-screen',
            label: 'Share screen',
            icon: 'monitor',
            disabled: !ctx.screenShareSupported,
            hint: ctx.screenShareSupported ? undefined : 'Not available on this device',
            confirm: {
              title: 'Share your screen?',
              body: 'Everyone in this call will see everything on your screen, including notifications, until you stop.',
              confirmLabel: 'Share',
            },
          },
    'raise-hand': () => ({
      id: 'raise-hand',
      label: ctx.handRaised ? 'Lower hand' : 'Raise hand',
      icon: 'hand' /* mapped in Icon.tsx */,
      active: ctx.handRaised,
    }),
    'add-person': () => ({
      id: 'add-person',
      label: 'Add person',
      icon: 'user-plus',
      disabled: full,
      hint: full ? 'Call is full' : undefined,
      // Confirm text is finalised with the chosen name(s) by confirmAddPerson().
      confirm: {
        title: 'Add to this call?',
        body: video
          ? 'They will see and hear everyone in the call once they answer.'
          : 'They will hear everyone in the call once they answer.',
        confirmLabel: 'Add',
      },
    }),
    board: () =>
      ctx.boardOpen
        ? { id: 'board', label: 'Open board', icon: 'edit-3', active: true }
        : {
            id: 'board',
            label: 'Write on board',
            icon: 'edit-3',
            confirm: {
              title: 'Open a shared board?',
              body: 'Everyone in this call will see the board and anything written on it.',
              confirmLabel: 'Open board',
            },
          },
    'flip-camera': () =>
      video && ctx.cameraOn && !ctx.selfViewHasFlip
        ? { id: 'flip-camera', label: 'Flip camera', icon: 'refresh-cw' }
        : null,
    blur: () =>
      video
        ? {
            id: 'blur',
            label: ctx.blurOn ? 'Turn off blur' : 'Blur background',
            icon: 'aperture',
            active: ctx.blurOn,
            disabled: !ctx.blurSupported || !ctx.cameraOn,
            hint: !ctx.blurSupported ? 'Not available on this device' : !ctx.cameraOn ? 'Turn your camera on first' : undefined,
          }
        : null,
    'switch-device': () => ({ id: 'switch-device', label: 'Switch device', icon: 'smartphone' }),
    'call-info': () => ({ id: 'call-info', label: 'Call info', icon: 'info' }),
    report: () => ({ id: 'report', label: 'Report', icon: 'flag', destructive: true }),
  };

  const order: MoreItemId[] = video
    ? ['share-screen', 'raise-hand', 'add-person', 'board', 'flip-camera', 'blur', 'switch-device', 'call-info', 'report']
    : ['add-person', 'raise-hand', 'switch-device', 'board', 'call-info', 'report'];

  return order.map((id) => item[id]()).filter((x): x is MoreItem => x !== null);
}

export function confirmAddPerson(names: string[], kind: CallKind): ConfirmSpec {
  const who = names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  return {
    title: `Add ${who}?`,
    body:
      kind === 'video'
        ? `${names.length > 1 ? 'They' : names[0]} will see and hear everyone in this call once they answer.`
        : `${names.length > 1 ? 'They' : names[0]} will hear everyone in this call once they answer.`,
    confirmLabel: 'Add',
  };
}
