// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { TUNING_DEFAULTS } from '../src/lib/searchOptions'
import { requestOf, type View } from '../src/state/view'
import {
  commitUrl,
  isLightboxEntry,
  LIGHTBOX_ENTRY,
  parseUrl,
  serializeView,
  type UrlView,
} from '../src/lib/urlState'

beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

const roundTrip = (view: UrlView): UrlView => parseUrl(serializeView(view))

describe('url state', () => {
  it('round-trips paths with spaces, unicode, zip separators, and percent signs', () => {
    // URLSearchParams is the single encoder (D1): a path containing `%` is the
    // case a stray encodeURIComponent pass on top would double-encode.
    for (const path of [
      '/run/media/masa/STL Library/Loot Studios/Sandy Dunes',
      '/models/Boîte à outils/pièce.stl',
      '/lib/kit.zip!/inner dir/part v2.stl',
      '/odd/50% infill/½-scale.stl',
    ]) {
      expect(roundTrip({ path, flat: false })).toEqual({
        path,
        flat: false,
        q: undefined,
        model: undefined,
      })
    }
  })

  it('round-trips the full view and omits empty parameters', () => {
    const view: UrlView = { path: '/a', flat: true, q: 'mech gun', model: '/a/kit.zip!/m.stl' }
    // A committed query always names its corpus, so it comes back explicit.
    expect(roundTrip(view)).toEqual({ ...view, mode: 'name' })
    // Omit-empty: flat only when on, blank strings absent rather than empty.
    expect(serializeView({ path: '/a', flat: false })).not.toContain('flat')
    expect(serializeView({ path: '/a', flat: false, q: '', model: '' })).toBe(
      `?${new URLSearchParams({ path: '/a' }).toString()}`,
    )
    expect(serializeView({ flat: false })).toBe('')
  })

  it('parses a bare `flat` key the same as a valued one', () => {
    expect(parseUrl('?path=%2Fa&flat').flat).toBe(true)
    expect(parseUrl('?path=%2Fa&flat=1').flat).toBe(true)
    expect(parseUrl('?path=%2Fa').flat).toBe(false)
  })

  it('the flat param records the toggle; the request shape is derived from the query', () => {
    // The API rejects `q` without `flat=true`, and deep results are flat-shaped
    // regardless of the toggle — but that is the *request's* shape, derived
    // where the request is built. Reading it back into the toggle gave one slot
    // two meanings: a deep-linked search whose query was then cleared listed the
    // whole volume, while a typed one listed nested (design R4).
    expect(parseUrl('?path=%2Fa&q=gear').flat).toBe(false)
    expect(parseUrl('?path=%2Fa&flat=1&q=gear').flat).toBe(true) // old links still parse
    const searched: View = {
      path: '/a',
      flat: false,
      subject: { kind: 'query', text: 'gear' },
      mode: 'name',
      kinds: 'both',
      folderMatching: true,
      tuning: { ...TUNING_DEFAULTS },
      model: null,
    }
    // A flat-less search view still issues `flat: true` to the API…
    expect(requestOf(searched)).toMatchObject({ kind: 'listing', q: 'gear', flat: true })
    // …and the toggle it never asserted survives to the listing left behind.
    expect(requestOf({ ...searched, subject: { kind: 'none' } })).toMatchObject({
      q: null,
      flat: false,
    })
    // A blank query is no query, and cannot switch flat on by itself.
    expect(parseUrl('?path=%2Fa&q=')).toEqual({
      path: '/a',
      flat: false,
      q: undefined,
      model: undefined,
    })
  })

  it('marks the entries a lightbox push mints, and only those', () => {
    commitUrl({ path: '/a', flat: false })
    expect(isLightboxEntry()).toBe(false)
    commitUrl({ path: '/a', flat: false, model: '/a/m.stl' }, { state: LIGHTBOX_ENTRY })
    expect(isLightboxEntry()).toBe(true)
    // The marker rides the entry, so it outlives any in-memory flag.
    expect(window.history.state).toEqual({ lightbox: true })
  })

  it('pushes only on difference: a re-commit of the same view stacks nothing', () => {
    const before = window.history.length
    commitUrl({ path: '/a', flat: false })
    expect(window.history.length).toBe(before + 1)
    expect(parseUrl()).toEqual({ path: '/a', flat: false, q: undefined, model: undefined })

    commitUrl({ path: '/a', flat: false }) // same view — must not stack
    expect(window.history.length).toBe(before + 1)

    commitUrl({ path: '/a', flat: true }) // different — pushes
    expect(window.history.length).toBe(before + 2)
  })

  it('replace rewrites the current entry without growing history', () => {
    commitUrl({ path: '/a', flat: false })
    const len = window.history.length
    commitUrl({ path: '/a', flat: false, q: 'gear' }, { replace: true })
    expect(window.history.length).toBe(len)
    expect(parseUrl().q).toBe('gear')
  })
})

describe('search options in the URL', () => {
  it('omits both at their defaults — an ordinary search URL is unchanged', () => {
    // The corpus is always named — see 'every search names its corpus'. The
    // other options still omit at their defaults, which is what this pins.
    expect(serializeView({ path: '/m', flat: true, q: 'dragon' })).toBe(
      '?path=%2Fm&flat=1&q=dragon&mode=name',
    )
  })

  it('carries them when they are not the default', () => {
    expect(
      serializeView({ path: '/m', flat: true, q: 'dragon', folderMatching: false, kinds: 'models' }),
    ).toBe('?path=%2Fm&flat=1&q=dragon&nofolders=1&kinds=models&mode=name')
  })

  it('round-trips without a second encoding pass', () => {
    const view = { path: '/a b/c.zip!/d', flat: true, q: 'x y', folderMatching: false, kinds: 'folders' as const }
    expect(parseUrl(serializeView(view))).toEqual({ ...view, mode: 'name', model: undefined })
  })

  it('a similarity view names its model and none of the options it cannot read', () => {
    // The gate is one sentence now: an option is written only when the view's
    // subject reads it. A similarity subject reads none of them — the index
    // answers with models, and there is no phrase to tune or restrict — so the
    // source model really is the whole of what the view contains.
    const similar: UrlView = {
      path: '/a',
      flat: true,
      similar: '/a/m.stl',
      q: 'gear',
      mode: 'meaning',
      kinds: 'models',
      folderMatching: false,
      tuning: { ...TUNING_DEFAULTS, top: 12 },
    }
    expect(serializeView(similar)).toBe('?path=%2Fa&flat=1&similar=%2Fa%2Fm.stl')
  })

  it('a hand-edited link carrying both q and similar parses as both; similar is what wins', () => {
    // The parser is the permissive half by design: it reports every param it
    // knows and lets `resolveView` decide, where the parameter naming a subject
    // is the more specific one. The serializer is the strict half, so the stray
    // rides in the address bar unread rather than being read as a search.
    const both = parseUrl('?path=%2Fa&q=gear&similar=%2Fa%2Fm.stl')
    expect(both.similar).toBe('/a/m.stl')
    expect(both.q).toBe('gear')
    expect(serializeView(both)).toBe('?path=%2Fa&similar=%2Fa%2Fm.stl')
  })

  it('an unrecognised kinds reads as the default rather than an error', () => {
    expect(parseUrl('?path=/m&flat=1&q=a&kinds=sideways').kinds).toBeUndefined()
  })

  it('a re-submitted meaning view stacks nothing, though its tuning is spelled out', () => {
    // The regression: `parseUrl` leaves tuning left at its defaults undefined,
    // while a committer passes the full defaults object. Compared field by
    // field those never matched, so every re-submit of an unchanged meaning
    // search pushed a duplicate entry and Back landed on the same view.
    const view: UrlView = {
      path: '/m',
      flat: true,
      q: 'dragon',
      mode: 'meaning',
      tuning: { ...TUNING_DEFAULTS },
    }
    commitUrl(view)
    const len = window.history.length
    // The URL says nothing about tuning, because none of it is off default.
    expect(window.location.search).toBe('?path=%2Fm&flat=1&q=dragon&mode=meaning')
    commitUrl(view)
    commitUrl({ ...view, tuning: { ...TUNING_DEFAULTS } })
    expect(window.history.length).toBe(len)
    // A tuning change is still a different view, and still pushes.
    commitUrl({ ...view, tuning: { ...TUNING_DEFAULTS, top: 12 } })
    expect(window.history.length).toBe(len + 1)
  })

  it('an option the mode cannot use stays out of the URL', () => {
    // The report: sticky options leaked into URLs of modes that cannot read
    // them — `?q=almenhier&mode=name&pool=max&top=120` (a name search naming a
    // meaning question) and `?q=almenhier&kinds=models&mode=meaning` (a meaning
    // search naming a restriction the index cannot express, since it answers
    // with models and nothing else). The panel hides each control outside its
    // mode; the URL now agrees.
    const nameWithTuning: UrlView = {
      path: '/m',
      flat: true,
      q: 'almenhier',
      mode: 'name',
      kinds: 'models',
      tuning: { ...TUNING_DEFAULTS, pool: 'max', top: 120, raw: true, minScore: 0.4 },
    }
    const nameUrl = serializeView(nameWithTuning)
    expect(nameUrl).toBe('?path=%2Fm&flat=1&q=almenhier&kinds=models&mode=name')
    for (const leak of ['pool', 'top=', 'score-raw', 'min=']) expect(nameUrl).not.toContain(leak)

    const meaningWithKinds: UrlView = {
      path: '/m',
      flat: true,
      q: 'almenhier',
      mode: 'meaning',
      kinds: 'models',
      folderMatching: false,
      tuning: { ...TUNING_DEFAULTS, pool: 'max' },
    }
    const meaningUrl = serializeView(meaningWithKinds)
    expect(meaningUrl).toBe('?path=%2Fm&flat=1&q=almenhier&mode=meaning&pool=max')
    for (const leak of ['kinds', 'nofolders']) expect(meaningUrl).not.toContain(leak)
  })

  it('a view is the same view as its clean counterpart when only the unread options differ', () => {
    // The knock-on: identical views serialized differently, so `commitUrl`'s
    // dedupe saw a difference where there is none and Back walked entries that
    // change nothing on screen.
    const clean: UrlView = { path: '/m', flat: true, q: 'almenhier', mode: 'name', kinds: 'models' }
    commitUrl(clean)
    const len = window.history.length
    commitUrl({ ...clean, tuning: { ...TUNING_DEFAULTS, pool: 'max', top: 120 } })
    expect(window.history.length).toBe(len)

    const meaning: UrlView = { path: '/m', flat: true, q: 'almenhier', mode: 'meaning' }
    commitUrl(meaning)
    const after = window.history.length
    commitUrl({ ...meaning, kinds: 'models', folderMatching: false })
    expect(window.history.length).toBe(after)
  })

  it('absent options are absent, not false', () => {
    const v = parseUrl('?path=/m&flat=1&q=a')
    expect(v.folderMatching).toBeUndefined()
    expect(v.kinds).toBeUndefined()
  })
})
