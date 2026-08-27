// @vitest-environment happy-dom
//
// A similarity view through App: what it asks for, what it says it is, the one
// way out of it, and the two ways it can fail.
//
// Every case here enters through a link rather than through a menu, and that is
// not a shortcut: the menu that dispatches `similar` is a separate stage, while
// the view itself is reachable, shareable and reloadable by URL by design (D4).
// The dispatch → ask → land → URL chain is pinned from the reducer end in
// searchReducer.test.ts; what these pin is the half that lives in App.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirListing } from '../../shared/types'
import {
  click,
  container,
  dir,
  findInput,
  indexAvailability,
  labels,
  listDir,
  model,
  mountAppAtCurrentUrl,
  openFind,
  pathInput,
  pressEnter,
  searchInput,
  settle,
  similar,
  tiles,
  type,
  unmountApp,
} from './appHarness'
import {
  setSearchKinds,
  setSearchMode,
  setSearchTuning,
  TUNING_DEFAULTS,
} from '../src/lib/searchOptions'
import { SIMILAR_K } from '../src/state/view'

vi.mock('../src/api/client', async () => (await import('./appHarness')).apiClientModule())
vi.mock('../src/three/renderer', async (importOriginal) =>
  (await import('./appHarness')).rendererModule(importOriginal),
)

const NESTED: DirListing = { path: '/models', entries: [dir('Alpha'), model('widget.stl')] }
const HERO = '/models/Kits/Baal/hero.stl'
const LINK = `/?path=/models&similar=${encodeURIComponent(HERO)}`

/** Model-to-model cosines run an order of magnitude above a text query's — the
 *  measurement D10 rested on, and the reason this route's badge says `sim`. */
const BASE_SCORE = { score: 0.9124, z: 4.031 }
const WING_SCORE = { score: 0.8817, z: 2.688 }
const NEIGHBOURS = {
  path: '/models',
  entries: [model('Kits/Baal/base.stl'), model('Kits/Other/wing.stl')],
  poses: {},
  // The anchor is deliberately absent from this map even in `ANCHORED` below:
  // the index excludes the query model from its own ranking rather than
  // scoring it, so there is no number to carry.
  scores: {
    '/models/Kits/Baal/base.stl': BASE_SCORE,
    '/models/Kits/Other/wing.stl': WING_SCORE,
  },
}

/** The same answer with its subject: the model the neighbours were computed
 *  from, which the index never returns among them (it excludes the query model
 *  from its own ranking), so the server adds it beside them.
 *
 *  Its `scores` deliberately DOES carry the anchor's path, which the server
 *  never sends. Without it the anchor has no score to suppress, and the tile's
 *  own anchor guard is untestable — the assertion that it draws no badge passes
 *  whether the guard exists or not. Keying one here is what makes the guard
 *  falsifiable: it is the defence against a future server that keys a score at
 *  the anchor's path, so the test has to supply what that server would. */
const ANCHORED = {
  ...NEIGHBOURS,
  anchor: model('Kits/Baal/hero.stl'),
  scores: {
    ...NEIGHBOURS.scores,
    '/models/Kits/Baal/hero.stl': { score: 1, z: 9.99 },
  },
}

const READY = { state: 'ready', collectionRoot: '/models', covers: ['stl'] }

/** The one dismiss control, wherever the view is about something (D9). */
function dismissButton(): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('main button')).find((b) =>
    b.textContent?.includes('Dismiss'),
  )
}
/** The offer to narrow the results by name — rendered only where there ARE
 *  results, so it is also a reading of what the view counts as one. */
function narrowButton(): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('main button')).find((b) =>
    b.textContent?.includes('Narrow'),
  )
}
function nameButton(): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('main button')).find((b) =>
    b.textContent?.includes('Search names instead'),
  )
}
/** The secondary press, as a browser delivers it — the anchor tile is a model
 *  tile like any other, menu included. */
async function secondaryPress(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 2, buttons: 2, clientX: 9, clientY: 9 }),
    )
    el.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 9, clientY: 9 }),
    )
  })
}
const menuItem = (id: string): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>(`[role="menu"] [data-command="${id}"]`)!

/** An HttpError as `ApiClient` throws it — the status is the contract. */
async function httpError(status: number, message: string): Promise<Error> {
  const { HttpError } = (await import('../src/api/client')) as unknown as {
    HttpError: new (status: number, message: string) => Error
  }
  return new HttpError(status, message)
}

beforeEach(() => {
  localStorage.clear()
  setSearchMode('name')
  setSearchKinds('both')
  setSearchTuning({ ...TUNING_DEFAULTS })
})
afterEach(() => unmountApp())

describe('a similarity view', () => {
  it('asks the index for the model’s neighbours and presents them in place of the listing', async () => {
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()

    // The model, the default count, no pooling of its own, and the abort handle
    // — the last asserted rather than ignored, so a superseded question can be
    // stopped rather than merely dropped on arrival. `undefined` for the pool
    // is the whole of 4.2's rule surviving the parameters becoming settable: a
    // view that made no choice sends none, and the index's own applies.
    expect(similar).toHaveBeenCalledWith(HERO, SIMILAR_K, undefined, expect.any(AbortSignal))
    // No listing was walked for its sake: the neighbours ARE the grid.
    expect(listDir).not.toHaveBeenCalled()
    expect(labels()).toEqual(['base.stl', 'wing.stl'])
    expect(container.textContent).toContain('Models similar to "hero.stl"')
  })

  it('carries none of the meaning query’s residue', async () => {
    // 4.7: the index publishes no `weak` for neighbours at all, so a label
    // rendering `weak: false` would report a measurement that was never taken,
    // and its `scope` dict would make the view read as a meaning search.
    //
    // The per-tile numbers used to be asserted absent here alongside them, on
    // D10's reasoning that order carries strength. They are shown now
    // (confidence-scores-on-tiles) — precisely because this route has no `weak`
    // flag, which left the ranking as everything a reader had. What is residue
    // and what is a fact about a neighbour were two questions under one
    // assertion; this test keeps the first.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()

    expect(container.textContent).not.toContain('Nothing stood out')
    expect(container.textContent).not.toContain('returned fewer than asked for')
    expect(container.textContent).not.toContain('Meaning matches')
  })

  it('names the model, the place and the toggle in the URL — and, when it advances, drops what it never read', async () => {
    // The link end of "a similarity URL carries nothing it does not read": the
    // reader's own options are non-default here and the view names none of
    // them, because none of them selects anything within it. The write half is
    // the dismissal below — the one writer serializes the WHOLE view, so the
    // similarity params leave together with the options that were never in it.
    setSearchMode('meaning')
    setSearchKinds('folders')
    setSearchTuning({ ...TUNING_DEFAULTS, pool: 'max', top: 5 })
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountAppAtCurrentUrl(`${LINK}&flat=1`, NESTED)
    await settle()

    // Still the link's own text: `commitUrl` declines a write the address bar
    // makes redundant, and the reader's options were never in it to be dropped.
    expect(location.search).toContain('similar=')
    expect(location.search).toContain('path=/models')
    expect(location.search).toContain('flat=1')
    for (const param of ['q=', 'mode=', 'kinds=', 'nofolders=', 'top=', 'pool=', 'min=']) {
      expect(location.search).not.toContain(param)
    }

    listDir.mockResolvedValue({ path: '/models', entries: [dir('Alpha')] })
    const before = history.length
    await click(dismissButton()!)
    await settle()

    expect(location.search).not.toContain('similar=')
    for (const param of ['q=', 'mode=', 'kinds=', 'top=', 'pool=']) {
      expect(location.search).not.toContain(param)
    }
    // The toggle is the user's and survives the view it was set on (R4).
    expect(location.search).toContain('flat=1')
    // One entry, so Back returns to the neighbours rather than half-way.
    expect(history.length).toBe(before + 1)
  })

  it('is left by the same one control that leaves a search', async () => {
    // D9's whole point: ONE control, rendered wherever the view is about
    // something, dispatching the one transition emptying the input delegates
    // to. Two controls that resemble each other is the thing it refuses.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(NEIGHBOURS)
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()
    expect(dismissButton()).toBeDefined()

    listDir.mockResolvedValue({ path: '/models', entries: [dir('Alpha')] })
    await click(dismissButton()!)
    await settle()
    expect(labels()).toEqual(['Alpha'])
    // Gone, because there is nothing left to dismiss.
    expect(dismissButton()).toBeUndefined()

    // The same control, over a committed query — the model case is not a
    // second affordance beside a text one.
    listDir.mockResolvedValue({ path: '/models', entries: [model('widget.stl')] })
    await type(searchInput(), 'widget')
    await pressEnter(searchInput())
    await settle()
    expect(dismissButton()).toBeDefined()
    expect(location.search).toContain('q=widget')

    listDir.mockResolvedValue({ path: '/models', entries: [dir('Alpha')] })
    await click(dismissButton()!)
    await settle()
    expect(location.search).not.toContain('q=')
    expect(dismissButton()).toBeUndefined()
  })

  it('an empty answer says what it is, in terms of the model it came from', async () => {
    // 4.6b. Two failures at once before the subject reached these places: a
    // blank label, and an empty result falling through to Grid's bare "Nothing
    // to show here" as though the folder were the empty thing.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue({ ...NEIGHBOURS, entries: [] })
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()

    expect(container.textContent).toContain('Nothing in the collection is similar to "hero.stl"')
    expect(container.textContent).not.toContain('Nothing to show here')
    // Not the phrase sentence with an empty phrase in it, either.
    expect(container.textContent).not.toContain('Nothing matched ""')
    // And still leaveable — an empty view is the one that most needs a way out.
    expect(dismissButton()).toBeDefined()
  })

  it('shows the model the neighbours were computed from, first and marked as the subject', async () => {
    // The comparison is the point of the view, and it cannot be made against a
    // model that is not on screen. The index leaves the query model out of its
    // own ranking, so the anchor arrives beside the entries rather than in them.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(ANCHORED)
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()

    // First, so the eye reads "this, and these are like it" in that order.
    expect(labels()).toEqual(['hero.stl', 'base.stl', 'wing.stl'])
    const [subject, neighbour] = tiles()
    // Visibly the reference rather than a result, in the accessible name too —
    // a ring alone says nothing to a screen reader.
    expect(subject!.textContent).toContain('Compared against')
    expect(subject!.getAttribute('aria-label')).toContain('compared against')
    expect(neighbour!.textContent).not.toContain('Compared against')
    expect(neighbour!.getAttribute('aria-label')).not.toContain('compared against')
  })

  it('labels a neighbour’s cosine `sim`, and leaves the anchor unscored', async () => {
    // D2, the whole answer to D10: the number is raw, and the scale is named.
    // A neighbour cosine of 0.912 sits beside a meaning search's 0.107 in the
    // same grid affordance, and only the label keeps the first from reading as
    // eight times the match — so the label is what this asserts, not just the
    // digits.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(ANCHORED)
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()

    const [subject, neighbour] = tiles()
    // Three places for the cosine, two for the z — and rounded from the
    // fixture's fourth place rather than truncated, which is what `toFixed`
    // buys and a slice would not.
    expect(neighbour!.textContent).toContain('sim 0.912')
    expect(neighbour!.textContent).toContain('z 4.03')
    expect(neighbour!.textContent).not.toContain('k 0.912')
    // The anchor is the question, not an answer, and stays unbadged even when a
    // score IS keyed at its path — `ANCHORED` supplies one (1.000 / 9.99, values
    // no neighbour could reach) precisely so this asserts the tile's guard
    // rather than the fixture's silence.
    expect(subject!.textContent).not.toContain('sim')
    expect(subject!.textContent).not.toMatch(/z \d/)
    expect(subject!.textContent).not.toContain('1.000')
    expect(subject!.textContent).not.toContain('9.99')
  })

  it('announces a neighbour’s numbers with the scale spelled out', async () => {
    // D8. A tile states its accessible name rather than composing it from its
    // contents — the thumbnail is `alt=""` for exactly that reason — so a badge
    // drawn inside the button reaches a screen reader only if the label says
    // it. Spelled out because `sim` read aloud is not a word, and `k` is a
    // letter this app already spends on the neighbour count.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(ANCHORED)
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()

    const [subject, neighbour] = tiles()
    const label = neighbour!.getAttribute('aria-label')!
    expect(label).toContain('similarity 0.912')
    expect(label).toContain('z 4.03')
    // The short form belongs to the corner, which has a reason to be terse.
    expect(label).not.toContain('sim 0.912')
    expect(subject!.getAttribute('aria-label')).not.toContain('similarity 0.912')
  })

  it('an anchor with no neighbours still reads as nothing similar, and is not counted as one', async () => {
    // The anchor is the question made visible; the entries are the answer. A
    // client that counted it would tell the user a model with no neighbours had
    // one — and would say it while showing the model itself as the match.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue({ ...ANCHORED, entries: [] })
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()

    expect(container.textContent).toContain('Nothing in the collection is similar to "hero.stl"')
    // Said with the model on screen above it, not instead of it.
    expect(labels()).toEqual(['hero.stl'])
    expect(container.textContent).not.toContain('Nothing to show here')
    // The offer to narrow the results reads the neighbours, and there are none.
    expect(narrowButton()).toBeUndefined()
  })

  it('asking for the reference’s own neighbours re-asks the same question, and needs no special case', async () => {
    // The anchor is a model tile like any other, so its menu offers find
    // similar on the model the view is already about. What the machinery gives
    // is an identical re-ask — the `similar` transition always asks, and
    // `sameQuestion` guards `restore` rather than this — which is harmless and
    // is pinned here so it stays deliberate: the same request, landing on the
    // same view, so the URL neither changes nor mints a history entry.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(ANCHORED)
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()
    expect(similar).toHaveBeenCalledTimes(1)

    const before = history.length
    await secondaryPress(tiles()[0]!)
    await settle()
    await click(menuItem('findSimilar'))
    await settle()

    expect(similar).toHaveBeenCalledTimes(2)
    expect(similar).toHaveBeenLastCalledWith(HERO, SIMILAR_K, undefined, expect.any(AbortSignal))
    expect(location.search).toContain(`similar=${encodeURIComponent(HERO)}`)
    expect(history.length).toBe(before)
    expect(labels()).toEqual(['hero.stl', 'base.stl', 'wing.stl'])
  })

  it('the find filter narrows the neighbours and never hides the reference', async () => {
    // The filter narrows the answer. The reference is what the answer is about,
    // so a filter that hid it would leave a grid of neighbours with nothing on
    // screen to say what they are near.
    indexAvailability.mockResolvedValue(READY)
    similar.mockResolvedValue(ANCHORED)
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()
    expect(narrowButton()).toBeDefined()

    await openFind()
    await type(findInput()!, 'wing')
    await settle()
    expect(labels()).toEqual(['hero.stl', 'wing.stl'])

    // Even when it matches nothing at all: the reference is exempt, and the
    // sentence is about what the filter did to the neighbours.
    await type(findInput()!, 'zzz')
    await settle()
    expect(labels()).toEqual(['hero.stl'])
    expect(container.textContent).toContain('The filter is hiding everything below')
  })

  it('a deferred similarity view names the model, and its only offer is the dismiss', async () => {
    // 4.6a. Deriving the banner from a query string showed no banner at all
    // here — the one state whose whole purpose is to explain itself. And
    // "search names instead" needs a phrase: there is none, so it is absent
    // rather than running an empty search.
    indexAvailability.mockResolvedValue({ state: 'warming', elapsed: 4 })
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()

    expect(similar).not.toHaveBeenCalled()
    expect(container.textContent).toContain('models similar to')
    expect(container.textContent).toContain('hero.stl')
    expect(container.textContent).toContain('still starting up')
    expect(nameButton()).toBeUndefined()
    // The one control serves the banner too: the view is still about the model
    // even though the grid on screen is the folder standing in for it.
    expect(dismissButton()).toBeDefined()
    // The link keeps naming what it named while it waits.
    expect(location.search).toContain('similar=')
  })

  it('a deferred query still gets its name-corpus offer', async () => {
    // The other half of the same branch: absent for a model is a decision, not
    // the offer having been deleted.
    indexAvailability.mockResolvedValue({ state: 'warming', elapsed: 4 })
    await mountAppAtCurrentUrl('/?path=/models&flat=1&q=demon&mode=meaning', NESTED)
    await settle()
    expect(nameButton()).toBeDefined()
  })

  it('a model the index has not embedded is explained as not indexed yet — without a re-probe', async () => {
    indexAvailability.mockResolvedValue(READY)
    similar.mockRejectedValue(await httpError(404, '/models/Kits/Baal/hero.stl is not in the cache'))
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()

    expect(container.textContent).toContain('has not been indexed yet')
    expect(container.textContent).toContain('run the classifier')
    // The index's own words name a cache the user has never heard of, so the
    // sentence is chosen from the status instead.
    expect(container.textContent).not.toContain('not in the cache')
    // A 404 means the index ANSWERED. Re-probing over it would flash the
    // "index is not there" affordance across a perfectly healthy index. The
    // forced re-read is the only caller passing `fresh` — the ordinary
    // availability effect, which runs at mount, passes nothing — so this is
    // asked of the argument rather than of the call count.
    expect(indexAvailability).toHaveBeenCalled()
    expect(indexAvailability).not.toHaveBeenCalledWith({ fresh: true })
  })

  it('a model inside an archive is a different sentence, and costs no request', async () => {
    // Knowable from the path: the classifier walks real files on disk, and
    // archives are unpacked before it runs, so a `zip!/` vpath is never a key
    // on either side. Borrowing the other sentence would promise that indexing
    // again would help.
    indexAvailability.mockResolvedValue(READY)
    const inZip = '/models/Kits/kit.zip!/parts/lid.stl'
    await mountAppAtCurrentUrl(`/?path=/models&similar=${encodeURIComponent(inZip)}`, NESTED)
    await settle()

    expect(similar).not.toHaveBeenCalled()
    expect(container.textContent).toContain('inside an archive are outside what the index covers')
    expect(container.textContent).not.toContain('has not been indexed yet')
  })

  it('a superseded similarity question is stopped, not merely ignored', async () => {
    indexAvailability.mockResolvedValue(READY)
    let signal: AbortSignal | undefined
    similar.mockImplementation(
      (_m: string, _k: number, _pool: unknown, s: AbortSignal) =>
        new Promise(() => {
          signal = s
        }),
    )
    await mountAppAtCurrentUrl(LINK, NESTED)
    await settle()
    expect(signal?.aborted).toBe(false)

    // Away, the way a user leaves a view they are tired of waiting for.
    listDir.mockResolvedValue({ path: '/models/Alpha', entries: [dir('Beta')] })
    await act(async () => {
      pathInput().focus()
    })
    await type(pathInput(), '/models/Alpha')
    await pressEnter(pathInput())
    await settle()

    expect(signal?.aborted).toBe(true)
    expect(labels()).toEqual(['Beta'])
    expect(location.search).not.toContain('similar=')
  })
})
