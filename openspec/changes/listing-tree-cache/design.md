# Design — listing-tree-cache

## Context

`listFlat` (server/src/listing.ts) walks a root on every request: `readdir` per directory, one `stat` per entry (charged against the step budget), and for each archive a central-directory read via `zip.ts`. Nothing is retained between requests. `ThumbCache` (server/src/cache.ts) already owns a size-capped directory under `~/.cache/model-browser/<library-id>/` (per library since `library-root`, keyed by library path) with a `maintain()` sweep and a `MODEL_BROWSER_CACHE` override — the precedent for anything else this app persists.

The measurements in the proposal were taken with `vm.drop_caches` between runs, on a 10,614-entry library (2,318 directories, 409 zips) on spinning exfat and an 18,705-entry library on ext4 SSD.

## Goals / Non-Goals

**Goals:**
- A cold search on a spinning disk costs what a warm one costs today.
- Freshness is never silently wrong: a stale answer is labeled, and a changed tree converges without the user knowing to ask.
- Revalidation is proportional to the *shape* of the tree (directories, archives), not its size (entries).

**Non-Goals:**
- A content index (tags, geometry, text inside models). This caches the walk, not the models.
- Filesystem watching (`inotify`/`FSEvents`). Watching a 500 GB removable volume across unmounts is its own project; mtime polling is the cheaper 90%.
- Changing what a listing contains — entries, ordering, caps, truncation belong to the existing requirements.
- Sharing the cache between machines, or making it authoritative when the disk disagrees.

## Decisions

### D1: Cache the tree, not query results

A per-query cache only helps a repeated query. The measured pain is the *first* search after a cold start, which by definition has no cached result — 32s on the spinning volume. One tree snapshot serves every query against that root, including first-time ones, and its cost amortizes across searches, flat listings, and the `q` variants a user types while hunting.

*Alternative — cache each query's result set:* smaller and simpler, and genuinely useless for the case that motivated the change.

**What makes this sound: the walk gathers, the query filters.** `matchesQuery` lives only in `walkFlat` (`listing.ts` — post-extraction; this sentence used to say `listFlat`, now a one-line wrapper) and never inside `walkFsLevel` or `walkZip`, so a walk's output is a function of the root alone. That is why `q` is absent from the cache key, and why the search options (`search-options`) are absent too: both are filters applied over the snapshot exactly as they are applied over a live walk. Keying on either would store a duplicate copy of the same tree per setting and force a fresh cold walk — the ~32s case this change exists to remove — every time a user toggled an option or retyped a query.

The invariant is load-bearing and fragile: `search-matches-folder-names` collects directories during the walk, and collecting them *conditionally on the query* would silently make the snapshot query-specific. That change's D2 keeps the collection unconditional and filters afterwards for this reason, and pins it with a test. If that ever regresses, this cache serves wrong answers rather than failing to build.

**The one genuine exception is truncation.** The step budget *is* query-dependent (`listFlat`'s `budget` assignment — 200k for a search, 20k for a browse), so a browse walk can stop early where a search walk would not. That is not a key component; it means a truncated walk is not a snapshot at all. Only a walk that ran to completion may be persisted — the same rule `search-cancellation` applies to a stopped traversal, and for the same reason: a partial tree stored as a whole one is indistinguishable from the real thing and permanently wrong.

### D2: On disk, beside the thumbnail cache

Warm walks are already fast on both media (0.030–0.039 ms/entry) — the OS page cache is doing that job well. An in-process cache would duplicate it and, like it, be empty at the moment that matters. Persisting to `~/.cache/model-browser` is what makes the *first* walk after a restart cheap, and it inherits `ThumbCache`'s directory and its policy *shape* rather than inventing a second policy.

*Settled 2026-09-02 at implementation (stage-1 worker's read of `maintain()`):* literal sharing of the sweep is destructive — `maintain()` treats every `*.json` in the per-library directory as a thumbnail sidecar, so a snapshot there either aborts the whole sweep silently (`sourceExists(undefined)` throws a `TypeError` that `runMaintain` swallows) or, had it carried a `path` field, would be deleted as a dead thumbnail. The snapshot store therefore lives in `<cache>/<library-id>/snapshots/` — a plain directory name fails the sweep's own `.endsWith('.json')` test, so `maintain()` is byte-unchanged and blind to it — and carries its **own bound in the same policy shape**: one validated env knob (`MODEL_BROWSER_SNAPSHOT_CAP`, default 64 MB, malformed → default), oldest-first eviction. Not a shared byte pool: a ~2 MB snapshot in a 2 GB PNG budget would let thumbnail churn evict thirty seconds of cold-walk protection to reclaim 0.1% of the cap. One location, one policy shape, two bounds; remount-following and the `rm -rf <id-dir>` reset gesture are preserved. The delta's requirement was amended to say this in as many words.

### D3: Archive directories are cached against the archive's mtime

The measured 6.7s of zip-tail seeks is the largest single component of a warm-filesystem walk, and no OS caching removes it — the tails are read once and evicted, and directory-metadata warming never touches them. A zip's central directory is immutable while the archive's mtime is unchanged: rewriting an archive necessarily rewrites its tail. So `{mtime, size} → entries` is a sound key, and archives are the part of the tree least likely to churn in a print library.

### D4: Revalidate by directory mtime, not by re-walking

A directory's mtime changes when an entry is added, removed, or renamed within it — not when a file's contents change, and not when something changes deeper down. For an index over *names*, that is exactly the right signal. Revalidation therefore costs one `stat` per directory: 2,318 stats against 10,614 entries here, and at the measured cold rate ~5.6s instead of ~32s, with unchanged archives skipping their tail seeks entirely.

The tradeoff is honest: because mtime does not propagate upward, every directory must be stat'd, so revalidation is proportional to directory count and cannot be short-circuited at the root. That is the price of not running a watcher.

*Risk settled 2026-09-02 (task 1.1's run, `scripts/probe-dir-mtime.py` on the real volume):* directory mtime on this exfat volume under the Linux `exfat` driver is **reliable and fine-grained** — every add/remove/rename of a direct entry (file or subdir) moves the parent's mtime, content edits and deeper changes do not, granularity is **10 ms** (the on-disk resolution, honored: ~90 ops at 50 ms spacing yielded ~90 distinct stamps), and timestamps survive unmount/remount byte-identically. The feared 2-second class does not apply here. The `(entry count, total size)` readdir-fingerprint fallback is therefore **not built for this volume**; it remains recorded as the contingency for filesystems the wider target may meet (network mounts, other drivers), to be validated the same way — the probe script takes any directory.

### D5: Serve the snapshot immediately, converge afterwards

A request answered from the snapshot returns at once and is marked as such; revalidation runs and, if the tree changed, the corrected listing follows. This is the stale-while-revalidate shape, with one correction the measurements forced: revalidation must be the *incremental* D4 pass, not a full re-walk. Re-walking in the background on every request is affordable warm (0.8s) and ruinous cold on a spinning disk — it would reintroduce the exact 32s cost the change exists to remove, just off the critical path where the user cannot see it.

How the corrected listing reaches the client is deliberately left to apply: the cheapest shape consistent with D1 of the architecture (the Hono app must run on Node unchanged, so no new transport) is a second ordinary request the client issues when it sees the stale marker. The existing latest-wins guard and skeleton already handle a later response landing.

### D6: A cache that disagrees with the disk loses

Nothing is served from the snapshot that revalidation has contradicted, and a revalidation that cannot be completed against a root that is *there* — present but unreadable, permissions changed — invalidates rather than persists.

An unmounted volume is not that case, and rebasing on `library-root` (2026-08-29) is what separates the two. A snapshot is keyed by the library's identity plus the walked root's library path and lives under `<cache>/<library-id>/`, so it is not addressed by mount point at all: the same library mounted somewhere else is a **hit**, not a miss. And a volume that is gone is the library's `missing` state, which `library` requires be answered before any listing is attempted — so revalidation never runs against it, and the snapshot is neither served nor discarded. The hazard this decision exists to prevent, a snapshot outliving its volume and becoming a listing of files that are not there, is stopped by that state; invalidating on an absent volume was the pre-library way of stopping it and would now throw away a snapshot that is still correct.

### D7: Derived layers beside the snapshot, never inside it (added 2026-09-02)

The cache also holds what the walk cannot see but the server repeatedly re-asks for: a model's pose (today fetched by the client's per-listing wave through the semantic proxy), a directory's preview choice (today recomputed per `peek`), and a model's thumbnail state (today discovered by a per-tile `getThumb`). All three are derived, regenerable, per-path — and stable between index rebuilds — so recomputing them per request buys nothing. They attach to listing entries at emission by key lookup, the `applyDisplayNames` shape.

The structural rule protects D1: the tree snapshot is a function of the root alone, and that invariant is what lets one snapshot serve every query. Poses and preview choices are functions of root *plus index state*, so they are separate layers, the way the zip-directory layer is keyed against archive identity. Their validity key must be something the server can itself observe — review finding M9: `IndexAvailability` carries no build identity, the `generation` in `semantic.ts` is a probe-memo counter that moves on user retries, and `POSE_VERSION` is a client constant the server deliberately never interprets — so the layers carry the server's own layer-version constant and are dropped wholesale on a reload (D9) and when the index's reported `collectionRoot` changes. Thumbnail state is not persisted here at all — the thumbnail store is already durable; this layer is an in-memory index over it, exposing presence, staleness and the write generation **per render** (presence is per occlusion variant, since the store keys renders that way — the seam the immutable-thumbnail-serving change and the bulk jobs' "missing or stale" derivation consume).

*Persistence settled 2026-09-02 (stage-3 worker's check-in, adjudicated):* both derived
layers are **in-memory**, not persisted. The deciding reason is M9's own finding turned
around: the server has no observable index build identity (`IndexAvailability` carries
none, `semantic.ts`'s counter is a probe memo, `POSE_VERSION` is the client's), so a
persisted pose would outlive a re-classification with nothing able to notice — across
restarts, with thumbnails rendering under it. In-memory bounds that blast radius to one
process and makes a restart a free drop point. Secondary: persistence would put whole-file
rewrites on the pose wave's hot path with coalescing machinery nothing else here needs,
and the rebuild is already the background fill path by this design's own last paragraph.

One subtlety is stated in the delta because it will otherwise be missed: a preview choice depends on a directory's *subtree*, and directory mtime does not propagate upward — but D4's revalidation visits every directory anyway, so a detected change re-derives preview choices for the changed directory and each of its ancestors.

Emission never blocks on the semantic index: a layer answers from what it holds or not at all, and the client's existing wave remains the fill path for entries the pose layer does not know. That keeps the recorded reason for the wave's existence — browse must not couple to index health — while shrinking the wave to genuinely unknown entries.

*Alternative — fields inside the snapshot:* one store, but the snapshot's key would have to grow index generation, and an index rebuild would invalidate the tree it has no bearing on — the exact coupling D1 exists to refuse.

**Enumeration is one more read over the same two structures (added 2026-09-02, for
`bulk-thumbnail-jobs`; its review finding S2, settled with Masa).** A bulk job needs the
models beneath a path together with their thumbnail facts, and nothing the app has can
answer that: `/api/dir?flat=true` is a *listing* — capped at 500 models, budgeted for a
browse — and the annotation above rides listings only. So the tree cache exposes an
enumeration: every model in the snapshot beneath a path, each carrying the emission
annotation, uncapped, with the traversal's completeness stated (task 6.7). It is the
snapshot joined to the thumbnail-state index by key — exactly what emission reads, and no
third structure — which is why it lives here rather than in the jobs change. The two
shapes weighed there and declined: a client-side walk is N round trips through a capped
route; a walk-and-join route of the jobs change's own, over `walkFlat`'s collector and the
sidecars, lands without waiting for §6 but pays the cold walk this change exists to remove —
on every launch and every opening of the library tab for its counts — and is rewritten the
day §6 lands. On a root with no snapshot the enumeration walks as a listing miss walks, under
D1's completeness rule (only a complete walk is persisted), and an incomplete traversal is
answered as such rather than refused: the caller is an explicit action about to read every
one of those models anyway, and a job that knows its scope was cut can say so.

### D8: Startup revalidation, never a startup walk (added 2026-09-02)

When a library resolves ready and a snapshot exists, the incremental D4 pass starts immediately rather than waiting for the first request — changes made while the app was closed are usually discovered before anyone lists anything. The bound is D4's own: one `stat` per directory (~5.6s cold worst case here), not the ~32s walk. A root with no snapshot is *not* walked at startup: an eager cold walk would grind a spinning, sometimes-absent volume at every launch for a listing nobody asked for, and the `search-cancellation` reconciliation already established that background crawls contend for the disk head with interactive work.

### D9: Reload is revalidation with a name (added 2026-09-02)

An explicit reload endpoint (mini-classify's reload is the precedent) runs the same incremental pass on demand and reports whether anything moved. It adds no machinery — D5's stale-marker reconciliation already defines how corrected listings reach the client — it only gives the user a handle for "I changed the library elsewhere, look now" instead of waiting for the next request's revalidation.

## Risks / Trade-offs

- [The snapshot goes stale in ways mtime cannot see — a file edited in place, a same-name replacement within the mtime granularity] → names are what this indexes, and a replaced file keeps its name; the thumbnail cache already keys on `path + mtime` independently, so a stale entry produces a re-render rather than a wrong image.
- [Removable volume mounted at a different path] → rebased on `library-root` (2026-08-29): the cache keys on the library's identity plus the root's library path and lives under `<cache>/<library-id>/`, so a remount elsewhere is a hit; an unmounted volume is the library's `missing` state, answered before any listing, and neither serves nor discards the snapshot. (Before the rebase this bullet read the opposite — a remount was a miss — which `library-root` made false.)
- [Cache size on a very large library] → entries are metadata; the measured 18,705-entry library is trivial next to a 2 GB thumbnail budget. It shares that budget and eviction sweep, so growth is bounded by an existing mechanism rather than a new one.
- [exfat directory mtime unreliable] → D4's stated risk, with the readdir-fingerprint fallback; must be tested on the real volume before the design is trusted.
- [An abandoned crawl now has value, which argues against cancelling it] → real tension
  with `search-cancellation`, and this bullet used to claim a resolution "recorded in
  both" that the sibling never carried. Reconciled 2026-09-01 (the sibling's rederivation,
  its design D3): **cancellation wins** — the cache removes *repeat* cost, not
  *contention*; a crawl run to completion still holds the disk head against the walk the
  user is actually waiting for. A cancelled walk rejects with a named error
  (`WalkCancelled`), so nothing partial exists to persist by construction, and this
  change's "only a complete traversal may be persisted" rule is stated against walk
  completeness — resolved **and** `!budgetExhausted` (the `walkFlat` seam) — never the
  wire's `truncated`: a `capped` response saw the whole tree and is cacheable.
