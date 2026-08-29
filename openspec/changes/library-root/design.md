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
marker is written there.

Why a marker rather than the root path: the root is what a picker chooses, and a picker
chooses freely (the future Electron dialog). Keying anything on the picked folder means
re-picking `/a/b/c/d` inside a library at `/a/b/c` shifts every relative path and orphans the
cache. Keying on the marker's folder makes the pick a *viewpoint*, not a namespace. Why a
file in the tree rather than a registry on the machine: the library moves between machines
and mount points; the machine does not travel with it. The marker is the first thing this
app writes beside the models — `docs/platform-surface.md` says so.

*Alternatives:* volume UUID + mount-relative path as the identity (no write; platform-specific,
another `platform-surface.md` row, and fails when a library is copied to another volume);
absolute root path as identity (today; fails on remount). Both rejected.

### D2: The library is `/`

Every path the app handles — wire, URL, recents, cache key, sidecar — is the library-relative
path **with a leading slash**: the library top is `/`, a kit is `/Kit`, an archive entry is
`/Kit/parts.zip!/lid.stl`. One form everywhere, including display: the path bar shows `/` at
the root. The root of the *view* (where the app opens) is just a path in that space.

Why a leading slash rather than `''`-for-root: the app already treats `''` as "no path" in
`resolveView` and `serializeView`; giving the root a real spelling keeps "at the root" and
"no path given" distinct, and a path that always starts with `/` is what `posix.normalize`
and the confinement check below want as input. `serializeView` omits `path` when it is `/` —
the root is the default view and needs no parameter — which keeps the shortest deep link the
shortest.

### D3: One resolver, every route

`library.resolve(libPath)` is the only way a request's path becomes a filesystem path:

1. refuse unless the path starts with `/`; `posix.normalize` it (this folds `..`);
2. `join(top, normalized)`;
3. `realpath` the result — for a zip virtual path, the `fsPath` half — and require the real
   path to equal the library's real top or start with it plus a separator.

Step 3 is the confinement: a `..` that survived normalisation, or a symlink inside the library
pointing outside, both resolve to a real path outside the top and are refused. The real top
is computed once at library resolution and compared by string, the same test `scopeWithin`
already performs. A refusal is a 400 naming no filesystem detail ("path outside the
library"), the shape `path must be absolute` has today.

The walk applies the same predicate: `walkFsLevel` already `realpath`s every subdirectory for
its visited set, so a symlinked subdirectory escaping the library is skipped there rather than
emitted as an entry the next request would refuse. Entries emitted by any listing carry the
library path (`'/' + relative(top, real)` at the seam where the walk names them), so the
client never sees a filesystem path.

*Alternative:* string-prefix check on the joined path without `realpath` — cheaper, and
defeated by a symlink. Rejected; one `realpath` per request is lstat per component and
measured as noise even on the spinning volume.

### D4: Configuration, and the states a library can be in

The root comes from `MODEL_BROWSER_ROOT` if set, else `root` in
`~/.config/model-browser/config.json` (`MODEL_BROWSER_CONFIG` overrides the file's location —
the `launch.json` precedent, `loadLaunchConfig`). Read once at start; the `Library` object
exposes `refresh()` so a later change can repoint without a restart.

The server always starts. What it answers depends on the library's state, reported by
`GET /api/library` and by every path route when not `ready`:

| state | meaning | routes answer |
|---|---|---|
| `ready` | marker found or written; `id`, `top`, `root` known | normally |
| `unconfigured` | no root in env or config | 503 `{ state }` |
| `missing` | root configured, not present or not a directory — the volume is not mounted | 503 `{ state, root }` |
| `unmarked` | no marker above the root and it could not be written (read-only volume); the id falls back to `sha256(real top)` and the library behaves as today: a remount is a different library | normally, with `unmarked: true` in the state |

503 with a state envelope is the shape `indexErrorReply` already gives the client for an
absent index — "the thing is not there" is a state the UI renders, not a fault. The client
shows `unconfigured` and `missing` in the path bar's error line, with the configured root
named in the second, since mounting the drive is the fix and takes seconds.

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
are: another library may claim them later, and an entry nobody claims is swept by the legacy
directory's own maintenance as before. The move preserves the PNG's mtime (the LRU clock).
mini-classify's `migrate_cache_keys.py` is the precedent for "re-key from the recorded path".

*Alternative:* copy rather than move, for rollback. Rejected — it doubles a 2 GB-capped
directory to protect a rollback path nobody has asked for, and the loss on rollback is
pixels; cameras would have to be re-keyed back, which the same migration does in reverse.

Why XDG and not `<library>/.model-browser/thumbs/`: notes item 2 weighed both. Writes on the
spinning exFAT volume are sub-millisecond without fsync (measured, `write_probe.py`), so speed
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
  inner one's cache is orphaned (regenerable; its cameras are not)] → Not policed in this
  change: finding a marker below the root is a walk. The server logs the library top it
  resolved at start, and any `library.json` a listing or walk passes with a different id is
  reported once as a warning. Refusal, or migration by prefixing keys, is a follow-up if it
  ever happens.
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
  either a complete new entry plus a stale old sidecar (swept as "PNG missing" next
  maintenance) or an untouched old entry. Never a sidecar without its pixels under the new
  key.
- [`realpath` on every request on cold removable media] → One call per request, lstat per
  path component; the walk already does this per directory. Measured as noise against a
  32 s cold walk.
- [Deep links and recents from before the change stop resolving] → Accepted and stated
  **BREAKING**. Old links are absolute paths that fail the leading-slash-plus-confinement
  check with a clear 400; there is no way to know which library they meant.
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
