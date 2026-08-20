# Tasks — lighting-refreshes-thumbnails

> **Ordering: independent.** Touches `useThumbnails`'s trigger only.
> `thumbnail-sweep-priority` modifies the same *file* (the sweep's ordering) while modifying
> a different *requirement*, so the specs do not collide but the code will — whichever lands
> second re-reads the hook. `entry-context-menu` D7 references this change and does not
> depend on it. Re-read `useThumbnails.ts` and `App.tsx` against main before starting —
> parallel sessions.
>
> **Gate the archive on the title diff** (CLAUDE.md): this MODIFIES *Lighting-mode-aware
> thumbnails*, which carries four shipped scenarios plus the two added here. Re-check them
> against main immediately before archiving, since main moves under long-lived deltas.

## 1. The trigger

- [ ] 1.1 The active lighting mode becomes an input to `useThumbnails` and joins the sweep
      effect's dependency list (`useThumbnails.ts:220`). `App.tsx` already holds it in state
      for the viewer, so no new source of truth — pass the value, do not call
      `getLightingMode()` for the dependency (D1)
- [ ] 1.2 Pass a primitive, not an object rebuilt per render: an equal mode must not
      re-trigger the sweep. This is the failure that turns a toggle into a render loop
- [ ] 1.2a Leave `poses` (`useThumbnails.ts:79`) out of the dependency list, deliberately and
      with a comment. It is the other value read inside the effect and absent from the deps,
      and it is absent on purpose — `App.tsx` sets it after the sweep starts. Adding `lighting`
      beside it without a word invites a later "consistency fix" that adds both and re-runs
      the sweep mid-flight
- [ ] 1.2b `client/test/thumbnailQueue.test.tsx:45` calls the hook with four arguments — fix
      the call sites when the signature changes
- [ ] 1.3 The rig version stays out of the dependency list (D2) — it changes with a build,
      not with a gesture, and nothing on screen is waiting on it

## 2. Behaviour under teardown

- [ ] 2.1 **Keep displayed images across a re-run.** `useThumbnails.ts:105` resets every tile
      to `{ status: 'loading' }`, and the stale branch's `staleUrl` (`:138-146`) is read only
      by the failure path — so with the mode in the deps a toggle blanks the grid to spinners.
      Carry each tile's current image into the new pass and replace it only when its render
      lands (D3). This is the change's real work, not an assertion about existing behaviour
- [ ] 2.2 Own the object URLs across re-runs. Today the URLs of *displayed* tiles (`:126`,
      `:186`) are never revoked when the map is discarded at `:105` — one leak per navigation.
      A mode dependency turns that into a decoded PNG per visible model per toggle, and D3
      invites repeated toggling, so track ownership and revoke on replacement
- [ ] 2.3 A mode change cancels the in-flight sweep's queued renders as a navigation does.
      Note what cancellation does **not** cover: `useThumbnails.ts:181-182` renders and
      `await api.putThumb(...)` before the `if (!alive)` check at `:183`, and `queue.ts:41-43`
      documents that a started job cannot be stopped — so a tile already rendering writes the
      cache under the outgoing mode and can land after the new pass's write. Move the `alive`
      check above the PUT, or accept it and say so; do not assert "no writes from the
      abandoned pass" without one of the two
- [ ] 2.4 Two toggles in quick succession settle under the mode chosen last

## 3. Tests

- [ ] 3.1 Component test: with thumbnails rendered under one mode on screen, switching the
      mode re-renders them without a navigation, preserving camera and axis
- [ ] 3.2 A re-render that is *not* a mode change does not re-run the sweep — assert the
      render count, since 1.2's regression is invisible to a correctness-only assertion
- [ ] 3.2a A toggle over a grid of rendered tiles never shows a spinner where an image was
      (2.1), and the object-URL count does not grow across repeated toggles (2.2)
- [ ] 3.3 A rig-version difference still upgrades lazily on the next visit, not eagerly:
      the shipped scenario "A rig revision refreshes stale thumbnails once" keeps passing
- [ ] 3.4 Do not re-declare `RIG_VERSION` in a test mock — spread the real module
      (CLAUDE.md); a literal masks a future bump

## 4. Verification

- [ ] 4.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 4.2 Confirm no thumbnail pixel path was touched — this change alters when a render is
      requested, never what it draws, so `RIG_VERSION` does not move
- [ ] 4.3 Manual: on a real listing, toggle the mode and watch the grid converge without
      navigating; toggle back mid-pass and confirm it settles under the second choice.
      Thumbnail cache lives at `~/.cache/model-browser/<hash>.{png,json}` — the sidecar's
      `lighting` field is what to grep to confirm the sweep actually rewrote them
