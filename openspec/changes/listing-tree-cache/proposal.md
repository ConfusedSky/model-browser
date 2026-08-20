# Listing Tree Cache

## Why

Measured 2026-08-18 against the real library on two volumes:

| | SSD (ext4, USB NVMe) | HDD (exfat, USB spinning) |
|---|---|---|
| cold metadata walk | 0.156 ms/entry | **2.405 ms/entry** |
| warm metadata walk | 0.039 ms/entry | 0.030 ms/entry |
| complete walk, cold | 2.92s | **~32s** |
| complete walk, warm | 0.73s | 0.80s |

**Re-verified 2026-08-19, and one row could not be.** The volume mounted today is
`/dev/sda1` — ext4, `ROTA=0`, 469 GB, 19,134 entries / 5,077 dirs / 453 zips — and a warm
full-volume search walk measured 0.54–0.86 s, which matches the SSD row above (18,705
entries, 0.73 s warm) on a library that has grown slightly since. So the SSD column is this
volume.

The spinning exfat volume was **not attached** and its column could not be re-measured. It
is the column the whole design is priced against: without a ~32 s cold case, the cache is
buying ~3 s on the volume actually present.

That makes one question decisive, and it is about intent rather than hardware — *is the
spinning volume retired, or is it somewhere this library might live again?* Those give
opposite answers. Retired, this change is complexity bought for three seconds. A possible
future home, it is insurance written while the cost of writing it is low: the design's value
is precisely that it holds up on the slow disk, and a library on removable media that has
already lived on two volumes is not obviously done moving. Settle it before implementing —
task 7.2's re-measurement assumes both volumes are still measurable, which today they are
not.

Three facts follow, and together they decide the design.

**Cold is the whole problem.** Warm is media-independent — 0.030 ms/entry on the spinning disk, *faster* than the SSD's 0.039 — because warm means RAM. Everything expensive happens on the first walk after the OS cache is cold, which is exactly the first search after opening the app. A cache that lives in the server process dies with it and never touches that case.

**Zip central directories are a hidden seek cost.** After the filesystem metadata was warm, the first walk still took 7.49s against 0.32s for the same tree without archives; two runs later it was 0.80s. That ~6.7s is 409 seeks to the *tails* of zip files, where the central directory lives — untouched by directory-metadata caching, so cold even when the tree is warm.

**On a spinning disk the feature does not work at all today.** ~32s cold exceeded Bun's 10s idle default and the connection was killed mid-walk (fixed separately in `26d42cc`, which raises the ceiling without making the walk faster).

## What Changes

- **A persistent crawl snapshot on disk**, beside the existing thumbnail cache in `~/.cache/model-browser`: the walked tree — entry names, kinds, sizes, mtimes — keyed by root, survives restarts, and serves flat listings and deep searches without touching the filesystem.
- **Zip central directories cached against the archive's mtime**, so a walk re-reads an archive only when the archive itself changed. This is the single largest measured win and it is invisible to any OS-level caching.
- **Incremental revalidation by directory mtime**: one `stat` per directory rather than per entry, and only changed directories are re-read. A directory's mtime moves on add/remove/rename and not on content edits — the exact granularity a name index needs.
- **A freshness contract in the response**: a listing served from the snapshot says so, so the client can show results immediately and reconcile when revalidation finishes, rather than the UI silently presenting stale data as current.
- No change to what a listing *contains*: entries, ordering, caps, and truncation semantics are the existing requirements' business. This sits underneath them.

## Capabilities

### New Capabilities

- `listing-cache`: a persistent snapshot of the walked tree and of archive directories, its freshness rules, how it is revalidated and invalidated, and what a client is told about the age of what it received.

### Modified Capabilities

None. `directory-browsing`'s flat-listing requirements and `file-search`'s deep-search requirements describe *what* a listing contains; this change is about where those entries come from and how fresh they are, which no existing requirement speaks to.

## Impact

- `server/src/` — a new cache module beside `cache.ts` (which already owns a size-capped disk cache and is the precedent for layout, eviction, and the `MODEL_BROWSER_CACHE` env knob); `listing.ts`'s walk reads and populates it; `zip.ts`'s central-directory read becomes cache-aware.
- Response shape — a freshness marker on `/api/dir`, additive.
- `client/` — surfacing "these results are being refreshed" and reconciling the revalidated response; the existing latest-wins guard and skeleton already handle a second response landing later.
- Disk — a metadata snapshot is small next to the thumbnail cache (the measured library is 18,705 entries), but it shares that directory's budget and eviction story.
- Interacts with `search-cancellation`: once a crawl populates a shared cache, an abandoned crawl is no longer wasted work, which changes what cancellation should actually cancel. Recorded in both changes' designs.
