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
import type { DirListing, IndexPose, OrbitAxis } from '../../shared/types'
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
  semanticPosesFor,
  tiles,
  tinyStl,
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

beforeEach(() => {
  vi.mocked(parseModel).mockClear()
})
afterEach(async () => {
  setLegacyBake(false)
  await unmountApp()
})

describe('the compare pill', () => {
  beforeEach(async () => {
    // A current hit for every tile: the sweep draws the server's picture and
    // renders nothing, so a lookup restarted by a flip would render nothing
    // either — the only renders below are the flip's own.
    getThumb.mockResolvedValue({ status: 'hit', pngUrl: 'blob:t', lighting: THUMB_LIGHTING, rig: RIG_VERSION })
    await mountApp('/models', LISTING)
  })

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

/**
 * The spindle each side of the pill renders a model about (Masa, 2026-09-11:
 * "turning on bake makes all models turn on their sides"). Three root models
 * with nothing stored — the caches deleted, so every lookup misses and every
 * tile is rendered locally: one posed Z-up, one posed Y-up, one with no pose.
 * OFF renders in the file convention; ON must render in the legacy scene
 * convention the baked mesh is in — `[0,0,1]`→`y`, `[0,1,0]`→`-z` through
 * `toSceneSpace`, and an un-posed STL at the old default `y`.
 */
const perpendicular = (up: IndexPose['up']): IndexPose['azimuth_zero'] =>
  up[0] === 0 ? [1, 0, 0] : [0, 1, 0]
const pose = (up: IndexPose['up']): IndexPose => ({
  up,
  azimuth_zero: perpendicular(up),
  source: 'siglip',
  confidence: 0.9,
  front: { view: 0, azimuth_deg: 0, elevation_deg: 0 },
})
const THREE_MODELS: DirListing = {
  path: '/models',
  entries: [model('zup.stl'), model('yup.stl'), model('plain.stl')],
}
const POSES: Record<string, IndexPose> = {
  '/models/zup.stl': pose([0, 0, 1]),
  '/models/yup.stl': pose([0, 1, 0]),
}

/** The STL bytes with a path tag in the 80-byte header the parser ignores. */
function taggedStl(index: number): ArrayBuffer {
  const buf = tinyStl()
  new DataView(buf).setUint8(0, index + 1)
  return buf
}
const pathOfTag = (tag: number): string => THREE_MODELS.entries[tag - 1]!.path

/**
 * The spindle of the *last* render per path since `since`: a rendered object
 * is the parse of the bytes fetched for its path, and the tag in those bytes
 * names the path.
 */
function lastAxisByPath(since: number): Record<string, OrbitAxis> {
  const spy = vi.mocked(parseModel)
  const pathOf = new Map<unknown, string>()
  spy.mock.calls.forEach(([bytes], i) => {
    pathOf.set(spy.mock.results[i]!.value, pathOfTag(new DataView(bytes as ArrayBuffer).getUint8(0)))
  })
  const axes: Record<string, OrbitAxis> = {}
  for (const call of (renderThumbnail.mock.calls as unknown[][]).slice(since)) {
    axes[pathOf.get(call[0])!] = call[2] as OrbitAxis
  }
  return axes
}

describe('the compare pill, with nothing stored', () => {
  beforeEach(async () => {
    getThumb.mockResolvedValue({ status: 'miss' })
    semanticPosesFor.mockResolvedValue({ poses: POSES })
    fetchModel.mockImplementation((path) =>
      Promise.resolve(taggedStl(THREE_MODELS.entries.findIndex((e) => e.path === path))),
    )
    await mountApp('/models', THREE_MODELS)
    await wait(50)
  })

  it('renders about the file spindle with the pill OFF and the legacy scene spindle ON', async () => {
    expect(lastAxisByPath(0)).toEqual({
      '/models/zup.stl': 'z',
      '/models/yup.stl': 'y',
      '/models/plain.stl': 'z',
    })
    const before = renderThumbnail.mock.calls.length

    await click(bakePill())
    await wait(50)

    expect(renderThumbnail.mock.calls.length).toBe(before + 3)
    expect(lastAxisByPath(before)).toEqual({
      '/models/zup.stl': 'y',
      '/models/yup.stl': '-z',
      '/models/plain.stl': 'y',
    })
    // Each flip render drew the *baked* parse, not the un-baked LRU's.
    const rendered = renderThumbnail.mock.calls.slice(before).map(([object]: unknown[]) => object)
    expect(new Set(rendered)).toEqual(new Set(bakedParses()))
    expect(putThumb).not.toHaveBeenCalled()
  })
})
