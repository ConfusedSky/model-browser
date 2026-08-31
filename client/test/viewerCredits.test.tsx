// @vitest-environment happy-dom
//
// The lightbox panel's attribution block (`library-overrides` 2.2/2.3): what a
// credited model shows, where the block sits, and the four ways of having
// nothing to show — no store, no covering key, a read that failed, and an
// answer that arrived for a model the user has already left.
//
// Asserted through a mounted App rather than against the component: the read
// follows the *viewer subject*, and a subject that changes mid-flight is App
// swapping the entry under a component that stays mounted. A component test
// would have to fake that swap; this one performs it.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing, OverrideCredits } from '../../shared/types'
import { hostLabel } from '../src/viewer/ViewerLayer'
import {
  container,
  dir,
  listDir,
  model,
  mountApp,
  overrides,
  settle,
  tiles,
  unmountApp,
  wait,
} from './appHarness'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const FOUND = '/models/Alpha/found.stl'
const OTHER = '/models/Alpha/other.stl'
/** Two models, so the panel can be moved from one to the other without a close. */
const NESTED: DirListing = {
  path: '/models',
  entries: [dir('Alpha'), model('Alpha/found.stl'), model('Alpha/other.stl')],
}

/** A kit's credits as the generator writes them, from the corpus metadata. */
const CREDITS: OverrideCredits = {
  author: 'Valandar',
  authorUrl: 'https://www.thingiverse.com/Valandar',
  license: 'Creative Commons - Attribution',
  sourceUrl: 'https://www.thingiverse.com/thing:3750572',
}

const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]')
const panel = (): HTMLElement | null => document.querySelector('dl')?.parentElement ?? null
const actionRow = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[aria-label="Model actions"]')
/** The credit rows, in document order, by the field each one draws. */
const creditRows = (): string[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-credit]')).map(
    (el) => el.dataset.credit ?? '',
  )
const creditRow = (field: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-credit="${field}"]`)
/** A row's value half — the `<dd>`, which is where a link or a string lands. */
const creditValue = (field: string): HTMLElement | null =>
  creditRow(field)?.querySelector('dd') ?? null
const creditLink = (field: string): HTMLAnchorElement | null =>
  creditRow(field)?.querySelector('a') ?? null
const tile = (name: string): HTMLElement => tiles().find((t) => t.getAttribute('title') === name)!

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

describe('the panel credits the model’s source', () => {
  // Scoped to this describe, not the file: `mountApp` stubs global `URL`, and
  // the `hostLabel` cells below need the real one.
  beforeEach(async () => {
    await mountApp('/models', NESTED)
    listDir.mockResolvedValue(NESTED)
  })
  afterEach(async () => {
    await unmountApp()
  })

  it('draws author, license and source from the resolved credits', async () => {
    overrides.mockResolvedValue({ credits: CREDITS })
    await openLightbox('Alpha/found.stl')

    expect(creditRows()).toEqual(['author', 'license', 'source'])
    expect(creditValue('author')!.textContent).toBe('Valandar')
    expect(creditLink('author')!.getAttribute('href')).toBe(CREDITS.authorUrl)
    expect(creditValue('license')!.textContent).toBe('Creative Commons - Attribution')
    // The source link's `href` is the stored URL verbatim; what it *reads* as is
    // `hostLabel`'s business, pinned in its own describe below (the harness
    // stubs global `URL` for object URLs, so `new URL` cannot construct here and
    // the label falls back to the whole string — which is the fallback working,
    // not the host rule). The full URL is on the title either way.
    expect(creditLink('source')!.getAttribute('href')).toBe(CREDITS.sourceUrl)
    expect(creditLink('source')!.getAttribute('title')).toBe(CREDITS.sourceUrl)

    // Both links leave for another site, so neither may take the live session
    // with it: `_blank`, and `noreferrer` (which implies `noopener`).
    for (const a of [creditLink('author')!, creditLink('source')!]) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toBe('noreferrer')
    }
  })

  it('sits among the metadata and before the actions', async () => {
    // The "describes before it offers" rule, asserted structurally rather than
    // by pixels: the rows are children of the metadata list itself, and that
    // list precedes every affordance the panel carries.
    overrides.mockResolvedValue({ credits: CREDITS })
    await openLightbox('Alpha/found.stl')

    const meta = document.querySelector('dl')!
    for (const field of ['author', 'license', 'source']) {
      expect(creditRow(field)!.parentElement).toBe(meta)
    }
    // 4 is DOCUMENT_POSITION_FOLLOWING — the action strip comes after the rows.
    expect(creditRow('author')!.compareDocumentPosition(actionRow()!) & 4).toBe(4)
    // And they are one column, not two disjoint ones: the strip is the panel's
    // child like the list is.
    expect(actionRow()!.parentElement).toBe(meta.parentElement)
  })

  it('names an author with no stored URL in plain text', async () => {
    // A partial credit is still a true one — the corpus metadata does not
    // always carry all four fields, and a name is a credit without a link.
    overrides.mockResolvedValue({ credits: { author: 'Valandar', license: 'CC-BY' } })
    await openLightbox('Alpha/found.stl')

    expect(creditRows()).toEqual(['author', 'license'])
    expect(creditValue('author')!.textContent).toBe('Valandar')
    expect(creditLink('author')).toBeNull()
  })

  it('shows nothing for a model no key covers', async () => {
    // The default answer of a library with no store. No block and no
    // placeholder: attribution is displayed where it exists, never advertised
    // as missing.
    await openLightbox('Alpha/found.stl')

    expect(dialog()).not.toBeNull()
    expect(creditRows()).toEqual([])
  })

  it('renders a failed read exactly as an uncredited model, and disturbs nothing else', async () => {
    // Absent and failed are one picture by requirement (D4), so the assertion
    // is the two panels' own markup compared against each other rather than two
    // hand-written expectations that could drift apart.
    await openLightbox('Alpha/found.stl')
    const uncredited = panel()!.innerHTML
    await unmountApp()

    await mountApp('/models', NESTED)
    listDir.mockResolvedValue(NESTED)
    overrides.mockRejectedValue(new Error('503 unconfigured'))
    await openLightbox('Alpha/found.stl')

    expect(panel()!.innerHTML).toBe(uncredited)
    // Nothing else in the viewer noticed: the model is open, the actions are
    // offered, and no error line was raised anywhere.
    expect(dialog()).not.toBeNull()
    expect(actionRow()).not.toBeNull()
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(container.querySelector('header p.text-red-400')).toBeNull()
  })

  it('drops an answer for a subject the viewer has left', async () => {
    // The ignore-on-stale half of the read. The first model's answer is held
    // until the panel has moved to the second, then released: it belongs to
    // nobody on screen and must not be drawn under the new model's name.
    let release!: (credits: { credits: OverrideCredits }) => void
    const held = new Promise<{ credits: OverrideCredits }>((r) => {
      release = r
    })
    overrides.mockImplementation((path: string) =>
      path === FOUND ? held : Promise.resolve({}),
    )

    await openLightbox('Alpha/found.stl')
    await openLightbox('Alpha/other.stl')
    release({ credits: CREDITS })
    await settle()

    expect(creditRows()).toEqual([])
    // It is the *second* model that is open — the assertion above would also
    // pass if the panel had closed.
    expect(dialog()).not.toBeNull()
    expect(overrides).toHaveBeenCalledWith(OTHER)
  })

  it('asks through ApiClient, once per lightbox open, and never through fetch', async () => {
    // D1's seam: no raw fetch in a component. The mock class *is* the seam, so
    // a call landing on it is the proof — and a fetch spy is what would catch
    // the component reaching around it.
    const rawFetch = vi.fn()
    vi.stubGlobal('fetch', rawFetch)
    overrides.mockResolvedValue({ credits: CREDITS })

    await openLightbox('Alpha/found.stl')

    expect(overrides.mock.calls).toEqual([[FOUND]])
    expect(rawFetch).not.toHaveBeenCalled()
  })
})

describe('a stored URL reads as its host', () => {
  // No mount here, deliberately: `mountApp` stubs global `URL` for object URLs,
  // and a spread of a class carries no constructor — so `new URL` throws inside
  // a mounted test and this rule could only ever be asserted as its fallback.
  it('drops the scheme, the path and a leading www.', () => {
    expect(hostLabel('https://www.thingiverse.com/thing:3750572')).toBe('thingiverse.com')
    expect(hostLabel('https://cults3d.com/en/3d-model/game/kit')).toBe('cults3d.com')
  })

  it('draws a string it cannot parse verbatim rather than dropping it', () => {
    // Corpus data need not be a URL. A reader can still act on the text; a row
    // that silently is not there credits nobody.
    expect(hostLabel('thingiverse, probably')).toBe('thingiverse, probably')
  })
})
