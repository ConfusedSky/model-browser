/**
 * The trail — the session mirror of the history stack (`retrace-placement`
 * D2/D3). Every cell hands the module its own in-memory storage.
 */
import { describe, expect, it } from 'vitest'
import { TUNING_DEFAULTS } from '../src/lib/searchOptions'
import {
  TRAIL_CAP,
  TRAIL_KEY,
  listingKey,
  trailPlacement,
  trailPush,
  trailRecord,
  trailReplace,
  trailWalkBack,
  type TrailStorage,
} from '../src/lib/trail'
import { sameListing, type View } from '../src/state/view'

const memory = (): TrailStorage & { map: Map<string, string> } => {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

const view = (over: Partial<View> = {}): View => ({
  path: '/lib',
  flat: false,
  subject: { kind: 'none' },
  model: null,
  mode: 'name',
  kinds: 'both',
  folderMatching: true,
  tuning: { ...TUNING_DEFAULTS },
  ...over,
})

const PARENT = 'path=/lib'
const CHILD = 'path=/lib/kit'
const SEARCH = 'path=/lib&q=dragon'
const AT = { anchor: '/lib/a.stl', offset: -12 }

/** rows 0 parent, 1 child, 2 search, 3 child — the excursion of D3. */
const excursion = (): TrailStorage => {
  const s = memory()
  trailPush(0, PARENT, s)
  trailPush(1, CHILD, s)
  trailPush(2, SEARCH, s)
  trailPush(3, CHILD, s)
  return s
}

describe('listingKey', () => {
  it('is the view minus its model, as sameListing compares', () => {
    const a = view({ model: '/lib/a.stl' })
    const b = view({ model: null })
    expect(sameListing(a, b)).toBe(true)
    expect(listingKey(a)).toBe(listingKey(b))
    expect(listingKey(view({ flat: true }))).not.toBe(listingKey(b))
  })
})

describe('trailPush', () => {
  it('appends, and prunes every row at or above the pushed index', () => {
    const s = memory()
    for (let i = 0; i < 5; i++) trailPush(i, `l${i}`, s)
    trailRecord(2, AT, s)
    trailPush(2, 'fresh', s)
    expect(JSON.parse(s.map.get(TRAIL_KEY) ?? '[]')).toEqual([
      { idx: 0, listing: 'l0', placement: null },
      { idx: 1, listing: 'l1', placement: null },
      { idx: 2, listing: 'fresh', placement: null },
    ])
    expect(trailPlacement(2, s)).toBeNull()
    expect(trailPlacement(4, s)).toBeNull()
  })

  it('caps by dropping the lowest indices', () => {
    const s = memory()
    for (let i = 0; i <= TRAIL_CAP; i++) trailPush(i, `l${i}`, s)
    const rows = JSON.parse(s.map.get(TRAIL_KEY) ?? '[]') as { idx: number }[]
    expect(rows).toHaveLength(TRAIL_CAP)
    expect(rows[0]?.idx).toBe(1)
    expect(rows[rows.length - 1]?.idx).toBe(TRAIL_CAP)
  })
})

describe('trailReplace', () => {
  it('keeps the placement for the same listing and clears it for another', () => {
    const s = memory()
    trailPush(0, PARENT, s)
    trailRecord(0, AT, s)
    trailReplace(0, PARENT, s)
    expect(trailPlacement(0, s)).toEqual(AT)
    trailReplace(0, CHILD, s)
    expect(trailPlacement(0, s)).toBeNull()
    expect(trailWalkBack(1, CHILD, s)?.idx).toBe(0)
  })

  it('seeds an index the trail does not know without pruning above it', () => {
    const s = excursion()
    trailReplace(0, SEARCH, s)
    expect(trailWalkBack(4, CHILD, s)?.idx).toBe(3)
    const s2 = memory()
    trailReplace(0, PARENT, s2)
    expect(trailWalkBack(1, PARENT, s2)?.idx).toBe(0)
  })
})

describe('trailRecord', () => {
  it('files a placement, and clears it with null', () => {
    const s = memory()
    trailPush(0, PARENT, s)
    trailRecord(0, AT, s)
    expect(trailPlacement(0, s)).toEqual(AT)
    trailRecord(0, null, s)
    expect(trailPlacement(0, s)).toBeNull()
  })

  it('ignores an index the trail does not know', () => {
    const s = memory()
    trailPush(0, PARENT, s)
    trailRecord(7, AT, s)
    expect(trailPlacement(7, s)).toBeNull()
    expect(JSON.parse(s.map.get(TRAIL_KEY) ?? '[]')).toHaveLength(1)
  })
})

describe('trailWalkBack', () => {
  it('finds the nearest match below fromIdx, not a later or higher one', () => {
    const s = excursion()
    expect(trailWalkBack(3, PARENT, s)?.idx).toBe(0)
    expect(trailWalkBack(3, CHILD, s)?.idx).toBe(1)
    expect(trailWalkBack(2, CHILD, s)?.idx).toBe(1)
    expect(trailWalkBack(4, CHILD, s)?.idx).toBe(3)
  })

  it('answers null when nothing below matches', () => {
    const s = excursion()
    expect(trailWalkBack(0, PARENT, s)).toBeNull()
    expect(trailWalkBack(3, 'path=/elsewhere', s)).toBeNull()
  })
})

describe('storage that cannot be used', () => {
  it('answers nothing and does not throw when getItem throws', () => {
    const s: TrailStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {},
    }
    expect(() => trailPush(0, PARENT, s)).not.toThrow()
    expect(() => trailReplace(0, PARENT, s)).not.toThrow()
    expect(() => trailRecord(0, AT, s)).not.toThrow()
    expect(trailPlacement(0, s)).toBeNull()
    expect(trailWalkBack(1, PARENT, s)).toBeNull()
  })

  it('reads malformed JSON as an empty trail', () => {
    const s = memory()
    s.map.set(TRAIL_KEY, '{not json')
    expect(trailWalkBack(9, PARENT, s)).toBeNull()
    trailPush(0, PARENT, s)
    expect(trailWalkBack(1, PARENT, s)?.idx).toBe(0)
    s.map.set(TRAIL_KEY, JSON.stringify([{ idx: 'x' }, { idx: 1, listing: CHILD, placement: null }]))
    expect(trailWalkBack(2, CHILD, s)?.idx).toBe(1)
    expect(trailWalkBack(2, PARENT, s)).toBeNull()
  })
})
