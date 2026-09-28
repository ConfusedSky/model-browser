# Tasks — multi-term-name-search

> Written against `main` at `ff4063f`. Parallel sessions edit this tree. Re-read every file
> named here, and run `git status`, before editing.
>
> **Shared files, no hard ordering.** `search-cancellation` rewrites `walkFlat`'s traversal
> side and adds an in-flight registry keyed on `walkFlat`'s inputs "not by the query".
> `entry-stat-revalidation` edits `listing.ts` (`revalidateTree`, `FlatWalk`, the archive
> write-back) and `app.ts` (`/api/models`, `/api/reload`). Neither touches `walkFlat`'s
> filter step, `matchesQuery`/`matchesOwnName`, `/api/dir`'s naming pass or `App`'s Narrow
> filter. Whichever lands second re-reads those symbols (0.1). No active change has a
> `file-search` delta, and none modifies *Entries display their stored name* or
> `semantic-search`'s *A query that plainly belongs to the other corpus…*.
> `pose-layer-removal` edits the two semantic routes in `app.ts` near `annotate`, where 2.6
> adds a naming call, and its `semantic-search` delta modifies a different requirement.
> `hover-prefetch-listings`, `per-library-recents` and `adaptive-ao-default` edit `App.tsx`
> elsewhere (the fetch effect's `land`, the AO pill), not `submitSearch` or the Narrow filter.

## 0. Before starting

- [x] 0.1 Re-read `walkFlat`, `ListingCache.list`, `/api/dir`, `/api/semantic` and
      `/api/semantic/similar` in `app.ts`, `hitsToEntries`, `applyDisplayNames`, and `App`'s
      `needle`/`filteredListing`/`submitSearch` against current `main`. If `search-cancellation`
      has landed, confirm its registry key leaves out `opts.names` exactly as it leaves out the
      query (design D2, Risks). Done when the symbols cited in design.md all still exist under
      those names. Otherwise, update design.md first.

## 1. The shared matcher

- [x] 1.1 `shared/nameMatch.ts`: `queryTerms` and `matchesTerms` per design D1, including the
      subject-by-kind table. Pure, no imports beyond `shared/names` and `shared/types`.
      Verified by 1.2.
- [x] 1.2 `client/test/nameMatch.test.ts` (beside `frames.test.ts`, which also tests a
      `shared/` module). Include these cells:
      - `queryTerms`: `"  Young   Bronze "` → `["young","bronze"]`; `""` and `"  \t "` →
        `[]`; `"young_bronze"` → one term; `"D&D"` survives intact.
      - `Young Bronze` and `Bronze Young` both match model `Bronze_Dragon_2832574/Young_Bronze_Dragon.stl`.
      - `young_bronze` matches `Young_Bronze_Dragon.stl` and not `Young-Bronze.stl`.
      - `bronze paladin` matches neither `Bronze_Dragon/x.stl` nor `minis/paladin.stl`
        (every term must match).
      - Split across names: `d&d paladin` matches `{name:"DD_minis_945822/paladin.stl",
        ancestorNames:["D&D minis"]}`, and the same subject without `ancestorNames` does
        not.
      - Own display name: a dir `{name:"a/DD_minis_945822", displayName:"D&D minis"}`
        matches `d&d minis`.
      - Container own-name only: dir `Kit/bases` with no stored name does **not** match
        `kit bases` when only its path holds "kit". The same query matches model
        `Kit/bases/round.stl`.
      - Folder matching off: `d&d paladin` does not match the split-across-names subject,
        and `paladin` still does.
      - A term never spans two names: `minis/pal` does not match on `ancestorNames:["D&D
        minis"]` plus a file name `paladin.stl` whose path is `x/paladin.stl`.
      Falsify it: break the "every" into "some" and see the every-term cells go red; match
      the joined query instead of each term and see the order cell go red; restore both.

## 2. Server: match with the store in hand

- [x] 2.1 `server/src/overrides.ts`: `namesBelow(store, prefix, path)`, with design D2's one
      contract. `prefix` is `path.slice(0, -name.length)`, ending in `/` or `!/`. It returns
      (as one slot each, `null` where unnamed, since 4a.1) the stored `name`s of
      `ancestorKeys(path)`'s keys that start with `prefix`, are
      longer than it, and are not `path`, outermost first. It returns `[]` at once on an
      empty store. Add these `overrides.test.ts` cells:
      - Filesystem: prefix `/`, path `/kit/sub/y.stl` → the names of `/kit` and `/kit/sub`.
        Key `/` is never included.
      - Zip interior below a filesystem root: prefix `/`, path `/kit/a.zip!/parts/x.stl` →
        the names of `/kit`, `/kit/a.zip`, `/kit/a.zip!/parts`, whichever are stored.
      - Zip root: prefix `/kit/a.zip!/`, path `/kit/a.zip!/parts/x.stl`, store naming
        `/kit/a.zip` and `/kit/a.zip!/parts` → only `/kit/a.zip!/parts`'s name. The root
        archive's own name is excluded.
- [x] 2.2 `server/src/listing.ts`: `walkFlat`'s `opts` gains `names?: OverrideStore`, and
      `ListingCache.list` passes `opts` through unchanged. Replace `matchesQuery` and
      `matchesOwnName` with `matchesTerms` over subjects built **eagerly** per design D2, with
      `prefix = e.path.slice(0, -e.name.length)`. The only shortcut is `namesBelow`'s
      empty-store return. **Never write** `displayName`
      or `ancestorNames` onto gathered entries. `queryTerms(query)` replaces the
      `q = query?.trim().toLowerCase()` line, and `hasQuery` becomes "has terms". Keep
      `flat.test.ts`'s "the walk collects without consulting the query" source assertion
      meaningful: update its regex to the new symbol names (e.g. `matchesTerms`,
      `queryTerms`), and confirm it still fails if a match call is pasted into
      `walkFsLevel`.
- [x] 2.3 `server/src/app.ts` `/api/dir`: flat branch passes `names: await overrides.store()`
      into `listings.list` (one await, reused for the naming pass). `applyDisplayNames`
      gains an option (`{ along: true }` or similar) that also gives model entries
      `ancestorNames`: the stored names of the folders their `name` passes through (design
      D3), when non-empty and only when `entry.path.endsWith(entry.name)`. Otherwise it leaves
      the field off (a meaning hit's raw `rel_path` can be un-normalised). The flat branch
      passes it. The nested branch, `/api/peek` and
      `/api/models` do not. Add
      `ancestorNames` to `DirEntry` in `shared/types.ts`, with a doc comment that says what
      it is and that it is never a tile's label (its shape and the folder line: 4a.1, D9).
- [x] 2.4 Server listing tests with an override store (`server/test/overrides.test.ts`,
      the `NAMES` fixture's `describe`, or a new one beside it using `storeAt`/`appOn`).
      Include these cells:
      - `/api/dir?path=/&flat=true&q=<a word only in /kit's stored name> x` returns
        `/kit/x.stl` (split across names), and `/kit` itself as a tile (own stored name).
      - Container own-name only: `/kit/sub` (stored "Sub Assemblies") is returned for
        `assemblies`, and is **not** returned for a query whose one word appears only in
        `/kit`'s stored name, while models under it are.
      - Root exclusion: the same stored-name word from `path=/kit` returns nothing on the
        strength of `/kit`'s name.
      - `folders=false`: the split-across-names query no longer returns `/kit/x.stl`.
      - The cap bounds matches that come only through stored names: set
        `MODEL_BROWSER_FLAT_CAP` low and assert `truncated`.
      - `ancestorNames` on a plain flat listing: `/kit/sub/y.stl` carries
        `["Player Character Pack 03","Sub Assemblies"]`, and `displayName` is still
        undefined (exact key). A nested `/api/dir?path=/kit` carries no `ancestorNames`.
      - No store: flat listing JSON has no `ancestorNames` key anywhere (byte-identical
        rule).
      - Snapshot not polluted: serve a queried flat listing through a `SnapshotStore`, then
        read the stored snapshot, and it holds no `displayName`/`ancestorNames`. Then an
        unqueried request carries only the names its own pass attached.
      - Zip root, with the store naming `/kit/a.zip!/parts` (e.g. "Loose Parts", as
        `NAMES` already does; `fixtureLibrary`'s archive holds `parts/lid.stl`): a deep
        search from `path=/kit/a.zip` for `loose` returns `parts/lid.stl`, and not
        `box.stl`. A plain flat listing of `/kit/a.zip` carries `["Loose Parts"]` in that
        entry's `ancestorNames`, and nothing from `/kit/a.zip`'s own name.
      - The existing "labels a named entry in a deep-search listing" cell: its comment
        "Matching is untouched" is now false. Reword it to say the query matched the real
        name, as it still does.
      Falsify each new cell by removing the store from `walkFlat`'s call, and see the
      split-across-names and own-stored-name cells go red.
- [x] 2.5 Measure search cost on the demo corpus before and after (task 2.2 reverted versus
      applied). Use `/api/dir?path=/&flat=true&q=…` for `young`, `Young Bronze`, and `D&D
      paladin`, 5 runs each, warm snapshot, under `bun`. Record `/api/library`'s `top` and
      `id` and the root's folder count beside the timings in this change's design.md, D2
      *Cost*. Replace the "read from the code, not measured" line with the figures.

- [x] 2.6 `server/src/app.ts` `/api/semantic` and `/api/semantic/similar`: after `annotate`,
      call `applyDisplayNames(entries, await overrides.store(), { along: true })`, and on
      `[anchor]` in the similarity route (design D6). Rewrite `/api/dir`'s comment "Names ride
      the listing rather than a lookup per tile (library-overrides D7)" so it no longer
      reads as listing-only (design D8). The semantic routes' own "(D7)" citations are
      `semantic-search`'s and stay.
- [x] 2.7 Server tests for 2.6 (`server/test/semantic.test.ts` and `similar.test.ts` stub the
      index; follow their setup and add a store with `storeAt`). Include these cells:
      - A hit under `/kit` whose own path has a stored name carries it as `displayName`,
        and `ancestorNames` holds `/kit`'s stored name.
      - The response order and the `scores` keys are identical with and without the store.
      - A scoped query (`path` a subfolder of the collection) still measures
        `ancestorNames` from the collection root: the entry's `name` is collection-relative,
        so the scope folder's stored name is included.
      - The similarity `anchor` is named.
      - No store: byte-identical JSON to before.
      - A stubbed hit with `rel_path` `./kit/x.stl` is still returned, and carries no
        `ancestorNames` (the `endsWith` guard).
      Falsify it by dropping the 2.6 call and see the named cells go red.

## 3. Client: the Narrow filter uses the same matcher

- [x] 3.1 `client/src/App.tsx`: `needle` becomes `terms = queryTerms(findText)`, and
      `filteredListing` keeps `matchesTerms(terms, e, true)`. The "hides everything"
      check (`needle !== ""`) becomes `terms.length > 0`. Rewrite the comment above
      `needle`: it matches by the shared rule, containers by own names (design D4).
- [x] 3.2 `client/src/components/Grid.tsx`: the tile-label comment ("every matcher still
      read `entry.name` (D7)") says the stored name is also matched (`file-search`, *Names
      match term by term*). Update `DirEntry.displayName`'s comment in `shared/types.ts`
      and `applyDisplayNames`'s in `overrides.ts` to match (design D8).

- [x] 3.3 Drop the name → meaning route (design D7). In `client/src/App.tsx`, remove
      `submitSearch`'s `looksLikeDescription` branch and the results-line note "Searched by
      meaning — … reads like a description" (`autoMode`'s meaning case). Rewrite `autoMode`'s
      doc comment; narrowing its type to the name route alone is optional. In
      `client/src/lib/searchOptions.ts`, delete `looksLikeDescription`. Keep
      `looksLikeFileName` and its route unchanged. Verified by 4.3, and by
      `grep -rn looksLikeDescription client/src` finding nothing.

## 4. Client tests

- [x] 4.1 Client filter cells, in `client/test/fileNameSearch.test.tsx` or beside the
      existing Narrow cells (find them with `grep -n openFind client/test/*.tsx`). Include
      these cells:
      - `bronze young` keeps `Young_Bronze_Dragon.stl` and drops a sibling without both
        words.
      - A flat listing whose model carries `ancestorNames:["D&D minis"]` survives `d&d
        paladin`.
      - Over deep-search results for `D&D paladin` (mocked listing with `ancestorNames`),
        typing the same text keeps every tile.
      - Container own-name: over deep-search results holding dir `Kit/bases`, typing
        `kit` hides that tile and keeps models under `Kit/` (design D4, the owner's
        2026-09-28 answer).
      - Whitespace-only still filters nothing, and the "filter hides everything" message
        still shows for a two-term miss.
      - No listing requests are issued while typing (the *Filtering is free of requests*
        assertion, re-run with a multi-term query).
- [x] 4.2 `client/test/tileDisplayNames.test.tsx`: invert the "matching still reads the real
      name" block. `character pack` (spaced, only in the stored title) now keeps the kit,
      and `3750572` still does. Rename the `describe` and rewrite its "Display only" comment.
      Falsify it by reverting 3.1 and see it go red.
- [x] 4.3 Routing tests. `client/test/semanticSearch.test.tsx`'s "a description asked of the
      names" block now asserts the opposite, and its `describe` is renamed: under name mode
      with the index ready, `a stone golem` calls `listDir` with `q` and never
      `semanticSearch`, and no "reads like a description" text appears. Add a cell: a
      phrase that matches nothing shows the empty state's "Search by meaning instead", and
      pressing it runs `semanticSearch` without storing meaning as the profile's mode.
      Delete `client/test/designPassHelpers.test.ts`'s `looksLikeDescription` block, and
      keep its `looksLikeFileName` block. Confirm the file-name route cells ("a file name
      asked of the names…") are untouched and green. Falsify it by restoring the branch in
      3.3 and see the renamed cell go red.
- [x] 4.4 Narrow over meaning results: a mocked `semanticSearch` answer whose entry carries
      `ancestorNames:["D&D minis"]` survives typing `d&d` into the find control, and an entry
      without it does not. Also, a mocked meaning entry with a `displayName` is labelled
      with it.

## 4a. The folder line shows stored folder names (owner, 2026-09-28)

- [x] 4a.1 `ancestorNames` becomes per-folder slots (design D3): `(string | null)[]` in
      `shared/types.ts` with its doc comment, `namesBelow` answers one slot per folder below
      `prefix` (`null` where unnamed), `applyDisplayNames` attaches the field only when some
      slot is not `null`, and `matchesTerms` skips `null` slots. `walkFlat`'s subject passes
      the slots through unchanged.
- [x] 4a.2 Server cells: `namesBelow` keeps a `null` slot for an unnamed level (archive
      interior with only the archive named → `[null, "Archive", null]`; `/kit/sub/y.stl`
      with only `/kit` named → `["Kit", null]`). On `/api/dir?path=/&flat=true` with only
      `/kit` named, `/kit/sub/y.stl` carries `[name, null]`, `/kit/a.zip!/parts/lid.stl`
      carries `[name, null, null]`, and `/kit2/y.stl` carries no field. With every level
      named, the zip interior carries all three names in order. Falsify by dropping the
      `null` slots from `namesBelow`.
- [x] 4a.3 `Grid.tsx` `ParentLine` substitutes each non-null slot for its folder segment
      (design D9); the archive segment keeps its whole-name treatment under the stored name.
      Title and aria-label keep the real path.
- [x] 4a.4 `client/test/tileDisplayNames.test.tsx`: the folder line of
      `DD_minis_945822/paladin.stl` with `["D&D minis"]` reads "D&D minis" while title and
      aria-label stay the real path; `kit/sub/paladin.stl` with `["D&D minis", null]` reads
      "D&D minis/sub"; `kit/a.zip!/inner/b.stl` with `[null, "Archive Box", null]` reads
      "kit/Archive Box › inner". `nameMatch.test.ts`: `null` slots are skipped. Falsify by
      reverting `ParentLine`'s substitution.

## 5. Docs and specs

- [x] 5.1 `docs/web-demo-notes.md`, *Open — need Masa's call* item 1: add one line saying
      display names became searchable (issue #66, this change) while the store stayed a
      sidecar matched in memory (design D8).
- [x] 5.2 `grep -rn "display only\|every matcher" client/src server/src shared` finds no
      claim that matching ignores stored names. `bunx vitest run` in both workspaces, and
      `bun run typecheck`, are green. `bun run format:check` is clean.
- [ ] 5.3 `openspec validate multi-term-name-search` is clean. Before archiving, dry-run it
      in a temp copy (the repo CLAUDE.md procedure). Afterwards, check
      `openspec/specs/file-search/spec.md`, `openspec/specs/directory-browsing/spec.md` and
      `openspec/specs/semantic-search/spec.md` for anything change-scoped that landed verbatim.

## 6. Browser verification (demo corpus)

Run `bun run dev:demo` (root `~/Documents/tests/test-models/miniatures/decimated`, library
`70b60f0d`). Browse 5173 headless, **name mode**, from the library's top unless stated. For
each check, record the result count and `/api/library`'s `top`/`id` in the task line.

- [x] 6.1 Terms in any order: `Young Bronze` and `Bronze Young` each return the ten
      `Bronze_Dragon_2832574/Young_Bronze_Dragon…` models (the issue's table had 0).
      `Young_Bronze` still returns 10.
      **Verified 2026-09-28** (top `/`, id `70b60f0d`; headless, 5173, name mode): `Young
      Bronze`, `Bronze Young` and `Young_Bronze` each 10 on the wire and 10 tiles, all
      `Bronze_Dragon_2832574/Young_Bronze_Dragon*`, each carrying `ancestorNames:["Bronze
      Dragon"]`.
- [x] 6.2 Separators literal: `young_bronze` returns the same 10, and `young-bronze` returns
      none.
      **Verified 2026-09-28** (top `/`, id `70b60f0d`): `young_bronze` 10 (same paths as
      6.1); `young-bronze` 0 on the wire, empty state "Nothing matched" with "Search by
      meaning instead".
- [x] 6.3 Real name across words: `Bronze Dragon` returns the `Bronze_Dragon_2832574` folder
      tile and its models (the issue's table had 0).
      **Verified 2026-09-28** (top `/`, id `70b60f0d`): 59 on the wire and 59 tiles, the dir
      `Bronze_Dragon_2832574` (displayName "Bronze Dragon") plus 58 models under it.
- [x] 6.4 Stored display name: `D&D minis` returns the `DD_minis_945822` folder tile. Its
      stored name is "D&D minis", and its real name holds no "&".
      **Verified 2026-09-28** (top `/`, id `70b60f0d`): 16, the dir `DD_minis_945822` (tile
      label "D&D minis", title the real name) plus its 15 models, each with
      `ancestorNames:["D&D minis"]`.
- [x] 6.5 Split across names: `D&D paladin` returns exactly one model,
      `DD_minis_945822/paladin.stl`. The other paladins sit under kits whose names hold no
      "d&d", as `overrides.json` showed on 2026-09-28. With
      the folder-matching option off, the same query returns nothing.
      **Verified 2026-09-28** (top `/`, id `70b60f0d`): 1 on the wire and 1 tile,
      `DD_minis_945822/paladin.stl` (`ancestorNames:["D&D minis"]`). Options → *Match folder
      names* off re-ran as `folders=false`: 0, "Nothing matched"; on again: 1.
- [x] 6.6 Container own-name only: in the `D&D paladin` results, no folder tile appears
      unless its own names hold both words.
      **Verified 2026-09-28** (top `/`, id `70b60f0d`): the `D&D paladin` answer holds 0 dirs
      (1 entry, a model); no folder tile in the DOM.
- [x] 6.7 Root exclusion: from inside `DD_minis_945822`, `D&D` finds nothing on that
      folder's stored name. The empty state says nothing matched in that folder.
      **Verified 2026-09-28** (id `70b60f0d`, at `?path=/DD_minis_945822`):
      `/api/dir?path=/DD_minis_945822&flat=true&q=D&D` answers 0; empty state "Nothing
      matched “D&D” in DD_minis_945822." with "Search the whole library". Control: `paladin`
      there answers `paladin.stl` with no `ancestorNames`.
- [x] 6.8 Typing equals submitting: over the `D&D paladin` results, open Narrow and type
      `D&D paladin`, and every tile stays. Over the plain flat listing of the top (capped at
      500 models, so pick one inside the cap), type `collection! acolyte` into Narrow, and
      `Cleric_Paladin_Collection_2434880/Acolyte.stl` is visible through its kit's stored
      name "Cleric / Paladin Collection! " (its `ancestorNames` on the wire).
      2026-09-28, top `/`, id `70b60f0d`: first half keeps 1 of 1; second half keeps
      `Acolyte.stl`; no request while typing. All 500 capped models carry `ancestorNames`.
- [x] 6.9 Nested browse unchanged: at the top, Narrow `d&d` keeps the kits whose stored
      names hold "D&D", and no request is made while typing.
      **Verified 2026-09-28** (top `/`, id `70b60f0d`): nested top 135 tiles → 18 after
      Narrow `d&d`, exactly the 18 kits whose `displayName` holds "D&D" in `/api/dir?path=/`
      (e.g. `DD_minis_945822` → "D&D minis"); no `/api` request while typing.
- [x] 6.10 Name mode keeps phrases: with the semantic server running (repo CLAUDE.md) and
      name mode in force, `young bronze dragon` runs as a **name** search and returns the ten
      models, with no "reads like a description" note. A phrase that matches no name (e.g.
      `a knight riding a horse`) shows the empty state with "Search by meaning instead", and
      pressing it runs the meaning search.
      **Verified 2026-09-28** (top `/`, id `70b60f0d`, index on 8077 ready): `young bronze
      dragon` sent only `/api/dir?…q=young bronze dragon`, 10 results, no "reads like a
      description". `a knight riding a horse`: `/api/dir` 0, empty state with "Search by
      meaning instead"; pressing it POSTed `/api/semantic` (8 closest matches, URL
      `mode=meaning`), and `localStorage` `model-browser:search-mode` stayed `name`.
- [x] 6.11 The file-name route still works: under meaning mode, `Young_Bronze_Dragon.stl` runs
      as a name search, with the "looks like one" note and "Search by meaning instead".
      **Verified 2026-09-28** (top `/`, id `70b60f0d`): under meaning, sent
      `/api/dir?…q=Young_Bronze_Dragon.stl`, 1 result
      (`Bronze_Dragon_2832574/Young_Bronze_Dragon.stl`), note "Searched file names — … looks
      like one. Search by meaning instead".
- [x] 6.12 Meaning results are named. Under meaning mode, search `a dragon` from the top, then
      check that the response's model entries under named kits carry `ancestorNames` (network
      response) and that the meaning order is unchanged against a run on `main`. Then open
      Narrow over those results and type a word that appears only in one kit's stored name:
      that kit's models stay. Needs the semantic server. Without it, 6.10–6.12 are skipped
      and said so in the task line.
      **Verified 2026-09-28** (top `/`, id `70b60f0d`, index on 8077): `/api/semantic` for `a
      dragon` answered 60 ("Top 60 of 237"), all 60 with `ancestorNames` (e.g. `["Bronze
      Dragon"]`). Against a `main` (`5f79233`) server on 3193 over the same root and index,
      the same POST gives an identical path order and identical score values; the only entry
      differences are the names and the `thumb`/`pose` annotations the baseline's own cold
      cache lacked. Narrow `dragons!`
      (only in "Bahamut - God of all Metallic Dragons! ") kept exactly that kit's 2 models,
      no request while typing.
- [x] 6.13 The folder line shows the stored name (design D9). Name mode, from the top,
      search `D&D paladin`: the paladin tile's `[data-tile-parent]` reads "D&D minis", and
      its title is the real path `DD_minis_945822/paladin.stl`.
      **Verified 2026-09-28** (root `/`, id `70b60f0d`; headless, 5173, name mode, URL
      `?q=D%26D+paladin&mode=name`): 1 tile; `[data-tile-parent]` "D&D minis", label
      `paladin.stl`, title and aria-label `DD_minis_945822/paladin.stl`.
