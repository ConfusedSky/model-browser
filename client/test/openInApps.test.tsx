// @vitest-environment happy-dom
//
// The launch actions in the tile menu (open-in-slicer §3): the open-in pill row
// and *Open with…*.
//
// What these pin is the client half and only that — which entries offer the row
// and the item, what order the row is in, what a press hands the server, when
// the session's report is read and re-read, and what the keyboard reaches now
// that the menu has two pill groups instead of one. What the *server* does with
// a launch — extraction, absolutization, the exit code — is the server suite's.
//
// The report is the app's one reading of the platform registry, held in state:
// every assertion here about a request NOT being made is about that rule (L5,
// D6/2.5), because a menu that probes on open is a menu that re-positions and
// jumps focus after it is already on screen.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppsReport, DirEntry, DirListing } from '../../shared/types'
import {
  apps,
  click,
  container,
  dir,
  listDir,
  model,
  mountApp,
  openApp,
  openWith,
  renderThumbnail,
  settle,
  tiles,
  unmountApp,
} from './appHarness'
import { CHOOSER_FAILED, LAUNCH_FAILED, OPEN_IN_PILL_CLASS } from '../src/lib/entryActions'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)
// The viewer is out of scope, and its absence is an assertion: a launch opens
// another application, never this app's expanded view.
vi.mock('../src/viewer/ViewerLayer', () => ({
  default: ({ onDismiss }: { onDismiss: () => void }) => (
    <button type="button" data-testid="close-viewer" onClick={onDismiss}>
      close
    </button>
  ),
}))

const zipEntry = (name: string): DirEntry => ({
  name,
  path: `/models/${name}`,
  kind: 'zip',
  size: 0,
  mtime: 1,
})
/** An `.obj` model, so the grid holds a model of a type the report says nothing
 *  about — the absence case has to be a *model*, or it proves only the kind rule. */
const objEntry: DirEntry = {
  name: 'thing.obj',
  path: '/models/thing.obj',
  kind: 'model',
  format: 'obj',
  size: 1,
  mtime: 1,
}
const NESTED: DirListing = {
  path: '/models',
  entries: [dir('Alpha'), zipEntry('kit.zip'), model('widget.stl')],
}
/** The same listing with the `.obj` in it. A listing of its own, because the
 *  thumbnail sweep really loads what it lists and the harness's model bytes are
 *  an STL — every other test here would pay for a parse failure it never uses. */
const WITH_OBJ: DirListing = { path: '/models', entries: [...NESTED.entries, objEntry] }

/**
 * The registry as this machine actually reports it (design L1, recorded
 * 2026-08-24): `model/stl` defaults to a *viewer*, with both slicers among the
 * associations. Deliberately not a slicer-led row — the fixture states the
 * default-first rule where the default is not the app anyone would pick, so
 * "default first" cannot pass by accident of alphabetical or install order.
 */
const F3D = { id: 'f3d.desktop', name: 'F3D' }
const LYCHEE = { id: 'lycheeslicer.desktop', name: 'LycheeSlicer' }
const PHOTON = { id: 'photon-workshop.desktop', name: 'Photon Workshop' }
const REPORT: AppsReport = {
  chooser: true,
  types: { 'model/stl': { default: F3D, associated: [LYCHEE, PHOTON] } },
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
/** The command rows, by the id each carries — the helper every other menu test
 *  file uses, asked here to prove the pills stay out of it. */
const items = (): string[] =>
  Array.from(menu()?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []).map(
    (b) => b.dataset.command ?? '',
  )
const commandRows = (): HTMLButtonElement[] =>
  Array.from(menu()?.querySelectorAll<HTMLButtonElement>('[data-command]') ?? [])
const commandIds = (): string[] => commandRows().map((b) => b.dataset.command ?? '')
/** The open-in row's pills, in the order they are drawn. */
const pills = (): HTMLButtonElement[] =>
  Array.from(menu()?.querySelectorAll<HTMLButtonElement>('[data-app-id]') ?? [])
const pillIds = (): string[] => pills().map((b) => b.dataset.appId ?? '')
const pillNames = (): string[] => pills().map((b) => b.textContent ?? '')
const openWithItem = (): HTMLButtonElement | null =>
  menu()?.querySelector<HTMLButtonElement>('[data-command="openWith"]') ?? null
const tile = (name: string): HTMLButtonElement =>
  tiles().find((t) => (t.getAttribute('title') ?? '') === name)!
const arrow = (key: 'ArrowDown' | 'ArrowUp' | 'End'): Promise<void> =>
  act(async () => {
    menu()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
const escape = (): Promise<void> =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
/** The path bar's transient line, where every entry action reports a failure. */
const pathError = (): string | null =>
  container.querySelector('header p.text-red-400')?.textContent ?? null
const focusedEl = (): HTMLElement => document.activeElement as HTMLElement

beforeEach(() => {
  listDir.mockResolvedValue(NESTED)
})
afterEach(async () => {
  await unmountApp()
})

describe('which entries offer the open-in row', () => {
  it('offers it on a model whose type has applications, default first', async () => {
    apps.mockResolvedValue(REPORT)
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('widget.stl'))
    // Ids, because a name is a display string and an id is what launches; and
    // the order is the assertion — the default leads, the associations follow
    // in the order the registry gave them.
    expect(pillIds()).toEqual([F3D.id, LYCHEE.id, PHOTON.id])
    // Names are what the user reads: ids never render (L2).
    expect(pillNames()).toEqual(['F3D', 'LycheeSlicer', 'Photon Workshop'])
    // The row wears the axis row's pill class, from `entryActions` — one copy,
    // so the two rows cannot drift into two different-looking controls.
    expect(pills()[0]!.className).toContain(OPEN_IN_PILL_CLASS)
  })

  it('is absent on a directory and on an archive, which have no type to associate', async () => {
    apps.mockResolvedValue(REPORT)
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('Alpha'))
    expect(pills()).toHaveLength(0)
    // And the chooser item goes with it: both are model-only, whatever the
    // report says about the machine.
    expect(commandIds()).toEqual(['open', 'reveal', 'copyPath'])
    await escape()

    await secondaryPress(tile('kit.zip'))
    expect(pills()).toHaveLength(0)
    expect(openWithItem()).toBeNull()
  })

  it('is absent on a model whose type the report maps to nothing', async () => {
    // A *model*, and one the menu otherwise treats exactly like the stl beside
    // it — the row is absent because `model/obj` has no entry, not because the
    // entry is not a model. Absent rather than present and inert.
    apps.mockResolvedValue(REPORT)
    listDir.mockResolvedValue(WITH_OBJ)
    await mountApp('/models', WITH_OBJ)
    await settle()

    await secondaryPress(tile('thing.obj'))
    expect(pills()).toHaveLength(0)
    // The rest of the model menu is untouched, group and all.
    expect(commandIds()).toContain('reRenderThumbnail')
    expect(menu()!.querySelectorAll('[role="menuitemradio"]')).toHaveLength(3)
  })

  it('is absent while no report has landed, and appears once one has', async () => {
    // The report failing to arrive reads as "no applications" — the same
    // absence a machine with none has, rather than an empty row or a wait.
    apps.mockRejectedValue(new Error('no registry'))
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('widget.stl'))
    expect(pills()).toHaveLength(0)
    expect(openWithItem()).toBeNull()
  })

  it('draws one pill per application id, never the default twice', async () => {
    // The default is its own source and *need* not appear among the
    // associations (L1) — but nothing in the report's shape forbids it, and a
    // configured override answers for itself. The same application twice is a
    // duplicate, not a choice.
    apps.mockResolvedValue({
      chooser: false,
      types: { 'model/stl': { default: LYCHEE, associated: [LYCHEE, PHOTON] } },
    })
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('widget.stl'))
    expect(pillIds()).toEqual([LYCHEE.id, PHOTON.id])
  })

  it('draws a type with no default at all as its associations alone', async () => {
    apps.mockResolvedValue({
      chooser: false,
      types: { 'model/stl': { default: null, associated: [LYCHEE, PHOTON] } },
    })
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('widget.stl'))
    expect(pillIds()).toEqual([LYCHEE.id, PHOTON.id])
  })

  it('keeps the pills out of the command rows, which are read by id', async () => {
    // The pills are `menuitem`, chosen over `menuitemradio` because choosing
    // one *does* something rather than marking the model as being something —
    // and the ARIA role is the honest one even though it costs the role-based
    // reading its precision. So the command rows are read by **`data-command`**,
    // which the pills deliberately do not carry: a command is a row from the
    // table, and a pill is not one.
    //
    // This is the assertion, and the two halves are both needed: no pill
    // answers to the id attribute, and reading by it yields exactly the
    // commands. Read by role instead and the pills come too — stated here
    // rather than left as a trap, since the older menu files still read by
    // role and are correct only because no report reaches them.
    apps.mockResolvedValue(REPORT)
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('widget.stl'))
    expect(pills()).toHaveLength(3)
    expect(pills().every((p) => p.dataset.command === undefined)).toBe(true)
    expect(commandIds()).not.toContain('')
    expect(commandIds()).toEqual([
      'open',
      'reveal',
      'copyPath',
      'reRenderThumbnail',
      'resetFraming',
      'openWith',
    ])
    // The role-based reading, said out loud: three more, and every one of them
    // id-less. This is why `commandIds` is the selector above.
    expect(items()).toHaveLength(commandIds().length + pills().length)
    expect(items().filter((id) => id === '')).toHaveLength(pills().length)
  })
})

describe('Open with… follows the configured chooser', () => {
  it('is offered on a model when a chooser is configured', async () => {
    apps.mockResolvedValue(REPORT)
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('widget.stl'))
    expect(commandIds()).toContain('openWith')
    expect(openWithItem()!.textContent).toBe('Open with…')
  })

  it('is absent when no chooser is configured, and the pill row is unaffected', async () => {
    // The spec's own pairing: the machine without a chooser still gets its
    // associated applications, it just cannot be handed to one this app does
    // not know about.
    apps.mockResolvedValue({ ...REPORT, chooser: false })
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('widget.stl'))
    expect(openWithItem()).toBeNull()
    expect(commandIds()).not.toContain('openWith')
    expect(pillIds()).toEqual([F3D.id, LYCHEE.id, PHOTON.id])
  })
})

describe('what a launch does, and what it does not', () => {
  it('hands the server the entry path and the chosen application, and nothing else happens', async () => {
    apps.mockResolvedValue(REPORT)
    await mountApp('/models', NESTED)
    await settle()
    renderThumbnail.mockClear()

    await secondaryPress(tile('widget.stl'))
    await click(pills()[1]!) // LycheeSlicer
    await settle()

    expect(openApp).toHaveBeenCalledTimes(1)
    expect(openApp).toHaveBeenCalledWith('/models/widget.stl', LYCHEE.id)
    // One-shot: the menu is dismissed, no expanded view opened, no thumbnail
    // work queued. A launch is not an activation.
    expect(menu()).toBeNull()
    expect(container.querySelector('[data-testid="close-viewer"]')).toBeNull()
    expect(renderThumbnail).not.toHaveBeenCalled()
  })

  it('says so when the launch command fails, and says nothing when it succeeds', async () => {
    apps.mockResolvedValue(REPORT)
    await mountApp('/models', NESTED)
    await settle()

    // Success first: the evidence a user wants is the other application's
    // window, so this surface stays quiet.
    await secondaryPress(tile('widget.stl'))
    await click(pills()[0]!)
    await settle()
    expect(pathError()).toBeNull()

    openApp.mockRejectedValueOnce(new Error('gtk-launch exited 1'))
    await secondaryPress(tile('widget.stl'))
    await click(pills()[0]!)
    await settle()
    expect(pathError()).toBe(LAUNCH_FAILED)
  })

  it('reports a failed chooser as its own failure, naming no application', async () => {
    apps.mockResolvedValue(REPORT)
    await mountApp('/models', NESTED)
    await settle()

    openWith.mockRejectedValueOnce(new Error('rofi is already running'))
    await secondaryPress(tile('widget.stl'))
    await click(openWithItem()!)
    await settle()

    expect(openWith).toHaveBeenCalledWith('/models/widget.stl')
    // Not the pill's sentence: nothing was chosen, so "that application" would
    // name something the user never picked (4.3).
    expect(pathError()).toBe(CHOOSER_FAILED)
    expect(pathError()).not.toBe(LAUNCH_FAILED)
  })
})

describe('when the registry is read', () => {
  it('reads it once for the session, and never when a menu opens', async () => {
    apps.mockResolvedValue(REPORT)
    await mountApp('/models', NESTED)
    await settle()
    expect(apps).toHaveBeenCalledTimes(1) // the session's one reading

    // Three menus on three entries, raised and dismissed. The report is state;
    // opening a menu asks the registry nothing (D6/2.5).
    await secondaryPress(tile('widget.stl'))
    expect(pillIds()).toHaveLength(3) // it did read the report, from state
    await escape()
    await secondaryPress(tile('kit.zip'))
    await escape()
    await secondaryPress(tile('Alpha'))
    await escape()
    await settle()

    expect(apps).toHaveBeenCalledTimes(1)
  })

  it('reads it again when the chooser is done, so a default set there leads the next menu', async () => {
    // The registry loop the design is built around (L4): the chooser's own
    // set-default is how a slicer comes to lead the row, and the next menu has
    // to show it. The second reading answers with Lychee promoted.
    apps.mockResolvedValue(REPORT)
    await mountApp('/models', NESTED)
    await settle()
    expect(apps).toHaveBeenCalledTimes(1)

    apps.mockResolvedValue({
      chooser: true,
      types: { 'model/stl': { default: LYCHEE, associated: [F3D, PHOTON] } },
    })
    await secondaryPress(tile('widget.stl'))
    expect(pillIds()[0]).toBe(F3D.id) // still the old row while the menu is up
    await click(openWithItem()!)
    await settle()

    expect(openWith).toHaveBeenCalledTimes(1)
    expect(apps).toHaveBeenCalledTimes(2)
    await secondaryPress(tile('widget.stl'))
    expect(pillIds()).toEqual([LYCHEE.id, F3D.id, PHOTON.id])
  })

  it('reads it again even when the chooser command failed', async () => {
    // A failed chooser is not proof the registry is untouched: rofi refusing a
    // second instance surfaces as a failure *after* the first one may already
    // have set a default (L9). Re-reading is cheap; a stale row is a lie.
    apps.mockResolvedValue(REPORT)
    await mountApp('/models', NESTED)
    await settle()

    openWith.mockRejectedValueOnce(new Error('rofi is already running'))
    await secondaryPress(tile('widget.stl'))
    await click(openWithItem()!)
    await settle()

    expect(apps).toHaveBeenCalledTimes(2)
  })
})

describe('the open command is labelled for the entry', () => {
  it('says Open lightbox on a model, Open folder on a directory, Open archive on a zip', async () => {
    // The 4.3 naming decision, read off the rendered menu: the label the user
    // sees is the resolved one, per kind — not the table's fallback string.
    apps.mockResolvedValue(REPORT)
    await mountApp('/models', NESTED)
    await settle()
    const openRow = (): HTMLButtonElement =>
      menu()!.querySelector<HTMLButtonElement>('[data-command="open"]')!

    await secondaryPress(tile('widget.stl'))
    expect(openRow().textContent).toBe('Open lightbox')
    await escape()
    await secondaryPress(tile('Alpha'))
    expect(openRow().textContent).toBe('Open folder')
    await escape()
    await secondaryPress(tile('kit.zip'))
    expect(openRow().textContent).toBe('Open archive')
  })
})

describe('the keyboard, across two pill groups', () => {
  // '-z' stored throughout, so the axis group's landing rule cannot pass by
  // landing on the group's first button and calling it the letter in force.
  beforeEach(() => {
    apps.mockResolvedValue(REPORT)
  })

  it('opens on the first command, below both rows', async () => {
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('widget.stl'))
    // Not `[role="menuitem"]` — the pills answer to that too now. The menu
    // opens on the first *command*, which is what the menu is for.
    expect(focusedEl()).toBe(commandRows()[0]!)
    expect(focusedEl().dataset.command).toBe('open')
  })

  it('enters the open-in row at the default, and walks it pill by pill', async () => {
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('widget.stl'))
    // Up off the first command crosses into the row above it — and lands on
    // its *first* pill, the default, not on the pill that happens to be
    // nearest (which is the last one). The axis group's rule, generalized.
    await arrow('ArrowUp')
    expect(focusedEl().dataset.appId).toBe(F3D.id)
    expect(focusedEl()).not.toBe(pills()[2])

    // Stepping on from there reaches the rest, in drawn order.
    await arrow('ArrowDown')
    expect(focusedEl().dataset.appId).toBe(LYCHEE.id)
    await arrow('ArrowDown')
    expect(focusedEl().dataset.appId).toBe(PHOTON.id)
    // And out of the row into the commands.
    await arrow('ArrowDown')
    expect(focusedEl().dataset.command).toBe('open')
  })

  it('crosses on into the axis row, which still lands on the letter in force', async () => {
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('widget.stl'))
    await arrow('ArrowUp') // into the open-in row, at the default
    expect(focusedEl().dataset.appId).toBe(F3D.id)
    await arrow('ArrowUp') // on into the axis row above it
    // 'y' is the spindle this model is framed about with none stored, and the
    // axis group is entered at the letter in force rather than at `flip` —
    // which here is also proof the crossing rule fired: 'y' is the middle
    // button of the row, not the one the step arrived at.
    expect(focusedEl().dataset.axis).toBe('y')
    // Down walks on through the row it is in — 'z', then `flip` — and only
    // then crosses into the open-in row, at its default.
    await arrow('ArrowDown')
    expect(focusedEl().dataset.axis).toBe('z')
    await arrow('ArrowDown')
    expect(focusedEl().dataset.axis).toBe('flip')
    await arrow('ArrowDown')
    expect(focusedEl().dataset.appId).toBe(F3D.id)
  })

  it('wraps off the last command into the topmost row, not into the pill above it', async () => {
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('widget.stl'))
    await arrow('End')
    expect(focusedEl().dataset.command).toBe('openWith') // the last row
    await arrow('ArrowDown') // wrap
    expect(focusedEl().dataset.axis).toBe('y')
  })

  it('launches the focused pill by the same body the pointer reaches', async () => {
    await mountApp('/models', NESTED)
    await settle()

    await secondaryPress(tile('widget.stl'))
    await arrow('ArrowUp') // the default
    await arrow('ArrowDown') // LycheeSlicer
    await click(focusedEl())
    await settle()

    expect(menu()).toBeNull()
    expect(openApp).toHaveBeenCalledWith('/models/widget.stl', LYCHEE.id)
  })
})
