# Design — multi-term-name-search

## Context

See proposal.md for why. The owner's decision on issue #66 (2026-09-28) fixes the rule, and
the specs state it (`file-search`, *Names match term by term*). This document covers where
that rule runs and how its inputs reach each place. Everything below was read from the
code on `main` at `ff4063f`. None of it is measured unless a figure is given.

**Server.** `/api/dir` (in `app.ts`) calls `listings.list` (`ListingCache.list`), which
calls `walkFlat` (`listing.ts`). `walkFlat` gets a tree either by walking or from the
snapshot store (`partition`, which makes fresh copies). It then filters with `matchesQuery`
(a model's whole root-relative `name`) or `matchesOwnName` (`baseName(name)`, for containers
and for models with folder matching off), sorts, and applies the model cap
(`MODEL_BROWSER_FLAT_CAP`) and the folder cap (`MODEL_BROWSER_FOLDER_CAP`). `wire` then
copies the entries out. Only after all this does `app.ts` run `applyDisplayNames(entries,
await overrides.store())`. That is an exact-key `displayNameOf` per entry, mutating the
emitted copies in place. So when the filter runs, no name has been attached yet.

**Store lifetime.** `createOverrideHolder` loads `overrides.json` once per resolved library
(`id` + real top) and holds it. `library-overrides` requires this: "answers reflect the
store as loaded, until the server restarts or the library re-resolves". No route writes the
store. Its writer is `scripts/gen-overrides.ts`, run offline.

**Snapshot.** `SnapshotEntry` is deliberately not `DirEntry`. A comment in `snapshot.ts`
says `applyDisplayNames` "sets in place and never clears, so persisting it would write one
request's override names into every later answer". `listing-cache` requires the cached tree
to be "independent of any query or option applied to it".

**Client.** `App` computes `needle = findText.trim().toLowerCase()`. `filteredListing` then
keeps `kept.filter((e) => e.name.toLowerCase().includes(needle))`, one rule for every kind.
Entries carry `displayName` for their own exact path only. The client has no ancestor
names: in a flat listing, only the root's direct child containers are entries at all, and
in a deep search only the matched containers are.

**Meaning and similarity answers.** `/api/semantic` and `/api/semantic/similar` build
entries with `hitsToEntries` (`semantic.ts`). The similarity route's `anchor` comes from
`modelEntryAt`. Each entry is named by the hit's `rel_path`, which is relative to the
index's **collection root**, not to the scope the response's `path` names. Both routes call
`annotate` but never `applyDisplayNames`. That is `library-overrides` D7, which the
`directory-browsing` requirement restates as "semantic and similarity answers are
deliberately outside it".

**Routing.** `submitSearch` (in `App.tsx`) routes by shape in two directions. Under meaning
mode, `looksLikeFileName` sends the text to names. Under name mode,
`looksLikeDescription` (three or more words, none file-name-shaped) sends it to meaning
where `meaningRunnableAt`. Each route sets `autoMode`, and the results line explains the
route from that ("looks like one" / "reads like a description").

**Other consumers of name matching.** `ApiClient.nameMatchCount` counts a name search's
entries. It powers *Names are counted beside a meaning search*, and by going through the
server it follows the new rule on its own. `/api/complete` (path-bar completion) is not
name search and does not change.

## Goals / Non-Goals

**Goals:**

- One implementation of the term rule, in `shared/`, called by the server filter and the
  client filter with the same inputs.
- Over any listing that carries names, the Narrow filter keeps exactly what a submitted
  name search from the same location would match (D4).
- Nothing persisted or cached depends on the override store (D5).

**Non-Goals:**

- The meaning ranking, its scores, and what the index is asked are unchanged. D6 only
  names the entries it returns.
- No ranking. Results keep the existing order: containers by kind, then by path, then
  models by path.
- No search by credits or author.

## Decisions

### D1 — Terms, and one shared matcher

The new module is `shared/nameMatch.ts`, beside `shared/names.ts` (`baseName`, which both
sides already import). It has two exports:

```ts
/** Trimmed, split on whitespace, lower-cased; [] is "no query". */
export function queryTerms(text: string): string[];

/** Every term is a substring of one of the subject's names (the table above). */
export function matchesTerms(
  terms: readonly string[],
  subject: { name: string; kind: EntryKind; displayName?: string; ancestorNames?: readonly (string | null)[] },
  folderMatching: boolean,
): boolean;
```

The subject's names, by kind:

| subject | tested names |
|---|---|
| model, folder matching on | `name` (root-relative path), `displayName`, each non-`null` slot of `ancestorNames` |
| model, folder matching off | `baseName(name)`, `displayName` |
| dir / zip | `baseName(name)`, `displayName` |

A term is tested against each name separately, never against a joined string, because the
spec says a single term never matches across two names. Lower-casing happens once per
name inside the matcher. The server and the client both pass a `DirEntry`-shaped value, so
neither side re-derives the table.

*Alternatives.*
- Separator folding: normalise `_ - .` and whitespace to one space and keep one substring
  test. This was the issue's first suggestion. The owner chose terms, and folding cannot
  find `Bronze Young`.
- A regex built from the query: it needs escaping, and it gains nothing over `includes`.
- Keeping two copies with a test that they agree: this is exactly what the owner's
  constraint rules out.

### D2 — The server filters with the store in hand, inside `walkFlat`

`walkFlat`'s `opts` gains `names?: OverrideStore`, passed through `ListingCache.list` from
`/api/dir`, which already awaits `overrides.store()` on that route. For each candidate, the
filter builds the subject **eagerly** from the store, then calls D1's matcher once. There
is one match path. `displayName` is `displayNameOf(store, e.path)`. `ancestorNames` come
from a new `namesBelow(store, prefix, path)` in `overrides.ts`, which has one contract:

- `prefix` is the entry's path with its name removed: `e.path.slice(0, -e.name.length)`.
  It ends in `/` for a filesystem root and in `!/` for a zip root (`/kit/a.zip!/` for
  entry `parts/x.stl`). This is the separator `modelsUnder` already has to handle.
- The result has one slot per key from `ancestorKeys(path)` (which already walks a virtual
  path, archive-interior folders included) that starts with `prefix`, is longer than it,
  and is not `path` itself: the key's stored `name`, or `null`. The keys come outermost
  first.

`walkFlat`'s filter and the naming pass (D3) both derive `prefix` this way, so they cannot
disagree about which folders count. The root key is excluded by the length test: `/` is
not longer than the prefix `/`, and `/kit/a.zip` does not start with `/kit/a.zip!/`.
Only models with folder matching on read `ancestorNames`. For containers and for
folder-matching-off models, the subject is built without them.

**The filter must be inside `walkFlat`, not after it.** The caps bound matches. A filter
applied in `app.ts` after `walkFlat` would run over an answer the caps had already cut, so
a model that matches only through a stored name could be dropped before it was ever tested.

**Subjects are built, never written onto entries.** The filter does not set `displayName`
or `ancestorNames` on the gathered entries. On a walk they are the objects that
`snapshotEntries` copies from. Under `search-cancellation` they would be one traversal
shared by requests carrying different queries. Setting either field on them would break
the property `snapshot.ts` warns about. Names still reach the wire the way they do today:
through `applyDisplayNames`, on `wire`'s copies (D3).

**Cost.** For each model a query tests, the filter does one `Map.get` per path segment
below the root. On the demo corpus that is one level: every stored name is at depth 1 (444
keys). When the store is empty, `namesBelow` returns early, which is the desktop library's
usual case. That is the only shortcut: testing real names first, and asking the store only
for terms still unmatched, would need a second match path beside D1's.

Measured 2026-09-28 (task 2.5) under `bun`, library `70b60f0d-b563-4167-860c-43826ceba61b`
at `/home/masa/Documents/tests/test-models/miniatures/decimated` (`top` `/`), 454 root
folders, a warm snapshot of 3,576 entries (454 dirs, 3,122 models). `curl` total time for
`/api/dir?path=/&flat=true&q=…`, 5 runs each, two alternating rounds per side, no index on
8077, `main` at `5f79233` against this change:

| query | before (ms) | after (ms) | results before → after |
|---|---|---|---|
| `young` | 2.7–5.4 | 5.3–8.1 | 23 → 23 |
| `Young Bronze` | 2.5–4.4 | 5.0–7.0 | 0 → 10 |
| `D&D paladin` | 2.2–4.3 | 5.5–7.1 | 0 → 1 |

About +3 ms per search, under 1 µs per candidate, on a request that stays under 10 ms. Nothing
more is warranted.

*Alternatives.*
- Put the names into the snapshot: this is rejected by `snapshot.ts`'s note and by
  `listing-cache`'s query-independence.
- Let `listing.ts` take a lookup function instead of the store type: this is equivalent. A
  plain `OverrideStore` (a `ReadonlyMap`) is already a pure value with no I/O, so the
  function adds a seam and no decoupling.

### D3 — Names along a path ride the wire as `ancestorNames`

`DirEntry` gains `ancestorNames?: (string | null)[]`: one slot per folder or archive
**that the entry's relative `name` passes through**, outermost first, holding its stored name
or `null`. The slots line up with the folder segments of `name` (every segment but the last),
which is what lets the tile's folder line put each name in its place (D9). It is set only on
model entries, and only when some slot is not `null`, so a library with no store, or a path
with no named folder, carries no field at all. The matcher skips `null` slots. The rule is defined by the entry's own name rather than by
a root argument, because the two kinds of answer measure names from different places:

- A flat or deep-search listing names an entry relative to the listing's root, so the
  folders passed through are exactly those below the root. This is the set a name search
  matches (the spec's root exclusion).
- A meaning or similarity answer names an entry relative to the index's collection root
  (D6), even when the response's `path` is a narrower scope. The folders passed through
  are then those the tile's real relative name already shows, and the filter already
  matches their real names.

So the naming pass calls `namesBelow(store, prefix, path)` with D2's one contract, `prefix`
being `path` minus its `name`. `namesBelow` answers one slot per key it keeps, and it keeps
exactly one key per folder segment of `name`, so the slots and the segments align. So a zip interior works: `a.zip!/inner/b.stl` below `/kit/`
passes through `/kit/a.zip` and `/kit/a.zip!/inner`, while `parts/x.stl` in a listing of
the zip root `/kit/a.zip` passes through `/kit/a.zip!/parts` alone. The derivation assumes
`path` ends in `name`, which every listing guarantees. `hitsToEntries` does not: its `path`
is `posix.join(collectionLibPath, h.rel_path)`, which is normalised, while `name` is the raw
`rel_path`, so `./kit/x.stl` would give a meaningless prefix. The naming pass therefore
attaches `ancestorNames` only when `path.endsWith(name)`, and otherwise leaves the field
off. The entry is still returned and still gets its own `displayName`. `applyDisplayNames`
gains an option to attach them (`{ along: true }` or similar). The option is passed by
`/api/dir`'s flat branch, `/api/semantic` and `/api/semantic/similar` (the `anchor`
included). Nested `/api/dir`, `/api/peek` and `/api/models` do not pass it: a nested
entry's name passes through nothing, and peek cells and bulk-job scopes are never
narrowed. A library with no store emits byte-identical answers (*No store, no change*).

Why only models: containers match on their own names only (D1's table), so they never
need the field. Meaning and similarity answers hold models alone.

Cost on the wire: one short string per model under a named kit. For the demo's 500-model
flat top listing that is about 500 names averaging roughly 25 characters, plus a key. This
is estimated from `overrides.json`'s names, not measured.

*Alternatives.*
- Pass the listing root explicitly: this is wrong for meaning answers, whose names are
  measured from the collection root and not from the scope the response names.
- The client fetches `/api/overrides` per folder along each path: this breaks *Filtering
  is free of requests*.
- The client reads names off the container entries in the same listing: deeper folders
  are never entries, and a search lists only the containers it matched.
- Ship the whole store once: this is a new route for data the listing already selects, and
  it carries names for paths the visitor never listed.
- Only the named folders, as a list of strings (the first shape): enough for matching, but
  the client cannot tell which folder a name belongs to, so D9 could not place it.
- A map from folder path to name: aligned too, but it repeats path prefixes the entry's
  `name` already holds. The owner picked the per-folder slots (2026-09-28).

### D4 — What "along the path" means for the client filter, and why typing = submitting

**Decision:** the Narrow filter calls `matchesTerms(queryTerms(findText), entry, true)`.
The root is the listing's own location. `ancestorNames` are already relative to that
location, because the server computed them against the listing's root, which is the
folder a search from here would use. Neither the root's own stored name nor any name above
it is ever sent, and the spec excludes both.

The resulting equivalence, per listing shape:

| listing on screen | Narrow keeps exactly what a name search from here would match? |
|---|---|
| nested browse | yes: an entry's names are its own, and the root is excluded on both sides |
| plain flat | yes: models carry `ancestorNames`, containers are the root's children |
| name-search results | yes; and typing the submitted text hides none of them |
| name search run with folder matching **off** | Narrow is a superset: it always uses folder matching on, so it hides none of those results either |
| meaning / similarity results | not a name search's answer, so "exactly" has no referent. Narrow applies the same rule over the names they carry (D3, D6): real relative path, own stored name, stored names along the name |

**Containers change under Narrow.** Today Narrow tests a container's whole `name`, which
in deep-search results is its relative path, so typing a parent folder's name keeps a
deeper folder tile. Under the shared rule it tests the container's own names, which is what
the server's search does. That is the only way the table above can say "exactly". The
alternative kept whole-name matching for containers in Narrow: it hides nothing a
submission returned, but it keeps tiles a submission of the same text would not have
returned. The owner chose own names only (2026-09-28).

### D5 — Freshness: nothing keyed by query outlives the store

The brief asked whether a flat search result cached under its query could go stale when a
display name changes. **No such cache exists:**

- Server: the snapshot is keyed by root alone, and every request filters it afresh (D2).
  The `fills` map in `app.ts` is keyed by query too (`fillKey`), but it single-flights
  in-flight annotation work and is deleted when that work settles. It holds no answer.
- Store: it changes only when the library re-resolves or the server restarts. Search and
  labels both read the one held store, so a tile is findable by its label for exactly as
  long as it shows it (spec).
- Client: `hover-prefetch-listings` never warms a query or a flat listing, per its own
  requirement, and results live only in view state.

What would change this: a route that writes the store at runtime. That route would have to
refresh the holder's store, and search would follow with no further work, because nothing
downstream holds names. This is recorded here so that a future writer does not add a
query-keyed cache without also invalidating it.

### D6 — Meaning and similarity answers are named like any listing

This reverses `library-overrides` D7's exclusion, by the owner's answer (2026-09-28).
`/api/semantic` and `/api/semantic/similar` call `applyDisplayNames(entries, store, {
along: true })` after `annotate`, as `/api/dir` does. The similarity route calls it on
`[anchor]` too. It runs after the answer is assembled, so the order the index returned
(*Relevance order survives*) and the scores keyed by library path are untouched.

Consequences:
- **Labels change too.** `Grid` renders `displayName` wherever it is carried, so a model
  with a stored name of its own now shows it in meaning results, as it already does in a
  browse. On the demo, stored names sit on the 444 kit folders and not on models, so
  meaning tiles look the same there. The real name stays in the title and the accessible
  name, per the existing requirement.
- The names come from the one held store, so D5's freshness argument covers them.
- `/api/semantic/poses` returns poses, not entries, so it is out of scope.
- `semantic-search`'s *Results are assembled from this app's own view of the tree* says the
  server names each meaning tile "by the resulting library-relative path". That is the
  entry's `name`, which this change leaves alone. The label rule, where a stored name
  displaces the file-derived label, is `directory-browsing`'s *Entries display their
  stored name*, which this change modifies. So `semantic-search` needs no delta for D6.

*Alternative.* Attach `ancestorNames` only, leaving labels as they are: this would make
meaning results the one listing shape where a tile's stored name is not drawn. The owner
asked for display names, and the seam is one call.

*Cost.* `overrides.store()` checks the library's state, which is one stat per meaning or
similarity request, even on a library with no store. `semantic.test.ts`'s stat-count cell
records this.

### D7 — Name mode always searches names

`submitSearch` loses its name → meaning branch, and `looksLikeDescription` is deleted from
`searchOptions.ts` along with its tests. The results-line note "Searched by meaning — “…”
reads like a description" goes with it. `autoMode` then only ever holds `mode: "name"`,
and the implementer may narrow its type to match.

Why: the premise was "no file is named in sentences", and it held only while a space
could never match a name. Under D1, a phrase is terms, so `young bronze dragon` finds the
ten models. A phrase that finds nothing lands on *An empty search offers a way onward*,
which already offers "Search by meaning instead" where meaning can run.

**`looksLikeFileName` stays**, and does not rest on the dropped premise. Its reason is
that meaning search matches nothing a file name names, which is a fact about the
embedding and not about name matching. The one comment that leans on the old pairing is
`autoMode`'s ("a file name to the names, a description to meaning"), and it is rewritten.

Other specs checked for the dropped route:
- `url-navigation`'s *The URL names the corpus a search actually ran against* cites "a
  query routed by its shape" with a file-name scenario only, and stays true.
- `file-search`'s *Leaving a search puts the profile's own options back* has routed
  scenarios that are all file-name routes, and stays true.
- `visitor-intro`'s meaning-by-default is a starting mode, not a route.
- `semantic-search`'s *Meaning search is a mode of the search input* says "save that a
  query whose shape plainly belongs to the other corpus is asked of that corpus instead",
  which still holds for file names. Its *Name search still answers the input's submit*
  scenario stays true.

The only text that required the description route is the one requirement this change
modifies. No active change's delta touches it: `search-cancellation`'s delta is
`directory-browsing` only, and `pose-layer-removal`'s `semantic-search` delta modifies *The
index's orientations reach every listing*.

### D8 — Words that say "display only" are corrected where they stand

These say matching reads `entry.name` only, which is no longer true:

- `DirEntry.displayName`'s doc comment in `shared/types.ts`.
- `Grid`'s tile-label comment ("every matcher still read `entry.name`").
- The `applyDisplayNames` doc comment, where it explains why naming is not in
  `listing.ts`. It is still not for labels, but matching now reads the store in there.
- `/api/dir`'s "Names ride the listing rather than a lookup per tile (library-overrides
  D7)". Names now ride the meaning and similarity answers too (D6), so the comment moves
  to, or is echoed at, the seam every route shares. (The semantic routes' own "(D7)"
  citations are `semantic-search`'s D7, not this one, and stay.)
- `client/test/tileDisplayNames.test.tsx`'s "matching still reads the real name" block.
  This one is a test, and it inverts (task 4.2).
- `docs/web-demo-notes.md`, *Open — need Masa's call* item 1, which records "display only,
  or search by it?" as the deciding question. It gets a line saying issue #66 and this
  change made display names searchable. The store stayed a sidecar (in-memory matching,
  no sqlite index), which is the outcome that note did not foresee.

The `library-overrides` main spec needs no delta. Its requirements never say names are not
searchable. That was a non-goal in the archived change's design.md, and it was restated
normatively only in `directory-browsing` (modified here).

### D9 — The folder line shows stored folder names

The owner asked on 2026-09-28 that a model tile's folder line (`ParentLine` in `Grid.tsx`,
the path under the file name in flat, search and meaning results) show each folder's stored
name where it has one, and its real name otherwise. `DD_minis_945822/paladin.stl`, with
`/DD_minis_945822` named "D&D minis", reads "D&D minis". `kit/sub/paladin.stl` with only
`/kit` named reads "D&D minis/sub".

`ParentLine` takes the entry's `ancestorNames` beside its `name` and substitutes slot `i`
for folder segment `i` where the slot is not `null` (D3's alignment). Everything else about
the line is unchanged: inside an archive, the archive segment is still the part kept whole,
now under its stored name where it has one, and the archive icon still comes from the real
name. The tile's title and accessible name keep the real path, per `library-overrides` D7's
accessibility rule, so a reader who greps the disk still has the real names on hover and a
screen reader still announces them. Container tiles carry no `ancestorNames` (D3), so their
folder line keeps real names.

*Alternative.* Resolve names on the client from the container entries in the same listing.
Deeper folders are never entries (D3's third alternative), so this cannot name them.

## Risks / Trade-offs

- [The server does per-candidate store lookups on a 200k-step search walk] → They skip
  entirely when the store is empty, and each is a `Map.get`, one per folder below the root. Task 2.5 measures before and after on the demo corpus,
  with `/api/library`'s `top` and `id` recorded beside the numbers.
- [Short terms match nearly everything, e.g. `a dragon`] → This is no worse than today,
  where `a` alone matches the same entries. Requiring every term makes a multi-word query
  narrower, not wider, than any one of its words.
- [The name count beside a meaning search rises for phrases] → This is intended. Before,
  a phrase with spaces almost never matched a name, so the count was almost always zero.
  It now counts entries holding every word. Only the number and whether "Search names
  instead" is offered change.
- [Meaning tiles change label where a model has its own stored name] → This is intended
  (D6). It is invisible on the demo, where only kit folders are named.
- [A phrase that used to reach meaning search now finds a few name matches instead of the
  index's answer] → The results line and the empty state both offer the other corpus. A
  profile that wants meaning keeps meaning mode, and the file-name route still sends file
  names out of it.
- [Shared files with `pose-layer-removal`] → Its tasks edit how poses ride semantic
  answers, not their naming. D6's single call sits after `annotate` in the two semantic
  routes, which that change also touches, so whichever lands second re-reads them.
- [Shared files with active changes] → `search-cancellation` rewrites the traversal side of
  `walkFlat` and keys its in-flight registry on `walkFlat`'s inputs "not by the query". The
  store passed here is applied after the gather, exactly like the query, so it must be
  left out of that key too. `entry-stat-revalidation` edits `listing.ts`
  (`revalidateTree`, `FlatWalk`) and `app.ts` (`/api/models`, `/api/reload`), which are
  different symbols. No ordering is required. Whichever lands second re-reads `walkFlat`
  and `/api/dir` (tasks.md 0.1).

## Migration Plan

None. There is no stored format, configuration or URL parameter to migrate. A committed
search URL (`q=`) keeps its text and is read by the new rule. A single-term query over a
library without a store returns exactly what it did before. An old URL for a phrase that
was rerouted to meaning names `mode=meaning`, because the URL records the corpus a search
ran against, so it still reproduces the meaning results. Rollback is a revert.

## Open Questions

None. The owner answered the proposal's three (2026-09-28). Containers under Narrow match
their own names only (D4). Meaning and similarity answers are named (D6). Name mode always
searches names (D7).
