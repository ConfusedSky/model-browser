# Design — search-matches-folder-names

## Context

`listFlat` (server/src/listing.ts) walks a root, accumulating every model beneath it into `walk.models` with `name` set to the root-relative path (`walkFsLevel:174`, `${rel}${e.name}`; inside archives `${rel}${zipName}!/${entryPath}`). Directories are traversed but never recorded — `FlatWalk` holds `models` and nothing else (`:24-31`) — so the only containers a listing ever returns are the root's own immediate children, collected separately before the walk (`listFlat:305-318`).

A query filters both: containers by `matchesQuery(e.name, q)`, models by `matchesQuery(m.name, q)`, where `matchesQuery` (`:143`) is `baseName(name).toLowerCase().includes(q)`. Because containers at the root are named bare (`Sandy Dunes`) while models are named by path (`Sandy Dunes/hero.stl`), that one predicate reads the folder's name in the first case and discards it in the second — the depth-dependent behavior the proposal describes. Results then sort by base name with the relative path as tiebreak (`:333-338`), and the model cap applies last (`:339-342`).

The recent `filter-before-sort` change (commit `2086f27`) means filtering already happens before both the sort and the cap, so widening the predicate changes what is sorted and capped without reordering those stages.

## Goals / Non-Goals

**Goals:**
- One matching rule across the filter and deep search, so the same typed text means the same thing before and after Enter.
- A folder search answers with the folder *and* with what is in it, at any depth.
- Bounds stay honest: widening the predicate must not let folders crowd models out of the result cap, and truncation keeps being reported.

**Non-Goals:**
- Fuzzy, token, or multi-term matching: this stays a single case-insensitive substring. Splitting the query into terms is a separate question with its own ranking problem.
- Content, tag, or metadata search.
- Changing the live filter, the walk budget, zip descent rules, the visited-set, or the `/api/dir` contract.
- Ranking results by match quality — order stays deterministic and positional (D3).

## Decisions

### D1: The haystack is the root-relative name, not its base name

`matchesQuery` drops `baseName`: `name.toLowerCase().includes(q)`. Every accumulated name is already root-relative, so this is exactly "the query appears anywhere in the path below the search root" — file name, any containing folder, or an archive's interior directories. Two consequences worth stating rather than discovering:

- **A zip's own name matches everything inside it.** `kit.zip!/arms/left.stl` contains `kit`, so searching `kit` returns the archive's whole contents. That is consistent — a zip *is* a container, and the user asking for `kit` is asking for what is in it — but it means archives behave like folders now, where before they were invisible to a query unless a file inside matched.
- **The search root itself never matches.** Names are relative to the root, so its own name is not in them. Searching `Sandy Dunes` from inside `Sandy Dunes` matches only what is beneath — no self-match, no everything-matches.

*Alternative — match the folder portion only when the file name does not match:* would preserve today's results as a subset and let the two kinds be labeled differently, but it needs two predicates and a reason to prefer one, and the user cannot see which rule fired. Rejected as machinery without a user-visible payoff.

*Alternative — leave the predicate and teach the client to search names it already has:* only works for entries already in the listing, which for a deep search is the thing being computed. Not viable.

### D2: Matching directories are results, collected during the walk

`FlatWalk` gains `dirs: DirEntry[]`. `walkFsLevel` already descends every directory (`:175-185`) and `walkZip` already synthesizes each level's directory names; **every** descended directory is pushed with `name` set to its root-relative path, exactly as models are, and `kind: 'dir'` (or `'zip'`). The query is applied afterwards in `listFlat`, beside the existing model and container filters. The root's immediate containers keep their existing bare-name collection and filter, so a match one level down and a match at the root now differ only in how they are labeled, not in whether they appear.

**The walk gathers; the query filters. This is an invariant, not an implementation detail.** Today it holds by construction — `matchesQuery` appears only in `listFlat` (`:338-339`), never inside `walkFsLevel` or `walkZip`, so a walk's output depends on the root and nothing else. Collecting directories *conditionally on the query* would be the first thing to break it, and it would break quietly: the code would work, and three other changes built on top of it would not. `search-cancellation` shares one traversal between requests carrying different queries; `listing-tree-cache` snapshots the tree keyed by root with the query deliberately absent from the key; `search-options` adds a further predicate on the same footing. All three are unsound the moment the walk's output varies with `q`. So the filter goes after the walk, and the cost is an in-memory array bounded by tree size — the same bound `walk.models` already carries.

The one respect in which the walk *does* vary with the query is the step budget (`:301`, search 200k vs browse 20k), so a browse walk can truncate where a search walk would not. That is not a key component either — it means a truncated walk simply is not a reusable snapshot. Only a walk that ran to completion may be cached or shared.

**The root's own children are excluded from the walk's collection**, or they come back twice. `listFlat` hands the root's entries to both paths — `containers = level.filter(e => e.kind !== 'model')` and `walkFsLevel(level, '', walk)` — and at `rel === ''` a pushed directory's name is its bare name, byte-identical to the container the first path already produced: two tiles, one folder, same name and same `path`. The push is therefore guarded on `rel !== ''`, and `walkZip`'s equivalent likewise skips the level whose directories the root's container collection already returned. The root level belongs to the containers path, everything below it to the walk; the two lists then concatenate with no dedup pass and no set to maintain.

The predicate for a directory is its own name, not its path: a folder inside a matching folder is not itself a match, or one hit would return an entire subtree of tiles. Its models still come back via D1, which is the useful half. Note this makes the post-walk filters deliberately asymmetric — models match on their whole relative path (D1), directories on their base name only — so the directory filter takes the basename explicitly rather than reusing the model predicate.

Client-side this needs nothing new: deep-search results have always been able to hold containers (the root's own), `Grid` renders `dir`/`zip` tiles by kind, and a `dir` tile's `path` is what navigation already consumes.

*Alternative — synthesize folder tiles on the client from the returned model paths:* no server change, but it can only surface folders that happen to contain a matching model, which is precisely the folder-with-no-matching-filenames case this change exists for.

### D2a: Corrections found while implementing

Three, recorded because the text above is wrong about the source and a reader
comparing it to the code would otherwise assume the code drifted.

**`walkZip` does not "synthesize each level's directory names".** It synthesizes the
immediate children of the level being listed, and nothing deeper. Collecting only those
would leave a folder three levels inside an archive unmatchable while an identical
filesystem folder matched — the depth-dependence this change exists to remove, and
contrary to the delta's "every directory and archive under the root". It now collects
every interior directory path.

**The dedup guard cannot be `root` alone** (task 1.2a). A zip root's containers are its
*immediate* children only, so guarding on `root` drops every deeper interior directory,
which nothing else returns. The guard is `!root || d.includes('/')`.

**The visited set does not decide which names exist.** A directory reached through a
symlink alias was skipped before its tile was pushed, which made the aliased name
unfindable — and, when the alias sorted first, made the *real* folder's name unfindable
while the alias stood in for it. The push moved ahead of the visited check: that set
bounds the traversal, and the spec's rule is every directory under the root whose own
name matches.

### D3: A queried listing orders by relative path; a plain browse keeps base-name order

Flat browse sorts by base name so same-named parts from different sets sit together (`flat-folder-view` D2) — that is right when the grid is the whole library. It is wrong for a folder search: `Sandy Dunes/base.stl` and `Sandy Dunes/body.stl` would scatter among every other `base.stl` and `body.stl` in the tree, and the results would read as unordered because the sort key is the one part of the name the user did not type. A queried listing therefore sorts by relative path, which keeps each folder's contents contiguous — every part under `Sandy Dunes/` together, in path order.

Folder tiles do not interleave with those contents. The response is assembled containers-first (`entries: [...containers, ...models]`), which is the flat view's existing convention and worth keeping: enterable tiles read as a group ahead of the models, and `sortEntries` ranks kinds that way everywhere else. So the rule is **per block**, not one merged sequence.

Inside the container block the existing kind rank survives: directories, then archives, and only then relative path as the tiebreak. Taking that rank from `sortEntries` (`dir: 0, zip: 1, model: 2`) is what containers already get today — `listFsDir` returns its output ranked, and `listFlat` never re-sorts it — so dropping it for queried listings would interleave `Beta.zip` between `Alpha/` and `Gamma/` on one surface and nowhere else. Keeping it also removes the tension in the paragraph above: the block leads *because* kinds are ranked, so ranking inside it is the same rule, not a second one. The block is heterogeneous now (the root's children carry bare names, deeper matches carry relative paths), which the relative-path tiebreak handles without a special case: a bare name *is* its own root-relative path.

The model comparator gains one branch on `hasQuery`, beside the existing comment explaining why it is not `sortEntries`. The containers need something genuinely new: `listFlat` sorts `walk.models` and nothing else today, because its containers arrive pre-ranked from `listFsDir` and are never touched again. Appending deeper matches to that block makes it unsorted, so a queried listing has to sort it explicitly — a second call site, not a branch in the first.

### D4: Folders get their own bound, ahead of the model cap

Matched directories are capped separately (`MODEL_BROWSER_FOLDER_CAP`, default 50) rather than sharing `MODEL_BROWSER_FLAT_CAP` (500). Sharing would let a fragment matching many folders consume the budget for models, and the two are not interchangeable: 50 folders is already more than a person scans, while 500 models is a working result set. Either bound dropping entries sets `truncated`.

The `empty + truncated` honesty rule (`file-name-search` D5) keeps working unchanged, but
the notice itself did **not**: it read "Showing N models; some were omitted", which was
true only while `truncated` implied models were dropped. With a separate container bound
it can fire when every matching model was returned — measured on the real library, the
query `unsupported` returns 446 models against a cap of 500 with the folder bound full —
so the notice now counts both kinds and says *entries* were omitted.

## Risks / Trade-offs

- [Existing searches return more, and hit the cap sooner] → intended, and reported: the truncation notice already states that models were omitted. The larger reach is the point; the search budget (`MODEL_BROWSER_SEARCH_BUDGET`, 200k) was raised for exactly this kind of query.
- [A short fragment now matches enormous subtrees — `a` matches nearly every path] → the cap bounds the response and truncation says so. Not new in kind: a short fragment already matched broadly on file names; it now matches more. If it proves annoying, a minimum query length is a one-line follow-up, not a design commitment here.
- [Matching a zip's name pulls its whole contents] → accepted and documented in D1; it is the same rule as folders, and treating archives as opaque would be the inconsistent choice.
- [The archived `file-search` spec's filter requirement asserts the asymmetry being removed] → its clause about folder fragments matching "even though deep search itself matches file names only" is rewritten in the same delta; leaving it would archive a self-contradicting spec.
- [Two result orders in one function] → confined to one comparator selected by `hasQuery`, with the reason recorded where the existing ordering comment already is; the alternative (one order) makes one of the two use cases read as random.
