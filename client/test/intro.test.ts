// @vitest-environment happy-dom
//
// The introduction's own small pieces (`landing-page` 3.2/3.3): the dismissal
// flag, the surprise action's pick, and the one reducer transition a chip is.
//
// No App here — the app-mount cells live in introBanner/introPlaceholder/
// introStartMode. What is asserted is what those cells cannot see: that the
// flag round-trips through real storage, that `pickExample` is a uniform index
// over the list it is handed, and that `runQuery` reaches a committed meaning
// view in ONE transition, which is the whole reason the action exists.
import { beforeEach, describe, expect, it } from 'vitest'
import type { IndexAvailability } from '../../shared/types'
import { ABOUT_URL, CREDITS_URL, introDismissedStore, pickExample, SOURCE_URL } from '../src/lib/intro'
import { TUNING_DEFAULTS } from '../src/lib/searchOptions'
import { initialState, reducer, type SearchState } from '../src/state/reducer'
import { pendingRequest } from '../src/state/selectors'
import type { Prefs, View } from '../src/state/view'

const READY: IndexAvailability = { state: 'ready', collectionRoot: '/' }
const PREFS: Prefs = {
  mode: 'name',
  kinds: 'both',
  folderMatching: true,
  tuning: { ...TUNING_DEFAULTS },
}
const view = (over: Partial<View> = {}): View => ({
  path: '/',
  flat: false,
  subject: { kind: 'none' },
  model: null,
  ...PREFS,
  ...over,
})
const start = (index: IndexAvailability | null = READY): SearchState =>
  initialState(view(), index)

describe('the dismissal flag', () => {
  beforeEach(() => localStorage.clear())

  it('reads false before anything wrote it, and true after', () => {
    expect(introDismissedStore.read()).toBe(false)
    introDismissedStore.write(true)
    expect(localStorage.getItem('model-browser:intro-dismissed')).toBe('1')
    expect(introDismissedStore.read()).toBe(true)
  })

  it('reads a value it did not write as not dismissed', () => {
    // A hand-edited key degrades to the ordinary setting rather than to an
    // error — `stored`'s rule, asserted here because the parse is this
    // module's own.
    localStorage.setItem('model-browser:intro-dismissed', 'yes please')
    expect(introDismissedStore.read()).toBe(false)
  })
})

describe('pickExample', () => {
  const QUERIES = ['a', 'b', 'c'] as const

  it('is a uniform index over the list it is handed', () => {
    expect(pickExample(QUERIES, () => 0)).toBe('a')
    expect(pickExample(QUERIES, () => 0.34)).toBe('b')
    expect(pickExample(QUERIES, () => 0.99)).toBe('c')
  })

  it('clamps a stub that answers 1, which Math.random never does', () => {
    expect(pickExample(QUERIES, () => 1)).toBe('c')
  })

  it('has nothing to pick from an empty list', () => {
    expect(pickExample([], () => 0)).toBe('')
  })
})

describe("the chip's transition", () => {
  it('is one transition: the draft is set, the mode is meaning, and the query is asked', () => {
    // The point of the action (D4). Two dispatches — `queryText` then `submit`
    // — would need a render between them to carry the draft, which is what a
    // pending ref and an effect would have been for.
    const s = reducer(start(), { type: 'runQuery', text: 'a dragon', mode: 'meaning' })
    expect(s.drafts.queryText).toBe('a dragon')
    expect(s.view.mode).toBe('meaning')
    expect(pendingRequest(s)).toMatchObject({ kind: 'meaning', text: 'a dragon' })
    expect(pendingRequest(s)?.forView.subject).toEqual({ kind: 'query', text: 'a dragon' })
  })

  it('defers exactly as a typed meaning submit does while the index warms', () => {
    // It runs the `submit` body and not a copy of it, so the corpus decision
    // is the shared one: a warming index holds the question rather than
    // substituting a name search.
    const s = reducer(start({ state: 'warming', elapsed: 3 }), {
      type: 'runQuery',
      text: 'a dragon',
      mode: 'meaning',
    })
    expect(s.phase).toEqual({ deferred: 'user' })
    expect(s.view.subject).toEqual({ kind: 'query', text: 'a dragon' })
  })
})

describe('the links', () => {
  it('names the About document by the file the static handler serves', () => {
    // D2: a second Vite entry, not a route — so the extension is part of the
    // address and the credits link is that document's own anchor.
    expect(ABOUT_URL).toBe('/about.html')
    expect(CREDITS_URL).toBe('/about.html#credits')
    expect(SOURCE_URL.startsWith('https://')).toBe(true)
  })
})
