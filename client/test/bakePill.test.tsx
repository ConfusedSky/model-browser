// @vitest-environment happy-dom
// TEMPORARY — `file-frame-spindle` D7's compare pill in the mounted app: the
// two LRU instances hold separate parses of one path, a flip re-renders every
// visible tile locally through the other instance, and hands the hover warmer
// that instance too. Deleted by task 5.2 with the pill.
//
// `vi.unmock` first, as `bakeToggle.test.ts` does: the suite-wide setup
// (`bakePillGuard.setup.ts`) lifts the write guard for every other file, and
// the flip cell here asserts that the local render's PUT is the one the guard
// drops.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
// The harness before any `../src` module (test/CLAUDE.md): imported after the
// renderer, the app's own importers get the real `renderThumbnail` and the
// flip cell counts nothing.
import {
  click,
  container,
  fetchModel,
  getThumb,
  model,
  mountApp,
  putThumb,
  renderThumbnail,
  tiles,
  unmountApp,
  wait,
} from './appHarness'
import { HOVER_LINGER_MS } from '../src/lib/hover'
import { setLegacyBake } from '../src/three/bakeToggle'
import { parseModel } from '../src/three/models'
import { RIG_VERSION, THUMB_LIGHTING } from '../src/three/renderer'

vi.unmock('../src/three/bakeToggle')
vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)
// The real parser, observed: which `bake` each instance's loader passed.
vi.mock('../src/three/models', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/three/models')>()
  return { ...real, parseModel: vi.fn(real.parseModel) }
})

const LISTING: DirListing = { path: '/models', entries: [model('part.stl'), model('lid.stl')] }

function bakePill(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('button[title^="Legacy Z-up bake"]')!
}

/** Linger on a tile past the warmer's debounce, so `liveLru.warm` fires. */
async function hover(tile: HTMLElement): Promise<void> {
  tile.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
  await wait(HOVER_LINGER_MS + 30)
}

/** The parses the other instance made, by the object each produced. */
function bakedParses(): unknown[] {
  const spy = vi.mocked(parseModel)
  return spy.mock.calls.flatMap(([, , bake], i) => (bake ? [spy.mock.results[i]!.value] : []))
}

beforeEach(async () => {
  // A current hit for every tile: the sweep draws the server's picture and
  // renders nothing, so a lookup restarted by a flip would render nothing
  // either — the only renders below are the flip's own.
  getThumb.mockResolvedValue({ status: 'hit', pngUrl: 'blob:t', lighting: THUMB_LIGHTING, rig: RIG_VERSION })
  vi.mocked(parseModel).mockClear()
  await mountApp('/models', LISTING)
})
afterEach(async () => {
  setLegacyBake(false)
  await unmountApp()
})

describe('the compare pill', () => {
  it('re-renders every visible tile locally through the other instance on a flip, and the guard drops the writes', async () => {
    expect(bakePill().getAttribute('aria-pressed')).toBe('false')
    expect(renderThumbnail).not.toHaveBeenCalled()

    await click(bakePill())
    expect(bakePill().getAttribute('aria-pressed')).toBe('true')
    await wait(50)

    // Once per model, each with the mesh the *other* instance parsed — a
    // restarted lookup would have drawn the server's hit and rendered nothing.
    expect(renderThumbnail).toHaveBeenCalledTimes(2)
    const rendered = renderThumbnail.mock.calls.map(([object]: unknown[]) => object)
    expect(bakedParses()).toHaveLength(2)
    expect(new Set(rendered)).toEqual(new Set(bakedParses()))
    // The render ends in a PUT, and the pill's guard is what drops it: nothing
    // reaches the wire on either side of the pill while it exists (D7).
    expect(putThumb).not.toHaveBeenCalled()
  })

  it('warms through the other instance after a flip, which parses the path again under the other bake', async () => {
    await hover(tiles()[0]!)
    expect(fetchModel).toHaveBeenCalledTimes(1)

    await click(bakePill())
    await wait(50)
    // The flip's renders loaded both models into the other instance.
    expect(fetchModel).toHaveBeenCalledTimes(3)
    const calls = vi.mocked(parseModel).mock.calls.map(([, format, bake]) => [format, bake])
    expect(calls).toEqual([
      ['stl', false],
      ['stl', true],
      ['stl', true],
    ])
    // The other instance already holds this path, so a warmer rebuilt around
    // it loads nothing more; one still on the first instance would fetch again.
    await hover(tiles()[1]!)
    expect(fetchModel).toHaveBeenCalledTimes(3)
    const [first, second] = vi.mocked(parseModel).mock.results.map((r) => r.value as unknown)
    expect(first).not.toBe(second)
  })
})
