import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import {
  CAMERA_EPSILON,
  type CameraState,
  type LightingMode,
  type OrbitAxis,
  type ThumbGetResponse,
  type ThumbInfo,
  type ThumbRenderInfo,
  type ThumbStatus,
} from "../../shared/types";
import { envPositiveInt } from "./env";
import { type Library, LibraryError } from "./library";
import { VPathError, joinVPath, parseVPath } from "./vpath";

/** What a sidecar records about *one* render's pixels (D1). */
interface RenderLabels {
  /** mtime rendered against; undefined when only a camera is stored. */
  mtime?: number;
  /** Stored and echoed, never interpreted. */
  lighting?: LightingMode;
  /** Pixel-recipe version; stored and echoed, never interpreted. */
  rig?: number;
  /** Pose recipe version; same contract as `rig`. */
  posed?: number;
  /** The orientation a posed render was drawn under (`pose-rerender` D2). */
  poseKey?: string;
}

/**
 * One entry, up to two renders (`ao-as-recipe-dimension` D1). The shape is
 * asymmetric so that every already-written sidecar stays valid. `camera` and
 * `axis` sit outside both: each render is drawn under them.
 */
interface Meta extends RenderLabels {
  path: string;
  camera?: CameraState;
  /** Undefined means no stored axis; the default is then the caller's. */
  axis?: OrbitAxis;
  /** The unoccluded sibling's labels; absent when it is not cached. */
  noao?: RenderLabels;
  /**
   * Write generation (`immutable-thumbnail-serving` D1), one for the **entry**
   * rather than per render: a write routinely invalidates the sibling, whose URL
   * would otherwise stand while its bytes changed — pinned by `immutable`.
   */
  gen?: number;
}

/**
 * Set / keep / discard. Silence cannot mean discard, because every pixel write
 * omits the orientation fields, and a written default is not a discard either:
 * it is the user's own orientation, and it suppresses the index's (D7).
 */
function merged<T>(
  next: T | null | undefined,
  prev: T | undefined,
): T | undefined {
  return next === null ? undefined : (next ?? prev);
}

/**
 * Moving the shared orientation, rather than re-stating it. A tolerance and not
 * equality, because the camera round-trips on every lightbox close and is not
 * bit-exact; D2 accepts the once-per-model cost of a first value counting.
 */
function cameraMoved(
  next: CameraState | null | undefined,
  prev: CameraState | undefined,
): boolean {
  if (next === undefined) return false;
  if (next === null) return prev !== undefined;
  if (prev === undefined) return true;
  return (
    Math.abs(next.az - prev.az) > CAMERA_EPSILON ||
    Math.abs(next.el - prev.el) > CAMERA_EPSILON ||
    Math.abs(next.distR - prev.distR) > CAMERA_EPSILON ||
    Math.abs(next.target[0] - prev.target[0]) > CAMERA_EPSILON ||
    Math.abs(next.target[1] - prev.target[1]) > CAMERA_EPSILON ||
    Math.abs(next.target[2] - prev.target[2]) > CAMERA_EPSILON
  );
}

/** The same question for the axis, which is an enum and compares by equality. */
function axisMoved(
  next: OrbitAxis | null | undefined,
  prev: OrbitAxis | undefined,
): boolean {
  if (next === undefined) return false;
  if (next === null) return prev !== undefined;
  return next !== prev;
}

/**
 * Invalidation (D2): labels go, `mtime` and pixels stay, so the tile shows the
 * old orientation while the new one draws. Clearing the `mtime` would answer
 * `stale`, which carries no pixels, and the tile would blank.
 */
function clearRecipe(labels: RenderLabels): RenderLabels {
  return { mtime: labels.mtime };
}

/**
 * Picked, never aliased: the occluded labels share a `Meta` with `path` and
 * `camera`, and spreading that into `noao` files the entry inside itself.
 */
function renderLabels(from: RenderLabels | null | undefined): RenderLabels {
  if (from === null || from === undefined) return {};
  return {
    mtime: from.mtime,
    lighting: from.lighting,
    rig: from.rig,
    posed: from.posed,
    poseKey: from.poseKey,
  };
}

function hasLabels(labels: RenderLabels): boolean {
  return (
    labels.mtime !== undefined ||
    labels.lighting !== undefined ||
    labels.rig !== undefined ||
    labels.posed !== undefined ||
    labels.poseKey !== undefined
  );
}

/**
 * One predicate, so the read path and the listing annotation cannot drift (§6.2,
 * `thumbnail-image-serving` D2/D3). An entry holding only an axis is a miss: an
 * axis is not something to re-render from, a camera is.
 */
function statusFor(
  labels: RenderLabels,
  camera: CameraState | undefined,
  mtime: number,
): ThumbStatus {
  if (labels.mtime === mtime) return "hit";
  return camera !== undefined || labels.mtime !== undefined ? "stale" : "miss";
}

/** `null` is a sidecar looked for and not found: nothing is cached here. */
function infoFor(meta: Meta | null, mtime: number): ThumbInfo {
  if (meta === null) {
    return {
      gen: 0,
      framed: false,
      ao: { state: "miss" },
      noao: { state: "miss" },
    };
  }
  const info: ThumbInfo = {
    gen: meta.gen ?? 0,
    // A stored orientation is a camera **or** an axis — `bulk-thumbnail-jobs`'
    // reset derivation shares this definition.
    framed: meta.camera !== undefined || meta.axis !== undefined,
    ao: renderInfo(meta, meta.camera, mtime),
    noao: renderInfo(renderLabels(meta.noao), meta.camera, mtime),
  };
  if (meta.camera !== undefined) info.camera = meta.camera;
  // Undefined is information, as in `get`: "nothing stored" and "stored as y"
  // are different facts, and a posed model stores no axis.
  if (meta.axis !== undefined) info.axis = meta.axis;
  return info;
}

function renderInfo(
  labels: RenderLabels,
  camera: CameraState | undefined,
  mtime: number,
): ThumbRenderInfo {
  const out: ThumbRenderInfo = { state: statusFor(labels, camera, mtime) };
  if (labels.lighting !== undefined) out.lighting = labels.lighting;
  if (labels.rig !== undefined) out.rig = labels.rig;
  if (labels.posed !== undefined) out.posed = labels.posed;
  if (labels.poseKey !== undefined) out.poseKey = labels.poseKey;
  return out;
}

/** Module-level, so two `ThumbCache`es over one directory cannot collide. */
let lastGen = 0;

/**
 * Strictly increasing (D1), and **never derived from the sidecar `put` just
 * read**: two concurrent puts merge against one `prev`, so `prev.gen + 1` issues
 * a number for two sets of bytes and `immutable` pins the loser's. Three floors —
 * `Date.now()` across eviction and restart, `lastGen + 1` within a millisecond
 * and between those two puts, `prev + 1` for a sidecar under another clock.
 */
function allocateGen(prev: number | undefined): number {
  lastGen = Math.max(Date.now(), lastGen + 1, (prev ?? 0) + 1);
  return lastGen;
}

/**
 * A conditional write that lost (`bulk-thumbnail-jobs` D4). **Nothing was
 * written**, and `gen` is the current one, so a caller can re-key from the throw.
 */
export class StaleWriteError extends Error {
  constructor(readonly gen: number) {
    super(`generation moved to ${gen}`);
  }
}

const DEFAULT_CAP = 2 * 1024 ** 3;
/** Writes between automatic maintenance runs (D4). */
const MAINTAIN_EVERY = 32;

/** The size cap from the environment, through `env.ts`'s one validated parser. */
function envCap(): number {
  return envPositiveInt("MODEL_BROWSER_CACHE_CAP", DEFAULT_CAP);
}

/**
 * Pixels and camera state, filed under a hash of the library path. Pixels keyed
 * by path+mtime, camera by path alone. Entries live under `<dir>/<id>/`, so a
 * remount keeps the cache and two libraries cannot share one (library-root D5);
 * the flat layout that predates that is migrated in once per process.
 */
export class ThumbCache {
  private writesSinceMaintain = 0;
  private maintaining = false;
  /** The legacy scan is a once-per-process event (D5), not once per sweep. */
  private migrated = false;
  /**
   * What this process has learned about each entry (§6.2), so an annotation costs
   * a `Map` get and never a scan. An entry it has not touched is absent from the
   * annotation rather than a miss; the startup sweep is what usually fills this.
   */
  private readonly facts = new Map<string, Meta | null>();

  constructor(
    readonly dir: string = process.env.MODEL_BROWSER_CACHE ??
      join(homedir(), ".cache", "model-browser"),
    readonly sizeCap: number = envCap(),
    readonly maintainEvery: number = MAINTAIN_EVERY,
    /** Omitting it is test- and legacy-only: entries then live flat, as `migrate` reads. */
    private readonly library?: Library,
  ) {}

  private key(path: string): string {
    return createHash("sha256").update(path).digest("hex");
  }

  /**
   * Awaited because `id()` throws until the library has been evaluated once, and
   * lazily, so the cache can be built before the volume is looked at.
   */
  private async entryDir(): Promise<string> {
    if (this.library === undefined) return this.dir;
    await this.library.state();
    return join(this.dir, this.library.id());
  }

  private metaFile(dir: string, key: string): string {
    return join(dir, `${key}.json`);
  }

  /** The occluded render keeps the unsuffixed name. */
  private renderFile(dir: string, key: string, ao = true): string {
    return join(dir, ao ? `${key}.webp` : `${key}.noao.webp`);
  }

  /**
   * Renders in an encoding this app no longer produces: what the store cannot name
   * it cannot evict or delete with the model. Deleted rather than carried, a
   * format change coming with a `RIG_VERSION` bump.
   */
  private supersededFiles(dir: string, key: string, ao?: boolean): string[] {
    const both: readonly boolean[] = ao === undefined ? [true, false] : [ao];
    return both.map((a) => join(dir, a ? `${key}.png` : `${key}.noao.png`));
  }

  private async rmSuperseded(
    dir: string,
    key: string,
    ao?: boolean,
  ): Promise<void> {
    for (const f of this.supersededFiles(dir, key, ao))
      await rm(f, { force: true });
  }

  /** `protected` only so a test can interpose a `put` between the sweep's two reads. */
  protected async readMeta(dir: string, key: string): Promise<Meta | null> {
    try {
      return JSON.parse(
        await readFile(this.metaFile(dir, key), "utf8"),
      ) as Meta;
    } catch {
      return null;
    }
  }

  private async writeMeta(dir: string, key: string, meta: Meta): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFile(this.metaFile(dir, key), JSON.stringify(meta));
    // Every write path lands here, so the index tracks the store by construction
    // rather than by an enumeration of call sites.
    this.remember(meta.path, meta);
  }

  /** A copy: the caller's object is spread and re-merged after this. */
  private remember(path: string, meta: Meta | null): void {
    this.facts.set(path, meta === null ? null : { ...meta });
  }

  /**
   * For a listing to carry (§6.2/§6.3). **No I/O**, so emission never waits, and
   * undefined is "not known here", never "not cached".
   */
  annotate(path: string, mtime: number): ThumbInfo | undefined {
    const meta = this.facts.get(path);
    if (meta === undefined) return undefined;
    return infoFor(meta, mtime);
  }

  /**
   * One render, `ao` naming which. The status is that render's alone; the camera
   * and axis are the entry's and ride every status, since a client told `miss`
   * still has to draw at the orientation the other render is drawn at.
   */
  async get(
    path: string,
    mtime: number,
    ao = true,
    pixels = true,
  ): Promise<ThumbGetResponse> {
    const { body, png } = await this.read(path, mtime, ao);
    // Dropped here rather than by skipping the read: the file is what decides
    // `hit` against `stale`, and a `stat` is not the same question — a mode-000
    // file stats fine and throws on `readFile`.
    return png === undefined || !pixels
      ? body
      : { ...body, png: png.toString("base64") };
  }

  /**
   * The image route's read (`thumbnail-image-serving` D1): bytes only for a hit
   * whose file is there, `undefined` otherwise, and the JSON route says why. The
   * same read as `get`, so the two cannot disagree, LRU bump included (D7).
   */
  async image(
    path: string,
    mtime: number,
    ao = true,
  ): Promise<{ gen: number; png?: Buffer }> {
    const { body, png } = await this.read(path, mtime, ao);
    return { gen: body.gen ?? 0, png };
  }

  /** The read both `get` and `image` are: the answer, and the raw bytes on a hit. */
  private async read(
    path: string,
    mtime: number,
    ao: boolean,
  ): Promise<{ body: Omit<ThumbGetResponse, "png">; png?: Buffer }> {
    const dir = await this.entryDir();
    const key = this.key(path);
    const meta = await this.readMeta(dir, key);
    // Both answers are facts worth keeping (§6.2), and a read is how this cache
    // learns about an entry it did not write — most of them, after a restart.
    this.remember(path, meta);
    // Nothing was ever written here, so no generation was issued: 0.
    if (meta === null) return { body: { status: "miss", gen: 0 } };
    const gen = meta.gen ?? 0;
    const labels: RenderLabels = (ao ? meta : meta.noao) ?? {};
    // Never defaulted: a posed model deliberately stores no axis, and defaulting
    // would report one it never had and lose the pose on open.
    const axis = meta.axis;
    const lighting = labels.lighting;
    const rig = labels.rig;
    const posed = labels.posed;
    const poseKey = labels.poseKey;
    const status = statusFor(labels, meta.camera, mtime);
    if (status !== "hit") {
      return {
        body: {
          status,
          camera: meta.camera,
          axis,
          lighting,
          rig,
          posed,
          poseKey,
          gen,
        },
      };
    }
    let png;
    try {
      png = await readFile(this.renderFile(dir, key, ao));
    } catch {
      return {
        body: {
          status: "stale",
          camera: meta.camera,
          axis,
          lighting,
          rig,
          posed,
          poseKey,
          gen,
        },
      };
    }
    // The LRU clock is the pixel file's mtime, bumped via `utimes` rather than by
    // rewriting the sidecar: that cannot resurrect a swept entry or be caught
    // mid-write. Per render, so reading one never defends the other (D3).
    const now = new Date();
    await utimes(this.renderFile(dir, key, ao), now, now).catch(() => {});
    return {
      body: {
        status: "hit",
        camera: meta.camera,
        axis,
        lighting,
        rig,
        posed,
        poseKey,
        gen,
      },
      png,
    };
  }

  /**
   * Write one render; the camera and axis are the entry's, whichever carried them.
   * A write that *moves* the shared orientation invalidates the render it did not
   * draw (D2) — both, when it carries no pixels — while a pixels-only write
   * touches the sibling never, save under the unowned-pose rule below.
   *
   * Bumps the generation **unconditionally**, this being the only place one is
   * issued: deciding per field whether a write mattered is what pins stale pixels
   * the day it is wrong (D1). `png: null` deletes and `ifGen` makes the write
   * conditional; each is documented at its branch.
   */
  async put(
    path: string,
    opts: {
      mtime: number;
      png?: Buffer | null;
      camera?: CameraState | null;
      axis?: OrbitAxis | null;
      lighting?: LightingMode;
      rig?: number;
      posed?: number;
      poseKey?: string;
      ao?: boolean;
      ifGen?: number;
    },
  ): Promise<number> {
    const dir = await this.entryDir();
    const key = this.key(path);
    const ao = opts.ao ?? true;
    // Read-modify-write with awaits in between, so two concurrent puts merge
    // against the same `prev` and the loser's half lands from a stale read. That
    // can revert a camera or resurrect labels a move just cleared, and only a
    // later camera write heals it. Accepted: closing it needs locking.
    const prev = await this.readMeta(dir, key);

    // Before anything is merged, allocated or written (`bulk-thumbnail-jobs` D4),
    // so a refusal costs one read and changes nothing. `ifGen: 0` asks for "only
    // if nothing has ever been written here". It narrows the window above rather
    // than closing it: a job must not overwrite a write it can see.
    if (opts.ifGen !== undefined && opts.ifGen !== (prev?.gen ?? 0)) {
      throw new StaleWriteError(prev?.gen ?? 0);
    }

    // Deletion (`bulk-thumbnail-jobs` D3), a branch of its own: every
    // `opts.png !== undefined` test below would read `null` as pixels. Both
    // renders go, both having been drawn under the orientation this write gives
    // up, and the generation moves so a browser re-keys rather than serving them.
    if (opts.png === null) {
      await rm(this.renderFile(dir, key, true), { force: true });
      await rm(this.renderFile(dir, key, false), { force: true });
      await this.rmSuperseded(dir, key);
      const gen = allocateGen(prev?.gen);
      await this.writeMeta(dir, key, {
        path,
        camera: merged(opts.camera, prev?.camera),
        axis: merged(opts.axis, prev?.axis),
        gen,
      });
      return gen;
    }

    const prevMine = renderLabels(ao ? prev : prev?.noao);
    const prevTheirs = renderLabels(ao ? prev?.noao : prev);

    let mine: RenderLabels = {
      mtime: opts.png !== undefined ? opts.mtime : prevMine.mtime,
      // These describe the pixels: new pixels must not keep old labels.
      lighting:
        opts.png !== undefined
          ? opts.lighting
          : (opts.lighting ?? prevMine.lighting),
      rig: opts.png !== undefined ? opts.rig : (opts.rig ?? prevMine.rig),
      posed:
        opts.png !== undefined ? opts.posed : (opts.posed ?? prevMine.posed),
      poseKey:
        opts.png !== undefined
          ? opts.poseKey
          : (opts.poseKey ?? prevMine.poseKey),
    };
    let theirs: RenderLabels = prevTheirs;

    // The model changed under both renders, so the sibling's pixels are of a file
    // that is gone. Strictly newer: an equal mtime is the second render of the
    // same file, and an older one makes *this* write the stale one.
    const supersedes =
      opts.png !== undefined &&
      theirs.mtime !== undefined &&
      opts.mtime > theirs.mtime;
    if (supersedes) theirs = {};

    const moved =
      cameraMoved(opts.camera, prev?.camera) ||
      axisMoved(opts.axis, prev?.axis);
    if (moved) {
      theirs = clearRecipe(theirs);
      if (opts.png === undefined) mine = clearRecipe(mine);
    }

    const camera = merged(opts.camera, prev?.camera);
    const axis = merged(opts.axis, prev?.axis);

    // An entry with no camera and no axis has no shared orientation, so each
    // render is drawn at "the applied pose, else the default" and a difference in
    // that record is the move `cameraMoved` detects for an owned entry. The
    // ping-pong it admits converges once two consecutive writes agree.
    if (
      opts.png !== undefined &&
      !supersedes &&
      !moved &&
      camera === undefined &&
      axis === undefined &&
      // The key beside the version (`pose-rerender` D2): same mapping, different
      // opinion is still a different orientation, and a missing key says nothing
      // about what was drawn, so it counts as different too.
      (mine.posed !== theirs.posed || mine.poseKey !== theirs.poseKey)
    ) {
      theirs = clearRecipe(theirs);
    }

    const occluded = ao ? mine : theirs;
    const unoccluded = ao ? theirs : mine;
    // `prev` is a floor, never the source — see `allocateGen`.
    const gen = allocateGen(prev?.gen);
    const meta: Meta = {
      path,
      ...occluded,
      camera,
      axis,
      gen,
      // Omitted rather than empty, which is what "no migration" rests on (D1).
      noao: hasLabels(unoccluded) ? unoccluded : undefined,
    };
    if (opts.png !== undefined) {
      await mkdir(dir, { recursive: true });
      await writeFile(this.renderFile(dir, key, ao), opts.png);
      // These bytes are this render, so any older encoding of it is duplicate.
      await this.rmSuperseded(dir, key, ao);
    }
    if (supersedes) {
      await rm(this.renderFile(dir, key, !ao), { force: true });
      await this.rmSuperseded(dir, key, !ao);
    }
    await this.writeMeta(dir, key, meta);
    if (
      opts.png !== undefined &&
      ++this.writesSinceMaintain >= this.maintainEvery
    ) {
      this.writesSinceMaintain = 0;
      void this.runMaintain();
    }
    return gen;
  }

  private async runMaintain(): Promise<void> {
    if (this.maintaining) return;
    this.maintaining = true;
    try {
      await this.maintain();
    } catch {
      // best-effort background sweep
    } finally {
      this.maintaining = false;
    }
  }

  /**
   * Sweep + size cap. The sweep removes whole entries, the cap only pixels, so a
   * camera survives eviction. Skipped unless the library is `ready`: an unmounted
   * volume is not a deleted library.
   */
  async maintain(): Promise<void> {
    if (this.library !== undefined) {
      if ((await this.library.state()).state !== "ready") return;
      // Belt and braces over `state()`: a `ready` read against an absent top would
      // fail every `resolve`, and one sweep then takes the whole cache.
      if ((await stat(this.library.realTop()).catch(() => null)) === null)
        return;
      if (!this.migrated) {
        this.migrated = true;
        await this.migrate();
      }
      await this.sweepLegacy();
    }
    const dir = await this.entryDir();
    let files;
    try {
      files = await readdir(dir);
    } catch {
      return;
    }
    // From the listing this pass already holds, so a clean cache costs nothing
    // and an orphan whose sidecar is gone is still reached.
    const superseded = files.filter((f) => f.endsWith(".png"));
    for (const f of superseded) await rm(join(dir, f), { force: true });

    // One row per *render* (D3): independent LRU candidates. The existence sweep
    // stays per entry — one model, one existence.
    const metas: {
      key: string;
      ao: boolean;
      meta: Meta;
      pngSize: number;
      lastRead: number;
    }[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const key = f.slice(0, -".json".length);
      const meta = await this.readMeta(dir, key);
      if (meta === null) continue;
      // A `*.json` here need not be a sidecar: the bake manifest lives under this
      // directory and can be copied up a level by hand. It parses and carries no
      // `path`, which would throw out of `sourceExists` and abort the whole sweep.
      if (typeof meta.path !== "string") {
        console.warn(
          `maintain: ${this.metaFile(dir, key)} has no path, skipping`,
        );
        continue;
      }
      if (!(await this.sourceExists(meta.path))) {
        await rm(this.metaFile(dir, key), { force: true });
        await rm(this.renderFile(dir, key, true), { force: true });
        await rm(this.renderFile(dir, key, false), { force: true });
        await this.rmSuperseded(dir, key);
        // Dropped rather than remembered as `null`: no listing can ask again (§6.2).
        this.facts.delete(meta.path);
        continue;
      }
      // Where a freshly started server learns the whole library's state, the
      // startup sweep having every sidecar in hand already.
      this.remember(meta.path, meta);
      for (const ao of [true, false]) {
        const pngStat = await stat(this.renderFile(dir, key, ao)).catch(
          () => null,
        );
        if (pngStat === null) continue; // that render is not cached: nothing to evict
        metas.push({
          key,
          ao,
          meta,
          pngSize: pngStat.size,
          lastRead: pngStat.mtimeMs,
        });
      }
    }

    let total = metas.reduce((sum, m) => sum + m.pngSize, 0);
    if (total <= this.sizeCap) return;
    metas.sort((a, b) => a.lastRead - b.lastRead);
    for (const m of metas) {
      if (total <= this.sizeCap) break;
      if (m.pngSize === 0) continue;
      // A `put` can land between the snapshot above and this eviction, so re-read
      // and re-stat: a moved `mtimeMs` or `size` means the ordering that elected
      // this victim and the bytes to subtract are both stale. Evicting from the
      // re-read is what lets a camera written meanwhile survive.
      const fresh = await this.readMeta(dir, m.key);
      if (fresh === null) continue;
      const png = await stat(this.renderFile(dir, m.key, m.ao)).catch(
        () => null,
      );
      if (png === null || png.mtimeMs !== m.lastRead || png.size !== m.pngSize)
        continue;
      // A `put` landing after that stat still loses its pixels, and its labels —
      // the sibling's included — revert to the re-read. One re-render heals it.
      await rm(this.renderFile(dir, m.key, m.ao), { force: true });
      // Only this render's `mtime`: the labels ride the stale read, saying what
      // recipe the evicted pixels were under. The generation comes through on the
      // spread, deliberately **not** bumped and never allowed to regress (D1).
      await this.writeMeta(
        dir,
        m.key,
        m.ao
          ? { ...fresh, mtime: undefined }
          : {
              ...fresh,
              noao: { ...renderLabels(fresh.noao), mtime: undefined },
            },
      );
      total -= m.pngSize;
    }
  }

  /** A path the library refuses cannot exist in this tree; the rest are stat'd. */
  private async sourceExists(path: string): Promise<boolean> {
    if (this.library === undefined) {
      const source = parseVPathSafe(path);
      return source !== null && (await stat(source).catch(() => null)) !== null;
    }
    let fsPath;
    try {
      fsPath = (await this.library.resolve(path)).fsPath;
    } catch (err) {
      if (err instanceof LibraryError || err instanceof VPathError)
        return false;
      throw err;
    }
    return (await stat(fsPath).catch(() => null)) !== null;
  }

  /**
   * The flat directory holds other libraries' entries and counts toward no cap. An
   * absent file is only a deletion when its directory is there to say so, or it is
   * an unmounted volume (D5) whose cameras this would take.
   */
  private async sweepLegacy(): Promise<void> {
    let files;
    try {
      files = await readdir(this.dir);
    } catch {
      return;
    }
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const key = f.slice(0, -".json".length);
      const meta = await this.readMeta(this.dir, key);
      if (meta === null) continue;
      // An unparseable path names no file in any library.
      const source = parseVPathSafe(meta.path);
      if (source !== null) {
        if ((await stat(source).catch(() => null)) !== null) continue;
        // Only the containing directory can say deletion from unmounted volume.
        if ((await stat(dirname(source)).catch(() => null)) === null) continue;
      }
      await rm(this.metaFile(this.dir, key), { force: true });
      await rm(this.renderFile(this.dir, key, true), { force: true });
      await rm(this.renderFile(this.dir, key, false), { force: true });
      await this.rmSuperseded(this.dir, key);
    }
  }

  /**
   * Re-key the flat directory into this library's own (D5). **Pixels, then the new
   * sidecar, then the old one**, so an interruption leaves pixels with a stale
   * sidecar and never the reverse; one whose pixels are gone is re-keyed anyway,
   * the camera being the half that cannot be regenerated.
   */
  async migrate(): Promise<{ moved: number; left: number }> {
    const library = this.library;
    if (library === undefined) return { moved: 0, left: 0 };
    const realTop = library.realTop();
    const target = join(this.dir, library.id());
    let files;
    try {
      files = await readdir(this.dir);
    } catch {
      return { moved: 0, left: 0 };
    }
    let moved = 0;
    let left = 0;
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const key = f.slice(0, -".json".length);
      const meta = await this.readMeta(this.dir, key);
      if (meta === null) continue;
      // Only the filesystem half is a path in this tree, so only it is re-rooted.
      let parsed;
      try {
        parsed = parseVPath(meta.path);
      } catch {
        left++;
        continue;
      }
      let real;
      try {
        real = await realpath(parsed.fsPath);
      } catch {
        // Gone: the legacy sweep is what removes it.
        left++;
        continue;
      }
      if (real !== realTop && !real.startsWith(realTop + sep)) {
        left++;
        continue;
      }
      const libTop = library.libPathOf(real);
      const libPath =
        parsed.entry === undefined ? libTop : joinVPath(libTop, parsed.entry);
      const newKey = this.key(libPath);
      await mkdir(target, { recursive: true });
      if ((await this.readMeta(target, newKey)) !== null) {
        // Already claimed, by an earlier run or by an alias of this path. The old
        // pair is a duplicate, and pixels no sidecar describes are unreachable.
        await rm(this.metaFile(this.dir, key), { force: true });
        await rm(this.renderFile(this.dir, key, true), { force: true });
        await rm(this.renderFile(this.dir, key, false), { force: true });
        await this.rmSuperseded(this.dir, key);
        continue;
      }
      // The second rename always misses — a flat entry cannot have an unoccluded
      // render — and is here so the migration can never be what drops one.
      await rename(
        this.renderFile(this.dir, key, true),
        this.renderFile(target, newKey, true),
      ).catch(() => {});
      await rename(
        this.renderFile(this.dir, key, false),
        this.renderFile(target, newKey, false),
      ).catch(() => {});
      // Pixels in the superseded encoding are dropped, not carried: the recipe
      // bump already made them unserveable. The sidecar's camera is what this
      // migration exists to keep.
      await this.rmSuperseded(this.dir, key);
      // Re-keying, not writing: the generation comes across unbumped, and a legacy
      // entry carrying none reads as 0, which is right for an unseen key.
      await this.writeMeta(target, newKey, { ...meta, path: libPath });
      await rm(this.metaFile(this.dir, key), { force: true });
      moved++;
    }
    return { moved, left };
  }
}

function parseVPathSafe(vpath: string): string | null {
  try {
    return parseVPath(vpath).fsPath;
  } catch {
    return null;
  }
}
