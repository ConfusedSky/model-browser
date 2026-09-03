/**
 * The derived layers that hang off the tree snapshot: a model's pose, and a
 * directory's preview choice (`listing-tree-cache` §6.1, design D7).
 *
 * Node APIs only — the Hono app must run un-Bun'd (global D1).
 *
 * **Process-local, and that is settled rather than lazy** — see design D7's
 * persistence note, which records the reasoning and is not restated here. The
 * one consequence to keep in view while reading this file: a restart is a drop
 * point like any other, so there is no file, no format version to guard, and
 * nothing for `SnapshotStore.maintain()` to recognise. Only the tree and archive
 * layers touch disk.
 *
 * **Nothing here ever asks anyone anything.** Both maps are written by whoever
 * already had the answer in hand — the pose proxy routes when the index answers,
 * a peek when it derives a sheet — and read at emission by key lookup. A lookup
 * hits or the field is absent from that entry; emission does not wait on the
 * semantic index, and the client's existing wave stays the fill path for what
 * the layer does not know (D7's last paragraph).
 */

import type { DirEntry, IndexPose } from '../../shared/types'

/**
 * The version of what these layers *mean* — bump when a derivation changes, so
 * entries derived under the old meaning are not served under the new one.
 *
 * Bump semantics: a change to **what is derived** moves this (the preview
 * choice's ranking rule, the set of paths a pose is recorded against). A change
 * to how a layer is stored or looked up does not — nothing about the entries
 * has changed meaning. It is the layers' analogue of `SNAPSHOT_VERSION`, not of
 * a cache-busting nonce.
 *
 * Because the layers are process-local, a bump takes effect at the next start by
 * construction: there is nothing on disk to invalidate. What the constant buys
 * *today* is `DerivedLayers`' inert mode — a layer built for another version
 * serves nothing rather than serving entries whose meaning has moved — which is
 * the delta's "a layer entry SHALL NOT be served once its recorded identity has
 * moved", made checkable rather than asserted.
 */
export const LAYER_VERSION = 1

/**
 * Preview choices are per (directory, cell count): a sheet of 4 is not a sheet
 * of 8, and a folder asked about at both must not answer one from the other.
 *
 * Joined on NUL — written as an escape, never as a literal, because it is
 * invisible in a source file and the next reader would "tidy" it into a space.
 * A space would be wrong: `/kit/Big Mech` contains one and `keyDir` below would
 * split the key in the wrong place, while a path can never contain NUL.
 */
const KEY_SEP = '\u0000'
function previewKey(dirPath: string, n: number): string {
  return `${dirPath}${KEY_SEP}${n}`
}

/** The directory half of a `previewKey`. */
function keyDir(key: string): string {
  return key.slice(0, key.lastIndexOf(KEY_SEP))
}

/**
 * Every key that could hold a preview choice covering `dirPath` — itself and
 * each of its ancestors, root included.
 *
 * D7's stated subtlety, and the reason this list exists at all: a preview choice
 * is derived from a directory's whole *subtree*, while the freshness signal
 * revalidation reads (directory mtime) does not propagate upward. So a change
 * three levels down moves one directory's mtime and invalidates four
 * directories' sheets.
 *
 * Split structurally rather than on `/` alone, so an archive's interior
 * (`/kit/a.zip!/parts`) yields the archive's own path on the way up rather than
 * a `a.zip!` segment that is nobody's key. A preview is never derived inside an
 * archive today — `peek` refuses them outright — but a list that quietly assumed
 * so would be wrong the day one is.
 */
function selfAndAncestors(dirPath: string): string[] {
  const bang = dirPath.indexOf('!/')
  const fsHalf = bang === -1 ? dirPath : dirPath.slice(0, bang)
  const entryHalf = bang === -1 ? '' : dirPath.slice(bang + 2)
  const out = ['/']
  let acc = ''
  for (const segment of fsHalf.split('/')) {
    if (segment === '') continue
    acc = `${acc}/${segment}`
    out.push(acc)
  }
  let inner = ''
  for (const segment of entryHalf.split('/')) {
    if (segment === '') continue
    inner = inner === '' ? segment : `${inner}/${segment}`
    out.push(`${acc}!/${inner}`)
  }
  return out
}

/** A listing entry, copied — the layer never hands out an object it still holds. */
function copyEntry(e: DirEntry): DirEntry {
  const out: DirEntry = { name: e.name, path: e.path, kind: e.kind, size: e.size, mtime: e.mtime }
  if (e.format !== undefined) out.format = e.format
  return out
}

/**
 * The pose and preview-choice layers for one server.
 *
 * Held by `ListingCache` rather than constructed at each use site, because the
 * one event that invalidates preview choices — a directory whose contents moved
 * — is discovered by the revalidation pass that class owns.
 */
export class DerivedLayers {
  private readonly poses = new Map<string, IndexPose>()
  private readonly previews = new Map<string, DirEntry[]>()
  /**
   * The index's collection root these entries were derived against, once
   * anything has been recorded under a known one.
   *
   * `undefined` means "no observation yet". It is deliberately **not** the same
   * as observing that the index has no root: an index that is absent, warming or
   * wedged reports nothing, and treating that silence as a repoint would let a
   * blip empty a layer that is still perfectly valid.
   */
  private root: string | undefined
  /** False when this layer was built for another `LAYER_VERSION`: inert. */
  private readonly live: boolean

  /**
   * `version` is what this layer's entries were derived under. Production takes
   * the default; passing an older number is how a caller — a test, or a future
   * reader of entries derived elsewhere — says "these are of another meaning",
   * and the layer then records nothing and answers nothing.
   */
  constructor(version: number = LAYER_VERSION) {
    this.live = version === LAYER_VERSION
  }

  /**
   * Note the collection root an about-to-be-recorded fact was derived against,
   * dropping everything if it has moved.
   *
   * The whole of the layers' index-side invalidation, and the only identity the
   * server can *itself* observe: `IndexAvailability` carries no build id, the
   * `generation` in `semantic.ts` is a probe memo that moves on user retries,
   * and `POSE_VERSION` belongs to the client (design D7, review M9).
   */
  private reroot(collectionRoot: string | undefined): void {
    if (collectionRoot === undefined) return
    if (this.root === collectionRoot) return
    if (this.root !== undefined) this.dropAll()
    this.root = collectionRoot
  }

  /**
   * Record poses the index has just answered with, keyed by library path.
   *
   * Called where the answers already flow — the pose proxy routes — never by
   * asking the index anything on this layer's own account.
   */
  recordPoses(collectionRoot: string | undefined, poses: Record<string, IndexPose>): void {
    if (!this.live) return
    this.reroot(collectionRoot)
    for (const [path, pose] of Object.entries(poses)) this.poses.set(path, pose)
  }

  /**
   * The pose held for a model, or undefined. A Map get: no I/O, no waiting.
   *
   * Handed out **by reference**, unlike a preview choice, and that is a
   * deliberate difference rather than an oversight. A pose is a small record
   * this server only ever reads and serialises; the object came from one
   * request's parsed JSON and nothing else retains it. Copying one per model
   * per listing would be real work on a five-hundred-tile grid to defend
   * against a writer that does not exist. A preview choice is an *array* that
   * `applyDisplayNames` is about to rename in place, which is a writer that
   * does exist — so that one is copied on the way in and on the way out.
   */
  poseFor(path: string): IndexPose | undefined {
    return this.live ? this.poses.get(path) : undefined
  }

  /** Record the sheet a peek just derived for a directory. Copies in. */
  recordPreview(
    collectionRoot: string | undefined,
    dirPath: string,
    n: number,
    entries: readonly DirEntry[],
  ): void {
    if (!this.live) return
    this.reroot(collectionRoot)
    this.previews.set(previewKey(dirPath, n), entries.map(copyEntry))
  }

  /** The sheet held for a directory at that cell count, or undefined. Copies out. */
  previewFor(dirPath: string, n: number): DirEntry[] | undefined {
    if (!this.live) return undefined
    return this.previews.get(previewKey(dirPath, n))?.map(copyEntry)
  }

  /**
   * A directory's contents moved: drop its preview choice **and its ancestors'**,
   * so the next peek re-derives them (D7's subtlety, spelled in
   * `selfAndAncestors`). An unchanged sibling branch keeps what it had.
   *
   * Poses are untouched: a pose is a fact about a model's geometry, and a folder
   * gaining or losing a file says nothing about the models that remain.
   */
  noteDirChanged(dirPath: string): void {
    if (!this.live) return
    if (this.previews.size === 0) return
    const covered = new Set(selfAndAncestors(dirPath))
    for (const key of [...this.previews.keys()]) {
      if (covered.has(keyDir(key))) this.previews.delete(key)
    }
  }

  /** Drop both layers wholesale — a reload (D9), or a repointed index. */
  dropAll(): void {
    this.poses.clear()
    this.previews.clear()
    this.root = undefined
  }

  /** What the layers hold, for tests and for a future report route. */
  size(): { poses: number; previews: number } {
    return { poses: this.poses.size, previews: this.previews.size }
  }
}
