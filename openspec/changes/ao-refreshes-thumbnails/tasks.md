# Tasks — ao-refreshes-thumbnails

> Formerly `lighting-refreshes-thumbnails`. §2b is the original's, re-targeted; §2 was rewritten in review (the ref-held reconciler is new).
>
> **Ordering (hard):** after `remove-axis-lighting` (this MODIFIES *Recipe-labelled
> thumbnails*, the name that change gives the requirement, and carries its five
> scenarios) and after `ao-as-recipe-dimension` (the preference must reach thumbnails
> before a toggle can refresh them); before `adaptive-ao-default`.
> `thumbnail-sweep-priority` modifies the same *file* (the sweep's ordering) under a
> different requirement — whichever lands second re-reads the hook. Re-read
> `useThumbnails.ts`, `aoToggle.ts` and `App.tsx` against main before starting.
>
> **Gate the archive on the title diff** (CLAUDE.md): re-check the scenarios against the
> post-`remove-axis-lighting` spec immediately before archiving.

## 1. The trigger

- [x] 1.1 The effective occlusion preference becomes an input to `useThumbnails` and joins the
      sweep effect's dependency list. `App.tsx` already holds it in state for the viewer and
      the pill, so no new source of truth — pass the value, do not call `aoEnabled()` for
      the dependency (D1)
      <br>2026-08-31 (ART-1): `useThumbnails` takes the effective preference as its fifth parameter,
      `ao`, and it joins the sweep effect's dependency list; `App`'s `useThumbnails` call
      passes the `ao` state the pill and the viewer already read. The per-entry
      `aoEnabled()` read (and the `aoToggle` import) is gone from the hook — the store is
      now consulted by `App` and `persist` only. Covered by "the other setting's cached
      render is shown at once" and "a setting with no cached render is drawn, at the stored
      camera and axis" (`thumbnailQueue.test.tsx`)
- [x] 1.2 Pass a primitive, not an object rebuilt per render: an equal value must not
      re-trigger the sweep. This is the failure that turns a toggle into a render loop
      <br>2026-08-31 (ART-1): A `boolean`, never a wrapper, and `EntrySlot.ao` compares it with `===`.
      Falsified: handing the `Harness` a fresh `{ on: true }` per render (cast) makes "a
      re-render that is not a preference change re-runs nothing" fail — `expected "spy" to
      be called 3 times, but got 6 times`
- [x] 1.2a Leave `poses` (`useThumbnails`' last parameter) out of the dependency list,
      deliberately and with a comment saying why. A pose arriving after a tile's pixels is
      already handled *inside* a run, by `poseStale` against `POSE_VERSION` — not by
      re-running the effect. Adding the preference beside `poses` without a word invites a later "consistency fix" that adds both and re-runs the whole sweep whenever a meaning search lands its poses. Under 2.1's reconciliation, though, `poses` must still reach surviving entries: a meaning search over the tiles on screen replaces `entries` and `poses` together (`App.tsx` `land` → the reducer's `landing`, which replaces the whole result), the overlapping hits are the same path at the same mtime, and an entry that "keeps its state" would never apply its new pose — the requirement's own "An image that predates the source's current mapping is re-rendered" would fail for exactly those tiles. So the reconciler compares each surviving entry's `IndexPose` by value and re-evaluates (lookup, image kept) when it changed
      <br>2026-08-31 (ART-1): `poses` stays out of the dependency list, with the reason written at the
      list itself (the comment closing the sweep effect). Surviving entries still see a new
      pose: the reconciler compares `IndexPose` by value through `samePose`, which walks
      `up`, `azimuth_zero`, `source`, `confidence` and `front`'s three fields. Both
      directions are cells — "a surviving entry whose pose changed by value is looked up
      again, keeping its image" and "an identical pose under a rebuilt map issues nothing",
      each driven by a rebuilt `entries` array **and** a rebuilt `poses` map, which is what
      a landing really hands over
- [x] 1.2b `thumbnailQueue.test.tsx`'s `Harness` calls the hook with four arguments — fix
      the call sites when the signature changes
      <br>2026-08-31 (ART-1): `Harness` now takes `ao` and `poses` as props and calls the hook with six
      arguments. Two more call sites needed the same fix, not named in the task:
      `thumbnailCommands.test.ts`'s two `Probe` components, which pass `true` — the setting
      the action under test rendered under
- [x] 1.3 The rig version stays out of the dependency list (D2) — it changes with a build,
      not with a gesture, and nothing on screen is waiting on it
      <br>2026-08-31 (ART-1): `RIG_VERSION` is absent from the dependency list, with D2's reason stated
      beside `poses`'. Asserted by "a rig difference is upgraded on the visit and by nothing
      else": a stale-rig hit renders once on the visit, and a further re-render renders
      nothing
- [x] 1.4 After `adaptive-ao-default` lands, an automatic decision reaches this trigger
      through the same state as a press — nothing to add here, but assert it there
      <br>2026-08-31 (ART-1): Nothing to add here — `App`'s `ao` state is the single input, and an
      automatic decision that calls `setAoState` reaches the sweep by the same path a press
      does. To be asserted in `adaptive-ao-default`

## 2. Behaviour under teardown

- [x] 2.1 **Keep displayed images across a re-run.** `useThumbnails`' load effect resets every
      tile to `{ status: 'loading' }`, and the stale branch's `staleUrl` is read only by the
      failure path — so with the preference in the deps a toggle blanks the grid to spinners.
      Carry each tile's current image into the new pass and replace it only when its lookup
      or render lands (D3). The same carry applies when the *entries* change while some
      remain, and there the lifecycle must be per entry, not per pass: the effect's cleanup
      today is one `alive = false` plus every cancel handle, run before any re-run. Per-entry state cannot live in the effect closure — React runs the cleanup before every re-run, so flags created there die together however fine-grained. Hold each entry's alive flag, cancel handle and owned URL in a **ref that outlives the effect**; the effect body reconciles `entries` against it, and only the unmount cleanup disposes everything — and **disposal clears the ref map**, as an invariant: `main.tsx` renders under `<StrictMode>`, which simulates unmount→remount on the same instance with refs preserved, so a disposal that left the map populated would make the remount's reconciler see every entry as already present and start nothing (the dev grid would never load), and one that revoked URLs still held by the preserved `thumbs` state would show revoked blobs. An entries change cancels only the entries that left and leaves in-flight work for entries still present to finish (a `loading` tile must not spin forever because a peek landed); only added entries start loading; removed entries' URLs are revoked. Identity is path **and mtime** — the cache key — so a same-path new-mtime entry is a removal *then* an addition on the same `thumbs` key, in that order (revoke, then write `loading`). The generation key is (identity, effective preference): a *preference* change retires every entry's *work* even though the set is unchanged (2.3) — retirement cancels and re-looks-up but **keeps the owned URL and the displayed state** until the replacement lands (D3's point); only removal revokes. A surviving entry is re-evaluated — lookup, not reset — when its `IndexPose` in `poses` changed **by value** (a re-landing rebuilds the map, so reference comparison would re-look-up every tile on every landing, against the "issue no new lookup" clause); an entry still loading when its pose changes is restarted, since its in-flight render may be using the old pose (1.2a). A third per-entry state, *parked* — cancelled unstarted by `thumbnail-sweep-priority`'s far-band rule (its 3.1), restartable when the tile re-enters (its 3.2) — is distinct from finished; name it in whichever of the two changes lands second. `folder-contact-sheets` depends on
      exactly this. This is the change's real work, not an assertion about existing behaviour. Two `App.tsx` comments justify themselves with "`useThumbnails` resets every thumb to `loading` whenever the entries array changes identity" — the `NO_ENTRIES` block and the `thumbEntries` memo — and become false here; reword them (the memo still earns its place, for reconciliation cost)
      <br>2026-08-31 (ART-1): The lifecycle moved to `EntrySlot`, held in `slotsRef` — a `Map` keyed by
      path whose value carries the identity's `mtime`, a `generation`, the `ao` and
      `IndexPose` the generation started under, its cancel handles and the object URL it
      owns. **Keyed by path, identity by (path, mtime)**: escalated to the coordinator, who
      confirmed the pin conflated identity with storage — `setThumb` is path-only (App's
      `persist`, `entryActions`), so a composite key would have bought a scan and nothing
      else. The sweep effect has no cleanup at all now; it reconciles (remove/revoke →
      add/`loading` → retire survivors whose recipe moved), and a separate mount-only effect
      disposes and **clears** the map. Cells: "adding entries leaves the shown tiles
      untouched and looks up only the additions", "removing an entry revokes its URL and
      leaves the rest alone", "a peek landing mid-pass lets the loading tiles finish — once
      each, and they land", "a same-path new-mtime entry is a removal, then an addition, on
      one key", "a preference change retires every entry's work while every image stays up",
      "under StrictMode's unmount → remount every entry starts again, and no URL leaks", "a
      real unmount releases every displayed URL, and a fresh mount starts over". The
      StrictMode cell renders under a real `<StrictMode>`: an unmount plus a *fresh* mount
      hands out a fresh ref and so cannot see the invariant at all — the first draft of that
      cell passed with `slots.clear()` deleted. Both `App.tsx` comments reworded (the
      `NO_ENTRIES` block and the `thumbEntries` memo, which keeps its place for the
      reconciliation walk). The `parked` state is deliberately **not** introduced: it is
      named in a one-line comment at the retire-and-restart branch, for whichever of the two
      changes lands second
- [x] 2.2 Own the object URLs across re-runs. Today the URLs of *displayed* tiles are never
      revoked when the map is discarded — one leak per navigation. A preference dependency
      turns that into a decoded PNG per visible model per toggle, and D3 invites repeated toggling, so track ownership and revoke on replacement. Ownership must live on the **map value**, not in a hook-private list: `App.tsx` `persist` and `entryActions.refreshThumbnail` both `URL.createObjectURL(png)` and write through `host.setThumb`, so a private list would keep revoking the URL the hook minted while the one actually displayed leaks — `setThumb` revokes the URL it displaces
      <br>2026-08-31 (ART-1): Ownership lives on `EntrySlot.url`, and `setThumb` revokes the URL it
      displaces whoever minted it — so `App`'s `persist` and `entryActions`' re-render write
      through the same accounting. Cells: "a setThumb from outside the hook revokes the URL
      it displaces", and the URL-count half of "a toggle never shows a spinner where an
      image was, and the live URL count holds" (four toggles over three tiles: twelve PNGs
      minted, twelve released, three live). **Beyond the task's letter, and deliberate**
      (approved at the same check-in): `setPlaceholder`'s embedded-3MF preview URL joins the
      slot's ownership too — nothing revoked it before, one decoded PNG per previewed model.
      Asserted by "an embedded preview is released when the render that replaces it lands"
      <br>2026-08-31 (RVW-1): An aggregate review of the landed reconciler found four defects in
      this accounting; all four are fixed here and each has its own cell in
      `thumbnailQueue.test.tsx`, in the reconciler describe. **F1** — `setThumb` joined a URL to
      ownership only where a slot existed, so an `entryActions` job completing after a
      navigation wrote a `thumbs` entry the removal loop never deletes carrying a URL the
      disposal never revokes; a slotless write now revokes and returns ("a setThumb for an entry
      the listing dropped is released, not filed"). **F2** — an outside `setThumb` retired
      nothing, so a sweep tail parked behind a suspended queue landed on top of it: it replaced
      the newer image, revoked its URL, and paired old-angle pixels with the fresh camera in the
      cache. `setThumb` now retires the slot; safe for the hook's own writers because every
      internal `setThumb` is the last act of its pass ("an outside setThumb retires the tail that
      would have landed on top of it"). **F3** — the lookup's `catch` wrote a bare
      `{status:'error'}`, which displaced and so revoked the image the tile was showing, against
      D3's "keep each existing image until its replacement exists"; it now carries the slot's own
      URL, which `setThumb`'s `slot.url !== state.url` guard makes a non-revoking write ("a lookup
      that fails mid-toggle keeps the image the tile is showing"). `Grid` still draws the warning
      rather than the image for an `error` state — the URL is no longer lost, so showing it is a
      later call, not this one's. **F4** — `setPlaceholder` mutated the slot inside the
      `setThumbs` updater, which React may replay; the slot read and assignment are hoisted out,
      and a preview the slot cannot take is revoked rather than leaked. Where the hoisted slot
      check passes and the state guard still refuses (a bare-error tile), the slot keeps the URL
      unshown but owned — the three release paths all walk ownership — which is the coordinator's
      resolution at the check-in, in preference to machinery that detects a non-leak ("a preview
      the state guard refuses is still owned, and released with the entry"). Each of the four
      cells was falsified against its own fix reverted
      <br>2026-08-31 (coordinator): the sibling RVW-1 flagged — the render-tail catch
      blanking a displayed image when a miss's render fails — fixed the same day in the same
      F3 shape; cell "a render that fails after a miss keeps the image the tile is showing",
      falsified (`expected undefined to be 'blob:mint0'`); commit `c9da9bc`
- [x] 2.3 A preference change cancels the in-flight sweep's queued renders as a navigation
      does — unlike an entries change, which cancels only the entries that left (2.1). Note what cancellation does **not** cover: the load effect renders and
      `await api.putThumb(...)` before the `if (!alive)` check that follows, and `queue.ts`'s
      `whenResumed` documents that a started job cannot be stopped (`waiters` is a local
      in `resume()`; grep for the method) — so a tile already rendering
      writes the cache under the outgoing setting and can land after the new pass's write.
      Move the `alive` check above the PUT — the delta's own scenario says the grid settles
      "without the first pass's renders landing on top of it", so accepting the write would
      ship a false scenario. (With `ao-as-recipe-dimension` the outgoing render lands under
      its *own* key, so the write is no longer wrong — but the tile's displayed image would
      still be replaced by the outgoing pass; the `alive` check stays)
      <br>2026-08-31 (ART-1): The `alive()` check moved above `await api.putThumb(...)`; the existing one
      before `setThumb` stays, so one generation is gated twice (approved at the check-in).
      New cell "a render already under way when the preference changes neither writes nor
      lands" hangs `renderThumbnail`, toggles, then releases it. Falsified by restoring the
      old order — deleting only the pre-PUT check: `expected "spy" to not be called at all,
      but actually been called 1 times`
- [x] 2.4 Two toggles in quick succession settle under the setting chosen last
      <br>2026-08-31 (ART-1): "two toggles in quick succession settle under the setting chosen last": the
      off pass's lookup is gated open across a toggle back to on, and it lands nothing — six
      lookups issued, the last naming `true`, no render, no PUT, and neither the first
      pass's URLs nor the retired pass's on screen (`liveUrls()` is 2)

## 2b. A rule that exists on main but not in the spec

- [x] 2b.1 Confirm against main before touching anything: `poseStale` already reads
      `wantsPose && cached.camera === undefined && cached.axis === undefined &&
      cached.posed !== POSE_VERSION` (`28289d1`, 2026-08-21). The original of this change
      called it a bug to fix; it is the applied-only predicate the tail uses. Do not "fix"
      it again
- [x] 2b.2 Assert it survives the second trigger: `semanticSearch.test.tsx` already covers
      the visit case ("a thumbnail the user already aimed is left alone, pose or no pose");
      add the toggle case — a model with a stored camera and a pose, on a meaning grid,
      across a preference change, is a lookup and no render and no PUT beyond the variant
      switch itself. Assert the render count, since the output looks identical either way
- [x] 2b.3 Land the requirement: the *Recipe-labelled thumbnails* MODIFY states
      the orientation-source label and the applied-only staleness rule, which nothing in
      `openspec/specs/` described before — the label is shipped code with no requirement
      behind it, and `entry-context-menu`'s entry-actions requirement already leans on it
      ("SHALL record which recipe produced those pixels")
      — done 2026-08-31 (coordinator): the delta's MODIFIED body carries both (the
      orientation-source mapping-version record and "only where the source would actually
      be applied"), with the two scenarios ("A model with its own orientation is not made
      stale by a pose", "An image that predates the source's current mapping is
      re-rendered"); verified against the archived main-spec text in the /opsx:update pass
      and by the ordered archive dry run the same day
- [x] 2b.4 Note for the reviewer of this change: the predicate is not touched here; the
      section exists because a second trigger is where a regression in it would first
      show, and because the rule belongs in the spec beside the staleness rule it refines
      — standing note, confirmed 2026-08-31 (coordinator): ART-1's diff leaves `poseStale`'s
      three clauses byte-identical to main; only `wantsPose` now reads the generation's
      captured pose

## 3. Tests

- [x] 3.1 Component test: with thumbnails rendered under one setting on screen, changing the
      preference switches them without a navigation, preserving camera and axis — from
      the cache when the other render exists (assert no render, one lookup per tile), by
      rendering when it does not
      <br>2026-08-31 (ART-1): Both halves in `thumbnailQueue.test.tsx`: "the other setting's cached render
      is shown at once" (three tiles, six lookups, zero renders, zero PUTs, camera and axis
      unchanged, each old URL revoked) and "a setting with no cached render is drawn, at the
      stored camera and axis" (a `stale` answer carrying the orientation renders at that
      camera and axis under `ao: false`, PUTting neither back)
- [x] 3.2 A re-render that is *not* a preference change does not re-run the sweep — assert
      the render count, since 1.2's regression is invisible to a correctness-only assertion
      <br>2026-08-31 (ART-1): "a re-render that is not a preference change re-runs nothing" — a rebuilt
      entries array under the same setting; the commit count grows, the lookup, render and
      PUT counts do not. Falsification under 1.2
- [x] 3.2a A toggle over a grid of rendered tiles never shows a spinner where an image was
      (2.1), and the object-URL count does not grow across repeated toggles (2.2)
      <br>2026-08-31 (ART-1): "a toggle never shows a spinner where an image was, and the live URL count
      holds": every committed render across four toggles is asserted `ready:blob:…`, per
      tile, not just the final state. Falsified by restoring the old opening
      `setThumbs(new Map(models.map(…)))` — the cell fails on the first spinner
- [x] 3.2c Adding entries to a rendered grid leaves the existing tiles' states untouched and
      issues lookups only for the additions; removing entries revokes their URLs; adding
      entries while others are still loading lets those finish (assert their render runs
      once, not twice, and lands); a same-path new-mtime entry is treated as added after the old one is removed (its URL revoked first); a surviving entry whose pose changed by value is re-looked-up and keeps its image meanwhile, while an identical pose under a rebuilt map issues nothing; a loading entry whose pose changes is restarted once; a preference change with an unchanged entry set retires every entry's work but keeps every image; **unmount → remount** (StrictMode's double-invoke, `renderHook` unmount + fresh mount) starts every entry again and leaks no URL; a `setThumb` from outside the hook revokes the URL it displaces
      <br>2026-08-31 (ART-1): Nine cells, all in `thumbnailQueue.test.tsx`'s second describe, listed under
      2.1 and 2.2 above; the pose pair and the loading-entry restart are under 1.2a. Every
      one drives the real hook through the `Harness`
- [x] 3.2b A posed tile survives a toggle at its pose, not at the default: the tail resolves
      the orientation from the *absence* of a stored camera and axis, so a toggle must
      render it under the pose and re-declare `POSE_VERSION`. Assert it on a meaning grid,
      which is the only place poses are populated — this is the regression that would
      quietly undo every index orientation on screen
      <br>2026-08-31 (ART-1): `semanticSearch.test.tsx`, "a posed thumbnail comes back from a toggle at
      its pose, not at the default": the occluded render is a posed hit, the unoccluded one
      a miss, and the toggle renders at `cameraForPose(POSE, DEFAULT_CAMERA)` — asserted
      against that value, with a guard that it differs from `DEFAULT_CAMERA` so the cell
      cannot pass on a default-framed render — and PUTs `posed: POSE_VERSION`, `ao: false`,
      no camera
- [x] 3.3 A rig-version difference still upgrades lazily on the next visit, not eagerly:
      the shipped scenario "A rig revision refreshes stale thumbnails once" keeps passing
      <br>2026-08-31 (ART-1): The shipped scenario's test ("a hit from an older rig re-renders, preserving
      camera, and PUTs the current version") still passes untouched, and "a rig difference
      is upgraded on the visit and by nothing else" adds the half this change could have
      broken
- [x] 3.4 Do not re-declare `RIG_VERSION` in a test mock — spread the real module
      (CLAUDE.md); a literal masks a future bump
      <br>2026-08-31 (ART-1): `thumbnailQueue.test.tsx`'s renderer mock still spreads the real module and
      overrides only `renderThumbnail`; no test in this change names a `RIG_VERSION` value.
      `appHarness`'s `rendererModule` is untouched

## 4. Verification

- [x] 4.1 `bun run typecheck` and `bun run test` pass across workspaces
      <br>2026-08-31 (ART-1): 2026-08-31 (ART-1), this worktree: `cd client && bunx vitest run` → 49 files,
      544 tests passed. `bun run typecheck` from the root → server and client both exit 0.
      The server suite was run too and is unchanged: 9 passed / 1 skipped, 300 passed / 3
      skipped — nothing under `server/` or `shared/` was touched
- [x] 4.2 Confirm no thumbnail pixel path was touched — this change alters when a lookup is
      requested, never what it draws, so `RIG_VERSION` does not move
      <br>2026-08-31 (ART-1): No pixel path touched: `git diff --stat -- client/src/three/ client/src/viewer/
      server/ shared/` is empty, so `renderer.ts` (and `RIG_VERSION`), `pose.ts`, `camera.ts`
      and `session.ts` are all untouched. The whole diff is `App.tsx` (the hook call and two
      comments), `useThumbnails.ts`, and four client test files. This change alters when a
      lookup is requested, never what is drawn
- [x] 4.3 Manual: on a real listing, press the pill and watch the grid converge without
      navigating; press it back mid-pass and confirm it settles under the second choice;
      press it a third time and confirm zero renders (both variants cached). The cache
      lives at `~/.cache/model-browser/<id>/<hash>.{png,noao.png,json}` — the sibling file
      appearing is what to look for
      — done 2026-08-31 (coordinator), dev instance on the real library, in-page fetch
      recorder over `/Warhammer/angry-dinosaur…` (41 models, occluded-only cached): pill
      off → 41 `ao=off` lookups and 41 `ao:false` PUTs converged in place, URL unchanged,
      displayed image count never dropped (5 spinners present at press time were the
      initial visit's still-loading tiles). The mid-pass case occurred naturally: those 5
      tiles' outgoing occluded renders were retired without landing — the toggle back on
      answered 41 lookups with exactly 5 PUTs, the 5 whose first-pass work was suppressed.
      Third press (off again): 41 lookups, 0 PUTs — both variants cached. Sibling
      `.noao.png` files confirmed on disk in the earlier 3.4 pass (38/38 pairs)
