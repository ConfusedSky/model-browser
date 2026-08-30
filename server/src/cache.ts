import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import type { CameraState, LightingMode, OrbitAxis, ThumbGetResponse } from '../../shared/types'
import { type Library, LibraryError } from './library'
import { VPathError, joinVPath, parseVPath } from './vpath'

interface Meta {
  path: string
  /** mtime the PNG was rendered against; undefined when only camera is stored. */
  mtime?: number
  camera?: CameraState
  /** Orbit spindle axis; undefined reads as 'y' (pre-axis entries). */
  axis?: OrbitAxis
  /** Lighting mode the PNG was rendered with; stored and echoed, never interpreted. */
  lighting?: LightingMode
  /** Pixel-recipe (rig) version the PNG was rendered with; stored and echoed, never interpreted. */
  rig?: number
  /** Pose recipe version the PNG was rendered under; same contract as `rig`. */
  posed?: number
}

const DEFAULT_CAP = 2 * 1024 ** 3
/** PNG writes between automatic maintenance runs (D4: "after writes crossing a threshold"). */
const MAINTAIN_EVERY = 32

/**
 * Server-side `{png, cameraState}` store, filed under a hash of the library
 * path (paths contain `/`, `!`, spaces). PNG keyed by path+mtime; camera by
 * path only.
 *
 * Given a library, entries live in a directory of that library's own —
 * `<dir>/<id>/` — so a remount keeps the cache and two libraries with the same
 * layout cannot share an entry (library-root D5). The pre-library flat layout
 * is migrated into it once per process, and whatever is left there is swept for
 * existence but counts toward no cap.
 */
export class ThumbCache {
  private writesSinceMaintain = 0
  private maintaining = false
  /** The legacy scan is a once-per-process event (D5), not once per sweep. */
  private migrated = false

  constructor(
    readonly dir: string = process.env.MODEL_BROWSER_CACHE ?? join(homedir(), '.cache', 'model-browser'),
    readonly sizeCap: number = Number(process.env.MODEL_BROWSER_CACHE_CAP ?? DEFAULT_CAP),
    readonly maintainEvery: number = MAINTAIN_EVERY,
    /**
     * Omitting the library is test- and legacy-only: entries then live flat in
     * `dir`, keyed by whatever string the caller passes — which is exactly the
     * shape `migrate` below reads. Production always passes one.
     */
    private readonly library?: Library,
  ) {}

  private key(path: string): string {
    return createHash('sha256').update(path).digest('hex')
  }

  /**
   * Where this library's entries live. Awaiting the state is what makes the id
   * readable — `id()` throws until the library has been evaluated once — and it
   * keeps the read lazy, so the cache can be constructed before the volume has
   * been looked at at all.
   */
  private async entryDir(): Promise<string> {
    if (this.library === undefined) return this.dir
    await this.library.state()
    return join(this.dir, this.library.id())
  }

  private metaFile(dir: string, key: string): string {
    return join(dir, `${key}.json`)
  }

  private pngFile(dir: string, key: string): string {
    return join(dir, `${key}.png`)
  }

  private async readMeta(dir: string, key: string): Promise<Meta | null> {
    try {
      return JSON.parse(await readFile(this.metaFile(dir, key), 'utf8')) as Meta
    } catch {
      return null
    }
  }

  private async writeMeta(dir: string, key: string, meta: Meta): Promise<void> {
    await mkdir(dir, { recursive: true })
    await writeFile(this.metaFile(dir, key), JSON.stringify(meta))
  }


  async get(path: string, mtime: number): Promise<ThumbGetResponse> {
    const dir = await this.entryDir()
    const key = this.key(path)
    const meta = await this.readMeta(dir, key)
    if (meta === null) return { status: 'miss' }
    // Not defaulted here: the *absence* of a stored axis is information a
    // client needs. Defaulting it to 'y' made "nothing stored" indistinguishable
    // from "stored as y", so a model whose thumbnail was rendered at an
    // index-supplied pose (which deliberately stores no axis) reported `y`, and
    // the viewer abandoned the pose the moment it opened. Every caller already
    // applies its own default.
    const axis = meta.axis
    const lighting = meta.lighting
    const rig = meta.rig
    const posed = meta.posed
    if (meta.mtime !== mtime) return { status: meta.camera !== undefined || meta.mtime !== undefined ? 'stale' : 'miss', camera: meta.camera, axis, lighting, rig, posed }
    let png
    try {
      png = await readFile(this.pngFile(dir, key))
    } catch {
      return { status: 'stale', camera: meta.camera, axis, lighting, rig, posed }
    }
    // LRU clock for size-cap eviction is the png file's mtime. Bumping it via
    // utimes (instead of rewriting the meta json) keeps reads race-free
    // against the sweep: it cannot resurrect a removed entry and cannot be
    // caught mid-write by the sweep's meta parse.
    const now = new Date()
    await utimes(this.pngFile(dir, key), now, now).catch(() => {})
    return { status: 'hit', camera: meta.camera, axis, lighting, rig, posed, png: png.toString('base64') }
  }

  async put(path: string, opts: { mtime: number; png?: Buffer; camera?: CameraState | null; axis?: OrbitAxis | null; lighting?: LightingMode; rig?: number; posed?: number }): Promise<void> {
    const dir = await this.entryDir()
    const key = this.key(path)
    const prev = await this.readMeta(dir, key)
    const meta: Meta = {
      path,
      mtime: opts.png !== undefined ? opts.mtime : prev?.mtime,
      // Three states per field: a value sets it, silence keeps what was there,
      // `null` discards it. Silence cannot mean discard — every PNG write omits
      // both — and a written default is not a discard either: it is an
      // orientation of the user's own, and it suppresses the index that would
      // otherwise frame the model well (entry-context-menu D7).
      camera: opts.camera === null ? undefined : (opts.camera ?? prev?.camera),
      axis: opts.axis === null ? undefined : (opts.axis ?? prev?.axis),
      // Like mtime, lighting and rig describe the pixels: a PUT replacing the
      // PNG without declaring them must not keep old labels on new pixels.
      lighting: opts.png !== undefined ? opts.lighting : (opts.lighting ?? prev?.lighting),
      rig: opts.png !== undefined ? opts.rig : (opts.rig ?? prev?.rig),
      posed: opts.png !== undefined ? opts.posed : (opts.posed ?? prev?.posed),
    }
    if (opts.png !== undefined) {
      await mkdir(dir, { recursive: true })
      // Superseded-mtime PNG is inherently replaced: one PNG per path hash.
      await writeFile(this.pngFile(dir, key), opts.png)
    }
    await this.writeMeta(dir, key, meta)
    if (opts.png !== undefined && ++this.writesSinceMaintain >= this.maintainEvery) {
      this.writesSinceMaintain = 0
      void this.runMaintain()
    }
  }

  private async runMaintain(): Promise<void> {
    if (this.maintaining) return
    this.maintaining = true
    try {
      await this.maintain()
    } catch {
      // best-effort background sweep
    } finally {
      this.maintaining = false
    }
  }

  /**
   * Sweep + size cap over this library's directory. Existence is tested
   * against the containing zip for virtual paths. The sweep removes whole
   * entries (camera included); the size cap deletes only least-recently-read
   * PNGs and spares camera state.
   *
   * Under a library it also carries the once-per-process migration of the
   * pre-library flat directory and that directory's own existence sweep, and
   * the whole run is skipped unless the library is `ready`: an unmounted
   * volume is not a deleted library.
   */
  async maintain(): Promise<void> {
    if (this.library !== undefined) {
      if ((await this.library.state()).state !== 'ready') return
      // `state()` caches `ready` on purpose (D4): a library does not stop being
      // itself, which is the right answer for a route. The sweep is the one
      // caller it is wrong for — a volume unplugged mid-session still reads
      // `ready`, every `resolve` then lands on a path that no longer stats, and
      // a single sweep takes the whole library's cache, cameras included. So
      // the sweep asks the filesystem instead of the cached answer.
      if ((await stat(this.library.realTop()).catch(() => null)) === null) return
      if (!this.migrated) {
        this.migrated = true
        await this.migrate()
      }
      await this.sweepLegacy()
    }
    const dir = await this.entryDir()
    let files
    try {
      files = await readdir(dir)
    } catch {
      return
    }
    const metas: { key: string; meta: Meta; pngSize: number; lastRead: number }[] = []
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const key = f.slice(0, -'.json'.length)
      const meta = await this.readMeta(dir, key)
      if (meta === null) continue
      if (!(await this.sourceExists(meta.path))) {
        await rm(this.metaFile(dir, key), { force: true })
        await rm(this.pngFile(dir, key), { force: true })
        continue
      }
      const pngStat = await stat(this.pngFile(dir, key)).catch(() => null)
      metas.push({ key, meta, pngSize: pngStat?.size ?? 0, lastRead: pngStat?.mtimeMs ?? 0 })
    }

    let total = metas.reduce((sum, m) => sum + m.pngSize, 0)
    if (total <= this.sizeCap) return
    metas.sort((a, b) => a.lastRead - b.lastRead)
    for (const m of metas) {
      if (total <= this.sizeCap) break
      if (m.pngSize === 0) continue
      await rm(this.pngFile(dir, m.key), { force: true })
      await this.writeMeta(dir, m.key, { ...m.meta, mtime: undefined })
      total -= m.pngSize
    }
  }

  /**
   * Does the entry's recorded source still exist? Under a library the recorded
   * path is a library path, so the question is put to the library: a path it
   * refuses cannot exist in this tree at all, and one it resolves is tested on
   * the filesystem — for a virtual path, on the containing zip.
   */
  private async sourceExists(path: string): Promise<boolean> {
    if (this.library === undefined) {
      const source = parseVPathSafe(path)
      return source !== null && (await stat(source).catch(() => null)) !== null
    }
    let fsPath
    try {
      fsPath = (await this.library.resolve(path)).fsPath
    } catch (err) {
      if (err instanceof LibraryError || err instanceof VPathError) return false
      throw err
    }
    return (await stat(fsPath).catch(() => null)) !== null
  }

  /**
   * The flat directory the migration leaves behind holds entries recorded by
   * absolute filesystem path — another library's, or nobody's. Nothing else
   * reads it any more (`maintain` reads `<dir>/<id>/`), so it gets an existence
   * sweep of its own at each run; its entries count toward no library's cap.
   */
  private async sweepLegacy(): Promise<void> {
    let files
    try {
      files = await readdir(this.dir)
    } catch {
      return
    }
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const key = f.slice(0, -'.json'.length)
      const meta = await this.readMeta(this.dir, key)
      if (meta === null) continue
      const source = parseVPathSafe(meta.path)
      if (source !== null && (await stat(source).catch(() => null)) !== null) continue
      await rm(this.metaFile(this.dir, key), { force: true })
      await rm(this.pngFile(this.dir, key), { force: true })
    }
  }

  /**
   * Re-key the pre-library flat directory into this library's own (D5). Only
   * `<dir>/*.json` is scanned — never a `<dir>/<id>/` subdirectory — and only
   * entries whose recorded filesystem path resolves under the library's real
   * top are claimed. The rest are some other library's to claim, and stay put.
   *
   * The order is the one the design fixes against interruption: the PNG moves
   * (by `rename`, which preserves the mtime that is the LRU clock), then the
   * new sidecar is written, then the old sidecar is removed. An interruption
   * therefore leaves pixels under the new key with a stale old sidecar, never a
   * sidecar without its pixels — so a legacy sidecar whose PNG has already gone
   * is re-keyed anyway: the camera is the half that cannot be regenerated.
   */
  async migrate(): Promise<{ moved: number; left: number }> {
    const library = this.library
    if (library === undefined) return { moved: 0, left: 0 }
    const realTop = library.realTop()
    const target = join(this.dir, library.id())
    let files
    try {
      files = await readdir(this.dir)
    } catch {
      return { moved: 0, left: 0 }
    }
    let moved = 0
    let left = 0
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const key = f.slice(0, -'.json'.length)
      const meta = await this.readMeta(this.dir, key)
      if (meta === null) continue
      // The entry half is an opaque archive name; only the filesystem half is a
      // path in this tree, and it is the only half that is re-rooted.
      let parsed
      try {
        parsed = parseVPath(meta.path)
      } catch {
        left++
        continue
      }
      let real
      try {
        real = await realpath(parsed.fsPath)
      } catch {
        // Gone. Leave it for the legacy sweep, which is what removes it.
        left++
        continue
      }
      if (real !== realTop && !real.startsWith(realTop + sep)) {
        left++
        continue
      }
      const libTop = library.libPathOf(real)
      const libPath = parsed.entry === undefined ? libTop : joinVPath(libTop, parsed.entry)
      const newKey = this.key(libPath)
      await mkdir(target, { recursive: true })
      if ((await this.readMeta(target, newKey)) !== null) {
        // Already claimed — by an earlier run, or by an alias of this path that
        // resolves to the same file. The old pair is a duplicate: drop it, PNG
        // included, so the flat directory keeps no pixels that no sidecar
        // describes and the legacy sweep would never reach.
        await rm(this.metaFile(this.dir, key), { force: true })
        await rm(this.pngFile(this.dir, key), { force: true })
        continue
      }
      await rename(this.pngFile(this.dir, key), this.pngFile(target, newKey)).catch(() => {})
      await this.writeMeta(target, newKey, { ...meta, path: libPath })
      await rm(this.metaFile(this.dir, key), { force: true })
      moved++
    }
    return { moved, left }
  }
}

function parseVPathSafe(vpath: string): string | null {
  try {
    return parseVPath(vpath).fsPath
  } catch {
    return null
  }
}
