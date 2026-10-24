/** Smallest Chats container width (dp) that fits a list pane plus a usable thread. */
export const TWO_PANE_MIN_WIDTH = 720;
export const LIST_PANE_MIN = 320;
export const LIST_PANE_MAX = 400;

export type ChatLayout = { twoPane: boolean; listWidth: number | null };

/**
 * Measured from the Chats container itself, not the window, so the sidebar of
 * the tablet shell and split-screen are accounted for. Phones never go
 * two-pane, even sideways.
 */
export function chatLayout(isTablet: boolean, containerWidth: number): ChatLayout {
  if (!isTablet || containerWidth < TWO_PANE_MIN_WIDTH) return { twoPane: false, listWidth: null };
  const listWidth = Math.min(LIST_PANE_MAX, Math.max(LIST_PANE_MIN, Math.round(containerWidth * 0.36)));
  return { twoPane: true, listWidth };
}
