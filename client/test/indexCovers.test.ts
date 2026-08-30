import { describe, expect, it } from 'vitest'
import { indexCovers } from '../src/state/selectors'

const at = (collectionRoot: string) => ({ state: 'ready' as const, collectionRoot, covers: ['stl'] })

describe('indexCovers', () => {
  // Regression: with the library top as the collection root — `/` since
  // library-root — the prefix check built `//` and every subfolder read as
  // outside the index ("does not cover this folder. It covers /.").
  it('a root of / covers every library path', () => {
    expect(indexCovers(at('/'), '/')).toBe(true)
    expect(indexCovers(at('/'), '/Loot Studios')).toBe(true)
    expect(indexCovers(at('/'), '/Loot Studios/Spacecraft-Crasher/32mm/No Supports')).toBe(true)
  })

  it('a nested root covers itself and its subtree, not its siblings', () => {
    expect(indexCovers(at('/models'), '/models')).toBe(true)
    expect(indexCovers(at('/models'), '/models/kit')).toBe(true)
    expect(indexCovers(at('/models'), '/models-2')).toBe(false)
    expect(indexCovers(at('/models'), '/')).toBe(false)
  })

  it('archive interiors and an absent root are never covered', () => {
    expect(indexCovers(at('/'), '/kit.zip!/a.stl')).toBe(false)
    expect(indexCovers({ state: 'ready', covers: ['stl'] }, '/kit')).toBe(false)
    expect(indexCovers(null, '/kit')).toBe(false)
  })
})
