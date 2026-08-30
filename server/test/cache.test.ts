import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ThumbCache } from '../src/cache'
import { libraryFor, makeFixtures, realTempDir } from './helpers'

const cleanups: string[] = []

function tempCache(cap?: number): ThumbCache {
  const dir = mkdtempSync(join(tmpdir(), 'mb-cache-'))
  cleanups.push(dir)
  return new ThumbCache(dir, cap ?? 2 * 1024 ** 3)
}

afterEach(() => {
  while (cleanups.length > 0) rmSync(cleanups.pop()!, { recursive: true, force: true })
})

const CAM = { az: 1, el: 0, distR: 2, target: [0, 0, 0] as [number, number, number] }
const CAM2 = { az: 2, el: 1, distR: 3, target: [1, 0, 0] as [number, number, number] }

const CAP = 2 * 1024 ** 3
const PNG_A = Buffer.from('png-a')
const PNG_B = Buffer.from('png-b')
/** The one model every library tree below holds, by its library path. */
const LIB = '/kits/a/x.stl'

/**
 * `realTempDir` (every comparison here is against a real path — the library
 * resolves through realpath, and /tmp could be a symlink tomorrow), registered
 * for cleanup. The library itself comes from `helpers.ts` too: this file kept
 * its own copy of both only to avoid a merge collision that is long gone.
 */
function tempDir(prefix: string): string {
  const dir = realTempDir(prefix)
  cleanups.push(dir)
  return dir
}

/**
 * A marked library tree holding one model at `LIB`. The top is a subdirectory
 * of the temp dir, not the temp dir itself, so a test can rename it away and
 * back to play an unmounted volume.
 */
function makeLibraryTree(id: string): { top: string; model: string } {
  const top = join(tempDir('mb-lib-'), 'top')
  mkdirSync(join(top, 'kits', 'a'), { recursive: true })
  mkdirSync(join(top, '.model-browser'), { recursive: true })
  writeFileSync(join(top, '.model-browser', 'library.json'), JSON.stringify({ id, version: 1 }))
  const model = join(top, 'kits', 'a', 'x.stl')
  writeFileSync(model, 'model bytes')
  return { top, model }
}

const jsons = (dir: string): string[] => readdirSync(dir).filter((f) => f.endsWith('.json'))
const onlyFile = (dir: string, ext: string): string =>
  join(dir, readdirSync(dir).find((f) => f.endsWith(ext)) as string)

describe('ThumbCache maintenance', () => {
  it('a new mtime replaces the png in place (no superseded accumulation)', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: Buffer.from('one') })
    await cache.put(path, { mtime: 2, png: Buffer.from('two') })
    const pngs = readdirSync(cache.dir).filter((f) => f.endsWith('.png'))
    expect(pngs).toHaveLength(1)
    expect((await cache.get(path, 2)).status).toBe('hit')
    expect((await cache.get(path, 1)).status).toBe('stale')
  })

  it('sweeps whole entries (camera and axis included) when the source is gone', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const doomed = join(fx.dir, 'doomed.stl')
    writeFileSync(doomed, 'x')
    await cache.put(doomed, { mtime: 1, png: Buffer.from('png'), camera: CAM, axis: '-z' })
    unlinkSync(doomed)
    await cache.maintain()
    const res = await cache.get(doomed, 1)
    expect(res.status).toBe('miss')
    expect(res.camera).toBeUndefined()
    expect(res.axis).toBeUndefined()
    expect(readdirSync(cache.dir)).toHaveLength(0)
  })

  it('stores the axis beside the camera and reports a missing one as missing', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: Buffer.from('png'), camera: CAM })
    // A pre-axis entry stores none, and says so — callers read 'y' from that,
    // but only a caller can tell whether the absence matters to it.
    expect((await cache.get(path, 1)).axis).toBeUndefined()
    await cache.put(path, { mtime: 1, camera: CAM, axis: '-x' })
    const res = await cache.get(path, 1)
    expect(res.axis).toBe('-x')
    expect(res.status).toBe('hit') // axis write keyed by path — png keying untouched
    // A later png-only put must not drop the stored axis.
    await cache.put(path, { mtime: 2, png: Buffer.from('png2') })
    expect((await cache.get(path, 2)).axis).toBe('-x')
  })

  it('gives the camera three states — set, silent, discarded — and the axis the same three', async () => {
    // Silence has to go on meaning keep (every PNG write omits both), so
    // discarding needed a word of its own. A written default is not that word:
    // it is an orientation of the user's, and it suppresses the index that
    // would otherwise frame the model (entry-context-menu D7).
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: Buffer.from('png'), camera: CAM, axis: '-x' })
    expect((await cache.get(path, 1)).camera).toEqual(CAM) // set
    expect((await cache.get(path, 1)).axis).toBe('-x')

    await cache.put(path, { mtime: 1, png: Buffer.from('png2') }) // silent
    let res = await cache.get(path, 1)
    expect(res.camera).toEqual(CAM)
    expect(res.axis).toBe('-x')

    await cache.put(path, { mtime: 1, png: Buffer.from('png3'), camera: null }) // camera discarded
    res = await cache.get(path, 1)
    expect(res.camera).toBeUndefined()
    expect(res.axis).toBe('-x') // …and only the camera: the fields are separate

    await cache.put(path, { mtime: 1, camera: CAM, axis: 'z' })
    await cache.put(path, { mtime: 1, axis: null }) // axis discarded, on its own
    res = await cache.get(path, 1)
    expect(res.axis).toBeUndefined()
    expect(res.camera).toEqual(CAM)

    // Both at once, which is what reset framing writes when a pose can replace
    // them: the model reads back as one nobody has ever oriented.
    await cache.put(path, { mtime: 1, png: Buffer.from('png4'), camera: null, axis: null })
    res = await cache.get(path, 1)
    expect(res.camera).toBeUndefined()
    expect(res.axis).toBeUndefined()
    expect(res.status).toBe('hit') // the pixels of that write are still served
  })

  it('round-trips the lighting mode and preserves it across partial puts', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: Buffer.from('png'), camera: CAM })
    expect((await cache.get(path, 1)).lighting).toBeUndefined() // legacy entry: no stored mode
    await cache.put(path, { mtime: 1, png: Buffer.from('png'), lighting: 'camera' })
    expect((await cache.get(path, 1)).lighting).toBe('camera')
    // A camera-only put must not drop the stored lighting mode.
    await cache.put(path, { mtime: 1, camera: CAM })
    const res = await cache.get(path, 1)
    expect(res.lighting).toBe('camera')
    expect(res.status).toBe('hit')
    // The mode also rides along on stale reads (new mtime).
    expect((await cache.get(path, 2)).lighting).toBe('camera')
    // But a PNG-replacing put without a mode clears it — the old label must
    // not describe new pixels.
    await cache.put(path, { mtime: 3, png: Buffer.from('png3') })
    expect((await cache.get(path, 3)).lighting).toBeUndefined()
  })

  it('round-trips the rig version, preserves it across partial puts, clears it on unlabeled png puts', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: Buffer.from('png'), camera: CAM })
    expect((await cache.get(path, 1)).rig).toBeUndefined() // legacy entry: no stored version
    await cache.put(path, { mtime: 1, png: Buffer.from('png'), rig: 2 })
    expect((await cache.get(path, 1)).rig).toBe(2)
    // A camera-only put must not drop the stored version.
    await cache.put(path, { mtime: 1, camera: CAM })
    expect((await cache.get(path, 1)).rig).toBe(2)
    // The version rides along on stale reads (new mtime).
    expect((await cache.get(path, 5)).rig).toBe(2)
    // A PNG-replacing put without a version clears it — old label, new pixels.
    await cache.put(path, { mtime: 2, png: Buffer.from('png2') })
    expect((await cache.get(path, 2)).rig).toBeUndefined()
  })

  it('echoes the rig version on the missing-png stale branch too', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: Buffer.from('png'), camera: CAM, rig: 2 })
    for (const f of readdirSync(cache.dir)) if (f.endsWith('.png')) unlinkSync(join(cache.dir, f))
    const res = await cache.get(path, 1)
    expect(res.status).toBe('stale')
    expect(res.rig).toBe(2)
  })

  it('tests virtual-path existence against the containing zip, not the entry', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const vpath = `${fx.zipPath}!/parts/lid.stl`
    await cache.put(vpath, { mtime: 1, png: Buffer.from('png'), camera: CAM })
    await cache.maintain()
    expect((await cache.get(vpath, 1)).status).toBe('hit')

    unlinkSync(fx.zipPath)
    await cache.maintain()
    expect((await cache.get(vpath, 1)).status).toBe('miss')
  })

  it('size-cap eviction removes least-recently-read pngs but spares camera state and axis', async () => {
    const cache = tempCache(10) // tiny cap: any two pngs exceed it
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const a = join(fx.dir, 'loose.stl')
    const b = fx.zipPath
    const tick = () => new Promise((r) => setTimeout(r, 5))
    await cache.put(a, { mtime: 1, png: Buffer.from('aaaaaaaa'), camera: CAM, axis: 'z' })
    await tick()
    await cache.put(b, { mtime: 1, png: Buffer.from('bbbbbbbb'), camera: CAM })
    await tick()
    await cache.get(b, 1) // b is now more recently read than a
    await cache.maintain()

    const resA = await cache.get(a, 1)
    expect(resA.status).toBe('stale') // png gone…
    expect(resA.camera).toEqual(CAM) // …camera spared
    expect(resA.axis).toBe('z') // …axis spared too
    const pngs = readdirSync(cache.dir).filter((f) => f.endsWith('.png'))
    expect(pngs.length).toBeLessThanOrEqual(1)
  })

  it('a cap it cannot parse falls back to the default instead of evicting everything', async () => {
    // `Number('2GB')` is NaN and `total <= NaN` is false, so the knob's most
    // natural spelling emptied the cache on every sweep — a malformed value
    // doing the exact opposite of what it says.
    const dir = tempDir('mb-cache-')
    const prev = process.env.MODEL_BROWSER_CACHE_CAP
    process.env.MODEL_BROWSER_CACHE_CAP = '2GB'
    try {
      const cache = new ThumbCache(dir) // reads the environment, as production does
      const fx = makeFixtures()
      cleanups.push(fx.dir)
      const path = join(fx.dir, 'loose.stl')
      await cache.put(path, { mtime: 1, png: PNG_A, camera: CAM })
      await cache.maintain()
      expect((await cache.get(path, 1)).status).toBe('hit')
    } finally {
      if (prev === undefined) delete process.env.MODEL_BROWSER_CACHE_CAP
      else process.env.MODEL_BROWSER_CACHE_CAP = prev
    }
  })

  it('a concurrent read cannot resurrect an entry the sweep removed', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const doomed = join(fx.dir, 'doomed.stl')
    writeFileSync(doomed, 'x')
    await cache.put(doomed, { mtime: 1, png: Buffer.from('png'), camera: CAM })
    unlinkSync(doomed)
    // Hammer reads while the sweep runs: the lastRead touch must never
    // recreate the meta file the sweep just deleted.
    const reads = (async () => {
      for (let i = 0; i < 50; i++) await cache.get(doomed, 1)
    })()
    await cache.maintain()
    await reads
    expect((await cache.get(doomed, 1)).status).toBe('miss')
    expect(readdirSync(cache.dir)).toHaveLength(0)
  })

  it('runs maintenance automatically after the write threshold', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mb-cache-'))
    cleanups.push(dir)
    const cache = new ThumbCache(dir, 2 * 1024 ** 3, 2) // maintain every 2 png writes
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const doomed = join(fx.dir, 'doomed.stl')
    writeFileSync(doomed, 'x')
    await cache.put(doomed, { mtime: 1, png: Buffer.from('png'), camera: CAM })
    unlinkSync(doomed)
    await cache.put(join(fx.dir, 'loose.stl'), { mtime: 1, png: Buffer.from('png') })
    // second png write crosses the threshold → background sweep removes doomed
    for (let i = 0; i < 40 && (await cache.get(doomed, 1)).status !== 'miss'; i++) {
      await new Promise((r) => setTimeout(r, 25))
    }
    expect((await cache.get(doomed, 1)).status).toBe('miss')
  })

  it('is a no-op when the cache dir does not exist yet', async () => {
    const cache = new ThumbCache(join(tmpdir(), 'mb-does-not-exist'))
    await expect(cache.maintain()).resolves.toBeUndefined()
    expect(existsSync(cache.dir)).toBe(false)
  })
})

describe('ThumbCache under a library', () => {
  it('serves a cached thumbnail after a remount moves the tree', async () => {
    const base = tempDir('mb-cache-')
    const lib = makeLibraryTree('lib-remount')
    const cache = new ThumbCache(base, CAP, 32, libraryFor(lib.top))
    await cache.put(LIB, { mtime: 1, png: PNG_A, camera: CAM, axis: '-z' })

    // The volume comes back somewhere else, marker and all: a different mount
    // point, the same library, the same library path for the same file.
    const elsewhere = join(tempDir('mb-mount-'), 'top')
    cpSync(lib.top, elsewhere, { recursive: true })
    const remounted = new ThumbCache(base, CAP, 32, libraryFor(elsewhere))

    const res = await remounted.get(LIB, 1)
    expect(res.status).toBe('hit')
    expect(Buffer.from(res.png as string, 'base64')).toEqual(PNG_A)
    expect(res.camera).toEqual(CAM)
    expect(res.axis).toBe('-z')
  })

  it('gives two libraries with one layout and one mtime their own pngs and cameras', async () => {
    const base = tempDir('mb-cache-')
    const one = new ThumbCache(base, CAP, 32, libraryFor(makeLibraryTree('lib-one').top))
    const two = new ThumbCache(base, CAP, 32, libraryFor(makeLibraryTree('lib-two').top))
    await one.put(LIB, { mtime: 7, png: PNG_A, camera: CAM })
    await two.put(LIB, { mtime: 7, png: PNG_B, camera: CAM2 })

    const resOne = await one.get(LIB, 7)
    const resTwo = await two.get(LIB, 7)
    expect(Buffer.from(resOne.png as string, 'base64')).toEqual(PNG_A)
    expect(Buffer.from(resTwo.png as string, 'base64')).toEqual(PNG_B)
    expect(resOne.camera).toEqual(CAM)
    expect(resTwo.camera).toEqual(CAM2)
  })

  it('migrates a legacy entry under the top, camera and axis intact, png mtime preserved', async () => {
    const base = tempDir('mb-cache-')
    const lib = makeLibraryTree('lib-migrate')
    const legacy = new ThumbCache(base) // no library: yesterday's flat layout
    await legacy.put(lib.model, { mtime: 3, png: PNG_A, camera: CAM, axis: '-x', lighting: 'camera', rig: 4 })
    // A clock old enough that a copy — or a touch — could not be mistaken for it.
    const then = new Date(Date.now() - 3_600_000)
    utimesSync(onlyFile(base, '.png'), then, then)
    const wasLastRead = statSync(onlyFile(base, '.png')).mtimeMs

    const cache = new ThumbCache(base, CAP, 32, libraryFor(lib.top))
    await cache.maintain()

    // Read the clock before any get: a hit touches the png, which *is* the clock.
    const idDir = join(base, 'lib-migrate')
    expect(Math.abs(statSync(onlyFile(idDir, '.png')).mtimeMs - wasLastRead)).toBeLessThan(1)
    expect(jsons(base)).toHaveLength(0) // nothing left flat

    const res = await cache.get(LIB, 3)
    expect(res.status).toBe('hit')
    expect(Buffer.from(res.png as string, 'base64')).toEqual(PNG_A)
    expect(res.camera).toEqual(CAM)
    expect(res.axis).toBe('-x')
    expect(res.lighting).toBe('camera')
    expect(res.rig).toBe(4)
  })

  it('migrates a legacy virtual path, re-rooting the archive and leaving the entry name alone', async () => {
    const base = tempDir('mb-cache-')
    const lib = makeLibraryTree('lib-vpath')
    const zip = join(lib.top, 'kits', 'parts.zip')
    writeFileSync(zip, 'stands in for an archive: only its existence is ever tested')
    const legacy = new ThumbCache(base)
    await legacy.put(`${zip}!/lid.stl`, { mtime: 2, png: PNG_B, camera: CAM })

    const cache = new ThumbCache(base, CAP, 32, libraryFor(lib.top))
    await cache.maintain()

    const sidecar = JSON.parse(readFileSync(onlyFile(join(base, 'lib-vpath'), '.json'), 'utf8')) as { path: string }
    expect(sidecar.path).toBe('/kits/parts.zip!/lid.stl')
    const res = await cache.get('/kits/parts.zip!/lid.stl', 2)
    expect(res.status).toBe('hit')
    expect(res.camera).toEqual(CAM)
  })

  it('leaves a legacy entry recorded outside the library where it is', async () => {
    const base = tempDir('mb-cache-')
    const lib = makeLibraryTree('lib-outside')
    const stranger = join(tempDir('mb-other-'), 'y.stl')
    writeFileSync(stranger, 'y')
    const legacy = new ThumbCache(base)
    await legacy.put(stranger, { mtime: 1, png: PNG_B, camera: CAM })
    const before = jsons(base)

    const cache = new ThumbCache(base, CAP, 32, libraryFor(lib.top))
    await cache.maintain()

    expect(jsons(base)).toEqual(before)
    expect(existsSync(join(base, 'lib-outside'))).toBe(false) // nothing was claimed
    expect((await legacy.get(stranger, 1)).status).toBe('hit')
  })

  it('converges when an earlier migration moved the png but never removed the old sidecar', async () => {
    const base = tempDir('mb-cache-')
    const lib = makeLibraryTree('lib-interrupted')
    const legacy = new ThumbCache(base)
    await legacy.put(lib.model, { mtime: 5, png: PNG_A, camera: CAM, axis: 'z' })
    const oldSidecarPath = onlyFile(base, '.json')
    const oldSidecar = readFileSync(oldSidecarPath)

    // Run it through, then rewind to the half-done state the design describes:
    // pixels under the new key, no new sidecar, the old sidecar still present.
    await new ThumbCache(base, CAP, 32, libraryFor(lib.top)).maintain()
    const idDir = join(base, 'lib-interrupted')
    unlinkSync(onlyFile(idDir, '.json'))
    writeFileSync(oldSidecarPath, oldSidecar)

    const resumed = new ThumbCache(base, CAP, 32, libraryFor(lib.top))
    await resumed.maintain()

    const res = await resumed.get(LIB, 5)
    expect(res.status).toBe('hit') // the already-moved pixels are found again
    expect(res.camera).toEqual(CAM) // …and the camera travelled with the sidecar
    expect(res.axis).toBe('z')
    expect(jsons(base)).toHaveLength(0)
  })

  it('moves nothing on a second migration', async () => {
    const base = tempDir('mb-cache-')
    const lib = makeLibraryTree('lib-idempotent')
    await new ThumbCache(base).put(lib.model, { mtime: 1, png: PNG_A, camera: CAM })

    const cache = new ThumbCache(base, CAP, 32, libraryFor(lib.top))
    await cache.maintain()
    expect(await cache.migrate()).toEqual({ moved: 0, left: 0 })
    expect((await cache.get(LIB, 1)).status).toBe('hit')
  })

  it('sweeps nothing while the library is missing', async () => {
    const base = tempDir('mb-cache-')
    const lib = makeLibraryTree('lib-unmounted')
    const cache = new ThumbCache(base, CAP, 32, libraryFor(lib.top))
    await cache.put(LIB, { mtime: 1, png: PNG_A, camera: CAM })
    const idDir = join(base, 'lib-unmounted')
    const before = readdirSync(idDir).sort()

    // The volume goes away. A library evaluated while it is gone reads
    // `missing`, and an unmounted volume is not a deleted library.
    const away = `${lib.top}-unmounted`
    renameSync(lib.top, away)
    await new ThumbCache(base, CAP, 32, libraryFor(lib.top)).maintain()
    expect(readdirSync(idDir).sort()).toEqual(before)
    renameSync(away, lib.top)

    const res = await new ThumbCache(base, CAP, 32, libraryFor(lib.top)).get(LIB, 1)
    expect(res.status).toBe('hit')
    expect(res.camera).toEqual(CAM)
  })

  it('sweeps nothing when the volume vanishes under a library it already resolved', async () => {
    const base = tempDir('mb-cache-')
    const lib = makeLibraryTree('lib-vanished')
    // One library object, resolved before the volume goes. `state()` caches
    // `ready` by design (D4), so only the filesystem can still say it is gone —
    // and this is the case that would cost the whole cache, not just a restart.
    const cache = new ThumbCache(base, CAP, 32, libraryFor(lib.top))
    await cache.put(LIB, { mtime: 1, png: PNG_A, camera: CAM, axis: 'z' })
    const idDir = join(base, 'lib-vanished')
    const before = readdirSync(idDir).sort()

    const away = `${lib.top}-unplugged`
    renameSync(lib.top, away)
    await cache.maintain()
    expect(readdirSync(idDir).sort()).toEqual(before)
    renameSync(away, lib.top)

    const res = await cache.get(LIB, 1)
    expect(res.status).toBe('hit')
    expect(res.camera).toEqual(CAM)
    expect(res.axis).toBe('z')
  })

  it('sweeps a legacy entry whose file is gone out of the flat directory', async () => {
    const base = tempDir('mb-cache-')
    const lib = makeLibraryTree('lib-legacy-sweep')
    const doomed = join(tempDir('mb-other-'), 'doomed.stl')
    writeFileSync(doomed, 'x')
    await new ThumbCache(base).put(doomed, { mtime: 1, png: PNG_A, camera: CAM })
    unlinkSync(doomed)

    await new ThumbCache(base, CAP, 32, libraryFor(lib.top)).maintain()

    // Nobody claimed it and nothing else will ever read it: sidecar and png go.
    expect(readdirSync(base)).toHaveLength(0)
  })

  it('reads an unmounted volume as unmounted, and a deleted file as deleted', async () => {
    // The flat directory holds *other* libraries' entries, recorded by absolute
    // path. Stat'ing the file alone cannot tell a deletion from a volume that
    // is not plugged in, and reading the second as the first took every
    // camera of every library that happened to be unmounted — the loss D5
    // leaves those entries in place to avoid.
    const base = tempDir('mb-cache-')
    const lib = makeLibraryTree('lib-legacy-mount')
    const vol = join(tempDir('mb-mountpoint-'), 'OTHERVOL')
    const kit = join(vol, 'Kit')
    mkdirSync(kit, { recursive: true })
    const stranger = join(kit, 'x.stl')
    writeFileSync(stranger, 'x')
    const legacy = new ThumbCache(base)
    await legacy.put(stranger, { mtime: 1, png: PNG_B, camera: CAM })
    const before = jsons(base)

    // Unplugged: the file is gone and so is everything above it.
    rmSync(vol, { recursive: true, force: true })
    await new ThumbCache(base, CAP, 32, libraryFor(lib.top)).maintain()
    expect(jsons(base)).toEqual(before)

    // Back on the same mount point, it is the entry it always was.
    mkdirSync(kit, { recursive: true })
    writeFileSync(stranger, 'x')
    expect((await legacy.get(stranger, 1)).camera).toEqual(CAM)

    // Mounted, and the file itself deleted: now the directory says it was a
    // deletion, and the whole entry goes.
    unlinkSync(stranger)
    await new ThumbCache(base, CAP, 32, libraryFor(lib.top)).maintain()
    expect(readdirSync(base).filter((f) => !statSync(join(base, f)).isDirectory())).toEqual([])
  })

  it('sweeps an entry out of the library directory when its file no longer resolves', async () => {
    const base = tempDir('mb-cache-')
    const lib = makeLibraryTree('lib-gone')
    const cache = new ThumbCache(base, CAP, 32, libraryFor(lib.top))
    await cache.put(LIB, { mtime: 1, png: PNG_A, camera: CAM, axis: 'z' })
    unlinkSync(lib.model)

    await cache.maintain()

    const res = await cache.get(LIB, 1)
    expect(res.status).toBe('miss')
    expect(res.camera).toBeUndefined()
    expect(res.axis).toBeUndefined()
    expect(readdirSync(join(base, 'lib-gone'))).toHaveLength(0)
  })
})
