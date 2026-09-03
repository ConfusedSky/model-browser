/**
 * When a cached listing is served as-is, when it is served *marked*, and when
 * the caller waits for the filesystem to be checked first (`listing-tree-cache`
 * §4.2–§4.3, §5.1; design D5).
 *
 * Node APIs only — the Hono app must run un-Bun'd (global D1).
 *
 * **The state is per (process, root), and that is the whole design.** A
 * snapshot is durable; whether *this* process has checked it against the disk
 * is not, and cannot be read off the file. So:
 *
 * - A cache-serve for a root this process has not revalidated **recently**
 *   answers **immediately** and is marked `stale`, and the incremental pass
 *   starts in the background, single-flighted per root.
 * - A request arriving while that pass is in flight **awaits it**, and is then
 *   answered by the ordinary decision below rather than unmarked on principle:
 *   a pass that exited through the volume-gone early return validated nothing,
 *   and its awaiter must not pretend otherwise. This is what makes the client's
 *   one follow-up request (§5.2) terminate instead of looping on the marker,
 *   and the worst wait is the incremental pass (one `stat` per directory,
 *   ~5.6 s measured cold on the spinning volume) rather than the ~32 s walk it
 *   replaces.
 * - After a completed pass, serves for that root are unmarked **until the stamp
 *   ages past `REVALIDATE_TTL_MS`** — validation is time-bounded, never
 *   once-per-process (review finding 1). The pass **applies** what it found —
 *   changed directories re-read, entries replaced, the snapshot saved — so the
 *   following serve *is* the corrected listing rather than a promise of one.
 * - A walk carries no marker at all: it just read the disk.
 *
 * Constructed without a store, every method is the pre-change behaviour
 * exactly: a plain walk, no snapshot, no marker. That is `createApp`'s default,
 * so a caller with no opinion — and every test written before this change —
 * gets what it got before.
 */

import type { DirListing } from '../../shared/types'
import { DerivedLayers } from './layers'
import type { Library } from './library'
import { RevalidationError, revalidateTree, walkFlat } from './listing'
import type { SnapshotStore } from './snapshot'

/**
 * How long a completed pass's verdict stands before the root is treated as
 * unchecked again — the bounded staleness cadence (review finding 1).
 *
 * Validation is a fact about the *disk*, and the disk moves under a server that
 * is not watching it: without this, a process left running for a week would
 * serve its first-hour snapshot unmarked forever, and nothing but a restart or
 * an explicit reload would ever look again. Ten seconds is the order of
 * magnitude the library's own `NESTED_RECHECK_MS` (5 s) already set for
 * "re-ask the filesystem, but not per request": the cost of being wrong is one
 * incremental pass (one `stat` per directory), and the cost of asking too often
 * is the same pass on a spinning volume, so the constant sits an order of
 * magnitude below a human's patience and an order above a request burst.
 */
export const REVALIDATE_TTL_MS = 10_000

export class ListingCache {
  /**
   * When this process last completed a pass for a root — a *timestamp*, not a
   * membership: a stamp older than `REVALIDATE_TTL_MS` is no better than never
   * having checked, and is served marked while a fresh pass runs.
   */
  private readonly validatedAt = new Map<string, number>()
  /**
   * The revalidation pass running for a root, so two never run at once. Carries
   * the pass's answer — whether anything moved — so a reload (§6.6) that joins
   * a pass already in flight reports what that pass found rather than nothing.
   */
  private readonly inFlight = new Map<string, Promise<boolean>>()

  constructor(
    private readonly store?: SnapshotStore,
    /**
     * The pose and preview-choice layers (§6.1). Held here, and not beside the
     * routes that read them, because the event that invalidates a preview
     * choice — a directory whose contents moved — is discovered by the
     * revalidation pass this class owns and by nothing else.
     *
     * Independent of `store`: a server with no tree cache still annotates from
     * what its own proxy answers and peeks have derived.
     */
    readonly layers: DerivedLayers = new DerivedLayers(),
    /**
     * The clock the TTL is measured on. A seam, not a knob: the cadence is only
     * observable by letting time pass, and a suite that slept ten seconds per
     * cell would be paying the constant rather than testing it. Production
     * passes nothing.
     */
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * A flat listing, served from the snapshot where there is one. The returned
   * listing carries `stale: true` only in the one case §5.1 defines: the
   * entries came from a snapshot this process has not yet revalidated.
   */
  async list(
    library: Library,
    libPath: string,
    query?: string,
    opts: { folderMatching?: boolean } = {},
  ): Promise<DirListing> {
    const store = this.store
    if (store === undefined) return (await walkFlat(library, libPath, query, opts)).listing

    const pending = this.inFlight.get(libPath)
    // Someone else is already asking the disk. Waiting costs the incremental
    // pass and buys a *checked* answer, which is strictly better than answering
    // stale and starting a second pass behind it.
    //
    // Awaited, then dropped through to the ordinary decision below rather than
    // served unmarked outright (review finding 6): a pass can end without
    // validating anything — the volume-gone early return, a failed invalidate —
    // and the stamp is the only thing that knows which happened. Falling
    // through is also why this is not a loop: the decision below either serves
    // (fresh stamp) or marks and kicks a new pass (no stamp), and never waits
    // again.
    if (pending !== undefined) await pending

    const walked = await walkFlat(library, libPath, query, opts, store)
    if (!walked.fromSnapshot) {
      // A walk that saw the whole tree has just checked the disk, and is what
      // wrote the snapshot; nothing is owed. A truncated one wrote nothing, so
      // there is no snapshot to be stale about either.
      if (!walked.budgetExhausted) this.stamp(libPath)
      return walked.listing
    }
    if (this.isValidated(libPath)) return walked.listing
    void this.start(library, libPath)
    walked.listing.stale = true
    return walked.listing
  }

  /**
   * Run the incremental pass for a root now, joining one already in flight, and
   * report whether the tree had moved.
   *
   * The seam startup revalidation (§6.5) and the reload endpoint (§6.6) work
   * through; here it is also what a test drives to reach the "validated" half of
   * the marker's lifecycle without racing a background task.
   *
   * `false` for a store-less cache and for a root with no snapshot: neither has
   * anything that *could* have moved, and neither is an error.
   */
  async revalidate(library: Library, root: string): Promise<boolean> {
    if (this.store === undefined) return false
    return await (this.inFlight.get(root) ?? this.start(library, root))
  }

  /**
   * Whether this process has checked `root` against the filesystem *recently
   * enough* — within `REVALIDATE_TTL_MS`. An older stamp is not a weaker yes:
   * it is a no, and the serve that reads it is marked and re-runs the pass.
   */
  isValidated(root: string): boolean {
    const at = this.validatedAt.get(root)
    return at !== undefined && this.now() - at < REVALIDATE_TTL_MS
  }

  /** Record that the disk has just been checked for `root`. */
  private stamp(root: string): void {
    this.validatedAt.set(root, this.now())
  }

  private start(library: Library, root: string): Promise<boolean> {
    // Joined, not raced: `list()`'s in-flight check and its call here are
    // separated by a whole walk's worth of awaits, so two first requests for
    // one root can both arrive — without this, the second would overwrite the
    // map and run a duplicate pass (harmless bytes-wise, atomic same-content
    // saves, but "two never run at once" would be aspiration, not fact).
    const existing = this.inFlight.get(root)
    if (existing !== undefined) return existing
    const run = this.run(library, root)
      // Never rejects: `run` handles its own failures, and this is the belt to
      // that brace — a rejection here would be unhandled, since the serving
      // path deliberately does not await it. A pass that failed reports "nothing
      // moved", which is what a reload should say about a root it could not
      // check: the corrections it would have made are not there to announce.
      .catch(() => false)
      .finally(() => {
        this.inFlight.delete(root)
      })
    this.inFlight.set(root, run)
    return run
  }

  private async run(library: Library, root: string): Promise<boolean> {
    const store = this.store
    if (store === undefined) return false
    // A library whose volume is not present never reaches revalidation: that is
    // the `missing` state, answered before any listing (`/api/dir` is behind
    // `createApp`'s library gate), and the snapshot is neither served nor
    // discarded (D6). The check is repeated here because this pass runs
    // *after* a response, so the volume can leave between the two.
    if (!(await isReady(library))) return false
    let moved: boolean
    try {
      const pass = await revalidateTree(library, root, store)
      moved = pass.changed
      // The preview layer's re-derivation (§6.1, design D7's subtlety): a
      // sheet is drawn from a directory's whole subtree while a directory's
      // freshness signal does not propagate upward, so each changed directory
      // takes its ancestors' choices down with it. An unchanged sibling branch
      // keeps what it had — which is why this is driven from the pass's own
      // list rather than by dropping the layer whenever anything moved.
      for (const dir of pass.changedDirs) this.layers.noteDirChanged(dir)
    } catch (err) {
      // Three failures, three answers (review finding 2). Ordered so the
      // cheapest-to-be-wrong-about is decided first.
      //
      // 1. The volume went away. Not a contradiction at all: the snapshot is
      //    left alone and the root left unvalidated, so the pass runs again
      //    when the volume is back. Tested before the taxonomy below because a
      //    departing volume *can* raise `RevalidationError` — a recorded
      //    directory that is suddenly gone is exactly what an unmount looks
      //    like from inside `levelFor`.
      if (!(await isReady(library))) return false
      // 2. Anything else that is not a `RevalidationError` — the store's own
      //    `save` failing on ENOSPC, a bug — is not the filesystem
      //    contradicting the cache and must not be read as one. Nothing is
      //    invalidated and nothing is stamped: the snapshot stays, serves
      //    marked, and the pass is retried at the next cadence.
      if (!(err instanceof RevalidationError)) return false
      // 3. A pass that could not be completed against a root that is *there*
      //    invalidates: the filesystem is authoritative and the cache loses
      //    (§4.3).
      try {
        await store.invalidate(root)
      } catch {
        // The invalidate itself failed, so the contradicted snapshot is still
        // on disk. Never stamp over that — a stamp would serve those very
        // entries unmarked. Unvalidated means it is re-checked at the next
        // serve and served marked until it can be.
        return false
      }
      // The snapshot is gone rather than corrected, so there is no "what moved"
      // to report — and the root is stamped below, because this process has now
      // checked it and the next serve is a walk.
      moved = false
    }
    this.stamp(root)
    return moved
  }
}

async function isReady(library: Library): Promise<boolean> {
  try {
    return (await library.state()).state === 'ready'
  } catch {
    return false
  }
}
