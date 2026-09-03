export const DRAG_THRESHOLD_PX = 5

/**
 * Whether a `contextmenu` event asks for the platform's own menu rather than
 * the app's (entry-actions, *A context menu on grid tiles*: the shifted
 * secondary press is left to the browser).
 *
 * Shift, not Ctrl: Ctrl+click *is* the secondary press on macOS and arrives
 * here with `ctrlKey` set, and Shift+secondary is the gesture Firefox already
 * honours below the page. The button clause is what makes "pointer gesture
 * only" true by construction rather than by Chrome's habit of suppressing the
 * event after a prevented keydown: a keyboard-dispatched `contextmenu` carries
 * `button: -1` (Chrome 150, measured 2026-09-02 — keys land at the element's
 * centre, never at (0, 0)) or `0`, never `2`. Cost: macOS Ctrl+Shift+click is
 * physically the primary button and is not the bypass; a second button or a
 * two-finger tap is (docs/platform-surface.md).
 */
export function nativeMenuRequested(e: { shiftKey: boolean; button: number }): boolean {
  return e.shiftKey && e.button === 2
}

/**
 * Discriminates click from drag: a press whose total movement never exceeds
 * the threshold is a click (opens the lightbox); past it, it's an orbit.
 */
export class GestureTracker {
  private startX = 0
  private startY = 0
  private dragging = false

  start(x: number, y: number): void {
    this.startX = x
    this.startY = y
    this.dragging = false
  }

  /** Returns true once the gesture has ever exceeded the threshold. */
  move(x: number, y: number): boolean {
    if (!this.dragging) {
      const dx = x - this.startX
      const dy = y - this.startY
      if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) this.dragging = true
    }
    return this.dragging
  }

  get isDrag(): boolean {
    return this.dragging
  }
}
