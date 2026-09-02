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

## 1. Queue priority

- [ ] 1.1 `RenderQueue.push` takes a key with the job; `pump` selects the
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
- [ ] 1.2 A method to replace the whole ranking at once (the grid recomputes bands
      wholesale on scroll, rather than moving keys one at a time)
- [ ] 1.2a `push`'s cancel handle **reports whether the job was still pending**
      (D4): parking must fire `dropStale` only for a job that never ran — a
      started job keeps its `staleUrl` for its own `catch`'s fallback, and a
      park that revoked it under a render that then failed would write the
      error state 3.4 forbids
- [ ] 1.3 Unit tests in `client/test/queue.test.ts`, DOM-free as its four existing
      cells are: ranked jobs run before unranked and unranked before far;
      keyless jobs run with visible-ranked ones; a re-ranking mid-flight changes
      what runs next but never interrupts a running job; ties preserve insertion
      order; the cancel handle answers true for a pending job and false for a
      started one; concurrency and the `suspend`/`resume`/`whenResumed` gating
      are unchanged

## 2. Visibility

- [ ] 2.1 Widen `Grid`'s **existing** observer effect (the one keyed on
      `[entries, onPeek]` that watches `[data-dir-tile]`): observe model tiles
      too — they already carry `data-model-tile={entry.path}`, so no tile markup
      changes — and report three coarse bands (visible / near / far) through
      **two observers in this one effect** (D2): the widened existing one
      carries the generous park `rootMargin` (its events are the far-boundary
      crossings, and `onPeek`), and a new zero-margin one over the same tiles
      splits visible from near (its events upgrade a prefetched tile the moment
      it scrolls on screen). One observer cannot do it — one `rootMargin` yields
      two states, and `intersectionRatio` is measured against the *expanded*
      root, so visible and near both read ~1.0 — and `Grid` has no scroll
      handle to patch it with (the scroller is `App`'s `<main>`; scroll does
      not bubble). Band transitions are exactly observer callbacks: no scroll
      listener, no rect math, no throttle of our own. The per-path band is
      derived from the two observers' *last* records: the effect's closure holds
      a plain `Map<path, {inPark, inView}>` (rebuilt with the observers), each
      callback updates its half, and the band is `inView` → visible, else
      `inPark` → near, else far — republished wholesale via `setBands` after
      each callback batch. `onPeek` rides the band observer — a deliberate
      timing change (today's observer has no `rootMargin`): the peek now fires
      at the park boundary, screens early, which is what a prefetch band is for
      (D2). Add `previews` to the effect's deps so a landed peek's models join
      their folder's band (bounded: one peek per folder, and 3.1's equal-map
      early-exit makes the republish free)
- [ ] 2.2 **Drop `observer.unobserve(record.target)`** from that effect: a band
      tracker must keep watching a tile after its first intersection. Safe because
      `App`'s `requestPeek` already refuses a repeat with
      `if (previewsRef.current.has(path) || inFlightPeeks.current.has(path)) return`
      — that guard was the backstop and becomes the only guard, so a regression in
      it now costs a duplicate peek per scroll rather than per re-render. Assert it
      (task 4.1) rather than trusting it
- [ ] 2.3 A folder tile registers **its preview models' paths under its own band**;
      a path that is both a visible tile and a far folder's preview takes the
      *nearest* band — a per-path max — so a far band never cancels visible work
      (D2; the rule is `folder-contact-sheets` tasks 2.2 and its "preview renders
      compete with tile renders for the queue" risk, which deferred only the code).
      The folder's preview paths are in `App`'s `previews` map, which `Grid`
      already receives as the `previews` prop
- [ ] 2.4 Bands **never** become a `Tile` prop — `tilePropsEqual` is a keys-based
      shallow compare, so one would re-render all 500 tiles per scroll settle. The
      observer reads paths off the DOM attributes and reports them imperatively
      (D2/D3)

## 3. The parked state

- [ ] 3.1 `useThumbnails` returns `setBands(map)` beside `setThumb`,
      `setPlaceholder` and `discardThumbFraming`; `App` holds it by identity (as it
      holds `onPeek`) and passes it to `Grid`. **Document the contract where it is
      declared**: idempotent, latest-wins per path, safe at scroll-settle
      frequency, and it parks/unparks slots *without* a sweep-effect re-run —
      including the one-sentence reason a `bands` argument was rejected, so nobody
      simplifies back to a dependency that would pay a 500-entry reconcile walk per
      scroll (D3). Idempotent means **cheap when equal**: early-exit on a map
      equal to the one in force — `shownEntries`' identity changes per
      find-filter keystroke, re-running the observer effect and republishing
      ~500 unchanged bands, which must cost nothing. And resolve every park or
      restart through `slotsRef` **at call time** — a band map is a message from
      the DOM's past, and a path with no live slot is a no-op, never a captured
      slot object acted on after its retirement
- [ ] 3.2 `EntrySlot` gains its `DirEntry` (subsuming `mtime`) — say **why** in the
      field's comment: a parked slot must restart through `start(entry, slot)`
      outside the sweep effect, where there is no `entries` array to look the entry
      up in (D3)
- [ ] 3.3 Make the render tail separately cancellable. Today `slot.cancels` is a
      flat, unlabelled `(() => void)[]` holding the lookup handle, then `dropStale`
      and the `queue.push` handle, and only `retire` fires it — firing all of it. A
      parked slot needs the render handle alone, plus `dropStale` — but only when
      the handle reports the job was still pending (1.2a): a started job keeps
      its `staleUrl` for its own `catch`'s fallback (D4)
- [ ] 3.3a `EntrySlot` gains **`parked: boolean`**, and the lookup tail consults
      it before `queue.push` (D4): the render handle and `dropStale` are
      registered *inside* the tail, so at park time the render may not exist
      yet — the lookup is in flight, and cancelling it is forbidden. A parked
      slot's tail runs `dropStale` and files no render (unless the mesh is
      warm — 3.4a applies at the flag exactly as at the handle, pushing at the
      far rank). The gate is the flag, **never queue ranking** — a
      lowest-ranked job still runs eventually, and running is what a parked
      cold tail must not do. This is D5's own path: every recipe/pose
      retirement of a parked slot runs a fresh lookup whose tail hits this gate
- [ ] 3.3b Two ordering rules on the flag (D4): `retire` never clears `parked`
      (the flag is the band's fact, the generation the recipe's — a pose wave
      retiring a parked slot leaves it parked, or the wave resurrects exactly
      the job the band parked); and unpark is never a bare `start` — it is
      clear-flag, `retire`, `start`, so a lookup in flight for the current
      generation is dead before its successor exists, and one slot can never
      run two passes of one generation (two lookups, two PUTs, a double mesh
      read — both would pass `alive()`)
- [ ] 3.4 A tile entering the `far` band parks its **unstarted** render; a started
      job runs to completion — it holds a renderer slot and its mesh read is in
      flight (D4). A parked slot keeps everything it displays: `slot.url` is
      untouched, so the tile shows what it had — the `{ status: 'loading' }`
      placeholder, an embedded-3MF preview from `setPlaceholder`, or a previous
      render — and **never** the error state `model-thumbnails` reserves for a model
      that failed to load or parse
- [ ] 3.4a **The warm-mesh exception** (D4/D6): entering `far` cancels the render
      only when `MeshLru.has(entry.path)` answers false. A warm-mesh render stays
      queued at the far rank — last, behind unranked work — and the kept job
      re-checks `lru.has` when it starts, parking itself then if the mesh was
      evicted in the meantime, so parking never causes a mesh read. `has` is
      a peek and must stay one — an acquire (or any recency bump) at park time
      would distort eviction toward exactly the meshes being deprioritised
- [ ] 3.5 Re-entering the viewport restarts a parked slot through the reconciler's
      own retire/start seam — the one whose comment already names this plug-in
      point ("This is also where a *parked* entry … would be restarted when its
      tile comes back") — via 3.3b's clear-flag → `retire` → `start`, resolving
      the slot through `slotsRef` at call time (3.1). Update that comment to
      describe what landed rather than what was anticipated. No mtime re-check
      here: a parked entry back at a new mtime is the reconciler's ordinary
      removal-then-addition — the slot is retired and replaced, never unparked
      into staleness. The mesh LRU makes the restart cheap (D6)

## 4. Composing with the recipe (D5)

- [ ] 4.1 A preference or pose retirement **restarts the lookup for every slot,
      parked or not, and leaves a far slot's render parked.** A parked far tile
      whose new-recipe render is already cached therefore repaints at once, which
      is what keeps *Recipe-labelled thumbnails*' "showing a render already cached
      under the new setting at once" literally true for every tile; one whose new
      recipe is not cached stays parked and renders when its tile returns —
      unless its mesh is still warm, in which case the tail is pushed at the far
      rank and completes once nothing better-ranked is pending (3.4a's
      exception, applied at the `parked` flag by 3.3a's tail gate)
- [ ] 4.2 A parked tail restarts under the slot's **current** `(ao, pose)`, never
      the recipe it was parked under. This falls out of `start` reading `slot.ao`
      and `slot.pose` at restart time rather than being enforced separately —
      assert it, since it is the kind of property a refactor can silently break by
      capturing the recipe at park time
- [ ] 4.3 Confirm the reconciler's survivor branch
      (`if (slot.ao === ao && samePose(slot.pose, pose)) continue`) is not the
      unparking path and must not become one: it `continue`s a parked slot, whose
      inputs are unchanged, and visibility is not a dependency of that effect

## 5. Tests

- [ ] 5.1 Hook-level cells in `client/test/thumbnailQueue.test.tsx` (the reconciler
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
      control that the same tile with a cold mesh is parked; a kept far job whose
      mesh was evicted before its turn parks without the LRU loader firing
      (assert on the loader mock, which is the read the rule forbids); a pose or
      preference retirement of a parked cold slot issues its lookup and **no
      push and no read** — the loader mock again, on D5's own path through
      3.3a's gate; an unpark landing while the retirement's lookup is in flight
      files **exactly one PUT** (3.3b — the double-start writes two); a park
      landing after a render started, where that render then fails, falls back
      to its stale PNG and never shows the error state (1.2a — the unconditional
      `dropStale` revokes the fallback out from under the catch); a band map
      omitting a path leaves that path unreported and unparked — absent is
      never far (1.1)
- [ ] 5.2 App-mount cells in `client/test/folderSheets.test.tsx`, reusing its
      `StubObserver`, `vi.stubGlobal('IntersectionObserver', StubObserver)`,
      `intersect(el)` and `awayAndBack()` rather than writing a second stub —
      happy-dom's own `IntersectionObserver` has no-op `observe`/`disconnect`, so a
      real one makes every cell pass by never running. Cover: a preview model takes
      its folder tile's band (2.3); a path that is both a visible tile and a far
      folder's preview takes the nearest band; dropping `unobserve` still yields
      exactly one peek per folder per listing, through `requestPeek`'s guard (2.2)
- [ ] 5.3 Confirm no renderer-mock updates are needed and `RIG_VERSION` is
      untouched — this changes scheduling, not the recipe; if a mock needs touching,
      that is a signal something rendering-related moved. (`thumbnailQueue.test.tsx`
      spreads the real renderer module, so a bump would surface rather than hide)

## 6. Verification

- [ ] 6.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 6.2 Manual E2E via Playwright MCP against the real library, with the thumbnail
      cache cleared for the target directory
      (`~/.cache/model-browser/<library-id>/`): open a 500-tile flat listing, scroll
      immediately to the bottom, and confirm visible tiles resolve in seconds rather
      than after the earlier ~490. Record the measured time-to-first-visible-image
      before and after — the proposal's claim is time-to-image for what you are
      looking at, not total sweep time, and the numbers should say exactly that.
      Re-measure the 2026-08-18 baseline in the same run rather than citing it: it
      is a relayed figure from that session
- [ ] 6.3 **Inherited from `score-floor-by-default` 4.2b**, which archived
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
