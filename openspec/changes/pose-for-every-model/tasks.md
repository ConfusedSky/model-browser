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
      dependency list** → 2 fail (re-run 2026-08-31 by the review worker on `393d61a`; the
      recorded "1 fail" undercounted, and the message it carried was the *other* cell's):
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
