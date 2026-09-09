// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import {
  applyIn,
  measureIn,
  measurePlacement,
  resolvePlacement,
  type Placement,
} from '../src/lib/placement'

const entries = (...paths: string[]) => paths.map((path) => ({ path }))

describe('resolvePlacement (D4 chain)', () => {
  const listing = entries('/Kit A', '/Kit B', '/Kit C/part.stl')

  it('top is top', () => {
    expect(resolvePlacement({ kind: 'top' }, listing)).toEqual({ kind: 'top' })
  })

  it('entry: the anchor in the listing lands at its offset', () => {
    const placement: Placement = { anchor: '/Kit B', offset: -37 }
    expect(resolvePlacement({ kind: 'entry', placement }, listing)).toEqual({
      kind: 'anchor',
      path: '/Kit B',
      offset: -37,
    })
  })

  it('entry: an anchor missing from the listing falls to the top', () => {
    const placement: Placement = { anchor: '/Gone', offset: -37 }
    expect(resolvePlacement({ kind: 'entry', placement }, listing)).toEqual({ kind: 'top' })
  })

  it('entry: no remembered placement is the top', () => {
    expect(resolvePlacement({ kind: 'entry', placement: null }, listing)).toEqual({ kind: 'top' })
  })

  it('up: the parent anchor wins over the child when both are present', () => {
    const placement: Placement = { anchor: '/Kit C/part.stl', offset: -5 }
    expect(resolvePlacement({ kind: 'up', placement, child: '/Kit A' }, listing)).toEqual({
      kind: 'anchor',
      path: '/Kit C/part.stl',
      offset: -5,
    })
  })

  it('up from a deep arrival: no anchor, the child folder is centred', () => {
    expect(resolvePlacement({ kind: 'up', placement: null, child: '/Kit A' }, listing)).toEqual({
      kind: 'center',
      path: '/Kit A',
    })
  })

  it('up: an absent anchor falls to the child when the child is present', () => {
    const placement: Placement = { anchor: '/Gone', offset: -5 }
    expect(resolvePlacement({ kind: 'up', placement, child: '/Kit B' }, listing)).toEqual({
      kind: 'center',
      path: '/Kit B',
    })
  })

  it('up in flat: a folder anchor and a folder child, neither shown, fall to the top', () => {
    // Flat shows models only; both the remembered folder anchor and the child
    // folder are absent from what landed. No flat comparison — presence alone.
    const flat = entries('/Kit A/a.stl', '/Kit B/b.stl')
    const placement: Placement = { anchor: '/Kit A', offset: -12 }
    expect(resolvePlacement({ kind: 'up', placement, child: '/Kit B' }, flat)).toEqual({
      kind: 'top',
    })
  })

  it('up in flat: a model anchor survives the toggle', () => {
    const flat = entries('/Kit A/a.stl', '/Kit C/part.stl')
    const placement: Placement = { anchor: '/Kit C/part.stl', offset: -12 }
    expect(resolvePlacement({ kind: 'up', placement, child: '/Kit B' }, flat)).toEqual({
      kind: 'anchor',
      path: '/Kit C/part.stl',
      offset: -12,
    })
  })

  it('reveal: a present path is centred, an absent one is the top', () => {
    expect(resolvePlacement({ kind: 'reveal', path: '/Kit B' }, listing)).toEqual({
      kind: 'center',
      path: '/Kit B',
    })
    expect(resolvePlacement({ kind: 'reveal', path: '/Gone' }, listing)).toEqual({ kind: 'top' })
  })
})

describe('measurePlacement (D1)', () => {
  const tile = (path: string, top: number, height = 100) => ({ path, top, bottom: top + height })

  it('picks the first tile crossing the top edge, with a negative offset', () => {
    // Scrollport top at 300: rows at 0 and 100 are fully past; the row at 200
    // spans 200–300 — bottom equals the edge, not past it — and the row at 250
    // (a second column would share a top; here rows are one tile) crosses.
    const tiles = [tile('/a', 0), tile('/b', 100), tile('/c', 200), tile('/d', 260), tile('/e', 360)]
    expect(measurePlacement(300, tiles)).toEqual({ anchor: '/d', offset: -40 })
  })

  it('a tile whose bottom sits exactly on the edge is past, not crossing', () => {
    expect(measurePlacement(100, [tile('/a', 0), tile('/b', 100)])).toEqual({
      anchor: '/b',
      offset: 0,
    })
  })

  it('a listing that starts below the edge answers its first tile at a positive offset', () => {
    expect(measurePlacement(0, [tile('/a', 48), tile('/b', 148)])).toEqual({
      anchor: '/a',
      offset: 48,
    })
  })

  it('no tiles is null', () => {
    expect(measurePlacement(0, [])).toBeNull()
  })

  it('every tile scrolled past is null', () => {
    expect(measurePlacement(1000, [tile('/a', 0), tile('/b', 100)])).toBeNull()
  })
})

/** A DOMRect-shaped stub; happy-dom lays nothing out, so every rect is set by the cell. */
function rect(top: number, height: number): DOMRect {
  const r = { x: 0, y: top, width: 100, height, top, bottom: top + height, left: 0, right: 100 }
  return { ...r, toJSON: () => r } as DOMRect
}

interface Fixture {
  scroller: HTMLElement
  tiles: Map<string, HTMLElement>
  setRect(path: string, top: number, height?: number): void
}

/** A scroller with `data-entry-tile` buttons, its rect at `scrollerTop`, tiles rect-less
 *  until `setRect`, and `clientHeight` as given (happy-dom's own is 0). */
function fixture(paths: string[], scrollerTop = 0, clientHeight = 600): Fixture {
  const scroller = document.createElement('main')
  scroller.getBoundingClientRect = () => rect(scrollerTop, clientHeight)
  Object.defineProperty(scroller, 'clientHeight', { value: clientHeight, configurable: true })
  const tiles = new Map<string, HTMLElement>()
  for (const path of paths) {
    const el = document.createElement('button')
    el.setAttribute('data-entry-tile', path)
    el.getBoundingClientRect = () => rect(0, 0)
    scroller.appendChild(el)
    tiles.set(path, el)
  }
  document.body.appendChild(scroller)
  return {
    scroller,
    tiles,
    setRect(path, top, height = 100) {
      tiles.get(path)!.getBoundingClientRect = () => rect(top, height)
    },
  }
}

describe('applyIn', () => {
  it('anchor: scrolls so the tile top sits at the remembered offset', () => {
    const f = fixture(['/a', '/b', '/c'], 100)
    f.scroller.scrollTop = 200
    f.setRect('/b', 130) // 30 px below the scrollport's top edge
    expect(applyIn(f.scroller, { kind: 'anchor', path: '/b', offset: -20 })).toBe(true)
    // Needs the tile 50 px higher on screen: 30 − (−20).
    expect(f.scroller.scrollTop).toBe(250)
  })

  it('anchor: an offset of zero flushes the tile to the edge', () => {
    const f = fixture(['/a'], 100)
    f.scroller.scrollTop = 0
    f.setRect('/a', 175)
    applyIn(f.scroller, { kind: 'anchor', path: '/a', offset: 0 })
    expect(f.scroller.scrollTop).toBe(75)
  })

  it('resize: the same anchor found in a different row keeps its offset', () => {
    // Left at two columns with /f as the anchor 20 px above the edge; back at
    // four columns /f is in row 1 rather than row 2 and sits somewhere else
    // entirely. Whatever its new row, after the apply its top is 20 px above
    // the edge again — the invariant, not a scrollTop number.
    const placement: Placement = { anchor: '/f', offset: -20 }
    for (const tileTop of [30, 430, 1000]) {
      const f = fixture(['/a', '/f'], 50)
      const before = f.scroller.scrollTop
      f.setRect('/f', tileTop)
      expect(applyIn(f.scroller, { kind: 'anchor', path: placement.anchor, offset: placement.offset })).toBe(true)
      const moved = f.scroller.scrollTop - before
      const visualTopAfter = tileTop - 50 - moved
      expect(visualTopAfter).toBe(placement.offset)
    }
  })

  it('center: puts the tile in the middle of the scrollport', () => {
    const f = fixture(['/a', '/b'], 0, 600)
    f.scroller.scrollTop = 40
    f.setRect('/b', 500, 200) // want its top at (600 − 200) / 2 = 200
    expect(applyIn(f.scroller, { kind: 'center', path: '/b' })).toBe(true)
    expect(f.scroller.scrollTop).toBe(40 + 300)
  })

  it('top: sets scrollTop to 0 and reports placed', () => {
    const f = fixture(['/a'])
    f.scroller.scrollTop = 900
    expect(applyIn(f.scroller, { kind: 'top' })).toBe(true)
    expect(f.scroller.scrollTop).toBe(0)
  })

  it('a tile not in the grid is false and the scroller is untouched', () => {
    const f = fixture(['/a'])
    f.scroller.scrollTop = 333
    expect(applyIn(f.scroller, { kind: 'anchor', path: '/zzz', offset: -1 })).toBe(false)
    expect(applyIn(f.scroller, { kind: 'center', path: '/zzz' })).toBe(false)
    expect(f.scroller.scrollTop).toBe(333)
  })

  it('finds a path carrying spaces, quotes and a zip entry', () => {
    const path = '/Kit A/x "y".zip!/part one.stl'
    const f = fixture(['/decoy', path], 0)
    f.setRect(path, 120)
    expect(applyIn(f.scroller, { kind: 'anchor', path, offset: 0 })).toBe(true)
    expect(f.scroller.scrollTop).toBe(120)
  })

  it('a scroller that cannot be measured is false, never a throw', () => {
    const f = fixture(['/a'])
    f.setRect('/a', 10)
    f.scroller.getBoundingClientRect = () => {
      throw new Error('detached')
    }
    expect(applyIn(f.scroller, { kind: 'anchor', path: '/a', offset: 0 })).toBe(false)
    f.scroller.getBoundingClientRect = () => undefined as unknown as DOMRect
    expect(applyIn(f.scroller, { kind: 'center', path: '/a' })).toBe(false)
  })
})

describe('measureIn', () => {
  it('reads tiles in document order and stops at the first crossing', () => {
    const f = fixture(['/a', '/b', '/c'], 100)
    f.setRect('/a', 0, 80) // bottom 80 — past the edge at 100
    f.setRect('/b', 80, 80) // bottom 160 — crosses; top is 20 above the edge
    const untouched = vi.fn(() => rect(160, 80))
    f.tiles.get('/c')!.getBoundingClientRect = untouched
    expect(measureIn(f.scroller)).toEqual({ anchor: '/b', offset: -20 })
    expect(untouched).not.toHaveBeenCalled()
  })

  it('a grid with no tiles is null', () => {
    const f = fixture([], 100)
    expect(measureIn(f.scroller)).toBeNull()
  })

  it('a scroller that cannot be measured is null, never a throw', () => {
    const f = fixture(['/a'])
    f.scroller.getBoundingClientRect = () => {
      throw new Error('detached')
    }
    expect(measureIn(f.scroller)).toBeNull()
  })
})
