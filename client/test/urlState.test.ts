// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { commitUrl, parseUrl, serializeView, type UrlView } from '../src/lib/urlState'

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
    expect(roundTrip(view)).toEqual(view)
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
