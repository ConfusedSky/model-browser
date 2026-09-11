import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { CAMERA_EPSILON, type CameraState, type LightingMode, type OrbitAxis, type ThumbGetResponse, type ThumbInfo, type ThumbRenderInfo, type ThumbStatus } from '../../shared/types'
import { envPositiveInt } from './env'
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
 * level, its pixels in `<key>.webp` — because it is the render every existing
 * cache already holds, and making it a member of a symmetric map would have
 * cost a migration of every one of them. The unoccluded render is named for
 * what it lacks: `<key>.noao.webp`, labels under `noao`. A sidecar written
 * before this change simply has no `noao`, which is exactly what "no
 * unoccluded render is cached" means.
 *
 * `camera` and `axis` sit outside both: the orientation belongs to the model,
 * not to a recipe, and both renders are always drawn under it.
 */
interface Meta extends RenderLabels {
  path: string
  camera?: CameraState
  /**
   * Orbit spindle axis; undefined means no stored axis. What the entry is then
   * rendered about is the caller's — the format's default — not this store's.
   */
  axis?: OrbitAxis
  /** The unoccluded sibling's labels; absent when it is not cached. */
  noao?: RenderLabels
  /**
   * Write generation (`immutable-thumbnail-serving` D1) — the cache validator
   * every read echoes and every write moves.
   *
   * It sits here, beside `path`/`camera`/`axis`, and **not** in either render's
   * `RenderLabels`, because it is a fact about the *entry*. `put` invalidates
   * the *sibling* render in three separate cases — `supersedes` deletes its PNG
   * outright, and both `moved` and the unowned-pose rule run `clearRecipe` over
   * its labels — so a write aimed at one render routinely changes what the
   * other one answers. A per-render counter would leave the invalidated
   * sibling's URL unchanged while its bytes changed underneath, which under
   * `immutable` pins them. One counter for both renders is the conservative
   * direction: a write to one variant churns the other's cached URL once, which
   * costs a revalidation and can never serve stale pixels.
   *
   * Absent on every sidecar written before this change, which reads as 0.
   * `allocateGen` is the only thing that produces a value for it.
   */
  gen?: number
}

/**
 * The merge for a three-state field: a value **sets** it, silence **keeps**
 * what was there, `null` **discards** it. Silence cannot mean discard — every
 * PNG write omits both orientation fields — and a written default is not a
 * discard either: it is an orientation of the user's own, and it suppresses the
 * index that would otherwise frame the model well (entry-context-menu D7).
 *
 * A function rather than two inline ternaries because `put` now applies it
 * twice: once in its ordinary merge, once on the deletion branch, which governs
 * the orientation by the same rule (`bulk-thumbnail-jobs` D3).
 */
function merged<T>(next: T | null | undefined, prev: T | undefined): T | undefined {
  return next === null ? undefined : (next ?? prev)
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

/**
 * Is this render a hit, a stale one, or absent — the one predicate, extracted so
 * the read path and the listing annotation cannot drift apart
 * (`listing-tree-cache` §6.2, `thumbnail-image-serving` D2).
 *
 * Staleness is the render's stored `mtime` against the model's own. An entry
 * holding **only** an axis is still a miss, as it was before renders split: an
 * axis is not something to re-render from, while a camera is.
 *
 * `get` applies one more test this cannot — whether the PNG is actually on disk
 * — and downgrades a hit to `stale` when it is not. The annotation is a memory
 * lookup with no file to stat, so `hit` there means "the sidecar says these
 * pixels were rendered against this mtime"; `thumbnail-image-serving` D3 owns
 * the fallback for the case they have since been evicted.
 */
function statusFor(
  labels: RenderLabels,
  camera: CameraState | undefined,
  mtime: number,
): ThumbStatus {
  if (labels.mtime === mtime) return 'hit'
  return camera !== undefined || labels.mtime !== undefined ? 'stale' : 'miss'
}

/**
 * One entry's cached state as a listing carries it, derived from the sidecar
 * this process last read or wrote. `null` is a sidecar that was looked for and
 * was not there — a true fact, and a useful one: nothing is cached for this
 * model, and a reader can skip asking.
 */
function infoFor(meta: Meta | null, mtime: number): ThumbInfo {
  if (meta === null) {
    return { gen: 0, framed: false, ao: { state: 'miss' }, noao: { state: 'miss' } }
  }
  const info: ThumbInfo = {
    gen: meta.gen ?? 0,
    // The definition `bulk-thumbnail-jobs`' reset derivation shares (its review
    // M4): a stored orientation is a camera **or** an axis.
    framed: meta.camera !== undefined || meta.axis !== undefined,
    ao: renderInfo(meta, meta.camera, mtime),
    noao: renderInfo(renderLabels(meta.noao), meta.camera, mtime),
  }
  if (meta.camera !== undefined) info.camera = meta.camera
  // Undefined is information here for the same reason it is in `get`: "nothing
  // stored" and "stored as y" are different facts, and defaulting made a model
  // framed at an index-supplied pose report an axis it never had.
  if (meta.axis !== undefined) info.axis = meta.axis
  return info
}

function renderInfo(
  labels: RenderLabels,
  camera: CameraState | undefined,
  mtime: number,
): ThumbRenderInfo {
  const out: ThumbRenderInfo = { state: statusFor(labels, camera, mtime) }
  if (labels.lighting !== undefined) out.lighting = labels.lighting
  if (labels.rig !== undefined) out.rig = labels.rig
  if (labels.posed !== undefined) out.posed = labels.posed
  return out
}

/**
 * The last write generation handed out, process-wide. Module-level rather than
 * per-cache so that two `ThumbCache` instances over one directory — which is
 * what the test suite builds, and what any future second reader would be —
 * cannot issue the same number.
 */
let lastGen = 0

/**
 * Allocate the generation a write will land under (D1) — strictly increasing,
 * never repeated.
 *
 * Allocated **here, not from the sidecar `put` just read**, and that is the
 * whole point. `put` is an unserialized read-modify-write (see its own note):
 * two concurrent puts for one path each merge against the same `prev`. A
 * generation derived from what they read — `prev.gen + 1` — is therefore issued
 * *twice*, for two different sets of bytes, and under `immutable` that is the
 * one failure with no recovery path: the loser's PUT echoed a number that is
 * also the winner's, so the stale-generation tier never fires, and a browser
 * that fetched at that number serves the loser's pixels for a year.
 *
 * Allocating outside the merge gives the two writes different numbers. The last
 * writer's sidecar still wins — that race is unchanged and still accepted — but
 * the loser's number is simply never current, so it is never granted
 * `immutable` and its next read re-keys against the winner's.
 *
 * Three floors, each covering what the others cannot:
 *
 * - `Date.now()` — so a generation never regresses across an entry's eviction
 *   and re-creation, or across a process restart, where no in-memory counter
 *   survives to say what was already issued.
 * - `lastGen + 1` — carries it past a tie when two writes land inside one
 *   millisecond, which wall-clock alone cannot separate. This is also the term
 *   that closes the race above: it is read and updated in one synchronous step,
 *   so the second of two interleaved puts cannot see the first's value.
 * - `prev + 1` — the entry's own stored generation, for the case neither clock
 *   term covers: a `prev` written by some *other* process's clock, which a
 *   cache directory copied between machines or a clock skew can put ahead of
 *   both `Date.now()` and this process's `lastGen`. Without it a write would
 *   issue a number below the entry's own stored one — a per-entry regression,
 *   which is the exact failure the generation exists to prevent.
 *
 * Reading `prev` here does not reintroduce the duplicate-issue race, because
 * `lastGen` still participates: two puts that merged against the same sidecar
 * pass the same `prev`, but the second still clears the first's `lastGen`.
 */
function allocateGen(prev: number | undefined): number {
  lastGen = Math.max(Date.now(), lastGen + 1, (prev ?? 0) + 1)
  return lastGen
}

/**
 * A conditional write (`put`'s `ifGen`) whose named generation is no longer the
 * entry's — `bulk-thumbnail-jobs` D4. **Nothing was written**: the sidecar is
 * untouched, no PNG moved, and no generation was allocated.
 *
 * `gen` is the entry's current generation, so a caller can re-key from the
 * throw itself rather than reading the entry back to find out what it lost to.
 */
export class StaleWriteError extends Error {
  constructor(readonly gen: number) {
    super(`generation moved to ${gen}`)
  }
}

const DEFAULT_CAP = 2 * 1024 ** 3
/** PNG writes between automatic maintenance runs (D4: "after writes crossing a threshold"). */
const MAINTAIN_EVERY = 32

/**
 * The size cap from the environment — `env.ts`'s one parser, which owns the
 * rule: a non-finite, fractional or non-positive value falls back to the
 * default. `Number('2GB')` is NaN, `total <= NaN` is false, and a NaN cap
 * therefore evicted every PNG in the cache on every sweep — a malformed knob
 * doing the opposite of what it spells.
 *
 * This copy is why `env.ts` exists at all: it floored *after* the positivity
 * test, so `MODEL_BROWSER_CACHE_CAP=0.5` gave a cap of 0 and swept the whole
 * pixel store on every write — the same bug the other two copies had, fixed in
 * them and missed here (`listing-tree-cache` round-2 finding 9).
 */
function envCap(): number {
  return envPositiveInt('MODEL_BROWSER_CACHE_CAP', DEFAULT_CAP)
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
  /**
   * What this process has learned about each entry, by library path
   * (`listing-tree-cache` §6.2): the sidecar as it was last read or written, or
   * `null` for one that was looked for and was not there.
   *
   * Maintained on this cache's **own** reads and writes and on its sweep —
   * every path through `readMeta`/`writeMeta` is one of those — so a listing
   * costs a `Map` get per entry and never a directory scan. That is the whole
   * point: the annotation must be affordable on a grid of hundreds of tiles.
   *
   * Consequently it knows only about entries this process has touched, and an
   * entry it has not is simply absent from a listing's annotation rather than
   * reported as a miss. The startup `maintain()` sweep already reads every
   * sidecar in the library's directory, so a server that has swept knows the
   * lot without a scan of its own.
   *
   * Unbounded, deliberately: one small record per entry the cache has seen
   * (~200 bytes; the measured 18,705-entry library is a few MB), against a
   * 2 GB pixel budget beside it. Entries the sweep deletes are dropped here too,
   * so it cannot outgrow the store it describes.
   */
  private readonly facts = new Map<string, Meta | null>()

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
  private renderFile(dir: string, key: string, ao = true): string {
    return join(dir, ao ? `${key}.webp` : `${key}.noao.webp`)
  }

  /**
   * Renders in an encoding this app no longer produces — PNG, before
   * `webp-thumbnails`. `renderFile` cannot name them any more, which is exactly
   * why they must be named here: what the store cannot name it cannot measure,
   * cannot evict, and does not remove when the model itself is deleted, so an
   * orphan outlives the thing it depicts.
   *
   * They are deleted wherever they are met rather than carried along, because
   * a format change is a pixel change and so always arrives with a
   * `RIG_VERSION` bump: pixels under a superseded encoding are stale
   * everywhere, and no site could serve them even if it kept them.
   */
  private supersededFiles(dir: string, key: string, ao?: boolean): string[] {
    const both: readonly boolean[] = ao === undefined ? [true, false] : [ao]
    return both.map((a) => join(dir, a ? `${key}.png` : `${key}.noao.png`))
  }

  private async rmSuperseded(dir: string, key: string, ao?: boolean): Promise<void> {
    for (const f of this.supersededFiles(dir, key, ao)) await rm(f, { force: true })
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
    // Every write path in this class lands here — `put`, the size cap's
    // write-back, the migration — so recording at this one point is what makes
    // the index track the store by construction rather than by an enumeration
    // of call sites that a later writer could fall out of.
    this.remember(meta.path, meta)
  }

  /**
   * What the index now knows about one entry. A copy, because the caller's
   * object goes on to be JSON'd, spread and re-merged: sharing it would let a
   * later merge mutate what a listing is about to report.
   */
  private remember(path: string, meta: Meta | null): void {
    this.facts.set(path, meta === null ? null : { ...meta })
  }

  /**
   * This entry's cached state for a listing to carry (§6.2/§6.3), or undefined
   * when this process has learned nothing about the path.
   *
   * A `Map` get and a pure derivation: **no I/O**, so emission never waits on
   * the filesystem, and undefined is "not known here", never "not cached" — the
   * client asks `/api/thumb` for those exactly as it did before.
   */
  annotate(path: string, mtime: number): ThumbInfo | undefined {
    const meta = this.facts.get(path)
    if (meta === undefined) return undefined
    return infoFor(meta, mtime)
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
    const { body, png } = await this.read(path, mtime, ao)
    return png === undefined ? body : { ...body, png: png.toString('base64') }
  }

  /**
   * One render's pixels, for the image route (`thumbnail-image-serving` D1):
   * the entry's generation, and the PNG bytes exactly when the render is a hit
   * with its file on disk. Anything else — miss, stale, a hit whose PNG the
   * size cap has since taken — is `png: undefined`, and the route answers
   * not-found; the JSON route is what says *why*. The same read as `get`, so
   * the two cannot disagree about what a hit is, and the same LRU bump (D7):
   * a cold-browser view of the image counts as a read.
   */
  async image(path: string, mtime: number, ao = true): Promise<{ gen: number; png?: Buffer }> {
    const { body, png } = await this.read(path, mtime, ao)
    return { gen: body.gen ?? 0, png }
  }

  /** The read both `get` and `image` are: the answer, and the raw bytes on a hit. */
  private async read(
    path: string,
    mtime: number,
    ao: boolean,
  ): Promise<{ body: Omit<ThumbGetResponse, 'png'>; png?: Buffer }> {
    const dir = await this.entryDir()
    const key = this.key(path)
    const meta = await this.readMeta(dir, key)
    // Both answers are facts worth keeping (§6.2): the sidecar, or that there
    // is none. A read is where this cache learns about an entry it has not
    // written, which is most of them after a restart.
    this.remember(path, meta)
    // An entry that does not exist has answered nothing, so it has issued no
    // generation: 0. The number still rides along, because the caller's cache
    // policy is decided from it uniformly and a miss is `no-store` anyway.
    if (meta === null) return { body: { status: 'miss', gen: 0 } }
    const gen = meta.gen ?? 0
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
    // The predicate is `statusFor`, shared with the listing annotation so the
    // two can never come to disagree about what a cached render is.
    const status = statusFor(labels, meta.camera, mtime)
    if (status !== 'hit') return { body: { status, camera: meta.camera, axis, lighting, rig, posed, gen } }
    let png
    try {
      png = await readFile(this.renderFile(dir, key, ao))
    } catch {
      return { body: { status: 'stale', camera: meta.camera, axis, lighting, rig, posed, gen } }
    }
    // LRU clock for size-cap eviction is the png file's mtime. Bumping it via
    // utimes (instead of rewriting the meta json) keeps reads race-free
    // against the sweep: it cannot resurrect a removed entry and cannot be
    // caught mid-write by the sweep's meta parse. Each render carries its own
    // clock, so reading one never defends the other from the cap (D3).
    const now = new Date()
    await utimes(this.renderFile(dir, key, ao), now, now).catch(() => {})
    return { body: { status: 'hit', camera: meta.camera, axis, lighting, rig, posed, gen }, png }
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
   * never — which is what makes toggling the preference back a lookup — save
   * for the one exception the unowned-pose rule below states: an entry holding
   * no orientation has no shared angle for both renders to be drawn under, so
   * the applied-pose record takes that role and a difference in it is a move.
   *
   * Returns the entry's generation after the write. This is the **only** place
   * a generation is issued: every write path the app has — either render's
   * pixels, a camera set or discarded, an axis set or discarded — arrives here,
   * so bumping unconditionally at one point is what makes "any change to what a
   * thumbnail URL would answer moves the generation" true by construction
   * rather than by an enumeration that a later write path could fall out of
   * (D1). A put that happens to change nothing observable still bumps; the cost
   * is one revalidation, and the alternative — deciding per field whether this
   * write mattered — is the shape that pins stale pixels the day it is wrong.
   *
   * Two options belong to a bulk job rather than to an ordinary write, and each
   * is documented at the branch that reads it: `png: null` **deletes** the
   * entry's renders (`bulk-thumbnail-jobs` D3), and `ifGen` makes the write
   * conditional — it **throws `StaleWriteError`**, having written nothing, when
   * the entry has moved past the generation the caller named (D4).
   */
  async put(path: string, opts: { mtime: number; png?: Buffer | null; camera?: CameraState | null; axis?: OrbitAxis | null; lighting?: LightingMode; rig?: number; posed?: number; ao?: boolean; ifGen?: number }): Promise<number> {
    const dir = await this.entryDir()
    const key = this.key(path)
    const ao = opts.ao ?? true
    // Read-modify-write with awaits between the read and the write: two
    // concurrent puts for one path (one per render, plausible around a toggle
    // plus a command) can each merge against the same `prev`, and the loser's
    // sidecar half lands from a stale read. Accepted, and unclosable without
    // locking — but the cost is worse than one wrong-labelled render (third
    // review, 2026-08-31): the stale merge can revert the winner's camera to
    // a self-consistent pre-move state nothing re-renders, and can resurrect
    // sibling labels a camera move had just cleared, pairing the winner's
    // new-angle PNG with the old camera as a fresh-looking hit. Only a later
    // camera write heals those. The window is one request round-trip wide and
    // needs a toggle racing a close on one model; recorded, not defended.
    const prev = await this.readMeta(dir, key)

    // The precondition, first and before anything is merged, allocated or
    // written (`bulk-thumbnail-jobs` D4): a writer that named a generation the
    // entry has since moved past is refused outright. This path writes
    // *nothing* — the sidecar's bytes are unchanged, no PNG is touched, no
    // generation is allocated, and the maintenance counter does not move — so a
    // refusal costs the entry exactly one read. A missing entry has issued no
    // generation, which is 0, so `ifGen: 0` asks for "only if nothing has ever
    // been written here".
    //
    // Honest about its reach: this narrows the window to `put`'s own
    // unserialized read-modify-write — the span between this `readMeta` and the
    // `writeMeta` below, which the note above already records as accepted — and
    // does not close it. Two writes can still both pass their precondition
    // against the same `prev` and the last one still wins. Closing it needs
    // locking, and the point here is only to keep a job from overwriting a
    // write it can see, not to serialize the store.
    if (opts.ifGen !== undefined && opts.ifGen !== (prev?.gen ?? 0)) {
      throw new StaleWriteError(prev?.gen ?? 0)
    }

    // Deletion (`bulk-thumbnail-jobs` D3) — a branch of its own, deliberately,
    // never a `null` threaded through the `opts.png !== undefined` tests below.
    // Every one of those would read `null` as pixels: it would adopt this
    // write's mtime, label a render that has no bytes, and can trip
    // `supersedes` into taking the sibling's PNG; `get` would then answer
    // `stale` for an entry that holds nothing at all.
    //
    // Both renders go together, because both were drawn under the orientation
    // the same write is giving up. What survives is the sidecar, emptied of
    // every label — so `hasLabels` is false and `noao` is omitted exactly as on
    // an entry that never had one — carrying whatever orientation this write's
    // own `camera`/`axis` fields leave, on the same keep/set/discard rule as any
    // other write. No mtime is adopted: nothing was rendered here.
    //
    // None of the sibling-invalidation rules below reach this branch, and there
    // is nothing for them to do: `supersedes`, `moved` and the unowned-pose rule
    // exist to stop a render being served at an angle the entry no longer
    // claims, and after this there are no labels left to invalidate.
    //
    // The generation moves as it does on every write — the number stays
    // monotonic across the emptying, so a browser holding the deleted pixels
    // re-keys rather than serving them — and `writesSinceMaintain` does not:
    // maintenance keeps the store under its cap, and this write put nothing in
    // it.
    if (opts.png === null) {
      await rm(this.renderFile(dir, key, true), { force: true })
      await rm(this.renderFile(dir, key, false), { force: true })
      await this.rmSuperseded(dir, key)
      const gen = allocateGen(prev?.gen)
      await this.writeMeta(dir, key, {
        path,
        camera: merged(opts.camera, prev?.camera),
        axis: merged(opts.axis, prev?.axis),
        gen,
      })
      return gen
    }

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

    // Three states per field — set / keep / discard; the rule itself lives in
    // `merged`, which the deletion branch above applies to the same two fields.
    const camera = merged(opts.camera, prev?.camera)
    const axis = merged(opts.axis, prev?.axis)

    // An entry left *unowned* by this write's own merge — no camera and no axis
    // — has no stored orientation for both renders to be drawn under. Each is
    // instead drawn at "the pose if one was applied, else the default", so the
    // applied-pose record is what says which of those two a render shows: the
    // written render's is `opts.posed` (absent = unposed), the sibling's is its
    // stored `posed`, and a difference between them is a difference in the
    // orientation actually drawn — the same fact `cameraMoved` detects for an
    // owned entry. The sibling's pixels are then at an angle this entry no
    // longer draws, so it is invalidated exactly as `moved` invalidates it.
    // An owned entry is exempt: both its renders are drawn under the stored
    // orientation and `posed` merely rides along. `supersedes` and `moved` run
    // first and win — they have already emptied the sibling's labels.
    //
    // Found live 2026-08-31: 24 pairs in the real cache whose occluded render
    // had been drawn under an index pose from a meaning search (`posed: 2`)
    // while the unoccluded sibling was later drawn unposed by a plain-listing
    // sweep — a pixels-only PUT, which by design "touches the other render
    // never". The labels recorded the difference and nothing acted on it.
    //
    // The ping-pong this admits is bounded and accepted: a posed PUT beside an
    // unposed sibling invalidates it, the sibling's later unposed re-render
    // invalidates back once, and it converges as soon as two consecutive PUTs
    // agree on the pose.
    if (
      opts.png !== undefined &&
      !supersedes &&
      !moved &&
      camera === undefined &&
      axis === undefined &&
      mine.posed !== theirs.posed
    ) {
      theirs = clearRecipe(theirs)
    }

    const occluded = ao ? mine : theirs
    const unoccluded = ao ? theirs : mine
    // `prev` is a floor here, never the source: see `allocateGen`. Two puts
    // that merged against the same sidecar must not land under one number.
    const gen = allocateGen(prev?.gen)
    const meta: Meta = {
      path,
      ...occluded,
      camera,
      axis,
      gen,
      // Omitted rather than written empty, so an entry that has never held an
      // unoccluded render keeps exactly the sidecar shape it had before this
      // change — the whole of the "no migration" claim (D1).
      noao: hasLabels(unoccluded) ? unoccluded : undefined,
    }
    if (opts.png !== undefined) {
      await mkdir(dir, { recursive: true })
      // Superseded-mtime pixels are inherently replaced: one render per key.
      await writeFile(this.renderFile(dir, key, ao), opts.png)
      // These new bytes are this render, so anything it was stored as before
      // this app changed encoding is now duplicate weight.
      await this.rmSuperseded(dir, key, ao)
    }
    if (supersedes) {
      await rm(this.renderFile(dir, key, !ao), { force: true })
      await this.rmSuperseded(dir, key, !ao)
    }
    await this.writeMeta(dir, key, meta)
    if (opts.png !== undefined && ++this.writesSinceMaintain >= this.maintainEvery) {
      this.writesSinceMaintain = 0
      void this.runMaintain()
    }
    return gen
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
    // Renders left by an encoding this app no longer produces, taken from the
    // listing this pass already holds rather than by blind removes per entry:
    // once a cache is clean this costs nothing, where two `rm(force)` calls per
    // sidecar would cost two syscalls per entry forever. Reading the *names*
    // also reaches an orphan whose sidecar is gone, which a per-sidecar loop
    // never visits — and that is the shape an interrupted upgrade leaves.
    const superseded = files.filter((f) => f.endsWith('.png'))
    for (const f of superseded) await rm(join(dir, f), { force: true })

    // One row per *render*, not per entry (D3): the two renders of a model are
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
        await rm(this.renderFile(dir, key, true), { force: true })
        await rm(this.renderFile(dir, key, false), { force: true })
        await this.rmSuperseded(dir, key)
        // The entry is gone, so the index must not go on describing it (§6.2).
        // Dropped rather than remembered as `null`: the model itself no longer
        // exists, so no listing can ever ask about this path again.
        this.facts.delete(meta.path)
        continue
      }
      // The sweep already has every sidecar in its hand, so this is where a
      // freshly started server learns the whole library's thumbnail state
      // without a scan of its own — `index.ts` runs `maintain()` at startup.
      this.remember(meta.path, meta)
      for (const ao of [true, false]) {
        const pngStat = await stat(this.renderFile(dir, key, ao)).catch(() => null)
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
      const png = await stat(this.renderFile(dir, m.key, m.ao)).catch(() => null)
      if (png === null || png.mtimeMs !== m.lastRead || png.size !== m.pngSize) continue
      // The window that remains is accepted, and unclosable without locking: a
      // `put` landing after that stat still loses its PNG below, and a camera it
      // wrote is overwritten by the one the re-read carries. That includes a
      // put for the *sibling* render in the same window — the write-back below
      // carries the whole re-read sidecar, so the sibling's fresh labels are
      // reverted to the re-read's copy alongside; one re-render heals it.
      await rm(this.renderFile(dir, m.key, m.ao), { force: true })
      // Only this render's `mtime`, and only this render's: the labels stay and
      // ride the stale read — they say what recipe the evicted pixels were
      // under, which is what the client asks a stale answer for — and the other
      // render is untouched, cap candidate on its own clock or not.
      //
      // The generation rides through on the spread and is deliberately **not**
      // bumped (D1). Eviction reclaims space; it does not change what the
      // evicted pixels were of. A browser still holding this entry at its
      // current generation holds bytes that are correct for this path, mtime
      // and recipe, and serving them from its own cache is better than the
      // `stale` answer it would get here — which would cost a re-render of a
      // picture that has not changed. What must never happen is the generation
      // *regressing*, and the spread is what guarantees it: drop `...fresh` for
      // a hand-built object and a re-render would re-issue numbers this path
      // has already answered under.
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
      await rm(this.renderFile(this.dir, key, true), { force: true })
      await rm(this.renderFile(this.dir, key, false), { force: true })
      await this.rmSuperseded(this.dir, key)
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
        await rm(this.renderFile(this.dir, key, true), { force: true })
        await rm(this.renderFile(this.dir, key, false), { force: true })
        await this.rmSuperseded(this.dir, key)
        continue
      }
      // Every file of the key moves, sibling included. A flat entry cannot
      // *have* an unoccluded render — that file is born after this change,
      // under a per-library key — so the second rename always misses; it is
      // here so the migration can never be the thing that drops one, rather
      // than because anything is expected to be found.
      await rename(this.renderFile(this.dir, key, true), this.renderFile(target, newKey, true)).catch(() => {})
      await rename(this.renderFile(this.dir, key, false), this.renderFile(target, newKey, false)).catch(() => {})
      // A flat entry's pixels may still be in the superseded encoding, and the
      // renames above cannot name those. They are not carried across: the
      // recipe bump that accompanied the encoding change already made them
      // unserveable, so moving them would re-file garbage under a new key. The
      // sidecar — camera and axis, the part migration exists to keep — moves
      // below; the pixels are re-rendered on the visit that finds them.
      await this.rmSuperseded(this.dir, key)
      // Re-keying, not writing: the pixels and every label are the ones that
      // were already there, so the generation comes across on the spread
      // unbumped along with them. A legacy entry carries none at all, which
      // reads as 0 and is correct — nothing has ever cached a generation for a
      // path under its new library key.
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
