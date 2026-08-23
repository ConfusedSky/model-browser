// @vitest-environment happy-dom
//
// The orbit-axis group in the tile menu (6.7): setting the spindle a model is
// stored about without opening it.
//
// What the write itself does — the discarded camera, the labels, the no-op —
// is pinned against `setOrbitAxis` directly in thumbnailCommands.test.ts. What
// these pin is the half that only exists once the menu, the grid and the viewer
// are on screen: which tiles offer the group, what it marks, what the keyboard
// reaches, and that a pick moves where the lightbox opens the model *in this
// session*. The group's absence on the two viewer surfaces is in
// viewerMenu.test.tsx, beside the rest of that surface filter.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CameraState, DirEntry, DirListing, IndexPose, OrbitAxis } from '../../shared/types'
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
import { POSE_VERSION } from '../src/three/pose'
import { RIG_VERSION } from '../src/three/renderer'
import { getLightingMode } from '../src/viewer/lighting'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)
// The viewer is out of scope; what App hands it is the point. `camera`/`axis`
// come from `thumbs.get(path)`, which is the map an axis pick has to write to
// for the choice to be visible before the next load.
const opened = vi.hoisted(() => ({
  camera: undefined as CameraState | undefined,
  axis: undefined as OrbitAxis | undefined,
}))
vi.mock('../src/viewer/ViewerLayer', () => ({
  default: ({
    camera,
    axis,
    onDismiss,
  }: {
    camera?: CameraState
    axis?: OrbitAxis
    onDismiss: () => void
  }) => {
    opened.camera = camera
    opened.axis = axis
    return (
      <button type="button" data-testid="close-viewer" onClick={onDismiss}>
        close
      </button>
    )
  },
}))

const zipEntry = (name: string): DirEntry => ({
  name,
  path: `/models/${name}`,
  kind: 'zip',
  size: 0,
  mtime: 1,
})
const NESTED: DirListing = {
  path: '/models',
  entries: [dir('Alpha'), zipEntry('kit.zip'), model('widget.stl')],
}
const CAM: CameraState = { az: 1.2, el: 0.3, distR: 2.5, target: [0, 0, 0] }
/** File-space `up` (0,-1,0) is scene +Z: a pose the app can express, present
 *  throughout so that "the pick ignores it" is an assertion and not a vacuum. */
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
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 2,
        buttons: 2,
        clientX: 10,
        clientY: 10,
      }),
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
const axes = (): HTMLButtonElement[] =>
  Array.from(menu()?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
const axisLabels = (): string[] => axes().map((b) => b.dataset.axis ?? '')
const markedAxis = (): string | undefined =>
  axes().find((b) => b.getAttribute('aria-checked') === 'true')?.dataset.axis
const axisItem = (a: OrbitAxis): HTMLButtonElement =>
  menu()!.querySelector<HTMLButtonElement>(`[role="menuitemradio"][data-axis="${a}"]`)!
const tile = (name: string): HTMLButtonElement =>
  tiles().find((t) => (t.getAttribute('title') ?? '') === name)!
const arrow = (key: 'ArrowDown' | 'ArrowUp'): Promise<void> =>
  act(async () => {
    menu()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
const escape = (): Promise<void> =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })

/** A stored thumbnail whose labels are current, so the sweep serves it rather
 *  than re-rendering — the writes under test are then the only writes. */
function stored(axis?: OrbitAxis): void {
  getThumb.mockResolvedValue({
    status: 'hit',
    pngUrl: 'blob:stored',
    camera: CAM,
    axis,
    lighting: getLightingMode(),
    rig: RIG_VERSION,
  })
}
/** The last write for this model, or undefined — the sweep writes too. */
const lastPut = (): Record<string, unknown> | undefined =>
  putThumb.mock.calls
    .map(([body]) => body as Record<string, unknown>)
    .filter((b) => b.path === '/models/widget.stl')
    .at(-1)

beforeEach(() => {
  opened.camera = undefined
  opened.axis = undefined
  listDir.mockResolvedValue(NESTED)
})
afterEach(async () => {
  await unmountApp()
  getThumb.mockResolvedValue({ status: 'miss' })
})

describe('the group is offered on model tiles and nowhere else', () => {
  it('lists the six spindles in the picker’s order, marking the one the model is stored about', async () => {
    stored('-x')
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('widget.stl'))
    expect(axisLabels()).toEqual(['x', 'y', 'z', '-x', '-y', '-z'])
    expect(markedAxis()).toBe('-x')
    // Exactly one of six is true of the model, so exactly one is marked.
    expect(axes().filter((b) => b.getAttribute('aria-checked') === 'true')).toHaveLength(1)
  })

  it('marks the default on a model that has never been given one', async () => {
    // Not "nothing marked": a model with no stored axis is framed about 'y',
    // and the menu says what is true of it rather than what is stored.
    stored(undefined)
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('widget.stl'))
    expect(markedAxis()).toBe('y')
  })

  it('draws the six as a pill row above the commands, not as rows beneath them', async () => {
    // User feedback 2026-08-22 (6.8): six full-width rows at the bottom read as
    // the menu's subject rather than as one property of the model. The group is
    // now the compact pill row the lightbox's own picker uses, at the top.
    stored('-x')
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('widget.stl'))
    // DOM order, which is also the order the arrow keys walk: the six pills
    // first, then every command.
    const roles = Array.from(menu()!.querySelectorAll<HTMLElement>('button')).map((b) =>
      b.getAttribute('role'),
    )
    expect(roles.slice(0, 6)).toEqual(Array(6).fill('menuitemradio'))
    expect(roles.slice(6)).toEqual(Array(roles.length - 6).fill('menuitem'))
    expect(roles.length).toBeGreaterThan(6) // there are commands under it

    // The pill vocabulary, not a menu row: the marked spindle is *filled*, the
    // way the lightbox's picker fills the axis in force, and a pill is not
    // full-width.
    expect(axisItem('-x').className).toContain('bg-sky-700')
    expect(axisItem('-x').className).toContain('rounded-full')
    expect(axisItem('z').className).not.toContain('bg-sky-700')
    expect(axisItem('-x').className).not.toContain('w-full')
  })

  it('is absent on a directory and on an archive, which are glyphs with no spindle', async () => {
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('Alpha'))
    expect(items()).toEqual(['open', 'reveal', 'copyPath'])
    expect(axes()).toHaveLength(0)
    await escape()

    await secondaryPress(tile('kit.zip'))
    expect(axes()).toHaveLength(0)
  })
})

describe('reaching the group from the keyboard', () => {
  it('lands on the spindle in force, steps through the rest, and gives Escape the whole menu', async () => {
    stored('-x')
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('widget.stl'))
    const commands = items().length
    expect(commands).toBeGreaterThan(0)
    // The menu opens on its first *command*, which is what a menu is for. Since
    // 6.8 that is no longer the menu's first button — the pill row is above it —
    // so this names the role rather than taking the first `button` it finds.
    expect(document.activeElement).toBe(menu()!.querySelector('[role="menuitem"]'))

    // Down through the commands and off the end into the group — which is
    // entered at the spindle already in force rather than at the first of six.
    for (let i = 0; i < commands; i++) await arrow('ArrowDown')
    expect((document.activeElement as HTMLElement).dataset.axis).toBe('-x')

    await arrow('ArrowDown')
    expect((document.activeElement as HTMLElement).dataset.axis).toBe('-y')
    await arrow('ArrowUp')
    await arrow('ArrowUp')
    expect((document.activeElement as HTMLElement).dataset.axis).toBe('z')

    // One press dismisses one thing, and that thing is the menu entire.
    await escape()
    expect(menu()).toBeNull()
  })

  it('enters the group from above too, at the same spindle', async () => {
    // The crossing 6.8 created: the group sits above the commands, so one press
    // Up off the first command walks into it — and it lands where entering the
    // group always lands, not on the pill that happens to be nearest.
    stored('-x')
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('widget.stl'))
    expect(document.activeElement).toBe(menu()!.querySelector('[role="menuitem"]'))
    await arrow('ArrowUp')
    expect((document.activeElement as HTMLElement).dataset.axis).toBe('-x')
    // And stepping on from there still reaches the rest, in either direction.
    await arrow('ArrowUp')
    expect((document.activeElement as HTMLElement).dataset.axis).toBe('z')
  })

  it('chooses the focused spindle, by the same body the pointer reaches', async () => {
    stored('-x')
    await mountApp('/models', NESTED)
    await settle()
    renderThumbnail.mockClear()
    putThumb.mockClear()

    await secondaryPress(tile('widget.stl'))
    for (let i = 0; i < items().length; i++) await arrow('ArrowDown')
    await arrow('ArrowDown') // '-y', one on from the marked '-x'
    await click(document.activeElement as HTMLElement)
    await settle()

    expect(menu()).toBeNull()
    expect(lastPut()!.axis).toBe('-y')
  })
})

describe('picking a spindle', () => {
  it('writes it, gives up the camera measured about the old one, and redraws the tile', async () => {
    stored('-x')
    await mountApp('/models', NESTED)
    await settle()
    renderThumbnail.mockClear()
    putThumb.mockClear()

    await secondaryPress(tile('widget.stl'))
    await click(axisItem('z'))
    await settle()

    // The default about the new spindle: the stored camera's angles were
    // measured about '-x' and describe nothing about 'z'.
    // The harness's stub is declared argument-less; the call is (object, camera, axis).
    const [, camera, axis] = renderThumbnail.mock.calls.at(-1)! as unknown as [
      unknown,
      CameraState,
      OrbitAxis,
    ]
    expect(camera).toEqual(DEFAULT_CAMERA)
    expect(axis).toBe('z')

    const put = lastPut()!
    expect(put.axis).toBe('z')
    expect(put.camera).toBeNull() // discarded, never a written default
    expect(put.lighting).toBe(getLightingMode())
    expect(put.rig).toBe(RIG_VERSION)
    expect(put.posed).toBeUndefined()
  })

  it('moves where the lightbox opens the model, in this session', async () => {
    stored('-x')
    await mountApp('/models', NESTED)
    await settle()

    // Where it opens before: the orientation stored for it.
    await secondaryPress(tile('widget.stl'))
    await click(menu()!.querySelector<HTMLButtonElement>('[data-command="open"]')!)
    await settle()
    expect(opened.camera).toEqual(CAM)
    expect(opened.axis).toBe('-x')
    await click(container.querySelector<HTMLElement>('[data-testid="close-viewer"]')!)
    await settle()

    await secondaryPress(tile('widget.stl'))
    await click(axisItem('z'))
    await settle()

    await secondaryPress(tile('widget.stl'))
    await click(menu()!.querySelector<HTMLButtonElement>('[data-command="open"]')!)
    await settle()
    // A model has one stored orientation, not one per surface.
    expect(opened.axis).toBe('z')
    expect(opened.camera).toBeUndefined()
  })

  it('ignores an index orientation for the model — the user has said which way up it stands', async () => {
    // A similarity grid, because that is a grid whose poses actually reach the
    // command (`state.result.poses`; a plain listing carries none). The pose
    // would otherwise frame this model entire — `resetFraming` on this very
    // fixture hands the model back to it. A chosen axis withholds it instead,
    // and the pixels carry no pose label to claim otherwise.
    const neighbour = '/models/Kits/neighbour.stl'
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models' })
    similar.mockResolvedValue({
      path: '/models',
      entries: [model('Kits/neighbour.stl')],
      poses: { [neighbour]: POSE },
    })
    getThumb.mockResolvedValue({
      status: 'hit',
      pngUrl: 'blob:stored',
      lighting: getLightingMode(),
      rig: RIG_VERSION,
      posed: POSE_VERSION, // already drawn at the pose: the sweep leaves it alone
    })
    await mountAppAtCurrentUrl(
      `/?path=/models&similar=${encodeURIComponent('/models/hero.stl')}`,
      NESTED,
    )
    await settle()
    expect(tiles()).toHaveLength(1)
    renderThumbnail.mockClear()
    putThumb.mockClear()

    await secondaryPress(tile('Kits/neighbour.stl'))
    // Nothing of the user's is stored, so the pose is what frames it — and the
    // menu marks the default, not the pose's spindle: the pose is advisory and
    // the model has no axis of its own.
    expect(markedAxis()).toBe('y')
    await click(axisItem('-y'))
    await settle()

    const [, , axis] = renderThumbnail.mock.calls.at(-1)! as unknown as [
      unknown,
      CameraState,
      OrbitAxis,
    ]
    expect(axis).toBe('-y')
    const put = putThumb.mock.calls
      .map(([body]) => body as Record<string, unknown>)
      .filter((b) => b.path === neighbour)
      .at(-1)!
    expect(put.axis).toBe('-y')
    expect(put.camera).toBeNull()
    expect(put.posed).toBeUndefined()
  })

  it('does nothing when the spindle picked is the one already marked', async () => {
    stored('-x')
    await mountApp('/models', NESTED)
    await settle()
    renderThumbnail.mockClear()
    putThumb.mockClear()

    await secondaryPress(tile('widget.stl'))
    expect(markedAxis()).toBe('-x')
    await click(axisItem('-x'))
    await settle()

    expect(menu()).toBeNull() // still a dismissal
    expect(renderThumbnail).not.toHaveBeenCalled()
    expect(lastPut()).toBeUndefined()
  })
})
