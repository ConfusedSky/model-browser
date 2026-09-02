# Tasks — bulk-thumbnail-jobs

> Hard ordering, all three before this change: `thumbnail-sweep-priority` (the priority
> bands the job drains through), `listing-tree-cache` §6 (the thumbnail-state index
> — presence, staleness, generation, and the `framed` bit its 6.2 carries for this
> change), `immutable-thumbnail-serving` (the write generation D4's skip reads).
> Re-read all three against main before starting — they are active and parallel-owned.
> `SidePanel` will also be touched by the demo change's chat-tab hiding
> (`web-demo-backlog` 1.3, undrafted): additive on both sides, declare ordering there.

## 1. The job runner

- [ ] 1.1 A job module beside `useThumbnails`' queue plumbing: `(operation, scope)`,
      work list derived at launch from the thumbnail-state index (generate:
      missing/stale in scope; reset: `framed` in scope), snapshotting each entry's
      write generation (D1, D4). No persistence
- [ ] 1.2 Entries feed the render queue at the rank below every interactive band; the
      queue's nearest-first draining is the preemption story (as of the sweep change's
      26dcc18 rederivation: deferred work is outranked, never cancelled) — nothing
      job-specific
- [ ] 1.3 Reset's per-entry op reuses the existing give-up-the-orientation
      implementation (the lightbox/menu action's code path), then renders — one
      definition, fanned out (D3). Generate's is the ordinary render-and-PUT
- [ ] 1.4 Per-entry failure counted, job continues; generation-moved entries skipped
      and counted (D4); cancel stops un-started work at once and lets the in-flight
      entry finish or fail
- [ ] 1.5 One active job: a second launch surfaces the running chip (D2)

## 2. Surfaces

- [ ] 2.1 `EntryMenu`: on dir and zip entries, "Generate thumbnails beneath" and
      "Reset framings beneath", each with its derived count; absent on model entries.
      Reset confirms with the count (D5)
- [ ] 2.2 `SidePanel`: fourth tab `library` with "Generate N missing thumbnails" and
      "Reset N framings" for the whole library; counts from the index, no walk. Tab
      joins the stored-tab rules as `chat`/`search` do (`similar` stays transient)
- [ ] 2.3 The progress chip: app-level, survives navigation, shows
      operation/scope/done/total/failed/skipped, Cancel; dismiss hides without
      cancelling (D2)

## 3. Tests

- [ ] 3.1 Runner: derivation picks exactly missing/stale (generate) and framed (reset);
      relaunch after cancel derives the remainder; generation-moved entry skipped and
      counted; per-entry failure counted, job completes; second launch does not start
      a second job
- [ ] 3.2 Reset op: delegates to the existing give-up implementation (spy on it, don't
      re-assert its semantics — they are `entry-actions`' and already covered), then
      renders
- [ ] 3.3 Surfaces: menu entries only on containers, with counts; reset confirm gates
      the launch and cancelling it launches nothing; library tab buttons state counts;
      chip persists across navigation and cancels the job; harness mocks extended
      additively (every pre-existing test unchanged)

## 4. Verification

- [ ] 4.1 `bun run test` / `bun run typecheck` clean from the workspace dirs
- [ ] 4.2 Live: generate over a partly-rendered kit fills only its gaps while
      scrolling elsewhere stays responsive (visible tiles render first); reset over
      an orbited subtree restores index framings except a model orbited mid-job,
      which is skipped; cancel + relaunch continues; whole-library generate from the
      library tab shows an honest count before and true progress during
