// @vitest-environment happy-dom
// An untouched lightbox close writes nothing (`pose-rerender` D4). Masa's second
// live test, 2026-09-11: with the index stopped, opening a model and closing the
// lightbox untouched stored the default camera, and with the index back that
// stored camera withheld the pose forever ("a stored camera wins"). A close
// persists — camera, axis and pixels — only after an orbit, a zoom or an axis
// change; whatever the lightbox opened at (a stored camera, the pose in hand,
// the default), Escape alone writes nothing and the tile keeps what it had. The
// reveal / find-similar exits and browser back run the same close
// (viewerPanelActions, urlLightbox), so history navigation without a tile click
// — which was storing cameras too — follows the same rule.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing, IndexPose } from '../../shared/types'
import {
  getThumb,
  indexAvailability,
  listDir,
  model,
  mountAppAtCurrentUrl,
  putThumb,
  renderThumbnail,
  semanticPosesFor,
  settle,
  tiles,
  unmountApp,
  wait,
} from './appHarness'
import { DEFAULT_CAMERA } from '../src/three/camera'
import { cameraForPose, POSE_VERSION, poseKeyOf } from '../src/three/pose'
import { RIG_VERSION, THUMB_LIGHTING } from '../src/three/renderer'
import { setAoEnabled } from '../src/viewer/aoToggle'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const HERO = '/models/hero.stl'
const LISTING: DirListing = { path: '/models', entries: [model('hero.stl')] }
/** Visibly not the default, so a write of it could only be the stored camera. */
const STORED = { az: 1.25, el: -0.4, distR: 4.5, target: [0, 0, 0] as [number, number, number] }
const POSE: IndexPose = {
  up: [0, -1, 0],
  azimuth_zero: [1, 0, 0],
  source: 'test',
  confidence: 1,
  front: { view: 0, azimuth_deg: 40, elevation_deg: 20 },
}
/** A complete hit under the recipe in force: the sweep draws nothing for it. */
const HIT = { status: 'hit', pngUrl: 'blob:hero', lighting: THUMB_LIGHTING, rig: RIG_VERSION }

const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]')
const tileImage = (): string => tiles()[0]?.querySelector('img')?.getAttribute('src') ?? ''

/** Deep-linked open: this lightbox closes without `history.back`, which the
 *  suite plays by hand rather than through the browser (client/test/CLAUDE.md). */
async function open(): Promise<void> {
  await mountAppAtCurrentUrl('/?path=%2Fmodels&model=%2Fmodels%2Fhero.stl', LISTING)
  listDir.mockResolvedValue(LISTING)
  await wait(200)
  await settle()
  expect(dialog()).not.toBeNull()
  // The mesh has landed: the canvas, not the spinner.
  expect(dialog()!.querySelector('.cursor-grab')).not.toBeNull()
}
async function escape(): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  })
  await wait(300)
  await settle()
  expect(dialog()).toBeNull()
}
/** Drag on the lightbox's canvas — the manipulation that makes a close write. */
async function orbit(): Promise<void> {
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
}

beforeEach(() => {
  setAoEnabled(true)
  indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models' })
  semanticPosesFor.mockResolvedValue({ poses: {} })
  renderThumbnail.mockClear()
  putThumb.mockClear()
})
afterEach(async () => {
  getThumb.mockResolvedValue({ status: 'miss' })
  semanticPosesFor.mockResolvedValue({ poses: {} })
  await unmountApp()
})

describe('an untouched close writes nothing', () => {
  it('opened at a stored camera', async () => {
    getThumb.mockResolvedValue({ ...HIT, camera: STORED, axis: 'y' })
    await open()
    const shown = tileImage()
    putThumb.mockClear()

    await escape()

    expect(putThumb).not.toHaveBeenCalled()
    expect(tileImage()).toBe(shown)
  })

  it('opened from a pose — was: pixels labelled posed, keyless, and no camera', async () => {
    // The third posed writer D6 retired: a render drawn under the pose already
    // sits in the cache, keyed, so the close has nothing to add.
    getThumb.mockResolvedValue({
      ...HIT,
      posed: POSE_VERSION,
      poseKey: poseKeyOf(cameraForPose(POSE, DEFAULT_CAMERA)!),
    })
    semanticPosesFor.mockResolvedValue({ poses: { [HERO]: POSE } })
    await open()
    const shown = tileImage()
    putThumb.mockClear()

    await escape()

    expect(putThumb).not.toHaveBeenCalled()
    expect(tileImage()).toBe(shown)
  })

  it('opened with nothing in hand — the default, which was the camera being stored', async () => {
    // Masa's case: the index down, so no pose reaches the viewer and it opens
    // at the default. The close used to store that camera; nothing chose it.
    getThumb.mockResolvedValue(HIT)
    await open()
    const shown = tileImage()
    putThumb.mockClear()

    await escape()

    expect(putThumb).not.toHaveBeenCalled()
    expect(renderThumbnail).not.toHaveBeenCalled()
    expect(tileImage()).toBe(shown)
  })

  it('control: after an orbit the close persists once — camera, axis and pixels, no pose label', async () => {
    getThumb.mockResolvedValue(HIT)
    await open()
    await orbit()
    // The release's own persist is the orbit's; the close's is the one counted.
    putThumb.mockClear()

    await escape()

    expect(putThumb).toHaveBeenCalledTimes(1)
    const save = putThumb.mock.calls[0]![0] as Record<string, unknown>
    expect(save.path).toBe(HERO)
    expect(save.png).toBeDefined()
    expect(save.camera).toBeDefined()
    expect(save.axis).toBeDefined()
    expect(save.posed).toBeUndefined()
    expect(save.poseKey).toBeUndefined()
  })
})
