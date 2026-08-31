# Tasks — pose-for-every-model

> Ordering: after the archived AO sequence (uses its labels and reconciler). Coordinate
> with `library-overrides` (drafted): its pose field is the future override — whichever
> change lands second wires the precedence (stored camera > store pose > index pose >
> default) and records it in both. **Before any demo bake.** Cross-repo: §1 lands in
> `~/Documents/tests/mini-classify` under that repo's conventions.

## 1. mini-classify: the poses call

- [ ] 1.1 `POST /poses` — `{ paths: [...] }` → `{ poses: { <path>: pose | null } }`, a pure
      pose-cache lookup; 503 while warming like `/query`; bounded request size, refusing
      an oversized batch in the surface's own error shape
- [ ] 1.2 `docs/api/surface.md` gains the call beside the other four, with the "no GPU, no
      lock" statement and why (store lookup)
- [ ] 1.3 Tests per that repo's conventions; if anything is measured, an eval script and a
      learnings entry per its CLAUDE.md

## 2. Server: the proxy and the peek ranking

- [x] 2.1 `server/src/semantic.ts`: `posesForDir(library, dirPath)` — list the directory's
      models, ask `/poses`, map real paths → library paths with per-path confinement
      (`hitsToEntries`' rules); absent/warming/uncovered index → empty, never an error
      <br>2026-08-31: `posesForDir` lists through `listDir` (no second walk) and reads the
      index through `probeStatus`; `posesForPaths` does the confinement per path through
      `scopeWithin` — the call the scoring routes already make — and swallows every
      `IndexError` into `{}`. `askPoses` chunks at `POSES_MAX` (1024). Cells:
      `poses.test.ts` "answers a directory's models keyed by library path, asking about real
      ones", "asks about models only", "leaves out a model the index holds no orientation
      for", the whole `per-path confinement` and `an index that cannot answer costs the
      listing nothing` describes (7 states, each asserting no request or an empty answer)
- [x] 2.2 `app.ts`: `GET /api/semantic/poses?path=<dir>` (gated like other path routes;
      404/400 semantics per the path rules); wire types in `shared/types.ts`
      <br>2026-08-31: route added beside `/api/semantic/status` and deliberately *not* in
      `UNGATED`, so the library gate answers it; `canonicalLibPath` then `posesForDir`.
      `PosesResponse` in `shared/types.ts` names the D2 supply. Cells: `poses.test.ts`
      `the poses route` — "requires a path", "404s a path that is not there, index up or
      down", "400s a file", "canonicalises the path it was given", "is a path route: the
      not-ready state envelope"
- [x] 2.3 The peek (`app.ts` peek handler): walk to four *posed* finds within the existing
      entry bound, unposed finds as ordered fallback; one `/poses` batch per peek over the
      finds; index silent → exactly today's selection (assert byte-identical order)
      <br>2026-08-31: `posedFirstPeek` (`app.ts`) probes first, and an index that is not
      ready — or a collection that does not reach the folder — takes `peek(library, libPath,
      n)`, today's call unchanged. Otherwise the walk runs to the entry bound
      (`PEEK_MAX_FINDS`, exported from `listing.ts` = `PEEK_BUDGET` = 64), **one** `/poses`
      batch decides posedness, and the answer is posed finds in walk order then unposed
      finds in walk order, cut to `n`. Cells: `poses.test.ts` `the contact sheet prefers
      posed models` (6), `what the ranking costs` (3), `an index that is silent selects
      exactly as it did before poses` (5, byte-identity against `peek()` itself)
- [x] 2.4 Server tests: proxy mapping + confinement + index-down; peek pose-priority, the
      fallback fill, the bound unchanged, index-down order identical; falsify the ranking
      <br>2026-08-31: `server/test/poses.test.ts`, 34 cells, stubbing `/status` and
      `/poses` at `fetch` the way `semantic.test.ts` stubs `/query` and recording every
      request body. `peek.test.ts` now holds the index absent for the whole file, so its 26
      existing cells double as the index-silent identity. Falsified three ways, each run
      against the suite: **ranking removed** (`finds.slice(0, n)`) → 5 fail, "expected
      [ 'a.stl', 'b.stl', 'c.stl', 'd.stl' ] to deeply equal [ 'c.stl', 'e.stl', 'a.stl',
      'b.stl' ]"; **the index-silent branch widened to the bound** → 10 fail across both
      files, the identity cell reporting the six-entry body against the four-entry one;
      **the unposed fallback dropped** (`posed.slice(0, n)`) → 7 fail, "expected
      [ 'f.stl' ] to deeply equal [ 'f.stl', 'a.stl', 'b.stl', 'c.stl' ]". The bound cell
      runs in both directory orders vitest can produce (`peek.test.ts`'s reversing `readdir`
      mock), and was re-run once against the real modules under `bun` — batch 64, last
      asked `m63.stl`, sheet `m63 m00 m01 m02` — since Node sorts `readdir` and Bun does
      not. Full run after restoring: 365 passed, 3 skipped (the real-index contract)

## 3. Client: the second wave

- [x] 3.1 `api/client.ts`: `semanticPoses(dirPath)`; `App.tsx`: after a plain listing lands,
      fetch and merge into the `poses` state the reducer already holds (meaning/similar
      landings keep their riding poses; no double fetch); latest-listing-wins, stale waves
      dropped like stale listings
      <br>2026-08-31: `semanticPoses` on `ApiClient`/`HttpApiClient` (no signal, `peek`'s
      rule — `apiClient.test.ts` "semanticPoses asks about one directory, escaped" and
      "…raises the server failure rather than swallowing it"). The reducer gains
      `SearchState.listingPoses` and a `listingPoses` action; `Result` gains `id`, the
      asking event the landing answered, because a wave arrives when there is no request
      left for `accepts` to compare against. `App` derives
      `poses = state.result?.poses ?? state.listingPoses ?? NO_POSES` and fires the wave
      from an effect keyed on `landedListing` (`state/selectors.ts` — null for a meaning or
      similarity answer, so those are never re-asked) plus the library's readiness. Every
      landing clears the slot. **Check-in finding, adjudicated by main:** the reconciler's
      trigger was missing — `useThumbnails`' sweep effect did not depend on `poses` (1.2a),
      so a wave that changes the map alone re-ran nothing and was inert. `poses` joins that
      dependency list; design.md D3 carries the dated paragraph
- [x] 3.2 Client tests: a wave over a displayed grid re-renders only unposed-drawn tiles,
      images kept (the reconciler cells' shape); index down → no requests loop, no state
      churn; a wave landing after navigation is dropped; falsify the merge
      <br>2026-08-31: `client/test/poseWave.test.tsx` (8 cells, App-mounted through
      `appHarness`, whose ApiClient mock gains `semanticPoses` defaulting to `{poses:{}}`):
      "re-renders the tiles the index spoke about and keeps every image meanwhile" (a
      deferred `fetchModel` holds the re-render open so the kept images are read *during*
      it; the stored-camera and already-`posed` tiles draw nothing new), "an index with
      nothing to say costs the listing nothing, and is asked once", "a wave that fails says
      nothing at all", "waits for the library, and does not give up on it", "asks nothing at
      all while the library is not there", "a meaning answer is not asked again", "is
      dropped when it answers about a view the user has left" (away *and back*, so the
      stale wave's keys really are on screen). Reducer: `searchReducer.test.ts` "the pose
      wave is kept only for the landing that fired it" and "a landing drops the poses the
      last one was given, and a patch keeps them". Reconciler: `thumbnailQueue.test.tsx` "a
      pose arriving over an unchanged listing re-looks-up only what it named" — the same
      `entries` array by identity, which is the wave's own case and the cell 1.2a's premise
      would have failed; the two neighbouring pose cells' comments are corrected where they
      said a landing was "the only thing that re-runs this effect".
      <br>Falsified, each against the suite and then restored: **`poses` out of the sweep's
      dependency list** → 1 fail, "expected \"spy\" to be called 3 times, but got 2 times";
      **the reducer's `state.result.id !== action.id` check removed** → 2 fail, the App cell
      reporting "expected [ '/models/hero.stl', …(2) ] to deeply equal []" and the reducer
      cell "expected { view: … } to be { view: … } // Object.is equality"; **`landedListing`
      widened to every answer** → 1 fail, "expected \"spy\" to be called 1 times, but got 2
      times" (the meaning cell); **the library gate dropped** → 2 fail, "expected \"spy\" to
      not be called at all, but actually been called 1 times".
      <br>The by-value falsification **cannot fail, and that is the finding**: making the
      merge copy fresh pose objects (a deep clone in the `listingPoses` case) left all 51
      files and 575 behavioural cells green and failed only the two direct reference-identity
      assertions above. The reconciler compares poses by value, so a copied map is
      undetectable through lookups, renders or images — reference stability is a cost
      property, not a correctness one, which is why it is pinned by asserting the reference
      itself (`expect(waved.listingPoses).toBe(poses)`) rather than through behaviour
- [x] 3.3 The lightbox: `pose={poses[...]}` now resolves on plain listings too — assert the
      handoff parity cell still holds with a wave-supplied pose
      <br>2026-08-31: `poseWave.test.tsx` "hands the viewer the orientation a plain listing
      was given" — a deep-linked lightbox over a plain listing's tile, asserting the layer
      is handed the wave's pose and no camera or axis, which is the same advisory handoff
      `orbitHandoff.test.tsx`'s "an index pose survives into the live session" and "an index
      pose is advisory" pin at the component. Those cells take the pose as a prop and cannot
      see where it came from, so the variant that can is this App-level one

## 4. Verification

- [x] 4.1 `bun run test` / `bun run typecheck` both repos' suites; `openspec validate`;
      ordered archive dry run
      — done 2026-08-31 (coordinator): mini-classify `700 passed, 1 skipped` (P1's run, its
      own pytest command); here on merged main `0b06099` client 51 files / server 412 passed
      (+3 index-contract skips), typecheck clean, validate clean, archive dry run clean at
      drafting (`f72f93f`) and re-run below at close
- [ ] 4.2 Live: a plain listing of unowned models stands them up within one queue pass,
      images kept meanwhile; contact sheets over a mixed folder show posed models first;
      index stopped → listings and peeks behave exactly as today
- [x] 4.3 `web-demo-backlog` 1.2 marked drafted→applied; the bake-ordering note stays until
      the demo change lands
      — done 2026-08-31 (coordinator)
