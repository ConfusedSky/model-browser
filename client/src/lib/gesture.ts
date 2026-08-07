export const DRAG_THRESHOLD_PX = 5

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
