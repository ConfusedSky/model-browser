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

- [ ] 1.1 The effective occlusion preference becomes an input to `useThumbnails` and joins the
      sweep effect's dependency list. `App.tsx` already holds it in state for the viewer and
      the pill, so no new source of truth — pass the value, do not call `aoEnabled()` for
      the dependency (D1)
- [ ] 1.2 Pass a primitive, not an object rebuilt per render: an equal value must not
      re-trigger the sweep. This is the failure that turns a toggle into a render loop
- [ ] 1.2a Leave `poses` (`useThumbnails`' last parameter) out of the dependency list,
      deliberately and with a comment saying why. A pose arriving after a tile's pixels is
      already handled *inside* a run, by `poseStale` against `POSE_VERSION` — not by
      re-running the effect. Adding the preference beside `poses` without a word invites a later "consistency fix" that adds both and re-runs the whole sweep whenever a meaning search lands its poses. Under 2.1's reconciliation, though, `poses` must still reach surviving entries: a meaning search over the tiles on screen replaces `entries` and `poses` together (`App.tsx` `land` → the reducer's `landing`, which replaces the whole result), the overlapping hits are the same path at the same mtime, and an entry that "keeps its state" would never apply its new pose — the requirement's own "An image that predates the source's current mapping is re-rendered" would fail for exactly those tiles. So the reconciler compares each surviving entry's `IndexPose` by value and re-evaluates (lookup, image kept) when it changed
- [ ] 1.2b `thumbnailQueue.test.tsx`'s `Harness` calls the hook with four arguments — fix
      the call sites when the signature changes
- [ ] 1.3 The rig version stays out of the dependency list (D2) — it changes with a build,
      not with a gesture, and nothing on screen is waiting on it
- [ ] 1.4 After `adaptive-ao-default` lands, an automatic decision reaches this trigger
      through the same state as a press — nothing to add here, but assert it there

## 2. Behaviour under teardown

- [ ] 2.1 **Keep displayed images across a re-run.** `useThumbnails`' load effect resets every
      tile to `{ status: 'loading' }`, and the stale branch's `staleUrl` is read only by the
      failure path — so with the preference in the deps a toggle blanks the grid to spinners.
      Carry each tile's current image into the new pass and replace it only when its lookup
      or render lands (D3). The same carry applies when the *entries* change while some
      remain, and there the lifecycle must be per entry, not per pass: the effect's cleanup
      today is one `alive = false` plus every cancel handle, run before any re-run. Per-entry state cannot live in the effect closure — React runs the cleanup before every re-run, so flags created there die together however fine-grained. Hold each entry's alive flag, cancel handle and owned URL in a **ref that outlives the effect**; the effect body reconciles `entries` against it, and only the unmount cleanup disposes everything — and **disposal clears the ref map**, as an invariant: `main.tsx` renders under `<StrictMode>`, which simulates unmount→remount on the same instance with refs preserved, so a disposal that left the map populated would make the remount's reconciler see every entry as already present and start nothing (the dev grid would never load), and one that revoked URLs still held by the preserved `thumbs` state would show revoked blobs. An entries change cancels only the entries that left and leaves in-flight work for entries still present to finish (a `loading` tile must not spin forever because a peek landed); only added entries start loading; removed entries' URLs are revoked. Identity is path **and mtime** — the cache key — so a same-path new-mtime entry is a removal *then* an addition on the same `thumbs` key, in that order (revoke, then write `loading`). The generation key is (identity, effective preference): a *preference* change retires every entry's *work* even though the set is unchanged (2.3) — retirement cancels and re-looks-up but **keeps the owned URL and the displayed state** until the replacement lands (D3's point); only removal revokes. A surviving entry is re-evaluated — lookup, not reset — when its `IndexPose` in `poses` changed **by value** (a re-landing rebuilds the map, so reference comparison would re-look-up every tile on every landing, against the "issue no new lookup" clause); an entry still loading when its pose changes is restarted, since its in-flight render may be using the old pose (1.2a). A third per-entry state, *parked* — cancelled unstarted by `thumbnail-sweep-priority`'s far-band rule (its 3.1), restartable when the tile re-enters (its 3.2) — is distinct from finished; name it in whichever of the two changes lands second. `folder-contact-sheets` depends on
      exactly this. This is the change's real work, not an assertion about existing behaviour. Two `App.tsx` comments justify themselves with "`useThumbnails` resets every thumb to `loading` whenever the entries array changes identity" — the `NO_ENTRIES` block and the `thumbEntries` memo — and become false here; reword them (the memo still earns its place, for reconciliation cost)
- [ ] 2.2 Own the object URLs across re-runs. Today the URLs of *displayed* tiles are never
      revoked when the map is discarded — one leak per navigation. A preference dependency
      turns that into a decoded PNG per visible model per toggle, and D3 invites repeated toggling, so track ownership and revoke on replacement. Ownership must live on the **map value**, not in a hook-private list: `App.tsx` `persist` and `entryActions.refreshThumbnail` both `URL.createObjectURL(png)` and write through `host.setThumb`, so a private list would keep revoking the URL the hook minted while the one actually displayed leaks — `setThumb` revokes the URL it displaces
- [ ] 2.3 A preference change cancels the in-flight sweep's queued renders as a navigation
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
- [ ] 2.4 Two toggles in quick succession settle under the setting chosen last

## 2b. A rule that exists on main but not in the spec

- [ ] 2b.1 Confirm against main before touching anything: `poseStale` already reads
      `wantsPose && cached.camera === undefined && cached.axis === undefined &&
      cached.posed !== POSE_VERSION` (`28289d1`, 2026-08-21). The original of this change
      called it a bug to fix; it is the applied-only predicate the tail uses. Do not "fix"
      it again
- [ ] 2b.2 Assert it survives the second trigger: `semanticSearch.test.tsx` already covers
      the visit case ("a thumbnail the user already aimed is left alone, pose or no pose");
      add the toggle case — a model with a stored camera and a pose, on a meaning grid,
      across a preference change, is a lookup and no render and no PUT beyond the variant
      switch itself. Assert the render count, since the output looks identical either way
- [ ] 2b.3 Land the requirement: the *Recipe-labelled thumbnails* MODIFY states
      the orientation-source label and the applied-only staleness rule, which nothing in
      `openspec/specs/` described before — the label is shipped code with no requirement
      behind it, and `entry-context-menu`'s entry-actions requirement already leans on it
      ("SHALL record which recipe produced those pixels")
- [ ] 2b.4 Note for the reviewer of this change: the predicate is not touched here; the
      section exists because a second trigger is where a regression in it would first
      show, and because the rule belongs in the spec beside the staleness rule it refines

## 3. Tests

- [ ] 3.1 Component test: with thumbnails rendered under one setting on screen, changing the
      preference switches them without a navigation, preserving camera and axis — from
      the cache when the other render exists (assert no render, one lookup per tile), by
      rendering when it does not
- [ ] 3.2 A re-render that is *not* a preference change does not re-run the sweep — assert
      the render count, since 1.2's regression is invisible to a correctness-only assertion
- [ ] 3.2a A toggle over a grid of rendered tiles never shows a spinner where an image was
      (2.1), and the object-URL count does not grow across repeated toggles (2.2)
- [ ] 3.2c Adding entries to a rendered grid leaves the existing tiles' states untouched and
      issues lookups only for the additions; removing entries revokes their URLs; adding
      entries while others are still loading lets those finish (assert their render runs
      once, not twice, and lands); a same-path new-mtime entry is treated as added after the old one is removed (its URL revoked first); a surviving entry whose pose changed by value is re-looked-up and keeps its image meanwhile, while an identical pose under a rebuilt map issues nothing; a loading entry whose pose changes is restarted once; a preference change with an unchanged entry set retires every entry's work but keeps every image; **unmount → remount** (StrictMode's double-invoke, `renderHook` unmount + fresh mount) starts every entry again and leaks no URL; a `setThumb` from outside the hook revokes the URL it displaces
- [ ] 3.2b A posed tile survives a toggle at its pose, not at the default: the tail resolves
      the orientation from the *absence* of a stored camera and axis, so a toggle must
      render it under the pose and re-declare `POSE_VERSION`. Assert it on a meaning grid,
      which is the only place poses are populated — this is the regression that would
      quietly undo every index orientation on screen
- [ ] 3.3 A rig-version difference still upgrades lazily on the next visit, not eagerly:
      the shipped scenario "A rig revision refreshes stale thumbnails once" keeps passing
- [ ] 3.4 Do not re-declare `RIG_VERSION` in a test mock — spread the real module
      (CLAUDE.md); a literal masks a future bump

## 4. Verification

- [ ] 4.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 4.2 Confirm no thumbnail pixel path was touched — this change alters when a lookup is
      requested, never what it draws, so `RIG_VERSION` does not move
- [ ] 4.3 Manual: on a real listing, press the pill and watch the grid converge without
      navigating; press it back mid-pass and confirm it settles under the second choice;
      press it a third time and confirm zero renders (both variants cached). The cache
      lives at `~/.cache/model-browser/<id>/<hash>.{png,noao.png,json}` — the sibling file
      appearing is what to look for
