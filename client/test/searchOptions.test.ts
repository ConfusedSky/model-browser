// @vitest-environment happy-dom
// Search options: persisted per profile, read back at module init. The read
// path is tested as thoroughly as the write path — the AO toggle's read path
// went untested once and the reload half is where a persistence bug hides.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const MATCH_KEY = 'model-browser:search-folder-matching'
const KINDS_KEY = 'model-browser:search-kinds'

beforeEach(() => {
  localStorage.removeItem(MATCH_KEY)
  localStorage.removeItem(KINDS_KEY)
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
