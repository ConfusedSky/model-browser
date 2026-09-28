## Why

A name search for **Young Bronze** finds nothing on the demo corpus, although ten files are
named `Young_Bronze_Dragon…`, and **Bronze Dragon** finds nothing either, although that is
the label on the folder tile (issue #66). Two rules cause it, and both are in the specs.
The query is matched as one case-insensitive substring, so a space can never match the `_`
that most of the corpus is named with. And stored display names are display only
(`library-overrides` D7, restated in `directory-browsing`'s *Entries display their stored
name*), so words a visitor reads on a tile cannot find it. The owner decided the fix on the
issue (2026-09-28), then answered this proposal's three follow-up questions the same day:
containers under Narrow, names on meaning results, and routing. This change implements both
sets of answers.

## What Changes

- **A query is a set of terms.** It is trimmed and split on whitespace. Each term is a
  case-insensitive substring test, and an entry matches only if every term matches. `_`,
  `-` and `.` inside a term are literal, so `young_bronze` is one term and matches exactly
  as it does today, and a query of one term behaves exactly as today.
- **Stored display names are searchable.** This reverses `library-overrides`' "display
  only" non-goal for search (its D7). The label rules are unchanged.
- **Terms may be split across names.** A model matches when each term appears in its real
  root-relative path or in any stored display name along that path: its own name and the
  names of its containing folders and archives below the search root. So `D&D paladin`
  finds `DD_minis_945822/paladin.stl` through the kit's stored name "D&D minis".
  A container (directory or archive) still matches on its own name only (the D2 rule),
  which now means its own real name or its own stored name.
- **One shared matcher** in `shared/`, used by the server's deep name search (replacing
  `matchesQuery` / `matchesOwnName`) and by the client's Narrow filter (replacing `App`'s
  `needle` test). The client filter adopts the server's per-kind rule, so a container in
  deep-search results is now narrowed by its own name rather than by its whole relative
  path (see design D3).
- **The server matches against the override store at match time.** `walkFlat` receives the
  loaded store and consults it before filtering. Before this change, names were attached
  only after the walk (`applyDisplayNames`, in `app.ts`).
- **Flat and deep-search model entries carry their containing folders' stored names** in a
  new optional wire field. Without it, the client's filter cannot see names along a path
  and would disagree with the search it narrows.
- **Meaning and similarity results carry names too.** Their entries get their own stored
  name, which labels the tile as it does in any listing. They also get the stored names of
  the folders their relative name passes through, in the same wire field. The Narrow filter
  over them then matches stored names like everywhere else. The meaning ranking itself is
  unchanged.
- **A model tile's folder line shows stored folder names.** The line under a result's name
  (`ParentLine`) shows each folder's stored name where it has one and its real name
  otherwise, so `DD_minis_945822/paladin.stl` reads "D&D minis". The owner asked for this
  on 2026-09-28. The title and accessible name keep the real path.
- **Name mode always searches names.** Before this change, a phrase of three or more words
  submitted under name mode was rerouted to meaning search (`looksLikeDescription`). That
  premise, "no file is named in sentences", made sense when a space could never match a
  name, and terms remove it. So the reroute is dropped. A phrase that finds nothing still
  gets "Search by meaning instead" from the empty state. The reverse route stays: a file
  name typed under meaning mode still runs as a name search (`looksLikeFileName`). It
  rests on meaning search matching nothing a file name names, which this change does not
  touch.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `file-search`: adds *Names match term by term*, which defines terms, what each entry kind
  is matched against, and how display names take part. *Live name filter* and *Deep name
  search* are modified to match by that rule instead of by a single substring.
- `directory-browsing`: *Entries display their stored name* drops "display names are
  display only" for matching, and brings meaning and similarity answers inside the naming
  seam. Flat, deep-search, meaning and similarity model entries now also carry the stored
  names of the folders their relative name passes through, which the filter matches on and
  the tile's folder line shows. Its *Matching is untouched* scenario is rewritten, and a
  scenario for the folder line is added.
- `semantic-search`: *A query that plainly belongs to the other corpus is asked of it until
  its results are left* keeps the file-name route (meaning → names) and drops the
  description route (names → meaning). Its *A description typed under Name* scenario is
  rewritten under the same title.

## Impact

- `shared/`: a new name-matching module; `DirEntry` in `shared/types.ts` gains an
  optional field, and its `displayName` doc comment stops saying search does not read it.
- `server/src/listing.ts`: `walkFlat`'s query filter, `matchesQuery`, `matchesOwnName`.
- `server/src/listingCache.ts`: `ListingCache.list` passes the store through to `walkFlat`.
- `server/src/overrides.ts`: a helper that lists the stored names along a path below a
  root, and `applyDisplayNames` attaches them to flat, meaning and similarity answers.
- `server/src/app.ts`: `/api/dir` hands the store to the listing. `/api/dir`'s flat branch,
  `/api/semantic` and `/api/semantic/similar` (its `anchor` too) ask the naming pass for
  names along paths.
- `client/src/lib/searchOptions.ts`: `looksLikeDescription` is removed.
  `client/src/App.tsx`: `submitSearch`'s name → meaning branch goes, and so does the
  "reads like a description" results-line note (`autoMode`'s meaning case).
- `client/src/App.tsx`: the Narrow filter (`needle`, `filteredListing`).
- `client/src/components/Grid.tsx`: the tile-label comment that says every matcher reads
  `entry.name`, and `ParentLine`, which substitutes stored folder names.
- Tests: `client/test/tileDisplayNames.test.tsx`'s "matching still reads the real name"
  block inverts. `client/test/semanticSearch.test.tsx`'s "a description asked of the
  names" block and `client/test/designPassHelpers.test.ts`'s `looksLikeDescription` block
  change or go. There are also new shared, server and client cells.
- The files it shares with `search-cancellation` and `entry-stat-revalidation` are
  `listing.ts` and `app.ts`, but not the same symbols. See tasks.md.
- No new dependency, no configuration, no change to the snapshot format or its key.
