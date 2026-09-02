# Tasks — thumbnail-sweep-priority

> **Rebased 2026-09-01 against main `62f9f2d`.** The pre-rebase ordering note
> named `ao-refreshes-thumbnails` and `folder-contact-sheets` as *drafted* changes
> to coordinate with; both archived 2026-08-31, along with `ao-as-recipe-dimension`
> and `remove-axis-lighting`, and `pose-for-every-model` is complete. Their
> constraints are therefore no longer negotiable ordering — they are the shape of
> the code, and every task below is written against it. In particular: this change
> lands second, so the *parked* per-entry state is **this change's to name**
> (`ao-refreshes-thumbnails` 2.1's "name it in whichever of the two changes lands
> second"), and the shared-observer joining is this change's to do
> (`folder-contact-sheets` 2.2's "done as the **standalone** observer … that
> change does the joining when it does").
>
> Ordering now: independent of the remaining active changes. `adaptive-ao-default`
> only feeds `useThumbnails`' `ao` argument; `library-overrides` archived
> 2026-09-01 (its `displayName` label is in `Grid.tsx`'s tile body now, outside
> the observer effect); `listing-tree-cache` and `search-cancellation` touch
> neither this capability nor these files; and nothing active touches
> `queue.ts`. Still re-read `queue.ts`, `useThumbnails.ts`, `Grid.tsx` and
> `App.tsx` against main before starting — parallel sessions.
>
> No `RIG_VERSION` bump: this is scheduling, not the recipe.
>
> Re-verified 2026-09-02 at HEAD by an opus review; its findings are folded in
> below. Renumbering note for readers arriving from archived changes: the 09-01
> rebase moved lines, so `score-floor-by-default` 4.2b's "carried to 5.3" now
> means **6.3**, and `ao-refreshes-thumbnails` 2.1's "its 3.1 … its 3.2" now
> means **3.4 … 3.5** — the archived files keep their old pointers.

## 1. Queue priority

- [x] 1.1 `RenderQueue.push` takes a key with the job; `pump` selects the
      best-ranked pending job instead of `jobs.shift()`, with ties keeping
      insertion order so an unranked queue behaves exactly as today's FIFO (D1).
      Ties matter more than they look: `App`'s `thumbEntries` carries preview
      models whose paths may never be reported by any tile, so "unranked" is a
      live case, not a fallback. The `far` rank sorts *below* unranked — an
      unreported path may be anywhere, a far one is known off screen — and far
      jobs are in the queue at all only through D4's warm-mesh exception. A
      **keyless** push (`refreshThumbnail` and `setOrbitAxis` in `entryActions`
      pass no key, and stay that way — their renders belong to no slot and are
      unparkable by construction) ranks with `visible`: both exist only because
      the user pressed an on-screen control (D1). A path absent from the
      ranking is unreported, **never far** — a replacement that defaulted
      missing paths to far would pass every ordering cell while parking the
      world; assert absent ≠ far explicitly
- [x] 1.2 A method to replace the whole ranking at once (the grid recomputes bands
      wholesale on scroll, rather than moving keys one at a time)
- [x] 1.2a `push`'s cancel handle **reports whether the job was still pending**
      (D4): parking must fire `dropStale` only for a job that never ran — a
      started job keeps its `staleUrl` for its own `catch`'s fallback, and a
      park that revoked it under a render that then failed would write the
      error state 3.4 forbids
- [x] 1.3 Unit tests in `client/test/queue.test.ts`, DOM-free as its four existing
      cells are: ranked jobs run before unranked and unranked before far;
      keyless jobs run with visible-ranked ones; a re-ranking mid-flight changes
      what runs next but never interrupts a running job; ties preserve insertion
      order; the cancel handle answers true for a pending job and false for a
      started one; concurrency and the `suspend`/`resume`/`whenResumed` gating
      are unchanged

## 2. Visibility

- [x] 2.1 Widen `Grid`'s **existing** observer effect (the one keyed on
      `[entries, onPeek]` that watches `[data-dir-tile]`): observe model tiles
      too — they already carry `data-model-tile={entry.path}`, so no tile markup
      changes — and report three coarse bands (visible / near / far) through
      **two observers in this one effect** (D2): the widened existing one
      carries the park `rootMargin` (its events are the far-boundary
      crossings, and `onPeek`), and a new margin-less one over the same tiles
      splits visible from near (its events upgrade a prefetched tile the moment
      it scrolls on screen). One observer cannot do it — one `rootMargin` yields
      two states, and `intersectionRatio` is measured against the *expanded*
      root, so visible and near both read ~1.0. **Both observers take `App`'s
      `<main>` scroller as their `root`** — App gives `<main>` a `ref` and
      passes the **`RefObject`, never its `.current`** (stable in deps;
      `.current` is populated during commit before passive effects, so the
      skip-until-populated guard is belt-and-braces, while passing the element
      hands the first render `null` with nothing ever retrying) — because the
      intersection algorithm clips the
      target against every clipping ancestor before the margin applies: against
      the default viewport root, a tile scrolled out of `<main>` reports empty
      whatever the margin, and `near` silently collapses to the viewport edge
      (D2). The margin itself is a named constant, tuned and frozen in 6.2, not
      an adjective. Band transitions are exactly observer callbacks: no scroll
      listener, no rect math, no throttle of our own. The per-path band is
      derived from the two observers' *last* records: the effect's closure holds
      a plain `Map<path, {inPark, inView}>` (rebuilt with the observers), each
      callback updates its half, and the band is `inView` → visible, else
      `inPark` → near, else far — republished wholesale via `setBands` after
      each callback batch. `onPeek` rides the band observer — a deliberate
      timing change (today's observer has no `rootMargin`): the peek now fires
      at the park boundary, screens early, which is what a prefetch band is for
      (D2). `previews` reaches the registration rule through a ref kept fresh
      per render — **not** the dependency array, which would rebuild both
      observers per landed peek (a new map identity each time) — and a small
      effect keyed on `previews` alone republishes the tracked bands, so a
      landed peek's models join their folder's band at once with no observer
      churn. The seam between the two effects is a ref, not a shared closure
      (two effects cannot share one): the tracked `Map` in a component-level
      `useRef`, the publish function written to `publishRef` by the observer
      effect, the previews effect declared **after** it and calling
      `publishRef.current?.()` (D2). The observer effect's full dependency
      list after this change is `[entries, onPeek, setBands, mainRef]` — every
      entry identity-stable or listing-scoped; three separate decisions (the
      previews ref, 2.5's wrapper identity, the `RefObject`) exist to keep
      anything unstable out of it
- [x] 2.2 **Drop `observer.unobserve(record.target)`** from that effect: a band
      tracker must keep watching a tile after its first intersection. Safe because
      `App`'s `requestPeek` already refuses a repeat with
      `if (previewsRef.current.has(path) || inFlightPeeks.current.has(path)) return`
      — that guard was the backstop and becomes the only guard, so a regression in
      it now costs a duplicate peek per scroll rather than per re-render. Assert it
      (task 4.1) rather than trusting it. Update `awayAndBack()`'s docstring in
      `folderSheets.test.tsx` in the same commit — it credits the dropped
      `unobserve` for stopping a second report
- [x] 2.3 A folder tile registers **its preview models' paths under its own band**;
      a path that is both a visible tile and a far folder's preview takes the
      *nearest* band — a per-path max — so a far band never cancels visible work
      (D2; the rule is `folder-contact-sheets` tasks 2.2 and its "preview renders
      compete with tile renders for the queue" risk, which deferred only the code).
      The folder's preview paths are in `App`'s `previews` map, which `Grid`
      already receives as the `previews` prop
- [x] 2.4 Bands **never** become a `Tile` prop — `tilePropsEqual` is a keys-based
      shallow compare, so one would re-render all 500 tiles per scroll settle. The
      observer reads paths off the DOM attributes and reports them imperatively
      (D2/D3)
- [x] 2.5 **Filter-hidden models are reported far, by `App`** (D3): `Grid`
      renders `shownEntries` while the hook sweeps `thumbEntries`, so a model
      the find filter hides has a slot but no tile — unreported, never parked,
      ranked above far, and the sweep would read gigabytes for entries the user
      just filtered away. `App` wraps the `setBands` it hands to `Grid`,
      adding `far` before forwarding, under two rules that are each
      load-bearing (D3, round-2 review): the hidden set is **`entries` minus
      `filteredListing`** (model paths; the anchor is prepended separately and
      exempt; kind-hidden tiles are deliberately included) — never
      "`thumbEntries` minus `shownEntries`", whose difference contains every
      folder-preview model by construction and would park the sheet cells of a
      folder on screen; and the merge **never overwrites a band the incoming
      map reports** (D2's per-path max at App's layer) — a hidden tile can
      simultaneously be a visible folder's preview cell, and the folder's
      registration must win. The wrapper is `useCallback` with an empty
      dependency list reading both lists through per-render refs (the
      `requestPeek` idiom), so `Grid`'s effect sees one stable identity —
      built on the lists it would churn per keystroke and per landed peek

## 3. The parked state

- [x] 3.1 `useThumbnails` returns `setBands(map)` beside `setThumb`,
      `setPlaceholder` and `discardThumbFraming`; `App` holds it by identity (as it
      holds `onPeek`) and passes it to `Grid`. **Document the contract where it is
      declared**: idempotent, latest-wins per path, safe at scroll-settle
      frequency, and it parks/unparks slots *without* a sweep-effect re-run —
      including the one-sentence reason a `bands` argument was rejected, so nobody
      simplifies back to a dependency that would pay a 500-entry reconcile walk per
      scroll (D3). Idempotent means **cheap when equal**: early-exit on a map
      equal to the one in force — `shownEntries`' identity changes per
      find-filter keystroke, re-running the observer effect and republishing
      ~500 unchanged bands, which must cost nothing. The accepted map lives in
      a hook-held ref and is **read, not only pushed** (D3): the lookup tail
      (3.3a) and the kept job's start-time check (3.4a) consult it, so
      park-ness is derived at the moment work would commit — which is what
      parks slots created after the last report (StrictMode's remount clears
      `slotsRef` while the observers republish an identical map the early-exit
      then swallows; a same-path-new-mtime slot starts unconditionally). And
      resolve every park or
      restart through `slotsRef` **at call time** — a band map is a message from
      the DOM's past, and a path with no live slot is a no-op, never a captured
      slot object acted on after its retirement
- [x] 3.2 `EntrySlot` gains its `DirEntry` (subsuming `mtime`) — say **why** in the
      field's comment: a parked slot must restart through `start(entry, slot)`
      outside the sweep effect, where there is no `entries` array to look the entry
      up in (D3)
- [x] 3.3 Make the render tail separately cancellable. Today `slot.cancels` is a
      flat, unlabelled `(() => void)[]` holding the lookup handle, then `dropStale`
      and the `queue.push` handle, and only `retire` fires it — firing all of it. A
      parked slot needs the render handle alone, plus `dropStale` — but only when
      the handle reports the job was still pending (1.2a): a started job keeps
      its `staleUrl` for its own `catch`'s fallback (D4)
- [x] 3.3a `EntrySlot` gains **`parked: boolean`**, and the lookup tail consults
      it before `queue.push` (D4): the render handle and `dropStale` are
      registered *inside* the tail, so at park time the render may not exist
      yet — the lookup is in flight, and cancelling it is forbidden. A parked
      slot's tail runs `dropStale` and files no render (unless the mesh is
      warm — 3.4a applies at the flag exactly as at the handle, pushing at the
      far rank). The tail consults the flag **and the band ref** (3.1) — a
      current `far` report gates exactly as `parked` does, which is what parks
      work for slots created after the last report. The gate is the flag and
      the ref, **never queue ranking** — a
      lowest-ranked job still runs eventually, and running is what a parked
      cold tail must not do. This is D5's own path: every recipe/pose
      retirement of a parked slot runs a fresh lookup whose tail hits this gate
- [x] 3.3b Two ordering rules on the flag (D4): `retire` never clears `parked`
      (the flag is the band's fact, the generation the recipe's — a pose wave
      retiring a parked slot leaves it parked, or the wave resurrects exactly
      the job the band parked); and unpark is never a bare `start` — it is
      clear-flag, `retire`, `start`, so a lookup in flight for the current
      generation is dead before its successor exists, and one slot can never
      run two passes of one generation (two lookups, two PUTs, a double mesh
      read — both would pass `alive()`)
- [x] 3.4 A tile entering the `far` band parks its **unstarted** render; a started
      job runs to completion — it holds a renderer slot and its mesh read is in
      flight (D4). A parked slot keeps everything it displays: `slot.url` is
      untouched, so the tile shows what it had — the `{ status: 'loading' }`
      placeholder, an embedded-3MF preview from `setPlaceholder`, or a previous
      render — and **never** the error state `model-thumbnails` reserves for a model
      that failed to load or parse
- [x] 3.4a **The warm-mesh exception** (D4/D6): entering `far` cancels the render
      only when the mesh is neither held nor loading — `MeshLru` gains a
      **held-or-loading peek** beside `has` (`has` reads only `entries`, so a
      `warm()` hover or an acquire still in flight read as cold and their
      renders would be parked while the read completes anyway; a kept job's
      `acquire` joins the pending promise, no second read). A warm-mesh render
      stays queued at the far rank — last, behind unranked work — and the kept
      job re-checks when it starts, **band first, then mesh** (D4): woken with
      its tile back on screen it reads and renders (an unconditional mesh check
      stranded a visible tile on `loading` forever — kept means never flagged,
      visible means no future unpark); woken cold **and still far** it parks
      itself **and sets `slot.parked`**, so the ordinary unpark path reaches
      it. Parking never causes a mesh read. The peek, like `has`, must never
      bump recency — an acquire at park time would distort eviction toward
      exactly the meshes being deprioritised
- [x] 3.5 Re-entering the viewport restarts a parked slot through the reconciler's
      own retire/start seam — the one whose comment already names this plug-in
      point ("This is also where a *parked* entry … would be restarted when its
      tile comes back") — via 3.3b's clear-flag → `retire` → `start`, resolving
      the slot through `slotsRef` at call time (3.1). Update that comment to
      describe what landed rather than what was anticipated. No mtime re-check
      here: a parked entry back at a new mtime is the reconciler's ordinary
      removal-then-addition — the slot is retired and replaced, never unparked
      into staleness. The mesh LRU makes the restart cheap (D6)

## 4. Composing with the recipe (D5)

- [x] 4.1 A preference or pose retirement **restarts the lookup for every slot,
      parked or not, and leaves a far slot's render parked.** A parked far tile
      whose new-recipe render is already cached therefore repaints at once, which
      is what keeps *Recipe-labelled thumbnails*' "showing a render already cached
      under the new setting at once" literally true for every tile; one whose new
      recipe is not cached stays parked and renders when its tile returns —
      unless its mesh is still warm, in which case the tail is pushed at the far
      rank and completes once nothing better-ranked is pending (3.4a's
      exception, applied by 3.3a's tail gate — the flag and the band ref both)
- [x] 4.2 A parked tail restarts under the slot's **current** `(ao, pose)`, never
      the recipe it was parked under. This falls out of `start` reading `slot.ao`
      and `slot.pose` at restart time rather than being enforced separately —
      assert it, since it is the kind of property a refactor can silently break by
      capturing the recipe at park time
- [x] 4.3 Confirm the reconciler's survivor branch
      (`if (slot.ao === ao && samePose(slot.pose, pose)) continue`) is not the
      unparking path and must not become one: it `continue`s a parked slot, whose
      inputs are unchanged, and visibility is not a dependency of that effect

## 5. Tests

- [x] 5.1 Hook-level cells in `client/test/thumbnailQueue.test.tsx` (the reconciler
      suites live there — "the sweep reconciles its entries instead of resetting
      them", "a preference change refreshes the grid in front of you"): a large
      uncached listing with the bottom tiles reported visible renders those before
      the earlier ones — the assertion that fails under FIFO; a tile parked before
      starting is not rendered; parked and unparked, it ends up rendered and never
      shows the error state; a preference change over a parked far tile issues its
      lookup but no render, and shows a cached new-setting render at once (4.1); a
      parked tail restarts under the current recipe, not the parked one (4.2); a
      listing with all thumbnails cached is unaffected (those never enter the
      queue); a far tile whose mesh the LRU still holds is rendered after every
      visible tile rather than parked, and its PNG is filed (3.4a) — with the
      control that the same tile with a cold mesh is parked; a kept far job
      whose mesh was evicted before its turn, its tile still far, does not call
      `acquire` (`acquire` on the fake is the observable read — the file has no
      loader, 5.1a) — and the flag it sets is asserted by **consequence**, not
      by inspection (`EntrySlot` is module-private): report the path `visible`
      afterwards and assert it renders, which only passes if the self-park set
      `parked`, since re-ranking alone would find no queued job; the same
      kept job woken with its tile no longer reported far calls `acquire` and
      renders — never a stranded `loading` tile (3.4a); a pose or
      preference retirement of a parked cold slot issues its lookup and **no
      push and no `acquire`** — D5's own path through
      3.3a's gate; a slot created after the last report — the reconciler's
      same-path-new-mtime replacement — is still gated far by the band ref
      (3.1); an unpark landing while the retirement's lookup is in flight
      runs one pass, not two — **one acquire, one render** (3.3b; the PUT count
      alone cannot falsify this, found by falsification: `setThumb`'s own
      retire kills the second pass before *its* PUT either way, so the
      double-start's real cost is the doubled read and render at concurrency
      two); a park
      landing after a render started, where that render then fails, falls back
      to its stale PNG and never shows the error state (1.2a — the unconditional
      `dropStale` revokes the fallback out from under the catch); a band map
      omitting a path leaves that path unreported and unparked — absent is
      never far (1.1)
- [x] 5.1a Extend `thumbnailQueue.test.tsx`'s LRU fakes first: every cell builds
      `{ acquire: vi.fn() } as unknown as MeshLru` (ten-plus occurrences), so
      the moment the tail consults the held-or-loading peek, every cell that
      reaches it throws. One shared factory returning `{ acquire, has, <peek> }`
      over a test-owned warm set, used by all cells — the warm set is also how
      the 3.4a cells stage warm/cold/evicted
- [x] 5.2 App-mount cells in `client/test/folderSheets.test.tsx`, **extending**
      its `StubObserver`, `vi.stubGlobal('IntersectionObserver', StubObserver)`,
      `intersect(el)` and `awayAndBack()` rather than writing a second stub —
      happy-dom's own `IntersectionObserver` has no-op `observe`/`disconnect`, so a
      real one makes every cell pass by never running. Extending, because the
      helpers as they stand cannot express the states these cells assert:
      `intersect` delivers `isIntersecting: true` to *every* live observer
      watching the element — with two observers that always reads `visible`,
      while `near` needs one observer addressed and not the other, and `far`
      needs a `false` report. Give the stub an observer selector and the helper
      an intersecting argument (e.g. `report(el, {inPark, inView})`). Cover: a
      preview model takes
      its folder tile's band (2.3); a path that is both a visible tile and a far
      folder's preview takes the nearest band; dropping `unobserve` still yields
      exactly one peek per folder per listing, through `requestPeek`'s guard
      (2.2); a **visible** folder whose preview models are not listing entries
      has those models unparked and rendered — the cell that fails if 2.5's
      wrapper over-reaches into the preview set; a filter-hidden model is
      reported far through App's wrapper and parks (2.5 — this cell lives here,
      not in 5.1: the wrapper, `shownEntries` and `Grid` exist only in an
      App mount); and a filter-hidden tile that is also a visible folder's
      preview cell takes the folder's band — the merge never overwrites a
      report (2.5)
- [x] 5.3 Confirm no renderer-mock updates are needed and `RIG_VERSION` is
      untouched — this changes scheduling, not the recipe; if a renderer mock
      needs touching, that is a signal something rendering-related moved.
      (`thumbnailQueue.test.tsx` spreads the real renderer module, so a bump
      would surface rather than hide.) The **LRU fakes** are the mocks that do
      need updating — that is 5.1a, done first, not a smell

## 6. Verification

- [x] 6.1 `bun run typecheck` and `bun run test` pass across workspaces
- [x] 6.2 Manual E2E via Playwright MCP against the real library, with the thumbnail
      cache cleared for the target directory
      (`~/.cache/model-browser/<library-id>/`): open a 500-tile flat listing, scroll
      immediately to the bottom, and confirm visible tiles resolve in seconds rather
      than after the earlier ~490. Record the measured time-to-first-visible-image
      before and after — the proposal's claim is time-to-image for what you are
      looking at, not total sweep time, and the numbers should say exactly that.
      Re-measure the 2026-08-18 baseline in the same run rather than citing it: it
      is a relayed figure from that session. Three sub-checks ride the same run:
      **(a)** a tile one screen below the fold reports `near`, not `far` — the
      check that catches an observer whose `root` is not the scroller, which
      makes the margin inert and every band collapse to the viewport edge (D2);
      **(b)** tune the park margin and freeze it — record the chosen value, the
      screen height it was judged at, and the constant it lives in (it decides
      both peek timing and park oscillation, and "generous" is not a value);
      **(c)** count kept versus parked far jobs — the warm-mesh exception's
      benefit is asserted in prose and should be seen firing (D4's honest-bound
      paragraph)
- [x] 6.3 **Inherited from `score-floor-by-default` 4.2b**, which archived
      (2026-08-27) with this as its one open line — it was blocked on this change
      and had nowhere else to live. Re-measure the capped-set sweep once 6.2 is
      done, using a **capped meaning search** as the fixture, not only a flat
      listing: the two caps are different symbols (`listFlat`'s `cap` from
      `envLimit('MODEL_BROWSER_FLAT_CAP', 500)` for the listing,
      `MAX_RESULT_COUNT = 500` in `shared/types.ts` for the index), and this line is
      about the latter. That cap is a **wall**, not a horizon — so the whole 500 are
      plausible matches a user will scroll, which is exactly the case this change
      exists for. Prioritising visible tiles is what makes a capped meaning result
      usable rather than merely correct.
      <br>The figures the carried line quotes are **relayed from
      `score-floor-by-default`'s 2026-08-27 run** and are the thing to re-measure,
      not to re-cite: `fantasy character` returning 875 models above the 0.1 floor,
      the 500th tile at `k 0.122` against a first tile of `k 0.146`, and
      ~1.07 thumbnails/s. Re-run them here and record whose run the new numbers are
      from

## Run record — 6.2/6.3 (2026-09-02, this session's run, Playwright MCP)

Conditions: real library (`/run/media/masa/STLLibrary`, 500-model flat cap),
cold cache (backed up and restored around the run), 1280×900 window, 809 px
scrollport, dev instance. Sweep throughput measured **0.80 thumbnails/s** over
the first 100 s (the 2026-08-18 relay said ~1.07/s; both are one machine's
cold-cache figure — re-measure, don't re-cite).

- **6.2 headline**: deep scroll to the bottom of the 500-tile flat listing.
  FIFO baseline (same build, observers silenced — D1's fallback *is* the old
  behaviour): first visible image **not yet rendered at 100 s**, 80 renders all
  at the top; extrapolated ~9–10 min to reach the bottom at measured
  throughput. With bands: **first visible image 2.2 s**, all 16 visible tiles
  filled in **9.2 s**, only 1 non-visible render before them.
- **6.2a**: renders after settling: 16 visible + 28 within two
  scrollport-heights (the near band, alive through the scroller root) + 1
  boundary tile, then the sweep **stopped** — flat across 60 s of watching.
- **6.2b**: `PARK_ROOT_MARGIN` frozen at `'200% 0px 200% 0px'`; the judged
  conditions live in the constant's own comment (Grid.tsx). ±1-screen
  oscillation ×3 added only the freshly exposed prefetch rows; a deliberate
  jump to the middle unparked and rendered 13/20 visible tiles in 15 s.
- **6.2c**: kept vs parked on the cold sweep: **0 kept, 455 parked** of 500 —
  the warm-mesh exception fires on toggle paths, not fresh sweeps, exactly as
  D4's honest-bound paragraph predicts.
- **6.3**: `fantasy character` at the 0.1 floor, top 500: **826 matched**
  (2026-08-27's relay said 875 — the library moved), 500 returned, first tile
  k 0.146, 500th k 0.119. Deep scroll to the weakest matches: first visible
  image **2.1 s**, all visible filled in **8.3 s** — the capped wall is now
  browsable end to end, which is what this change owed `score-floor-by-default`.
