// @vitest-environment happy-dom
// The shared action module, asked directly: the vpath arithmetic reveal runs
// on, D6's per-kind table, and the menu's viewport clamp. Everything here is a
// pure function — the wiring is entryMenu.test.tsx's job.
import { describe, expect, it, vi } from 'vitest'
import type { DirEntry, IndexAvailability } from '../../shared/types'
import { clampToViewport } from '../src/components/EntryMenu'
import {
  commandsFor,
  containingFolder,
  copyEntryPath,
  COPY_FAILED,
  ENTRY_COMMANDS,
} from '../src/lib/entryActions'

const model = (path: string): DirEntry => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  kind: 'model',
  format: 'stl',
  size: 1,
  mtime: 1,
})
const dir = (path: string): DirEntry => ({
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  kind: 'dir',
  size: 0,
  mtime: 1,
})
const zip = (path: string): DirEntry => ({ ...dir(path), kind: 'zip' })

// Answering, and saying which collection it covers — the second half matters:
// find similar is offered inside that collection, by the same `indexCovers` the
// side panel reads.
const READY: IndexAvailability = { state: 'ready', collectionRoot: '/m' }
const ids = (entry: DirEntry, index: IndexAvailability | null): string[] =>
  commandsFor(entry, { index }).map((c) => c.id)

describe('containingFolder', () => {
  it('is the parent directory of an ordinary path', () => {
    expect(containingFolder('/models/Kits/hero.stl')).toBe('/models/Kits')
    expect(containingFolder('/models/hero.stl')).toBe('/models')
  })

  it('is the directory INSIDE the archive for a zip entry', () => {
    expect(containingFolder('/models/kit.zip!/parts/lid.stl')).toBe('/models/kit.zip!/parts')
  })

  it('is the archive itself for an entry at the archive root', () => {
    expect(containingFolder('/models/kit.zip!/lid.stl')).toBe('/models/kit.zip')
  })

  it('bottoms out at the root rather than the empty path', () => {
    // '' is "no directory chosen yet" in this app — the state the header
    // disables ↑ for — so ascending from a top-level entry must not produce it.
    expect(containingFolder('/hero.stl')).toBe('/')
    expect(containingFolder('/')).toBe('/')
  })
})

describe("D6's per-kind table", () => {
  it('offers open, reveal and copy path on every kind', () => {
    for (const entry of [model('/m/a.stl'), dir('/m/d'), zip('/m/z.zip')]) {
      expect(ids(entry, READY)).toEqual(expect.arrayContaining(['open', 'reveal', 'copyPath']))
    }
  })

  it('offers find similar on a model and on nothing else', () => {
    expect(ids(model('/m/a.stl'), READY)).toContain('findSimilar')
    expect(ids(dir('/m/d'), READY)).not.toContain('findSimilar')
    expect(ids(zip('/m/z.zip'), READY)).not.toContain('findSimilar')
  })

  it('withholds find similar when the index is not answering', () => {
    // The degradation semantic-search designs for, arriving here: a model tile
    // without find similar is not a bug. Absent, never present and inert.
    expect(ids(model('/m/a.stl'), null)).not.toContain('findSimilar')
    expect(ids(model('/m/a.stl'), { state: 'absent' })).not.toContain('findSimilar')
    expect(ids(model('/m/a.stl'), { state: 'warming' })).not.toContain('findSimilar')
  })

  it('withholds find similar from a model inside an archive', () => {
    // Outside the corpus by construction, and knowable client-side from the
    // path — no round trip to learn it. `indexCovers` answers this half too,
    // which is why the rule is not spelled out a second time here.
    expect(ids(model('/m/kit.zip!/lid.stl'), READY)).not.toContain('findSimilar')
  })

  it('withholds find similar from a model outside the collection the index covers', () => {
    // "Inside the indexed collection" is one rule, and the side panel already
    // owns it: a second copy here is how the menu and the panel would come to
    // disagree about the same model.
    expect(ids(model('/elsewhere/a.stl'), READY)).not.toContain('findSimilar')
    expect(ids(model('/m/a.stl'), { state: 'ready' })).not.toContain('findSimilar') // no root, no claim
  })

  it('offers both thumbnail commands on a model and on nothing else', () => {
    // Model-only for a structural reason: container tiles are drawn as glyphs,
    // not renders, so there is no thumbnail to act on. Every command in the
    // table has a body now, so none is hidden for want of one.
    expect(ENTRY_COMMANDS.filter((c) => c.run === null)).toEqual([])
    for (const id of ['reRenderThumbnail', 'resetFraming']) {
      expect(ids(model('/m/a.stl'), READY)).toContain(id)
      expect(ids(dir('/m/d'), READY)).not.toContain(id)
      expect(ids(zip('/m/z.zip'), READY)).not.toContain(id)
    }
    // Offered on a model the index cannot serve, too — they are not the
    // index's actions, and a failed image is a case re-render exists for.
    expect(ids(model('/m/a.stl'), null)).toEqual([
      'open',
      'reveal',
      'copyPath',
      'reRenderThumbnail',
      'resetFraming',
    ])
  })
})

describe('copyEntryPath', () => {
  it('copies the virtual path verbatim, zip notation included', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const confirm = vi.fn()
    const report = vi.fn()
    try {
      copyEntryPath(model('/m/kit.zip!/parts/lid.stl'), { confirm, report })
      await Promise.resolve()
      expect(writeText).toHaveBeenCalledWith('/m/kit.zip!/parts/lid.stl')
      expect(confirm).toHaveBeenCalled()
      expect(report).not.toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  })

  it('reports rather than throwing when the clipboard fails synchronously', () => {
    // The case a bare `.catch()` misses. Outside a secure context
    // `navigator.clipboard` is undefined and the call throws where nothing is
    // awaiting it — the reason the try survived the move out of the panel.
    // (happy-dom supplies a clipboard of its own, so this defines the absence
    // rather than deleting the property: a delete only uncovers the prototype's.)
    const report = vi.fn()
    for (const clipboard of [undefined, { writeText: () => { throw new Error('blocked') } }]) {
      Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
      report.mockClear()
      expect(() => copyEntryPath(model('/m/a.stl'), { confirm: vi.fn(), report })).not.toThrow()
      expect(report).toHaveBeenCalledWith(COPY_FAILED)
    }
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('reports a rejected write with the one shared sentence', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const report = vi.fn()
    try {
      copyEntryPath(model('/m/a.stl'), { confirm: vi.fn(), report })
      await Promise.resolve()
      await Promise.resolve()
      expect(report).toHaveBeenCalledWith(COPY_FAILED)
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  })
})

describe('clampToViewport', () => {
  it('leaves a menu that fits where the pointer was', () => {
    expect(clampToViewport(100, 100, 180, 120, 1000, 800)).toEqual({ left: 100, top: 100 })
  })

  it('slides a menu raised at the edge back inside, on both axes', () => {
    expect(clampToViewport(960, 780, 180, 120, 1000, 800)).toEqual({ left: 814, top: 674 })
  })

  it('never pushes it off the near edge to satisfy the far one', () => {
    // A menu taller than the window clamps to the top margin rather than to a
    // negative offset that would hide its first item.
    expect(clampToViewport(10, 10, 2000, 2000, 1000, 800)).toEqual({ left: 6, top: 6 })
  })
})
