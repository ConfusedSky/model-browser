/**
 * The derived layers over the tree snapshot: a model's pose, a directory's
 * preview choice (`listing-tree-cache` §6.1, D7). Node APIs only (global D1).
 *
 * Process-local, so a restart is a drop point. Written by whoever already had the
 * answer and read by key lookup; a recorded "none" is an answer, which bounds the
 * asking to once per horizon rather than once per listing.
 */

import type { DirEntry, IndexPose } from "../../shared/types";

/**
 * Bump when a derivation changes, not when storage or lookup does; a layer of
 * another version is inert.
 */
export const LAYER_VERSION = 1;

/**
 * How long a recorded pose is emitted before the layer drops it. An entry the
 * layer can answer is filtered out of the client's pose wave, so without a
 * horizon a corrected pose waits for a restart.
 */
export const POSE_ANNOTATION_TTL_MS = 5 * 60_000;

/**
 * `pose: null` is a **recorded negative** — asked about, and the index had none —
 * which stops emission re-asking on every listing. It expires on the same clock,
 * the index being able to learn one later.
 */
interface HeldPose {
  pose: IndexPose | null;
  recordedAt: number;
}

/**
 * Per (directory, cell count), joined on NUL — an escape, never a literal, or the
 * next reader tidies it into a space that `/kit/Big Mech` splits on.
 */
const KEY_SEP = "\u0000";
function previewKey(dirPath: string, n: number): string {
  return `${dirPath}${KEY_SEP}${n}`;
}

/** The directory half of a `previewKey`. */
function keyDir(key: string): string {
  return key.slice(0, key.lastIndexOf(KEY_SEP));
}

/**
 * Every key that could hold a preview choice covering `dirPath`. D7's subtlety: a
 * choice is derived from a whole *subtree* while directory mtime does not
 * propagate upward. Split structurally, so an archive interior yields the
 * archive's own path rather than an `a.zip!` segment that is nobody's key.
 */
function selfAndAncestors(dirPath: string): string[] {
  const bang = dirPath.indexOf("!/");
  const fsHalf = bang === -1 ? dirPath : dirPath.slice(0, bang);
  const entryHalf = bang === -1 ? "" : dirPath.slice(bang + 2);
  const out = ["/"];
  let acc = "";
  for (const segment of fsHalf.split("/")) {
    if (segment === "") continue;
    acc = `${acc}/${segment}`;
    out.push(acc);
  }
  let inner = "";
  for (const segment of entryHalf.split("/")) {
    if (segment === "") continue;
    inner = inner === "" ? segment : `${inner}/${segment}`;
    out.push(`${acc}!/${inner}`);
  }
  return out;
}

/** Segment-wise, so `/kit` never covers `/kit2`; `!/` because a root can be an archive. */
function under(root: string, dirPath: string): boolean {
  if (dirPath === root) return true;
  if (root === "/") return dirPath.startsWith("/");
  return dirPath.startsWith(`${root}/`) || dirPath.startsWith(`${root}!/`);
}

/** One directory's recorded sheet, and what it was derived against. */
interface HeldPreview {
  entries: DirEntry[];
  stamp?: number;
}

/** A listing entry, copied — the layer never hands out an object it still holds. */
function copyEntry(e: DirEntry): DirEntry {
  const out: DirEntry = {
    name: e.name,
    path: e.path,
    kind: e.kind,
    size: e.size,
    mtime: e.mtime,
  };
  if (e.format !== undefined) out.format = e.format;
  return out;
}

export class DerivedLayers {
  private readonly poses = new Map<string, HeldPose>();
  private readonly previews = new Map<string, HeldPreview>();
  /**
   * `undefined` is "no observation yet", not "the index has no root": silence from
   * an absent or warming index must not read as a repoint.
   */
  private root: string | undefined;
  /** False when this layer was built for another `LAYER_VERSION`: inert. */
  private readonly live: boolean;

  /** Anything but `LAYER_VERSION` makes the layer inert. */
  constructor(
    version: number = LAYER_VERSION,
    /** A seam, not a knob: the horizon takes five minutes to observe. */
    private readonly now: () => number = Date.now,
  ) {
    this.live = version === LAYER_VERSION;
  }

  /**
   * Note the root a fact was derived against, dropping everything if it moved —
   * the only index-side identity the server can observe (D7).
   */
  private reroot(collectionRoot: string | undefined): void {
    if (collectionRoot === undefined) return;
    if (this.root === collectionRoot) return;
    if (this.root !== undefined) this.dropAll();
    this.root = collectionRoot;
  }

  recordPoses(
    collectionRoot: string | undefined,
    poses: Record<string, IndexPose>,
    /**
     * The models the index was asked about: every one the answer does not name is
     * recorded as a negative (§6.9). Optional — the proxy routes lack the list.
     */
    asked: readonly string[] = [],
  ): void {
    if (!this.live) return;
    this.reroot(collectionRoot);
    // Re-recording restamps, so the horizon runs from the last confirmation.
    const recordedAt = this.now();
    // Negatives first, positives over them: the answer names what the index holds.
    for (const path of asked) this.poses.set(path, { pose: null, recordedAt });
    for (const [path, pose] of Object.entries(poses))
      this.poses.set(path, { pose, recordedAt });
  }

  /**
   * The one place `POSE_ANNOTATION_TTL_MS` is enforced, so a negative cannot
   * outlive a positive. Aged entries drop on the way past rather than by a sweep.
   */
  private held(path: string): HeldPose | undefined {
    if (!this.live) return undefined;
    const held = this.poses.get(path);
    if (held === undefined) return undefined;
    if (this.now() - held.recordedAt >= POSE_ANNOTATION_TTL_MS) {
      this.poses.delete(path);
      return undefined;
    }
    return held;
  }

  /** Its own method so "answered, none" is never read as "never asked". */
  poseKnown(path: string): boolean {
    return this.held(path) !== undefined;
  }

  /**
   * The question to put *before* spending a round trip the layer would drop.
   */
  get isLive(): boolean {
    return this.live;
  }

  /**
   * An orientation, an explicit `null` for a recorded negative, or `undefined` for
   * never-asked-or-expired — the wire's three states (`DirEntry.pose`), produced
   * here alone. By reference, unlike a preview choice: no caller writes to a pose,
   * where `applyDisplayNames` renames sheet cells.
   */
  poseFor(path: string): IndexPose | null | undefined {
    const held = this.held(path);
    // `?? undefined` would collapse the recorded negative back into "unknown".
    return held === undefined ? undefined : held.pose;
  }

  /**
   * Copies in. An empty sheet is an answer like any other. `stamp` is what it was
   * derived *against* where the caller has such a fact (an archive's mtime, D9):
   * an empty sheet has no cell to disagree with the archive it came from.
   */
  recordPreview(
    collectionRoot: string | undefined,
    dirPath: string,
    n: number,
    entries: readonly DirEntry[],
    stamp?: number,
  ): void {
    if (!this.live) return;
    this.reroot(collectionRoot);
    this.previews.set(previewKey(dirPath, n), {
      entries: entries.map(copyEntry),
      stamp,
    });
  }

  /**
   * The narrowest of the three drops: emission's own staleness check for an
   * archive interior (D9). Poses are untouched — geometry has not changed.
   */
  forgetPreview(dirPath: string, n: number): void {
    if (!this.live) return;
    this.previews.delete(previewKey(dirPath, n));
  }

  /** Bookkeeping: the stamp never reaches the wire. */
  previewStamp(dirPath: string, n: number): number | undefined {
    if (!this.live) return undefined;
    return this.previews.get(previewKey(dirPath, n))?.stamp;
  }

  /**
   * Copies out. `[]` and `undefined` are different answers — "derived, nothing to
   * show" against "never derived" — and collapsing them re-derives forever.
   */
  previewFor(dirPath: string, n: number): DirEntry[] | undefined {
    if (!this.live) return undefined;
    return this.previews.get(previewKey(dirPath, n))?.entries.map(copyEntry);
  }

  /**
   * Drop this directory's preview choice **and its ancestors'**
   * (`selfAndAncestors`). Poses are untouched: geometry has not changed.
   */
  noteDirChanged(dirPath: string): void {
    if (!this.live) return;
    if (this.previews.size === 0) return;
    const covered = new Set(selfAndAncestors(dirPath));
    for (const key of [...this.previews.keys()]) {
      if (covered.has(keyDir(key))) this.previews.delete(key);
    }
  }

  /**
   * `noteDirChanged` walks upward from a change, this downward from a root, and
   * neither answers the other. Ancestors are deliberately kept: an invalidate is
   * not evidence that anything changed, only that the pass could not finish.
   */
  dropPreviewsUnder(root: string): void {
    if (!this.live) return;
    if (this.previews.size === 0) return;
    for (const key of [...this.previews.keys()]) {
      if (under(root, keyDir(key))) this.previews.delete(key);
    }
  }

  /** Drop both layers wholesale — a reload (D9), or a repointed index. */
  dropAll(): void {
    this.poses.clear();
    this.previews.clear();
    this.root = undefined;
  }

  /** What the layers hold, for tests and for a future report route. */
  size(): { poses: number; previews: number } {
    return { poses: this.poses.size, previews: this.previews.size };
  }
}
