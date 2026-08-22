// @vitest-environment happy-dom
//
// The pure reducer's own suite: every one of the ten findings the code review
// and the design review confirmed, as a named case, plus the four acceptance
// races. Each of these was one hand-maintained list missing one field, so each
// test asks the reducer the question that list got wrong.
import { describe, expect, it } from 'vitest'
import type { DirEntry, IndexAvailability, IndexPose, SemanticScope } from '../../shared/types'
import { TUNING_DEFAULTS } from '../src/lib/searchOptions'
import { serializeView } from '../src/lib/urlState'
import {
  initialState,
  reducer,
  type Action,
  type Landed,
  type SearchState,
} from '../src/state/reducer'
import { busy, byKind, dest, labelInputs, pendingRequest, stoodIn } from '../src/state/selectors'
import { toUrlView, type Prefs, type View } from '../src/state/view'

const PREFS: Prefs = {
  mode: 'name',
  kinds: 'both',
  folderMatching: true,
  tuning: { ...TUNING_DEFAULTS },
}

const READY: IndexAvailability = { state: 'ready' }
const WARMING: IndexAvailability = { state: 'warming', elapsed: 3 }

const view = (over: Partial<View> = {}): View => ({
  path: '/lib',
  flat: false,
  q: null,
  model: null,
  ...PREFS,
  ...over,
})

const start = (over: Partial<View> = {}, index: IndexAvailability | null = null): SearchState =>
  initialState(view(over), index)

const run = (state: SearchState, ...actions: Action[]): SearchState =>
  actions.reduce(reducer, state)

const entry = (name: string, kind: DirEntry['kind'] = 'model'): DirEntry => ({
  name,
  path: `/lib/${name}`,
  kind,
  size: 1,
  mtime: 1,
})

/**
 * Land what is in flight, the way the effect layer will: the response names
 * the question as it was ASKED — it was captured when the request went out and
 * knows nothing of anything patched since.
 */
const land = (state: SearchState, landed: Landed = { entries: [] }): SearchState => {
  const f = state.inflight
  if (f === null) throw new Error('nothing is in flight')
  return reducer(state, { type: 'landing', id: f.id, forView: f.asked, landed })
}

/** Type the phrase and commit it — the two dispatches a search really is. */
const search = (state: SearchState, text: string): SearchState =>
  run(state, { type: 'queryText', text }, { type: 'submit' })

const urlOf = (state: SearchState): string => serializeView(toUrlView(state.view))

describe('the reducer, finding by finding', () => {
  it('a navigation cancels a deferred meaning query', () => {
    let s = run(start({}, WARMING), { type: 'setMode', mode: 'meaning' })
    s = land(search(s, 'dragon'), { entries: [entry('a.stl')] })
    expect(s.phase).toBe('deferred')

    s = land(reducer(s, { type: 'navigate', path: '/other', prefs: PREFS }))
    expect(s.phase).toBe('idle')
    // The index arriving later must find nothing waiting for it.
    s = reducer(s, { type: 'index', availability: READY })
    expect(pendingRequest(s)).toBeNull()
    expect(s.view.q).toBeNull()
  })

  it('emptying the input cancels a deferred meaning query', () => {
    let s = run(start({}, WARMING), { type: 'setMode', mode: 'meaning' })
    s = land(search(s, 'dragon'), { entries: [entry('a.stl')] })

    s = reducer(s, { type: 'queryText', text: '' })
    expect(s.phase).toBe('idle')
    // It re-issues the ordinary listing rather than leaving the stand-in
    // pretending to be a search.
    expect(pendingRequest(s)).toMatchObject({ kind: 'listing', path: '/lib', q: null })
    s = reducer(land(s), { type: 'index', availability: READY })
    expect(pendingRequest(s)).toBeNull()
  })

  it('a name search cancels a deferred meaning query', () => {
    let s = run(start({}, WARMING), { type: 'setMode', mode: 'meaning' })
    s = land(search(s, 'dragon'), { entries: [entry('a.stl')] })

    s = reducer(s, { type: 'deferredToName' })
    expect(s.phase).toBe('idle')
    expect(pendingRequest(s)).toMatchObject({ kind: 'listing', q: 'dragon', flat: true })
    s = land(s, { entries: [entry('dragon.stl')] })
    expect(s.view.mode).toBe('name')
    // The name results stand: a ready index does not replace them.
    s = reducer(s, { type: 'index', availability: READY })
    expect(pendingRequest(s)).toBeNull()
    expect(labelInputs(s).query).toBe('dragon')
  })

  it('the deferral fires only for the view that made it', () => {
    let s = run(start({ flat: true }, WARMING), { type: 'setMode', mode: 'meaning' })
    s = land(search(s, 'dragon'), { entries: [] })

    s = reducer(s, { type: 'index', availability: READY })
    // For that view's path and options — and only then.
    expect(pendingRequest(s)).toMatchObject({
      kind: 'meaning',
      path: '/lib',
      text: 'dragon',
      tuning: PREFS.tuning,
    })
    expect(s.phase).toBe('idle')
  })

  it('tuning survives the restore compare, and the restore', () => {
    const tuned: View = view({ q: 'dragon', mode: 'meaning', flat: true })
    let s = land(reducer(start({}, READY), { type: 'restore', view: tuned }), { entries: [] })

    // A history entry that differs ONLY in tuning is a different view: the
    // compare that left tuning out made Back change the URL and nothing else,
    // and the restore that left it out ran the old tuning under the new URL.
    const retuned: View = { ...tuned, tuning: { ...TUNING_DEFAULTS, top: 12 } }
    s = reducer(s, { type: 'restore', view: retuned })
    expect(pendingRequest(s)).toMatchObject({ kind: 'meaning', tuning: { top: 12 } })
    s = land(s, { entries: [] })
    expect(s.view.tuning.top).toBe(12)
  })

  it('a stale index is impossible: the corpus decision reads it from state', () => {
    // Nothing is fetched while the probe is out — not even a stand-in: a
    // meaning link's `flat` would walk the whole volume for tiles the meaning
    // results are about to replace.
    let s = run(start({}, null), { type: 'setMode', mode: 'meaning' })
    s = search(s, 'dragon')
    expect(pendingRequest(s)).toBeNull()
    expect(s.phase).toBe('deferred')
    expect(busy(s)).toBe(true)

    // The probe's answer decides, and it is state — there is no closure left
    // holding an older reading of it.
    s = reducer(s, { type: 'index', availability: WARMING })
    expect(pendingRequest(s)).toMatchObject({ kind: 'listing', flat: false })
    s = reducer(land(s, { entries: [entry('a.stl')] }), { type: 'index', availability: READY })
    expect(pendingRequest(s)).toMatchObject({ kind: 'meaning', text: 'dragon' })
  })

  it('every URL-owning transition names the whole view', () => {
    const full: View = {
      ...view({ q: 'dragon', mode: 'meaning', flat: true, kinds: 'models', folderMatching: false }),
      tuning: { ...TUNING_DEFAULTS, top: 12 },
    }
    let s = land(reducer(start({}, READY), { type: 'restore', view: full }), { entries: [] })
    const carriesEverything = (url: string): void => {
      for (const param of ['q=dragon', 'mode=meaning', 'kinds=models', 'nofolders=1', 'top=12']) {
        expect(url).toContain(param)
      }
    }

    // The kind option: a hand-built literal here dropped the tuning.
    s = reducer(s, { type: 'setKinds', kinds: 'models' })
    carriesEverything(urlOf(s))
    // The lightbox: its literal dropped mode, kinds and tuning.
    s = reducer(s, { type: 'modelOpen', path: '/lib/a.stl' })
    carriesEverything(urlOf(s))
    expect(urlOf(s)).toContain('model=')
    // The stale-model drop: only that field is rewritten.
    s = reducer(s, { type: 'modelDrop' })
    carriesEverything(urlOf(s))
    expect(urlOf(s)).not.toContain('model=')

    // The deferred commit: its literal dropped kinds, folder matching and tuning.
    let d = run(start({ kinds: 'models', folderMatching: false }, WARMING), {
      type: 'setTuning',
      tuning: { ...TUNING_DEFAULTS, top: 12 },
      run: false,
    })
    d = search(run(d, { type: 'setMode', mode: 'meaning' }), 'dragon')
    carriesEverything(urlOf(d))
  })

  it('the residue dies with its result', () => {
    const scope: SemanticScope = {
      path: '/lib',
      status: 'partial',
      indexed: 2,
      scanned: 9,
      covers: ['stl'],
    }
    const poses: Record<string, IndexPose> = {
      '/lib/a.stl': {
        up: [0, 1, 0],
        azimuth_zero: [0, 0, 1],
        source: 'index',
        confidence: 1,
        front: null,
      },
    }
    let s = run(start({}, READY), { type: 'setMode', mode: 'meaning' })
    const meaningEntries = [entry('a.stl')]
    s = land(search(s, 'dragon'), {
      entries: meaningEntries,
      scope,
      weak: true,
      capped: true,
      poses,
    })
    expect(labelInputs(s)).toMatchObject({ meaning: true, weak: true, capped: true })
    // Identity is the contract useThumbnails resets on — the result carries
    // the array it was handed rather than a rebuilt one.
    expect(s.result?.entries).toBe(meaningEntries)

    const plain = [entry('b.stl')]
    s = land(reducer(s, { type: 'navigate', path: '/other', prefs: PREFS }), { entries: plain })
    expect(s.result?.scope).toBeUndefined()
    expect(s.result?.poses).toBeUndefined()
    expect(labelInputs(s)).toMatchObject({ meaning: false, weak: false, capped: false })
    expect(s.result?.entries).toBe(plain)
  })

  it('a mode flip while the index is not ready defers instead of substituting', () => {
    let s = land(search(start({}, WARMING), 'dragon'), { entries: [entry('dragon.stl')] })
    expect(s.view.mode).toBe('name')

    s = reducer(s, { type: 'setMode', mode: 'meaning' })
    // The view names the meaning search and the banner explains the wait…
    expect(s.phase).toBe('deferred')
    expect(s.view).toMatchObject({ q: 'dragon', mode: 'meaning' })
    // …rather than a name search running in its place.
    expect(pendingRequest(s)).toMatchObject({ kind: 'listing', q: null, flat: false })
  })

  it('the stand-in listing is nested, whatever flat the deferred URL names', () => {
    const deep: View = view({ q: 'dragon', mode: 'meaning', flat: true })
    const s = reducer(start({}, WARMING), { type: 'restore', view: deep })
    // The URL's flat belongs to the search being deferred; flattening a volume
    // to fill time is the opposite of standing in.
    expect(pendingRequest(s)).toMatchObject({ kind: 'listing', path: '/lib', flat: false, q: null })
    expect(s.view.flat).toBe(true)
  })

  it('the flat toggle survives a search', () => {
    let s = search(start({ flat: false }), 'dragon')
    // The request is flat-shaped because a query is flat-shaped…
    expect(pendingRequest(s)).toMatchObject({ kind: 'listing', q: 'dragon', flat: true })
    // …while the toggle keeps its own state, in the view and in the URL.
    expect(s.inflight?.view.flat).toBe(false)
    s = land(s, { entries: [] })
    expect(s.view.flat).toBe(false)
    // So clearing the query lists nested, the same listing the toggle names.
    s = reducer(s, { type: 'queryText', text: '' })
    expect(pendingRequest(s)).toMatchObject({ kind: 'listing', q: null, flat: false })
  })

  it('navigating re-seeds all four options from the preferences on the action', () => {
    const link: View = {
      ...view({ q: 'dragon', mode: 'meaning', flat: true, kinds: 'models', folderMatching: false }),
      tuning: { ...TUNING_DEFAULTS, top: 12 },
    }
    let s = land(reducer(start({}, READY), { type: 'restore', view: link }), { entries: [] })

    // The recipient's own preferences, all four of them: restoring only two is
    // how a link's mode and tuning outlived the view they belonged to.
    const own: Prefs = {
      mode: 'name',
      kinds: 'folders',
      folderMatching: true,
      tuning: { ...TUNING_DEFAULTS, top: 7 },
    }
    s = reducer(s, { type: 'navigate', path: '/other', prefs: own })
    expect(s.inflight?.view).toMatchObject({ ...own, path: '/other', q: null })
    s = land(s, { entries: [] })
    expect(s.view).toMatchObject({ ...own, path: '/other', q: null })
  })
})

describe('acceptance: one rule for every answer', () => {
  it('rejects a stale answer to an identical question by its id', () => {
    // Value equality alone inverts latest-wins here: the stale answer would be
    // taken, `inflight` cleared, and the fresh one rejected for having nothing
    // to match against.
    const first = search(start(), 'dragon')
    const second = reducer(first, { type: 'submit' })
    expect(second.inflight?.id).not.toBe(first.inflight?.id)

    const stale: Action = {
      type: 'landing',
      id: first.inflight?.id ?? 0,
      forView: first.inflight?.asked ?? view(),
      landed: { entries: [entry('stale.stl')] },
    }
    expect(reducer(second, stale)).toBe(second)
    const fresh = land(second, { entries: [entry('fresh.stl')] })
    expect(fresh.result?.entries.map((e) => e.name)).toEqual(['fresh.stl'])
  })

  it('rejects an answer that names a question other than the one in flight', () => {
    const searching = search(start(), 'dragon')
    const asked = searching.inflight?.asked ?? view()
    const moved = reducer(searching, { type: 'navigate', path: '/other', prefs: PREFS })
    expect(dest(moved)).toBe('/other')

    // By id, for the ordinary case: the search's answer arrives after the
    // navigation superseded it.
    const byId: Action = { type: 'landing', id: 1, forView: asked, landed: { entries: [] } }
    expect(reducer(moved, byId)).toBe(moved)
    // And by `forView`, which can only mean the effect layer tagged an answer
    // with the wrong question — the reducer verifies rather than trusts.
    const byForView: Action = {
      type: 'landing',
      id: moved.inflight?.id ?? 0,
      forView: asked,
      landed: { entries: [entry('wrong.stl')] },
    }
    expect(reducer(moved, byForView)).toBe(moved)
  })

  it('two rapid restores: the first one lands nothing', () => {
    const one = reducer(start(), { type: 'restore', view: view({ path: '/one' }) })
    const two = reducer(one, { type: 'restore', view: view({ path: '/two' }) })
    const stale: Action = {
      type: 'landing',
      id: one.inflight?.id ?? 0,
      forView: one.inflight?.asked ?? view(),
      landed: { entries: [entry('one.stl')] },
    }
    expect(reducer(two, stale)).toBe(two)

    const landed = land(two, { entries: [entry('two.stl')] })
    expect(landed.view.path).toBe('/two')
    // Provenance rides the request and lands on the result: push-vs-replace
    // reads it there, never a shared "restoring" flag.
    expect(landed.result?.source).toBe('restore')
  })

  it('a landing during a fetchless view patch keeps the patched field', () => {
    const searching = search(start(), 'dragon')
    const askedWith = searching.inflight?.asked.kinds
    expect(askedWith).toBe('both')

    // The kind option asks nothing, so it is asserted at dispatch — into the
    // request in flight as well, or this landing would revert it.
    const flipped = reducer(searching, { type: 'setKinds', kinds: 'models' })
    const landed = land(flipped, {
      entries: [entry('a.stl'), entry('sub', 'dir')],
    })

    // Accepted, because acceptance compares the question as ASKED…
    expect(landed.result).not.toBeNull()
    // …while the answer records the question as it now stands.
    expect(landed.result?.forView.kinds).toBe('models')
    expect(landed.view.kinds).toBe('models')
    expect(byKind(landed).map((e) => e.name)).toEqual(['a.stl'])
  })

  it('a fetchless patch after the landing reaches the answer it stands beside', () => {
    // The same sentence as the landing's, for the other side of it: the render
    // reads `result.forView` (R1's corollary), so a patch that stopped at
    // `view` left the kind control inert — the URL said `kinds=models` while
    // the grid went on showing the folders.
    const entries = [entry('a.stl'), entry('sub', 'dir')]
    let s = land(search(start(), 'dragon'), { entries })
    expect(byKind(s).map((e) => e.name)).toEqual(['a.stl', 'sub'])

    s = reducer(s, { type: 'setKinds', kinds: 'models' })
    expect(s.result?.forView.kinds).toBe('models')
    expect(byKind(s).map((e) => e.name)).toEqual(['a.stl'])
    // Wholesale replacement is about `entries` identity — useThumbnails resets
    // every thumb to `loading` when it changes — and a forView-only spread
    // keeps it (R5).
    expect(s.result?.entries).toBe(entries)

    // And the answer keeps standing beside the question: opening a lightbox
    // patches both, so nothing reads as a stand-in that is not one.
    s = reducer(s, { type: 'modelOpen', path: '/lib/a.stl' })
    expect(stoodIn(s)).toBe(false)
  })
})
