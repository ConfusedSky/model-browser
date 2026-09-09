## Context

`peek` (server/src/listing.ts) opens with `if (entry !== undefined) return []`,
so every virtual path carrying an entry half answers "nothing to preview". Its
comment names the rule it is enforcing — *"Neither an archive nor anything inside
one is previewed (Non-Goals)"* — and the non-goal it cites
(`folder-contact-sheets`, proposal "Zip tiles are not previewed in this change")
is written entirely about cost: a zip's contents cost a central-directory read,
cited there as 6.7 s across the real library's archives. That argument is about a
listing **of** archives. It says nothing about a directory inside an archive
whose entries the asking request has already read, and the code cannot tell the
two apart because it tests the path's shape rather than what the read would
cost.

Reproduced against the running dev server on the real library:

```
GET /api/dir  /Oni+Cyber+Punk+Mask.zip        → dir tiles "files","images", preview: []
GET /api/peek /Oni+Cyber+Punk+Mask.zip!/files → []
GET /api/dir  /Oni+Cyber+Punk+Mask.zip!/files → Lower_Jaw.stl, Mouth.stl (ao: hit)
```

Nothing on the client is implicated: `Grid.tsx` marks every `dir` tile
`data-dirTile` whatever its path, `App.tsx` peeks it, and the empty answer is
rendered as `NO_PREVIEW` — the icon. The `preview: []` already riding the listing
is the emission-time fill (`fillPreviews` in app.ts) recording the same refusal
through the layer.

**The recorded cost does not reproduce on this machine, and the number below is
mine.** Re-run 2026-09-09 against the real `listZipEntries` under Bun, over all
453 archives of `/run/media/masa/STLLibrary` (139 GB), with
`POSIX_FADV_DONTNEED` applied to every file immediately before the run and
`fincore` confirming zero resident pages:

```
cold, no layer      248 ms / 453 archives   (~0.55 ms each, 13,168 entries)
with the layer        8 ms                  (stat + lookup, ~0.02 ms each)
without layer, warm  59 ms                  (page cache serving the tails)
median 0.48 ms   p90 0.80 ms   p99 1.20 ms   max 2.0 ms
```

Hardware: WD SN740 NVMe behind a USB bridge (which reports `rotational: 1`
spuriously). The 6.7 s figure is consistent with a spindle — 453 tail seeks at
~10 ms — so it is treated here as unverified on unknown hardware rather than
wrong, and no decision below leans on it. The probe is `scripts/zip-tail-cost.ts`
(task 4.4), so the next reader re-runs it rather than re-typing this.

One archive of the 453 is zip64 and the reader refuses it outright
(`2022_02_Man Eaters Part 2.zip`, 4.3 GB) — it can never carry a sheet, and D10
says what a peek answers for it.

`layers.ts` was written against this day: `selfAndAncestors` splits an archive
interior into keys deliberately, and says so — *"A preview is never derived inside
an archive today — `peek` refuses them outright — but a list that quietly assumed
so would be wrong the day one is."*

## Goals / Non-Goals

**Goals:**

- A directory inside an archive derives and draws a contact sheet like any other
  directory, through the same endpoint, the same layer and the same client path.
- Previewing several directories inside one archive does not cost a
  central-directory read per tile, and a browse that has just listed an archive
  does not make the peek read it again.
- The sheet inside an archive is deterministic and bounded on the same terms as a
  filesystem directory's — same entry bound, same code-point ordering rule.

**Non-Goals:**

- **Previewing the archive's own tile.** The recorded justification — the tail
  reads — is the part that did not reproduce (~0.5 ms each here, so a folder of
  100 zips is ~50 ms of central directory). The barrier that does survive
  measurement is the one nobody wrote down: a zip tile's four cells must
  *extract* model bytes, decompressing multi-megabyte STLs out of the archive,
  where a directory tile's four cells read four files. An interior pays that too
  and is accepted; a listing of 100 archives paying it on first paint is not.
  Revisiting it needs an extraction measurement, not another tail-read one.
- Teaching the semantic index about archive interiors. It excludes them
  structurally (D8), so an interior's sheet is the walk's choice and nothing
  here changes that.
- Single-flighting concurrent reads of one archive. Measured and declined: see
  the Risks.

## Decisions

### D1. Split the refusal by what it costs, not by the path's shape

`peek`'s entry-half early return is replaced by a branch that previews the
interior. The archive's **own** tile is refused by the branch that already exists
below it — after the `stat`, `if (/\.zip$/i.test(fsPath)) return []` — which is
the case the non-goal is about and is untouched. One refusal survives, at the
place whose cost justifies it.

*Alternative considered:* keep the refusal and let the client skip peeking
archive-interior tiles. Rejected — it moves a server-side cost judgement into the
grid, and the client would then have to know what a virtual path means to decide
whether a tile can have a sheet.

### D2. Walk the archive's entry names, not the filesystem

An archive interior's peek filters `listZipEntries`' names by the directory's
prefix, exactly as `listZipDir` does: names under the prefix with no further
slash are this level's files, names with one are its subdirectories. The level's
models come before its subdirectories, depth-first in the order the names sort —
`peekLevel`'s rule, over a different source of levels.

Ordering is **code-point**, not `sortEntries`' `localeCompare`, for the reason
`listFsDir` records at its own sort: an entry bound cutting under ICU collation
cuts differently per locale, and the requirement demands the same cut on every
machine. Display order is unaffected — `wire` and the callers sort on the way
out as they always did.

*Alternative considered:* reuse `walkZip`. Rejected: it exists for a flat
listing, pushes into `walk.models`/`walk.dirs` with a name prefix, and returns
containers — a different output contract from the ordered `found` array a peek
keeps.

### D3. One archive read per request, shared by the listing and the peeks

`peek` gains an optional `ZipDirCache`, threaded to `listZipEntries` the way
`gatherFlat` threads `walk.zips`. Neither route calls `peek` directly — both go
through `posedFirstPeek`, whose `walkOnly` and `walkRanked` closures call it — so
the cache is a new `posedFirstPeek` parameter passed down through both, and
`/api/peek` and `fillPreviews` supply `snapshots?.archiveCache()`.

**`listZipDir` is folded in and reads through the same layer.** It calls
`listZipEntries` with no cache today, so without this the browse that shows you
the interior tiles pays one tail read and the first peek pays a second — the
listing's read populates nothing. `listDir` takes no store, so it gains the
parameter and `/api/dir` supplies it, the same one-argument plumbing as above.
This is what makes the shared-read claim true rather than merely asserted, and it
makes browsing an archive cheaper on its own account: 0.55 ms → 0.02 ms per
archive on the second visit (Context).

The consequence to state plainly: browsing an archive now *writes* a record for
it, so `archives.json` grows to cover archives that are only ever browsed and
never searched — about 6 KB each, 2.4 MB for this library's 453.

Without a store the peek and the listing both read directly, which is what a
server with no tree cache does everywhere else.

### D4. The entry bound is unchanged and counts archive entries

`PEEK_BUDGET` (64) stays the bound. **One step per distinct immediate child** —
each file name and each distinct subdirectory name directly under the prefix —
which is the dirent analogue and the only reading under which "the same entry
bound as a directory" means anything. Not `walkZip`'s rule, which charges every
central-directory entry under the prefix at every depth and would spend 100 steps
at a parent on one subdirectory of 100 models. Names outside the prefix are never
charged, and the charge loop runs over the code-point-sorted children and breaks
at the budget as `listFsDir` does.

The bound governs determinism more than I/O here — the central directory is in
memory once read — but keeping one constant is what makes "a sheet is a glance"
mean one thing across both sources.

### D5. No confinement or cycle machinery inside an archive

`peekLevel`'s `realpath`/`within` checks and its `visited` set exist because a
filesystem directory can be a symlink out of the library or back into itself. An
archive entry name is data inside a file already confined by the resolver, so
neither question arises. A nested archive is not enterable (global D6) and is
neither previewed nor descended into — the same skip `listZipDir` makes.

### D6. No `LAYER_VERSION` bump

The rule is to bump when what is derived changes meaning, and this does change
the set of paths a preview is derived for. It is still not needed: the pose and
preview layers are process-local by design (`listing-tree-cache` D7) and hold
nothing across a restart, the tree snapshot stores no preview field
(`snapshotEntries` carries name/path/kind/size/mtime/format), and shipping this
code is a restart. The stale entries a bump would exist to strand cannot outlive
the deploy that creates them.

### D7. The emission-time fill's collection needs no change

`fillPreviews`' `unchosen` collects listing entries by `kind === 'dir'` with no
test on the path's shape, so a zip's listing already offers its interior
directories to the fill — which is why they arrive today carrying `preview: []`.
Once the peek answers, the same code path carries a real sheet with the listing
instead of after it, under the same `FILL_PREVIEW_MAX` bound. The only change at
the route is D3's cache argument.

Worth stating because it changes which path most sheets arrive on:
`fillAnnotations` returns early unless the index probe is `ready`, so on a server
with no semantic index **no** sheet rides the listing — every one of them comes
from the client's peek wave instead. That is the existing behaviour for
filesystem directories too, but it is what decides which harness a test of the
fill needs (task 3.6).

### D8. The index is not consulted for an archive interior, and the spec says so

`scopeDetail` (server/src/semantic.ts) returns `{ real: null, miss: 'structural' }`
for any path containing `!/` — nothing inside an archive is embedded
(`semantic-search` D7) — so `posedFirstPeek` takes its `walkOnly` branch for every
interior. `/under` is never asked and `walkRanked`'s `/poses` batch never runs.

This is worth stating rather than leaving to "the index happens to be silent":
those read the same from outside and are different facts. An interior's sheet is
the walk's choice in walk order, permanently, and a later reader who assumes
posed-first applies there would be debugging a ranking that cannot execute.
`walkRanked` still has to compile with the new parameter even though no interior
reaches it.

### D9. A stale interior sheet is caught at emission by its own mtime

The first draft of this decision said `noteDirChanged(<zip lib path>)` drops the
interior keys. It does not: `noteDirChanged` computes
`selfAndAncestors(changedPath)` and deletes keys whose directory is *in* that set
— it walks **upward** from the change. `selfAndAncestors('/kit.zip')` is
`['/', '/kit.zip']`, and `/kit.zip!/parts` is a descendant, so the interior key
survives. (Probed under Bun against the real `DerivedLayers`: after
`noteDirChanged('/kit.zip')` the interior entry is still held; after
`dropPreviewsUnder('/kit.zip')` it is gone, since `under` has an explicit
`${root}!/` branch.) `dropPreviewsUnder` is therefore the layer call that
*could* do it.

Neither is used, because the revalidation route cannot fire when it needs to. A
pass runs from `ListingCache.list` (flat listings), `enumerate`, startup and
reload — never from a nested `/api/dir`. So browsing back into a rewritten
archive would re-derive nothing, which is precisely the case a stale interior
sheet shows up in. Teaching `revalidateTree` about archives also needs a new
detection path: `changedDirs` compares `g.dirMtimes` against `snapshot.dirs`, and
archives populate neither.

**The interior key validates itself.** An interior directory entry already
carries the containing archive's `mtime` (`listZipDir` and `walkZip` both emit
`mtime: zipStat.mtimeMs`), and so does every cell in its recorded sheet. So
emission compares the entry's mtime against the recorded cells' and re-derives on
a mismatch — a check no filesystem directory could offer, firing on exactly the
"listed again" that the revalidation route misses, and needing nothing new to
detect a change.

This also closes the thumbnail hazard: cells key on path+mtime, so a sheet held
against a dead archive version would draw against a cache entry that no longer
matches the model tiles beside it.

### D10. The interior branch inherits the listing's refusals, not a bare `[]`

`peek`'s entry-half return currently answers `[]` for *every* entry-half path,
which has been hiding four cases that the interior branch must decide
deliberately, each with a precedent in `listDir`:

- **The filesystem half is not an archive** (`/somedir!/x`): `requireArchive`'s
  400, as `listDir` and `gatherFlat` both do. Without it `listZipEntries` runs on
  a directory and raises an untyped errno.
- **The archive is unreadable** (mode 000 — `stat` succeeds, `open` fails):
  `listZipDir`'s `ListingError(404, 'cannot read zip: <libPath>')`. Its comment
  records why the wrapper exists: the raw errno escaped as a 500 naming the
  operator's filesystem path.
- **The entry half is empty** (`/kit.zip!/`): answers `[]`, not a refusal. It is
  the archive's own tile by another spelling, and `/kit.zip` answers `[]`
  "rather than refusing" today — two spellings of one tile must not give two
  answers. What it must not do is fall through to a prefix of `''` and preview
  the whole archive.
- **The entry names a file or a nested archive**: `listZipDir`'s taxonomy — 400
  `not a directory`, `VPathError` for a nested zip — not an empty sheet.

A missing prefix inside a readable archive stays `[]`: an empty sheet is what a
directory with nothing previewable answers everywhere else.

### D11. Entries carry the archive's mtime

Interior finds carry `zipStat.mtimeMs`, as `listZipDir` and `walkZip` already
emit. This is what makes "A preview is an ordinary thumbnail" true inside an
archive: thumbnails are keyed path+mtime, so a sheet cell built with any other
mtime would render and cache a second image beside the model tile's.

## Risks / Trade-offs

- **A large archive is scanned per interior tile.** The prefix filter is O(entries
  in the archive) and runs once per peeked directory, in memory after D3's read.
  → Bounded by what archives actually hold here: 13,168 entries across 453
  archives, the largest 244 (Context). A few hundred string comparisons per tile
  is nothing beside the 0.55 ms read it follows. Re-check if an archive with
  ~100k entries ever appears.
- **Concurrent misses on one cold archive each read it.** `archiveCache` has no
  in-flight coalescing; `fillPreviews` runs 4 derivations at once, and on an
  index-less server the client's wave is bounded only by the browser's
  connection limit. → **Measured and declined.** A tail read is ~0.55 ms cold on
  this hardware (Context), so six duplicates cost ~3 ms, once per archive
  version. Single-flighting `listZipEntries` would touch a function every
  listing and walk path shares and would make concurrent callers share one
  failure — a wider blast radius than the 3 ms buys. The spec is written to what
  the code does: read through the layer rather than once per tile, with no claim
  about simultaneous first-touches. Revisit if the same measurement on a spindle
  says otherwise.
- **A recorded empty sheet is served until the process restarts.** Interiors
  derived to `[]` by the current code sit in the layer. → The deploy is a
  restart (D6); nothing else is needed.
- **The zip tile still shows an icon**, and a user who sees interiors previewed
  will read that as inconsistent. → It is a recorded non-goal, but its stated
  justification is the one this change could not reproduce (Non-Goals). The
  honest position: the boundary holds on the extraction cost, not the tail read,
  and that has not been measured. The spec states the distinction so the next
  reader meets the argument rather than the omission — and the argument it meets
  is now the right one.

## Open Questions

- None blocking. Whether a `.zip` tile should be previewed at all is the open
  one, and this change moved it: the tail-read objection is ~0.5 ms per archive
  here, so the question is now whether four *extractions* per zip tile are
  affordable on a cold listing of many archives. That is one measurement away
  and belongs to its own change.
- Whether browsing should write archive records at all (D3's consequence) rather
  than only read what a walk left. Left as read-and-write, the ordinary
  behaviour of every other `listZipEntries` caller; raise it if `archives.json`
  growth from browse-only archives ever matters.
