## Context

See proposal.md — Why. The mechanism, by symbol:

- `revalidateTree` (server/src/listing.ts) runs `gatherFlat` with `levelIndex(snapshot)`
  as the walk's `reuse` map. For each directory `levelFor` stats the directory and, when
  `held.mtime === s.mtimeMs`, probes `access` (the chmod finding) and returns
  `reusedLevel(held, fsDir)`: fresh `FsEntry` objects carrying the `mtime` and `size` the
  original walk recorded. Nothing on that path stats a file.
- A file rewritten in place moves its own mtime and size and nothing else; its parent's
  mtime moves only on create/delete/rename of a direct child. So the reuse branch
  returns the old `mtime`/`size`, `sameEntries` finds nothing moved, and the pass
  `save`s the same snapshot back. `ListingCache.reload` runs the same pass
  (`revalidateTree` again), which is why `POST /api/reload` answered
  `{changed:false}` against a rewritten model.
- What carries the stale stamp onward: `annotate` (server/src/app.ts) calls
  `cache.annotate(entry.path, entry.mtime)`, and `infoFor` derives the render's
  `state` from the sidecar's stored mtime against *that* mtime — so a stale entry reads
  `hit` for the old render. The client's `useThumbnails` builds the key from the entry
  (`api.thumbImageUrl(entry.path, entry.mtime, …)` / `api.getThumb(entry.path,
  entry.mtime, …)`), and `thumbKeyOf` takes `mtime` from the query string and hands it to
  `cache.get` without a stat. The preview layer stores sheet cells through `copyEntry`,
  mtime included (`recordPreview`), and serves them through `previewFor` into
  `annotate(preview)`, so a folder tile's cells carry the mtime their peek saw.
- The uncached folder view (`listDir` → `listFsDir`) and a peek (`listFsDir` directly,
  never `levelFor`) stat every entry per request and are correct.
- Archives already heal: `walkZip` stats the archive on the revalidation path too and
  `listZipEntries` re-reads it when `{mtime, size}` moved, so interior entries carry the
  fresh `zipStat.mtimeMs`. The archive's **own tile** does not: `walkFsLevel` pushes the
  reused entry (`{ ...e, name }`) before `walkZip` runs, with the recorded mtime.
- `SnapshotStore.save` is called unconditionally at the end of `revalidateTree`
  (`writeAtomic`, whole file); `SNAPSHOT_VERSION` is 1 and `SnapshotEntry` already holds
  `mtime` and `size`, so no format change is involved.
- Configuration: `loadConfig` (server/src/config.ts) parses the file strictly once
  (`TOP_LEVEL_KEYS`, `FEATURE_KEYS` from `DEFAULT_FEATURES`), then `withRootFromEnv`
  overrides `root` alone. `index.ts` builds `SnapshotStore`, `ListingCache(snapshots)`,
  and `features = { ...DEFAULT_FEATURES, ...config.features }`, and `createApp` already
  treats `snapshots === undefined` as "walk every request, no marker" (its own header
  and the reload route's `roots = []`).

Constraints: `listing-cache`'s *Revalidation is proportional to tree shape* forbids a
full re-walk as the routine check; the Hono app must stay Node-clean (Bun only in
`index.ts`); the config parse is strict and once-only; the library lives on removable
media, where cold random metadata costs ~15x warm (memory note, verified 2026-08-19).

## Goals / Non-Goals

**Goals:**

- A model overwritten in place is served with its current `mtime`/`size` from the
  snapshot within one revalidation interval, and by the next listing after a reload.
- The corrected entry reaches the snapshot on disk, the preview layer, the thumbnail
  annotation and the client's key, with no wire change.
- The pass remains incremental: no `readdir` of a directory whose entries all agree, no
  archive opened for an unchanged identity.
- One switch turns the tree cache off for testing; every feature field has an
  environment override; both parsed as strictly as the file.

**Non-Goals:**

- Detecting an overwrite that preserves mtime and size. Nothing in this app can — the
  folder view and the thumbnail key are blind to it by the same token (D4).
- A filesystem watcher, a content hash, or a full re-walk on any cadence.
- Re-embedding an overwritten model in the semantic index, or refreshing a held pose
  (`pose-layer-removal` deletes the pose layer; see D3).
- A switch for the thumbnail cache or the derived layers (D5).
- Changing `deploy/demo/config.json`: the demo runs the default.

## Decisions

### D1: The reuse branch confirms its entries, and a disagreement demotes the directory to a re-read

When `levelFor` finds `held.mtime === s.mtimeMs`, it now stats each recorded model
child (`kind === 'model'`, at `join(fsDir, basename(e.path))`, with `stat` — following
symlinks as `listFsDir` does) and compares `mtimeMs` and `size` with the record. If
every entry agrees, the level is `reusedLevel(held, fsDir)` as today. If any entry
disagrees — a moved mtime, a moved size, or a `stat` that fails — the branch falls
through to `listFsDir`, exactly the path a moved *directory* mtime takes, and records
the directory's library path in a new `FlatWalk.demoted` set. `revalidateTree` unions
that set into `changedDirs`.

The failing `stat` has two field cases, and the loop treats them as one. The first is
the granule case: an entry deleted within the parent's mtime resolution. The second is
the ordinary one — a **symlinked model whose target moved or vanished**. `listFsDir`
follows links (`stat`, not `lstat`, after the `realpath` confinement check), so the
walk recorded the target's mtime and size under the link's name; the confirm loop
follows the same link, and a target that is gone rejects the `stat` while a target
that was replaced answers a moved stamp. Nothing done to the target touches the
directory holding the link, so its mtime is exactly as unmoved as in the overwrite
case, and only the per-entry check can see it.

Directory children are skipped in the loop: their own `levelFor` visit stats them, and
`walkFsLevel`'s own-entry refresh (`fresh !== e.mtime`) already writes a moved directory
mtime back into the parent's level. **Archive children are skipped too, and confirmed
by the stat `walkZip` already makes** (review, 2026-09-14 — pinned: no third stat per
archive). `walkZip` stats the archive (`zipStat`) on the revalidation path before the
archive layer answers, so the pass already holds the archive's current mtime; what it
did not do was write it to the archive's *own tile* — `walkFsLevel` pushes the reused
entry (`{ ...e, name }`) before `walkZip` runs, so the tile keeps the recorded stamp
while the interior entries carry `zipStat.mtimeMs`. The fix is the pattern
`walkFsLevel` already uses for a directory's own entry from `walk.dirMtimes`: `walkZip`
records `zipStat.mtimeMs` against the archive's library path (a map on `FlatWalk`
beside `dirMtimes`), and `walkFsLevel` writes it back into the parent-level entry and
the pushed container entry after the call, the way the `fresh !== e.mtime` block does
for a directory. When that mtime differs from the recorded one, the archive's parent
directory is added to `walk.demoted` so it reaches `changedDirs` and the sheet drop —
but it is not re-read: the confirm loop's demotion happens *before* the level is
returned, this one *after*, and the write-back has already corrected the one entry in
that level the archive's stat speaks for, while the interior is fresh from `walkZip`.
`walkZip` surfaces no size — its interior entries carry `zipStat.mtimeMs` alone and
`sameEntries` has nothing of the archive's size to compare — so the zip compare is
**mtime-only**, which an overwrite always moves; the write-back carries `zipStat.size`
beside the mtime since the same stat has it in hand, so the tile's size does not stay
stale either, but the decision reads the mtime.

*The loop closes.* Both `levelFor` branches record the directory's mtime in
`walk.dirMtimes` — the reuse branch and the `listFsDir` fall-through alike — and a
demoted directory's mtime did not move, so `revalidateTree`'s `before.get(path) !==
mtime` filter leaves it **out** of `changedDirs`; task 1.2's union is what puts it in,
and is load-bearing, not belt-and-braces. The next pass re-stats the demoted
directory's entries against the record the re-read just corrected, finds them equal,
and does not demote again: one re-read per overwrite, not one per cadence.

*Why demote rather than patch the entry in place.* Patching (`e.mtime = s.mtimeMs;
e.size = s.size`) saves one `readdir` per changed directory and needs a second rule
for the entry that cannot be stat'd — a link whose target vanished, or a file gone
within the parent's mtime granule (ns on ext4, 10 ms on the exfat volume per
`scripts/probe-dir-mtime.py`). Demoting has one
rule — *the recorded level could not be confirmed, so read it* — and reuses everything
that already exists for a changed directory: `listFsDir`'s confinement and step
charging, the `changedDirs` list, `noteDirChanged`, the own-entry refresh. The cost of
the extra `readdir` is paid only for a directory that did change, which is the case
the pass exists to find.

*Why not a force-reload mode.* Pinned: a mode the user has to reach for would leave the
routine pass wrong and the spec sentence false; the routine pass is what the reload
runs.

*Step charging.* The confirmation stats charge the walk budget one step per entry
examined, as `listFsDir` charges one per entry — so a reused level costs what the
original read cost in budget terms, and a tree that fit the search budget when walked
still fits when revalidated. Not charging would let the pass do unbounded work outside
the budget that exists to bound it.

### D2: Cost — warm measured, cold a task for Masa, and where the pass waits

Two warm measurements exist, and only one has the pass's shape.

**The real shape** (the cold review, 2026-09-14, on the same ext4 volume, `/dev/sda1`,
5,077 directories / 14,064 files, warm page cache, two runs each): the path list was
collected once and then **stat-only loops** were timed — no `readdir`, which is what
the pass does, since a reused level's names come from the snapshot.

| pass (stat only, no `readdir`) | warm, run 1 | warm, run 2 |
|---|---|---|
| stat each directory only (today) | 10.6 ms | 10.0 ms |
| stat each directory and every file entry (D1) | 39.7 ms | 43.6 ms |

A **~4× multiplier**, not the 1.7× the pair below implies.

**The wrong shape** — recorded so nobody re-reads it as the cost: python `os.walk` +
`os.stat`, which `readdir`s every directory it visits, so both cells pay a full
directory read the pass never makes and the ratio between them is diluted by it. The
reviewer's run on the tree above: 57 / 93 ms. Masa's run on 2026-09-14 (his count of
the same volume: 4,863 directories / 13,429 files, one run each): 59 / 98 ms. Neither
pair is the pass; both are kept as the record of what was measured first.

Cold is **not measured**. Do not extrapolate: the memory note records cold metadata at
0.156 ms/entry on SSD against 2.405 ms/entry on the spinning exfat volume, warm
media-independent — a cold entry-stat pass on spinning media is, by construction, the
cold walk minus its `readdir`s and may approach the ~32 s figure the tree cache exists
to hide. The measurement is task 6.1 (a stat-only probe with the real shape: the
script, the drop-caches step and where to record it are all spelled there); it
produces two numbers per volume, cold directory-only and cold with entries, and both
go into this table and into `REVALIDATE_TTL_MS`'s comment in `listingCache.ts`,
replacing "~5.6 s measured cold".

Where the cost lands today, unchanged by this change: `ListingCache.list` answers a
snapshot at once, marked, and runs the pass in the background — a browse or a search
never waits for it. `ListingCache.enumerate` (bulk jobs) and `ListingCache.reload`
(`POST /api/reload`) wait for the pass, as they did; the startup pass runs in the
background one root at a time. So the cold cost, whatever it is, is off the request
path for listings and on it for an enumeration and a reload.

*If cold proves ruinous.* The fallback is a second cadence: confirm entries only when
the root's last **entry** confirmation is older than a longer TTL (directory stats every
`REVALIDATE_TTL_MS`, entry stats every N minutes). That changes the spec's "within a
revalidation interval" and is deliberately not built here — Open Question 2.

### D3: What a changed entry must reach, traced

(a) **Every listing served from the snapshot.** `revalidateTree` builds `entries` from
the gathered walk and `save`s them unconditionally — today too — so once the demoted
directory is re-read, the corrected `mtime`/`size` are in the file `walkFlat` next
loads and in every `partition` of it. The spec now says the save is required when an
entry changed, so an implementation that skipped the save on `changed === false` for
the directory list alone would be wrong: `changed` is `!sameEntries(...)`, which
compares `mtime` and `size` per entry, so an overwrite already reads as moved.
`enumerateModels` reads the same snapshot. **On disk:** `SnapshotStore.save` is
`writeAtomic` of the whole tree file, so a restart loads the corrected entry;
`SNAPSHOT_VERSION` stays 1 — an existing snapshot is corrected by its first pass, not
discarded.

(b) **The derived layers.** The preview choice is the one that carries an entry's
mtime: `recordPreview` copies cells with `copyEntry`, and `annotate(preview)` in
`app.ts` runs `cache.annotate(cell.path, cell.mtime)` on each — a cell carrying the old
mtime would report `hit` for the old render and the client would request the old key,
the same failure one level down. Decision: the changed entry's directory is reported in
`changedDirs`, so `ListingCache.run`'s existing loop calls `layers.noteDirChanged(dir)`
and the folder's sheet **and its ancestors'** are dropped and re-derived (a peek stats
fresh through `listFsDir`). Dropping rather than patching the cell is the honest
choice: the requirement already says a detected change re-derives, and the sheet's
*choice* is derived from the subtree (posed models first), which a re-export can move.
No new call, no new symbol in `layers.ts`: the union in D1 is the whole of it.

Poses are not touched — a decision, not a deferral. `noteDirChanged` leaves them alone
by design ("a pose is a fact about a model's geometry"), and an overwrite *is* a
geometry change; but the held pose is keyed by **path**, and the semantic index it was
learned from still holds the *old* file's embedding — nothing re-embeds an overwritten
model — so dropping the held pose would only make the next listing ask the index again
and get the same old-geometry answer back. It buys nothing until re-embedding exists,
which is out of scope (Non-Goals) and, for the layer itself, moot once
`pose-layer-removal` deletes it (emission asks the index per listing). If this change
lands first, an overwritten model's held pose lingers to `POSE_ANNOTATION_TTL_MS`
(five minutes) or the next reload (`dropAll`), and the pose it lingers *as* is the one
the index would answer anyway. Thumbnail state carries no layer of its own —
`ThumbCache.facts` is keyed by path and `infoFor` derives the state at emission from
the entry's mtime, so (c) covers it.

(c) **The thumbnail annotation and the client's key follow automatically.** With the
corrected mtime on the entry, `infoFor` compares the sidecar's stored mtime against the
new one and answers `stale`; `useThumbnails` treats a same-path new-mtime entry as a
removal then an addition (its own comment), requests `/api/thumb` with the new mtime,
gets a miss, renders, and `PUT`s. Nothing in `cache.ts`, `useThumbnails.ts` or
`thumbKeyOf` changes.

### D4: The remaining blindness, stated

An overwrite that preserves both mtime and size — `cp -p`, `rsync -t`/`-a`,
`touch -r`, a tool that restores timestamps — is invisible to the pass. It is equally
invisible to the folder view (`listFsDir` stats the same two facts), to the thumbnail
cache (keyed on the same mtime, with `infoFor` comparing the same mtime) and to the
client (same key). So after this change the snapshot is exactly as blind as the
uncached path, and no blinder: the spec sentence names this case and says it is the
app's, not the cache's. A size-preserving rewrite inside one mtime granule is the same
case and needs no separate mention; the ns granularity of ext4 and the 10 ms of exfat
make it a race nobody will hit by hand.

### D5: The switch — `listingCache` in the file, `MODEL_BROWSER_LISTING_CACHE` in the environment, default on

**Names.** Top-level key `listingCache: boolean` in `DeploymentConfig`, beside `root`,
`origins`, `listen`, `features` — flat, because it is one boolean and a `cache: {…}`
object would invite the thumbnail cache and the layers to join it, which D5 argues
they should not. Environment `MODEL_BROWSER_LISTING_CACHE`, which is the key's name
under the mechanical rule D6 fixes for the feature fields (camelCase →
`MODEL_BROWSER_` + SCREAMING_SNAKE), so one rule names every override. Not
`MODEL_BROWSER_NO_LISTING_CACHE`: a negated variable reads `=0` as "on" and puts the
default in the reader's head rather than in the value. The other session's example
strings (`"cache": { "listings": false }`, `MODEL_BROWSER_NO_LISTING_CACHE=1`) were
unclaimed illustrations and are not adopted.

**Values.** The environment variable accepts exactly `1`, `true`, `0`, `false`; unset or
blank is no override; anything else is a `ConfigError` naming the variable and the
accepted spellings, thrown from `loadConfig` so it stops the server the way a malformed
file does. `envPositiveInt`'s "malformed falls back" rule is deliberately not reused: a
knob's fallback is a safe number, while a switch read as its default would run the
cache the tester meant to turn off, silently.

**Precedence and application.** `loadConfig` applies the environment after the file
and returns one resolved value (`withRootFromEnv`'s shape, generalised); nothing else
reads the variable. `index.ts` builds `snapshots` only when `config.listingCache !==
false`, passes `undefined` otherwise to `ListingCache` and `createApp`, skips the
startup pass and the snapshot sweep, and prints `listing cache: off` beside the
`library … at …` line so a run with the switch on is legible in the log.
`createApp`'s reload route already answers `{roots: 0, changed: false}` with no store,
and `ListingCache.list` with no store is `walkFlat` with no marker — for the *walk*,
that is the pre-`listing-tree-cache` behaviour and the header of `listingCache.ts` says
so; the switch selects it rather than adding a mode.

**Off also turns the archive-directory layer off**, and this is not optional: the
`ZipDirCache` is `SnapshotStore.archiveCache()` and every route reaches it through the
store — `snapshots?.archiveCache()` at the three sites in `app.ts` (the annotation
fill's `posedFirstPeek`, `listDir` in `/api/dir`, `/api/peek`) and
`store?.archiveCache()` in `walkFlat` and `enumerateModels` — so building no store
leaves every `listZipEntries` call with `zips` undefined. Browsing or peeking a
zip-heavy folder then re-reads each archive's central directory on every request,
which is the cost the layer landed with `listing-tree-cache` (D3 there) to remove —
"the largest single measured win in this change", per `walkZip`'s own comment. So off
is pre-`listing-tree-cache` behaviour for the archives as well as for the walk, and a
tester timing a zip-heavy folder with the switch off is timing both absences at once.
Stated in the spec delta and in CLAUDE.md's
sentence on what off costs. The derived layers and the thumbnail cache are untouched
by the switch.

**Default on.** Masa on 2026-09-14: "I think it would actually be better to have them
on by default. I think the cache issue that I was seeing had been resolved in a
previous pass." His earlier answer (an AskUserQuestion on 2026-09-11, relayed verbatim
by the session that asked it) chose "Off by default", with the ~32 s cold-walk cost
stated in front of him, "until the invalidation is trusted" — given before the
add/delete/rename probes and before this change's per-entry stat existed, and reversed
on the 14th for that reason. The same 2026-09-11 answer asked for both the config key
and the env var and for a per-feature env var each ("I think both the config key and
the env var, and each feature should also get it's own env var"), which D6 carries.

**Why the other caches need no switch.** The derived layers are process-local and
dropped wholesale by `POST /api/reload` (`layers.dropAll()`) and by a restart; a test
that wants them empty reloads or constructs a fresh `ListingCache`. The thumbnail cache
is the user's rendered work under `~/.cache/model-browser/<id>/` — turning it "off"
would discard renders the user paid for on every start, and a test that wants a clean
one has `rm -rf` of the id directory (CLAUDE.md, Testing) and the
`MODEL_BROWSER_CACHE` directory variable to point at a scratch one. Neither is a cache
whose *correctness* is in question; the tree snapshot was.

### D6: Per-feature environment overrides, one rule

Each `FeatureReport` field gets `MODEL_BROWSER_` + the field name in SCREAMING_SNAKE:
`MODEL_BROWSER_THUMB_WRITES`, `MODEL_BROWSER_APP_LAUNCH`, `MODEL_BROWSER_CHAT_TAB`,
`MODEL_BROWSER_HOST_DETAILS`, `MODEL_BROWSER_MAINTENANCE`. The names are derived in
code from `FEATURE_KEYS` (itself from `DEFAULT_FEATURES`), never listed — the reason
`FEATURE_KEYS` exists: a field added to the report gets its variable the moment it has
a default. Values and errors as D5. Each overrides *that one field* of `config.features`
and leaves the rest of the file in force, and the override happens inside `loadConfig`
so `index.ts`'s `{ ...DEFAULT_FEATURES, ...config.features }` and the routes' refusals
still read one value (feature-report's "the declaration and the refusal cannot
disagree").

Collision guard: the derivation must refuse to mint a name already used by another
variable this server reads (`MODEL_BROWSER_CACHE`, `_CONFIG`, `_ROOT`, `_CLIENT`,
`_INDEX`, `_LAUNCH_CONFIG`, the budgets and caps). No current field collides; a future
field named `cache` would, and a test asserts the derived set is disjoint from the
known list so the day it happens is loud.

*Alternative — one `MODEL_BROWSER_FEATURES=thumbWrites=false,…` variable.* Fewer
names, but a mini-language to parse strictly, and Masa's words were "each feature …
it's own env var".

### D7: Tests — order-free assertions, falsification named, Node and Bun

Every behavioural cell states the code change that makes it red (tasks.md carries
them). Cells assert set membership and per-entry equality against `statSync`, never
listing order — vitest runs on Node (sorted `readdir`) and the server on Bun (raw
order). An overwrite fixture writes bytes of a *different length* and then
`utimesSync`s the file to a stamp visibly later than the recorded one, so a same-ms
write on a fast filesystem cannot make the cell pass for the wrong reason; the
blindness cell writes the *same* length and `utimesSync`s the recorded stamp back.
The instrumentation is the existing `vi.mock('node:fs/promises')` counter in
`listingCache.test.ts` (`treeReaddirs`, `archiveOpens`), extended with a `stat` counter
for the proportionality cell.

## Risks / Trade-offs

- [Cold entry-stat pass on spinning media approaches the cold walk] → It is off the
  request path for listings (background, served marked) and on it only for enumerate
  and reload; measured by task 6.1 before the change is judged done; the second-cadence
  fallback is Open Question 2 and would be its own change.
- [Charging steps for confirmation stats exhausts the budget on a tree that used to
  revalidate] → What exhaustion costs, spelled: `gatherFlat` sets `budgetExhausted`,
  `revalidateTree` throws `RevalidationError`, and `ListingCache.run`'s third branch
  `store.invalidate(root)`s the snapshot and `dropPreviewsUnder(root)` — the next
  listing pays the cold walk (~32 s on the spinning volume). Per-entry charging moves a
  tree *toward* that edge: today's pass charges nothing for a reused level, and after
  D1 it charges one step per recorded model entry. The bound is parity with the walk
  and it holds with room: `listFsDir` charges one step per **dirent**, non-model files
  included, which the confirm loop never sees (it walks the recorded entries, which are
  models and archives only), so the walk that wrote the snapshot charged strictly more
  than its revalidation will. A demoted directory double-charges — the confirm loop,
  then `listFsDir` — bounded by what changed, and buys one rule instead of two. A tree
  that fit the search budget (200k) when walked therefore fits its revalidation;
  `RevalidationError` on exhaustion is the existing rule, unchanged.
- [With the cache off, the snapshot directory's bound is unenforced] → `index.ts` skips
  `snapshots.maintain()` when it builds no store, so `<cache>/<id>/snapshots/` is
  neither swept nor capped for the duration of an off run; the files there are whatever
  the last on run left, untouched. Stated in CLAUDE.md beside the switch; the next on
  run's startup sweep enforces the bound again.
- [An env value like `TRUE` or `yes` stops the server] → Deliberate (D5): the error
  names the variable and the four spellings; a test covers it.
- [The `MODEL_BROWSER_LISTING_CACHE=0` run leaves no snapshot to revalidate, so a later
  run with it on starts cold] → That is what off means; documented in CLAUDE.md beside
  the switch.
- [`pose-layer-removal` and this change both add cells to `layers.test.ts`] → Separate
  `describe` blocks; re-read before editing (tasks.md ordering note).
- [`search-cancellation` edits `listing.ts` (`walkFlat` registry) and `app.ts`] →
  Different symbols (`levelFor`/`revalidateTree` here); re-read against main before
  starting, as its tasks.md asks of its own implementer.

## Migration Plan

None. No wire change, no snapshot format bump: an existing snapshot is corrected by its
first pass. Rollback is reverting the commit; a snapshot written by this code is
readable by the previous code. The switch and the environment overrides are additive
and default to today's behaviour.

## Open Questions

1. **Does the tree cache default on?** — Closed. Masa, 2026-09-14: "I think it would
   actually be better to have them on by default. I think the cache issue that I was
   seeing had been resolved in a previous pass." Default on; the switch is the testing
   affordance. (His 2026-09-11 "off by default … until the invalidation is trusted"
   predates the probes and this change, and he reversed it for that reason.)
2. **Does cold entry confirmation need a second, longer cadence?** — Deferrable:
   decided by task 6.1's numbers on the spinning volume, after implementation — and
   read off the **real shape** (D2's stat-only table, ~4× warm), never the `os.walk`
   pair, whose `readdir` per directory hides most of the multiplier. If yes,
   it is a follow-up change that MODIFIES *An entry overwritten in place is seen by the
   pass* ("within a revalidation interval" becomes "within the entry interval"); the
   code shape is a second stamp beside `validatedAt`. Nothing in this change's tasks
   depends on the answer.
