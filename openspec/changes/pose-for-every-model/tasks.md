# Tasks — pose-for-every-model

> Ordering: after the archived AO sequence (uses its labels and reconciler). Coordinate
> with `library-overrides` (drafted): its pose field is the future override — whichever
> change lands second wires the precedence (stored camera > store pose > index pose >
> default) and records it in both. **Before any demo bake.** Cross-repo: §1 lands in
> `~/Documents/tests/mini-classify` under that repo's conventions.

## 1. mini-classify: the poses call

- [x] 1.1 `POST /poses` — `{ paths: [...] }` → `{ poses: { <path>: pose | null } }`, a pure
      pose-cache lookup; 503 while warming like `/query`; bounded request size, refusing
      an oversized batch in the surface's own error shape
      — done 2026-08-31 (P1, mini-classify `f074334`): `post_poses` in `src/api.py` over a new `Collection.row_of` — total on any string, lexical (absolute spelling as walked, root-relative parts under the root as recorded *and* as resolved), zero syscalls for a 1024-path batch (asserted with the repo's syscall budget helper); `POSES_MAX = 1024` enforced by the pydantic schema (422, the surface's own shape); `_live()` warming gate shared (503). Unknown paths answer `null` under their own key
- [x] 1.2 `docs/api/surface.md` gains the call beside the other four, with the "no GPU, no
      lock" statement and why (store lookup)
      — done 2026-08-31 (P1): `docs/api/surface.md` gains `### POST /poses` beside the other four, the `/status` warming sentence and the GPU-lock bullet name it as outside the lock (a store lookup); README's route count and 503 sentence updated
- [x] 1.3 Tests per that repo's conventions; if anything is measured, an eval script and a
      learnings entry per its CLAUDE.md

      — done 2026-08-31 (P1): `tests/test_api.py` (pose block equals a real hit's; absolute and root-relative; five unaddressable paths → null; mixed batch; 1025 → 422 pinning `POSES_MAX`; warming harness) and `tests/test_collection.py` (`row_of` by hit path/rel path, symlink-walked spelling, six spellings, six unaddressables, the zero-syscall budget); each assertion checked against a deliberate break. Suite `700 passed, 1 skipped`. Nothing measured, so no eval script and no learnings entry — stated per that repo's rule
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
      <br>2026-08-31 (review follow-up, worker S): the availability gate moves out of
      `posesForDir` into `posesForListing`, which both pose routes now answer on, so the
      directory form and the paths form cannot come to disagree about what an unusable
      index answers; `posesForDir` keeps the `listDir`-before-probe ordering the 404/400
      semantics depend on. Two costs the review found, both here: **F4**, `askPoses` was
      inheriting `QUERY_TIMEOUT_MS` (30 s) — `askIndex` now takes the budget from its
      caller and `/poses` passes `POSES_TIMEOUT_MS` (2 s, the probe's own), a timeout
      landing in the network catch that already empties the answer and calls
      `resetIndexStatus`. **F5**, `rawStatus` cached only after `probe()` resolved, so N
      folder tiles landing together opened N `/status` connections; the in-flight promise
      is now memoised (`inFlight`, cleared on settle under an identity guard, dropped by
      `resetIndexStatus`), and `fresh` — the explicit retry — deliberately never joins it
- [x] 2.2 `app.ts`: `GET /api/semantic/poses?path=<dir>` (gated like other path routes;
      404/400 semantics per the path rules); wire types in `shared/types.ts`
      <br>2026-08-31: route added beside `/api/semantic/status` and deliberately *not* in
      `UNGATED`, so the library gate answers it; `canonicalLibPath` then `posesForDir`.
      `PosesResponse` in `shared/types.ts` names the D2 supply. Cells: `poses.test.ts`
      `the poses route` — "requires a path", "404s a path that is not there, index up or
      down", "400s a file", "canonicalises the path it was given", "is a path route: the
      not-ready state envelope"
      <br>2026-08-31 (review follow-up, worker S): **F2** — the GET answers only a
      directory's direct children, so a flat `/` listing showing 500 models from
      subfolders got the three poses that happened to sit at the top. `POST
      /api/semantic/poses` takes `{ paths: string[] }` (`PosesRequest` in
      `shared/types.ts`, whose doc says a client sends the *landed entries'* paths),
      canonicalises each with `canonicalLibPath`, and answers the same `PosesResponse`
      through `posesForListing` → `posesForPaths`, which confines each path exactly as a
      hit is confined — a path the library refuses is dropped, never an error. Refused
      past `POSES_MAX` (1024, now exported) in the route's own invalid-field shape, so it
      is one request in and at most one upstream request out. Same path as the GET, so
      the library gate covers both with no code of its own. Cells: `poses.test.ts` `the
      paths route, for the listings a directory cannot name` — "answers the entries it
      was given, wherever in the library they live" (three folders at once, asserting
      both halves of the wire), "canonicalises every path", "drops what the library
      refuses instead of failing the whole answer" (stale, escaping and virtual paths
      beside a good one), "requires an array of strings", "refuses more than one upstream
      call's worth, and takes exactly that many" (1024 taken, 1025 refused, nothing
      asked), "an index that cannot answer costs it nothing either" (3 states), "is the
      same path route the GET is: the not-ready state envelope"
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
      <br>2026-08-31 (review follow-up, worker S): **F3** — "a non-covering index costs
      the peek nothing" was the comment's claim and not the code's. Coverage is decided
      per path inside `posesForPaths`, which is *after* the walk, so a ready index rooted
      at a sibling subtree bought the entry-bound walk and a `realpath` per find to be
      told nothing. `posedFirstPeek` now asks `scopeWithin(library, libPath,
      collectionRootFs)` about the **folder** before the wide walk and takes the narrow
      `peek(library, libPath, n)` when it is null — the same branch the silent index
      takes. The comment is corrected to say what the code now does. Judgment call: a
      folder outside the collection holding a symlink *into* it loses the pose it used to
      get; a preview is cosmetic and follows the index's coverage the way search does,
      and paying a wide walk on every uncovered folder to orient the odd symlinked one is
      the wrong trade
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
      <br>**2026-08-31, re-run by worker S** — the three counts above are stale (main has
      moved and the file has grown); these are this session's own runs, on the tree this
      task's follow-up ships, `cd server && bunx vitest run`, 439 cells green before and
      after each. **Ranking removed** (`finds.slice(0, n)`) → **6** fail, "expected
      [ 'a.stl', 'b.stl', 'c.stl', 'd.stl' ] to deeply equal [ 'c.stl', 'e.stl', 'a.stl',
      'b.stl' ]". **The index-silent branch widened to the bound** (`peek(library,
      libPath, PEEK_MAX_FINDS)`) → **13** fail across `peek.test.ts` and `poses.test.ts`,
      "expected '[{\"name\":\"a.stl\",\"path\":\"/mixed/a.stl…' to be
      '[{\"name\":\"a.stl\",\"path\":\"/mixed/a.stl…' // Object.is equality".
      **The unposed fallback dropped** (`posed.slice(0, n)`) → **8** fail, "expected
      [ 'f.stl' ] to deeply equal [ 'f.stl', 'a.stl', 'b.stl', 'c.stl' ]".
      <br>The widening falsification found a real gap while being re-run and it is closed
      here: written as `(await peek(library, libPath, PEEK_MAX_FINDS)).slice(0, n)` — a
      wide walk whose extra finds are thrown away — it passed **every** cell, because the
      byte-identity cells compare answers and a wider walk answers identically. What was
      untested was the walk itself. `poses.test.ts` `an index with nothing to say about
      the folder costs the peek nothing` now measures it over all four states (absent,
      warming, wedged, ready-but-rooted-elsewhere) against a control run of `peek()` in
      the same cell: `readdir` count equal (the width), `realpath` count within a named
      allowance of 4 (`mapCollectionRoot`'s one plus `scopeWithin`'s three, all about the
      folder rather than its contents), the answer byte-identical, and no `/poses` sent.
      The sliced widening now fails 3 of those cells, "expected 4 to be 1".
      <br>New cells for the follow-up findings, each falsified against the whole suite
      and restored: **F3** — `an index with nothing to say about the folder …` "ready, but
      rooted somewhere this folder is not"; reverting the folder `scopeWithin` → 1 fail
      (plus the flaky `open.test.ts` cell noted below), "expected 4 to be 1 // Object.is
      equality". **F4** — `a stalling index does not hold
      the sheet` "gives up on /poses within its own budget and previews the walk's own
      order" (a `/poses` that answers only its own abort, a 15 s cell timeout, asserting
      the peek returns the walk's order in under 10 s and that the next probe re-asks
      `/status`); restoring `QUERY_TIMEOUT_MS` → 1 fail, "Test timed out in 15000ms".
      **F5** — `a screenful of tiles probes the index once` (3 cells: six concurrent
      `probeStatus` calls over a 25 ms `/status`, the TTL still deciding afterwards, and
      `fresh` never joining); dropping the `inFlight` memo → 2 fail, "expected 6 to be 1
      // Object.is equality" and "expected 2 to be 1 // Object.is equality".
      <br>Suite on the shipped tree: **439 passed (14 files)**, including
      `indexContract.test.ts`'s 3 cells against the live index on :8077 (`embed-cache512`,
      collection root `/run/media/masa/STLLibrary`). Note for whoever runs it next:
      `open.test.ts` "completes when the chooser does, even after the request is aborted"
      is flaky under a full parallel run — 2 failures in 6 runs measured on **main** at
      `393d61a` with none of this work applied, and green on its own every time. It is a
      `setImmediate` race in that cell, unrelated to poses

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
      <br>**2026-08-31, review (F2 — the wave covers every listing shape):** the wave asked
      `semanticPoses(dir)`, a GET of one directory's *direct children*, for every
      `kind:'listing'` landing — and `requestOf` calls three things a listing. A flat listing
      of the library top (up to 500 models gathered from subfolders) was answered about the
      handful of files at the top; a name search's matches, drawn from a whole subtree, were
      answered about the folder it was run at. Neither failed: an unmatched key is
      indistinguishable from "no orientation", so both grids stayed un-posed. Now
      `ApiClient.semanticPosesFor(paths)` posts the landed entries' model paths and `App`
      fires it for all three shapes; `semanticPoses` (the directory GET) stays on
      `ApiClient` for a directory-shaped ask and **nothing under `client/src` calls it any
      more** — kept rather than removed, the coordinator's call. `landedListing` returns
      `{ id, entries }`; `App` derives the model paths through a `useMemo` on that stored
      array so the effect still fires exactly once per landing (`patch` spreads `result` but
      carries `entries` by reference, so opening a lightbox does not re-ask). Paths come off
      `result.entries`, not `byKind` — that filter moves on a click with no landing behind
      it. A listing that landed no model asks nothing. `semanticPosesFor` **chunks** at
      `POSES_MAX` (1024) and merges: `MODEL_BROWSER_FLAT_CAP`'s 500 bounds the *flat walk*
      only, `listDir` caps nothing, and a slice would leave a large folder's tail silently
      un-posed forever. design.md D2 and D3 carry the dated addenda; the delta's requirement
      is reworded and gains *A flat listing stands its models up too*
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
      dependency list** → 2 fail (2026-08-31, on `393d61a` — **superseded, see the
      2026-09-01 re-run below**; the record before it said "1 fail", which undercounted, and
      the message it carried was the *other* cell's):
      `poseWave.test.tsx` "re-renders the tiles the index spoke about and keeps every image
      meanwhile" — "expected [] to deeply equal [ '/models/aimed.stl', …(2) ]" — and
      `thumbnailQueue.test.tsx` "a pose arriving over an unchanged listing re-looks-up only
      what it named" — "expected \"spy\" to be called 3 times, but got 2 times";
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
      <br>**2026-09-01, re-run by worker C2 (second review, finding 5).** The "2 fail"
      above was a snapshot of `393d61a`; main has moved and two more cells now depend on
      the sweep's `poses` dependency. On this session's tree, `cd client && bunx vitest
      run` with **`poses` out of the sweep's dependency list** → **5 fail | 605 passed**:
      `poseWave.test.tsx` "re-renders the tiles the index spoke about and keeps every image
      meanwhile" — "expected [] to deeply equal [ '/models/aimed.stl', …(2) ]";
      `poseWave.test.tsx` "a flat listing gets the poses of the models it actually shows" —
      "expected [] to deeply equal [ '/models/Kits/aimed.stl', …(2) ]";
      `folderSheets.test.tsx` "re-renders a preview whose cached thumbnail predates its
      pose" — "expected undefined to be defined" (the F3 preview wave, which lands through
      the same dependency); `thumbnailQueue.test.tsx` "a pose arriving over an unchanged
      listing re-looks-up only what it named" — "expected \"spy\" to be called 3 times, but
      got 2 times"; and `thumbnailQueue.test.tsx` "a loading entry whose pose did not change
      is left running" — "expected 1 to be 2 // Object.is equality" (its control entry, the
      one whose pose really did arrive, is never restarted). Restored and green afterwards
      <br>**2026-08-31, review (F2's cells):** `poseWave.test.tsx` gains a describe *every
      listing shape asks, not only a directory* (4 cells) — "a flat listing gets the poses of
      the models it actually shows" (the flat toggle over a `NESTED` fixture whose four
      models all live a folder down; asserts the POST body is those paths, that none of them
      is a path the old directory request could have named, and that resolving the wave
      re-looks-up exactly the three the index spoke about and PUTs `hero`'s re-render),
      "a name search's wave carries the matches, wherever they were found", "a listing of
      folders alone asks nothing at all", "asks about the models a mixed listing holds, and
      about nothing else". The mock the App-level cells drive is now `appHarness.tsx`'s
      `semanticPosesFor` (default `{poses:{}}`, cleared per mount and reset per file beside
      `semanticPoses`); `persistPut.test.tsx`'s hand-listed client gains it too.
      `apiClient.test.ts` gains "semanticPosesFor posts the models it was handed, in one
      request" and "semanticPosesFor chunks a listing past the route bound and merges the
      answers" (1025 paths → two POSTs of 1024 and 1, merged, every path asked about exactly
      once in order).
      <br>F2 falsified two ways, each against the whole suite and then restored. **The wave
      reverted to the directory GET** (`landedListing` handing back `path` again, `App`
      calling `api.semanticPoses(wavePath)`) → **9 fail | 3 passed** in `poseWave.test.tsx`,
      the flat cell verbatim: "expected last \"spy\" call to have been called with
      [ [ '/models/Kits/hero.stl', …(3) ] ]" against a received `undefined` — nothing calls
      `semanticPosesFor` at all. **The sharp variant**, which changes only *which paths* the
      same call carries — `wavePaths` narrowed to the entries a directory request could have
      answered about (`!e.name.includes('/')`) — → **2 fail | 10 passed**, exactly the flat
      and name-search cells, both "expected last \"spy\" call to have been called with
      [ [ '/models/Kits/hero.stl', …(3) ] ]". The plain-listing cells stay green under it,
      which is the point: the two new shapes are what F2 buys
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
- [x] 4.2 Live: a plain listing of unowned models stands them up within one queue pass,
      images kept meanwhile; contact sheets over a mixed folder show posed models first;
      index stopped → listings and peeks behave exactly as today
      — done 2026-08-31 (coordinator), the user's dev server + the restarted index (827
      models, mid-classify; params matched to the run after a `CacheUnusable` false start
      from `run_serve.sh`'s defaults). (a) Root listing (33 cached, unowned, unposed tiles;
      the index poses 3): first visit re-rendered the two unowned posed models to `posed: 2`
      and left the third — which holds a stored camera — untouched; a tracked reload showed
      **one** `/api/semantic/poses` request and, after it, exactly three thumb re-lookups
      (the posed models) with zero PUTs — the by-value rule touching only what changed.
      (b) `City of Intrigues/…/Standalone Weapons & Hands` (21 of 40 posed; name order's
      first four alternate posed/unposed): `/api/peek` answered four posed models, skipping
      the unposed `(Supported)` variants. (c) Index-stopped identity was NOT exercised live
      — stopping the user's mid-classify index was not worth it; it is pinned by the
      byte-identity cells against `peek()` (P2's 2.4, four silent states) and by the wave's
      index-down cells (P3's 3.2). Browser: Playwright was held by another session, so the
      check drove a tab in the user's Chrome and closed it after
- [x] 4.3 `web-demo-backlog` 1.2 marked drafted→applied; the bake-ordering note stays until
      the demo change lands
      — done 2026-08-31 (coordinator)

### Review notes, 2026-08-31 (accepted as they stand)

- **F6 — clearing `listingPoses` at every landing costs a few cache lookups.** Two
  consecutive listings that share an entry (a navigation up and back, a flat toggle over
  the same folder) drop the pose the first landing's wave supplied, so the shared entry is
  re-looked-up when the next wave answers: **up to two extra cache lookups per shared
  entry**, and nothing more — no render is issued (the reconciler compares by value and
  the pose it re-learns is the one it already had) and no image is dropped (a re-run keeps
  every tile's pixels). Accepted rather than fixed: carrying the map across landings would
  make `listingPoses` speak for a listing it was not asked for, and the honest-state
  property — the slot only ever holds the poses of the answer on screen — is worth more
  than the lookups. The alternative, keying the map by landing id and keeping the last few,
  is a cache with an eviction policy standing in for a rule that is currently one line.
- **F8 — the server suite's recorded "3 skips" is environmental, not this change's.**
  `indexContract.test.ts`'s describe is `skipIf(!(await reachable()))` — its three cells
  are a contract check against the real mini-classify service, not a unit suite, and they
  skip themselves whenever no index answers `/status` with `ready:true`. Against a
  *partially built* index one of them, "the index's own ceiling still bites a floor-only
  set, which is the wall notice's one state", additionally fails: the ceiling it asserts is
  a property of how much of the collection is embedded, not of anything this change
  touches. So "3 skipped" is the expected shape of a server run on a machine with no index
  up, and neither the skips nor that cell's failure mid-index is evidence of a gap here.
  Confirmed by re-running the server suite on `393d61a` (2026-08-31, review worker) *with*
  the index up: **420 passed, 0 skipped** — the three contract cells run and pass, which is
  the same suite the recorded "412 passed, 3 skipped" describes with the index down. (One
  earlier run in that session reported a single failure; three later runs — two full, one
  of `indexContract.test.ts` alone — did not reproduce it, which is the flavour of
  environmental this note is about.)

## 4. Review notes

- 2026-08-31 (coordinator, review round): the index-side HIGH finding (F1 — `row_of`
  answering `null` for every model when the classify run was invoked through a symlinked
  root and the server started bare) was handed to the mini-classify session at Masa's
  direction and landed there as `340a8f0` (`_parts` falls through input-relative →
  root-relative → realpath-relative → absolute; both directions of the repro pinned; suite
  711). Its semantics note stands for this side: `row_of` stays lexical, and the
  realpath-first spelling `scopeWithin` sends is the one that now always hits. The
  `run_serve.sh` false start is retired by their `c05c14d` (run params in the manifest).
  Here: S (`39acd0f`) and C (`e2cdda6`) merged; C's local `PosesRequest` replaced by the
  shared type at merge. Merged main: client 53 files / 602, server 439 ×3 (one run showed
  the pre-existing `open.test.ts` abort flake S measured at 2-in-6 on untouched main),
  typecheck and validate clean.
- **2026-09-01, re-run by worker C2 (second review, finding 5).** The client count above is
  a snapshot of the tree it was taken on and main has moved since — the flat-listing cells
  and the F3 preview-wave cell landed after it. Measured here, `cd client && bunx vitest
  run`: **53 files / 605** on main at `2ffdced` with none of this session's work applied,
  and **53 files / 610** on the tree this session ships (5 new cells: three in
  `apiClient.test.ts` for the chunk merge, one in `poseWave.test.tsx`, one in
  `thumbnailQueue.test.tsx`). Root `bun run typecheck` clean on both.

## Follow-ups found at the seams

- [x] F3 (2026-09-01, fixed by the contact-sheets session in App.tsx): the wave asks
      about what LANDED, and a folder tile's preview models never land — so a sheet
      cell whose cached thumbnail predated the index's orientation kept its stale
      angle until the user navigated into the folder (Masa's report). App now runs a
      previews' own wave beside the peek map: `semanticPosesFor` over each preview
      path once per listing, merged into the sweep's `poses` (landed answers win a
      shared path, empty answers merge nothing so identity does not churn), with the
      same failure-is-silence and stale-landing-token rules the peek uses. Cell in
      `folderSheets.test.tsx` ("re-renders a preview whose cached thumbnail predates
      its pose"), falsified by disabling the wave effect. Nothing in this change's own
      files moved.

- [x] F4 (flagged at review 2026-09-01, yours to take or decline): `POSES_MAX = 1024` is
      now declared twice — `client/src/api/client.ts` and `server/src/semantic.ts` — two
      literals that must agree, with the server enforcing the wire bound; a bump in one
      400s the other. `shared/types.ts` (where `PosesRequest`/`PosesResponse` moved) is
      the obvious home — same class as the RIG_VERSION never-redeclare rule.

      — done 2026-09-01 (coordinator): one declaration in `shared/types.ts` (the
      `CAMERA_EPSILON` precedent), imported by both sides; the client re-exports it so its
      test imports stand unchanged. Typecheck and both poses suites green
## 5. The index-level peek (D5, 2026-09-01)

- [x] 5.1 mini-classify `POST /under` — contract CONFIRMED with masa-19 (2026-09-01), they
      build it: `{path, limit}` → `{status: "ok"|"unindexed", models: [{path, pose|null}],
      matched, truncated}`; scoping via `Collection.resolve` (post-340a8f0 spellings), rel-path
      sorted, pure store scan, 503 while warming. The walk fallback keys on `"unindexed"` or
      index-silence — an empty `"ok"` means genuinely nothing indexed there
      — landed 2026-09-01 by masa-19 as mini-classify `3dde233`, suite 731; spec in its
      docs/api/surface.md. As-landed sharpenings: an empty `"ok"` is structurally
      impossible (zero rows under a real directory is always `"unindexed"` — pinned by
      test), so this side's fallback keys on `"unindexed"`/silence alone and the `[]`
      branch in `modelsUnder` is unreachable-but-harmless (it converges on the fill
      arithmetic); paths are byte-identical to `/query` hit paths and round-trip through
      `/poses` (pinned there); order is root-relative sorted with the sort made
      falsifiable against Python 3.12's per-component `PurePath` ordering; limit capped at
      10000 server-side; no GPU lock. The `_row_by_rel` last-wins note traced to a
      no-differing-poses verdict (colliding rows share `file_identity`).
      <br>2026-09-01, addendum: masa-19's own review of `3dde233` found `/under` conflated
      "nothing searchable at all" (a folder of `.3mf`/`.obj` — the index can never hold it)
      with "not classified yet"; TWO ADDITIVE fields land shortly — `covers: ["stl", …]`
      (the constant extension list `/status` already publishes, explaining why a folder can
      scan to zero) and `n_scanned: <int>`, the actual discriminator (0 = the walk will
      find models the index never will). masa-19 corrected the field naming against the
      code before it shipped: their first message called the integer `covers`. This side stays keyed on `"unindexed"`/silence
      — both covers cases fall back to the walk, which answers correctly either way — and
      `modelsUnder` tolerates the extra field unread. The n_scanned==0 refinement (render
      unposed tiles without expecting poses from a future peek) is recorded as
      available-but-declined: nothing renders that expectation today; the demo bake planner
      is the likely first consumer
- [x] 5.2 Server: `posedFirstPeek` asks the index first (`/under` with limit 256, short
      timeout like `/poses`), confines/maps per path, ranks posed-first, stats the chosen n
      into `DirEntry`s; `"unindexed"` or silent → today's walk path, byte-identical (the
      existing identity cells must keep passing unchanged); an `"ok"` answer with fewer
      than n models → fill from the walk's finds, deduped. `matched`/`truncated` advisory:
      a posed model past a truncated 256 cut is invisible to the sheet — recorded, accepted
      for 4 cells
      <br>— done 2026-09-01 (S2). `semantic.ts`: `UNDER_LIMIT` (256), `modelsUnder` (the
      `/under` client — `RawUnder` typed as the wire is, every field nullable, for
      `RawStatus`' reason; **`null` means "use the walk"** and is deliberately one value for
      three facts — `"unindexed"`, unreachable, too slow — while an `"ok"` answer holding
      nothing lands as `[]` and fills from the walk by the same arithmetic), and
      `entriesUnder` (stable posed-first partition keeping the index's order within each
      half, then confine-and-stat per candidate until `n` entries exist). `UNDER_TIMEOUT_MS`
      is an **alias** for `POSES_TIMEOUT_MS`, not a second literal — the never-redeclare
      rule; falsified by pointing it at `QUERY_TIMEOUT_MS` (the stall cell then times out at
      15 s).
      <br>Judgment call: `entriesUnder` confines against the **peeked directory**, not the
      collection root — same three tests `hitsToEntries` makes (normalise, prefix, `realpath`
      inside `realTop`), with the folder standing where the collection stands. That is what
      was asked about, and the library path it joins onto is the one the tile was addressed
      by, so a folder reached through an in-library symlink previews `/links/in/x.stl` — the
      spelling the *walk* produces for the same file — rather than the symlink's target under
      the collection. `basename`, not the rel path, for `name`: a sheet must not read half in
      bare names and half in paths.
      <br>`app.ts`: `posedFirstPeek`'s two gates are unchanged and still come before *any*
      walk, and `scopeWithin`'s return value is now used rather than discarded — it is both
      the coverage test and the real path `/under` must be told (D6), so the same call
      answers both. The pre-D5 body is extracted verbatim as `walkRanked` (uncut) and the
      fill is `for … if (sheet.length >= n) break; if (seen.has(entry.path)) continue` — with
      an empty index half that reproduces the old `[...posed, ...unposed].slice(0, n)` byte
      for byte, which is what keeps the identity cells passing untouched. `matched` and
      `truncated` are read off the wire and deliberately unused: recorded in `UNDER_LIMIT`'s
      comment (a posed model past the cut is invisible; nothing pages, because the
      alternative is a walk that cannot see past 64 entries either)
- [x] 5.3 Tests: index-first selection reaching past the walk budget (the Lich Lord shape:
      deep first subtree unindexed, posed models deeper); fill-from-walk; empty-answer
      fallback identity; stat failure on a chosen path drops to the next candidate
      <br>— done 2026-09-01 (S2), `server/test/poses.test.ts` (49 → 62 cells, suite 440 →
      453, all 14 files green; the known `open.test.ts` abort flake did not appear in three
      runs). The `fetch` stub gains `/under` — scoped to the asked prefix and cut to the
      asked `limit`, as the index scopes and cuts, so a confinement bug cannot pass as a
      green cell — and **absent `under` answers `"unindexed"`**, which is why every cell
      written before D5 keeps exercising exactly the path it was written about. No existing
      cell changed. New fixture `lich/` = `01-presupported/{00..79}.txt` + `02-kit/`'s four
      STLs: eighty entries is past the peek's 64-entry budget, so the walk dies in the first
      subtree and never reaches the kit.
      <br>Cells, under `the sheet asks the index before it walks`: "reaches the kit the
      walk's budget can never get to" (the section's reason — asserts that `peek()` itself answers `[]`
      as an in-cell control first, then a full posed-first sheet with ordinary `DirEntry`
      keys and no `/poses` batch at all); "asks about the folder by its real path, and for
      one answer's worth" (`{path: <real>, limit: UNDER_LIMIT}`); "an unindexed answer is the
      walk's own sheet, byte for byte" (against `walkSheet`, the pre-D5 body spelled out —
      the same idiom `identical` uses one change earlier — plus `asked` length 1, so the
      branch is proven taken rather than skipped); "an index refusal and a 503 fall back the
      same way"; "fills a short answer from the walk, without repeating what it already has"
      (2 index models over a folder of 6 → `[f, a, b, c]`, where `a` is also the walk's first
      find, which is what makes the dedup observable); "an \"ok\" answer holding nothing is
      the walk's sheet too"; "a chosen model that is no longer there gives its cell to the
      next candidate" (over `/lich`, whose walk finds nothing — deliberately, so the fill
      cannot stand in for the recovery: a take-n-then-stat peek comes back with three cells
      and nowhere to get a fourth); "never previews a model that leaves the library, whatever
      the index says"; "a stalling /under does not hold the sheet"; "an index that is not
      answering is never asked at all" (both gates precede `/under` too — zero requests).
      <br>Falsifications, each run against the named cells and then reverted verbatim:
      **index half forced to `null` (walk-only)** → 9 of the 10 cells fail, the Lich Lord one
      with `expected [] to deeply equal [ 'hero.stl', 'minion.stl', …(2) ]`; **dedup dropped
      from the fill** → `expected [ 'f.stl', 'a.stl', 'a.stl', 'b.stl' ] to deeply equal
      [ 'f.stl', 'a.stl', 'b.stl', 'c.stl' ]`; **`walkRanked` returning `finds` unranked** →
      `expected '[{"name":"a.stl",…' to be '[{"name":"c.stl",…'`; **candidates `.slice(0, n)`
      before stat'ing** → `expected [ 'guard.stl', 'hero.stl', …(1) ] to deeply equal
      [ 'guard.stl', 'hero.stl', …(2) ]`; **`realTop` containment removed from
      `entriesUnder`** → `expected [ '/links/escape.stl', …(2) ] to deeply equal
      [ '/links/real.stl', …(1) ]`; **`UNDER_TIMEOUT_MS` = `QUERY_TIMEOUT_MS`** →
      `Test timed out in 15000ms`
- [x] 5.4 Second-review findings applied in the same round: probe-cache generation stamp
      (finding 1), POST per-path canonicalisation (finding 2), client chunk merge
      (finding 4), stale records corrected (finding 5), the two carried cells (finding 6)
      <br>**2026-09-01, worker C2 — findings 4, 5 and 6 done; 1 and 2 are the server's and
      are still open.**
      <br>**Finding 4** — `HttpApiClient.semanticPosesFor` chunked all-or-nothing: chunk k
      rejecting rejected the whole promise and discarded the poses chunks 1..k−1 had
      already returned, and `App` swallows the rejection — so one 500 in the middle of a
      three-thousand-model folder left *every* tile un-posed, which is the same silent
      un-posed tail the chunking exists to prevent, reached the other way round. Each chunk
      now has its own catch and merges what succeeded; a failed chunk contributes nothing
      and its paths are simply absent from the map (indistinguishable from "no
      orientation", which is what the next wave re-asks about). It rejects **only when
      every chunk failed**, carrying the first failure, so a rejection still means "nothing
      arrived" to a caller whose failure handling is silence. Zero paths makes no requests
      and is not a failure. The semantics are commented at the method and in the `ApiClient`
      doc. Cells in `apiClient.test.ts`: "semanticPosesFor keeps the chunks that answered
      when one of them fails" (1025 paths, first chunk resolves, second 500s → resolves
      with the first chunk's poses, both chunks still attempted), "…rejects only when every
      chunk failed" (both 500 → rejects with the *first* message), "…asks nothing, and
      fails at nothing, for no paths". Falsified by reverting to all-or-nothing → **2 fail
      | 608 passed**: "promise rejected \"Error: index exploded { …(2) }\" instead of
      resolving" and "expected \"spy\" to be called 2 times, but got 1 times"
      <br>**Finding 6a** — `poseWave.test.tsx` gains `the library going away and coming back
      re-asks the same landing` › "re-fires the wave for a landing that never moved —
      accepted, not desired". `libraryReady` is a *dependency* of the wave effect rather
      than a bare guard (so a boot listing that lands before the probe answers still gets
      its wave), which means the readiness re-runs the effect in both directions: a library
      that goes away and comes back under a listing that never moved POSTs the same paths a
      second time. Driven through two *failed* navigations, because a successful one lands
      and a new landing fires the wave for its own reasons — a failure keeps `state.result`,
      so `landedListing`'s id and entries array are literally the same. The cell asserts the
      second POST happens with the same paths, and then that it costs nothing: no cache
      lookups, no renders, every tile's image unchanged. The comment says plainly that this
      is accepted rather than desired and names what would have to change. Falsified two
      ways: **`libraryReady` dropped from the effect's dependency list** (a bare guard) → 2
      fail, this cell "expected \"spy\" to be called 2 times, but got 1 times" and the
      existing "waits for the library, and does not give up on it"; and **`samePose` made
      reference-based** → 3 fail including this cell's second half, "expected
      [ '/models/hero.stl', …(2) ] to deeply equal []" — which is what proves the sweep
      really does re-run here and the by-value compare is the thing making the duplicate
      free. The wave answer is rebuilt per call (`freshWave()`) for that reason: handing
      back the same object twice would leave the map's identity unchanged and the by-value
      compare unreached
      <br>**Finding 6b** — `thumbnailQueue.test.tsx` gains "a loading entry whose pose did
      not change is left running", the missing quadrant beside the three existing cells
      (settled/unchanged, settled/changed, loading/changed). A wave moves the map's identity
      while a grid is mid-first-pass, and restarting in-flight work whose pose did not
      change would be wrong *and* invisible — the cancelled render and its replacement draw
      the same pixels. Two entries under a suspended queue, both loading; the rerender
      hands a new map in which `a`'s pose is rebuilt but identical and `b` gains one it did
      not have. `b` is the control: without it a sweep that never re-ran at all would pass.
      Asserts one lookup for `a` and two for `b`, one render apiece (the retired tail never
      runs), both ready. Falsified by **`samePose` made reference-based** → "expected 2 to
      be 1" (a restarted) and by **`poses` out of the sweep's deps** → "expected 1 to be 2"
      (b never restarted)
      <br>**Finding 5** — the two stale records corrected in place above (§3.2's
      falsification count and §4's merged-main client count), each labelled as a snapshot of
      an older tree rather than silently overwritten
      <br>**Server half done 2026-09-01 (S2) — findings 1 and 2. The client half (4, 5, 6)
      is C2's and this line stays open until it lands.**
      <br>**Finding 1 (probe-cache write ordering).** `rawStatus` wrote the cache in *settle*
      order, and the two orders differ exactly where it matters: the client's `fresh` retry
      deliberately does not join a probe already on the wire, so a slow memoised look
      answering `warming` could settle *after* the retry's `ready` and overwrite it — the user
      presses retry, the index says it is up, and the next tile is told it is still loading
      for the whole warming TTL. `resetIndexStatus` had the same hole from the other side: it
      dropped the memo, but the probe that memo referred to could still land its pre-reset
      answer afterwards. Fixed with a module-level `generation` in `semantic.ts`: `look`
      captures it at start and writes `cached` only if it is unchanged; `rawStatus`' `fresh`
      branch and `resetIndexStatus` bump it. A superseded answer is still *returned* to
      whoever awaited it — only not remembered. A generation and not a timestamp because what
      makes an answer stale here is an event, not an interval, and a `fresh` look and the
      memoised one it raced share a millisecond routinely.
      <br>Cells: `poses.test.ts` → `what the probe cache remembers is what was last asked` —
      "a fresh look is not overwritten by the stale one it raced" (the reviewer's exact race,
      driven by a new `statusSeries` stub option giving each `/status` ask its own body *and*
      delay: warming@80 ms then ready@0 ms; asserts the slow one really did answer `warming`,
      then that the next read is `ready` **and served from cache**, `statusAsks === 2`) and "a
      probe started before a reset does not land its answer after it". Falsified by dropping
      the generation guard: `expected 'warming' to be 'ready'` and `expected 1 to be 2`.
      <br>**Finding 2 (one bad path 400s the batch).** `POST /api/semantic/poses` canonicalised
      with `paths.map(canonicalLibPath)`, so one path that is not *spelled* like a library
      path — no leading slash, past the 4096-byte/256-component bound, a nested `!/` — threw
      out of the map and 400'd the whole request: a single stale tile cost every other tile in
      a five-hundred-model listing its pose. Now canonicalised per path inside a `try`, and a
      refusal means **dropped**, exactly as every other per-path refusal on this route means
      dropped. `LibraryError` and `VPathError` both, since `canonicalLibPath` throws either;
      anything else still propagates. The array-of-strings check above it stays a 400 — a
      non-string element is a caller bug about the request's *shape*, while an unspellable
      path is one entry the answer has nothing to say about. Route comment updated with the
      distinction. Cell: "drops a path that is not spelled like one, rather than failing the
      batch" (good + un-rooted + over-long → 200, the good path's pose only, and the upstream
      batch carries exactly the one real path). Falsified by restoring the bare map:
      `expected 400 to be 200`
      <br>Box closed 2026-09-01 (coordinator): server half (S2, findings 1+2) and client
      half (C2, findings 4+5+6) both merged
- [x] 5.5 Live: the 141-tile scan re-run against the complete index; the folder-of-folders
      tiles show posed sheets; fallback proven on an uncovered path
      — baseline recorded 2026-09-01 (coordinator), complete index (3,380 models, 0
      missing): **12 of 141** tiles under-use posed models despite availability — the same
      twelve as the mid-build scan, so the class is structural (walk budget consumed in
      unposed presupported subtrees), not indexing lag. The number this section drives to
      zero. Scan: peek's 4 vs poses of the sheet vs poses available within depth 2 / 150
      models per folder tile at `/` and one level below
      — done 2026-09-01 (coordinator), user's dev instance + the restarted index serving
      `/under`: **all 12 structural tiles fixed, 12/12 sheets fully posed** (the Lich Lord
      sheet went from four presupported Baldur files to `Baldur_Fist_L / Baldur_Hammer_R /
      Baldur_the_Invincible / Bodil_the_Wright`, all posed). Fallback proven live
      side-by-side: a side instance with `MODEL_BROWSER_INDEX` at a dead port answered the
      same folder with the old walk's presupported sheet byte-for-byte, while the live
      instance answered the posed one. No all-non-STL folder exists within depth 3 for a
      live `"unindexed"`-with-content case; that branch stands on S2's byte-identity cells
