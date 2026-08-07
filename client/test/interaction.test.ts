import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAG_THRESHOLD_PX, GestureTracker } from '../src/lib/gesture'
import { createHoverWarmer, HOVER_LINGER_MS } from '../src/lib/hover'

describe('GestureTracker (click vs drag)', () => {
  it('a sub-threshold release is a click, not a drag', () => {
    const t = new GestureTracker()
    t.start(100, 100)
    t.move(102, 102)
    expect(t.isDrag).toBe(false)
  })

  it('crossing the threshold makes it a drag', () => {
    const t = new GestureTracker()
    t.start(100, 100)
    t.move(100 + DRAG_THRESHOLD_PX + 1, 100)
    expect(t.isDrag).toBe(true)
  })

  it('a drag stays a drag even if the pointer returns to the origin', () => {
    const t = new GestureTracker()
    t.start(100, 100)
    t.move(120, 120)
    t.move(100, 100)
    expect(t.isDrag).toBe(true)
  })

  it('start resets the gesture', () => {
    const t = new GestureTracker()
    t.start(0, 0)
    t.move(50, 50)
    t.start(0, 0)
    expect(t.isDrag).toBe(false)
  })
})

describe('hover warmer (linger debounce)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires only after the linger threshold', () => {
    const warm = vi.fn()
    const h = createHoverWarmer(warm)
    h.enter('/a.stl')
    vi.advanceTimersByTime(HOVER_LINGER_MS - 1)
    expect(warm).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(warm).toHaveBeenCalledWith('/a.stl')
  })

  it('sweeping across tiles fires nothing', () => {
    const warm = vi.fn()
    const h = createHoverWarmer(warm)
    for (const p of ['/a.stl', '/b.stl', '/c.stl']) {
      h.enter(p)
      vi.advanceTimersByTime(30) // faster than the linger
    }
    h.leave()
    vi.advanceTimersByTime(1000)
    expect(warm).not.toHaveBeenCalled()
  })

  it('leave cancels a pending warm', () => {
    const warm = vi.fn()
    const h = createHoverWarmer(warm)
    h.enter('/a.stl')
    h.leave()
    vi.advanceTimersByTime(1000)
    expect(warm).not.toHaveBeenCalled()
  })
})
