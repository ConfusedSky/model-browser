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
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThumbGetResponse } from '../../shared/types'
import { createApp } from '../src/app'
import { StaleWriteError, ThumbCache } from '../src/cache'
import { LOOPBACK, libraryFor, makeFixtures, realTempDir } from './helpers'

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
const PNG_NEW = Buffer.from('png-new')
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

/**
 * A cache that can run one `put` inside `maintain`'s size-cap pass, in the
 * window that pass has to defend: `readMeta` is called twice for an eviction
 * candidate — once for the snapshot at the top of `maintain`, once as the
 * re-read that guards the eviction — so arming on the *second* read of a key
 * lands the put exactly between them, deterministically and without a timer.
 */
class InterposingCache extends ThumbCache {
  // `Promise<unknown>`, not `Promise<void>`: every cell arms a `put`, which
  // returns the generation it wrote (`immutable-thumbnail-serving`). Nothing
  // here reads that value — the interposition is about *when* the write lands —
  // so the callback's result is deliberately unconstrained rather than
  // discarded at each call site.
  private armed: { key: string; run: () => Promise<unknown> } | null = null
  private reads = 0
  /**
   * Did the armed `run` actually fire? Every cell must assert this
   * **immediately after `maintain()` and before any `get`**, because the trigger
   * counts reads of the key rather than the caller making them: a `maintain`
   * that reads each sidecar only once — the pass this whole window exists to
   * defend, before it re-read anything — leaves the second read to the cell's
   * own post-sweep `get`, and the put then lands *after* the sweep, where every
   * assertion about the fresh png and camera passes for the wrong reason. Both
   * cells here did exactly that against the unfixed pass.
   */
  fired = false

  /** Run `run` after the snapshot has read `path`'s sidecar, before the re-read. */
  arm(path: string, run: () => Promise<unknown>): void {
    this.armed = { key: createHash('sha256').update(path).digest('hex'), run }
    this.reads = 0
    this.fired = false
  }

  protected override async readMeta(dir: string, key: string) {
    if (this.armed !== null && key === this.armed.key && ++this.reads === 2) {
      const { run } = this.armed
      this.armed = null // exactly once — `run`'s own put reads this sidecar too
      this.fired = true
      await run()
    }
    return super.readMeta(dir, key)
  }
}

describe('ThumbCache maintenance', () => {
  it('a new mtime replaces the png in place (no superseded accumulation)', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: Buffer.from('one') })
    await cache.put(path, { mtime: 2, png: Buffer.from('two') })
    const pngs = readdirSync(cache.dir).filter((f) => f.endsWith('.webp'))
    expect(pngs).toHaveLength(1)
    expect((await cache.get(path, 2)).status).toBe('hit')
    expect((await cache.get(path, 1)).status).toBe('stale')
  })

  /**
   * `webp-thumbnails`: renders stored under the encoding this app produced
   * before it. `renderFile` cannot name them, so nothing measures, evicts or
   * sweeps them unless the store is told about them — these cells are what say
   * it is. The bytes are arbitrary; what is under test is the file.
   */
  describe('a superseded encoding leaves no stored bytes behind', () => {
    const supersededName = (path: string, ao = true) =>
      `${createHash('sha256').update(path).digest('hex')}${ao ? '' : '.noao'}.png`

    it('a write reclaims what the same render was stored as before', async () => {
      const cache = tempCache()
      const fx = makeFixtures()
      cleanups.push(fx.dir)
      const path = join(fx.dir, 'loose.stl')
      await cache.put(path, { mtime: 1, png: PNG_A })
      writeFileSync(join(cache.dir, supersededName(path)), PNG_B)
      writeFileSync(join(cache.dir, supersededName(path, false)), PNG_B)

      await cache.put(path, { mtime: 1, png: PNG_NEW })

      // Exactly the render written: a plain write does not touch the sibling —
      // `supersedes` is what reaches across, and this write supersedes nothing.
      // The sibling's orphan is the maintenance pass's, as the next cell shows.
      expect(readdirSync(cache.dir).filter((f) => f.endsWith('.png'))).toEqual([
        supersededName(path, false),
      ])
      expect(Buffer.from((await cache.get(path, 1)).png as string, 'base64')).toEqual(PNG_NEW)

      await cache.maintain()
      expect(readdirSync(cache.dir).filter((f) => f.endsWith('.png'))).toEqual([])
    })

    it('the maintenance pass reclaims one nothing else would ever meet again', async () => {
      const cache = tempCache()
      const fx = makeFixtures()
      cleanups.push(fx.dir)
      const path = join(fx.dir, 'loose.stl')
      // The shape an upgrade leaves: a sidecar under the old recipe whose pixels
      // are in the old encoding, and no current render at all.
      await cache.put(path, { mtime: 1, png: PNG_A, rig: 6 })
      unlinkSync(join(cache.dir, `${createHash('sha256').update(path).digest('hex')}.webp`))
      writeFileSync(join(cache.dir, supersededName(path)), PNG_B)

      await cache.maintain()

      expect(readdirSync(cache.dir).filter((f) => f.endsWith('.png'))).toEqual([])
      // The entry itself survives — it is the pixels that were superseded, and
      // the client re-renders them under the current recipe.
      expect((await cache.get(path, 1)).status).toBe('stale')
    })

    // What an upgrade interrupted midway leaves: pixels whose sidecar was
    // already rewritten or removed. No per-entry loop reaches those, which is
    // why the pass reads the directory's own names.
    it('reclaims an orphan whose sidecar is gone', async () => {
      const cache = tempCache()
      const fx = makeFixtures()
      cleanups.push(fx.dir)
      const path = join(fx.dir, 'loose.stl')
      await cache.put(path, { mtime: 1, png: PNG_A })
      writeFileSync(join(cache.dir, `${'0'.repeat(64)}.png`), PNG_B)

      await cache.maintain()

      expect(readdirSync(cache.dir).filter((f) => f.endsWith('.png'))).toEqual([])
      expect((await cache.get(path, 1)).status).toBe('hit')
    })

    it('a deleted model takes its superseded render with it', async () => {
      const cache = tempCache()
      const fx = makeFixtures()
      cleanups.push(fx.dir)
      const doomed = join(fx.dir, 'doomed.stl')
      writeFileSync(doomed, 'x')
      await cache.put(doomed, { mtime: 1, png: PNG_A })
      writeFileSync(join(cache.dir, supersededName(doomed)), PNG_B)
      unlinkSync(doomed)

      await cache.maintain()

      expect(readdirSync(cache.dir)).toHaveLength(0)
    })

    it('re-filing a flat entry leaves none of its pixels flat', async () => {
      const base = tempDir('mb-cache-')
      const lib = makeLibraryTree('lib-superseded')
      const legacy = new ThumbCache(base)
      await legacy.put(lib.model, { mtime: 3, png: PNG_A, camera: CAM, axis: '-x', rig: 6 })
      // What a pre-`webp-thumbnails` flat cache actually holds: the pixels under
      // the old name. The rename cannot see them, so before this rule they
      // stayed in the flat directory with no sidecar describing them.
      renameSync(
        onlyFile(base, '.webp'),
        join(base, supersededName(lib.model)),
      )

      const cache = new ThumbCache(base, CAP, 32, libraryFor(lib.top))
      await cache.maintain()

      expect(readdirSync(base).filter((f) => f.endsWith('.png'))).toEqual([])
      // The half migration exists to keep still arrives: the orientation.
      const res = await cache.get(LIB, 3)
      expect(res.camera).toEqual(CAM)
      expect(res.axis).toBe('-x')
    })
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
    for (const f of readdirSync(cache.dir)) if (f.endsWith('.webp')) unlinkSync(join(cache.dir, f))
    const res = await cache.get(path, 1)
    expect(res.status).toBe('stale')
    expect(res.rig).toBe(2)
  })

  it('round-trips the pose key like the rig: kept across partial puts, echoed on stale reads, cleared on unlabeled png puts', async () => {
    // `pose-rerender` D3: the key is a label of the pixels, with the same
    // contract as `rig` — stored and echoed, never interpreted, and gone when
    // the pixels are replaced without it.
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: Buffer.from('png'), camera: CAM, rig: 2, posed: 2, poseKey: 'z:3.9270:0.3491' })
    expect((await cache.get(path, 1)).poseKey).toBe('z:3.9270:0.3491')
    // A camera-only put that moves nothing must not drop it (one that moves
    // the camera clears every recipe label, the key included — the rig's rule).
    await cache.put(path, { mtime: 1, camera: CAM })
    expect((await cache.get(path, 1)).poseKey).toBe('z:3.9270:0.3491')
    // It rides along on a stale read (new mtime)…
    expect((await cache.get(path, 5)).poseKey).toBe('z:3.9270:0.3491')
    // …and on the missing-png stale branch.
    for (const f of readdirSync(cache.dir)) if (f.endsWith('.webp')) unlinkSync(join(cache.dir, f))
    const missing = await cache.get(path, 1)
    expect(missing.status).toBe('stale')
    expect(missing.poseKey).toBe('z:3.9270:0.3491')
    // A PNG-replacing put without it clears it — old label, new pixels.
    await cache.put(path, { mtime: 2, png: Buffer.from('png2'), rig: 2, posed: 2 })
    expect((await cache.get(path, 2)).posed).toBe(2)
    expect((await cache.get(path, 2)).poseKey).toBeUndefined()
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
    const pngs = readdirSync(cache.dir).filter((f) => f.endsWith('.webp'))
    expect(pngs.length).toBeLessThanOrEqual(1)
  })

  /**
   * The size cap evicts from a snapshot of every sidecar taken at the top of
   * `maintain`. A `put` landing after that snapshot used to have its PNG
   * deleted and its camera reverted to the snapshot; the pass now re-reads the
   * sidecar and re-stats the PNG immediately before evicting. The three cells
   * below drive that window through `InterposingCache`, and each asserts
   * `cache.fired` before it reads anything back — see the field's own comment
   * for what passes vacuously otherwise.
   */
  it('spares an entry a mid-sweep put re-rendered, png and camera both', async () => {
    const dir = tempDir('mb-cache-')
    const cache = new InterposingCache(dir, 10) // tiny cap: any two pngs exceed it
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const a = join(fx.dir, 'loose.stl')
    const b = fx.zipPath
    const tick = () => new Promise((r) => setTimeout(r, 5))
    await cache.put(a, { mtime: 1, png: Buffer.from('aaaaaaaa'), camera: CAM })
    await tick()
    await cache.put(b, { mtime: 1, png: Buffer.from('bbbbbbbb'), camera: CAM })
    await tick()
    await cache.get(b, 1) // a is now the least-recently-read: the eviction victim
    cache.arm(a, () => cache.put(a, { mtime: 2, png: PNG_NEW, camera: CAM2 }))
    await cache.maintain()
    expect(cache.fired).toBe(true) // the put landed *inside* the pass, not after it

    const res = await cache.get(a, 2)
    expect(res.status).toBe('hit') // the png written mid-sweep is still there…
    expect(Buffer.from(res.png as string, 'base64')).toEqual(PNG_NEW)
    expect(res.camera).toEqual(CAM2) // …and the snapshot did not revert the camera
    // Skipped, not counted: the cap still had to be met, so b paid instead.
    expect((await cache.get(b, 1)).status).toBe('stale')
  })

  it('keeps a camera-only put that lands mid-sweep while still clearing the png', async () => {
    const dir = tempDir('mb-cache-')
    const cache = new InterposingCache(dir, 10)
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const a = join(fx.dir, 'loose.stl')
    const b = fx.zipPath
    const tick = () => new Promise((r) => setTimeout(r, 5))
    await cache.put(a, { mtime: 1, png: Buffer.from('aaaaaaaa'), camera: CAM })
    await tick()
    await cache.put(b, { mtime: 1, png: Buffer.from('bbbbbbbb'), camera: CAM })
    await tick()
    await cache.get(b, 1)
    // No new pixels, so the mtime does not move: this entry *is* still a cap
    // candidate, and the eviction must write back the camera it now holds.
    cache.arm(a, () => cache.put(a, { mtime: 1, camera: CAM2 }))
    await cache.maintain()
    expect(cache.fired).toBe(true) // the put landed *inside* the pass, not after it

    const res = await cache.get(a, 1)
    expect(res.status).toBe('stale') // png evicted and mtime cleared, as the cap requires
    expect(res.camera).toEqual(CAM2) // the mid-sweep camera, not the snapshot's CAM
  })

  /**
   * The mtime in a sidecar is the *model's*, and the re-renders that actually
   * race the sweep leave it alone: an orbit persist, a RIG_VERSION bump, a pose
   * recipe change all write new pixels for a file nobody edited. So "the mtime
   * did not move" says nothing about whether the PNG the snapshot measured is
   * still the PNG on disk — which is why the pass stats the PNG rather than
   * comparing mtimes.
   */
  it('spares a mid-sweep re-render that writes new pixels at the same model mtime', async () => {
    const dir = tempDir('mb-cache-')
    const cache = new InterposingCache(dir, 10)
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const a = join(fx.dir, 'loose.stl')
    const b = fx.zipPath
    const tick = () => new Promise((r) => setTimeout(r, 5))
    await cache.put(a, { mtime: 1, png: Buffer.from('aaaaaaaa'), camera: CAM, rig: 1 })
    await tick()
    await cache.put(b, { mtime: 1, png: Buffer.from('bbbbbbbb'), camera: CAM })
    await tick()
    await cache.get(b, 1) // a is now the least-recently-read: the eviction victim
    // Same model, same mtime, new pixels under a new rig — the shape of every
    // re-render the running app queues.
    cache.arm(a, () => cache.put(a, { mtime: 1, png: PNG_NEW, camera: CAM2, rig: 2 }))
    await cache.maintain()
    expect(cache.fired).toBe(true) // the put landed *inside* the pass, not after it

    const res = await cache.get(a, 1)
    expect(res.status).toBe('hit') // the png written mid-sweep is still there…
    expect(Buffer.from(res.png as string, 'base64')).toEqual(PNG_NEW) // …and it is the new one
    expect(res.rig).toBe(2) // the label the new pixels came with
    expect(res.camera).toEqual(CAM2)
    // Skipped, not counted: the cap still had to be met, so b paid instead.
    expect((await cache.get(b, 1)).status).toBe('stale')
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
    utimesSync(onlyFile(base, '.webp'), then, then)
    const wasLastRead = statSync(onlyFile(base, '.webp')).mtimeMs

    const cache = new ThumbCache(base, CAP, 32, libraryFor(lib.top))
    await cache.maintain()

    // Read the clock before any get: a hit touches the png, which *is* the clock.
    const idDir = join(base, 'lib-migrate')
    expect(Math.abs(statSync(onlyFile(idDir, '.webp')).mtimeMs - wasLastRead)).toBeLessThan(1)
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

/**
 * Two renders per model, one orientation between them (`ao-as-recipe-dimension`
 * D1–D3). The occluded render is `<key>.webp` with its labels at the top level of
 * the sidecar — exactly the entry every existing cache holds — and the
 * unoccluded one is `<key>.noao.webp` with its labels under `noao`.
 */
describe('ThumbCache occlusion renders', () => {
  const pngsOf = (dir: string): string[] =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.webp'))
      .sort()

  it('serves an entry written before the split as the occluded render, under `ao` absent and true alike', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: PNG_A, rig: 2, lighting: 'camera' })

    // No `ao` argument at all — every caller before this change — and `true`
    // must answer identically, and identically to what they answered before.
    for (const res of [await cache.get(path, 1), await cache.get(path, 1, true)]) {
      expect(res.status).toBe('hit')
      expect(Buffer.from(res.png as string, 'base64')).toEqual(PNG_A)
      expect(res.rig).toBe(2)
    }
    // …and the sidecar it wrote is the old shape: no `noao` key at all, which
    // is the whole of the no-migration claim (D1).
    const sidecar = JSON.parse(readFileSync(onlyFile(cache.dir, '.json'), 'utf8')) as Record<string, unknown>
    expect('noao' in sidecar).toBe(false)
    expect(pngsOf(cache.dir)).toHaveLength(1)
  })

  it('reads the unoccluded render of an occluded-only entry as a miss, or stale once a camera is held', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    // No camera: nothing is stored about this render, and nothing about this
    // model's orientation either, so there is nothing to answer with.
    await cache.put(path, { mtime: 1, png: PNG_A, axis: '-z', rig: 2 })
    let res = await cache.get(path, 1, false)
    expect(res.status).toBe('miss') // an axis alone is not an orientation to re-render from
    expect(res.axis).toBe('-z') // …but it is still the entry's, and still carried
    expect(res.rig).toBeUndefined() // the occluded render's label is not this render's

    // With a camera stored, the first read of the unoccluded render is stale:
    // the client draws it at the orientation the occluded one already has.
    await cache.put(path, { mtime: 1, camera: CAM })
    res = await cache.get(path, 1, false)
    expect(res.status).toBe('stale')
    expect(res.camera).toEqual(CAM)
    expect(res.axis).toBe('-z')
    expect(res.png).toBeUndefined()
    // The occluded render is untouched by either read.
    expect((await cache.get(path, 1, true)).status).toBe('hit')
  })

  it('writes the sibling render without disturbing the occluded one, and both then hit', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: PNG_A, camera: CAM, axis: 'z', rig: 2, lighting: 'camera' })
    // The ordinary render PUT of the other setting: pixels and labels, no
    // camera. It must leave the occluded render exactly as it was, or
    // "toggling back is a lookup" is unreachable.
    await cache.put(path, { mtime: 1, png: PNG_B, ao: false, rig: 3, lighting: 'camera' })

    const occ = await cache.get(path, 1, true)
    expect(occ.status).toBe('hit')
    expect(Buffer.from(occ.png as string, 'base64')).toEqual(PNG_A)
    expect(occ.rig).toBe(2) // its own label, not the sibling's

    const no = await cache.get(path, 1, false)
    expect(no.status).toBe('hit')
    expect(Buffer.from(no.png as string, 'base64')).toEqual(PNG_B)
    expect(no.rig).toBe(3)
    // Shared, and returned on a read of either.
    expect(no.camera).toEqual(CAM)
    expect(no.axis).toBe('z')

    // Two files, named as D1 fixes them.
    const key = createHash('sha256').update(path).digest('hex')
    expect(pngsOf(cache.dir)).toEqual([`${key}.noao.webp`, `${key}.webp`])
  })

  it('carries a camera beyond tolerance to the other render as cleared labels, and leaves the written one alone', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: PNG_A, camera: CAM, rig: 2, lighting: 'camera' })
    await cache.put(path, { mtime: 1, png: PNG_B, ao: false, rig: 3, lighting: 'camera' })

    // An orbit under the unoccluded setting: new pixels for this render, a new
    // camera for the model, and the occluded render is now drawn at an angle
    // the entry no longer claims.
    await cache.put(path, { mtime: 1, png: PNG_NEW, ao: false, camera: CAM2, rig: 3, lighting: 'camera' })

    const written = await cache.get(path, 1, false)
    expect(written.status).toBe('hit')
    expect(written.rig).toBe(3) // the render that moved keeps its own labels
    expect(written.lighting).toBe('camera')
    expect(written.camera).toEqual(CAM2)

    const other = await cache.get(path, 1, true)
    expect(other.status).toBe('hit') // a hit, never a pixel-less stale (D2)
    expect(other.rig).toBeUndefined()
    expect(other.lighting).toBeUndefined()
    expect(other.posed).toBeUndefined()
  })

  it('serves the invalidated render its own old pixels and the new camera, so the tile never blanks', async () => {
    // The reason invalidation clears labels rather than `mtime`: the client
    // reads a hit whose recipe fails its check, shows those pixels, and
    // replaces them at the new orientation. Clearing `mtime` would answer
    // `stale`, which carries nothing to show meanwhile.
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: PNG_A, camera: CAM, rig: 2, lighting: 'camera' })
    await cache.put(path, { mtime: 1, png: PNG_B, ao: false, rig: 2, lighting: 'camera' })

    await cache.put(path, { mtime: 1, png: PNG_NEW, ao: false, camera: CAM2, rig: 2, lighting: 'camera' })

    const res = await cache.get(path, 1, true)
    expect(res.status).toBe('hit')
    expect(Buffer.from(res.png as string, 'base64')).toEqual(PNG_A) // its own pixels, still served
    expect(res.camera).toEqual(CAM2) // …at the camera it must be re-rendered under
    expect(res.rig).toBeUndefined() // …and the cleared label is what tells the client to
  })

  it('treats a first-ever camera as a change, on an entry that holds both renders', async () => {
    // Nothing to compare it against, so it invalidates. The cost is stated in
    // D2 and accepted: once per model, and only when both renders exist.
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: PNG_A, rig: 2, lighting: 'camera' })
    await cache.put(path, { mtime: 1, png: PNG_B, ao: false, rig: 2, lighting: 'camera' })
    expect((await cache.get(path, 1, false)).rig).toBe(2)

    await cache.put(path, { mtime: 1, png: PNG_NEW, camera: CAM, rig: 2, lighting: 'camera' })

    const other = await cache.get(path, 1, false)
    expect(other.status).toBe('hit')
    expect(Buffer.from(other.png as string, 'base64')).toEqual(PNG_B)
    expect(other.rig).toBeUndefined()
    expect(other.camera).toEqual(CAM)
  })

  it('treats a first-ever axis, and a different axis, as a change too', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: PNG_A, camera: CAM, rig: 2 })
    await cache.put(path, { mtime: 1, png: PNG_B, ao: false, rig: 2 })

    // The first axis the entry has held.
    await cache.put(path, { mtime: 1, png: PNG_NEW, camera: CAM, axis: 'z', rig: 2 })
    expect((await cache.get(path, 1, false)).rig).toBeUndefined()

    // Re-label the sibling, then send that same axis again: an enum equal to
    // the stored one has moved nothing.
    await cache.put(path, { mtime: 1, png: PNG_B, ao: false, rig: 4 })
    await cache.put(path, { mtime: 1, png: PNG_NEW, camera: CAM, axis: 'z', rig: 2 })
    expect((await cache.get(path, 1, false)).rig).toBe(4)

    // A different one has.
    await cache.put(path, { mtime: 1, png: PNG_NEW, camera: CAM, axis: '-x', rig: 2 })
    expect((await cache.get(path, 1, false)).rig).toBeUndefined()
  })

  it('leaves the other render alone for a pixel-only write, and for a camera re-sent within tolerance', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: PNG_A, camera: CAM, axis: 'z', rig: 2, lighting: 'camera' })
    await cache.put(path, { mtime: 1, png: PNG_B, ao: false, rig: 3, lighting: 'camera' })

    // Pixels and labels, no camera — `useThumbnails`' tail.
    await cache.put(path, { mtime: 1, png: PNG_NEW, ao: false, rig: 5, lighting: 'camera' })
    let other = await cache.get(path, 1, true)
    expect(other.status).toBe('hit')
    expect(other.rig).toBe(2)
    expect(other.lighting).toBe('camera')

    // A lightbox close nobody orbited: `persist` re-captures the camera through
    // a round trip that is not bit-exact and re-sends it. 1e-12 is three orders
    // above the largest drift measured and three below CAMERA_EPSILON.
    await cache.put(path, {
      mtime: 1,
      png: PNG_NEW,
      ao: false,
      camera: { ...CAM, az: CAM.az + 1e-12, target: [CAM.target[0] + 1e-12, CAM.target[1], CAM.target[2]] },
      rig: 5,
      lighting: 'camera',
    })
    other = await cache.get(path, 1, true)
    expect(other.status).toBe('hit')
    expect(other.rig).toBe(2) // untouched: the camera did not move
    expect(other.lighting).toBe('camera')
  })

  it('invalidates the sibling when an unowned entry draws its two renders at different poses', async () => {
    // The live case, 2026-08-31: the occluded render was drawn under an index
    // pose from a meaning search, and the unoccluded sibling later drawn
    // unposed by a plain-listing sweep — a pixels-only PUT, which touches the
    // other render never. With no camera and no axis there is no stored
    // orientation to draw both under, so the pose record *is* the orientation.
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: PNG_A, rig: 2, lighting: 'camera', posed: 2 })

    await cache.put(path, { mtime: 1, png: PNG_B, ao: false, rig: 2, lighting: 'camera' })

    const written = await cache.get(path, 1, false)
    expect(written.status).toBe('hit') // the render that drew keeps its own labels
    expect(written.rig).toBe(2)
    expect(written.posed).toBeUndefined()

    const sibling = await cache.get(path, 1, true)
    expect(sibling.status).toBe('hit') // mtime and pixels stay, so the tile never blanks
    expect(Buffer.from(sibling.png as string, 'base64')).toEqual(PNG_A)
    expect(sibling.rig).toBeUndefined()
    expect(sibling.lighting).toBeUndefined()
    expect(sibling.posed).toBeUndefined()
  })

  it('invalidates the sibling the other way round too, when the pose arrives second', async () => {
    // The mirror: the plain listing drew first, and a meaning search then drew
    // the other render under a pose. Same difference, same invalidation.
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: PNG_B, ao: false, rig: 2, lighting: 'camera' })

    await cache.put(path, { mtime: 1, png: PNG_A, rig: 2, lighting: 'camera', posed: 2 })

    const written = await cache.get(path, 1, true)
    expect(written.status).toBe('hit')
    expect(written.rig).toBe(2)
    expect(written.posed).toBe(2)

    const sibling = await cache.get(path, 1, false)
    expect(sibling.status).toBe('hit')
    expect(Buffer.from(sibling.png as string, 'base64')).toEqual(PNG_B)
    expect(sibling.rig).toBeUndefined()
    expect(sibling.lighting).toBeUndefined()
    expect(sibling.posed).toBeUndefined()
  })

  it('leaves the sibling alone when both renders of an unowned entry record the same pose', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)

    // Both unposed — the ordinary pair of plain-listing renders, and the case
    // "toggling back is a lookup" is about.
    const plain = join(fx.dir, 'loose.stl')
    await cache.put(plain, { mtime: 1, png: PNG_A, rig: 2, lighting: 'camera' })
    await cache.put(plain, { mtime: 1, png: PNG_B, ao: false, rig: 3, lighting: 'camera' })
    let sibling = await cache.get(plain, 1, true)
    expect(sibling.status).toBe('hit')
    expect(sibling.rig).toBe(2)
    expect(sibling.lighting).toBe('camera')

    // Both under the same pose — a model rendered twice from the same search.
    const posed = join(fx.dir, 'posed.stl')
    writeFileSync(posed, 'x')
    await cache.put(posed, { mtime: 1, png: PNG_A, rig: 2, lighting: 'camera', posed: 2 })
    await cache.put(posed, { mtime: 1, png: PNG_B, ao: false, rig: 3, lighting: 'camera', posed: 2 })
    sibling = await cache.get(posed, 1, true)
    expect(sibling.status).toBe('hit')
    expect(sibling.rig).toBe(2)
    expect(sibling.posed).toBe(2)
  })

  it('invalidates the sibling when an unowned entry’s two renders record different pose keys, and not when they agree', async () => {
    // `pose-rerender` D3: the same mapping version under two opinions is a
    // difference in the orientation drawn, exactly as posed-beside-unposed is.
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: PNG_A, rig: 2, lighting: 'camera', posed: 2, poseKey: 'y:3.9270:0.3491' })
    // The same key: the sibling stands.
    await cache.put(path, { mtime: 1, png: PNG_B, ao: false, rig: 2, lighting: 'camera', posed: 2, poseKey: 'y:3.9270:0.3491' })
    let sibling = await cache.get(path, 1, true)
    expect(sibling.status).toBe('hit')
    expect(sibling.rig).toBe(2)
    expect(sibling.poseKey).toBe('y:3.9270:0.3491')

    // Re-classified: the unoccluded render is redrawn under another opinion.
    await cache.put(path, { mtime: 1, png: PNG_B, ao: false, rig: 2, lighting: 'camera', posed: 2, poseKey: 'y:0.7854:0.3491' })
    const written = await cache.get(path, 1, false)
    expect(written.status).toBe('hit')
    expect(written.poseKey).toBe('y:0.7854:0.3491')
    sibling = await cache.get(path, 1, true)
    expect(sibling.status).toBe('hit') // mtime and pixels stay, so the tile never blanks
    expect(Buffer.from(sibling.png as string, 'base64')).toEqual(PNG_A)
    expect(sibling.rig).toBeUndefined()
    expect(sibling.lighting).toBeUndefined()
    expect(sibling.posed).toBeUndefined()
    expect(sibling.poseKey).toBeUndefined()
  })

  it('exempts an owned entry: the stored orientation is what both its renders are drawn under', async () => {
    // With a camera stored, both renders are drawn under it whatever the pose
    // record says — `posed` merely rides along — so a difference in it is not
    // a difference in the orientation drawn, and nothing is invalidated.
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: PNG_A, camera: CAM, rig: 2, lighting: 'camera', posed: 2 })
    await cache.put(path, { mtime: 1, png: PNG_B, ao: false, rig: 3, lighting: 'camera', posed: 2 })

    // A pixels-only re-render of the unoccluded side, unposed, no camera sent.
    await cache.put(path, { mtime: 1, png: PNG_NEW, ao: false, rig: 3, lighting: 'camera' })
    let sibling = await cache.get(path, 1, true)
    expect(sibling.status).toBe('hit')
    expect(sibling.rig).toBe(2)
    expect(sibling.lighting).toBe('camera')
    expect(sibling.posed).toBe(2)

    // …and the same with the stored camera re-sent within tolerance, which is
    // what every unmoved lightbox close does.
    await cache.put(path, {
      mtime: 1,
      png: PNG_NEW,
      ao: false,
      camera: { ...CAM, az: CAM.az + 1e-12 },
      rig: 3,
      lighting: 'camera',
    })
    sibling = await cache.get(path, 1, true)
    expect(sibling.status).toBe('hit')
    expect(sibling.rig).toBe(2)
    expect(sibling.posed).toBe(2)

    // An axis alone owns the entry too: it is an orientation the entry holds.
    const axed = join(fx.dir, 'axed.stl')
    writeFileSync(axed, 'x')
    await cache.put(axed, { mtime: 1, png: PNG_A, axis: 'z', rig: 2, posed: 2 })
    await cache.put(axed, { mtime: 1, png: PNG_B, ao: false, rig: 3 })
    sibling = await cache.get(axed, 1, true)
    expect(sibling.status).toBe('hit')
    expect(sibling.rig).toBe(2)
    expect(sibling.posed).toBe(2)
  })

  it('does not fire on a pixel-less write — the orientation rule owns those', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    const key = createHash('sha256').update(path).digest('hex')
    // A pair of exactly the shape the live cache held in 24 places before this
    // rule: unowned, the occluded render posed, the unoccluded one not. It is
    // written as a sidecar because `put` is now the thing that prevents such a
    // pair being created — the pair predates the rule, as those 24 did.
    writeFileSync(
      join(cache.dir, `${key}.json`),
      JSON.stringify({
        path,
        mtime: 1,
        lighting: 'camera',
        rig: 2,
        posed: 2,
        noao: { mtime: 1, lighting: 'camera', rig: 2 },
      }),
    )
    writeFileSync(join(cache.dir, `${key}.webp`), PNG_A)
    writeFileSync(join(cache.dir, `${key}.noao.webp`), PNG_B)

    // A labels-only PUT on the unoccluded render. The two pose records still
    // differ, but no pixels were written — there is no newly drawn render
    // whose orientation could disagree with the sibling's. Pixel-less writes
    // are the `moved` rule's alone, and this one moved nothing.
    await cache.put(path, { mtime: 1, ao: false, rig: 5 })

    const sibling = await cache.get(path, 1, true)
    expect(sibling.status).toBe('hit')
    expect(sibling.rig).toBe(2)
    expect(sibling.lighting).toBe('camera')
    expect(sibling.posed).toBe(2)
  })

  it('clears both renders on a pixel-less discard of a camera the entry held, and nothing when it held none', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: PNG_A, camera: CAM, rig: 2, lighting: 'camera' })
    await cache.put(path, { mtime: 1, png: PNG_B, ao: false, rig: 3, lighting: 'camera' })

    // `resetFramingLive`: no pixels, so there is no written render to spare.
    await cache.put(path, { mtime: 1, camera: null })

    for (const ao of [true, false]) {
      const res = await cache.get(path, 1, ao)
      expect(res.status).toBe('hit') // pixels kept, both of them
      expect(res.rig).toBeUndefined()
      expect(res.lighting).toBeUndefined()
      expect(res.camera).toBeUndefined()
    }

    // A second entry that never held a camera: discarding nothing changes
    // nothing, and neither render is invalidated.
    const other = join(fx.dir, 'other.stl')
    writeFileSync(other, 'x')
    await cache.put(other, { mtime: 1, png: PNG_A, rig: 2 })
    await cache.put(other, { mtime: 1, png: PNG_B, ao: false, rig: 3 })
    await cache.put(other, { mtime: 1, camera: null })
    expect((await cache.get(other, 1, true)).rig).toBe(2)
    expect((await cache.get(other, 1, false)).rig).toBe(3)
  })

  it("deletes the sibling's pixels when a render is written at a newer mtime", async () => {
    // The model changed under both renders: the sibling holds pixels of a file
    // that is gone, and would keep them until something rendered it again.
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    const key = createHash('sha256').update(path).digest('hex')
    await cache.put(path, { mtime: 1, png: PNG_A, rig: 2, lighting: 'camera' })
    await cache.put(path, { mtime: 1, png: PNG_B, ao: false, rig: 2, lighting: 'camera' })
    expect(pngsOf(cache.dir)).toHaveLength(2)

    await cache.put(path, { mtime: 2, png: PNG_NEW, rig: 2, lighting: 'camera' })

    expect(pngsOf(cache.dir)).toEqual([`${key}.webp`]) // the sibling's file is gone
    const superseded = await cache.get(path, 2, false)
    expect(superseded.status).toBe('miss') // no mtime, no labels, no camera to be stale from
    expect(superseded.rig).toBeUndefined()
    const written = await cache.get(path, 2, true)
    expect(written.status).toBe('hit')
    expect(Buffer.from(written.png as string, 'base64')).toEqual(PNG_NEW)

    // Re-writing at the same mtime is the ordinary case and takes nothing: the
    // second render of one file is not a supersede.
    await cache.put(path, { mtime: 2, png: PNG_B, ao: false, rig: 2 })
    await cache.put(path, { mtime: 2, png: PNG_A, rig: 2 })
    expect(pngsOf(cache.dir)).toHaveLength(2)
    expect((await cache.get(path, 2, false)).status).toBe('hit')
  })

  it('evicts the render nobody has looked at and leaves the other a hit', async () => {
    const cache = tempCache(10) // tiny cap: any two pngs exceed it
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    const tick = () => new Promise((r) => setTimeout(r, 5))
    await cache.put(path, { mtime: 1, png: Buffer.from('aaaaaaaa'), camera: CAM, rig: 2, lighting: 'camera' })
    await tick()
    await cache.put(path, { mtime: 1, png: Buffer.from('bbbbbbbb'), ao: false, rig: 3, lighting: 'camera' })
    await tick()
    await cache.get(path, 1, true) // the occluded render is now the more recently read

    await cache.maintain()

    // The two renders of one model are separate cap candidates, so the cap is
    // met by taking one of them and not the entry.
    const evicted = await cache.get(path, 1, false)
    expect(evicted.status).toBe('stale')
    // Its labels survive the eviction and ride the stale read, exactly as the
    // occluded render's do — they say what recipe the evicted pixels were
    // under, which is what a client asks a stale answer for.
    expect(evicted.rig).toBe(3)
    expect(evicted.lighting).toBe('camera')
    expect(evicted.camera).toEqual(CAM) // …and the orientation is spared, as ever

    const kept = await cache.get(path, 1, true)
    expect(kept.status).toBe('hit')
    expect(kept.rig).toBe(2)
    expect(pngsOf(cache.dir)).toHaveLength(1)
  })

  it('sweeps sidecar and both renders together when the model is gone', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const doomed = join(fx.dir, 'doomed.stl')
    writeFileSync(doomed, 'x')
    await cache.put(doomed, { mtime: 1, png: PNG_A, camera: CAM, axis: 'z' })
    await cache.put(doomed, { mtime: 1, png: PNG_B, ao: false })
    expect(readdirSync(cache.dir)).toHaveLength(3) // sidecar + two renders

    unlinkSync(doomed)
    await cache.maintain()

    expect(readdirSync(cache.dir)).toHaveLength(0) // one model, one existence
    expect((await cache.get(doomed, 1, true)).status).toBe('miss')
    expect((await cache.get(doomed, 1, false)).status).toBe('miss')
  })
})

/**
 * A cache that runs one `put` *inside* another's read-modify-write window.
 *
 * `InterposingCache` above cannot express this: it fires on the **second** read
 * of a key, which is the shape `maintain`'s snapshot-then-re-read pass has, and
 * three cells depend on that rule. A racing pair of puts reads the sidecar once
 * each, so the callback has to fire on the *first* read — and after
 * `super.readMeta` has resolved but before its value is handed back, so the
 * outer put goes on to merge against the snapshot it took **before** the inner
 * write landed. That is precisely the interleave `put`'s own comment describes
 * as accepted and unclosable: two puts merging against one `prev`.
 */
class RacingCache extends ThumbCache {
  private armed: (() => Promise<unknown>) | null = null
  /** Did the armed write actually land inside the window? Assert it, always. */
  fired = false

  arm(run: () => Promise<unknown>): void {
    this.armed = run
    this.fired = false
  }

  protected override async readMeta(dir: string, key: string) {
    const meta = await super.readMeta(dir, key)
    const run = this.armed
    if (run !== null) {
      this.armed = null // exactly once — the armed put reads this sidecar too
      this.fired = true
      await run()
    }
    return meta
  }
}

describe('write generations', () => {
  it('never re-issues a generation across an entry being evicted and re-created', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')

    const first = await cache.put(path, { mtime: 1, png: Buffer.from('one') })
    // Evict the whole entry, exactly as the existence sweep does — sidecar and
    // pixels both, so the next write finds nothing to continue from.
    for (const f of readdirSync(cache.dir)) rmSync(join(cache.dir, f), { force: true })
    expect((await cache.get(path, 1)).status).toBe('miss')

    const second = await cache.put(path, { mtime: 1, png: Buffer.from('two') })
    // Strictly greater, not merely different. A counter that restarted at 0
    // here would re-issue numbers this path has already answered under, and a
    // browser holding one of them would serve the old pixels for a year.
    expect(second).toBeGreaterThan(first)
    expect((await cache.get(path, 1)).gen).toBe(second)
  })

  it('seeds a fresh process from the wall clock rather than from zero', async () => {
    // The cell above cannot see a broken seed, and that is why this one exists:
    // the allocator's high-water mark is module state, so *within* one process
    // even a plain 0-seeded counter answers "strictly greater" and the
    // write/delete/write shape passes against it. What that shape cannot test
    // is the number a **fresh** process starts from — and a browser's cache
    // outlives the process, so an entry re-created after a restart must not be
    // handed a number this path may already have answered under.
    //
    // Asserted against the clock, not against a previous generation: comparing
    // the two would be comparing against this suite's own accumulated
    // allocations, which burst well past wall-clock (200 puts in ~16ms end up
    // ~184ms ahead — re-run the loop in `allocateGen`'s terms to see it).
    const dir = mkdtempSync(join(tmpdir(), 'mb-cache-restart-'))
    cleanups.push(dir)
    const fx = makeFixtures()
    cleanups.push(fx.dir)

    vi.resetModules()
    const restarted = await import('../src/cache')
    const before = Date.now()
    const gen = await new restarted.ThumbCache(dir).put(join(fx.dir, 'loose.stl'), {
      mtime: 1,
      png: Buffer.from('one'),
    })
    // A counter starting at 0 lands on 1 here, twelve orders of magnitude below
    // the numbers the previous process was issuing.
    expect(gen).toBeGreaterThanOrEqual(before)
  })

  it('never lands below a generation the sidecar already carries', async () => {
    // The case neither clock term covers: a `gen` written by some *other*
    // machine's clock. A cache directory copied between machines, or a clock
    // skew, puts the stored number ahead of both `Date.now()` and this
    // process's high-water mark — and without the sidecar's own value as a
    // floor, the next write issues a number *below* the entry's stored one.
    // That is a per-entry regression, which is the one thing the generation
    // exists to prevent.
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await cache.put(path, { mtime: 1, png: Buffer.from('one') })

    // Forge the foreign clock: a generation a million seconds in the future.
    const metaFile = onlyFile(cache.dir, '.json')
    const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as { gen: number }
    const foreign = Date.now() + 1_000_000_000
    writeFileSync(metaFile, JSON.stringify({ ...meta, gen: foreign }))

    const next = await cache.put(path, { mtime: 1, png: Buffer.from('two') })
    expect(next).toBeGreaterThan(foreign)
    expect((await cache.get(path, 1)).gen).toBe(next)
  })

  it('gives two puts that raced on one entry different generations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mb-cache-race-'))
    cleanups.push(dir)
    const cache = new RacingCache(dir)
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')

    await cache.put(path, { mtime: 1, png: Buffer.from('seed') })

    // `inner` runs to completion inside `outer`'s read→write window, so both
    // merge against the same sidecar. `inner` allocates first; `outer` writes
    // last, so the surviving sidecar is `outer`'s.
    let inner = 0
    cache.arm(async () => {
      inner = await cache.put(path, { mtime: 1, png: Buffer.from('inner') })
    })
    const outer = await cache.put(path, { mtime: 1, png: Buffer.from('outer') })
    expect(cache.fired).toBe(true) // the write landed *inside* the window

    // The generation cannot be derived from the sidecar the merge read, or both
    // of these are the same number — and then the loser's number is also the
    // winner's, the stale tier never fires, and a browser that fetched at it
    // serves the loser's pixels under `immutable` with no way back.
    expect(inner).not.toBe(outer)
    expect(outer).toBeGreaterThan(inner) // allocated later, and it wrote last

    // The surviving entry is the last writer's, at the last writer's number.
    const after = await cache.get(path, 1)
    expect(after.gen).toBe(outer)
    expect(Buffer.from(after.png!, 'base64').toString()).toBe('outer')
  })

  it('never lets the loser of that race be answered as immutable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mb-cache-race2-'))
    cleanups.push(dir)
    const cache = new RacingCache(dir)
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const app = createApp(cache, undefined, undefined, libraryFor(fx.dir))

    await cache.put('/loose.stl', { mtime: 1, png: Buffer.from('seed') })
    let inner = 0
    cache.arm(async () => {
      inner = await cache.put('/loose.stl', { mtime: 1, png: Buffer.from('inner') })
    })
    const outer = await cache.put('/loose.stl', { mtime: 1, png: Buffer.from('outer') })
    expect(cache.fired).toBe(true)

    const ask = (gen: number) =>
      app.request(`/api/thumb?path=${encodeURIComponent('/loose.stl')}&mtime=1&gen=${gen}`, {
        headers: LOOPBACK,
      })

    // This is the assertion the whole allocator exists for. The loser's number
    // is not current, so its answer is uncacheable and the reader re-keys.
    const loser = await ask(inner)
    expect(loser.headers.get('cache-control')).toBe('no-cache')
    expect(((await loser.json()) as ThumbGetResponse).gen).toBe(outer)

    // And the winner's number is the one that gets pinned.
    const winner = await ask(outer)
    expect(winner.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })
})

/**
 * Deleting an entry's renders, and refusing a write whose entry has moved
 * (`bulk-thumbnail-jobs` D3/D4) — the two fields a bulk job writes with.
 */
describe('deletion and conditional writes', () => {
  const pngsOf = (dir: string): string[] =>
    readdirSync(dir)
      .filter((f) => f.endsWith('.webp'))
      .sort()

  /** An entry holding both renders' pixels and a camera — what a reset finds. */
  async function seeded(cache: ThumbCache, path: string): Promise<number> {
    await cache.put(path, { mtime: 1, png: PNG_A, camera: CAM, rig: 2, lighting: 'camera' })
    return cache.put(path, { mtime: 1, png: PNG_B, ao: false, rig: 2, lighting: 'camera' })
  }

  it('empties both renders — pixels, labels and files — when a write deletes them', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    const before = await seeded(cache, path)
    expect(pngsOf(cache.dir)).toHaveLength(2)

    // The reset job's own write: give up the orientation and delete what was
    // drawn under it.
    const gen = await cache.put(path, { mtime: 1, png: null, camera: null })

    // Both files are gone — not merely unreferenced, since a sidecar that
    // forgot them would leave the pixels against the size cap forever.
    expect(pngsOf(cache.dir)).toEqual([])
    // A miss, not a stale: `stale` carries a camera to re-render from and this
    // write gave the camera up, so there is nothing here at all. This is the
    // cell that fails if `null` is threaded through the pixel merge instead of
    // taking its own branch — the mtime would be adopted and both renders would
    // read as hits over files that are not there.
    for (const ao of [true, false]) {
      const res = await cache.get(path, 1, ao)
      expect(res.status).toBe('miss')
      expect(res.png).toBeUndefined()
      expect(res.rig).toBeUndefined()
      expect(res.lighting).toBeUndefined()
    }
    // The listing annotation agrees at once, because the write went through
    // `writeMeta` and so through `remember`: nothing framed, neither variant
    // cached.
    expect(cache.annotate(path, 1)).toEqual({
      gen,
      framed: false,
      ao: { state: 'miss' },
      noao: { state: 'miss' },
    })
    // A deletion is a write like any other: the number moves, so a browser
    // holding the deleted pixels re-keys rather than serving them.
    expect(gen).toBeGreaterThan(before)
    // The sidecar itself stays — the entry still exists, it just holds nothing.
    expect(jsons(cache.dir)).toHaveLength(1)
  })

  it('leaves the orientation to the same write: a kept camera, and a kept axis', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    await seeded(cache, path)

    // No `camera` field: absence keeps, exactly as on any other write. The
    // deletion governs the pixels and nothing else.
    await cache.put(path, { mtime: 1, png: null })
    const kept = await cache.get(path, 1)
    // `get`'s camera-bearing rule: something to re-render from, no pixels.
    expect(kept.status).toBe('stale')
    expect(kept.camera).toEqual(CAM)
    expect(kept.png).toBeUndefined()
    expect(pngsOf(cache.dir)).toEqual([])

    // And an entry whose whole orientation is an axis keeps it the same way.
    const axial = join(fx.dir, 'other.stl')
    writeFileSync(axial, 'x')
    await cache.put(axial, { mtime: 1, png: PNG_A, axis: '-z', rig: 2 })
    await cache.put(axial, { mtime: 1, png: null })
    const still = await cache.get(axial, 1)
    expect(still.axis).toBe('-z')
    // An axis alone is not something to re-render from, so this one is a miss —
    // the pre-split rule, unchanged by the deletion.
    expect(still.status).toBe('miss')
  })

  it('writes as usual when `ifGen` names the generation the entry is at', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    const seen = await cache.put(path, { mtime: 1, png: PNG_A, camera: CAM, rig: 2 })

    const gen = await cache.put(path, { mtime: 1, png: PNG_NEW, rig: 3, ifGen: seen })
    expect(gen).toBeGreaterThan(seen)
    const res = await cache.get(path, 1)
    expect(res.status).toBe('hit')
    expect(Buffer.from(res.png as string, 'base64')).toEqual(PNG_NEW)
    expect(res.rig).toBe(3)

    // A never-written path is at generation 0, so `ifGen: 0` reads as "only if
    // nothing has ever been written here" — and here nothing has.
    const fresh = join(fx.dir, 'other.stl')
    writeFileSync(fresh, 'x')
    await expect(cache.put(fresh, { mtime: 1, png: PNG_A, ifGen: 0 })).resolves.toBeGreaterThan(0)
    expect((await cache.get(fresh, 1)).status).toBe('hit')
  })

  it('refuses a write whose entry has moved, and writes nothing at all', async () => {
    const cache = tempCache()
    const fx = makeFixtures()
    cleanups.push(fx.dir)
    const path = join(fx.dir, 'loose.stl')
    // What a job snapshots at launch...
    const snapshot = await cache.put(path, { mtime: 1, png: PNG_A, camera: CAM, rig: 2 })
    // ...and the write the user landed on it meanwhile.
    const current = await cache.put(path, { mtime: 1, png: PNG_B, camera: CAM2, rig: 3 })

    const metaFile = onlyFile(cache.dir, '.json')
    const pngFile = join(cache.dir, `${createHash('sha256').update(path).digest('hex')}.webp`)
    const sidecarBefore = readFileSync(metaFile, 'utf8')
    const pngBefore = readFileSync(pngFile)

    // Both shapes of job write are refused — the reset's deletion and the
    // generate's pixels — and the refusal carries the entry's *current*
    // generation, so the caller re-keys from the throw rather than reading the
    // entry back to find out what it lost to.
    await expect(
      cache.put(path, { mtime: 1, png: null, camera: null, ifGen: snapshot }),
    ).rejects.toBeInstanceOf(StaleWriteError)
    const err = await cache
      .put(path, { mtime: 1, png: PNG_NEW, ifGen: snapshot })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StaleWriteError)
    expect((err as StaleWriteError).gen).toBe(current)

    // 0 against an entry that has a generation is the same refusal — it is not
    // a spelling of "no condition".
    await expect(cache.put(path, { mtime: 1, png: PNG_NEW, ifGen: 0 })).rejects.toBeInstanceOf(
      StaleWriteError,
    )

    // Nothing was written: not the sidecar's bytes — so no generation was
    // allocated into it and no field was merged — and not the pixels.
    expect(readFileSync(metaFile, 'utf8')).toBe(sidecarBefore)
    expect(readFileSync(pngFile)).toEqual(pngBefore)
    const after = await cache.get(path, 1)
    expect(after.gen).toBe(current)
    expect(after.rig).toBe(3)
    expect(Buffer.from(after.png as string, 'base64')).toEqual(PNG_B)
  })

  it('does not count a deletion toward maintenance — it added nothing to the store', async () => {
    // Observed through the trigger itself rather than the private counter: a
    // cache that maintains after every counted write, so one such write is one
    // sweep. The sweep is stubbed because what is under test is whether it is
    // *asked* for, not what it would do.
    const maintain = vi.spyOn(ThumbCache.prototype, 'maintain').mockResolvedValue(undefined)
    try {
      const dir = mkdtempSync(join(tmpdir(), 'mb-cache-'))
      cleanups.push(dir)
      const cache = new ThumbCache(dir, CAP, 1) // maintain after every counted write
      const fx = makeFixtures()
      cleanups.push(fx.dir)
      const path = join(fx.dir, 'loose.stl')
      await cache.put(path, { mtime: 1, png: PNG_A })
      expect(maintain).toHaveBeenCalledTimes(1) // pixels: counted
      await cache.put(path, { mtime: 1, png: null })
      await cache.put(path, { mtime: 1, png: null, camera: null })
      // Maintenance is what keeps the store under its cap. A deletion only ever
      // frees space, so counting it would spend a whole sweep on nothing.
      expect(maintain).toHaveBeenCalledTimes(1)
    } finally {
      maintain.mockRestore()
    }
  })
})
