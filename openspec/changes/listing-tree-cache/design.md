# Design — listing-tree-cache

## Context

`listFlat` (server/src/listing.ts) walks a root on every request: `readdir` per directory, one `stat` per entry (charged against the step budget), and for each archive a central-directory read via `zip.ts`. Nothing is retained between requests. `ThumbCache` (server/src/cache.ts) already owns a size-capped directory under `~/.cache/model-browser` with a `maintain()` sweep and a `MODEL_BROWSER_CACHE` override — the precedent for anything else this app persists.

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

**What makes this sound: the walk gathers, the query filters.** `matchesQuery` lives only in `listFlat` (`listing.ts:338-339`) and never inside `walkFsLevel` or `walkZip`, so a walk's output is a function of the root alone. That is why `q` is absent from the cache key, and why the search options (`search-options`) are absent too: both are filters applied over the snapshot exactly as they are applied over a live walk. Keying on either would store a duplicate copy of the same tree per setting and force a fresh cold walk — the ~32s case this change exists to remove — every time a user toggled an option or retyped a query.

The invariant is load-bearing and fragile: `search-matches-folder-names` collects directories during the walk, and collecting them *conditionally on the query* would silently make the snapshot query-specific. That change's D2 keeps the collection unconditional and filters afterwards for this reason, and pins it with a test. If that ever regresses, this cache serves wrong answers rather than failing to build.

**The one genuine exception is truncation.** The step budget *is* query-dependent (`listing.ts:301` — 200k for a search, 20k for a browse), so a browse walk can stop early where a search walk would not. That is not a key component; it means a truncated walk is not a snapshot at all. Only a walk that ran to completion may be persisted — the same rule `search-cancellation` applies to a stopped traversal, and for the same reason: a partial tree stored as a whole one is indistinguishable from the real thing and permanently wrong.

### D2: On disk, beside the thumbnail cache

Warm walks are already fast on both media (0.030–0.039 ms/entry) — the OS page cache is doing that job well. An in-process cache would duplicate it and, like it, be empty at the moment that matters. Persisting to `~/.cache/model-browser` is what makes the *first* walk after a restart cheap, and it inherits `ThumbCache`'s directory, its size accounting, and its eviction sweep rather than inventing a second policy.

### D3: Archive directories are cached against the archive's mtime

The measured 6.7s of zip-tail seeks is the largest single component of a warm-filesystem walk, and no OS caching removes it — the tails are read once and evicted, and directory-metadata warming never touches them. A zip's central directory is immutable while the archive's mtime is unchanged: rewriting an archive necessarily rewrites its tail. So `{mtime, size} → entries` is a sound key, and archives are the part of the tree least likely to churn in a print library.

### D4: Revalidate by directory mtime, not by re-walking

A directory's mtime changes when an entry is added, removed, or renamed within it — not when a file's contents change, and not when something changes deeper down. For an index over *names*, that is exactly the right signal. Revalidation therefore costs one `stat` per directory: 2,318 stats against 10,614 entries here, and at the measured cold rate ~5.6s instead of ~32s, with unchanged archives skipping their tail seeks entirely.

The tradeoff is honest: because mtime does not propagate upward, every directory must be stat'd, so revalidation is proportional to directory count and cannot be short-circuited at the root. That is the price of not running a watcher.

*Risk to settle at apply:* this library is on **exfat**, whose timestamp semantics are coarser and less dependable than ext4's (2-second granularity, and behavior varies by driver). D4 must be validated on exfat specifically before it is trusted; if directory mtime proves unreliable there, the fallback is to treat a directory's `(entry count, total size)` as a weak fingerprint, which costs the readdir but still skips the per-entry stats and the zip tails.

### D5: Serve the snapshot immediately, converge afterwards

A request answered from the snapshot returns at once and is marked as such; revalidation runs and, if the tree changed, the corrected listing follows. This is the stale-while-revalidate shape, with one correction the measurements forced: revalidation must be the *incremental* D4 pass, not a full re-walk. Re-walking in the background on every request is affordable warm (0.8s) and ruinous cold on a spinning disk — it would reintroduce the exact 32s cost the change exists to remove, just off the critical path where the user cannot see it.

How the corrected listing reaches the client is deliberately left to apply: the cheapest shape consistent with D1 of the architecture (the Hono app must run on Node unchanged, so no new transport) is a second ordinary request the client issues when it sees the stale marker. The existing latest-wins guard and skeleton already handle a later response landing.

### D6: A cache that disagrees with the disk loses

Nothing is served from the snapshot that revalidation has contradicted, and a revalidation failure (volume unmounted, permissions changed) invalidates rather than persists. The library lives on removable media; a snapshot outliving its volume must not become a listing of files that are not there.

## Risks / Trade-offs

- [The snapshot goes stale in ways mtime cannot see — a file edited in place, a same-name replacement within the mtime granularity] → names are what this indexes, and a replaced file keeps its name; the thumbnail cache already keys on `path + mtime` independently, so a stale entry produces a re-render rather than a wrong image.
- [Removable volume mounted at a different path] → the cache keys on the root path, so a remount elsewhere is a cache miss, not a wrong answer. Wasteful, correct.
- [Cache size on a very large library] → entries are metadata; the measured 18,705-entry library is trivial next to a 2 GB thumbnail budget. It shares that budget and eviction sweep, so growth is bounded by an existing mechanism rather than a new one.
- [exfat directory mtime unreliable] → D4's stated risk, with the readdir-fingerprint fallback; must be tested on the real volume before the design is trusted.
- [An abandoned crawl now has value, which argues against cancelling it] → real tension with `search-cancellation`; the resolution recorded in both is to cancel the *response*, not the crawl — the user stops waiting, the work still lands in the cache.
