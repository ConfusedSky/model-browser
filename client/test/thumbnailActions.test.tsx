// @vitest-environment happy-dom
//
// The thumbnail commands through App: the halves that only exist once the menu,
// the grid and the viewer are all on screen — that a tile with no image still
// offers them, that the index's poses reach them from a similarity grid, and
// that giving up a framing moves where the lightbox opens the model *in this
// session* rather than after the next load.
//
// What each command renders from and writes back is pinned in
// thumbnailCommands.test.ts, against the command table directly.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CameraState, DirListing, IndexPose, OrbitAxis } from '../../shared/types'
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
} from './appHarness'
import { DEFAULT_CAMERA } from '../src/three/camera'
import { cameraForPose } from '../src/three/pose'
import { RIG_VERSION, THUMB_LIGHTING } from '../src/three/renderer'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)
// The viewer itself is out of scope; what App hands it is the whole point.
// `camera`/`axis` come from `thumbs.get(path)`, which is the map reset framing
// has to write to for its effect to be visible before the next load.
const opened = vi.hoisted(() => ({
  camera: undefined as CameraState | undefined,
  axis: undefined as OrbitAxis | undefined,
  pose: undefined as IndexPose | undefined,
}))
vi.mock('../src/viewer/ViewerLayer', () => ({
  default: ({
    camera,
    axis,
    pose,
    onDismiss,
  }: {
    camera?: CameraState
    axis?: OrbitAxis
    pose?: IndexPose
    onDismiss: () => void
  }) => {
    opened.camera = camera
    opened.axis = axis
    opened.pose = pose
    return (
      <button type="button" data-testid="close-viewer" onClick={onDismiss}>
        close
      </button>
    )
  },
}))

const NESTED: DirListing = { path: '/models', entries: [dir('Alpha'), model('widget.stl')] }
const WIDGET = '/models/widget.stl'
const CAM: CameraState = { az: 1.2, el: 0.3, distR: 2.5, target: [0, 0, 0] }
/** File-space `up` (0,-1,0) is the `-y` spindle — a spindle that is not the default. */
const POSE: IndexPose = {
  up: [0, -1, 0],
  azimuth_zero: [1, 0, 0],
  source: 'test',
  confidence: 1,
  front: { view: 0, azimuth_deg: 40, elevation_deg: 20 },
}

async function secondaryPress(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 2, buttons: 2, clientX: 10, clientY: 10 }),
    )
    el.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    )
  })
}
const menu = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="menu"]')
const items = (): string[] =>
  Array.from(menu()?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []).map(
    (b) => b.dataset.command ?? '',
  )
const item = (id: string): HTMLButtonElement =>
  menu()!.querySelector<HTMLButtonElement>(`[data-command="${id}"]`)!
const tile = (name: string): HTMLButtonElement =>
  tiles().find((t) => (t.getAttribute('title') ?? '') === name)!
/** Invoke a command on a tile, the way a user does. */
async function invoke(name: string, command: string): Promise<void> {
  await secondaryPress(tile(name))
  await click(item(command))
  await settle()
}

beforeEach(() => {
  opened.camera = undefined
  opened.axis = undefined
  opened.pose = undefined
})
afterEach(async () => {
  await unmountApp()
  getThumb.mockResolvedValue({ status: 'miss' })
})

describe('offered wherever there is a thumbnail to act on', () => {
  it('offers both on a model whose thumbnail failed — a failed image is the case they exist for', async () => {
    getThumb.mockRejectedValue(new Error('cache is on fire'))
    await mountApp('/models', NESTED)
    await settle()
    // The tile is in its error state: no image, a glyph fallback.
    expect(tile('widget.stl').querySelector('img')).toBeNull()

    await secondaryPress(tile('widget.stl'))
    expect(items()).toContain('reRenderThumbnail')
    expect(items()).toContain('resetFraming')
  })

  it('offers neither on a directory tile', async () => {
    await mountApp('/models', NESTED)
    await secondaryPress(tile('Alpha'))
    // The two container rows are the bulk-job launchers (`bulk-thumbnail-jobs`
    // 2.1): the subtree analogue of the two per-model thumbnail commands,
    // offered here because the harness's default feature report is a known
    // all-on one — what today's server answers.
    expect(items()).toEqual(['open', 'reveal', 'copyPath', 'generateBeneath', 'resetBeneath'])
  })
})

describe('reset framing moves where the lightbox opens the model', () => {
  it('takes effect in this session, not only after the next load', async () => {
    getThumb.mockResolvedValue({
      status: 'hit',
      pngUrl: 'blob:stored',
      camera: CAM,
      axis: '-x',
      lighting: THUMB_LIGHTING,
      rig: RIG_VERSION,
    })
    await mountApp('/models', NESTED)
    await settle()

    // Where the model opens before: the orientation stored for it.
    await invoke('widget.stl', 'open')
    expect(opened.camera).toEqual(CAM)
    expect(opened.axis).toBe('-x')
    await click(container.querySelector<HTMLElement>('[data-testid="close-viewer"]')!)
    await settle()

    await invoke('widget.stl', 'resetFraming')
    // The cache was told to give it up — camera and axis both, whether or not
    // a pose could replace them (`pose-rerender` D7; this cell pinned the kept
    // `-x` until 2026-09-11, and a kept axis was the framing that "came back")…
    const put = putThumb.mock.calls.at(-1)![0] as Record<string, unknown>
    expect(put.camera).toBeNull()
    expect(put.axis).toBeNull()
    // …and so was the session, which is what the viewer reads. A model has one
    // stored orientation, not one per surface.
    await invoke('widget.stl', 'open')
    expect(opened.camera).toBeUndefined()
    expect(opened.axis).toBeUndefined() // the viewer resolves the file's own axis
  })
})

describe('the index’s orientation reaches the command', () => {
  it('a similarity grid carries poses, and reset framing hands the model back to one', async () => {
    // Not only a meaning grid: similarity hits ride the same `hitsToEntries`
    // and land with the same `poses`, so the command's reach follows the grid's
    // provenance rather than the search mode.
    const hero = '/models/Kits/hero.stl'
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models', covers: ['stl'] })
    similar.mockResolvedValue({
      path: '/models',
      entries: [model('Kits/neighbour.stl')],
      poses: { '/models/Kits/neighbour.stl': POSE },
    })
    listDir.mockResolvedValue(NESTED)
    getThumb.mockResolvedValue({ status: 'hit', pngUrl: 'blob:s', camera: CAM, axis: '-x', lighting: THUMB_LIGHTING, rig: RIG_VERSION })
    await mountAppAtCurrentUrl(`/?path=/models&similar=${encodeURIComponent(hero)}`, NESTED)
    await settle()
    expect(tiles()).toHaveLength(1)

    renderThumbnail.mockClear()
    await invoke('Kits/neighbour.stl', 'resetFraming')

    const resolved = cameraForPose(POSE, DEFAULT_CAMERA)!
    // The fixture's `up` is [0, -1, 0]: spindle `-y` in file coordinates, which
    // is what the pose names (file-frame-spindle D4) — not the STL default `z`.
    expect(resolved.axis).toBe('-y')
    // Rendered at the index's orientation entire — its axis as well as its
    // angles — rather than at the default about the axis it used to have.
    // The harness's stub is declared argument-less; the call is (object, camera, axis).
    const [, camera, axis] = renderThumbnail.mock.calls.at(-1)! as unknown as [
      unknown,
      CameraState,
      OrbitAxis,
    ]
    expect(camera).toEqual(resolved.camera)
    expect(axis).toBe(resolved.axis)
    const put = putThumb.mock.calls.at(-1)![0] as Record<string, unknown>
    expect(put.camera).toBeNull()
    expect(put.axis).toBeNull()

    await invoke('Kits/neighbour.stl', 'open')
    expect(opened.camera).toBeUndefined()
    expect(opened.axis).toBeUndefined() // the viewer is free to take the pose too
    expect(opened.pose).toEqual(POSE)
  })
})
