// @vitest-environment happy-dom
//
// The pure reducer's own suite: every one of the ten findings the code review
// and the design review confirmed, as a named case, plus the four acceptance
// races. Each of these was one hand-maintained list missing one field, so each
// test asks the reducer the question that list got wrong.
import { describe, expect, it } from 'vitest'
import type {
  DirEntry,
  IndexAvailability,
  IndexPose,
  IndexScore,
  SemanticScope,
} from '../../shared/types'
import { TUNING_DEFAULTS, type SearchMode, type Tuning } from '../src/lib/searchOptions'
import { serializeView } from '../src/lib/urlState'
import {
  initialState,
  reducer,
  type Action,
  type Landed,
  type SearchState,
} from '../src/state/reducer'
import { busy, byKind, dest, labelInputs, pendingRequest, stoodIn } from '../src/state/selectors'
import { SIMILAR_K, toUrlView, type Prefs, type Subject, type View } from '../src/state/view'

const PREFS: Prefs = {
  mode: 'name',
  kinds: 'both',
  folderMatching: true,
  tuning: { ...TUNING_DEFAULTS },
}

const READY: IndexAvailability = { state: 'ready' }
const WARMING: IndexAvailability = { state: 'warming', elapsed: 3 }

/** The two committed subjects, spelled once so a view literal reads as what it
 *  is about rather than as a union member. */
const asks = (text: string): Subject => ({ kind: 'query', text })
/** A similarity subject at its default parameters unless the case is about
 *  them — `k` and `pool` ride the subject now (6.2), so every literal would
 *  otherwise have to spell out a count it does not care about. */
const like = (model: string, over: { k?: number; pool?: Tuning['pool'] } = {}): Subject => ({
  kind: 'similar',
  model,
  k: over.k ?? SIMILAR_K,
  pool: over.pool,
})

const view = (over: Partial<View> = {}): View => ({
  path: '/lib',
  flat: false,
  subject: { kind: 'none' },
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
    expect(s.phase).toEqual({ deferred: 'user' })

    s = land(reducer(s, { type: 'navigate', path: '/other', prefs: PREFS }))
    expect(s.phase).toBe('idle')
    // The index arriving later must find nothing waiting for it.
    s = reducer(s, { type: 'index', availability: READY })
    expect(pendingRequest(s)).toBeNull()
    expect(s.view.subject).toEqual({ kind: 'none' })
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
    expect(labelInputs(s).subject).toEqual(asks('dragon'))
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
    const tuned: View = view({ subject: asks('dragon'), mode: 'meaning', flat: true })
    let s = land(reducer(start({}, READY), { type: 'restore', view: tuned }), { entries: [] })

    // A history entry that differs ONLY in tuning is a different view: the
    // compare that left tuning out made Back change the URL and nothing else,
    // and the restore that left it out ran the old tuning under the new URL.
    // Count-bound, which is how this was written when a floor made `top` inert
    // and `{...TUNING_DEFAULTS, top: 12}` would have serialized identically to
    // `tuned` and asked the same question, pinning nothing. The bounds compose
    // now, so a count differs under a floor too; the count-only shape is kept
    // because it is the state this test was built around, and it still makes
    // the two views differ.
    const retuned: View = {
      ...tuned,
      tuning: { ...TUNING_DEFAULTS, top: 12, minScore: undefined },
    }
    s = reducer(s, { type: 'restore', view: retuned })
    expect(pendingRequest(s)).toMatchObject({ kind: 'meaning', tuning: { top: 12 } })
    s = land(s, { entries: [] })
    expect(s.view.tuning.top).toBe(12)
  })

  it('a count beneath a floor is the question too, now that they compose', () => {
    // This test used to assert the opposite, and was right to: `top` beneath a
    // floor was the field the index ignored, so two floor-bounded views
    // differing only in it asked the same thing and a restore across them
    // patched rather than refetching a set already on screen. Composition ended
    // that — the count caps what the floor let through — so the same restore
    // must now re-ask, or the grid keeps the old count's results under a URL
    // naming the new one.
    const meaning = view({ subject: asks('dragon'), mode: 'meaning' })
    const s = land(reducer(start({}, READY), { type: 'restore', view: meaning }), {
      entries: [entry('a.stl')],
    })
    const recounted = reducer(s, {
      type: 'restore',
      view: { ...s.view, tuning: { ...s.view.tuning, top: 12 } },
    })
    expect(pendingRequest(recounted)).toMatchObject({ kind: 'meaning', tuning: { top: 12 } })
    // The asserted view deliberately still holds the old count here: a re-ask
    // advances it on landing, not on asking (R2). The request is the claim.
    expect(land(recounted, { entries: [] }).view.tuning.top).toBe(12)

    // Under a count alone it was always the question, and still is.
    const counted: View = { ...s.view, tuning: { ...s.view.tuning, minScore: undefined } }
    const s2 = land(reducer(s, { type: 'restore', view: counted }), { entries: [] })
    const reasked = reducer(s2, {
      type: 'restore',
      view: { ...counted, tuning: { ...counted.tuning, top: 12 } },
    })
    expect(pendingRequest(reasked)).toMatchObject({ kind: 'meaning', tuning: { top: 12 } })

    // What genuinely is not a different question: a bound that is not in force
    // at either end. Two floor-only views carry no count at all, so there is
    // nothing to differ in and the restore still patches.
    const floorOnly: View = { ...s.view, tuning: { ...s.view.tuning, top: undefined } }
    const s3 = land(reducer(s, { type: 'restore', view: floorOnly }), { entries: [] })
    const patched = reducer(s3, { type: 'restore', view: { ...floorOnly, model: null } })
    expect(pendingRequest(patched)).toBeNull()
  })

  it('a restore that asks the same question patches instead of re-asking', () => {
    // Reported 2026-08-21: the kind control itself asks nothing — it selects
    // among entries already landed — but Back across a kinds-only difference
    // re-fetched the whole directory. The compare was over the URL minus the
    // model; `kinds` is request-irrelevant too, so the two must agree.
    const entries = [entry('a.stl'), entry('sub', 'dir')]
    const s = land(search(start(), 'dragon'), { entries })
    expect(byKind(s).map((e) => e.name)).toEqual(['a.stl', 'sub'])

    const back = reducer(s, { type: 'restore', view: { ...s.view, kinds: 'models' } })
    expect(pendingRequest(back)).toBeNull()
    expect(back.lastId).toBe(s.lastId)
    // And it reaches the answer, so the grid re-filters on the spot.
    expect(back.view.kinds).toBe('models')
    expect(byKind(back).map((e) => e.name)).toEqual(['a.stl'])
    expect(back.result?.entries).toBe(entries)
  })

  it('the flat toggle is a question only when nothing is committed', () => {
    // A committed query is flat-shaped whichever way the toggle points (R4),
    // so the toggle's value is not part of what was asked…
    const searching = land(search(start({ flat: false }), 'dragon'), { entries: [] })
    const toggled = reducer(searching, {
      type: 'restore',
      view: { ...searching.view, flat: true },
    })
    expect(pendingRequest(toggled)).toBeNull()
    expect(toggled.view.flat).toBe(true)
    expect(toggled.result?.forView.flat).toBe(true)

    // …while with no query it is the listing's own shape, and must be re-asked.
    const listing = land(
      reducer(start({ flat: false }), { type: 'restore', view: view({ flat: false }) }),
      { entries: [] },
    )
    const deepened = reducer(listing, { type: 'restore', view: { ...listing.view, flat: true } })
    expect(pendingRequest(deepened)).toMatchObject({ kind: 'listing', flat: true, q: null })
  })

  it('a restore that differs only in the open model still patches', () => {
    const s = land(search(start(), 'dragon'), { entries: [entry('a.stl')] })
    const opened = reducer(s, { type: 'restore', view: { ...s.view, model: '/lib/a.stl' } })
    expect(pendingRequest(opened)).toBeNull()
    expect(opened.view.model).toBe('/lib/a.stl')
    expect(stoodIn(opened)).toBe(false)
  })

  it('a stale index is impossible: the corpus decision reads it from state', () => {
    // Nothing is fetched while the probe is out — not even a stand-in: a
    // meaning link's `flat` would walk the whole volume for tiles the meaning
    // results are about to replace.
    let s = run(start({}, null), { type: 'setMode', mode: 'meaning' })
    s = search(s, 'dragon')
    expect(pendingRequest(s)).toBeNull()
    expect(s.phase).toEqual({ deferred: 'user' })
    expect(busy(s)).toBe(true)

    // The probe's answer decides, and it is state — there is no closure left
    // holding an older reading of it.
    s = reducer(s, { type: 'index', availability: WARMING })
    expect(pendingRequest(s)).toMatchObject({ kind: 'listing', flat: false })
    s = reducer(land(s, { entries: [entry('a.stl')] }), { type: 'index', availability: READY })
    expect(pendingRequest(s)).toMatchObject({ kind: 'meaning', text: 'dragon' })
  })

  it('every URL-owning transition names the whole view — its own mode’s half of it', () => {
    // The whole view, held off-default in both halves, so a hand-built literal
    // that drops a field is caught. The sweep runs per mode because the URL
    // names only the options its own mode reads: a name search has no tuning to
    // spell out, and a meaning search cannot restrict by kind (the index
    // answers with models and nothing else). Sticky options leaking into the
    // other mode's URL is the user-reported bug this half pins.
    // `minScore: undefined` is the count alone, which under the presence rule
    // is what a view meaning "the best 12, unfloored" records. (When this was
    // written the floor was the *default* bound and clearing it was the only
    // way to make `top` mean anything; both bounds compose and are in force by
    // default now, and a both-bounded view names them both.)
    const tuning = { ...TUNING_DEFAULTS, top: 12, pool: 'max' as const, minScore: undefined }
    const OPTIONS: Record<SearchMode, { carries: string[]; omits: string[] }> = {
      name: {
        carries: ['q=dragon', 'mode=name', 'kinds=models', 'nofolders=1'],
        omits: ['top=', 'pool=', 'score-raw', 'min='],
      },
      meaning: {
        carries: ['q=dragon', 'mode=meaning', 'top=12', 'pool=max'],
        omits: ['kinds=', 'nofolders='],
      },
    }
    const namesItsView = (mode: SearchMode, url: string): void => {
      for (const param of OPTIONS[mode].carries) expect(url).toContain(param)
      for (const param of OPTIONS[mode].omits) expect(url).not.toContain(param)
    }

    for (const mode of ['name', 'meaning'] as const) {
      const full: View = {
        ...view({ subject: asks('dragon'), mode, flat: true, kinds: 'models', folderMatching: false }),
        tuning,
      }
      let s = land(reducer(start({}, READY), { type: 'restore', view: full }), { entries: [] })

      // The kind option: a hand-built literal here dropped the tuning.
      s = reducer(s, { type: 'setKinds', kinds: 'models' })
      namesItsView(mode, urlOf(s))
      // The lightbox: its literal dropped mode, kinds and tuning.
      s = reducer(s, { type: 'modelOpen', path: '/lib/a.stl' })
      namesItsView(mode, urlOf(s))
      expect(urlOf(s)).toContain('model=')
      // The stale-model drop: only that field is rewritten.
      s = reducer(s, { type: 'modelDrop' })
      namesItsView(mode, urlOf(s))
      expect(urlOf(s)).not.toContain('model=')
    }

    // The deferred commit — meaning's alone, since only a meaning query defers:
    // its literal dropped kinds, folder matching and tuning.
    let d = run(start({ kinds: 'models', folderMatching: false }, WARMING), {
      type: 'setTuning',
      tuning,
      run: false,
    })
    d = search(run(d, { type: 'setMode', mode: 'meaning' }), 'dragon')
    namesItsView('meaning', urlOf(d))
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
    const scores: Record<string, IndexScore> = { '/lib/a.stl': { score: 0.107, z: 3.9 } }
    let s = run(start({}, READY), { type: 'setMode', mode: 'meaning' })
    const meaningEntries = [entry('a.stl')]
    s = land(search(s, 'dragon'), {
      entries: meaningEntries,
      scope,
      weak: true,
      capped: true,
      poses,
      scores,
    })
    expect(labelInputs(s)).toMatchObject({ meaning: true, weak: true, capped: true })
    // Carried onto the result by identity, like the entries below it — the map
    // the landing was handed, not a rebuilt one, so a tile's badge prop is the
    // same object across re-renders and the grid's memo holds.
    expect(s.result?.scores).toBe(scores)
    // Identity is the contract useThumbnails resets on — the result carries
    // the array it was handed rather than a rebuilt one.
    expect(s.result?.entries).toBe(meaningEntries)

    const plain = [entry('b.stl')]
    s = land(reducer(s, { type: 'navigate', path: '/other', prefs: PREFS }), { entries: plain })
    expect(s.result?.scope).toBeUndefined()
    expect(s.result?.poses).toBeUndefined()
    // A landing replaces the whole result (R5), so an unscored answer leaves no
    // stale numbers behind for the grid to key a badge off.
    expect(s.result?.scores).toBeUndefined()
    expect(labelInputs(s)).toMatchObject({ meaning: false, weak: false, capped: false })
    expect(s.result?.entries).toBe(plain)
  })

  it('a mode flip while the index is not ready defers instead of substituting', () => {
    let s = land(search(start({}, WARMING), 'dragon'), { entries: [entry('dragon.stl')] })
    expect(s.view.mode).toBe('name')

    s = reducer(s, { type: 'setMode', mode: 'meaning' })
    // The view names the meaning search and the banner explains the wait…
    expect(s.phase).toEqual({ deferred: 'user' })
    expect(s.view).toMatchObject({ subject: asks('dragon'), mode: 'meaning' })
    // …rather than a name search running in its place.
    expect(pendingRequest(s)).toMatchObject({ kind: 'listing', q: null, flat: false })
  })

  it('the stand-in listing is nested, whatever flat the deferred URL names', () => {
    const deep: View = view({ subject: asks('dragon'), mode: 'meaning', flat: true })
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
      ...view({ subject: asks('dragon'), mode: 'meaning', flat: true, kinds: 'models', folderMatching: false }),
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
    expect(s.inflight?.view).toMatchObject({ ...own, path: '/other', subject: { kind: 'none' } })
    s = land(s, { entries: [] })
    expect(s.view).toMatchObject({ ...own, path: '/other', subject: { kind: 'none' } })
  })
  it('a deferral fires under the provenance that made it', () => {
    // A restored deferral resumes a restoration: the entry the link already
    // sits on is the one the answer belongs to, so the fire must replace it.
    // Hardcoding 'user' here pushed a second entry over a deep link whose URL
    // was not already byte-identical to what the serializer writes — every
    // link written before an option's gate existed, for one — turning a wait
    // for the index into a Back that goes nowhere.
    let s = run(start({}, WARMING), {
      type: 'restore',
      view: view({ subject: asks('dragon'), mode: 'meaning' }),
    })
    expect(s.phase).toEqual({ deferred: 'restore' })
    s = reducer(s, { type: 'index', availability: READY })
    expect(s.inflight).toMatchObject({ source: 'restore' })

    // …and a deferral the user typed still pushes.
    let u = run(start({}, WARMING), { type: 'setMode', mode: 'meaning' })
    u = search(u, 'dragon')
    expect(u.phase).toEqual({ deferred: 'user' })
    u = reducer(u, { type: 'index', availability: READY })
    expect(u.inflight).toMatchObject({ source: 'user' })
  })

  it('a stand-in that fails stops the app owing an answer', () => {
    // Nothing is in flight afterwards, so nothing was going to clear the debt:
    // `busy` drives the skeleton, and the skeleton replaces the grid — the
    // error, the banner and the "search names instead" way out all sat behind
    // a spinner that would never stop.
    let s = run(start({}, WARMING), { type: 'setMode', mode: 'meaning' })
    s = search(s, 'dragon')
    const f = s.inflight
    if (f === null) throw new Error('the stand-in should be in flight')
    s = reducer(s, { type: 'failure', id: f.id, forView: f.asked, message: 'boom' })

    expect(s.inflight).toBeNull()
    expect(s.phase).toEqual({ deferred: 'user' })
    expect(s.failure?.message).toBe('boom')
    expect(busy(s)).toBe(false)
  })

  it('a fresh deferral does not inherit the last question\'s failure', () => {
    // Otherwise `busy` reads a stale message as this deferral's own answer and
    // the wait renders as a finished, failed one.
    let s = start({}, WARMING)
    s = reducer(s, { type: 'navigate', path: '/gone', prefs: PREFS })
    const f = s.inflight
    if (f === null) throw new Error('the listing should be in flight')
    s = reducer(s, { type: 'failure', id: f.id, forView: f.asked, message: 'boom' })
    expect(s.failure).not.toBeNull()

    s = run(s, { type: 'setMode', mode: 'meaning' })
    s = search(s, 'dragon')
    expect(s.failure).toBeNull()
    expect(busy(s)).toBe(true)
  })
  it('a Back onto the answer on screen drops the error that was not about it', () => {
    // The failure belonged to the question the user left. Backing onto a view
    // whose answer is already up patches rather than re-asks, so nothing was
    // going to land and clear it: the grid showed /lib while the path bar went
    // on reporting the folder that failed, for the rest of the session.
    let s = land(reducer(start(), { type: 'restore', view: view() }), {
      entries: [entry('a.stl')],
    })
    const here = s.view
    s = reducer(s, { type: 'navigate', path: '/gone', prefs: PREFS })
    const f = s.inflight
    if (f === null) throw new Error('the listing should be in flight')
    s = reducer(s, { type: 'failure', id: f.id, forView: f.asked, message: 'boom' })
    expect(s.failure?.message).toBe('boom')

    s = reducer(s, { type: 'restore', view: { ...here, model: '/lib/a.stl' } })
    expect(s.failure).toBeNull()
    // …and it really was the patch branch: nothing was re-asked.
    expect(s.inflight).toBeNull()
    expect(s.view.model).toBe('/lib/a.stl')
  })

  it('the kind option restricts only the mode whose URL names it', () => {
    // `serializeView` gates each option on its mode (7a440aa); the filter has
    // to use the same gate or the two disagree about whether the option is in
    // force. It did: `kinds` is sticky and the panel hides its control outside
    // name mode, so a 'folders' left over from a name search rode into a
    // meaning view and emptied the grid — over an option with no control to
    // undo it and, once the URL stopped naming it, nothing on screen to explain
    // it.
    const v = view({ subject: asks('dragon'), mode: 'meaning', kinds: 'folders' })
    let s = land(run(start({}, READY), { type: 'restore', view: v }), {
      entries: [entry('a.stl'), entry('b.stl')],
    })
    expect(urlOf(s)).not.toContain('kinds')
    expect(byKind(s)).toHaveLength(2)

    // Under the mode that does name it, it restricts as it always did.
    const named = view({ subject: asks('dragon'), mode: 'name', kinds: 'folders' })
    let n = land(run(start({}, READY), { type: 'restore', view: named }), {
      entries: [entry('a.stl'), entry('sets', 'dir')],
    })
    expect(urlOf(n)).toContain('kinds=folders')
    expect(byKind(n).map((e) => e.name)).toEqual(['sets'])
  })
})

/**
 * The subject (design D4): the view is *about* nothing, a phrase, or a model.
 * One slot, so a transition assigns rather than remembering which of two
 * nullable fields to clear — these cases ask the questions two fields would
 * have got wrong, and the ones the third kind of subject asks for the first
 * time.
 */
describe('the view has a subject', () => {
  it('a similarity subject and a query subject replace each other', () => {
    let s = land(search(start({}, READY), 'dragon'), { entries: [entry('a.stl')] })
    expect(s.view.subject).toEqual(asks('dragon'))

    s = reducer(s, { type: 'similar', model: '/lib/a.stl' })
    expect(pendingRequest(s)).toMatchObject({
      kind: 'similar',
      path: '/lib',
      model: '/lib/a.stl',
      k: SIMILAR_K,
    })
    s = land(s, { entries: [entry('b.stl')] })
    // One slot: the phrase is gone rather than merely outranked, so nothing on
    // screen or in the URL can claim the view is still about it.
    expect(s.view.subject).toEqual(like('/lib/a.stl'))
    expect(urlOf(s)).toContain('similar=')
    expect(urlOf(s)).not.toContain('q=')

    s = land(search(s, 'gear'), { entries: [] })
    expect(s.view.subject).toEqual(asks('gear'))
    expect(urlOf(s)).toContain('q=gear')
    expect(urlOf(s)).not.toContain('similar=')
  })

  it('a similarity deep link waits, stands in nested, and fires under its own provenance', () => {
    const link: View = view({ path: '/lib/sub', subject: like('/lib/a.stl'), flat: true })
    let s = reducer(start({ path: '/lib/sub' }, null), { type: 'restore', view: link })
    // Nothing is fetched while the probe is out — not even a stand-in, for the
    // same reason a meaning link fetches nothing there.
    expect(pendingRequest(s)).toBeNull()
    expect(s.phase).toEqual({ deferred: 'restore' })
    expect(busy(s)).toBe(true)

    // Not-ready: the location's own contents, nested, whatever `flat` the link
    // named — that toggle belongs to the question being held.
    s = reducer(s, { type: 'index', availability: WARMING })
    expect(pendingRequest(s)).toMatchObject({
      kind: 'listing',
      path: '/lib/sub',
      flat: false,
      q: null,
    })
    s = land(s, { entries: [entry('c.stl')] })
    expect(stoodIn(s)).toBe(true)
    expect(s.view.subject).toEqual(like('/lib/a.stl'))

    // Ready: the link finally doing what it named, as a *restoration* — the
    // fire is that original asking resumed, so it replaces the entry the link
    // already sits on rather than pushing a second one over it.
    s = reducer(s, { type: 'index', availability: READY })
    expect(pendingRequest(s)).toMatchObject({
      kind: 'similar',
      path: '/lib/sub',
      model: '/lib/a.stl',
    })
    expect(s.inflight).toMatchObject({ source: 'restore' })
    expect(s.phase).toBe('idle')
  })

  it('clearSubject leaves both kinds of subject by the one rule', () => {
    for (const subject of [asks('dragon'), like('/lib/a.stl')]) {
      let s = land(
        reducer(start({}, READY), { type: 'restore', view: view({ subject, flat: true }) }),
        { entries: [entry('a.stl')] },
      )
      expect(s.view.subject).toEqual(subject)

      s = reducer(s, { type: 'clearSubject' })
      // The listing left behind is the one the flat toggle names (R4) — the
      // same exit, whether what is being left is a phrase or a model.
      expect(pendingRequest(s)).toMatchObject({
        kind: 'listing',
        path: '/lib',
        flat: true,
        q: null,
      })
      s = land(s, { entries: [] })
      expect(s.view.subject).toEqual({ kind: 'none' })
      expect(urlOf(s)).not.toContain('q=')
      expect(urlOf(s)).not.toContain('similar=')
    }

    // And it ends a deferral on the way through, so there is no held question
    // left to fire once the index answers.
    let d = reducer(start({}, WARMING), {
      type: 'restore',
      view: view({ subject: like('/lib/a.stl') }),
    })
    expect(d.phase).toEqual({ deferred: 'restore' })
    d = reducer(d, { type: 'clearSubject' })
    expect(d.phase).toBe('idle')
    d = reducer(land(d), { type: 'index', availability: READY })
    expect(pendingRequest(d)).toBeNull()
  })

  it('emptying the input leaves a similarity view by that same rule', () => {
    // D9: the dismiss control and the empty input are one implementation, not
    // two that resemble each other. Before the subject existed this exit was
    // structurally inert here — it returned early unless a *query* was
    // committed, and a similarity view has no text in the input to empty.
    let s = land(
      reducer(start({}, READY), {
        type: 'restore',
        view: view({ subject: like('/lib/a.stl') }),
      }),
      { entries: [entry('a.stl')] },
    )
    s = run(s, { type: 'queryText', text: 'typed' }, { type: 'queryText', text: '' })
    expect(pendingRequest(s)).toMatchObject({ kind: 'listing', path: '/lib', q: null })
    expect(s.drafts.queryText).toBe('')
    s = land(s, { entries: [] })
    expect(s.view.subject).toEqual({ kind: 'none' })
  })

  it('entering a similarity view empties the draft, and erasing text under one still dismisses', () => {
    // The draft goes with the subject, as it does on a `navigate`. Text left in
    // the input under a similarity view relates to nothing on screen, and
    // erasing it — the natural gesture for a stale box — runs the shared
    // leave-subject rule and destroys the view. Cleared on entry, the input
    // says what is true.
    let s = land(search(start({}, READY), 'dragon'), { entries: [entry('a.stl')] })
    expect(s.drafts.queryText).toBe('dragon')

    s = land(reducer(s, { type: 'similar', model: '/lib/a.stl' }), { entries: [entry('b.stl')] })
    expect(s.drafts.queryText).toBe('')
    expect(s.view.subject).toEqual(like('/lib/a.stl'))

    // …and the delegation keeps a user-visible instance: typing then erasing
    // under a similarity view leaves it by the one rule, exactly as before.
    s = run(s, { type: 'queryText', text: 'typed' }, { type: 'queryText', text: '' })
    expect(pendingRequest(s)).toMatchObject({ kind: 'listing', path: '/lib', q: null })
    s = land(s, { entries: [] })
    expect(s.view.subject).toEqual({ kind: 'none' })
  })

  it('two similarity views of one model at different anchors are two questions', () => {
    const here = view({ subject: like('/lib/a.stl') })
    const there: View = { ...here, path: '/lib/sub' }
    let s = land(reducer(start({}, READY), { type: 'restore', view: here }), {
      entries: [entry('a.stl')],
    })

    // The anchor is in the request for exactly this: without it these two
    // compare equal under `sameQuestion` and take `restore`'s patch branch,
    // which by `patch`'s own rule cannot patch `path` — leaving the path bar,
    // and the listing a dismissal returns to, naming the folder just left.
    s = reducer(s, { type: 'restore', view: there })
    expect(pendingRequest(s)).toMatchObject({
      kind: 'similar',
      path: '/lib/sub',
      model: '/lib/a.stl',
    })
    s = land(s, { entries: [] })
    expect(s.view.path).toBe('/lib/sub')

    // …while a Back that really is the same question still patches, so the
    // anchor did not widen `sameQuestion` into re-asking everything.
    const same = reducer(s, { type: 'restore', view: { ...s.view, model: '/lib/a.stl' } })
    expect(pendingRequest(same)).toBeNull()
    expect(same.view.model).toBe('/lib/a.stl')
  })

  it('the phrase options are the next phrase’s: a similarity view does not re-ask for them', () => {
    // `mode` is the corpus a typed phrase goes to and `nofolders` shapes what
    // the name corpus returns. A similarity view reads neither and names
    // neither, so pressing them records a preference instead of spending a
    // request on a question that did not change.
    let s = land(
      reducer(start({}, READY), {
        type: 'restore',
        view: view({ subject: like('/lib/a.stl') }),
      }),
      { entries: [entry('a.stl')] },
    )
    const id = s.lastId

    s = reducer(s, { type: 'setMode', mode: 'meaning' })
    expect(pendingRequest(s)).toBeNull()
    expect(s.lastId).toBe(id)
    expect(s.view.mode).toBe('meaning')

    s = reducer(s, { type: 'setFolderMatching', on: false })
    expect(pendingRequest(s)).toBeNull()
    expect(s.lastId).toBe(id)
    expect(s.view.folderMatching).toBe(false)

    // And the URL is unmoved, because a similarity view names neither.
    expect(urlOf(s)).not.toContain('mode=')
    expect(urlOf(s)).not.toContain('nofolders=')
  })

  it('a similarity URL names the model, the place and the toggle — and nothing else', () => {
    const full: View = {
      ...view({
        subject: like('/lib/a.stl'),
        flat: true,
        mode: 'meaning',
        kinds: 'models',
        folderMatching: false,
      }),
      tuning: { ...TUNING_DEFAULTS, top: 12, pool: 'max' },
    }
    const s = land(reducer(start({}, READY), { type: 'restore', view: full }), { entries: [] })
    const url = urlOf(s)
    expect(url).toContain('path=%2Flib')
    expect(url).toContain('flat=1')
    expect(url).toContain('similar=%2Flib%2Fa.stl')
    for (const param of ['q=', 'mode=', 'kinds=', 'nofolders=', 'top=', 'pool=', 'min=', 'score-raw']) {
      expect(url).not.toContain(param)
    }

    // So two similarity views differing only in options neither of them reads
    // are one view under `sameView`, and mint no history entry going nowhere.
    const other: View = { ...full, kinds: 'folders', mode: 'name', tuning: { ...TUNING_DEFAULTS } }
    expect(serializeView(toUrlView(other))).toBe(url)
  })

  it('an empty similarity result is an empty answer, not an empty folder', () => {
    // 4.6b's selector half. `labelInputs` reads the subject, so a similarity
    // result yields something to label the view with and — the part that
    // matters — leaves the "nothing matched" gate truthy when it is empty.
    // Reading a query string there was wrong twice at once: a blank label, and
    // an empty result falling through to Grid's bare "Nothing to show here" as
    // though the folder were the empty thing.
    const empty = land(
      reducer(start({}, READY), {
        type: 'restore',
        view: view({ subject: like('/lib/a.stl') }),
      }),
      { entries: [] },
    )
    expect(labelInputs(empty).subject).toEqual(like('/lib/a.stl'))
    expect(labelInputs(empty).subject.kind).not.toBe('none')
    // The meaning-query residue stays absent rather than reading as `false`:
    // the index reports no `weak` here, and order carries strength (D10).
    expect(labelInputs(empty)).toMatchObject({ meaning: false, weak: false, capped: false })

    // A plain listing is still the other thing, so the gate distinguishes them.
    const listing = land(reducer(start({}, READY), { type: 'restore', view: view() }), {
      entries: [],
    })
    expect(labelInputs(listing).subject.kind).toBe('none')
  })

  it('similarTuning re-asks the view with the new parameters, and is a no-op off one', () => {
    // 6.2. The parameters live on the subject, so changing one is a new
    // question about the same model — routed through the one corpus decision
    // like every other re-ask, not patched into the answer on screen.
    let s = land(
      reducer(start({}, READY), { type: 'restore', view: view({ subject: like('/lib/a.stl') }) }),
      { entries: [entry('b.stl')] },
    )
    expect(pendingRequest(s)).toBeNull()

    s = reducer(s, { type: 'similarTuning', k: 40, pool: 'max' })
    expect(pendingRequest(s)).toMatchObject({
      kind: 'similar',
      path: '/lib',
      model: '/lib/a.stl',
      k: 40,
      pool: 'max',
    })
    s = land(s, { entries: [entry('b.stl'), entry('c.stl')] })
    expect(s.view.subject).toEqual(like('/lib/a.stl', { k: 40, pool: 'max' }))

    // The whole set, never a delta: an omitted pool asserts "leave it to the
    // index" rather than keeping whatever was there.
    s = land(reducer(s, { type: 'similarTuning', k: 40 }), { entries: [] })
    expect(s.view.subject).toEqual(like('/lib/a.stl', { k: 40 }))

    // Off a similarity view there is nothing to re-parameterise, and the
    // control is not on screen. Asserting one anyway would put a `k` in the URL
    // of a view that reads none.
    const searched = land(search(start({}, READY), 'dragon'), { entries: [] })
    expect(reducer(searched, { type: 'similarTuning', k: 40 })).toBe(searched)
    const listing = land(reducer(start({}, READY), { type: 'restore', view: view() }), {
      entries: [],
    })
    expect(reducer(listing, { type: 'similarTuning', k: 40 })).toBe(listing)
  })

  it('a different parameter is a different question: Back across one re-asks', () => {
    // The reason `k` and `pool` are compared in `sameQuestion`. Left out, a
    // Back across a parameter change takes `restore`'s patch branch: the answer
    // on screen kept, while the URL — and the panel's spinner — claim a count
    // the index was never asked for.
    const at16 = view({ subject: like('/lib/a.stl') })
    let s = land(reducer(start({}, READY), { type: 'restore', view: at16 }), {
      entries: [entry('b.stl')],
    })

    const at40: View = { ...at16, subject: like('/lib/a.stl', { k: 40 }) }
    s = reducer(s, { type: 'restore', view: at40 })
    expect(pendingRequest(s)).toMatchObject({ kind: 'similar', k: 40 })
    s = land(s, { entries: [] })

    // Pooling alone is a different question too — same model, same count.
    const pooled: View = { ...at40, subject: like('/lib/a.stl', { k: 40, pool: 'mean' }) }
    s = reducer(s, { type: 'restore', view: pooled })
    expect(pendingRequest(s)).toMatchObject({ kind: 'similar', k: 40, pool: 'mean' })
    s = land(s, { entries: [] })

    // …and a Back that really is the same question still patches, so this did
    // not widen `sameQuestion` into re-asking everything.
    const same = reducer(s, { type: 'restore', view: { ...s.view, model: '/lib/a.stl' } })
    expect(pendingRequest(same)).toBeNull()
    expect(same.view.model).toBe('/lib/a.stl')
  })

  it('the URL carries the two parameters a similarity subject reads, and only off their defaults', () => {
    const plain = land(
      reducer(start({}, READY), { type: 'restore', view: view({ subject: like('/lib/a.stl') }) }),
      { entries: [] },
    )
    // `SIMILAR_K` with no pooling is what an untouched view asks for, so the
    // URL is byte-identical to what a similarity link was before they became
    // settable — making a default explicit never mints a history entry.
    expect(urlOf(plain)).toBe('?path=%2Flib&similar=%2Flib%2Fa.stl')

    const tuned = land(
      reducer(start({}, READY), {
        type: 'restore',
        view: view({ subject: like('/lib/a.stl', { k: 40, pool: 'max' }), kinds: 'models' }),
      }),
      { entries: [] },
    )
    expect(urlOf(tuned)).toContain('k=40')
    expect(urlOf(tuned)).toContain('pool=max')
    // Still none of the phrase options — the gate did not loosen, it grew two
    // options this subject genuinely reads.
    for (const param of ['q=', 'mode=', 'kinds=', 'nofolders=', 'top=', 'min=']) {
      expect(urlOf(tuned)).not.toContain(param)
    }
    // And they are the view's identity: two similarity views of one model at
    // different counts are two views, so Back between them goes somewhere.
    expect(urlOf(tuned)).not.toBe(urlOf(plain))
  })

  it('a deferred similarity view has no phrase to offer the name corpus', () => {
    // The banner's "search names instead" needs a phrase, and there is none —
    // so the offer is absent rather than running an empty search. A deferred
    // *query* still takes it.
    let s = reducer(start({}, WARMING), {
      type: 'restore',
      view: view({ subject: like('/lib/a.stl') }),
    })
    const held = reducer(land(s), { type: 'deferredToName' })
    expect(held.phase).toEqual({ deferred: 'restore' })
    expect(held.view.subject).toEqual(like('/lib/a.stl'))

    s = run(start({}, WARMING), { type: 'setMode', mode: 'meaning' })
    s = reducer(land(search(s, 'dragon')), { type: 'deferredToName' })
    expect(s.phase).toBe('idle')
    expect(pendingRequest(s)).toMatchObject({ kind: 'listing', q: 'dragon' })
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
