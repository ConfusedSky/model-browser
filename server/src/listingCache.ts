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
 * - A cache-serve for a root this process has not revalidated answers
 *   **immediately** and is marked `stale`, and the incremental pass starts in
 *   the background, single-flighted per root.
 * - A request arriving while that pass is in flight **awaits it** and is served
 *   unmarked. This is what makes the client's one follow-up request (§5.2)
 *   terminate instead of looping on the marker, and the worst wait is the
 *   incremental pass (one `stat` per directory, ~5.6 s measured cold on the
 *   spinning volume) rather than the ~32 s walk it replaces.
 * - After a completed pass, serves for that root are unmarked for the life of
 *   the process. The pass **applies** what it found — changed directories
 *   re-read, entries replaced, the snapshot saved — so the following serve *is*
 *   the corrected listing rather than a promise of one.
 * - A walk carries no marker at all: it just read the disk.
 *
 * Constructed without a store, every method is the pre-change behaviour
 * exactly: a plain walk, no snapshot, no marker. That is `createApp`'s default,
 * so a caller with no opinion — and every test written before this change —
 * gets what it got before.
 */

import type { DirListing } from '../../shared/types'
import type { Library } from './library'
import { revalidateTree, walkFlat } from './listing'
import type { SnapshotStore } from './snapshot'

export class ListingCache {
  /** Roots this process has checked against the filesystem. */
  private readonly validated = new Set<string>()
  /** The revalidation pass running for a root, so two never run at once. */
  private readonly inFlight = new Map<string, Promise<void>>()

  constructor(private readonly store?: SnapshotStore) {}

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
    if (pending !== undefined) {
      // Someone else is already asking the disk. Waiting costs the incremental
      // pass and buys a *checked* answer, which is strictly better than
      // answering stale and starting a second pass behind it.
      await pending
      return (await walkFlat(library, libPath, query, opts, store)).listing
    }

    const walked = await walkFlat(library, libPath, query, opts, store)
    if (!walked.fromSnapshot) {
      // A walk that saw the whole tree has just checked the disk, and is what
      // wrote the snapshot; nothing is owed. A truncated one wrote nothing, so
      // there is no snapshot to be stale about either.
      if (!walked.budgetExhausted) this.validated.add(libPath)
      return walked.listing
    }
    if (this.validated.has(libPath)) return walked.listing
    void this.start(library, libPath)
    walked.listing.stale = true
    return walked.listing
  }

  /**
   * Run the incremental pass for a root now, joining one already in flight.
   *
   * The seam startup revalidation (§6.5) and the reload endpoint (§6.6) work
   * through; here it is what a test drives to reach the "validated" half of the
   * marker's lifecycle without racing a background task.
   */
  async revalidate(library: Library, root: string): Promise<void> {
    if (this.store === undefined) return
    await (this.inFlight.get(root) ?? this.start(library, root))
  }

  /** Whether this process has checked `root` against the filesystem. */
  isValidated(root: string): boolean {
    return this.validated.has(root)
  }

  private start(library: Library, root: string): Promise<void> {
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
      // path deliberately does not await it.
      .catch(() => undefined)
      .finally(() => {
        this.inFlight.delete(root)
      })
    this.inFlight.set(root, run)
    return run
  }

  private async run(library: Library, root: string): Promise<void> {
    const store = this.store
    if (store === undefined) return
    // A library whose volume is not present never reaches revalidation: that is
    // the `missing` state, answered before any listing (`/api/dir` is behind
    // `createApp`'s library gate), and the snapshot is neither served nor
    // discarded (D6). The check is repeated here because this pass runs
    // *after* a response, so the volume can leave between the two.
    if (!(await isReady(library))) return
    try {
      await revalidateTree(library, root, store)
    } catch {
      // A pass that could not be completed against a root that is *there*
      // invalidates: the filesystem is authoritative and the cache loses
      // (§4.3). A pass that failed because the volume went away is the other
      // case entirely, and leaves the snapshot alone — and leaves the root
      // unvalidated, so the pass runs again when the volume is back.
      if (!(await isReady(library))) return
      await store.invalidate(root).catch(() => undefined)
    }
    this.validated.add(root)
  }
}

async function isReady(library: Library): Promise<boolean> {
  try {
    return (await library.state()).state === 'ready'
  } catch {
    return false
  }
}
