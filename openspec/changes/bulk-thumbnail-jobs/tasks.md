# Tasks — bulk-thumbnail-jobs

> **NOT READY TO IMPLEMENT — two review findings need a design pass first
> (2026-09-02, with Masa):** S2 — nothing delivers the client a subtree/library
> enumeration or count (the thumbnail-state index is server-side, its only seam is
> per-listing-entry annotation, and `/api/dir?flat=true` caps at 500 models with no
> pagination), so the derivation needs either a server scope/count endpoint
> (revising this change's "no new server endpoint" Non-Goal) or a different shape.
> M5 — the reused `refreshThumbnail` body reports per-entry failures to the user
> (one message per failure, wrong fanned out) and resolves poses from the current
> landing's `host.poses` only, so a bulk reset outside a meaning grid would take
> the no-pose branch corpus-wide instead of restoring index framings; the job
> needs its own per-entry op sharing internals, plus its own `semanticPosesFor`
> wave over its scope. Do not start tasks below until both are resolved and this
> banner is replaced with the resolutions.

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

- [ ] 2.1 `ENTRY_COMMANDS` + `commandsFor` (`entryActions.ts` — the one per-kind
      table; `EntryMenu` only draws it, review M7; new `CommandId`s, `applies` on
      containers, the ASCII per-kind table in the doc comment updated, and a
      job-launch capability on `ActionHost`): on dir and zip entries, "Generate
      thumbnails beneath" and
      "Reset framings beneath", each with its derived count; absent on model entries.
      Reset confirms with the count (D5)
- [ ] 2.2 `SidePanel`: fourth tab `library` with "Generate N missing thumbnails" and
      "Reset N framings" for the whole library; counts from the index, no walk. Tab
      does NOT join the stored-tab rules — it follows `similar`'s exclusion instead:
      a tab the feature report can empty is a tab that can be absent, which is the
      condition `StoredTab` exists to exclude, and the `tabStore` parser must not
      learn a value that can name a missing tab (review M8, overturning this line's
      first version)
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
