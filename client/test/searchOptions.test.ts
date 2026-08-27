// @vitest-environment happy-dom
// Search options: persisted per profile, read back at module init. The read
// path is tested as thoroughly as the write path — the AO toggle's read path
// went untested once and the reload half is where a persistence bug hides.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

  it('a profile older than the floor takes the default; a chosen count survives', async () => {
    // The migration the stored shape exists for. `JSON.stringify` drops
    // `undefined`, so a count recorded as a missing key would be byte-identical
    // to a profile written before the floor became the default — and every
    // existing user would have read back as having opted out of a decision they
    // were never asked. Written as `null`, the two are distinguishable.
    localStorage.setItem(TUNING_KEY, JSON.stringify({ raw: false, pool: 'softmax', top: 60 }))
    const older = await import('../src/lib/searchOptions')
    expect(older.searchTuning().minScore).toBe(older.TUNING_DEFAULTS.minScore)

    vi.resetModules()
    localStorage.setItem(
      TUNING_KEY,
      JSON.stringify({ raw: false, pool: 'softmax', top: 12, minScore: null }),
    )
    const chose = await import('../src/lib/searchOptions')
    expect(chose.searchTuning().minScore).toBeUndefined()
    expect(chose.searchTuning().top).toBe(12)

    // A malformed floor falls back to the default like every other field here,
    // never to the count — which is a choice, not a fallback.
    vi.resetModules()
    localStorage.setItem(TUNING_KEY, JSON.stringify({ pool: 'softmax', minScore: 'x' }))
    const bad = await import('../src/lib/searchOptions')
    expect(bad.searchTuning().minScore).toBe(bad.TUNING_DEFAULTS.minScore)
  })

  it('writes a chosen count as an explicit null', async () => {
    const m = await import('../src/lib/searchOptions')
    m.setSearchTuning({ ...m.TUNING_DEFAULTS, top: 12, minScore: undefined })
    expect(JSON.parse(localStorage.getItem(TUNING_KEY)!)).toMatchObject({ top: 12, minScore: null })
    // And the floor writes itself as the number it is.
    m.setSearchTuning({ ...m.TUNING_DEFAULTS })
    expect(JSON.parse(localStorage.getItem(TUNING_KEY)!).minScore).toBe(m.TUNING_DEFAULTS.minScore)
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
