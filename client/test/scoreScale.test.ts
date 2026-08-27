import { describe, expect, it } from 'vitest'
import type { Subject } from '../src/state/view'
import { scaleOf } from '../src/lib/scoreScale'

const QUERY: Subject = { kind: 'query', text: 'a dragon' }
const SIMILAR: Subject = { kind: 'similar', model: '/models/hero.stl', k: 16 }
const NONE: Subject = { kind: 'none' }

describe('scaleOf', () => {
  it('labels a meaning search `k` and a similarity view `sim`', () => {
    expect(scaleOf(QUERY, true)).toBe('k')
    expect(scaleOf(SIMILAR, false)).toBe('sim')
  })

  it('gives a NAME search no scale, though its subject is a query too', () => {
    // The one that is easy to get wrong, and was. `Subject.kind === 'query'` is
    // a committed *phrase*, of either corpus — `mode` is a separate `View`
    // field — so asking the subject alone labels a plain name search `k`. It
    // scores nothing and must be labelled as nothing.
    //
    // Nothing rendered even when this was wrong, because a name landing carries
    // no `scores` and the empty map drew no badge. That made the empty map the
    // real guard and "unlabelled is unrendered" merely true by accident. This
    // asserts the property directly, where it cannot be masked.
    expect(scaleOf(QUERY, false)).toBeNull()
  })

  it('gives a plain listing no scale', () => {
    expect(scaleOf(NONE, false)).toBeNull()
    // A deferred meaning query renders a stand-in listing whose subject is
    // `none`; the flag cannot resurrect a scale the subject does not have.
    expect(scaleOf(NONE, true)).toBeNull()
  })

  it('never lets the flag override a similarity view', () => {
    // `/similar` deliberately sends no `scope`, so `labelInputs` reports
    // `meaning: false` for it. Gating `sim` on the flag would have silently
    // unlabelled every neighbour set.
    expect(scaleOf(SIMILAR, false)).toBe('sim')
    expect(scaleOf(SIMILAR, true)).toBe('sim')
  })
})
