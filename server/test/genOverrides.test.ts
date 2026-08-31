import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateOverrides } from '../../scripts/gen-overrides'
import { MARKER_DIR } from '../src/library'
import { loadOverrides, resolveOverrides } from '../src/overrides'
import { realTempDir } from './helpers'

/**
 * The generator's core, exercised as a function rather than through a
 * self-checking dry-run mode, so the evidence lives in the suite. It runs under
 * `bun run scripts/gen-overrides.ts` unchanged — the CLI half is a thin argv
 * parse around this.
 *
 * The fixture metadata mirrors `metadata/miniatures.json`'s real shape: a
 * top-level array of kits carrying `stem`/`name`/`author`/`author_url`/
 * `license`/`source_url`, each with a nested `files[]` whose own `stem` values
 * are file stems and must never become keys.
 */
const KITS = [
  {
    thing_id: 3750572,
    stem: 'Player_Character_Pack_03_3750572',
    name: 'Player Character Pack 03',
    author: 'Valandar',
    author_url: 'https://www.thingiverse.com/Valandar',
    license: 'Creative Commons - Attribution',
    source_url: 'https://www.thingiverse.com/thing:3750572',
    files: [{ name: 'KindleCleric_000.stl', stem: 'KindleCleric_000' }],
  },
  {
    thing_id: 3040102,
    stem: 'Locked_Chest_3040102',
    name: 'Locked Chest',
    author: 'Someone',
    author_url: 'https://www.thingiverse.com/Someone',
    license: 'Creative Commons - Attribution',
    source_url: 'https://www.thingiverse.com/thing:3040102',
    files: [{ name: 'case_meshmixed.stl', stem: 'case_meshmixed' }],
  },
  {
    thing_id: 999,
    stem: 'Drifted_Away_999',
    name: 'Drifted Away',
    author: 'Nobody',
    license: 'Creative Commons - Attribution',
    source_url: 'https://www.thingiverse.com/thing:999',
    files: [],
  },
]

const PACK = KITS[0]!.stem
const CHEST = KITS[1]!.stem

/**
 * A library top with the kits laid out under `<top>/<kitsRel>` — the corpus's
 * own `miniatures/<variant>/<stem>/` shape when `kitsRel` is given, and the
 * demo's "root at the variant directory" shape when it is not.
 */
function fixture(kitsRel = ''): { top: string; kitsDir: string; metadata: string } {
  const top = realTempDir('mb-gen-')
  const kitsDir = kitsRel === '' ? top : join(top, kitsRel)
  // Only the first two stems get a folder; the third is the drift case.
  for (const stem of [PACK, CHEST]) mkdirSync(join(kitsDir, stem), { recursive: true })
  const metadata = join(top, 'miniatures.json')
  writeFileSync(metadata, JSON.stringify(KITS))
  return { top, kitsDir, metadata }
}

function storePath(top: string): string {
  return join(top, MARKER_DIR, 'overrides.json')
}

async function readStore(top: string): Promise<{ version: number; entries: Record<string, unknown> }> {
  return JSON.parse(await readFile(storePath(top), 'utf8'))
}

describe('gen-overrides', () => {
  it('writes a name and credits per existing kit, and reports the counts', async () => {
    const { top, metadata } = fixture()
    const lines: string[] = []
    const result = await generateOverrides({ top, metadata, report: (m) => lines.push(m) })

    expect(result.read).toBe(3)
    expect(result.written).toBe(2)
    expect(lines[0]).toContain('wrote 2 keys from 3 kits read')

    const store = await loadOverrides(top, () => undefined)
    expect(resolveOverrides(store, `/${PACK}`)).toEqual({
      name: 'Player Character Pack 03',
      credits: {
        author: 'Valandar',
        authorUrl: 'https://www.thingiverse.com/Valandar',
        license: 'Creative Commons - Attribution',
        sourceUrl: 'https://www.thingiverse.com/thing:3750572',
      },
    })
    // The kit's credits reach a model inside it, which is the whole point.
    expect(resolveOverrides(store, `/${PACK}/KindleCleric_000.stl`).credits).toBeDefined()
    // A partial credit is still a credit: this kit carries no author_url.
    expect(resolveOverrides(store, `/${CHEST}`).credits).toBeDefined()
  })

  it('reports a stem naming no directory and writes no dead key for it', async () => {
    const { top, metadata } = fixture()
    const lines: string[] = []
    const result = await generateOverrides({ top, metadata, report: (m) => lines.push(m) })

    expect(result.missing).toEqual(['Drifted_Away_999'])
    expect(lines.some((l) => l.includes('no directory for stem: Drifted_Away_999'))).toBe(true)
    expect(Object.keys((await readStore(top)).entries)).toEqual([`/${PACK}`, `/${CHEST}`])
  })

  it('never turns a nested files[].stem into a key', async () => {
    const { top, metadata } = fixture()
    await generateOverrides({ top, metadata, report: () => undefined })
    const keys = Object.keys((await readStore(top)).entries)
    // 2,801 of these exist in the real corpus, and they are file stems.
    expect(keys.some((k) => k.includes('KindleCleric_000'))).toBe(false)
    expect(keys.some((k) => k.includes('case_meshmixed'))).toBe(false)
  })

  it('makes keys top-relative when the kit directory is below the top', async () => {
    const { top, kitsDir, metadata } = fixture(join('miniatures', 'clustered-hq'))
    await generateOverrides({ top, kitsDir, metadata, report: () => undefined })
    expect(Object.keys((await readStore(top)).entries)).toEqual([
      `/miniatures/clustered-hq/${PACK}`,
      `/miniatures/clustered-hq/${CHEST}`,
    ])

    // Rooting the library at the kit directory itself yields keys `/<stem>`.
    const flat = fixture()
    await generateOverrides({ top: flat.top, metadata: flat.metadata, report: () => undefined })
    expect(Object.keys((await readStore(flat.top)).entries)).toEqual([`/${PACK}`, `/${CHEST}`])
  })

  it('refuses a kit directory outside the top before writing anything', async () => {
    const { top, metadata } = fixture()
    const outside = realTempDir('mb-gen-outside-')
    await expect(
      generateOverrides({ top, kitsDir: outside, metadata, report: () => undefined }),
    ).rejects.toThrow('must be the library top or beneath it')
    expect(existsSync(storePath(top))).toBe(false)

    // A `..` spelling is the same refusal: outside the top, `relative()` yields
    // `..`-keys that normalise into plausible wrong spellings rather than errors.
    await expect(
      generateOverrides({ top, kitsDir: join(top, '..'), metadata, report: () => undefined }),
    ).rejects.toThrow('must be the library top or beneath it')
    expect(existsSync(storePath(top))).toBe(false)
  })

  it('preserves a pose on a generated key, and keys it does not own, across a rerun', async () => {
    const { top, metadata } = fixture()
    await generateOverrides({ top, metadata, report: () => undefined })

    // Later tooling writes a pose onto a generated key, and a key of its own.
    const planted = await readStore(top)
    ;(planted.entries[`/${PACK}`] as Record<string, unknown>).pose = { az: 1.5, el: 0.25 }
    ;(planted.entries as Record<string, unknown>)[`/${PACK}/hero.stl`] = { pose: { az: 3 } }
    writeFileSync(storePath(top), JSON.stringify(planted))

    // The metadata changes underneath; the rerun regenerates what it owns.
    const renamed = structuredClone(KITS)
    renamed[0]!.name = 'Player Character Pack 03 (v2)'
    writeFileSync(metadata, JSON.stringify(renamed))
    await generateOverrides({ top, metadata, report: () => undefined })

    const after = await readStore(top)
    expect(after.entries[`/${PACK}`]).toMatchObject({
      name: 'Player Character Pack 03 (v2)',
      pose: { az: 1.5, el: 0.25 },
    })
    expect(after.entries[`/${PACK}/hero.stl`]).toEqual({ pose: { az: 3 } })
  })

  it('refuses to merge into a store it cannot read rather than overwriting it', async () => {
    const { top, metadata } = fixture()
    mkdirSync(join(top, MARKER_DIR), { recursive: true })
    writeFileSync(storePath(top), '{ half a store')
    await expect(generateOverrides({ top, metadata, report: () => undefined })).rejects.toThrow(
      'not valid JSON',
    )
    // Untouched: rewriting a store this build cannot merge into would destroy it.
    expect(await readFile(storePath(top), 'utf8')).toBe('{ half a store')
  })

  it('prints the restart-after-editing reminder', async () => {
    const { top, metadata } = fixture()
    const lines: string[] = []
    await generateOverrides({ top, metadata, report: (m) => lines.push(m) })
    expect(lines.some((l) => l.includes('restart it to pick this up'))).toBe(true)
  })

  it('refuses a stem that escapes the top, and writes no key for it', async () => {
    // The containment check guards the kit *directory*; a `..` stem escapes
    // through `join` per key and would write a key the loader normalises into
    // a plausible wrong path (found by the post-merge review). The escaping
    // directory genuinely exists here, so only the key guard stands between
    // the stem and the store.
    const { top, metadata } = fixture()
    mkdirSync(join(top, '..', 'outside-gen'), { recursive: true })
    writeFileSync(
      metadata,
      JSON.stringify([{ thing_id: 1, stem: '../outside-gen', name: 'Escaped', files: [] }]),
    )
    const lines: string[] = []
    const result = await generateOverrides({ top, metadata, report: (m) => lines.push(m) })
    expect(result.written).toBe(0)
    expect(Object.keys((await readStore(top)).entries)).toEqual([])
    expect(lines.some((l) => l.includes('escapes the top'))).toBe(true)
  })

  it('counts a duplicated stem once — the count means keys', async () => {
    const { top, metadata } = fixture()
    writeFileSync(metadata, JSON.stringify([KITS[0], KITS[0]]))
    const result = await generateOverrides({ top, metadata, report: () => undefined })
    expect(result.written).toBe(1)
    expect(result.read).toBe(2)
  })
})
