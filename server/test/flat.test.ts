import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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

const cacheDir = mkdtempSync(join(tmpdir(), 'mb-cache-'))
const app = createApp(new ThumbCache(cacheDir))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(cacheDir, { recursive: true, force: true })
})

afterEach(() => {
  delete process.env.MODEL_BROWSER_FLAT_CAP
  delete process.env.MODEL_BROWSER_FLAT_BUDGET
})

async function flat(path: string, flag = 'true'): Promise<DirListing> {
  const res = await app.request(
    `/api/dir?path=${encodeURIComponent(path)}&flat=${flag}`,
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
  it('zip root: immediate dirs and zip tiles, then models relative to the archive', async () => {
    const body = await flat(zipPath)
    expect(body.entries.map((e) => e.name)).toEqual([
      'arms',
      'v2.zip',
      'inner.zip',
      'box.stl',
      'v2.zip/deep2.stl',
      'arms/left.stl',
    ])
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

  it('404s on an unreadable root', async () => {
    const res = await app.request(
      `/api/dir?path=${encodeURIComponent(join(root, 'nope'))}&flat=true`,
      { headers: LOOPBACK },
    )
    expect(res.status).toBe(404)
  })
})
