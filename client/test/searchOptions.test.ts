// @vitest-environment happy-dom
// Search options: persisted per profile, read back at module init. The read
// path is tested as thoroughly as the write path — the AO toggle's read path
// went untested once and the reload half is where a persistence bug hides.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_RESULT_COUNT } from '../../shared/types'

const MATCH_KEY = 'model-browser:search-folder-matching'
const KINDS_KEY = 'model-browser:search-kinds'
const TUNING_KEY = 'model-browser:search-tuning'

beforeEach(() => {
  localStorage.removeItem(MATCH_KEY)
  localStorage.removeItem(KINDS_KEY)
  localStorage.removeItem(TUNING_KEY)
  vi.resetModules()
})

afterEach(() => vi.restoreAllMocks())

describe('search options', () => {
  it('defaults: folder matching on, both kinds', async () => {
    const m = await import('../src/lib/searchOptions')
    expect(m.folderMatchingEnabled()).toBe(true)
    expect(m.searchKinds()).toBe('both')
  })

  it('persists what a control sets', async () => {
    const m = await import('../src/lib/searchOptions')
    m.setFolderMatchingEnabled(false)
    m.setSearchKinds('folders')
    expect(localStorage.getItem(MATCH_KEY)).toBe('off')
    expect(localStorage.getItem(KINDS_KEY)).toBe('folders')
    expect(m.folderMatchingEnabled()).toBe(false)
    expect(m.searchKinds()).toBe('folders')
  })

  it('reads every stored encoding by presence — design D4’s migration table', async () => {
    // Row 2: a profile written before the floor existed. It carried a count and
    // no floor, which under the presence rule is exactly what it says.
    localStorage.setItem(TUNING_KEY, JSON.stringify({ raw: false, pool: 'softmax', top: 60 }))
    const older = await import('../src/lib/searchOptions')
    expect(older.searchTuning().minScore).toBeUndefined()
    expect(older.searchTuning().top).toBe(60)

    // Row 1: the old `null` sentinel meant "count chosen". Absence now says the
    // same thing, so the two collapse and the sentinel still reads correctly.
    vi.resetModules()
    localStorage.setItem(
      TUNING_KEY,
      JSON.stringify({ raw: false, pool: 'softmax', top: 12, minScore: null }),
    )
    const chose = await import('../src/lib/searchOptions')
    expect(chose.searchTuning().minScore).toBeUndefined()
    expect(chose.searchTuning().top).toBe(12)

    // Row 3, the lossy one: written from a floor-only view, whose disabled count
    // field the old writer emitted anyway. It reads as both bounds, and the
    // count is whatever was inert in the bytes — here a 10 nobody chose.
    vi.resetModules()
    localStorage.setItem(
      TUNING_KEY,
      JSON.stringify({ raw: false, pool: 'softmax', top: 10, minScore: 0.1 }),
    )
    const both = await import('../src/lib/searchOptions')
    expect(both.searchTuning()).toMatchObject({ top: 10, minScore: 0.1 })

    // Row 4: a floor and no count reads as the floor alone.
    vi.resetModules()
    localStorage.setItem(TUNING_KEY, JSON.stringify({ pool: 'softmax', minScore: 0.2 }))
    const floorOnly = await import('../src/lib/searchOptions')
    expect(floorOnly.searchTuning().minScore).toBe(0.2)
    expect(floorOnly.searchTuning().top).toBeUndefined()
  })

  it('a bound it cannot parse is not in force, and a record naming none is the defaults', async () => {
    // A malformed value cannot testify that its bound was set, so it reads as
    // absent rather than as its default. Here that leaves a count alone.
    localStorage.setItem(TUNING_KEY, JSON.stringify({ pool: 'softmax', top: 12, minScore: 'x' }))
    const bad = await import('../src/lib/searchOptions')
    expect(bad.searchTuning().minScore).toBeUndefined()
    expect(bad.searchTuning().top).toBe(12)

    // And when nothing survives, the record names no bound — which is the one
    // case that reads as both at their defaults rather than as neither.
    vi.resetModules()
    localStorage.setItem(TUNING_KEY, JSON.stringify({ pool: 'softmax', top: 'x', minScore: 'x' }))
    const none = await import('../src/lib/searchOptions')
    expect(none.searchTuning()).toMatchObject({
      top: none.TUNING_DEFAULTS.top,
      minScore: none.TUNING_DEFAULTS.minScore,
    })
  })

  it('clamps a stored count to what the index will return', async () => {
    localStorage.setItem(TUNING_KEY, JSON.stringify({ pool: 'softmax', top: 5000 }))
    const m = await import('../src/lib/searchOptions')
    expect(m.searchTuning().top).toBe(MAX_RESULT_COUNT)
  })

  it('writes each bound in force and omits each bound that is not', async () => {
    const m = await import('../src/lib/searchOptions')
    m.setSearchTuning({ ...m.TUNING_DEFAULTS, top: 12, minScore: undefined })
    const countOnly = JSON.parse(localStorage.getItem(TUNING_KEY)!)
    expect(countOnly.top).toBe(12)
    expect('minScore' in countOnly).toBe(false)

    // No `null` written any more: absence is the whole encoding, so a profile
    // carrying a floor carries it as the number it is.
    m.setSearchTuning({ ...m.TUNING_DEFAULTS, top: undefined })
    const floorOnly = JSON.parse(localStorage.getItem(TUNING_KEY)!)
    expect(floorOnly.minScore).toBe(m.TUNING_DEFAULTS.minScore)
    expect('top' in floorOnly).toBe(false)

    m.setSearchTuning({ ...m.TUNING_DEFAULTS })
    expect(JSON.parse(localStorage.getItem(TUNING_KEY)!)).toMatchObject({
      top: m.TUNING_DEFAULTS.top,
      minScore: m.TUNING_DEFAULTS.minScore,
    })
  })

  it('round-trips every bound state through storage', async () => {
    const m = await import('../src/lib/searchOptions')
    for (const state of [
      { top: 42, minScore: undefined },
      { top: undefined, minScore: 0.25 },
      { top: 42, minScore: 0.25 },
      { top: m.TUNING_DEFAULTS.top, minScore: m.TUNING_DEFAULTS.minScore },
    ]) {
      m.setSearchTuning({ ...m.TUNING_DEFAULTS, ...state })
      vi.resetModules()
      const back = await import('../src/lib/searchOptions')
      expect(back.searchTuning().top).toBe(state.top)
      expect(back.searchTuning().minScore).toBe(state.minScore)
    }
  })

  it('reads both preferences back at module init — the reload half', async () => {
    localStorage.setItem(MATCH_KEY, 'off')
    localStorage.setItem(KINDS_KEY, 'models')
    const fresh = await import('../src/lib/searchOptions')
    expect(fresh.folderMatchingEnabled()).toBe(false)
    expect(fresh.searchKinds()).toBe('models')
  })

  it('a malformed stored kind defaults rather than throwing', async () => {
    localStorage.setItem(KINDS_KEY, 'sideways')
    const m = await import('../src/lib/searchOptions')
    expect(m.searchKinds()).toBe('both')
  })

  it('an absent key is the default, not an error', async () => {
    const m = await import('../src/lib/searchOptions')
    expect(m.folderMatchingEnabled()).toBe(true)
    expect(m.searchKinds()).toBe('both')
  })

  it('survives localStorage throwing at init, in memory only', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const m = await import('../src/lib/searchOptions')
    expect(m.folderMatchingEnabled()).toBe(true)
    expect(m.searchKinds()).toBe('both')
    getItem.mockRestore()

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => m.setSearchKinds('models')).not.toThrow()
    expect(m.searchKinds()).toBe('models')
  })
})
