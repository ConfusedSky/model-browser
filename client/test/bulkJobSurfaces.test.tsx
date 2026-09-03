// @vitest-environment happy-dom
//
// The bulk-job *surfaces*, through App (`bulk-thumbnail-jobs` 3.3): the two
// container menu entries, the library tab, and the one chip all three of them
// report through. What a job *does* per entry is pinned against the runner
// directly in bulkJobs.test.ts — nothing here re-asserts a counter that module
// already owns. What is asserted here is the wiring only App can be wrong
// about: that a container's press reaches the runner with the right scope, that
// reset's consent gates the writes, that the chip outlives the listing that
// launched it, and that a tab which the feature report can empty is neither
// offered nor recorded when it is empty.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirEntry, DirListing, ThumbInfo, ThumbRenderInfo } from '../../shared/types'
import {
  click,
  container,
  dir,
  features,
  listDir,
  model,
  models,
  mountApp,
  putThumb,
  renderThumbnail,
  settle,
  tiles,
  unmountApp,
} from './appHarness'
import { JOB_BUSY } from '../src/lib/entryActions'
import { RIG_VERSION, THUMB_LIGHTING } from '../src/three/renderer'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const NESTED: DirListing = { path: '/models', entries: [dir('Alpha'), dir('Beta')] }
const BETA: DirListing = { path: '/models/Beta', entries: [] }
/** The panel's own storage key, written out rather than imported — renaming it
 *  would drop every profile's state, and a test that renamed with it would say
 *  nothing about that (similarTuning.test.tsx's rule). */
const TAB_KEY = 'model-browser:panel-tab'

/** A render block the current build would draw — the annotation's "nothing to
 *  do here". Spelled from the constants, never a literal, so a rig bump moves
 *  it with the app (client/test/CLAUDE.md). */
const CURRENT: ThumbRenderInfo = { state: 'hit', lighting: THUMB_LIGHTING, rig: RIG_VERSION }
/** An entry carrying a stored orientation — `framed` is the server's word for
 *  "a camera **or** an axis" (M4), and it is the whole reset derivation. */
const framed = (): ThumbInfo => ({ gen: 1, framed: true, ao: CURRENT, noao: CURRENT })

/** A model beneath a scope, with whatever the enumeration says about it. */
function beneath(scope: string, name: string, thumb?: ThumbInfo): DirEntry {
  return {
    name,
    path: `${scope}/${name}`,
    kind: 'model',
    format: 'stl',
    size: 1,
    mtime: 7,
    ...(thumb === undefined ? {} : { thumb }),
  }
}
/** What `ApiClient.models` answers for a scope. */
function enumerated(path: string, entries: DirEntry[], complete = true): void {
  models.mockResolvedValue({ path, entries, complete })
}

// The gesture a tile's menu is raised with — a secondary press, then the
// browser's own contextmenu. Local rather than hoisted into the harness: three
// other files carry their own copy, and hoisting it would mean editing them.
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
const menuItem = (id: string): HTMLButtonElement =>
  menu()!.querySelector<HTMLButtonElement>(`[data-command="${id}"]`)!
const tile = (name: string): HTMLButtonElement =>
  tiles().find((t) => (t.getAttribute('title') ?? '') === name)!
/** Raise the menu on a container tile and choose one of its bulk entries. */
async function launchFrom(name: string, command: string): Promise<void> {
  await secondaryPress(tile(name))
  await click(menuItem(command))
  await settle()
}

const chip = (): HTMLElement | null => container.querySelector<HTMLElement>('[role="status"]')
const chipText = (): string => chip()?.querySelector('p')?.textContent ?? ''
/** A chip button by its accessible name — the three names the chip promises. */
function chipButton(name: string): HTMLButtonElement | null {
  return (
    Array.from(chip()?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
      (b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === name,
    ) ?? null
  )
}
/** The path bar's transient line — where a command's sentence lands. */
const headerLine = (): string => container.querySelector('header p')?.textContent ?? ''

async function expandPanel(): Promise<void> {
  const expand = container.querySelector<HTMLButtonElement>(
    'aside button[aria-label="Expand side panel"]',
  )
  if (expand !== null) await click(expand)
}
const tabButtons = (): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('aside [role="tab"]'))
const tabNames = (): string[] => tabButtons().map((b) => b.textContent!.replace('•', '').trim())
const tabButton = (name: string): HTMLButtonElement | undefined =>
  tabButtons()[tabNames().indexOf(name)]
const selectedTab = (): string | undefined =>
  tabNames()[tabButtons().findIndex((b) => b.getAttribute('aria-selected') === 'true')]
/** The library tab's two buttons, in the order the tab draws them. */
const libraryButtons = (): HTMLButtonElement[] =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('aside button')).filter((b) =>
    /^(Counting…|Generate |Reset )/.test(b.textContent ?? ''),
  )

/** Hold every render open, and hand back the release. The job then sits in
 *  `running` for as long as the cell needs it to — which is what makes
 *  navigation, cancel and dismiss observable at all. */
function holdRenders(): () => void {
  let release = (): void => {}
  const held = new Promise<void>((r) => {
    release = r
  })
  renderThumbnail.mockImplementation(() => held.then(() => new Blob(['png'])))
  return release
}

beforeEach(() => {
  // The PUT's echo, which the render path reads back as the entry's new
  // generation. The harness default answers `{}`, restored on the way out.
  putThumb.mockResolvedValue({ gen: 2 })
})
afterEach(async () => {
  await unmountApp()
  putThumb.mockResolvedValue({})
})

describe('a container tile launches a job over its subtree', () => {
  it('reset states its count and discards nothing until the chip is answered', async () => {
    enumerated('/models/Alpha', [
      beneath('/models/Alpha', 'a.stl', framed()),
      beneath('/models/Alpha', 'b.stl', framed()),
      beneath('/models/Alpha', 'c.stl', framed()),
    ])
    await mountApp('/models', NESTED)
    await launchFrom('Alpha', 'resetBeneath')

    // D5: the count is stated *before* anything is discarded, and the scope is
    // named the way the tile that launched it named it.
    expect(chipText()).toBe('Reset 3 framings beneath Alpha?')
    expect(putThumb).not.toHaveBeenCalled()

    await click(chipButton('Cancel')!)
    await settle()
    // "Cancelling it discards nothing" — the spec's own words for this cell.
    expect(putThumb).not.toHaveBeenCalled()
    expect(chipText()).toBe('Cancelled after 0 of 3 beneath Alpha')

    // Relaunch and consent this time. Cancel plus re-run is pause (D1), and
    // nothing was written, so the second derivation is the same three.
    await launchFrom('Alpha', 'resetBeneath')
    expect(chipText()).toBe('Reset 3 framings beneath Alpha?')
    await click(chipButton('Reset')!)
    await settle()

    expect(putThumb).toHaveBeenCalledTimes(3)
    for (const [write] of putThumb.mock.calls) {
      // The discard and the pixels together (D3), conditional on the generation
      // the derivation snapshotted (D4).
      expect(write).toMatchObject({ camera: null, png: null, ifGen: 1 })
    }
    expect(chipText()).toBe('Reset 3 of 3 beneath Alpha')
    // Done is done: there is nothing left to stop.
    expect(chipButton('Cancel')).toBeNull()
  })

  it('generate runs without asking, and an empty scope ends at once', async () => {
    enumerated('/models/Alpha', [
      beneath('/models/Alpha', 'a.stl'),
      beneath('/models/Alpha', 'b.stl'),
    ])
    const release = holdRenders()
    await mountApp('/models', NESTED)
    await launchFrom('Alpha', 'generateBeneath')

    // Straight to work: a generate touches no current entry, so there is
    // nothing to consent to (D5) and no Reset button at any point.
    expect(chipText()).toBe('Generating thumbnails beneath Alpha: 0 of 2')
    expect(chipButton('Reset')).toBeNull()
    release()
    await settle()
    expect(chipText()).toBe('Generated 2 of 2 beneath Alpha')
    expect(chipButton('Reset')).toBeNull()

    // An honest nothing: a warm folder is not a failure, and the chip says so
    // without having run anything.
    enumerated('/models/Beta', [])
    await launchFrom('Beta', 'generateBeneath')
    expect(chipText()).toBe('Generated 0 of 0 beneath Beta')
  })

  it('offers neither entry on a model tile, whose per-model actions cover it', async () => {
    const ONE: DirListing = { path: '/models', entries: [model('widget.stl')] }
    await mountApp('/models', ONE)
    await secondaryPress(tile('widget.stl'))
    const ids = Array.from(menu()!.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
      (b) => b.dataset.command ?? '',
    )
    expect(ids).not.toContain('generateBeneath')
    expect(ids).not.toContain('resetBeneath')
  })
})

describe('the chip is the job, and outlives the folder that launched it', () => {
  it('survives navigation, and Cancel there stops the job', async () => {
    enumerated('/models/Alpha', [
      beneath('/models/Alpha', 'a.stl'),
      beneath('/models/Alpha', 'b.stl'),
    ])
    const release = holdRenders()
    await mountApp('/models', NESTED)
    listDir.mockImplementation((p: string) => Promise.resolve(p === '/models/Beta' ? BETA : NESTED))
    await launchFrom('Alpha', 'generateBeneath')
    expect(chipText()).toBe('Generating thumbnails beneath Alpha: 0 of 2')

    // Away from the folder whose menu launched it. The chip is App-level, so
    // the listing going does not take it with it (D2).
    await click(tile('Beta'))
    await settle()
    expect(chip()).not.toBeNull()
    expect(chipText()).toBe('Generating thumbnails beneath Alpha: 0 of 2')

    await click(chipButton('Cancel')!)
    await settle()
    // The entry already in flight finishes and is still counted — a render
    // cannot be recalled from the GPU — but nothing further is pushed or sent,
    // which is the second model never reaching the renderer at all.
    release()
    await settle()
    expect(renderThumbnail).toHaveBeenCalledTimes(1)
    expect(putThumb.mock.calls.length).toBeLessThanOrEqual(1)
    expect(chipText()).toMatch(/^Cancelled after \d of 2 beneath Alpha/)
  })

  it('dismisses without cancelling — the job runs on, through entries not yet started', async () => {
    // **Two** entries, and that is the whole design of this cell. A cancel lets
    // the entry already in flight finish and counts it too, so a one-entry
    // scope cannot tell dismiss from cancel: both end with one write. What only
    // a live job does is start the *second* entry — so the assertion is the
    // work that had not begun when the × was pressed.
    enumerated('/models/Alpha', [
      beneath('/models/Alpha', 'a.stl'),
      beneath('/models/Alpha', 'b.stl'),
    ])
    const release = holdRenders()
    await mountApp('/models', NESTED)
    await launchFrom('Alpha', 'generateBeneath')
    expect(chip()).not.toBeNull()

    await click(chipButton('Dismiss')!)
    await settle()
    // Hidden, not stopped (D2) — which is why they are two buttons.
    expect(chip()).toBeNull()

    release()
    await settle()
    expect(putThumb).toHaveBeenCalledTimes(2)
    // And the job it kept running is the one the next press surfaces: a second
    // launch un-dismisses rather than starting a second job. A cancelling ×
    // would have left this reading "Cancelled after 1 of 2".
    await launchFrom('Alpha', 'generateBeneath')
    expect(chipText()).toBe('Generated 2 of 2 beneath Alpha')
  })

  it('answers a second launch with the running job and one sentence', async () => {
    enumerated('/models/Alpha', [
      beneath('/models/Alpha', 'a.stl'),
      beneath('/models/Alpha', 'b.stl'),
    ])
    const release = holdRenders()
    await mountApp('/models', NESTED)
    await launchFrom('Alpha', 'generateBeneath')
    expect(models).toHaveBeenCalledTimes(1)

    await launchFrom('Beta', 'resetBeneath')
    // One job, and it is still the first one: the scope, the operation and the
    // counters all belong to the launch that got there first (D2).
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(chipText()).toBe('Generating thumbnails beneath Alpha: 0 of 2')
    // The second scope was never even enumerated.
    expect(models).toHaveBeenCalledTimes(1)
    expect(headerLine()).toBe(JOB_BUSY)

    release()
    await settle()
  })
})

describe('the library tab', () => {
  it('is absent while the report is unknown, and absent when it says no', async () => {
    // Unknown: still in flight. An offer is withheld until a KNOWN report
    // declares the capability on, so nothing renders and then vanishes a round
    // trip later (feature-report D3).
    features.mockImplementation(() => new Promise(() => {}))
    await mountApp('/models', NESTED)
    await expandPanel()
    expect(tabNames()).toEqual(['chat', 'search'])
    await unmountApp()

    // Known and off: every occupant of this tab is a write affordance, and an
    // empty tab is not shown (D6).
    features.mockResolvedValue({ thumbWrites: false })
    await mountApp('/models', NESTED)
    await expandPanel()
    expect(tabNames()).toEqual(['chat', 'search'])
  })

  it('states each button’s count, and says it is counting until it can', async () => {
    // The whole library: two models the current build would draw differently,
    // and one it would not — which is also the only one carrying a framing, so
    // the two buttons must disagree.
    // Held, so the counting state is observable at all: an enumeration that
    // resolves in the same microtask never leaves the buttons saying it.
    const answer = { path: '/', complete: true, entries: [
      beneath('', '/a.stl'),
      beneath('', '/b.stl'),
      beneath('', '/c.stl', framed()),
    ] }
    let land = (): void => {}
    const held = new Promise<void>((r) => {
      land = r
    })
    models.mockImplementation(() => held.then(() => answer))
    await mountApp('/models', NESTED)
    await expandPanel()
    await click(tabButton('library')!)

    // "Counting…" until it lands, and the panel never blocks on it (D5).
    expect(libraryButtons().map((b) => b.textContent)).toEqual(['Counting…', 'Counting…'])
    expect(libraryButtons().every((b) => b.disabled)).toBe(true)
    land()
    await settle()
    expect(libraryButtons().map((b) => b.textContent)).toEqual([
      'Generate 2 missing thumbnails',
      'Reset 1 framings',
    ])
    // The app's root is what "the library" means on screen (D8).
    expect(models).toHaveBeenCalledWith('/')

    // And pressing one launches over that same root — the chip names it.
    await click(libraryButtons()[0]!)
    await settle()
    expect(chipText()).toBe('Generated 2 of 2 in the library')
  })

  it('is never what the profile records, and a stored one opens on chat', async () => {
    await mountApp('/models', NESTED)
    await expandPanel()
    await click(tabButton('library')!)
    expect(selectedTab()).toBe('library')
    // A tab the feature report can empty is a tab that can be absent, which is
    // the condition `StoredTab` exists to exclude (M8).
    expect(localStorage.getItem(TAB_KEY)).not.toBe('library')
    await unmountApp()

    // …and the parser will not read one back either, however it got there: a
    // hand-edited profile naming a tab that may not exist opens on one that
    // always does.
    localStorage.setItem(TAB_KEY, 'library')
    await mountApp('/models', NESTED)
    await expandPanel()
    expect(selectedTab()).toBe('chat')
  })
})
