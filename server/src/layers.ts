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
 * a peek when it derives a sheet, and since §6.9 the emission-time fill in
 * `app.ts`, which asks under a budget and records here like any other caller —
 * and read at emission by key lookup. A lookup hits or the field is absent from
 * that entry; nothing in *this* file waits on the semantic index, and the
 * client's existing wave stays the fill path for whatever the layer and the
 * budget together did not produce (D7's last paragraph, as revised 2026-09-03).
 *
 * **A recorded "none" is an answer.** Both layers hold negatives — a pose the
 * index was asked for and does not have, a folder derived to an empty sheet —
 * so a fact nobody can supply is asked about once per horizon rather than once
 * per listing. That is what keeps emission-time filling a one-off cost per
 * navigation instead of standing traffic.
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
 * How long a recorded pose is emitted on listings before the layer stops
 * answering with it and drops it (round-2 finding 6).
 *
 * **The convergence bound, and why the layer needs one at all.** Before this
 * change the client's per-listing wave asked the index about every model on
 * screen, and a pose the index had corrected — a re-classification, a
 * re-embedding — reached the user on the next navigation. The annotation
 * inverts that: an entry the layer can answer is *filtered out of the wave*, so
 * a pose recorded once is served on every later listing and the wave never asks
 * about that model again. Nothing else drops it. `LAYER_VERSION` moves only when
 * the derivation's meaning changes; the collection-root check catches a
 * repoint, not a rebuild in place; and the process may run for weeks. The
 * annotation would have converted "stale until the next navigation" into "stale
 * until restart", which is a worse guarantee than the one it replaced.
 *
 * So an entry ages out, the wave re-asks, and `recordPoses` re-learns — the
 * pre-change one-navigation convergence restored at a five-minute horizon.
 *
 * Five minutes, not less and not more, and both directions matter. Much shorter
 * (10 s, say) would gut the annotation's purpose: a user browsing a grid would
 * re-ask for everything on screen every few folders, which is the round trip
 * §6.4 exists to delete. Much longer and the horizon stops being a convergence
 * bound in any useful sense. Five minutes is longer than a browsing burst over
 * one kit and far shorter than a session, so the common case pays nothing and a
 * corrected pose still lands without a restart.
 */
export const POSE_ANNOTATION_TTL_MS = 5 * 60_000

/**
 * A recorded pose, against the moment this process learned it.
 *
 * `pose: null` is a **recorded negative** — this model was asked about and the
 * index held no orientation for it (§6.9). It is an answer, not an absence, and
 * the difference is what stops emission re-asking about the same unposed model
 * on every listing forever: without it the fill would convert one round trip of
 * client pop-in into a permanent `/poses` batch per listing, against an index
 * that serves one request at a time.
 *
 * A negative expires on the same `POSE_ANNOTATION_TTL_MS` clock as a positive,
 * for the same reason: the index may learn a pose it did not have — a
 * re-classification, a first embedding — and "we asked once and it said no" must
 * not mean "never ask again until restart".
 */
interface HeldPose {
  pose: IndexPose | null
  recordedAt: number
}

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
 * a `a.zip!` segment that is nobody's key. Previews **are** derived inside
 * archives since `archive-interior-sheets`, which is the day this anticipated;
 * note that it does not make this function their invalidation route, since it
 * walks upward from a change and an interior key is a descendant of the
 * archive. Their staleness is caught at emission by the archive's own mtime
 * (that change's D9).
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

/**
 * Is `dirPath` at or beneath `root`? Segment-wise, so `/kit` never covers
 * `/kit2` — `listing.ts`'s `encloses`, with the archive separator added because
 * a walked root can itself be an archive and everything inside one is addressed
 * `…zip!/…` rather than `…zip/…`.
 */
function under(root: string, dirPath: string): boolean {
  if (dirPath === root) return true
  if (root === '/') return dirPath.startsWith('/')
  return dirPath.startsWith(`${root}/`) || dirPath.startsWith(`${root}!/`)
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
  private readonly poses = new Map<string, HeldPose>()
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
  constructor(
    version: number = LAYER_VERSION,
    /**
     * The clock `POSE_ANNOTATION_TTL_MS` is measured on. A seam, not a knob, on
     * `ListingCache`'s reasoning exactly: the horizon is only observable by
     * letting five minutes pass, and a suite that slept that per cell would be
     * paying the constant rather than testing it. Production passes nothing.
     */
    private readonly now: () => number = Date.now,
  ) {
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
  recordPoses(
    collectionRoot: string | undefined,
    poses: Record<string, IndexPose>,
    /**
     * The models the index was asked about, when the caller knows them — every
     * one the answer does not name is recorded as a negative (§6.9).
     *
     * Optional because the two pose proxy routes do not have this list in hand:
     * the GET's is assembled inside `posesForDir`, which lists the directory
     * itself. They record what they learned and no more, exactly as before.
     * Emission-time filling passes it, because it is the caller whose cost
     * repeats — it runs on every listing, where a route runs when the client
     * asks.
     */
    asked: readonly string[] = [],
  ): void {
    if (!this.live) return
    this.reroot(collectionRoot)
    // Re-recording an entry the index has just answered about restamps it, so a
    // model the wave keeps asking about never ages out mid-conversation; the
    // horizon is measured from the last time the index confirmed the fact, not
    // from the first.
    const recordedAt = this.now()
    // Negatives first, positives over them: what the answer names is what the
    // index holds, and the rest of the question is what it does not.
    for (const path of asked) this.poses.set(path, { pose: null, recordedAt })
    for (const [path, pose] of Object.entries(poses)) this.poses.set(path, { pose, recordedAt })
  }

  /**
   * The entry held for a model, positive or negative, with the horizon applied
   * — the one place `POSE_ANNOTATION_TTL_MS` is enforced, so a negative can
   * never outlive a positive by being read through a different door.
   *
   * Aged entries are dropped **on the way past** rather than swept, which is
   * what keeps this a Map get with no timer behind it: the whole annotation is
   * "three Map gets and no I/O", and a sweep would be a fourth thing happening
   * on the listing path.
   */
  private held(path: string): HeldPose | undefined {
    if (!this.live) return undefined
    const held = this.poses.get(path)
    if (held === undefined) return undefined
    if (this.now() - held.recordedAt >= POSE_ANNOTATION_TTL_MS) {
      this.poses.delete(path)
      return undefined
    }
    return held
  }

  /**
   * Has this model been asked about within the horizon — whether the index
   * answered with an orientation or with nothing (§6.9)?
   *
   * The question emission-time filling asks, and the reason it is not
   * `poseFor(path) !== undefined`: that test cannot tell "no answer yet" from
   * "answered, none", and reading a negative as the first is precisely the
   * re-ask this exists to stop.
   */
  poseKnown(path: string): boolean {
    return this.held(path) !== undefined
  }

  /**
   * Is this layer the live one — built for the current `LAYER_VERSION` — or the
   * inert kind that records nothing and answers nothing?
   *
   * Read by emission-time filling, which must not *ask* the index on behalf of a
   * layer that would throw the answer away (§6.9, round-3 finding 8). Every
   * method below already declines on its own; this is the one question a caller
   * has to be able to put *before* spending a round trip.
   */
  get isLive(): boolean {
    return this.live
  }

  /**
   * What this model's pose annotation is, with the horizon applied — an
   * orientation, an explicit `null` for a recorded negative, or `undefined` for
   * "never asked, or asked longer ago than `POSE_ANNOTATION_TTL_MS`", which is
   * where the annotation's convergence bound is actually applied. A Map get: no
   * I/O, no waiting.
   *
   * The three states are the wire's three states (`DirEntry.pose`), and this is
   * the one place they are produced. A recorded negative used to read as
   * `undefined` here, which meant emission could not tell the client "asked, and
   * it has none" — so a never-embedded folder paid a pose wave on every landing
   * even though this server already knew the answer (round-3 finding 6).
   * `poseKnown` remains the fill's question and is now `poseFor(p) !== undefined`
   * exactly; it stays a method of its own because *that* is the question the fill
   * asks, and spelling it out at each call site is how the two drifted before.
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
  poseFor(path: string): IndexPose | null | undefined {
    const held = this.held(path)
    // `?? undefined` would collapse the recorded negative back into "unknown",
    // which is the defect this signature exists to remove: `held.pose` is
    // already `IndexPose | null`, and both halves of it are answers.
    return held === undefined ? undefined : held.pose
  }

  /**
   * Record the sheet a peek just derived for a directory. Copies in.
   *
   * An **empty** sheet is a recorded answer like any other (§6.9): this folder
   * was derived and holds no models the sheet can show. It is stored, served
   * and invalidated exactly as a full one is — by `noteDirChanged` when the
   * folder's contents move, by `dropPreviewsUnder` when its tree is
   * contradicted, by `reroot` when the index repoints — so nothing special has
   * to remember that empty is a fact rather than a gap.
   */
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

  /**
   * Forget one directory's sheet, so the next peek derives it again.
   *
   * The narrowest of the three drops, and the only one keyed on a single
   * directory: `noteDirChanged` walks upward from a change and
   * `dropPreviewsUnder` walks downward from a root, while this touches exactly
   * the key it is given. Its caller is emission's own staleness check for an
   * archive interior (`archive-interior-sheets` D9) — a sheet that contradicts
   * the archive it was derived from, discovered by the listing that was about
   * to serve it, with no pass and no changed-directory list in sight.
   *
   * Poses are untouched, for the reason the other two give: a rewritten archive
   * says nothing about the geometry of a model that is still in it.
   */
  forgetPreview(dirPath: string, n: number): void {
    if (!this.live) return
    this.previews.delete(previewKey(dirPath, n))
  }

  /**
   * The sheet held for a directory at that cell count, or undefined. Copies out.
   *
   * `[]` and `undefined` are different answers and every caller must keep them
   * so: `[]` is "derived, and there is nothing to show", `undefined` is "never
   * derived". Collapsing them is what would make an empty folder re-derive its
   * sheet on every listing.
   */
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

  /**
   * A whole tree was contradicted: drop every preview choice derived from
   * inside it — the root's own and every directory beneath it (round-2 finding
   * 8, and the invalidate branch of `ListingCache.run` is the only caller).
   *
   * `noteDirChanged` walks *upward* because a change deep in the tree
   * invalidates its ancestors' sheets; this walks *downward*, because what has
   * been contradicted is the subtree itself. The two are not the same question
   * and neither answers the other: an invalidate has no list of changed
   * directories to feed the first with.
   *
   * Ancestors of the root are deliberately kept. Their sheets are derived from
   * subtrees that include this one, so they are suspect — but an invalidate is
   * not evidence that anything *changed*, only that the pass could not finish,
   * and the next pass over those roots re-derives them through `noteDirChanged`
   * if it did. Dropping every ancestor here would clear the library root's sheet
   * whenever any kit anywhere failed to revalidate.
   *
   * Poses are untouched: a pose is a fact about a model's geometry, and a tree
   * that could not be re-read says nothing about the models in it.
   */
  dropPreviewsUnder(root: string): void {
    if (!this.live) return
    if (this.previews.size === 0) return
    for (const key of [...this.previews.keys()]) {
      if (under(root, keyDir(key))) this.previews.delete(key)
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
