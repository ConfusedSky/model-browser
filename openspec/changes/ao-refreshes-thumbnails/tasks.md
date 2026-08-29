# Tasks — ao-refreshes-thumbnails

> Formerly `lighting-refreshes-thumbnails`; sections 2 and 2b are the original's.
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
      re-running the effect. Adding the preference beside `poses` without a word invites a
      later "consistency fix" that adds both and re-runs the whole sweep whenever a meaning
      search lands its poses
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
      or render lands (D3). This is the change's real work, not an assertion about existing
      behaviour
- [ ] 2.2 Own the object URLs across re-runs. Today the URLs of *displayed* tiles are never
      revoked when the map is discarded — one leak per navigation. A preference dependency
      turns that into a decoded PNG per visible model per toggle, and D3 invites repeated
      toggling, so track ownership and revoke on replacement
- [ ] 2.3 A preference change cancels the in-flight sweep's queued renders as a navigation
      does. Note what cancellation does **not** cover: the load effect renders and
      `await api.putThumb(...)` before the `if (!alive)` check that follows, and `queue.ts`'s
      `waiters` documents that a started job cannot be stopped — so a tile already rendering
      writes the cache under the outgoing setting and can land after the new pass's write.
      Move the `alive` check above the PUT — the delta's own scenario says the grid settles
      "without the first pass's renders landing on top of it", so accepting the write would
      ship a false scenario. (With `ao-as-recipe-dimension` the outgoing render lands under
      its *own* key, so the write is no longer wrong — but the tile's displayed image would
      still be replaced by the outgoing pass; the `alive` check stays)
- [ ] 2.4 Two toggles in quick succession settle under the setting chosen last

## 2b. A pre-existing loop this change makes hotter

- [ ] 2b.1 Fix `poseStale`: it asks whether a pose *exists*, not whether the render would
      *use* one. The load effect sets `poseStale = wantsPose && cached.posed !==
      POSE_VERSION`, but the tail applies a pose only when the model has neither a stored
      camera nor a stored axis. So a model that has been orbited **and** has an index pose
      is permanently stale: `posed` is null, the PUT writes `posed: undefined` (before the
      `alive` re-check), `ThumbCache.put` clears the label on any PNG write, and the next
      meaning-grid visit repeats the whole render and upload. Read-verified against main,
      not run. Narrow the predicate to "a pose that would be applied" — the same condition
      the tail uses — so a model with its own orientation is simply a hit
- [ ] 2b.2 Test it: a model with a stored camera and a pose is a cache hit on the second
      meaning-grid visit, with no render and no PUT. Assert the render count, since the
      output looks identical either way — which is why this has gone unnoticed
- [ ] 2b.3 Land the requirement with the fix: the *Recipe-labelled thumbnails* MODIFY states
      the orientation-source label and the applied-only staleness rule, which nothing in
      `openspec/specs/` described before — the label is shipped code with no requirement
      behind it, and `entry-context-menu`'s entry-actions requirement already leans on it
      ("SHALL record which recipe produced those pixels")
- [ ] 2b.4 Note for the reviewer of this change: the defect predates it. It is fixed here
      because this change gives the sweep a second trigger, so what was one wasted render
      per meaning-grid visit becomes one per toggle as well, and because the fix belongs
      beside the staleness rule rather than in a change about menus

## 3. Tests

- [ ] 3.1 Component test: with thumbnails rendered under one setting on screen, changing the
      preference switches them without a navigation, preserving camera and axis — from
      the cache when the other render exists (assert no render, one lookup per tile), by
      rendering when it does not
- [ ] 3.2 A re-render that is *not* a preference change does not re-run the sweep — assert
      the render count, since 1.2's regression is invisible to a correctness-only assertion
- [ ] 3.2a A toggle over a grid of rendered tiles never shows a spinner where an image was
      (2.1), and the object-URL count does not grow across repeated toggles (2.2)
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
