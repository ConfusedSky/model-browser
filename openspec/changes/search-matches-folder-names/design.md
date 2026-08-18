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

`FlatWalk` gains `dirs: DirEntry[]`. `walkFsLevel` already descends every directory (`:175-185`) and `walkZip` already synthesizes each level's directory names; a directory whose **own name** matches the query is pushed with `name` set to its root-relative path, exactly as models are, and `kind: 'dir'` (or `'zip'`). The root's immediate containers keep their existing bare-name collection and filter, so a match one level down and a match at the root now differ only in how they are labeled, not in whether they appear.

The predicate for a directory is its own name, not its path: a folder inside a matching folder is not itself a match, or one hit would return an entire subtree of tiles. Its models still come back via D1, which is the useful half.

Client-side this needs nothing new: deep-search results have always been able to hold containers (the root's own), `Grid` renders `dir`/`zip` tiles by kind, and a `dir` tile's `path` is what navigation already consumes.

*Alternative — synthesize folder tiles on the client from the returned model paths:* no server change, but it can only surface folders that happen to contain a matching model, which is precisely the folder-with-no-matching-filenames case this change exists for.

### D3: A queried listing orders by relative path; a plain browse keeps base-name order

Flat browse sorts by base name so same-named parts from different sets sit together (`flat-folder-view` D2) — that is right when the grid is the whole library. It is wrong for a folder search: `Sandy Dunes/base.stl` and `Sandy Dunes/body.stl` would scatter among every other `base.stl` and `body.stl` in the tree, and the results would read as unordered because the sort key is the one part of the name the user did not type. A queried listing therefore sorts by relative path, which keeps each folder's contents contiguous and puts the folders' own tiles next to their contents' prefix.

The two orders live in the same comparator, selected by `hasQuery` — one branch, next to the existing comment explaining why it is not `sortEntries`.

### D4: Folders get their own bound, ahead of the model cap

Matched directories are capped separately (`MODEL_BROWSER_FOLDER_CAP`, default 50) rather than sharing `MODEL_BROWSER_FLAT_CAP` (500). Sharing would let a fragment matching many folders consume the budget for models, and the two are not interchangeable: 50 folders is already more than a person scans, while 500 models is a working result set. Either bound dropping entries sets `truncated`, so the existing notice and the `empty + truncated` honesty rule (`file-name-search` D5) keep working unchanged.

## Risks / Trade-offs

- [Existing searches return more, and hit the cap sooner] → intended, and reported: the truncation notice already states that models were omitted. The larger reach is the point; the search budget (`MODEL_BROWSER_SEARCH_BUDGET`, 200k) was raised for exactly this kind of query.
- [A short fragment now matches enormous subtrees — `a` matches nearly every path] → the cap bounds the response and truncation says so. Not new in kind: a short fragment already matched broadly on file names; it now matches more. If it proves annoying, a minimum query length is a one-line follow-up, not a design commitment here.
- [Matching a zip's name pulls its whole contents] → accepted and documented in D1; it is the same rule as folders, and treating archives as opaque would be the inconsistent choice.
- [The archived `file-search` spec's filter requirement asserts the asymmetry being removed] → its clause about folder fragments matching "even though deep search itself matches file names only" is rewritten in the same delta; leaving it would archive a self-contradicting spec.
- [Two result orders in one function] → confined to one comparator selected by `hasQuery`, with the reason recorded where the existing ordering comment already is; the alternative (one order) makes one of the two use cases read as random.
