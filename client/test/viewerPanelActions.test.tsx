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
import { setAoEnabled } from '../src/viewer/aoToggle'
import type { AppsReport, DirEntry, DirListing, IndexPose } from '../../shared/types'
import { MENU_ITEM_CLASS } from '../src/components/EntryMenu'
import {
  CHOOSER_FAILED,
  LAUNCH_FAILED,
  OPEN_IN_PILL_CLASS,
  RESET_FAILED,
  resetFramingLive,
  type ActionHost,
  type LiveFramingView,
} from '../src/lib/entryActions'
import { DEFAULT_CAMERA } from '../src/three/camera'
import { cameraForPose, POSE_VERSION } from '../src/three/pose'
import { RIG_VERSION, THUMB_LIGHTING } from '../src/three/renderer'
import {
  apps,
  click,
  container,
  dir,
  fetchModel,
  getThumb,
  indexAvailability,
  listDir,
  model,
  mountApp,
  mountAppAtCurrentUrl,
  openApp,
  openWith,
  putThumb,
  renderThumbnail,
  semanticPosesFor,
  settle,
  similar,
  tiles,
  tinyStl,
  unmountApp,
  wait,
} from './appHarness'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

/** A model that lives one folder down, so *reveal* has somewhere to go. */
const FOUND = '/models/Alpha/found.stl'
// A second model, so the panel can be moved from one to another without a close.
const NESTED: DirListing = {
  path: '/models',
  entries: [dir('Alpha'), model('Alpha/found.stl'), model('Alpha/other.stl')],
}
const ALPHA: DirListing = { path: '/models/Alpha', entries: [model('Alpha/found.stl')] }
const NEIGHBOURS = {
  path: '/models',
  entries: [model('near.stl')],
  poses: {},
  scores: { '/models/near.stl': { score: 0.9124, z: 4.031 } },
}

/** The same answer with its subject, and — deliberately — a score keyed at the
 *  anchor's own path, which the server never sends: `hitsToEntries` keys only
 *  hits and the anchor is resolved separately. Supplied here for the same
 *  reason `findSimilar`'s `ANCHORED` supplies one. Without it the panel has no
 *  score to withhold and the assertion below passes whether the guard exists or
 *  not — the fixture's silence standing in for the code's. */
const ANCHORED = {
  ...NEIGHBOURS,
  anchor: model('Alpha/found.stl'),
  scores: { ...NEIGHBOURS.scores, [FOUND]: { score: 1, z: 9.99 } },
}

/** The orientation this model has stored — visibly not the default, so a view
 *  that ends up at the default can only have been re-framed. */
const STORED = { az: 1.25, el: -0.4, distR: 4.5, target: [0, 0, 0] as [number, number, number] }

/** An orientation the index can express: file-space `up` (0,-1,0) is the `-y` spindle,
 *  and `azimuth_zero` is perpendicular to it. Module-scope because two describes
 *  need it — the body's posed case, and the wave-fed one that pins the label a
 *  close writes when a discard resolves to it. */
const POSE: IndexPose = {
  up: [0, -1, 0],
  azimuth_zero: [1, 0, 0],
  source: 'test',
  confidence: 1,
  front: { view: 0, azimuth_deg: 40, elevation_deg: 20 },
}

/**
 * The registry as the machine reports it (the openInApps fixture's shape): a
 * viewer-led row, so default-first cannot pass by accident of order.
 */
const F3D = { id: 'f3d.desktop', name: 'F3D' }
const LYCHEE = { id: 'lycheeslicer.desktop', name: 'LycheeSlicer' }
const PHOTON = { id: 'photon-workshop.desktop', name: 'Photon Workshop' }
const REPORT: AppsReport = {
  chooser: true,
  types: { 'model/stl': { default: F3D, associated: [LYCHEE, PHOTON] } },
}

const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]')
const actionRow = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[aria-label="Model actions"]')
/** The panel's open-in row — scoped to the dialog, so a raised menu's row
 *  (same accessible name) can never answer for it. */
const openInRow = (): HTMLElement | null =>
  dialog()?.querySelector<HTMLElement>('[aria-label="Open in"]') ?? null
const panelPills = (): HTMLButtonElement[] =>
  Array.from(openInRow()?.querySelectorAll<HTMLButtonElement>('[data-app-id]') ?? [])
/** The path bar's transient line, where a failure raised from a *tile* lands. */
const pathError = (): string | null =>
  container.querySelector('header p.text-red-400')?.textContent ?? null
/** The panel's own failure lines. `copyError` shares the class, so these read
 *  the text rather than counting nodes. */
const panelErrors = (): string[] =>
  Array.from(dialog()?.querySelectorAll('p.text-red-400') ?? []).map((p) => p.textContent ?? '')
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

/** Drag on the open lightbox's canvas — the manipulation an untouched close
 *  lacks, since `pose-rerender` D4 made such a close write nothing. */
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
/** The lightbox axis control's marked letters — `['Y', 'flip']` for `-y`. */
const pressedAxes = (): string[] =>
  Array.from(
    dialog()?.querySelectorAll<HTMLButtonElement>('[aria-label="Orbit axis"] button') ?? [],
  )
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.textContent ?? '')
/** The camera writes for a path — a null is a discard, not a camera. */
const cameraWrites = (path: string): Body[] =>
  writesFor(path).filter((b) => b.camera !== undefined && b.camera !== null)

beforeEach(async () => {
  // Written under the old on-default; `ao-default-off` flipped the unset read.
  // Pinned on so the framing/orientation assertions keep their shape.
  setAoEnabled(true)
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

  it('puts the row after the metadata, drawn as the context menu’s own items', async () => {
    // User feedback 2026-08-22 (6.8), both halves at once. **Order:** the panel
    // describes the model — format, size, modified — and then offers what can
    // be done to it; the row used to sit above all of that. **Look:** these are
    // the same commands the menu raises, so they are the menu's rows rather
    // than a second style for one thing.
    await openLightbox('Alpha/found.stl')
    const meta = document.querySelector('dl')!
    const row = actionRow()!
    // 4 is DOCUMENT_POSITION_FOLLOWING: the row comes after the metadata.
    expect(meta.compareDocumentPosition(row) & 4).toBe(4)
    // Both are in the panel, so this is an order and not two disjoint columns.
    expect(row.parentElement).toBe(meta.parentElement)

    // One style source, imported rather than copied — `EntryMenu` owns it.
    expect(action('reveal').className).toBe(MENU_ITEM_CLASS)
    expect(action('resetFraming').className).toBe(MENU_ITEM_CLASS)
    // And the copy affordance is exactly as it was: the pill on the path line,
    // which is part of that line rather than one of these.
    const copy = document.querySelector<HTMLButtonElement>('button[aria-label="Copy path"]')!
    expect(copy.className).toContain('rounded-full')
    expect(copy.className).not.toBe(MENU_ITEM_CLASS)
  })

  it('offers the launch actions, exactly as the same surface’s menu does', async () => {
    // INVERTED 2026-08-25, and the semantics are the point: this test used to
    // pin that the panel *withholds* the launch actions (the L10 exclusion as
    // first written), and the user reversed that decision judging 4.3 on the
    // live app — the expanded viewer is exactly where someone decides a model
    // is the one to print, and the panel is the surface they read while
    // deciding. So what was pinned as a scope is now pinned as an offer: the
    // pill row above the strip, *Open with…* in it, on the panel and the menu
    // alike.
    await unmountApp()
    apps.mockResolvedValue({
      chooser: true,
      types: {
        'model/stl': {
          default: { id: 'f3d.desktop', name: 'F3D' },
          associated: [{ id: 'lycheeslicer.desktop', name: 'LycheeSlicer' }],
        },
      },
    })
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models' })
    await mountApp('/models', NESTED)
    listDir.mockResolvedValue(NESTED)

    await openLightbox('Alpha/found.stl')
    // The strip gains *Open with…* and nothing else — `open` stays excluded
    // (the model is already open), so the kind-aware label never shows here.
    expect(actions()).toEqual(['reveal', 'findSimilar', 'resetFraming', 'openWith'])
    // The pill row, above the strip: ids and names, default first, wearing the
    // exported pill class so the panel's row and the menu's cannot drift.
    expect(panelPills().map((b) => b.dataset.appId)).toEqual([
      'f3d.desktop',
      'lycheeslicer.desktop',
    ])
    expect(panelPills().map((b) => b.textContent)).toEqual(['F3D', 'LycheeSlicer'])
    expect(panelPills()[0]!.className).toContain(OPEN_IN_PILL_CLASS)
    expect(openInRow()!.compareDocumentPosition(actionRow()!) & 4).toBe(4)
    // The panel is not a menu: its pills are plain buttons in a labelled
    // group, with `data-app-id` and no `data-command`, exactly as the menu's.
    expect(openInRow()!.querySelector('[role="menuitem"]')).toBeNull()
    expect(panelPills().every((p) => p.dataset.command === undefined)).toBe(true)

    // The menu on that same lightbox offers the same choices.
    await act(async () => {
      dialog()!.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 2,
          buttons: 2,
          clientX: 30,
          clientY: 30,
        }),
      )
      dialog()!.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 30 }),
      )
    })
    const raised = document.querySelector<HTMLElement>('[role="menu"]')!
    expect(Array.from(raised.querySelectorAll('[data-app-id]')).map((b) => b.textContent)).toEqual([
      'F3D',
      'LycheeSlicer',
    ])
    expect(raised.querySelector('[data-command="openWith"]')).not.toBeNull()
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

describe('the panel’s launch actions (the 4.3 reversal, open-in-slicer L10)', () => {
  /** Remount with a registry report, so the session's one reading carries it. */
  async function remountWithApps(report: AppsReport): Promise<void> {
    await unmountApp()
    apps.mockResolvedValue(report)
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models' })
    await mountApp('/models', NESTED)
    listDir.mockResolvedValue(NESTED)
  }

  it('renders the pill row for a model whose type has applications, default first', async () => {
    await remountWithApps(REPORT)
    await openLightbox('Alpha/found.stl')

    // Ids launch and names render — and the order is the assertion: the
    // default leads, the associations follow in the registry's order.
    expect(panelPills().map((b) => b.dataset.appId)).toEqual([F3D.id, LYCHEE.id, PHOTON.id])
    expect(panelPills().map((b) => b.textContent)).toEqual(['F3D', 'LycheeSlicer', 'Photon Workshop'])
  })

  it('renders no row when the type maps to no applications, keeping Open with…', async () => {
    // Absent rather than present and inert — a caption with no pills is an
    // affordance that does nothing. *Open with…* does not go with it: it
    // follows the chooser flag alone, exactly as the spec pairs them.
    await remountWithApps({ chooser: true, types: {} })
    await openLightbox('Alpha/found.stl')

    expect(openInRow()).toBeNull()
    expect(actions()).toContain('openWith')
  })

  it('withholds Open with… when no chooser is configured, keeping the pill row', async () => {
    await remountWithApps({ ...REPORT, chooser: false })
    await openLightbox('Alpha/found.stl')

    expect(actions()).toEqual(['reveal', 'findSimilar', 'resetFraming'])
    expect(panelPills().map((b) => b.dataset.appId)).toEqual([F3D.id, LYCHEE.id, PHOTON.id])
  })

  it('launches once with the entry path and the chosen id, and the view stays', async () => {
    await remountWithApps(REPORT)
    await openLightbox('Alpha/found.stl')

    await click(panelPills()[1]!) // LycheeSlicer
    await settle()

    expect(openApp).toHaveBeenCalledTimes(1)
    expect(openApp).toHaveBeenCalledWith(FOUND, LYCHEE.id)
    // One-shot: the launch opens another application, never touches this view.
    expect(dialog()).not.toBeNull()
    expect(pathError()).toBeNull()
  })

  it('reports a failed launch with the sentence for a named application, in the panel', async () => {
    // *In the panel*, not under the path bar: the lightbox is `fixed inset-0
    // z-lightbox` over that bar behind a 70% scrim, so a sentence sent there is
    // dimmed, parked in the far corner away from the pill just pressed, and
    // gone in 2.5s. Success is silent, so this is the only feedback the press
    // gives. The sentence is still the shared one — only where it lands is
    // per-surface.
    await remountWithApps(REPORT)
    await openLightbox('Alpha/found.stl')

    openApp.mockRejectedValueOnce(new Error('gtk-launch exited 1'))
    await click(panelPills()[0]!)
    await settle()

    expect(panelErrors()).toContain(LAUNCH_FAILED)
    expect(pathError()).toBeNull()
  })

  it('drops a failure when the panel moves to another model', async () => {
    // The sentence belongs to the model that was open when it happened, and
    // outlives it only until the panel swaps.
    await remountWithApps(REPORT)
    await openLightbox('Alpha/found.stl')

    openApp.mockRejectedValueOnce(new Error('gtk-launch exited 1'))
    await click(panelPills()[0]!)
    await settle()
    expect(panelErrors()).toContain(LAUNCH_FAILED)

    await openLightbox('Alpha/other.stl')
    expect(panelErrors()).toEqual([])
  })

  it('reports a failed chooser with its own sentence, which names no application', async () => {
    await remountWithApps(REPORT)
    await openLightbox('Alpha/found.stl')

    openWith.mockRejectedValueOnce(new Error('rofi is already running'))
    await click(actionRow()!.querySelector<HTMLButtonElement>('[data-command="openWith"]')!)
    await settle()

    // The panel reaches the same bodies the menu does, so it inherits the split
    // too: nothing was chosen here, and the sentence must not say otherwise.
    // It lands where the press was, for the reason the launch sentence does.
    expect(panelErrors()).toContain(CHOOSER_FAILED)
    expect(panelErrors()).not.toContain(LAUNCH_FAILED)
    expect(pathError()).toBeNull()
  })
})

describe('a panel action that changes the view', () => {
  it('reveal navigates, marks the entry, and takes the lightbox out through the persisting close', async () => {
    await openLightbox('Alpha/found.stl')
    // Orbited first, and the release's own write cleared: an untouched close
    // writes nothing (`pose-rerender` D4), so it is the close after a
    // manipulation whose camera write says the close ran.
    await orbit()
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

  it('reports the index’s two numbers among the metadata, under the tile’s own labels', async () => {
    // D7: the panel says what the tile said, from the same derivation, so one
    // number cannot appear under two names across the two surfaces. Reached by
    // opening a neighbour from a similarity view, which is the only way a
    // lightbox has a scored entry to describe.
    similar.mockResolvedValue(NEIGHBOURS)
    await openLightbox('Alpha/found.stl')
    await click(action('findSimilar'))
    await wait(250)
    await openLightbox('near.stl')

    const meta = document.querySelector('dl')!
    // `sim`, not `k` — this came from the neighbours route, and the panel reads
    // the scale off the same view the corners do.
    expect(meta.textContent).toContain('sim')
    expect(meta.textContent).toContain('0.912')
    expect(meta.textContent).toContain('4.03')
    expect(meta.textContent).not.toContain('k 0.912')
    // Among the metadata and before the actions: the panel describes the model
    // first. The action row still follows everything in the `<dl>`.
    const row = actionRow()!
    expect(meta.compareDocumentPosition(row) & 4).toBe(4)
  })

  it('withholds the numbers from a similarity view’s anchor, as its tile does', async () => {
    // Two surfaces, one guard. `Grid` withholds a badge from the anchor; a
    // panel without the same test would report the numbers the tile beneath it
    // refused, which is exactly what D7 says cannot happen — and the anchor
    // requirement is not written per surface.
    similar.mockResolvedValue(ANCHORED)
    await openLightbox('Alpha/found.stl')
    await click(action('findSimilar'))
    await wait(250)
    // Open the ANCHOR itself, not a neighbour — it is drawn first in the grid.
    await openLightbox('Alpha/found.stl')

    const meta = document.querySelector('dl')!
    // The fixture keys 1.000 / 9.99 at this very path; the panel must not read
    // them, and a neighbour opened from the same view still would.
    expect(meta.textContent).not.toContain('1.000')
    expect(meta.textContent).not.toContain('9.99')
    expect(meta.textContent).not.toMatch(/\bsim\b/)
    // Still a description of the model, just without a score it never had.
    expect(meta.textContent).toContain('format')
  })

  it('shows no such rows for a model opened from an ordinary listing', async () => {
    // Nothing scored this one, so there is no number to report and no row held
    // in reserve for one.
    await openLightbox('Alpha/found.stl')

    const meta = document.querySelector('dl')!
    expect(meta.textContent).toContain('format')
    expect(meta.textContent).not.toMatch(/\bsim\b/)
    expect(meta.textContent).not.toMatch(/\bk\b/)
    expect(meta.textContent).not.toMatch(/\bz\b/)
  })

  it('find similar lands the similarity view and leaves the same way', async () => {
    similar.mockResolvedValue(NEIGHBOURS)
    await openLightbox('Alpha/found.stl')
    await orbit() // as *reveal* above: the close after a manipulation is the one that writes
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
   * `history.back`, which the suite plays by hand rather than through the
   * browser (client/test/CLAUDE.md).
   */
  async function openStoredModel(beforeMount: () => void = () => {}): Promise<void> {
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
      lighting: THUMB_LIGHTING,
      rig: RIG_VERSION,
    })
    // After the teardown that restores the stock mesh loader, before the mount
    // that uses it — the one window in which a test can hold the load open.
    beforeMount()
    await mountAppAtCurrentUrl('/?path=%2Fmodels&model=%2Fmodels%2FAlpha%2Ffound.stl', NESTED)
    listDir.mockResolvedValue(NESTED)
    await wait(200)
    expect(dialog()).not.toBeNull()
  }

  it('discards the stored orientation now, and the pixels follow after the close — two PUTs, no camera', async () => {
    await openStoredModel()
    putThumb.mockClear()
    renderThumbnail.mockClear()

    await click(action('resetFraming'))
    await settle()

    // The store half: the camera is *discarded* (null, the third thing a write
    // can say), not overwritten with a default — and the axis with it, whether
    // or not a pose could replace it (`pose-rerender` D7). No pixels ride along.
    const discards = writesFor(FOUND).filter((b) => b.camera === null)
    expect(discards.length).toBe(1)
    expect(discards[0]!.axis).toBeNull()
    expect(discards[0]!.png).toBeUndefined()
    // The pixels are queued behind the suspension the open view holds: nothing
    // is drawn while the lightbox is up.
    expect(renderThumbnail).not.toHaveBeenCalled()
    // The server has taken the discard; the queued re-render reads it back.
    getThumb.mockResolvedValue({
      status: 'hit',
      pngUrl: 'blob:stored',
      lighting: THUMB_LIGHTING,
      rig: RIG_VERSION,
    })

    await click(closeButton())
    await wait(250)
    expect(dialog()).toBeNull()
    await settle()

    // The close wrote nothing — a reset clears the session's claim, and an
    // untouched close persists nothing (`pose-rerender` D4). The queued
    // re-render then drew the tile at what the model resolves to: the default
    // about the file's own axis (`z` for an STL, not the stored `y`) — the one
    // render in this case, since the tile's own thumbnail was a complete hit.
    expect(cameraWrites(FOUND)).toEqual([])
    expect(renderThumbnail.mock.calls.length).toBe(1)
    const snapshot = renderThumbnail.mock.calls[0] as unknown as [unknown, typeof STORED, string]
    expect(snapshot[1].az).toBeCloseTo(DEFAULT_CAMERA.az)
    expect(snapshot[1].el).toBeCloseTo(DEFAULT_CAMERA.el)
    expect(snapshot[1].distR).toBeCloseTo(DEFAULT_CAMERA.distR)
    expect(snapshot[2]).toBe('z')
    const pixels = writesFor(FOUND).filter((b) => b.png !== undefined)
    expect(pixels.length).toBe(1)
    // No camera field at all: the discard stands. Unlabelled, too — nothing
    // framed these default pixels, and labelling them posed would tell the grid
    // a pose it has never applied is in force.
    expect(pixels[0]!.camera).toBeUndefined()
    expect(pixels[0]!.posed).toBeUndefined()
    expect(writesFor(FOUND).length).toBe(2)
  })

  it('an orbit made after the reset is the last word — the queued pixels keep it', async () => {
    // The control for the shape above, measured before it was chosen: a queued
    // *discard* (the tile menu's body) read the cache after the close and wrote
    // [camera, camera, camera:null] — the orbit the user made after the reset,
    // thrown away by the reset's own write landing last. The discard goes now
    // and the queued job only redraws, so whatever is stored when it runs — the
    // orbit — is what it draws and keeps.
    await openStoredModel()
    putThumb.mockClear()
    await click(action('resetFraming'))
    await settle()
    expect(writesFor(FOUND).filter((b) => b.camera === null).length).toBe(1)

    await orbit()
    const orbited = cameraWrites(FOUND)
    expect(orbited.length).toBe(1)
    // The server holds the orbit now; the queued re-render reads it back.
    getThumb.mockResolvedValue({
      status: 'hit',
      camera: orbited[0]!.camera,
      axis: 'y',
      pngUrl: 'blob:stored',
      lighting: THUMB_LIGHTING,
      rig: RIG_VERSION,
    })

    await click(closeButton())
    await wait(250)
    expect(dialog()).toBeNull()
    await settle()

    const writes = writesFor(FOUND)
    // Nothing after the orbit nulls the camera, and the last write — the
    // queued pixels — carries no camera field: keep.
    expect(writes.slice(writes.indexOf(orbited[0]!) + 1).filter((b) => b.camera === null)).toEqual([])
    const last = writes[writes.length - 1]!
    expect(last.png).toBeDefined()
    expect(last.camera).toBeUndefined()
    // And it was drawn at the orbit, not at the discarded default: the orbit
    // kept the session's distance, which no drag changes.
    const shot = renderThumbnail.mock.calls.at(-1) as unknown as [unknown, typeof STORED, string]
    expect(shot[1].distR).toBeCloseTo((orbited[0]!.camera as typeof STORED).distR)
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

  it('discards a framing given up while the mesh was still loading', async () => {
    // The same race one step earlier, and the one the session's own refs could
    // not see: the panel is up over the spinner, so the press finds no session
    // (`liveFramingView` had nothing to hand over) while the pending open has
    // already resolved the saved camera it is going to build with. The discard
    // that happened *before* the session existed has to reach it anyway, or the
    // view opens at the orientation just given up — and an orbit from there
    // would write a camera built on it.
    let land = (): void => {}
    const held = new Promise<ArrayBuffer>((resolve) => {
      land = () => resolve(tinyStl())
    })
    await openStoredModel(() => {
      fetchModel.mockImplementationOnce(() => held)
    })
    // The mesh has not arrived: this is the spinner, not the canvas.
    expect(dialog()!.querySelector('.animate-spin')).not.toBeNull()
    putThumb.mockClear()
    renderThumbnail.mockClear()

    await click(action('resetFraming'))
    await settle()
    // The store half runs with no session — the command's own rule, unchanged.
    expect(writesFor(FOUND).filter((b) => b.camera === null).length).toBe(1)

    await act(async () => {
      land()
      await held
    })
    await settle()

    // The session opened at what the model resolves to *after* the discard —
    // the default. An untouched close would show nothing (it writes nothing,
    // `pose-rerender` D4), so orbit: a drag keeps the session's distance, and
    // the default's distance is not the stored one.
    await orbit()
    await click(closeButton())
    await wait(250)
    expect(dialog()).toBeNull()

    const written = cameraWrites(FOUND)
    expect(written.length).toBeGreaterThan(0)
    for (const w of written) {
      expect((w.camera as typeof STORED).distR).toBeCloseTo(DEFAULT_CAMERA.distR)
    }
  })

  it('re-frames to the pose the discard installed when the saved read lands after the press, and the pixels record it', async () => {
    // The other half of the landing handler, and the only thing that pins it: a
    // press that lands between the request and its answer has its framing
    // overwritten by the saved read unless the handler adopts the pending
    // discard — which is safe there and only there, because `Promise.all` has
    // by then awaited the very promise that would overwrite it.
    //
    // The two disagree exactly here: the model HAS a usable pose (so the
    // discard resolves to it), while the stored answer carries an axis (so the
    // open would not have been the index's). Read off the axis control while
    // the lightbox is up — the pose's spindle, not the stored one — and off the
    // queued re-render after the close, which draws the pose and records it.
    let answer = (): void => {}
    const saved = new Promise<unknown>((resolve) => {
      answer = () =>
        resolve({
          status: 'hit',
          // An axis and no camera: enough to take the open out of pose framing
          // (`useThumbnails`' rule is that half a pose is not a pose), and not
          // enough to stop the discard resolving to the index's.
          axis: 'y',
          pngUrl: 'blob:stored',
          lighting: THUMB_LIGHTING,
          rig: RIG_VERSION,
        })
    })
    await unmountApp()
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models' })
    // The wave feeds one map: the panel's `pose` prop and the command's
    // `host.poses` are the same object, so the two verdicts below differ over
    // the stored answer and never over the pose itself.
    semanticPosesFor.mockResolvedValue({ poses: { [FOUND]: POSE } })
    getThumb.mockReturnValue(saved)
    await mountAppAtCurrentUrl('/?path=%2Fmodels&model=%2Fmodels%2FAlpha%2Ffound.stl', NESTED)
    listDir.mockResolvedValue(NESTED)
    await wait(200)
    expect(dialog()).not.toBeNull()
    // Nothing has been read back yet, so the open has resolved nothing.
    expect(dialog()!.querySelector('.animate-spin')).not.toBeNull()

    await click(action('resetFraming'))
    await settle()
    // The pose is what it resolved to — camera and axis handed back together.
    expect(writesFor(FOUND).filter((b) => b.camera === null && b.axis === null).length).toBe(1)
    // The server has taken both halves; the queued re-render reads that back.
    getThumb.mockResolvedValue({ status: 'hit', pngUrl: 'blob:stored', lighting: THUMB_LIGHTING, rig: RIG_VERSION })

    // Only now does the saved read land, with its own opposite verdict.
    await act(async () => {
      answer()
      await saved
    })
    await settle()
    const resolved = cameraForPose(POSE, DEFAULT_CAMERA)!
    expect(resolved.axis).toBe('-y')
    expect(pressedAxes()).toEqual(['Y', 'flip']) // the pose's spindle, not the stored `y`
    putThumb.mockClear()
    renderThumbnail.mockClear()

    await click(closeButton())
    await wait(250)
    expect(dialog()).toBeNull()
    await settle()

    // The close wrote nothing; the queued pixels were drawn at the pose and say so.
    expect(cameraWrites(FOUND)).toEqual([])
    const pixels = writesFor(FOUND).filter((b) => b.png !== undefined)
    expect(pixels.length).toBe(1)
    expect(pixels[0]!.posed).toBe(POSE_VERSION)
    expect(pixels[0]!.camera).toBeUndefined()
    const shot = renderThumbnail.mock.calls[0] as unknown as [unknown, typeof STORED, string]
    expect(shot[1].az).toBeCloseTo(resolved.camera.az)
    expect(shot[2]).toBe(resolved.axis)
  })

  it('a pose-less discard over the spinner re-frames about the file’s own axis, not the stored one', async () => {
    // Inverted 2026-09-11 (`pose-rerender` D7): this cell pinned that a
    // pose-less discard *kept* the stored spindle, read back from the landing
    // handler's own `getThumb` rather than the press's blind read. The axis
    // goes with the camera now, so the landing handler adopts the pending
    // discard's axis — the file's default — over the stored one. Read off the
    // axis control while the lightbox is up, and off the queued re-render after
    // the close.
    let answer = (): void => {}
    const saved = new Promise<unknown>((resolve) => {
      answer = () =>
        resolve({
          status: 'hit',
          // A chosen axis and no camera, and no pose anywhere.
          axis: '-x',
          pngUrl: 'blob:stored',
          lighting: THUMB_LIGHTING,
          rig: RIG_VERSION,
        })
    })
    await unmountApp()
    indexAvailability.mockResolvedValue({ state: 'ready', collectionRoot: '/models' })
    semanticPosesFor.mockResolvedValue({ poses: {} })
    getThumb.mockReturnValue(saved)
    await mountAppAtCurrentUrl('/?path=%2Fmodels&model=%2Fmodels%2FAlpha%2Ffound.stl', NESTED)
    listDir.mockResolvedValue(NESTED)
    await wait(200)
    expect(dialog()).not.toBeNull()
    expect(dialog()!.querySelector('.animate-spin')).not.toBeNull()

    await click(action('resetFraming'))
    await settle()
    // Pose-less or not: the camera and the axis are both discarded.
    expect(writesFor(FOUND).filter((b) => b.camera === null && b.axis === null).length).toBe(1)
    // The server has taken both; the queued re-render reads that back.
    getThumb.mockResolvedValue({ status: 'hit', pngUrl: 'blob:stored', lighting: THUMB_LIGHTING, rig: RIG_VERSION })

    await act(async () => {
      answer()
      await saved
    })
    await settle()
    expect(pressedAxes()).toEqual(['Z']) // the file's axis, not the stored `-x`
    putThumb.mockClear()
    renderThumbnail.mockClear()

    await click(closeButton())
    await wait(250)
    expect(dialog()).toBeNull()
    await settle()

    // The queued pixels are drawn about the file's axis at the default camera.
    expect(renderThumbnail.mock.calls.length).toBe(1)
    const shot = renderThumbnail.mock.calls[0] as unknown as [unknown, typeof STORED, string]
    expect(shot[2]).toBe('z')
    expect(shot[1].az).toBeCloseTo(DEFAULT_CAMERA.az)
    expect(shot[1].el).toBeCloseTo(DEFAULT_CAMERA.el)
  })

  it('does not carry a pending discard into the next model opened', async () => {
    // The clear at the top of the session effect. A reframe recorded while one
    // model's mesh was in flight belongs to that open; the model that replaces
    // it must resolve its own orientation, not inherit a discard nobody made
    // for it — which would silently reset the framing of a model the user only
    // looked at.
    let land = (): void => {}
    const held = new Promise<ArrayBuffer>((resolve) => {
      land = () => resolve(tinyStl())
    })
    await openStoredModel(() => {
      fetchModel.mockImplementationOnce(() => held)
    })
    await click(action('resetFraming'))
    await settle()

    // Move the panel to the neighbour before the first mesh ever lands.
    await openLightbox('Alpha/other.stl')
    await act(async () => {
      land()
      await held
    })
    await settle()
    putThumb.mockClear()

    // An untouched close writes nothing (`pose-rerender` D4), so orbit: the
    // drag keeps the session's distance, which says what the neighbour opened
    // at. Out through *reveal* rather than the ✕: this lightbox was
    // pointer-opened, so its close runs `history.back`, which the harness's
    // stubbed URL cannot survive. The persisting close is the same one either
    // way — App's watcher answering a view that no longer names the model.
    await orbit()
    await click(action('reveal'))
    await wait(250)
    expect(dialog()).toBeNull()

    // The neighbour opened at its own stored orientation — it was never
    // discarded. Inheriting the pending reframe would have opened it at the
    // default, whose distance is not the stored one.
    const OTHER = '/models/Alpha/other.stl'
    const written = cameraWrites(OTHER)
    expect(written.length).toBeGreaterThan(0)
    for (const w of written) {
      expect((w.camera as typeof STORED).distR).toBeCloseTo(STORED.distR)
    }
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
  interface Harness {
    host: ActionHost
    put: ReturnType<typeof vi.fn>
    discard: ReturnType<typeof vi.fn>
    report: ReturnType<typeof vi.fn>
    setThumb: ReturnType<typeof vi.fn>
    view: LiveFramingView & { reframe: ReturnType<typeof vi.fn> }
    /** Run what the reset pushed on the render queue — the pixels, which in
     *  the app wait behind the open view's suspension and land after close. */
    runQueued: () => Promise<void>
  }
  /** `stored` is what the cache answers the queued re-render — the server's
   *  echo *after* the discard, which the store half made a moment earlier. */
  function harness(
    poses: Record<string, IndexPose> = {},
    stored: Record<string, unknown> = {},
  ): Harness {
    const put = vi.fn().mockResolvedValue({ gen: 2 })
    const discard = vi.fn()
    const report = vi.fn()
    const setThumb = vi.fn()
    const queued: (() => Promise<void>)[] = []
    return {
      put,
      discard,
      report,
      setThumb,
      host: {
        poses,
        api: {
          putThumb: put,
          getThumb: vi.fn().mockResolvedValue({
            status: 'hit',
            pngUrl: 'blob:stored',
            lighting: THUMB_LIGHTING,
            rig: RIG_VERSION,
            ...stored,
          }),
        },
        lru: { acquire: vi.fn().mockResolvedValue({}) },
        queue: { push: (job: () => Promise<void>) => queued.push(job), whenResumed: () => Promise.resolve() },
        setThumb,
        discardThumbFraming: discard,
        report,
        framingChanged: vi.fn(),
      } as unknown as ActionHost,
      view: { reframe: vi.fn() },
      runQueued: async () => {
        expect(queued).toHaveLength(1)
        await queued[0]!()
      },
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
      // Declared on every PUT now, this one included — though with no pixels
      // it only names the request: a pixel-less orientation discard
      // invalidates both renders whichever it names (ao-as-recipe-dimension).
      ao: true,
    })
    const resolved = cameraForPose(POSE, DEFAULT_CAMERA)!
    expect(h.view.reframe).toHaveBeenCalledWith(resolved.camera, resolved.axis)
    expect(resolved.axis).not.toBe('z') // the axis really moved off the file default
    await flush()
    expect(h.discard).toHaveBeenCalledWith(ENTRY.path)

    // The pixels, queued: drawn at the pose (the store now holds nothing of
    // the user's) and recording it, with no camera field — the discard stands.
    h.put.mockClear()
    await h.runQueued()
    expect(h.put).toHaveBeenCalledTimes(1)
    expect(h.put.mock.calls[0]![0]).toMatchObject({
      path: ENTRY.path,
      posed: POSE_VERSION,
      lighting: THUMB_LIGHTING,
      rig: RIG_VERSION,
    })
    expect(h.put.mock.calls[0]![0].png).toBeDefined()
    expect(h.put.mock.calls[0]![0].camera).toBeUndefined()
    expect(h.put.mock.calls[0]![0].axis).toBeUndefined()
    expect(h.put.mock.calls[0]![0].poseKey).toBeDefined()
  })

  it('discards the axis too when the view knows no pose — the default about the file’s own axis', async () => {
    // Inverted 2026-09-11 (`pose-rerender` D7): this cell pinned `axis:
    // undefined` (keep) and a re-frame about the view's own spindle. A kept
    // axis was the framing that "came back" once the index could replace it.
    const h = harness({}, { axis: '-x' })
    resetFramingLive(ENTRY, h.host, h.view)

    expect(h.put).toHaveBeenCalledWith({
      path: ENTRY.path,
      mtime: ENTRY.mtime,
      camera: null,
      axis: null,
      ao: true,
    })
    expect(h.view.reframe).toHaveBeenCalledWith(DEFAULT_CAMERA, 'z')
    await flush()
    expect(h.discard).toHaveBeenCalledWith(ENTRY.path)

    // The pixels, queued: the store has taken the discard, so the re-render
    // finds nothing stored and draws the default about the file's axis,
    // unlabelled — nothing framed them — and with no camera field.
    h.put.mockClear()
    ;(h.host.api.getThumb as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'hit',
      pngUrl: 'blob:stored',
      lighting: THUMB_LIGHTING,
      rig: RIG_VERSION,
    })
    await h.runQueued()
    expect(h.put).toHaveBeenCalledTimes(1)
    expect(h.put.mock.calls[0]![0].png).toBeDefined()
    expect(h.put.mock.calls[0]![0].camera).toBeUndefined()
    expect(h.put.mock.calls[0]![0].posed).toBeUndefined()
    const shot = renderThumbnail.mock.calls.at(-1) as unknown as [unknown, typeof STORED, string]
    expect(shot[2]).toBe('z')
    expect(shot[1].az).toBeCloseTo(DEFAULT_CAMERA.az)
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
