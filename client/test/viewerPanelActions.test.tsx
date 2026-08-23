// @vitest-environment happy-dom
//
// The lightbox info panel's action row (follow-up 6.6): the entry actions as
// affordances, not only behind a secondary press.
//
// Two halves are pinned here. The wiring half — which actions the panel offers,
// and that the two view-changing ones leave through the same persisting close
// every other exit takes — is asserted through a mounted App, because the close
// is App's watcher answering a view that no longer names the model. The
// framing-reset half is the reason this surface may offer a command the
// right-click menu withholds, so it is asserted twice: end-to-end through the
// panel (the store discarded, the open view re-framed, and the close *not*
// putting the discarded camera back), and directly on `resetFramingLive` for
// the posed case, which needs a landed answer carrying a pose.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirEntry, DirListing, IndexPose } from '../../shared/types'
import {
  RESET_FAILED,
  resetFramingLive,
  type ActionHost,
  type LiveFramingView,
} from '../src/lib/entryActions'
import { DEFAULT_CAMERA } from '../src/three/camera'
import { cameraForPose } from '../src/three/pose'
import { RIG_VERSION } from '../src/three/renderer'
import { getLightingMode } from '../src/viewer/lighting'
import {
  click,
  container,
  dir,
  getThumb,
  indexAvailability,
  listDir,
  model,
  mountApp,
  mountAppAtCurrentUrl,
  putThumb,
  renderThumbnail,
  settle,
  similar,
  tiles,
  unmountApp,
  wait,
} from './appHarness'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

/** A model that lives one folder down, so *reveal* has somewhere to go. */
const FOUND = '/models/Alpha/found.stl'
const NESTED: DirListing = { path: '/models', entries: [dir('Alpha'), model('Alpha/found.stl')] }
const ALPHA: DirListing = { path: '/models/Alpha', entries: [model('Alpha/found.stl')] }
const NEIGHBOURS = { path: '/models', entries: [model('near.stl')], poses: {} }

/** The orientation this model has stored — visibly not the default, so a view
 *  that ends up at the default can only have been re-framed. */
const STORED = { az: 1.25, el: -0.4, distR: 4.5, target: [0, 0, 0] as [number, number, number] }

const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]')
const actionRow = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[aria-label="Model actions"]')
const actions = (): string[] =>
  Array.from(actionRow()?.querySelectorAll<HTMLButtonElement>('button') ?? []).map(
    (b) => b.dataset.command ?? '',
  )
const action = (id: string): HTMLButtonElement =>
  actionRow()!.querySelector<HTMLButtonElement>(`button[data-command="${id}"]`)!
const closeButton = (): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!
const marked = (): HTMLElement | null =>
  container.querySelector<HTMLElement>('.animate-reveal-mark')
const tile = (name: string): HTMLElement => tiles().find((t) => t.getAttribute('title') === name)!

/** Writes to the cache for one path — the shape a PUT's body has. */
interface Body {
  path: string
  png?: unknown
  camera?: unknown
  axis?: unknown
  posed?: unknown
}
const writesFor = (path: string): Body[] =>
  putThumb.mock.calls.map(([b]) => b as Body).filter((b) => b.path === path)

/** Press and release without dragging: the overlay promotes to the lightbox. */
async function openLightbox(name: string): Promise<void> {
  await act(async () => {
    tile(name).dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50, button: 0 }),
    )
  })
  await settle()
  await act(async () => {
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 50, clientY: 50 }))
  })
  await wait(150)
}

beforeEach(async () => {
  // The index answers for this collection, so *find similar* is on the table.
  indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models' })
  await mountApp('/models', NESTED)
  listDir.mockImplementation((target: string) =>
    Promise.resolve(target === '/models/Alpha' ? ALPHA : NESTED),
  )
})
afterEach(async () => {
  getThumb.mockResolvedValue({ status: 'miss' })
  await unmountApp()
})

describe('the info panel offers the entry actions', () => {
  it('shows reveal, find similar and reset framing beside the copy affordance', async () => {
    await openLightbox('Alpha/found.stl')
    expect(dialog()).not.toBeNull()

    // *Reset framing* is here and not in this surface's menu: only this press
    // carries the live-session semantics that make it honest. *Re-render* is in
    // neither — the closing persist is the re-render. *Copy path* is not
    // duplicated: the panel already has it, beside the path it copies.
    expect(actions()).toEqual(['reveal', 'findSimilar', 'resetFraming'])
    expect(document.querySelector('button[aria-label="Copy path"]')).not.toBeNull()
  })

  it('withholds find similar when the index is not answering', async () => {
    // Same rule the menu reads — `state.index`, the reducer's own cell — so the
    // panel cannot offer a question the menu would not.
    await unmountApp()
    await mountApp('/models', NESTED)
    listDir.mockResolvedValue(NESTED)

    await openLightbox('Alpha/found.stl')
    expect(actions()).toEqual(['reveal', 'resetFraming'])
  })
})

describe('a panel action that changes the view', () => {
  it('reveal navigates, marks the entry, and takes the lightbox out through the persisting close', async () => {
    await openLightbox('Alpha/found.stl')
    putThumb.mockClear()

    await click(action('reveal'))
    await wait(250)

    expect(window.location.search).toContain('path=%2Fmodels%2FAlpha')
    expect(marked()).not.toBeNull()
    expect(marked()!.getAttribute('title')).toBe('Alpha/found.stl')
    // The model left the view, so App signalled the persisting close and the
    // session wrote its camera on the way out — not a bare unmount. The camera
    // is what says which write this was: the background sweep PUTs pixels and
    // labels and never a viewpoint, so `putThumb` having been called at all
    // proves nothing (the lesson from 6.5's find-similar case).
    expect(dialog()).toBeNull()
    expect(writesFor(FOUND).filter((b) => b.camera !== undefined).length).toBeGreaterThan(0)
  })

  it('find similar lands the similarity view and leaves the same way', async () => {
    similar.mockResolvedValue(NEIGHBOURS)
    await openLightbox('Alpha/found.stl')
    putThumb.mockClear()

    await click(action('findSimilar'))
    await wait(250)

    expect(dialog()).toBeNull()
    expect(similar).toHaveBeenCalled()
    expect(window.location.search).toContain('similar=%2Fmodels%2FAlpha%2Ffound.stl')
    expect(tiles().map((t) => t.getAttribute('title'))).toContain('near.stl')
    expect(writesFor(FOUND).filter((b) => b.camera !== undefined).length).toBeGreaterThan(0)
  })
})

describe('reset framing from the panel', () => {
  /**
   * Deep-linked rather than pointer-opened: this lightbox closes without
   * `history.back`, which the harness's stubbed URL cannot survive.
   */
  async function openStoredModel(): Promise<void> {
    await unmountApp()
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models' })
    // A hit carrying the user's own orientation: the session opens at it, and
    // it is what the reset gives up. A *complete* hit — pixels, and labels
    // matching what is in force — so the thumbnail sweep draws nothing and
    // every render in this case is one the viewer asked for.
    getThumb.mockResolvedValue({
      status: 'hit',
      camera: STORED,
      axis: 'y',
      pngUrl: 'blob:stored',
      lighting: getLightingMode(),
      rig: RIG_VERSION,
    })
    await mountAppAtCurrentUrl('/?path=%2Fmodels&model=%2Fmodels%2FAlpha%2Ffound.stl', NESTED)
    listDir.mockResolvedValue(NESTED)
    await wait(200)
    expect(dialog()).not.toBeNull()
  }

  it('discards the stored orientation, re-frames the open view, and the close does not undo it', async () => {
    await openStoredModel()
    putThumb.mockClear()
    renderThumbnail.mockClear()

    await click(action('resetFraming'))
    await settle()

    // The store half: the camera is *discarded* (null, the third thing a write
    // can say), not overwritten with a default — and no pixels ride along,
    // because the closing persist is what redraws them. Nothing in this view
    // knows a pose for the model, so the axis it is framed about stays.
    const discards = writesFor(FOUND).filter((b) => b.camera === null)
    expect(discards.length).toBe(1)
    expect(discards[0]!.axis).toBeUndefined()
    expect(discards[0]!.png).toBeUndefined()

    await click(closeButton())
    await wait(250)
    expect(dialog()).toBeNull()

    // The live half, read off what the closing persist snapshotted: the session
    // was re-framed to what the model now resolves to, not left sitting at the
    // orientation just discarded.
    // The live half, read off what the closing persist snapshotted — the only
    // render in this case, since the tile's own thumbnail was a complete hit.
    expect(renderThumbnail.mock.calls.length).toBe(1)
    const snapshot = renderThumbnail.mock.calls[0] as unknown as [unknown, typeof STORED, string]
    expect(snapshot[1].az).toBeCloseTo(DEFAULT_CAMERA.az)
    expect(snapshot[1].el).toBeCloseTo(DEFAULT_CAMERA.el)
    expect(snapshot[1].distR).toBeCloseTo(DEFAULT_CAMERA.distR)
    expect(snapshot[2]).toBe('y') // the spindle stayed: nothing here knows a pose

    // And the one that matters: the close persisted pixels and no camera at
    // all. A close that wrote one — the discarded orientation, or the default
    // it resolved to — would resurrect what the user just gave up, which is the
    // race that keeps this command out of the right-click menu.
    expect(writesFor(FOUND).filter((b) => b.camera !== undefined && b.camera !== null)).toEqual([])
    const pixels = writesFor(FOUND).filter((b) => b.png !== undefined)
    expect(pixels.length).toBe(1)
    // Unlabelled, too: declining the camera usually means the index framed
    // this view, but here nothing did — labelling these default-framed pixels
    // posed would tell the grid a pose it has never applied is in force.
    expect(pixels[0]!.posed).toBeUndefined()
  })

  it('discards an orbit made before it, so the close cannot write that orbit back', async () => {
    // The race in its sharpest form, and the reason this command is allowed
    // here at all: the user orbits, then presses reset. Their orbit is a
    // decision the session records — until the reset gives it up. A close that
    // still read the session as manipulated would persist the very orientation
    // the press discarded.
    await openStoredModel()
    const canvas = dialog()!.querySelector<HTMLElement>('.cursor-grab')!
    await act(async () => {
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }),
      )
    })
    await act(async () => {
      const move = (x: number, y: number): void => {
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }))
      }
      move(160, 100) // beyond the drag threshold
      move(200, 120)
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 200, clientY: 120 }))
    })
    await settle()
    // The drag persisted a camera of its own — that is the orbit being a
    // decision, and it is what makes the assertion below about the reset.
    expect(writesFor(FOUND).filter((b) => b.camera !== undefined).length).toBeGreaterThan(0)
    putThumb.mockClear()

    await click(action('resetFraming'))
    await settle()
    await click(closeButton())
    await wait(250)

    expect(dialog()).toBeNull()
    expect(writesFor(FOUND).filter((b) => b.camera === null).length).toBe(1)
    expect(writesFor(FOUND).filter((b) => b.camera !== undefined && b.camera !== null)).toEqual([])
  })
})

/**
 * The body itself, for the case a mounted App cannot reach without a landed
 * meaning or similarity answer: the model has a pose, so the discard hands both
 * halves of the orientation back and the view is re-framed to the index's.
 */
describe('resetFramingLive', () => {
  const ENTRY: DirEntry = {
    name: 'hero.stl',
    path: '/models/hero.stl',
    kind: 'model',
    format: 'stl',
    size: 1,
    mtime: 7,
  }
  /** Expressible: file-space `up` (0,-1,0) is scene +Z, `azimuth_zero` ⟂ it. */
  const POSE: IndexPose = {
    up: [0, -1, 0],
    azimuth_zero: [1, 0, 0],
    source: 'test',
    confidence: 1,
    front: { view: 0, azimuth_deg: 40, elevation_deg: 20 },
  }

  interface Harness {
    host: ActionHost
    put: ReturnType<typeof vi.fn>
    discard: ReturnType<typeof vi.fn>
    report: ReturnType<typeof vi.fn>
    view: LiveFramingView & { reframe: ReturnType<typeof vi.fn> }
  }
  function harness(poses: Record<string, IndexPose> = {}): Harness {
    const put = vi.fn().mockResolvedValue(undefined)
    const discard = vi.fn()
    const report = vi.fn()
    return {
      put,
      discard,
      report,
      host: {
        poses,
        api: { putThumb: put },
        discardThumbFraming: discard,
        report,
      } as unknown as ActionHost,
      view: { axis: 'y', reframe: vi.fn() },
    }
  }
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  it('hands a posed model back to the index — camera and axis together', async () => {
    const h = harness({ [ENTRY.path]: POSE })
    resetFramingLive(ENTRY, h.host, h.view)

    expect(h.put).toHaveBeenCalledWith({
      path: ENTRY.path,
      mtime: ENTRY.mtime,
      camera: null,
      axis: null, // half a pose is not a pose
    })
    const resolved = cameraForPose(POSE, DEFAULT_CAMERA)!
    expect(h.view.reframe).toHaveBeenCalledWith(resolved.camera, resolved.axis, true)
    expect(resolved.axis).not.toBe('y') // the axis really moved
    await flush()
    expect(h.discard).toHaveBeenCalledWith(ENTRY.path, true)
  })

  it('keeps the axis when the view knows no pose, and still discards the camera', async () => {
    const h = harness()
    resetFramingLive(ENTRY, h.host, h.view)

    expect(h.put).toHaveBeenCalledWith({
      path: ENTRY.path,
      mtime: ENTRY.mtime,
      camera: null,
      axis: undefined, // absence keeps; there is nothing better to fall back to
    })
    expect(h.view.reframe).toHaveBeenCalledWith(DEFAULT_CAMERA, 'y', false)
    await flush()
    expect(h.discard).toHaveBeenCalledWith(ENTRY.path, false)
  })

  it('still discards with no session, and reports a write that did not land', async () => {
    // The panel is up while the mesh loads and after it fails: there is nothing
    // to re-frame, and what is *stored* is still the user's to give up.
    const h = harness()
    h.put.mockRejectedValueOnce(new Error('offline'))
    resetFramingLive(ENTRY, h.host, null)

    expect(h.put).toHaveBeenCalledTimes(1)
    await flush()
    expect(h.discard).not.toHaveBeenCalled()
    expect(h.report).toHaveBeenCalledWith(RESET_FAILED)
  })
})
