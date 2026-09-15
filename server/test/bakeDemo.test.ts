import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type BakeModel,
  type ManifestInput,
  type ManifestRecipe,
  auditUnposed,
  indexFingerprint,
  manifestFor,
  manifestPath,
  rsyncCommand,
  sidecarKey,
  verifyBake,
  writeManifest,
} from '../../scripts/bake-demo'
import { ThumbCache } from '../src/cache'
import { libraryFor, realTempDir } from './helpers'

/**
 * The bake script's core, exercised as functions (corpus-bake task 1.2) the way
 * `genOverrides.test.ts` exercises `gen-overrides.ts`. The fixture store is
 * written by `ThumbCache.put` itself — never by hand — so its sidecars are the
 * real shape and cannot drift from the writer `verifyBake` reads.
 *
 * The recipe is a value here, not the client's constants: `renderer.ts`
 * imports `three`, which this workspace does not have (design Context). What
 * these cells pin is the *comparison*; the constants are the client suite's.
 */
const RECIPE: ManifestRecipe = { rig: 7, poseVersion: 2, lighting: 'camera', size: 256 }
const POSE_KEY = 'v3@40/20'
const CAP = 2 * 1024 ** 3

const MODELS: BakeModel[] = [
  { path: '/kit/a.stl', mtime: 1000 },
  { path: '/kit/b.stl', mtime: 2000 },
  { path: '/kit/c.stl', mtime: 3000 },
]

interface Store {
  cacheDir: string
  id: string
  cache: ThumbCache
  /** The id directory — where the sidecars and renders lie. */
  dir: string
}

/**
 * A library of three models with a cache beside it, every write through
 * `put`. `maintainEvery` is set high so no background sweep runs while a cell
 * is reading the directory.
 */
async function store(): Promise<Store> {
  const top = realTempDir('mb-bake-lib-')
  mkdirSync(join(top, 'kit'))
  for (const m of MODELS) writeFileSync(join(top, m.path.slice(1)), 'model bytes')
  const library = libraryFor(top)
  await library.state()
  const id = library.id()
  const cacheDir = realTempDir('mb-bake-cache-')
  const cache = new ThumbCache(cacheDir, CAP, 1_000_000, library)
  return { cacheDir, id, cache, dir: join(cacheDir, id) }
}

type Labels = { mtime?: number; rig?: number; posed?: number; poseKey?: string }

/** One render of `model`, at the recipe unless a label is overridden. */
async function render(s: Store, model: BakeModel, ao: boolean, labels: Labels = {}): Promise<void> {
  await s.cache.put(model.path, {
    mtime: labels.mtime ?? model.mtime,
    png: Buffer.from(`webp ${model.path} ${ao ? 'ao' : 'noao'}`),
    lighting: RECIPE.lighting,
    rig: labels.rig ?? RECIPE.rig,
    posed: labels.posed,
    poseKey: labels.poseKey,
    ao,
  })
}

const POSED: Labels = { posed: RECIPE.poseVersion, poseKey: POSE_KEY }

/** The complete store: `a` and `b` posed on both renders, `c` unposed on both. */
async function completeStore(): Promise<Store> {
  const s = await store()
  for (const ao of [true, false]) {
    await render(s, MODELS[0]!, ao, POSED)
    await render(s, MODELS[1]!, ao, POSED)
    await render(s, MODELS[2]!, ao)
  }
  return s
}

const missFor = (misses: { path: string; reasons: string[] }[], path: string) => misses.find((m) => m.path === path)

describe('verifyBake', () => {
  it('passes a complete store with the right counts and lists its unlabelled paths', async () => {
    const s = await completeStore()
    const r = await verifyBake(s.cacheDir, s.id, MODELS, RECIPE)
    expect(r.misses).toEqual([])
    expect(r.renders).toEqual({ ao: 3, noao: 3 })
    expect(r.posed).toBe(2)
    expect(r.unposed).toBe(1)
    expect(r.unlabelled).toEqual(['/kit/c.stl'])
    expect(r.refusal).toBeNull()
  })

  it('lists a model missing its .noao.webp', async () => {
    const s = await completeStore()
    const key = sidecarKey('/kit/b.stl')
    rmSync(join(s.dir, `${key}.noao.webp`))
    const r = await verifyBake(s.cacheDir, s.id, MODELS, RECIPE)
    expect(r.misses.map((m) => m.path)).toEqual(['/kit/b.stl'])
    expect(missFor(r.misses, '/kit/b.stl')!.reasons).toEqual([`no ${key}.noao.webp`])
    expect(r.renders).toEqual({ ao: 3, noao: 2 })
    expect(r.refusal).not.toBeNull()
  })

  it('lists a noao label at another mtime', async () => {
    const s = await completeStore()
    // An older mtime, so the write does not supersede the occluded sibling
    // (`put` deletes the sibling only for a strictly newer one): the top-level
    // labels stay right and only `noao` disagrees with the model.
    await render(s, MODELS[0]!, false, { ...POSED, mtime: 999 })
    const r = await verifyBake(s.cacheDir, s.id, MODELS, RECIPE)
    expect(r.misses.map((m) => m.path)).toEqual(['/kit/a.stl'])
    expect(missFor(r.misses, '/kit/a.stl')!.reasons).toEqual(['noao: mtime 999, model 1000'])
    expect(r.refusal).not.toBeNull()
  })

  it('lists a rig behind by one', async () => {
    const s = await completeStore()
    await render(s, MODELS[1]!, true, { ...POSED, rig: RECIPE.rig - 1 })
    const r = await verifyBake(s.cacheDir, s.id, MODELS, RECIPE)
    expect(r.misses.map((m) => m.path)).toEqual(['/kit/b.stl'])
    expect(missFor(r.misses, '/kit/b.stl')!.reasons).toEqual([`ao: rig ${RECIPE.rig - 1}, recipe ${RECIPE.rig}`])
  })

  it('lists posed carried without a poseKey, on both renders', async () => {
    const s = await completeStore()
    for (const ao of [true, false]) await render(s, MODELS[2]!, ao, { posed: RECIPE.poseVersion })
    const r = await verifyBake(s.cacheDir, s.id, MODELS, RECIPE)
    expect(r.misses.map((m) => m.path)).toEqual(['/kit/c.stl'])
    expect(missFor(r.misses, '/kit/c.stl')!.reasons).toEqual([
      'ao: posed without a poseKey',
      'noao: posed without a poseKey',
    ])
    // Counted as posed — it carries the label — so it is not handed to the
    // pose audit as unlabelled; the miss is what refuses it.
    expect(r.posed).toBe(3)
    expect(r.unposed).toBe(0)
    expect(r.unlabelled).toEqual([])
    expect(r.refusal).not.toBeNull()
  })

  it('refuses zero posed — the unposed corpus-wide bake by another road', async () => {
    const s = await store()
    for (const ao of [true, false]) for (const m of MODELS) await render(s, m, ao)
    const r = await verifyBake(s.cacheDir, s.id, MODELS, RECIPE)
    expect(r.misses).toEqual([])
    expect(r.posed).toBe(0)
    expect(r.unposed).toBe(3)
    expect(r.unlabelled).toEqual(MODELS.map((m) => m.path))
    expect(r.refusal).toMatch(/no model is posed/)
  })

  it('lists a model with no sidecar at all, with both renders missing', async () => {
    const s = await completeStore()
    const missing: BakeModel = { path: '/kit/d.stl', mtime: 4000 }
    const r = await verifyBake(s.cacheDir, s.id, [...MODELS, missing], RECIPE)
    const key = sidecarKey(missing.path)
    expect(missFor(r.misses, missing.path)!.reasons).toEqual([
      `no ${key}.webp`,
      `no ${key}.noao.webp`,
      `no sidecar ${key}.json`,
    ])
    expect(r.refusal).toBe('1 of 4 models fail verification')
  })
})

describe('auditUnposed', () => {
  const paths = ['/kit/c.stl', '/kit/base.stl', '/kit/terrain.stl']
  const pose = {
    up: [0, 0, 1] as [number, number, number],
    azimuth_zero: [1, 0, 0] as [number, number, number],
    source: 'index',
    confidence: 0.9,
    front: { view: 3, azimuth_deg: 40, elevation_deg: 20 },
  }

  it('answers empty lists when every path is present and null', () => {
    const answer = Object.fromEntries(paths.map((p) => [p, null]))
    expect(auditUnposed(paths, answer)).toEqual({ unsettled: [], shouldHavePosed: [] })
  })

  it('names a path absent from the answer as unsettled', () => {
    const answer = Object.fromEntries(paths.filter((p) => p !== '/kit/base.stl').map((p) => [p, null]))
    expect(auditUnposed(paths, answer)).toEqual({ unsettled: ['/kit/base.stl'], shouldHavePosed: [] })
  })

  it('names a path answered with a pose as should-have-been-posed', () => {
    const answer = { ...Object.fromEntries(paths.map((p) => [p, null])), '/kit/terrain.stl': pose }
    expect(auditUnposed(paths, answer)).toEqual({ unsettled: [], shouldHavePosed: ['/kit/terrain.stl'] })
  })
})

describe('rsyncCommand', () => {
  it('is the D4 command: snapshots excluded, both trailing slashes, no --delete', () => {
    const expected =
      "rsync -az --info=progress2 --exclude 'snapshots/' /home/me/.cache/model-browser-bake/cache/local-id/ root@157.90.25.110:/srv/cache/box-id/"
    expect(rsyncCommand('/home/me/.cache/model-browser-bake/cache', 'local-id', 'root@157.90.25.110', '/srv/cache/box-id')).toBe(expected)
    // A box directory typed with its own slash gets exactly one.
    expect(rsyncCommand('/home/me/.cache/model-browser-bake/cache/', 'local-id', 'root@157.90.25.110', '/srv/cache/box-id/')).toBe(expected)
    expect(expected).not.toContain('--delete')
  })
})

const INDEX_HASH_A = createHash('sha256').update('{"poses":1}').digest('hex')
const INDEX_HASH_B = createHash('sha256').update('{"views":8}').digest('hex')

function manifestInput(): ManifestInput {
  return {
    date: '2026-09-15T12:00:00.000Z',
    client: { commit: 'abc123', dirty: false },
    recipe: RECIPE,
    library: { id: 'local-id', root: '/home/me/decimated' },
    models: 3,
    verify: { renders: { ao: 3, noao: 3 }, posed: 2, unposed: 1 },
    passes: { ao: { rendered: 3, elapsed: 0.4 }, noao: { rendered: 3, elapsed: 0.3 } },
    index: {
      collectionRoot: '/',
      cacheDir: 'embed-cache-test',
      // The index's own n_models — not the enumeration's 3 (D2's Names).
      models: 2,
      views: 8,
      elevations: [20],
      upAxis: 'auto',
      poseCacheSha256: INDEX_HASH_A,
      runParamsSha256: INDEX_HASH_B,
    },
  }
}

/** Lines of `text` that carry the key `name`, as the check on the box would read them. */
const keyLines = (text: string, name: string) => text.split('\n').filter((l) => new RegExp(`^ *"${name}": `).test(l))

describe('manifest', () => {
  it('writes exactly JSON.stringify(manifestFor(...), null, 2) into <cache>/<id>/bake/bake.json', async () => {
    const cacheDir = realTempDir('mb-bake-manifest-')
    const input = manifestInput()
    const file = await writeManifest(cacheDir, 'local-id', manifestFor(input))
    expect(file).toBe(manifestPath(cacheDir, 'local-id'))
    expect(file).toBe(join(cacheDir, 'local-id', 'bake', 'bake.json'))
    const text = await readFile(file, 'utf8')
    expect(text).toBe(JSON.stringify(manifestFor(input), null, 2))
  })

  it('carries the pinned key names once each, and no key named posed or sha256', () => {
    const text = JSON.stringify(manifestFor(manifestInput()), null, 2)
    for (const name of ['rig', 'poseVersion', 'posedModels', 'unposedModels', 'poseCacheSha256', 'runParamsSha256']) {
      expect(keyLines(text, name), name).toHaveLength(1)
    }
    expect(keyLines(text, 'posed')).toHaveLength(0)
    expect(keyLines(text, 'sha256')).toHaveLength(0)
    // Where each lives, and what it says.
    expect(text).toContain(`"poseVersion": ${RECIPE.poseVersion},`)
    expect(text).toContain('"posedModels": 2,')
    expect(text).toContain('"unposedModels": 1,')
    expect(text).toContain(`"poseCacheSha256": "${INDEX_HASH_A}",`)
    expect(text).toContain(`"runParamsSha256": "${INDEX_HASH_B}"`)
  })

  it('takes D2 shape: key order, index.models from the index, rates and elapsed derived', () => {
    const m = manifestFor(manifestInput())
    expect(Object.keys(m)).toEqual([
      'version', 'date', 'client', 'recipe', 'library', 'models', 'renders',
      'posedModels', 'unposedModels', 'rate', 'elapsed', 'index',
    ])
    expect(Object.keys(m.index)).toEqual([
      'collectionRoot', 'cacheDir', 'models', 'views', 'elevations', 'upAxis', 'poseCacheSha256', 'runParamsSha256',
    ])
    // D2's sample is introduced as "the shape, as the writer emits it", so the
    // block's order is pinned too — an operator diffs a real bake.json against it.
    expect(Object.keys(m.client)).toEqual(['commit', 'dirty'])
    expect(m.version).toBe(1)
    expect(m.models).toBe(3)
    expect(m.index.models).toBe(2)
    expect(m.recipe).toEqual({ rig: 7, poseVersion: 2, lighting: 'camera', size: 256 })
    expect(m.rate).toEqual({ ao: 7.5, noao: 10 })
    expect(m.elapsed).toEqual({ ao: 0.4, noao: 0.3, total: 0.7 })
  })

  it('omits client.commit when git could not answer, and never writes Infinity', () => {
    const input = manifestInput()
    delete input.client.commit
    input.passes.ao.elapsed = 0
    const m = manifestFor(input)
    expect('commit' in m.client).toBe(false)
    expect(Object.keys(m.client)).toEqual(['dirty'])
    expect(m.rate.ao).toBe(0)
    expect(JSON.stringify(m)).not.toContain('null')
  })
})

describe('indexFingerprint', () => {
  it('hashes pose-cache.json and run-params.json each under its own key', async () => {
    const dir = realTempDir('mb-bake-index-')
    writeFileSync(join(dir, 'pose-cache.json'), '{"poses":1}')
    writeFileSync(join(dir, 'run-params.json'), '{"views":8}')
    expect(await indexFingerprint(dir)).toEqual({ poseCacheSha256: INDEX_HASH_A, runParamsSha256: INDEX_HASH_B })
  })

  it('rejects when either file is missing rather than fingerprinting half an index', async () => {
    const dir = realTempDir('mb-bake-index-')
    writeFileSync(join(dir, 'pose-cache.json'), '{"poses":1}')
    await expect(indexFingerprint(dir)).rejects.toThrow(/run-params\.json/)
  })
})
