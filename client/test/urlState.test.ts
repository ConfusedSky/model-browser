// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
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

  it('a query implies flat: a trimmed link that lost the flag must not 400', () => {
    // The API rejects `q` without `flat=true`, and deep results are flat-shaped
    // regardless of the toggle — so `?path=…&q=…` is honored, not sent as-is.
    expect(parseUrl('?path=%2Fa&q=gear').flat).toBe(true)
    expect(parseUrl('?path=%2Fa&flat=1&q=gear').flat).toBe(true)
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

  it('an unrecognised kinds reads as the default rather than an error', () => {
    expect(parseUrl('?path=/m&flat=1&q=a&kinds=sideways').kinds).toBeUndefined()
  })

  it('absent options are absent, not false', () => {
    const v = parseUrl('?path=/m&flat=1&q=a')
    expect(v.folderMatching).toBeUndefined()
    expect(v.kinds).toBeUndefined()
  })
})
