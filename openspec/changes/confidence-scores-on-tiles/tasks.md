> **Ordering — hard.** `thumbnail-sweep-priority` also edits `client/src/components/Grid.tsx`,
> adding an `IntersectionObserver` over the same tiles this change decorates. The two must
> not be in flight over that file at once. Whichever lands second re-reads `Grid.tsx` against
> `main` before editing — do not plan `Tile`'s props from an earlier read. Groups 1–3 and 6
> touch neither change's shared files and may proceed regardless.
>
> Parallel sessions work this repo; re-read every file and `git status` before editing.

## 1. Carry the numbers through the join

- [x] 1.1 Add the per-result record type to `shared/types.ts` — the index's two numbers under
      the names the index uses (`score`, `z`), not the display labels. Document that it is the
      index's own value, never rescaled (D2/D4).
- [x] 1.2 Widen `hitsToEntries` (`server/src/semantic.ts`) to return a third map beside
      `entries` and `poses`, keyed by the **same resolved absolute path** it keys `poses` by,
      so a hit that stats to nothing contributes neither an entry nor a score (D1). Update its
      doc comment, which currently describes a two-part return.
- [x] 1.3 Add the optional field to `SemanticListing` and `SimilarListing` (`shared/types.ts`).
      **Correct `SimilarListing`'s doc comment** — it currently asserts "order carries
      strength, so there is nothing to say per tile either", which this change makes false.
- [x] 1.4 Forward the map from both call sites in `server/src/app.ts`: the semantic branch of
      the search route and the `/similar` route. The `/similar` response keeps carrying no
      `scope`/`weak`/`capped` — that reasoning is untouched and its comment stays.
- [x] 1.5 Server tests: `server/test/semantic.test.ts` and `server/test/similar.test.ts` each
      assert the numbers reach the response keyed by the entry's path, and that a hit whose
      file does not stat contributes neither an entry nor a score entry. Two routes, two
      tests — a route that forgets the map drops badges silently rather than erroring (design,
      Risks).

## 2. Thread it to the landed result

- [x] 2.1 `ApiClient` returns the widened shapes; confirm no new call and no raw fetch (D1 of
      the app's own architecture constraints). Extend `client/test/apiClient.test.ts` only if
      the shape needs asserting.
- [x] 2.2 Add the field to `Landed` in `client/src/state/reducer.ts` as optional residue
      beside `poses`/`weak`/`anchor`, and copy it onto `Result` in the `landing` case.
- [x] 2.3 `App` reads it off `state.result` the way it reads `poses` (its `NO_POSES`-style
      stable empty default included, so an unscored listing does not mint a new object every
      render). Pass it to `Grid` and look up the viewer's own value for `ViewerLayer`.
- [x] 2.4 Derive the provenance label from `Result.forView.subject.kind` — `k` for `query`,
      `sim` for `similar`, nothing for any other arm (D3). Put the derivation in one place
      both the tile and the panel read; two copies is how the two surfaces drift.
- [x] 2.5 Reducer test in `client/test/searchReducer.test.ts`: a landing carries the map onto
      the result, and a landing without one leaves no stale map from the previous result.

## 3. Format the numbers

- [x] 3.1 Add the formatters to `client/src/lib/format.ts` beside `formatBytes`/`formatDate` —
      cosine to 3 decimal places, z to 2 (D4). Fixed places, not significant figures: a
      trailing zero is information here.
- [x] 3.2 `client/test/format.test.ts` covers the widths, including a value that rounds up
      across the place and a negative z (a result below the collection's median has one).

## 4. Tile corners

> Re-read `Grid.tsx` against `main` first — see the ordering note above.

- [x] 4.1 Draw the two corners inside `Tile`'s existing `data-tile-content` element, which is
      already a positioned containing block: cosine top-left, z top-right, over the `<img>`
      and never composited into it (D5). Confirm `RIG_VERSION` is untouched by the diff.
- [x] 4.2 Pass per-tile values from `Grid`, not the map, matching how `marked` and `anchor`
      are passed so the memo keeps unrelated tiles out of the re-render (D6).
- [x] 4.3 Render nothing when the entry has no record, when the tile is the similarity view's
      anchor, or when the view's subject names neither scoring route — and reserve no space in
      those cases, so an ordinary directory tile is byte-identical to what it was.
- [x] 4.4 **Style, then freeze.** Small type, corner-anchored, translucent backing legible
      over both a dark and a light model. Judge it on real fixtures at the smallest grid width
      (11rem) before checking this off — this line is not done when the code lands (design,
      Open Questions).
- [x] 4.5 Carry both numbers into the tile's `aria-label`, scales named in full — `cosine`
      and `z` in a meaning search, `similarity` and `z` in a similarity view — appending the
      way `anchor` already appends to it. `Tile` **states** its accessible name rather than
      composing it from its children, so a badge drawn inside the button is announced to
      nobody unless the label says it (D8).
- [x] 4.6 **Retire the two tests that assert the prohibition this change lifts.** Both are
      named for it: `client/test/findSimilar.test.tsx` — "shows no score, no z, and none of
      the meaning query's residue", which asserts `not.toMatch(/0\.\d\d/)` over the container
      and `not.toMatch(/\d\.\d/)` per tile — and `client/test/semanticSearch.test.tsx` — "a
      weak set is marked as a set, with no per-result score on any tile". Keep what each was
      really guarding (no `weak` label on a neighbour set, no meaning-query residue in a
      similarity view, the set-level marking) and drop only the numeric prohibition.
- [x] 4.7 **Widen the test fixtures before trusting any assertion below.** `MEANING` and
      `NEIGHBOURS` mock the wire, so while they carry no map, 4.6's assertions still pass and
      4.8's can be written to pass with badges rendering nowhere at all. A green suite is not
      evidence until a fixture carries the numbers.
- [x] 4.8 Tests in `client/test/semanticSearch.test.tsx` and `client/test/findSimilar.test.tsx`:
      a meaning result's tile shows `k` at 3 places and `z` at 2; a neighbour's shows `sim`;
      the anchor shows neither; a plain directory listing shows neither; and a scored tile's
      accessible name carries both numbers with their scales spelled out (4.5). Grep the test
      file before checking this off — a task line claiming coverage is not coverage.

## 5. Info panel rows

- [x] 5.1 Add the two rows to the `<dl>` in `client/src/viewer/ViewerLayer.tsx` carrying
      format/size/modified, under the same labels the tile uses (D7). Values arrive as a prop
      the way `pose` does; absent for a model opened from an unscored listing.
- [x] 5.2 Confirm the rows sit among the metadata, **before** the action affordances — the
      panel describes the model first and offers actions second, which is a requirement of
      `model-viewer`'s lightbox and easy to break by appending.
- [x] 5.3 Test the panel rows appear for a model opened from a meaning search and from a
      similarity view under the right label, and are absent when opened from a directory
      listing. `client/test/viewerPanelActions.test.tsx` already mounts this panel.

## 6. Close it out

- [x] 6.1 `bun run typecheck` and `bun run test` clean. Run vitest from the workspace dir, not
      the repo root.
- [x] 6.2 Re-read every symbol this change's `design.md` cites and confirm each still exists
      under that name — the repo has a record of design citations rotting within weeks.
- [x] 6.3 No `docs/platform-surface.md` row: this change adds no OS-specific behaviour, no
      spawning, no per-OS path, no new config file. Confirm rather than assume.
- [x] 6.4 Look at it in the running app — a meaning search, a Find-similar view, and a plain
      folder, plus one model opened in the lightbox from each. The dev instance is usually
      already up; the index needs its own server on 8077 and 503s queries for ~16s while
      SigLIP loads.
- [x] 6.5 Archive with a dry run first (`T=$(mktemp -d); cp -r openspec $T/; …`) — the
      MODIFIED block here replaces a requirement's prose **and** both its scenarios, and the
      retired scenario keeps its original title deliberately.
