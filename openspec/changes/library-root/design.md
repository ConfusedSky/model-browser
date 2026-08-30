## Context

The server takes an absolute filesystem path on every route and hands absolute paths back:
`listDir`/`listFlat` (`listing.ts`) refuse anything `isAbsolute` rejects, `DirEntry.path` is
the absolute path (or `abs.zip!/entry`), `complete` completes absolute prefixes, and
`ThumbCache` files each entry under `sha256(path)` with that path recorded in the sidecar.
The client stores the same strings in the URL (`urlState.ts`), in recents (`recents.ts`)
and in the path bar. The semantic side is the one place that already thinks in relative
terms: `hitsToEntries` ignores the index's absolute `path` and resolves
`collection_root + rel_path`, and `scopeWithin` compares *real* paths "because the library
lives on removable media and a remount moves the mount point without changing the tree (D4)".
The rest of the app has not caught up with that reasoning.

Two consequences. Locally, a remount orphans the whole cache — pixels are regenerable,
cameras are not — and every deep link and recent. For the web demo, an absolute-path API on
a public host is path traversal by construction; the server must be confined to one tree.
`docs/web-demo-notes.md` item 2 records how the shape below was arrived at, including two
objections that killed the first draft (relative paths alone: re-rooting at a subfolder
shifts every key; two libraries with the same layout collide, and cameras — keyed by path
alone — leak and write back across them).

Constraints: D1 (the Hono app runs on Node unchanged — `node:fs` only), the loopback guard
stays as it is (the demo's public-origin guard is a later change), `vpath.ts`'s grammar is
untouched, and nothing here bumps `RIG_VERSION` — no pixel changes.

## Goals / Non-Goals

**Goals:**

- A path names a file *within a library*, and the same string names the same file on any
  machine or mount point that holds that library.
- Nothing outside the library is reachable through the server, by any route, by `..` or by
  symlink.
- The thumbnail cache survives a remount and never confuses two libraries.
- An unconfigured or unmounted library is a state the user sees, not an empty grid.
- Existing cache entries under the library keep their cameras.

**Non-Goals:**

- The per-library override store (`overrides.json`: credits, display names, poses) — its own
  change; this one creates the folder it lives in.
- Moving camera/axis out of the thumb sidecar and into the library — a follow-up, now that
  the exFAT write measurement no longer blocks it (notes, item 2).
- Repointing the root at runtime (the Electron file dialog) — the state is designed to be
  re-evaluated, the route is not added.
- Multiple libraries open at once. One root, one library, repointable by config.
- Policing a library placed inside another (see R1).
- The public-origin guard, read-only mode, or anything demo-specific.

## Decisions

### D1: A library is a marker file; the root is a folder inside it

`<library>/.model-browser/library.json` — `{ "id": "<uuid>", "version": 1 }` — marks a
library's top. The server discovers the library by walking *up* from the configured root
until it finds a marker; the first one found is the library, and the root is simply where
the app opens inside it. No marker anywhere above → the root becomes a new library and the
marker is written there. A marker whose `id` is not a non-empty string is not a marker (the
walk continues): an empty id would name a cache directory `''`.

Why a marker rather than the root path: the root is what a picker chooses, and a picker
chooses freely (the future Electron dialog). Keying anything on the picked folder means
re-picking `/a/b/c/d` inside a library at `/a/b/c` shifts every relative path and orphans the
cache. Keying on the marker's folder makes the pick a *viewpoint*, not a namespace. Why a
file in the tree rather than a registry on the machine: the library moves between machines
and mount points; the machine does not travel with it. The marker is the first thing this
app writes beside the models — `docs/platform-surface.md` says so.

The upward walk stops at a **mount boundary** (task 1.9): it climbs only while the parent
directory's `st_dev` equals the starting directory's, so a marker on another filesystem is
never adopted. A parent that cannot be `stat`ed ends the walk for the same reason — an
ancestor this process cannot see is not one it should claim. What this buys is the `$HOME`
case: a `.model-browser/library.json` left in a home directory by an earlier root choice no
longer captures a root on a mounted volume beneath it. `findMarker` takes its `devOf` as a
defaulted parameter so a test can place a boundary without mounting anything.

*Accepted caveat:* a btrfs subvolume reports its own `st_dev`, so the bound reads a subvolume
edge as a mount. A library whose top lies *above* a subvolume boundary is therefore not found
from a root inside that subvolume: the root becomes its own library instead of joining the
one above. Degraded, not broken — a new id, a cache that does not inherit the outer one's
thumbnails, and everything else works — and the alternative (reading `/proc/mounts`, or no
bound at all) trades a rare inconvenience for the silent `$HOME` capture above. The same
reading applies to any filesystem that hands out per-subtree device numbers.

*Alternatives:* volume UUID + mount-relative path as the identity (no write; platform-specific,
another `platform-surface.md` row, and fails when a library is copied to another volume);
absolute root path as identity (today; fails on remount). Both rejected.

### D2: The library is `/`

Every path the app handles — wire, URL, recents, cache key, sidecar — is the library-relative
path **with a leading slash**: the library top is `/`, a kit is `/Kit`, an archive entry is
`/Kit/parts.zip!/lid.stl`. One form everywhere, including display: the path bar shows `/` at
the root. The root of the *view* (where the app opens) is just a path in that space.

Why a leading slash rather than `''`-for-root: the app *used to* treat `''` as "no path" in
`resolveView` and `serializeView`; giving the root a real spelling keeps "at the root" and
"no path given" distinct, and a path that always starts with `/` is what `posix.normalize`
and the confinement check below want as input. `serializeView` omits `path` when it is `/` —
the root is the default view and needs no parameter — which keeps the shortest deep link the
shortest.

The distinction that motivated the spelling is then *collapsed*, deliberately: once the boot
is `/`, "no path given" has nothing left to mean, so `''` is not a value `view.path` can
hold. `parseUrl` reads a blank `path` — `?path=`, or a bare `?path`, both of which
`URLSearchParams.get` answers with `''` rather than `null` — as the root, the same reading a
blank `q` or `similar` already gets; an empty path in a hand-edited URL names the library
top rather than a state of its own. That is what retires the `''` landing and its guards
(follow-up 5.7).

### D3: One resolver, every route

`library.resolve(libPath)` is the only way a request's path becomes a filesystem path:

1. refuse unless the path starts with `/`; split the virtual path first (`parseVPath`),
   then `posix.normalize` the `fsPath` half only — an archive entry name is opaque and
   must not be rewritten (a `..` in the fs half is folded; `a.zip!` is one segment);
2. `join(top, normalizedFsHalf)`;
3. `realpath` the result and require the real path to equal the library's real top or
   start with it plus a separator.

Step 3 is the confinement: a symlink inside the library pointing outside resolves to a real
path outside the top and is refused. A `..` never survives normalisation on a `/`-rooted
path — `posix.normalize('/a/../../etc')` is `/etc`, which joins *under* the top — so a
climbing path is contained by folding, not refused: it resolves like any other library path
and is not found unless the library holds it (adjudicated at Stage A's check-in, 2026-08-29:
the property is containment, the sibling clause wants not-found distinct from refusal, and
a separate climb-counting check would be a second rule for a case the first already
covers). The only 400s the resolver emits are a path that does not begin with `/` and a
realpath escape. The real top
is computed once at library resolution and compared by string, the same test `scopeWithin`
already performs. A refusal is a 400 naming no filesystem detail ("path outside the
library"), the shape `path must be absolute` has today.

The walk applies the same predicate: `walkFsLevel` already `realpath`s every subdirectory for
its visited set, so a symlinked subdirectory escaping the library is skipped there rather than
emitted as an entry the next request would refuse. Entries emitted by any listing carry the
*logical* library path — `posix.join(browsePath, name)` at the seam where the walk names
them, never a `realpath`'d one — so the client never sees a filesystem path and a symlink
alias inside the library keeps its own route: `directory-browsing`'s flat-listing scenarios
require an aliased directory to be addressable under the route walked, and naming by real
path would collapse it onto its target. `realpath` serves the confinement test and the
visited set only.

*Alternative:* string-prefix check on the joined path without `realpath` — cheaper, and
defeated by a symlink. Rejected — but on the security property, not on a measurement: **the
cost was never measured.** What is known is its shape, not its size. It is one `realpath`
per request (an lstat per path component), plus one per directory the walk descends — which
`walkFsLevel` already paid before this change, for its visited set — plus one per *symlinked*
entry, since per-entry confinement is gated on `dirent.isSymbolicLink()` (task 2.1). A
non-symlink entry costs nothing. The run that would settle it is a cold flat walk of the
library with and without the change: `vm.drop_caches`, then `time` on
`/api/dir?path=/&flat=true`, on the spinning volume where the cold case actually hurts.

### D4: Configuration, and the states a library can be in

The root comes from `MODEL_BROWSER_ROOT` if set, else `root` in
`config.json` in the XDG config home (`~/.config/model-browser/config.json` by default —
`configHome` honours `XDG_CONFIG_HOME`; `MODEL_BROWSER_CONFIG` overrides the file's location —
the `launch.json` precedent, `loadLaunchConfig`). Read once at start; the `Library` object
exposes `refresh()` so a later change can repoint without a restart.

The server always starts. What it answers depends on the library's state, reported by
`GET /api/library` and by every path route when not `ready`:

| state | meaning | routes answer |
|---|---|---|
| `ready` | marker found or written; `id`, `top`, `root` known | normally |
| `unconfigured` | no root in env or config | 503 `{ state }` |
| `missing` | root configured, not present or not a directory — the volume is not mounted, at start or since | 503 `{ state, root }` |
| `nested` | the root has no marker at or above it but encloses one (task 1.8): claiming it would write a marker over an existing library | 503 `{ state, root, library }` |
| `unmarked` | no marker above the root, none below it, and it could not be written (read-only volume); the id falls back to `sha256(real top)` and the library behaves as today: a remount is a different library | normally, with `unmarked: true` in the state |

503 with a state envelope is the shape `indexErrorReply` already gives the client for an
absent index — "the thing is not there" is a state the UI renders, not a fault. The client
shows each not-ready state in the path bar's error line: the configured root for `missing`,
since mounting the drive is the fix and takes seconds, and the enclosed library's location
for `nested`, since repointing at it is the fix and nothing else will do.

`ready` is cached — a library does not stop being itself — but the top is `stat`ed on every
`state()` call, so a volume unplugged *mid-session* answers `missing` instead of 404-ing
every path in a library that is no longer there (task 1.7). The cached `ready` is kept
across that: the same tree returning at the same place is the same library, `realTop()` and
`id()` keep answering meanwhile — `ThumbCache.maintain`'s own guard reads them to decide the
sweep must not run. What makes it *the same tree* is checked rather than assumed: on the one
transition that can hide a swap — the top being present again after `state()` has answered
`missing` — the marker is re-read once and a library whose id differs, or which has no marker
at all, is evaluated from scratch. Two drives that automount at the same mount point in one
session are otherwise both served under the first one's identity, out of the first one's
cache directory, and `maintain` then sweeps every path the second does not have, cameras
included. An `unmarked` library is exempt: its id is derived from the path, so the path is
the whole test. Outside that transition the marker is never re-read, so an identity cannot
change under a running server. The stat is affordable at the granularity of a request: on the removable
volume this library lives on, 1000 warm `stat`s of the top took 1.72 ms (~1.7 µs each; W1's
run, 2026-08-29, the sweep re-runnable from the comment beside the call in `createLibrary`'s
`state`), against the `realpath` per request that D3 already pays. Its one visible cost is
a fixed two stats per request in `semantic.test.ts`'s stat-count bound, which now asserts
the per-hit slope beside the constant.

### D5: Cache directory per library, key per library path, migrated once

`ThumbCache` gains a directory per library: `~/.cache/model-browser/<id>/` (under
`MODEL_BROWSER_CACHE` when set). The key is `sha256(libraryPath)`; the sidecar's `path` is the
library path; the existence sweep resolves it through `library.resolve`. Two libraries with
the same layout live in different directories and cannot collide, which is the property that
makes path-only camera keys safe again.

On the first `ready` under a library, the legacy flat directory (`~/.cache/model-browser/*.json`
beside its PNGs) is scanned once: every sidecar whose recorded absolute path — or, for a
virtual path, its `fsPath` half — lies under the library's real top is **moved** to
`<id>/<sha256(libraryPath)>` with `path` rewritten. Entries elsewhere are left where they
are for another library to claim. Nothing else would ever look at them again — `maintain`
reads one directory, and that directory is now `<base>/<id>/` — so the legacy flat
directory gets its own existence sweep at each start (every legacy sidecar records an
absolute path, so existence is testable without a library) and counts toward no cap. The
cap is therefore **per library**; a directory left by an `unmarked` library whose hashed id
changed on remount is an orphan this change does not reclaim, and says so. The move
preserves the PNG's mtime (the LRU clock).
mini-classify's `migrate_cache_keys.py` is the precedent for "re-key from the recorded path".

One consequence of that re-keying is stated rather than fixed: the migration canonicalises by
`realpath`, and listings deliberately do not (D3 — an in-library symlink alias keeps its own
route). So legacy entries recorded for `/top/sub/a.stl` and for `/top/link/a.stl`, where
`link` is a symlink to `sub`, both compute the library path `/sub/a.stl`. The first claims the
key; the second finds it claimed and is dropped, its camera with it. And the alias route
`/link/a.stl` — which listings still emit — has no cache entry under its own name, so it is a
permanent miss until something writes one. Both follow from the two rules being deliberately
different, and the alternative (keying the migration by the recorded path uncanonicalised)
would fail the remount case this change exists for. The cost is one duplicate camera per
aliased pair, once.

*Alternative:* copy rather than move, for rollback. Rejected — it doubles a 2 GB-capped
directory to protect a rollback path nobody has asked for, and the loss on rollback is
pixels; cameras would have to be re-keyed back, which the same migration does in reverse.

Why XDG and not `<library>/.model-browser/thumbs/`: notes item 2 weighed both. Writes on the
spinning exFAT volume are sub-millisecond without fsync — measured 2026-08-28, 100 writes per
case; the numbers and the conditions they were taken under are in `docs/web-demo-notes.md`
item 2, which is where they can be read rather than retyped. The probe script itself lived in
that session's scratchpad and is **not preserved**, so re-running it means writing it again
from the conditions recorded there. Speed, in any case,
is not the reason; read-only volumes, a clean library, backup and sync tools not churning on
PNGs, and exFAT's lack of a journal are. Cache-in-library as a per-library opt-in is a later
option, not a default.

### D6: The index maps through its own root

The index keeps its absolute `collection_root`; it is another process with its own view of
the volume. `scopeWithin` takes a library path, resolves it through D3, and compares real
paths exactly as it does now. `hitsToEntries` computes the collection root's *library path*
once (`'/' + relative(top, realpath(collection_root))`) and names each hit
`collectionLibPath + '/' + rel_path`; the containment test on `resolve(collection_root,
rel_path)` stays as the guard against a hostile `rel_path`. A collection root outside the
library has no library path: `IndexAvailability` reports `collectionRoot` as absent-with-reason,
`scopeWithin` returns null for every scope, and the side panel's "It covers …" line names the
situation instead of an absolute path the user cannot navigate to.

### D7: The client's only new concept is the root

`resolveView` defaults `path` to `/` instead of `getLastPath()`; recents and last-path are
re-keyed (`model-browser:recents:v2`) so absolute values from before are simply not read.
`complete(prefix)` completes library paths and returns library paths. `PathBar` shows what it
is given. `ApiClient` gains `library()` for the state and changes no request shape — `path`
is still a string; it means something else. The missing/unconfigured states use the path
bar's existing error line: one line, two tones, no new surface.

## Risks / Trade-offs

- [R1: a root chosen *above* an existing library makes a new library that encloses it; the
  inner one's cache is orphaned (regenerable; its cameras are not)] → **Detected within
  bounds, and refused where it is detected** (task 1.8). Only where the upward walk found
  nothing — a marked library never pays for this — the root is probed *downward* for
  `.model-browser/library.json` before any marker is written: breadth-first so the shallowest
  library wins, at most 4 levels below the root and at most 500 directories *read* —
  the budget bounds `readdir`s, never marker checks: every directory a paid-for `readdir`
  enumerated has its marker opened, so what is found can never depend on the order the
  filesystem listed entries in (an earlier version abandoned the queue when the budget ran
  out, and a root with 600 siblings whose marked one was listed last was claimed) —
  descending only real subdirectories (`readdir(…, { withFileTypes: true })`, `isDirectory()`, so no
  symlink is followed) and skipping dot-entries, the marker itself being opened by name.
  Found → the state is `nested`, naming the library's filesystem path, nothing is written,
  and every path route answers 503 with it; the UI says where to point the root instead.
  What is **still not detected**: a library deeper than 4 levels, or one under a directory
  the 500-`readdir` budget never reached — the probe is best-effort, and running out is "not
  found", exactly the behaviour that existed before it. Both bounds are what keep a root
  pointed at a wide slow volume from paying for a full descent at every evaluation, which
  matters because a not-ready state is re-evaluated per request. There is still deliberately
  no "a listing passed a foreign `library.json`" warning — such a warning could not fire even
  if it were written, because `listFsDir` skips every dot-entry, so `.model-browser` is never
  enumerated by a listing or a walk at all.
- [A stray marker above the root captures the tree it sits in] → Bounded at the mount (task
  1.9, D1): the walk climbs only within the filesystem the root sits on, which closes the
  `$HOME`-marker-above-a-mounted-volume case that motivated it. **What remains** is a stray
  marker on the *same* filesystem as the root — a `.model-browser/library.json` left in
  `$HOME` above a root that is itself under `$HOME`. That still captures: every path is
  re-based on the home directory and confinement widens to that tree. It is not invisible
  without the server log, though — the wrong top is what the app *shows*. The boot view is
  the library's top (D2/D7: `resolveView` opens at `/` and consults no last path), so a
  captured library opens on a listing of the home directory's folders where the kits should
  be, and every copied path and lightbox path detail expands against that top
  (`libraryTop` in `App`). `GET /api/library` states it outright: `top` is the home
  directory, and `root` — the configured root as a library path — is not `/`, though no
  surface renders that field today. `index.ts` still logs `library <id> at <top>` once at
  start for anyone reading the terminal.
- [Writing the marker is the first write beside the models; a user may object to it, and
  a read-only volume cannot take it] → Stated in `platform-surface.md`; `unmarked` degrades to
  today's behaviour rather than failing; the folder is dot-prefixed and listings already
  skip dot-entries.
- [A library copied wholesale carries its marker: two trees, one id] → The cache is correct
  for both — same id, same content — and the only race is two machines writing cameras for
  one key, harmlessly. A *forked* copy that then diverges shares thumbnails until mtimes
  differ, which is what the mtime in the key is for.
- [Migration moves files; an interrupted move leaves an entry half-migrated] → Move the PNG
  first, then write the new sidecar, then remove the old sidecar: an interruption leaves
  either a complete new entry plus a stale old sidecar, or an untouched old entry — never a
  sidecar without its pixels under the new key. The stale old sidecar is **not** swept by
  `maintain` (a missing PNG is how a camera-only entry looks, and is kept on purpose), so
  the migration itself must tolerate a legacy sidecar whose PNG is already gone: re-key the
  sidecar (cameras travel), then remove it. Idempotent by construction.
- [`maintain`'s size-cap pass races `put`: it evicts from a snapshot of every sidecar taken
  at the top of the run, and the migration and legacy sweep now sit between the two] → The
  pass re-reads the sidecar and re-stats the PNG immediately before evicting (task 3.4). The
  test the eviction applies is not "the model's `mtime` is unchanged" — the common re-render
  writes new pixels at the *same* model mtime (an orbit persist, a rig, lighting or pose
  bump: the file did not change, so `put` stores the mtime it stored before) — but "the
  snapshot's LRU facts about this PNG are still current". A sidecar that is gone is skipped;
  so is a PNG that is gone or whose `mtimeMs` or `size` differs from what the snapshot
  measured, since any write or read-bump since makes both the ordering that elected the
  victim and the byte count that would be subtracted stale. A skipped entry is counted
  against nothing. Otherwise the size is the verified one and the write-back is
  `{...fresh, mtime: undefined}` from the re-read, so a camera-only `put` in the same window
  survives too. What remains is the window between that stat and the `rm`, accepted rather
  than closed: closing it needs a lock, and losing a PNG there costs pixels the next
  sweep-triggering render regenerates.
- [`realpath` on every request on cold removable media] → One call per request, lstat per
  path component; the walk already does this per directory. **Not measured** — the 32 s cold
  walk this would have been compared against is `listing-tree-cache`'s figure for a volume
  that has not been attached since 2026-08-19, and no before/after run was made here. D3
  names the run that would settle it. Per-*entry* confinement (task 2.1) is not one call — a flat walk is
  budgeted at 20,000 entries (browse) or 200,000 (search) — so it is gated on
  `dirent.isSymbolicLink()`: `listFsDir` already has the dirent from `readdir(…,
  { withFileTypes: true })`, and a non-symlink entry can only escape through an ancestor the descent has already confined. The flag is reliable: Node resolves `DT_UNKNOWN` dirents with an `lstat` before reporting `isSymbolicLink()`, so the gate never sees an unknown type.
- [Deep links and recents from before the change stop resolving] → Accepted and stated
  **BREAKING**. An old link's path begins with `/`, so it passes the leading-slash test and
  resolves as a library path that does not exist — the ordinary 404, which is what the
  delta scenario says. One edge is accepted rather than fixed: an old `/home/x` against a
  library that holds a `home/` kit resolves to a different real file. There is no way to
  know which library an old link meant.
- [The in-flight `listing-tree-cache` keys its snapshots on the root path and inherits
  `ThumbCache`'s directory] → Hard ordering: this change lands first; that change's design
  is updated to key on `id + library path` under the per-library directory before it is
  applied. `search-cancellation` and `thumbnail-sweep-priority` pass `path` through the
  same functions; they rebase onto this.

## Migration Plan

1. Land with no root configured: the server starts, every listing answers `unconfigured`,
   the UI says to set one. Nothing on disk changes.
2. Set `MODEL_BROWSER_ROOT` (or `config.json`) to the library. First start: the marker is
   written, the legacy cache directory is scanned and matching entries are moved under
   `<id>/`. Recents reset to the root.
3. Verify: `~/.cache/model-browser/<id>/` holds the moved entries with library paths in their
   sidecars; a tile that had a saved orientation opens with it; the legacy directory holds
   only entries from outside the library.
4. Rollback: an older build reads the legacy directory only; moved entries are misses (pixels
   re-render), and cameras for moved entries are recoverable by running the migration in
   reverse (`path` in each sidecar is enough to reconstruct the absolute key given the
   library's top). Not automated.

## Open Questions

- Whether `unmarked` should also try `config.json` for a remembered id per volume before
  falling back to the hashed top. Cheap to add; not needed until a read-only library is
  actually in use.
- Whether the demo container should write its marker at corpus build time (so the id is
  stable across image rebuilds) — yes, but that belongs to the deployment change.
