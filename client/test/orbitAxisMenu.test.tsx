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
import { AXIS_DIVIDER_CLASS, axisPillClass, flipPillClass } from '../src/lib/entryActions'
import { DEFAULT_CAMERA } from '../src/three/camera'
import { POSE_VERSION } from '../src/three/pose'
import { RIG_VERSION, THUMB_LIGHTING } from '../src/three/renderer'

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
/** The three letter pills. `flip` is a checkbox, and is asked for by name. */
const axes = (): HTMLButtonElement[] =>
  Array.from(menu()?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
const axisLabels = (): string[] => axes().map((b) => b.dataset.axis ?? '')
const markedAxis = (): string | undefined =>
  axes().find((b) => b.getAttribute('aria-checked') === 'true')?.dataset.axis
const axisItem = (letter: 'x' | 'y' | 'z'): HTMLButtonElement =>
  menu()!.querySelector<HTMLButtonElement>(`[role="menuitemradio"][data-axis="${letter}"]`)!
const flip = (): HTMLButtonElement | null =>
  menu()?.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"][data-axis="flip"]') ?? null
/** Whether `flip` reads as pressed — the group's whole account of the sign. */
const flipped = (): boolean => flip()?.getAttribute('aria-checked') === 'true'
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
    lighting: THUMB_LIGHTING,
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
  it('states the spindle the picker’s way — the letter in force marked, the sign on flip', async () => {
    stored('-x')
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('widget.stl'))
    expect(axisLabels()).toEqual(['x', 'y', 'z'])
    // '-x' is one spindle said as two things, exactly as the lightbox says it:
    // the letter is marked and the sign is `flip` pressed.
    expect(markedAxis()).toBe('x')
    expect(flipped()).toBe(true)
    // Exactly one of the three letters is true of the model.
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
    expect(flipped()).toBe(false) // 'y' is not a negated spindle
  })

  it('draws the picker’s four buttons above the commands, not six pills', async () => {
    // User feedback 2026-08-22, second look at 6.8: the row is the *lightbox
    // picker's* row — `axis X Y Z | flip` — not six pills spelling out what the
    // picker states as a letter and a sign.
    stored('-x')
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('widget.stl'))
    // DOM order, which is also the order the arrow keys walk: three letters,
    // `flip`, then every command.
    const roles = Array.from(menu()!.querySelectorAll<HTMLElement>('button')).map((b) =>
      b.getAttribute('role'),
    )
    expect(roles.slice(0, 4)).toEqual([
      'menuitemradio',
      'menuitemradio',
      'menuitemradio',
      'menuitemcheckbox',
    ])
    expect(roles.slice(4)).toEqual(Array(roles.length - 4).fill('menuitem'))
    expect(roles.length).toBeGreaterThan(4) // there are commands under it
    // The divider is between them, and is not a button.
    expect(menu()!.querySelector(`.${AXIS_DIVIDER_CLASS.split(' ').join('.')}`)).not.toBeNull()

    // Not merely "pill-shaped": the *same strings* the lightbox row draws with,
    // which is what makes the two surfaces one control rather than two that
    // resemble each other. `entryActions` is where that copy lives.
    expect(axisItem('x').className).toContain(axisPillClass(true))
    expect(axisItem('z').className).toContain(axisPillClass(false))
    expect(flip()!.className).toContain(flipPillClass(true)) // amber, being negated
    expect(axisItem('x').className).not.toContain('w-full')
  })

  it('is absent on a directory and on an archive, which are glyphs with no spindle', async () => {
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('Alpha'))
    expect(items()).toEqual(['open', 'reveal', 'copyPath'])
    expect(axes()).toHaveLength(0)
    expect(flip()).toBeNull()
    await escape()

    await secondaryPress(tile('kit.zip'))
    expect(axes()).toHaveLength(0)
    expect(flip()).toBeNull()
  })
})

describe('reaching the group from the keyboard', () => {
  // '-z' throughout, and not '-x': the letter in force is then the *last* of
  // the three, so "lands on the letter in force" cannot pass by landing on the
  // first button of the group and calling it that.
  it('lands on the letter in force, walks the letters and flip, and gives Escape the whole menu', async () => {
    stored('-z')
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
    // entered at the **letter** in force rather than at `X`. That is the old
    // land-on-the-spindle-in-force rule, said in the shape the group now has.
    for (let i = 0; i < commands; i++) await arrow('ArrowDown')
    expect((document.activeElement as HTMLElement).dataset.axis).toBe('z')

    // Letter, letter, letter, flip — four focusables in the order they are drawn.
    await arrow('ArrowDown')
    expect(document.activeElement).toBe(flip())
    await arrow('ArrowUp')
    expect((document.activeElement as HTMLElement).dataset.axis).toBe('z')
    await arrow('ArrowUp')
    expect((document.activeElement as HTMLElement).dataset.axis).toBe('y')
    await arrow('ArrowUp')
    expect((document.activeElement as HTMLElement).dataset.axis).toBe('x')

    // One press dismisses one thing, and that thing is the menu entire.
    await escape()
    expect(menu()).toBeNull()
  })

  it('enters the group from above too, at the same letter', async () => {
    // The crossing 6.8 created: the group sits above the commands, so one press
    // Up off the first command walks into it — and it lands where entering the
    // group always lands, not on the button that happens to be nearest, which
    // since the second look is `flip`.
    stored('-z')
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('widget.stl'))
    expect(document.activeElement).toBe(menu()!.querySelector('[role="menuitem"]'))
    await arrow('ArrowUp')
    expect((document.activeElement as HTMLElement).dataset.axis).toBe('z')
    expect(document.activeElement).not.toBe(flip())
    // And stepping on from there still reaches the rest.
    await arrow('ArrowDown')
    expect(document.activeElement).toBe(flip())
  })

  it('chooses the focused letter at the sign in force, by the same body the pointer reaches', async () => {
    stored('-z')
    await mountApp('/models', NESTED)
    await settle()
    renderThumbnail.mockClear()
    putThumb.mockClear()

    await secondaryPress(tile('widget.stl'))
    await arrow('ArrowUp') // into the group, at 'z'
    await arrow('ArrowUp')
    await arrow('ArrowUp') // 'x'
    await click(document.activeElement as HTMLElement)
    await settle()

    expect(menu()).toBeNull()
    // '-x' and not 'x': the keyboard reaches the same letter press the pointer
    // does, sign preservation included.
    expect(lastPut()!.axis).toBe('-x')
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
    // measured about '-x' and describe nothing about '-z'.
    // The harness's stub is declared argument-less; the call is (object, camera, axis).
    const [, camera, axis] = renderThumbnail.mock.calls.at(-1)! as unknown as [
      unknown,
      CameraState,
      OrbitAxis,
    ]
    expect(camera).toEqual(DEFAULT_CAMERA)
    expect(axis).toBe('-z')

    const put = lastPut()!
    expect(put.axis).toBe('-z')
    expect(put.camera).toBeNull() // discarded, never a written default
    expect(put.lighting).toBe(THUMB_LIGHTING)
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
    expect(opened.axis).toBe('-z')
    expect(opened.camera).toBeUndefined()
  })

  it('keeps the sign in force when a letter is picked: −Z then X is −X', async () => {
    // The lightbox picker's rule, and the reason the group is four buttons and
    // not six: the sign belongs to `flip`, and pressing a letter is not
    // pressing it.
    stored('-z')
    await mountApp('/models', NESTED)
    await settle()
    putThumb.mockClear()

    await secondaryPress(tile('widget.stl'))
    expect(markedAxis()).toBe('z')
    expect(flipped()).toBe(true)
    await click(axisItem('x'))
    await settle()

    expect(lastPut()!.axis).toBe('-x')
  })

  it('negates on flip, and flip is never a no-op in either direction', async () => {
    // The one button that always writes: it names a spindle the model is not
    // about, whichever way it is pressed. (Pressing it twice is two real
    // changes, not a round trip that never happened.)
    stored('-x')
    await mountApp('/models', NESTED)
    await settle()
    putThumb.mockClear()

    await secondaryPress(tile('widget.stl'))
    await click(flip()!)
    await settle()
    expect(lastPut()!.axis).toBe('x') // negated: the sign came off

    // And from a positive spindle, the other way. The menu now reads the axis
    // it just wrote, so this is the second press of the same button.
    putThumb.mockClear()
    await secondaryPress(tile('widget.stl'))
    expect(markedAxis()).toBe('x')
    expect(flipped()).toBe(false)
    await click(flip()!)
    await settle()
    expect(lastPut()!.axis).toBe('-x')
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
      lighting: THUMB_LIGHTING,
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
    expect(flipped()).toBe(false)
    await click(flip()!) // 'y' negated
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

  it('does nothing when the letter picked is the one already marked', async () => {
    // The no-op the four-button shape leaves: pressing the active letter names
    // that letter at the sign already in force, which is the spindle already in
    // force. `setOrbitAxis` declines it — no PUT, no render, no queue slot.
    stored('-x')
    await mountApp('/models', NESTED)
    await settle()
    renderThumbnail.mockClear()
    putThumb.mockClear()

    await secondaryPress(tile('widget.stl'))
    expect(markedAxis()).toBe('x')
    expect(flipped()).toBe(true)
    await click(axisItem('x')) // '-x' again, not 'x'
    await settle()

    expect(menu()).toBeNull() // still a dismissal
    expect(renderThumbnail).not.toHaveBeenCalled()
    expect(lastPut()).toBeUndefined()
  })
})
