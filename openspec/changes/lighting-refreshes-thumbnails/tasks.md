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
- [ ] 1.3 The rig version stays out of the dependency list (D2) — it changes with a build,
      not with a gesture, and nothing on screen is waiting on it

## 2. Behaviour under teardown

- [ ] 2.1 A mode change tears the in-flight sweep down exactly as a navigation does: queue
      handles cancelled, minted object URLs released through `dropStale`, no writes from the
      abandoned pass. This path exists and is exercised by navigation; the task is to assert
      it holds when the entries are unchanged and only the mode differs
- [ ] 2.2 Each tile keeps its previous image until its replacement exists, so a toggle over
      a full grid never flashes empty (D3)
- [ ] 2.3 Two toggles in quick succession settle under the mode chosen last

## 3. Tests

- [ ] 3.1 Component test: with thumbnails rendered under one mode on screen, switching the
      mode re-renders them without a navigation, preserving camera and axis
- [ ] 3.2 A re-render that is *not* a mode change does not re-run the sweep — assert the
      render count, since 1.2's regression is invisible to a correctness-only assertion
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
