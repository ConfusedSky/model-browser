import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import type { DirListing } from '../../shared/types'
import { createApp } from '../src/app'
import { ThumbCache } from '../src/cache'
import { LOOPBACK, stlBytes } from './helpers'

/**
 * root/
 *   loose.stl  notes.txt  .hidden/h.stl
 *   a/bracket.stl  a/deep/part.stl  z/bracket.stl
 *   alias -> a  loop/back -> root
 *   kit.zip { box.stl, arms/left.stl, inner.zip (nested zip), v2.zip/deep2.stl }
 */
const root = mkdtempSync(join(tmpdir(), 'mb-flat-'))
writeFileSync(join(root, 'loose.stl'), stlBytes(1))
writeFileSync(join(root, 'notes.txt'), 'not a model')
mkdirSync(join(root, '.hidden'))
writeFileSync(join(root, '.hidden', 'h.stl'), stlBytes(2))
mkdirSync(join(root, 'a', 'deep'), { recursive: true })
writeFileSync(join(root, 'a', 'bracket.stl'), stlBytes(3))
writeFileSync(join(root, 'a', 'deep', 'part.stl'), stlBytes(4))
mkdirSync(join(root, 'z'))
writeFileSync(join(root, 'z', 'bracket.stl'), stlBytes(5))
symlinkSync(join(root, 'a'), join(root, 'alias'))
mkdirSync(join(root, 'loop'))
symlinkSync(root, join(root, 'loop', 'back'))
const zipPath = join(root, 'kit.zip')
writeFileSync(
  zipPath,
  zipSync({
    'box.stl': new Uint8Array(stlBytes(6)),
    'arms/left.stl': new Uint8Array(stlBytes(7)),
    'inner.zip': [new Uint8Array(zipSync({ 'deep.stl': new Uint8Array(stlBytes(8)) })), { level: 0 }],
    'v2.zip/deep2.stl': new Uint8Array(stlBytes(9)),
  }),
)

/**
 * A second root for folder-matching, where every directory but `spares` holds
 * the fragment `Set`, so a narrower query is a strict filter of a broader
 * one's collection.
 *
 * root2/
 *   SetDunes/{base.stl, body.stl, spares/clip.stl}
 *   SetRocks/base.stl
 *   SetKit.zip { top.stl, lvl1/SetInner/x.stl }
 */
const root2 = mkdtempSync(join(tmpdir(), 'mb-folder-'))
mkdirSync(join(root2, 'SetDunes', 'spares'), { recursive: true })
writeFileSync(join(root2, 'SetDunes', 'base.stl'), stlBytes(11))
writeFileSync(join(root2, 'SetDunes', 'body.stl'), stlBytes(12))
writeFileSync(join(root2, 'SetDunes', 'spares', 'clip.stl'), stlBytes(13))
mkdirSync(join(root2, 'SetRocks'))
writeFileSync(join(root2, 'SetRocks', 'base.stl'), stlBytes(14))
mkdirSync(join(root2, 'nested'))
writeFileSync(
  join(root2, 'nested', 'SetDeep.zip'),
  zipSync({ 'inner.stl': new Uint8Array(stlBytes(17)) }),
)
writeFileSync(
  join(root2, 'SetKit.zip'),
  zipSync({
    'top.stl': new Uint8Array(stlBytes(15)),
    'lvl1/SetInner/x.stl': new Uint8Array(stlBytes(16)),
  }),
)

const cacheDir = mkdtempSync(join(tmpdir(), 'mb-cache-'))
const app = createApp(new ThumbCache(cacheDir))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(root2, { recursive: true, force: true })
  rmSync(cacheDir, { recursive: true, force: true })
})

afterEach(() => {
  delete process.env.MODEL_BROWSER_FLAT_CAP
  delete process.env.MODEL_BROWSER_FLAT_BUDGET
  delete process.env.MODEL_BROWSER_SEARCH_BUDGET
  delete process.env.MODEL_BROWSER_FOLDER_CAP
})

async function flat(path: string, flag = 'true', q?: string): Promise<DirListing> {
  const qs = q === undefined ? '' : `&q=${encodeURIComponent(q)}`
  const res = await app.request(
    `/api/dir?path=${encodeURIComponent(path)}&flat=${flag}${qs}`,
    { headers: LOOPBACK },
  )
  expect(res.status).toBe(200)
  return (await res.json()) as DirListing
}

const CONTAINERS = ['a', 'alias', 'loop', 'z', 'kit.zip']
const MODELS = [
  'kit.zip!/box.stl',
  'a/bracket.stl',
  'z/bracket.stl',
  'kit.zip!/v2.zip/deep2.stl',
  'kit.zip!/arms/left.stl',
  'loose.stl',
  'a/deep/part.stl',
]

describe('flat listing of a directory', () => {
  it('lists top-level containers, then all models by relative path in basename order', async () => {
    const body = await flat(root)
    expect(body.entries.map((e) => e.name)).toEqual([...CONTAINERS, ...MODELS])
    expect(body.entries.slice(0, 5).every((e) => e.kind !== 'model')).toBe(true)
    expect(body.truncated).toBeUndefined()
  })

  it('deeper directories emit no tiles and hidden dirs are skipped', async () => {
    const body = await flat(root)
    const names = body.entries.map((e) => e.name)
    expect(names).not.toContain('deep')
    expect(names.some((n) => n.includes('.hidden'))).toBe(false)
  })

  it('model virtual paths match what nested browsing yields', async () => {
    const body = await flat(root)
    const bracket = body.entries.find((e) => e.name === 'a/bracket.stl')!
    expect(bracket.path).toBe(join(root, 'a', 'bracket.stl'))
    const left = body.entries.find((e) => e.name === 'kit.zip!/arms/left.stl')!
    expect(left.path).toBe(`${zipPath}!/arms/left.stl`)
  })

  it('same-named parts sort together, tie broken by relative path', async () => {
    const body = await flat(root)
    const brackets = body.entries.filter((e) => e.name.endsWith('bracket.stl')).map((e) => e.name)
    expect(brackets).toEqual(['a/bracket.stl', 'z/bracket.stl'])
    const i = body.entries.findIndex((e) => e.name === 'a/bracket.stl')
    expect(body.entries[i + 1]!.name).toBe('z/bracket.stl')
  })

  it('descends into zips, skips nested zip files, walks a *.zip directory', async () => {
    const body = await flat(root)
    const names = body.entries.map((e) => e.name)
    expect(names).toContain('kit.zip!/v2.zip/deep2.stl')
    expect(names.some((n) => n.includes('inner.zip'))).toBe(false)
  })

  it('an aliased directory contributes its models once, under the first route', async () => {
    const body = await flat(root)
    const names = body.entries.map((e) => e.name)
    expect(names.filter((n) => n.startsWith('alias/'))).toEqual([])
    expect(names.filter((n) => n === 'a/bracket.stl')).toHaveLength(1)
  })

  it('terminates on a symlink cycle, listing each real directory once', async () => {
    const body = await flat(root)
    const names = body.entries.map((e) => e.name)
    expect(names.some((n) => n.startsWith('loop/'))).toBe(false)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('flat listing rooted in a zip', () => {
  it('zip root: immediate dirs only, then models relative to the archive', async () => {
    const body = await flat(zipPath)
    expect(body.entries.map((e) => e.name)).toEqual([
      'arms',
      'v2.zip',
      'box.stl',
      'v2.zip/deep2.stl',
      'arms/left.stl',
    ])
  })

  it('a nested zip file is not offered as a container tile', async () => {
    // It would 400 on click — the flat view must not hand out a dead link.
    const body = await flat(zipPath)
    expect(body.entries.some((e) => e.name === 'inner.zip')).toBe(false)
    const res = await app.request(
      `/api/dir?path=${encodeURIComponent(`${zipPath}!/inner.zip`)}&flat=true`,
      { headers: LOOPBACK },
    )
    expect(res.status).toBe(400)
  })

  it('zip subdirectory: models named relative to the prefix', async () => {
    const body = await flat(`${zipPath}!/arms`)
    expect(body.entries.map((e) => e.name)).toEqual(['left.stl'])
    expect(body.entries[0]!.path).toBe(`${zipPath}!/arms/left.stl`)
  })
})

describe('bounding', () => {
  it('caps returned models at MODEL_BROWSER_FLAT_CAP with the sorted prefix, flagged truncated', async () => {
    process.env.MODEL_BROWSER_FLAT_CAP = '3'
    const body = await flat(root)
    const models = body.entries.filter((e) => e.kind === 'model').map((e) => e.name)
    expect(models).toEqual(MODELS.slice(0, 3))
    expect(body.truncated).toBe(true)
  })

  it('stops at the walk budget on a model-sparse tree, flagged truncated', async () => {
    process.env.MODEL_BROWSER_FLAT_BUDGET = '2'
    const body = await flat(root)
    expect(body.entries.map((e) => e.name)).toEqual(CONTAINERS)
    expect(body.truncated).toBe(true)
  })

  it('charges for every entry examined, not just models and entered dirs', async () => {
    // A folder of non-model files is the walk's real cost — statting them all
    // for one charged step would leave the budget nominal.
    const dir = mkdtempSync(join(tmpdir(), 'mb-flat-noise-'))
    mkdirSync(join(dir, 'sub'))
    for (let i = 0; i < 10; i++) writeFileSync(join(dir, 'sub', `t${i}.txt`), 'x')
    writeFileSync(join(dir, 'sub', 'part.stl'), stlBytes(1))
    try {
      process.env.MODEL_BROWSER_FLAT_BUDGET = '4'
      const body = await flat(dir)
      expect(body.entries.filter((e) => e.kind === 'model')).toEqual([])
      expect(body.truncated).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a malformed limit falls back to the default instead of disabling the bound', async () => {
    // Number('20k') is NaN, and NaN <= 0 / length > NaN are both false, so an
    // unvalidated read silently removes the budget and the cap.
    process.env.MODEL_BROWSER_FLAT_BUDGET = '20k'
    process.env.MODEL_BROWSER_FLAT_CAP = 'lots'
    const body = await flat(root)
    expect(body.entries.map((e) => e.name)).toEqual([...CONTAINERS, ...MODELS])
    expect(body.truncated).toBeUndefined()
  })

  it('an empty limit falls back too, rather than reading as zero', async () => {
    process.env.MODEL_BROWSER_FLAT_BUDGET = ''
    const body = await flat(root)
    expect(body.entries.map((e) => e.name)).toEqual([...CONTAINERS, ...MODELS])
    expect(body.truncated).toBeUndefined()
  })
})

describe('flag and errors', () => {
  it('flat=false returns the ordinary nested listing', async () => {
    const body = await flat(root, 'false')
    expect(body.entries.map((e) => e.name)).toEqual([...CONTAINERS, 'loose.stl'])
    expect(body.truncated).toBeUndefined()
  })

  it('skips an unreadable subdirectory without failing the request', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mb-flat-locked-'))
    writeFileSync(join(dir, 'ok.stl'), stlBytes(1))
    mkdirSync(join(dir, 'locked'))
    writeFileSync(join(dir, 'locked', 'secret.stl'), stlBytes(2))
    chmodSync(join(dir, 'locked'), 0o000)
    try {
      const body = await flat(dir)
      expect(body.entries.map((e) => e.name)).toEqual(['locked', 'ok.stl'])
    } finally {
      chmodSync(join(dir, 'locked'), 0o755)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('404s on a nonexistent root', async () => {
    const res = await app.request(
      `/api/dir?path=${encodeURIComponent(join(root, 'nope'))}&flat=true`,
      { headers: LOOPBACK },
    )
    expect(res.status).toBe(404)
  })

  it('404s on an unreadable root — only *sub*directory failures are swallowed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mb-flat-root-locked-'))
    chmodSync(dir, 0o000)
    try {
      const res = await app.request(`/api/dir?path=${encodeURIComponent(dir)}&flat=true`, {
        headers: LOOPBACK,
      })
      expect(res.status).toBe(404)
    } finally {
      chmodSync(dir, 0o755)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('deep name search (q parameter)', () => {
  it('matches models across depths and inside zips, by file name, in the usual order', async () => {
    const body = await flat(root, 'true', 'bracket')
    expect(body.entries.map((e) => e.name)).toEqual(['a/bracket.stl', 'z/bracket.stl'])
  })

  it('matches a model several levels inside a zip', async () => {
    const body = await flat(root, 'true', 'left')
    expect(body.entries.map((e) => e.name)).toEqual(['kit.zip!/arms/left.stl'])
  })

  it('is case-insensitive', async () => {
    const body = await flat(root, 'true', 'BrAcKeT')
    expect(body.entries.map((e) => e.name)).toEqual(['a/bracket.stl', 'z/bracket.stl'])
  })

  it('returns a model matched only via a containing folder, and that folder as a tile', async () => {
    // "arms" is a folder in kit.zip containing left.stl: the fragment is in the
    // relative path, not in the file's own base name. Both come back — the
    // model because the path matches, the folder because its own name does.
    const body = await flat(root, 'true', 'arms')
    expect(body.entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      'dir:kit.zip!/arms',
      'model:kit.zip!/arms/left.stl',
    ])
  })

  it('a matching archive returns its contents, as a matching folder does', async () => {
    const body = await flat(root, 'true', 'kit')
    expect(body.entries.map((e) => e.name)).toEqual([
      'kit.zip',
      'kit.zip!/arms/left.stl',
      'kit.zip!/box.stl',
      'kit.zip!/v2.zip/deep2.stl',
    ])
  })

  it('a folder several levels inside an archive matches, like a child of the root does', async () => {
    const body = await flat(root2, 'true', 'inner')
    expect(body.entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      'dir:SetKit.zip!/lvl1/SetInner',
      'model:nested/SetDeep.zip!/inner.stl',
      'model:SetKit.zip!/lvl1/SetInner/x.stl',
    ])
  })

  it('the search root does not match itself', async () => {
    // Names are relative to the root, so the root's own name is not in them:
    // searching a folder for its own name returns what is beneath, not all.
    const body = await flat(join(root2, 'SetDunes'), 'true', 'setdunes')
    expect(body.entries).toEqual([])
  })

  it('a folder inside a matching folder is not itself a tile, but its models are results', async () => {
    const body = await flat(root2, 'true', 'setdunes')
    expect(body.entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      'dir:SetDunes',
      'model:SetDunes/base.stl',
      'model:SetDunes/body.stl',
      'model:SetDunes/spares/clip.stl',
    ])
  })

  it('a matching child of the root appears exactly once', async () => {
    // listFlat hands the root's entries to both the container collection and
    // the walk; an unguarded push returns one folder as two identical tiles.
    const body = await flat(root2, 'true', 'setrocks')
    expect(body.entries.filter((e) => e.name === 'SetRocks')).toHaveLength(1)
  })

  it('the walk collects without consulting the query', async () => {
    // The invariant search-cancellation (one traversal shared across requests
    // carrying different queries) and listing-tree-cache (snapshot keyed by
    // root alone) are both built on. It cannot be observed through listFlat:
    // filtering inside the walk with the same monotone predicate listFlat
    // applies afterwards produces byte-identical output, so a behavioural test
    // here can assert only a theorem about filters. This asserts the source
    // shape instead, which is the thing that actually regresses.
    const src = await readFile(new URL('../src/listing.ts', import.meta.url), 'utf8')
    const walkSrc = src.slice(
      src.indexOf('async function walkFsLevel'),
      src.indexOf('function envLimit'),
    )
    expect(walkSrc).not.toMatch(/matchesQuery|matchesOwnName|\bhasQuery\b|walk\.q\b/)
  })

  it('a filesystem folder several levels below the root matches, at any depth', async () => {
    // The motivating case, and the one no zip fixture covers: both walkFsLevel
    // pushes could be deleted without any other test noticing.
    const body = await flat(root, 'true', 'deep')
    expect(body.entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      'dir:a/deep',
      'model:a/deep/part.stl',
      'model:kit.zip!/v2.zip/deep2.stl',
    ])
  })

  it('an archive below the root level matches as a container', async () => {
    const body = await flat(root2, 'true', 'setdeep')
    expect(body.entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      'zip:nested/SetDeep.zip',
      'model:nested/SetDeep.zip!/inner.stl',
    ])
  })

  it('a folder at the top of a zip root appears exactly once', async () => {
    // The root call's immediate children are listFlat's containers; without the
    // guard the walk collects them too and every one comes back twice.
    const body = await flat(zipPath, 'true', 'arms')
    expect(body.entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      'dir:arms',
      'model:arms/left.stl',
    ])
  })

  it('a directory reached through a symlink is findable by the name it was reached by', async () => {
    // `alias -> a` is skipped by the visited set for traversal, but its own name
    // is still a name under the root, and whichever of the two sorts first must
    // not make the other unfindable.
    const aliased = await flat(root, 'true', 'alias')
    expect(aliased.entries.map((e) => `${e.kind}:${e.name}`)).toContain('dir:alias')
    // ...and the real tree beneath it is still reachable under its own names,
    // rather than being consumed by whichever path the walk reached first.
    const real = await flat(root, 'true', 'deep')
    expect(real.entries.map((e) => e.name)).toContain('a/deep')
  })

  it('queried results order by relative path, keeping each folder contiguous', async () => {
    const body = await flat(root2, 'true', 'set')
    expect(body.entries.filter((e) => e.kind === 'model').map((e) => e.name)).toEqual([
      'nested/SetDeep.zip!/inner.stl',
      'SetDunes/base.stl',
      'SetDunes/body.stl',
      'SetDunes/spares/clip.stl',
      'SetKit.zip!/lvl1/SetInner/x.stl',
      'SetKit.zip!/top.stl',
      'SetRocks/base.stl',
    ])
  })

  it('matching containers lead as a block, dirs before zips', async () => {
    const body = await flat(root2, 'true', 'set')
    expect(body.entries.filter((e) => e.kind !== 'model').map((e) => `${e.kind}:${e.name}`)).toEqual([
      'dir:SetDunes',
      'dir:SetKit.zip!/lvl1/SetInner',
      'dir:SetRocks',
      'zip:nested/SetDeep.zip',
      'zip:SetKit.zip',
    ])
    expect(body.entries.findIndex((e) => e.kind === 'model')).toBe(5)
  })

  it('the folder cap bounds containers without reducing models, and flags truncated', async () => {
    process.env.MODEL_BROWSER_FOLDER_CAP = '2'
    const body = await flat(root2, 'true', 'set')
    expect(body.entries.filter((e) => e.kind !== 'model')).toHaveLength(2)
    expect(body.entries.filter((e) => e.kind === 'model')).toHaveLength(7)
    expect(body.truncated).toBe(true)
  })

  it('deep search rooted in a zip', async () => {
    const body = await flat(zipPath, 'true', 'left')
    expect(body.entries.map((e) => e.name)).toEqual(['arms/left.stl'])
  })

  it('deep search rooted in a directory inside a zip', async () => {
    const body = await flat(`${zipPath}!/arms`, 'true', 'left')
    expect(body.entries.map((e) => e.name)).toEqual(['left.stl'])
  })

  it('caps matches (not raw walk output) and flags truncated', async () => {
    process.env.MODEL_BROWSER_FLAT_CAP = '1'
    const body = await flat(root, 'true', 'bracket')
    expect(body.entries.map((e) => e.name)).toEqual(['a/bracket.stl'])
    expect(body.truncated).toBe(true)
  })

  it('still reports budget truncation when the search matches nothing', async () => {
    process.env.MODEL_BROWSER_SEARCH_BUDGET = '2'
    const body = await flat(root, 'true', 'nope-does-not-exist')
    expect(body.entries).toEqual([])
    expect(body.truncated).toBe(true)
  })

  it('search walks on its own budget: reach the browse budget cannot afford (D5)', async () => {
    // A browse this constrained truncates almost immediately…
    process.env.MODEL_BROWSER_FLAT_BUDGET = '2'
    const browse = await flat(root)
    expect(browse.truncated).toBe(true)
    // …but a search under the same environment still finds the nested model,
    // because MODEL_BROWSER_SEARCH_BUDGET (default 200k) governs it instead.
    const search = await flat(root, 'true', 'bracket')
    expect(search.entries.map((e) => e.name)).toContain('a/bracket.stl')
    expect(search.truncated).not.toBe(true) // omitted when the walk completed
  })

  it('a blank or whitespace-only query is a plain flat listing', async () => {
    const blank = await flat(root, 'true', '')
    expect(blank.entries.map((e) => e.name)).toEqual([...CONTAINERS, ...MODELS])
    const whitespace = await flat(root, 'true', '   ')
    expect(whitespace.entries.map((e) => e.name)).toEqual([...CONTAINERS, ...MODELS])
  })

  it('rejects a non-blank query without the flat flag', async () => {
    const res = await app.request(
      `/api/dir?path=${encodeURIComponent(root)}&q=bracket`,
      { headers: LOOPBACK },
    )
    expect(res.status).toBe(400)
  })

  it('rejects a non-blank query when flat is explicitly false', async () => {
    const res = await app.request(
      `/api/dir?path=${encodeURIComponent(root)}&flat=false&q=bracket`,
      { headers: LOOPBACK },
    )
    expect(res.status).toBe(400)
  })

  it('a blank query without the flat flag is not rejected', async () => {
    const res = await app.request(
      `/api/dir?path=${encodeURIComponent(root)}&q=`,
      { headers: LOOPBACK },
    )
    expect(res.status).toBe(200)
  })
})
