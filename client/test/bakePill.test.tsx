// @vitest-environment happy-dom
// TEMPORARY — `file-frame-spindle` D7's compare pill in the mounted app: the
// two LRU instances hold separate parses of one path, and a flip hands the
// hover warmer the other instance. Deleted by task 5.2 with the pill.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
import { HOVER_LINGER_MS } from '../src/lib/hover'
import { setLegacyBake } from '../src/three/bakeToggle'
import { parseModel } from '../src/three/models'
import { RIG_VERSION, THUMB_LIGHTING } from '../src/three/renderer'
import { click, container, fetchModel, getThumb, model, mountApp, tiles, unmountApp, wait } from './appHarness'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)
// The real parser, observed: which `bake` each instance's loader passed.
vi.mock('../src/three/models', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/three/models')>()
  return { ...real, parseModel: vi.fn(real.parseModel) }
})

const LISTING: DirListing = { path: '/models', entries: [model('part.stl')] }

function bakePill(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('button[title^="Legacy Z-up bake"]')!
}

/** Linger on a tile past the warmer's debounce, so `liveLru.warm` fires. */
async function hover(tile: HTMLElement): Promise<void> {
  tile.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
  await wait(HOVER_LINGER_MS + 30)
}

beforeEach(async () => {
  // A current hit: the tile draws the server's picture and renders nothing, so
  // the only loads below are the warmer's.
  getThumb.mockResolvedValue({ status: 'hit', pngUrl: 'blob:t', lighting: THUMB_LIGHTING, rig: RIG_VERSION })
  vi.mocked(parseModel).mockClear()
  await mountApp('/models', LISTING)
})
afterEach(async () => {
  setLegacyBake(false)
  await unmountApp()
})

describe('the compare pill', () => {
  it('warms through the other instance after a flip, which parses the path again under the other bake', async () => {
    expect(bakePill().getAttribute('aria-pressed')).toBe('false')
    await hover(tiles()[0]!)
    expect(fetchModel).toHaveBeenCalledTimes(1)

    await click(bakePill())
    expect(bakePill().getAttribute('aria-pressed')).toBe('true')
    // The first instance already holds this path; a second load is the other
    // instance's, and it can only come from the warmer being rebuilt around it.
    await hover(tiles()[0]!)
    expect(fetchModel).toHaveBeenCalledTimes(2)

    const calls = vi.mocked(parseModel).mock.calls.map(([, format, bake]) => [format, bake])
    expect(calls).toEqual([
      ['stl', false],
      ['stl', true],
    ])
    const [first, second] = vi.mocked(parseModel).mock.results.map((r) => r.value as unknown)
    expect(first).not.toBe(second)
  })
})
