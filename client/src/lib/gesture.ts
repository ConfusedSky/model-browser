export const DRAG_THRESHOLD_PX = 5;

/**
 * Whether a `contextmenu` asks for the platform's menu rather than the app's.
 *
 * Shift, not Ctrl: Ctrl+click *is* the secondary press on macOS and arrives with
 * `ctrlKey` set. The button clause makes "pointer gesture only" true by
 * construction — a keyboard-dispatched `contextmenu` carries `button: -1` or
 * `0`, never `2` — at the cost of macOS Ctrl+Shift+click
 * (docs/platform-surface.md).
 */
export function nativeMenuRequested(e: {
  shiftKey: boolean;
  button: number;
}): boolean {
  return e.shiftKey && e.button === 2;
}

/** A press that never exceeds the threshold is a click; past it, an orbit. */
export class GestureTracker {
  private startX = 0;
  private startY = 0;
  private dragging = false;

  start(x: number, y: number): void {
    this.startX = x;
    this.startY = y;
    this.dragging = false;
  }

  /** True once the gesture has **ever** exceeded the threshold. */
  move(x: number, y: number): boolean {
    if (!this.dragging) {
      const dx = x - this.startX;
      const dy = y - this.startY;
      if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX)
        this.dragging = true;
    }
    return this.dragging;
  }

  get isDrag(): boolean {
    return this.dragging;
  }
}
