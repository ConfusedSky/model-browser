/**
 * When a cached listing is served as-is, *marked*, or after the disk is checked
 * (`listing-tree-cache` §4.2–§4.3, §5.1, D5). **The state is per (process,
 * root)**: a snapshot is durable, whether this process has checked it is not.
 * With no store every method is a plain walk, which is `createApp`'s default.
 */

import type { DirEntry, DirListing } from "../../shared/types";
import { DerivedLayers } from "./layers";
import type { Library } from "./library";
import {
  ListingError,
  RevalidationError,
  enumerateModels,
  revalidateTree,
  walkFlat,
} from "./listing";
import type { SnapshotStore } from "./snapshot";

/**
 * How long a pass's verdict stands. Without a TTL a long-running process serves
 * its first snapshot unmarked forever; the disk moves under it either way.
 */
export const REVALIDATE_TTL_MS = 10_000;

export class ListingCache {
  /** A *timestamp*, not a membership: an aged stamp is no better than none. */
  private readonly validatedAt = new Map<string, number>();
  /** One pass per root, carrying its verdict so a joining reload can report it. */
  private readonly inFlight = new Map<string, Promise<boolean>>();

  constructor(
    private readonly store?: SnapshotStore,
    /**
     * The pose and preview-choice layers (§6.1), held here because only this
     * class's pass discovers what invalidates a preview. Independent of `store`.
     */
    readonly layers: DerivedLayers = new DerivedLayers(),
    /** A test seam, not a knob: the cadence is otherwise only observable by waiting. */
    private readonly now: () => number = Date.now,
  ) {}

  /** `stale: true` in §5.1's one case: an unrevalidated snapshot answered it. */
  async list(
    library: Library,
    libPath: string,
    query?: string,
    opts: { folderMatching?: boolean } = {},
  ): Promise<DirListing> {
    const store = this.store;
    if (store === undefined)
      return (await walkFlat(library, libPath, query, opts)).listing;

    const pending = this.inFlight.get(libPath);
    // Someone else is already asking the disk, so wait and fall through to the
    // ordinary decision: a pass can end without validating anything, and only the
    // stamp knows. Falling through is also why this cannot loop.
    if (pending !== undefined) await pending;

    const walked = await walkFlat(library, libPath, query, opts, store);
    if (!walked.fromSnapshot) {
      // A complete walk just checked the disk and wrote the snapshot; a truncated
      // one wrote nothing, so there is no snapshot to be stale about.
      if (!walked.budgetExhausted) this.stamp(libPath);
      return walked.listing;
    }
    if (this.isValidated(libPath)) return walked.listing;
    void this.start(library, libPath);
    walked.listing.stale = true;
    return walked.listing;
  }

  /**
   * Every model beneath a library path (§6.7). Unlike `list` this one **waits**:
   * a bulk job derives its work from the answer, there is no marker on the wire
   * to warn it, and a stale scope renders models that are gone.
   */
  async enumerate(
    library: Library,
    libPath: string,
  ): Promise<{ models: DirEntry[]; complete: boolean; fromSnapshot: boolean }> {
    return await enumerateModels(library, libPath, this.store, async (root) => {
      if (this.isValidated(root)) return;
      await this.revalidate(library, root);
    });
  }

  /**
   * Run the pass now, joining one in flight, and report whether the tree moved.
   * `false` for a store-less cache or a root with no snapshot: neither is an
   * error, and neither has anything that *could* have moved.
   */
  async revalidate(library: Library, root: string): Promise<boolean> {
    if (this.store === undefined) return false;
    return await (this.inFlight.get(root) ?? this.start(library, root));
  }

  /**
   * Run a pass that **began after this call did** (§6.6). A reload means "look
   * now", and a pass started before the user's edit can honestly report that
   * nothing moved — so the one in flight is awaited, then a fresh one run.
   */
  async reload(library: Library, root: string): Promise<boolean> {
    if (this.store === undefined) return false;
    // Awaiting the chained promise, not the bare pass: `start`'s `finally` has
    // already removed it from the map by the time this resolves, so the call
    // below cannot join the pass it just waited for.
    const pending = this.inFlight.get(root);
    if (pending !== undefined) await pending;
    return await this.start(library, root);
  }

  /** An aged stamp is a no, not a weaker yes: that serve is marked and re-checked. */
  isValidated(root: string): boolean {
    const at = this.validatedAt.get(root);
    return at !== undefined && this.now() - at < REVALIDATE_TTL_MS;
  }

  private stamp(root: string): void {
    this.validatedAt.set(root, this.now());
  }

  private start(library: Library, root: string): Promise<boolean> {
    // Joined, not raced: `list()`'s check and its call here are a whole walk of
    // awaits apart, so two first requests for one root can both arrive.
    const existing = this.inFlight.get(root);
    if (existing !== undefined) return existing;
    const run = this.run(library, root)
      // Never rejects: the serving path deliberately does not await this, and a
      // failed pass has no corrections to announce.
      .catch(() => false)
      .finally(() => {
        this.inFlight.delete(root);
      });
    this.inFlight.set(root, run);
    return run;
  }

  private async run(library: Library, root: string): Promise<boolean> {
    const store = this.store;
    if (store === undefined) return false;
    // Re-checked here, not only at the gate: this pass runs *after* a response,
    // so the volume can leave in between, and an absent one discards nothing (D6).
    if (!(await isReady(library))) return false;
    let moved: boolean;
    try {
      const pass = await revalidateTree(library, root, store);
      moved = pass.changed;
      // A sheet is drawn from a whole subtree while freshness does not propagate
      // upward, so a changed directory takes its ancestors' choices with it
      // (§6.1, D7). Driven from the pass's list, so sibling branches keep theirs.
      for (const dir of pass.changedDirs) this.layers.noteDirChanged(dir);
    } catch (err) {
      // Three failures, three answers.
      //
      // 1. The volume went away — no contradiction, and tested first because an
      //    unmount raises `RevalidationError` from inside `levelFor` too.
      if (!(await isReady(library))) return false;
      // 2. Any other error is this server failing, not the filesystem
      //    contradicting the cache: keep the snapshot, stamp nothing, retry.
      //    `ListingError` is grouped with the contradiction because on this path
      //    it means the walked root itself is gone while the volume is present,
      //    which `levelFor` cannot see and which would serve a ghost tree forever.
      if (!(err instanceof RevalidationError) && !(err instanceof ListingError))
        return false;
      // 3. A pass that cannot complete against a root that is *there* invalidates:
      //    the filesystem is authoritative (§4.3).
      try {
        await store.invalidate(root);
      } catch {
        // The contradicted snapshot is still on disk; a stamp would serve it
        // unmarked.
        return false;
      }
      // No list of changed directories here, so the whole subtree's previews go:
      // a tile would otherwise keep drawing a sheet just declared contradicted.
      // Poses survive — a pose is geometry, not a fact about the tree.
      this.layers.dropPreviewsUnder(root);
      // Nothing was corrected, so nothing moved; the stamp below still stands,
      // since this process has now checked and the next serve is a walk.
      moved = false;
    }
    this.stamp(root);
    return moved;
  }
}

async function isReady(library: Library): Promise<boolean> {
  try {
    return (await library.state()).state === "ready";
  } catch {
    return false;
  }
}
