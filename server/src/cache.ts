import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { CAMERA_EPSILON, type CameraState, type LightingMode, type OrbitAxis, type ThumbGetResponse } from '../../shared/types'
import { type Library, LibraryError } from './library'
import { VPathError, joinVPath, parseVPath } from './vpath'

/**
 * Everything a sidecar records about *one* render's pixels. Both renders of an
 * entry carry the same four fields; only where they are written differs (D1).
 */
interface RenderLabels {
  /** mtime the PNG was rendered against; undefined when only camera is stored. */
  mtime?: number
  /** Lighting mode the PNG was rendered with; stored and echoed, never interpreted. */
  lighting?: LightingMode
  /** Pixel-recipe (rig) version the PNG was rendered with; stored and echoed, never interpreted. */
  rig?: number
  /** Pose recipe version the PNG was rendered under; same contract as `rig`. */
  posed?: number
}

/**
 * One entry, up to two renders (`ao-as-recipe-dimension` D1). The occluded
 * render keeps the shape every sidecar has always had — its labels at the top
 * level, its pixels in `<key>.png` — because it is the render every existing
 * cache already holds, and making it a member of a symmetric map would have
 * cost a migration of every one of them. The unoccluded render is named for
 * what it lacks: `<key>.noao.png`, labels under `noao`. A sidecar written
 * before this change simply has no `noao`, which is exactly what "no
 * unoccluded render is cached" means.
 *
 * `camera` and `axis` sit outside both: the orientation belongs to the model,
 * not to a recipe, and both renders are always drawn under it.
 */
interface Meta extends RenderLabels {
  path: string
  camera?: CameraState
  /** Orbit spindle axis; undefined reads as 'y' (pre-axis entries). */
  axis?: OrbitAxis
  /** The unoccluded sibling's labels; absent when it is not cached. */
  noao?: RenderLabels
}

/**
 * Is this write moving the shared orientation, rather than re-stating it?
 *
 * Absence keeps and cannot move anything. A `null` discards, which moves the
 * orientation only if there was one to discard. A value that arrives where the
 * entry held none is a change by definition — there is nothing to compare it
 * against, and design D2 takes the once-per-model cost of that deliberately.
 *
 * Otherwise it is a tolerance, not equality: `persist` re-captures and re-sends
 * the camera on every lightbox close, through a round trip that is not
 * bit-exact, so equality would read every close of an oriented model as a move
 * (see `CAMERA_EPSILON` for the measurement).
 */
function cameraMoved(next: CameraState | null | undefined, prev: CameraState | undefined): boolean {
  if (next === undefined) return false
  if (next === null) return prev !== undefined
  if (prev === undefined) return true
  return (
    Math.abs(next.az - prev.az) > CAMERA_EPSILON ||
    Math.abs(next.el - prev.el) > CAMERA_EPSILON ||
    Math.abs(next.distR - prev.distR) > CAMERA_EPSILON ||
    Math.abs(next.target[0] - prev.target[0]) > CAMERA_EPSILON ||
    Math.abs(next.target[1] - prev.target[1]) > CAMERA_EPSILON ||
    Math.abs(next.target[2] - prev.target[2]) > CAMERA_EPSILON
  )
}

/** The same question for the axis, which is an enum and compares by equality. */
function axisMoved(next: OrbitAxis | null | undefined, prev: OrbitAxis | undefined): boolean {
  if (next === undefined) return false
  if (next === null) return prev !== undefined
  return next !== prev
}

/**
 * Invalidation (D2): the render's recipe labels go, its `mtime` and its pixels
 * stay. Clearing the `mtime` instead would make it answer `stale`, which
 * carries no pixels — and the tile would blank until its replacement rendered.
 * Kept as a hit whose labels fail the client's recipe check, it is shown at the
 * old orientation for exactly as long as it takes to draw the new one.
 */
function clearRecipe(labels: RenderLabels): RenderLabels {
  return { mtime: labels.mtime }
}

/**
 * The four label fields and nothing else. The occluded render's live at the top
 * level of a `Meta` beside `path`, `camera` and `axis`, so reading them as a
 * `RenderLabels` has to *pick* rather than alias: the sibling's copy is written
 * back into `noao`, and spreading a whole `Meta` in there would file the
 * entry's path and camera inside its own sidecar.
 */
function renderLabels(from: RenderLabels | null | undefined): RenderLabels {
  if (from === null || from === undefined) return {}
  return { mtime: from.mtime, lighting: from.lighting, rig: from.rig, posed: from.posed }
}

function hasLabels(labels: RenderLabels): boolean {
  return (
    labels.mtime !== undefined ||
    labels.lighting !== undefined ||
    labels.rig !== undefined ||
    labels.posed !== undefined
  )
}

const DEFAULT_CAP = 2 * 1024 ** 3
/** PNG writes between automatic maintenance runs (D4: "after writes crossing a threshold"). */
const MAINTAIN_EVERY = 32

/**
 * The size cap from the environment — parsed, never coerced, on `envLimit`'s
 * rule (`listing.ts`): a non-finite or non-positive value falls back to the
 * default. `Number('2GB')` is NaN, `total <= NaN` is false, and a NaN cap
 * therefore evicted every PNG in the cache on every sweep — a malformed knob
 * doing the opposite of what it spells.
 */
function envCap(): number {
  const raw = process.env.MODEL_BROWSER_CACHE_CAP
  if (raw === undefined || raw.trim() === '') return DEFAULT_CAP
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_CAP
}

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
    readonly sizeCap: number = envCap(),
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

  /** The occluded render's file is the historical one; the sibling is suffixed. */
  private pngFile(dir: string, key: string, ao = true): string {
    return join(dir, ao ? `${key}.png` : `${key}.noao.png`)
  }

  /**
   * `protected` rather than `private` so a test can observe the two reads the
   * size-cap pass makes of one sidecar (snapshot, then re-read) and interpose a
   * `put` between them; nothing in production subclasses this.
   */
  protected async readMeta(dir: string, key: string): Promise<Meta | null> {
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


  /**
   * Read one render of an entry. `ao` names which — the occluded render by
   * default, which is what every caller meant before renders were keyed by
   * occlusion and what every pre-existing entry holds.
   *
   * The status is that render's alone: its pixels, its labels, its `mtime`.
   * The camera and axis are the entry's and come back on every status, because
   * a client told `stale` or `miss` for one render still has to draw it at the
   * orientation the other one is already drawn at.
   */
  async get(path: string, mtime: number, ao = true): Promise<ThumbGetResponse> {
    const dir = await this.entryDir()
    const key = this.key(path)
    const meta = await this.readMeta(dir, key)
    if (meta === null) return { status: 'miss' }
    const labels: RenderLabels = (ao ? meta : meta.noao) ?? {}
    // Not defaulted here: the *absence* of a stored axis is information a
    // client needs. Defaulting it to 'y' made "nothing stored" indistinguishable
    // from "stored as y", so a model whose thumbnail was rendered at an
    // index-supplied pose (which deliberately stores no axis) reported `y`, and
    // the viewer abandoned the pose the moment it opened. Every caller already
    // applies its own default.
    const axis = meta.axis
    const lighting = labels.lighting
    const rig = labels.rig
    const posed = labels.posed
    // Per render, but with the entry's camera: this render was written before,
    // or the model has an orientation stored, and either way the client has
    // something to re-render from. An axis alone is not enough — an entry
    // holding only an axis is still a miss, as it was before renders split.
    if (labels.mtime !== mtime) return { status: meta.camera !== undefined || labels.mtime !== undefined ? 'stale' : 'miss', camera: meta.camera, axis, lighting, rig, posed }
    let png
    try {
      png = await readFile(this.pngFile(dir, key, ao))
    } catch {
      return { status: 'stale', camera: meta.camera, axis, lighting, rig, posed }
    }
    // LRU clock for size-cap eviction is the png file's mtime. Bumping it via
    // utimes (instead of rewriting the meta json) keeps reads race-free
    // against the sweep: it cannot resurrect a removed entry and cannot be
    // caught mid-write by the sweep's meta parse. Each render carries its own
    // clock, so reading one never defends the other from the cap (D3).
    const now = new Date()
    await utimes(this.pngFile(dir, key, ao), now, now).catch(() => {})
    return { status: 'hit', camera: meta.camera, axis, lighting, rig, posed, png: png.toString('base64') }
  }

  /**
   * Write one render of an entry — `opts.ao` names which, occluded by default.
   * The pixels and labels land on that render; the camera and axis are the
   * entry's and are written whichever render carried them.
   *
   * Because the orientation is shared and both renders are always drawn under
   * it, a write that *moves* it leaves the render it did not draw at an angle
   * the entry no longer claims — so that render is invalidated (D2), and both
   * are when the write carries no pixels: there is then no drawn render, and no
   * labels of its own to apply either, so any this PUT declared go with the
   * rest. A write carrying only pixels and labels touches the other render
   * never, which is what makes toggling the preference back a lookup.
   */
  async put(path: string, opts: { mtime: number; png?: Buffer; camera?: CameraState | null; axis?: OrbitAxis | null; lighting?: LightingMode; rig?: number; posed?: number; ao?: boolean }): Promise<void> {
    const dir = await this.entryDir()
    const key = this.key(path)
    const ao = opts.ao ?? true
    const prev = await this.readMeta(dir, key)
    const prevMine = renderLabels(ao ? prev : prev?.noao)
    const prevTheirs = renderLabels(ao ? prev?.noao : prev)

    let mine: RenderLabels = {
      mtime: opts.png !== undefined ? opts.mtime : prevMine.mtime,
      // Like mtime, lighting and rig describe the pixels: a PUT replacing the
      // PNG without declaring them must not keep old labels on new pixels.
      lighting: opts.png !== undefined ? opts.lighting : (opts.lighting ?? prevMine.lighting),
      rig: opts.png !== undefined ? opts.rig : (opts.rig ?? prevMine.rig),
      posed: opts.png !== undefined ? opts.posed : (opts.posed ?? prevMine.posed),
    }
    let theirs: RenderLabels = prevTheirs

    // The model itself changed under both renders, so the sibling's pixels are
    // of a file that is gone. Strictly newer, not merely different: an equal
    // mtime is the ordinary case of drawing the second render of the same file,
    // and a written mtime *older* than the sibling's makes this write the stale
    // one — deleting the sibling's newer pixels then would be backwards.
    const supersedes = opts.png !== undefined && theirs.mtime !== undefined && opts.mtime > theirs.mtime
    if (supersedes) theirs = {}

    const moved = cameraMoved(opts.camera, prev?.camera) || axisMoved(opts.axis, prev?.axis)
    if (moved) {
      theirs = clearRecipe(theirs)
      if (opts.png === undefined) mine = clearRecipe(mine)
    }

    const occluded = ao ? mine : theirs
    const unoccluded = ao ? theirs : mine
    const meta: Meta = {
      path,
      ...occluded,
      // Three states per field: a value sets it, silence keeps what was there,
      // `null` discards it. Silence cannot mean discard — every PNG write omits
      // both — and a written default is not a discard either: it is an
      // orientation of the user's own, and it suppresses the index that would
      // otherwise frame the model well (entry-context-menu D7).
      camera: opts.camera === null ? undefined : (opts.camera ?? prev?.camera),
      axis: opts.axis === null ? undefined : (opts.axis ?? prev?.axis),
      // Omitted rather than written empty, so an entry that has never held an
      // unoccluded render keeps exactly the sidecar shape it had before this
      // change — the whole of the "no migration" claim (D1).
      noao: hasLabels(unoccluded) ? unoccluded : undefined,
    }
    if (opts.png !== undefined) {
      await mkdir(dir, { recursive: true })
      // Superseded-mtime PNG is inherently replaced: one PNG per render per key.
      await writeFile(this.pngFile(dir, key, ao), opts.png)
    }
    if (supersedes) await rm(this.pngFile(dir, key, !ao), { force: true })
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
      // Belt and braces, and redundant since library-root 1.7: `state()` now
      // stats the top itself, so a volume unplugged mid-session already answers
      // `missing` above. Kept because of what it guards — a `ready` read
      // against an absent top makes every `resolve` land on a path that no
      // longer stats, and a single sweep then takes the whole library's cache,
      // cameras included. The stat costs microseconds once per sweep; being
      // wrong here costs the cameras.
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
    // One row per *render*, not per entry (D3): the two PNGs of a model are
    // independent LRU candidates, so an unoccluded render nobody has looked at
    // since is evicted while the occluded one read this morning stays. The
    // existence sweep is still per entry — one model, one existence.
    const metas: { key: string; ao: boolean; meta: Meta; pngSize: number; lastRead: number }[] = []
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const key = f.slice(0, -'.json'.length)
      const meta = await this.readMeta(dir, key)
      if (meta === null) continue
      if (!(await this.sourceExists(meta.path))) {
        await rm(this.metaFile(dir, key), { force: true })
        await rm(this.pngFile(dir, key, true), { force: true })
        await rm(this.pngFile(dir, key, false), { force: true })
        continue
      }
      for (const ao of [true, false]) {
        const pngStat = await stat(this.pngFile(dir, key, ao)).catch(() => null)
        if (pngStat === null) continue // that render is not cached: nothing to evict
        metas.push({ key, ao, meta, pngSize: pngStat.size, lastRead: pngStat.mtimeMs })
      }
    }

    let total = metas.reduce((sum, m) => sum + m.pngSize, 0)
    if (total <= this.sizeCap) return
    metas.sort((a, b) => a.lastRead - b.lastRead)
    for (const m of metas) {
      if (total <= this.sizeCap) break
      if (m.pngSize === 0) continue
      // A `put` can land between the snapshot above and this eviction: writing
      // the snapshot back would delete its fresh PNG and revert its camera. The
      // invariant this eviction needs is that the snapshot's LRU facts about
      // *this PNG* are still current — not that the model's mtime is unchanged.
      // The common re-render leaves that mtime alone: an orbit persist, a rig,
      // lighting or pose bump writes new pixels for a model that did not change,
      // so `put` stores the same `mtime` it stored before. So re-read the
      // sidecar (a vanished entry is not ours to evict) and then stat the PNG:
      // gone, or an `mtimeMs` or `size` other than the snapshot measured, means
      // some write or read-bump landed since — the ordering that elected this
      // victim and the byte count that would be subtracted are both stale.
      // Leave it alone and count nothing against the cap. Otherwise the size is
      // the verified one, and evicting from the re-read lets a camera written
      // meanwhile survive.
      const fresh = await this.readMeta(dir, m.key)
      if (fresh === null) continue
      const png = await stat(this.pngFile(dir, m.key, m.ao)).catch(() => null)
      if (png === null || png.mtimeMs !== m.lastRead || png.size !== m.pngSize) continue
      // The window that remains is accepted, and unclosable without locking: a
      // `put` landing after that stat still loses its PNG below, and a camera it
      // wrote is overwritten by the one the re-read carries.
      await rm(this.pngFile(dir, m.key, m.ao), { force: true })
      // Only this render's `mtime`, and only this render's: the labels stay and
      // ride the stale read — they say what recipe the evicted pixels were
      // under, which is what the client asks a stale answer for — and the other
      // render is untouched, cap candidate on its own clock or not.
      await this.writeMeta(
        dir,
        m.key,
        m.ao ? { ...fresh, mtime: undefined } : { ...fresh, noao: { ...renderLabels(fresh.noao), mtime: undefined } },
      )
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
   *
   * These entries belong to *other* libraries, and the sweep gets the same
   * protection this library's own does: an absent file is only a deleted file
   * when its containing directory is there to say so. A missing file whose
   * whole directory is gone is the shape of an unmounted volume — the case the
   * spec names ("an unmounted volume is not a deleted library") and the one
   * D5 leaves "for another library to claim" — so it is left alone. Stat'ing
   * the file alone could not tell the two apart, and took the cameras of every
   * library that happened not to be plugged in.
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
      // A path that does not parse names no file in any library — nobody will
      // claim it and nothing else reads it — so it goes without a test.
      const source = parseVPathSafe(meta.path)
      if (source !== null) {
        if ((await stat(source).catch(() => null)) !== null) continue
        // The file is not there. Only its containing directory can say whether
        // that is a deletion or a volume that is not mounted.
        if ((await stat(dirname(source)).catch(() => null)) === null) continue
      }
      await rm(this.metaFile(this.dir, key), { force: true })
      await rm(this.pngFile(this.dir, key, true), { force: true })
      await rm(this.pngFile(this.dir, key, false), { force: true })
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
        await rm(this.pngFile(this.dir, key, true), { force: true })
        await rm(this.pngFile(this.dir, key, false), { force: true })
        continue
      }
      // Every file of the key moves, sibling included. A flat entry cannot
      // *have* an unoccluded render — that file is born after this change,
      // under a per-library key — so the second rename always misses; it is
      // here so the migration can never be the thing that drops one, rather
      // than because anything is expected to be found.
      await rename(this.pngFile(this.dir, key, true), this.pngFile(target, newKey, true)).catch(() => {})
      await rename(this.pngFile(this.dir, key, false), this.pngFile(target, newKey, false)).catch(() => {})
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
