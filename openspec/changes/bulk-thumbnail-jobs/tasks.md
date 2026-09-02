# Tasks — bulk-thumbnail-jobs

> **Waiting on `listing-tree-cache` §6 through 6.7 — the design pass over the two review
> findings that had this change banned from starting, settled 2026-09-02 with Masa.**
> *S2 (nothing enumerated a scope: the thumbnail-state index is server-side, its only
> seam per-listing annotation, and `/api/dir?flat=true` caps at 500)* is resolved **by
> ordering, not by a route of this change's own**: `listing-tree-cache` grows a scope
> enumeration — its 6.7, every model beneath a path from the snapshot, each with the
> 6.2/6.3 thumbnail facts, uncapped, completeness stated — and this change's derivation
> reads it (design D8). The "no new server endpoint" Non-Goal stands for *this* change.
> The alternative weighed — a walk-and-join route here, over `walkFlat`'s collector and
> the sidecars, landing without waiting — was declined: it pays the cold walk the tree
> cache exists to remove, on every launch and every library-tab open, and is rewritten
> the day §6 lands. *M5 (the reused `refreshThumbnail` reports each failure to the user
> and resolves poses from the current landing's `host.poses`, so a reset outside a
> meaning grid takes the no-pose branch corpus-wide)* is resolved in design D7: one core
> body with the pose as a parameter, the command's wrapper and the job's around it, and
> the job's own orientation wave over its scope. Both are folded into the tasks below.
> **Nothing below starts before 6.7 is on main.**

> Hard ordering, all three before this change: `thumbnail-sweep-priority` (archived
> 2026-09-02 — the priority bands the job drains through), `listing-tree-cache` §6
> through 6.7 (the thumbnail-state index — presence, staleness, generation, the `framed`
> bit its 6.2 carries for this change — and the scope enumeration 6.7 adds for it),
> `immutable-thumbnail-serving` (landed 2026-09-02 — the write generation D4's skip
> reads). `thumbnail-image-serving` (drafted 2026-09-02, uncommitted at this writing)
> stacks on the same §6 and names the annotation shape (`DirEntry.thumb`) the
> enumeration carries; whichever of it and this lands second reuses the other's
> extraction of the hook's hit test (1.1). Re-read all of them against main before
> starting — active and parallel-owned.
> `SidePanel` will also be touched by the demo change's chat-tab hiding
> (`web-demo-backlog` 1.3, undrafted): additive on both sides, declare ordering there.

## 1. The job runner

- [ ] 1.1 A job module beside `useThumbnails`' queue plumbing: `(operation, scope)`. At
      launch, in order: enumerate the scope through `ApiClient` (the tree cache's 6.7
      route — the app's root for the library tab, the tile's path for a menu launch);
      run the job's own orientation wave over the enumerated models (`semanticPosesFor`,
      chunked as the listing wave is, failure is silence — D7/D8); then derive.
      Generate keeps every model whose recipe-in-force variant fails the hook's own hit
      test — missing, stale, `lighting`/`rig` off the constants, or `posed` behind the
      pose the wave holds — through that predicate **extracted** from `useThumbnails`'
      hit branch, never restated (`thumbnail-image-serving` 2.2 extracts the same one;
      whichever lands second reuses it). Reset keeps `framed` entries. Snapshot each kept
      entry's `gen` (D1, D4). An enumeration that reports itself incomplete still runs,
      over what it found, and the chip says the scope was cut. No persistence
- [ ] 1.2 Entries feed the render queue through `RenderQueue.push` with the band
      **pinned to `far`** — a third, optional argument that bypasses the ranking lookup,
      because the job's key is a path the grid may rank *visible* and the spec says no
      better than far. One entry in flight at a time: the next is pushed when the
      previous settles, so a two-wide queue always keeps a slot for interactive work and
      cancel is instant. The queue's nearest-first draining is the rest of the preemption
      story (the sweep change's 26dcc18 rederivation: deferred work is outranked, never
      cancelled)
- [ ] 1.3 Split `refreshThumbnail` (`entryActions.ts`) into a core —
      `renderEntryThumbnail(entry, deps, { discardFraming, pose, expectGen })`, the
      lookup, the resolution (`framingAfterDiscard` on discard, the sweep's rule
      otherwise), the render, the PUT and the `setThumb`; answers `'done' | 'skipped'`,
      throws on failure — and the command's wrapper, which keeps the queue push, the
      pose read from `host.poses` and the `RENDER_FAILED` report. No behaviour change
      for the two commands; their cells stay untouched. The job's per-entry op calls
      the core with the wave's pose and the snapshotted `gen`: the core's own cache read
      compares `cached.gen` to `expectGen` and answers `skipped` when it moved — D4
      costs no second lookup. Reset passes `discardFraming: true`, generate `false` —
      one definition, fanned out (D3, D7)
- [ ] 1.4 Per-entry failure counted from the core's throw — never through
      `host.report` — and the job continues; generation-moved entries skipped and
      counted (D4); cancel stops un-started work at once (nothing further is pushed)
      and lets the in-flight entry finish or fail
- [ ] 1.5 One active job: a second launch surfaces the running chip (D2)

## 2. Surfaces

- [ ] 2.1 `ENTRY_COMMANDS` + `commandsFor` (`entryActions.ts` — the one per-kind
      table; `EntryMenu` only draws it, review M7; new `CommandId`s, `applies` on
      containers, the ASCII per-kind table in the doc comment updated, and a
      job-launch capability on `ActionHost`): on dir and zip entries, "Generate
      thumbnails beneath" and "Reset framings beneath" — **uncounted** labels (D5,
      review M6); absent on model entries. Reset confirms with the derived count before
      anything is discarded; generate's count appears on the chip as the job starts (D5)
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

- [ ] 3.1 Runner: derivation picks exactly missing/stale (generate) and framed (reset)
      from a mocked enumeration; the wave asks poses for exactly the enumerated models,
      and an unowned entry whose `posed` is behind the wave's pose counts as stale;
      relaunch after cancel derives the remainder; generation-moved entry skipped and
      counted; per-entry failure counted, job completes; second launch does not start a
      second job; an incomplete enumeration still runs and is reported cut; every push
      carries the pinned `far` band and at most one job entry is in the queue at a time
      (hold both slots — `client/test/CLAUDE.md`'s render-order rule)
- [ ] 3.2 Reset op: the job's per-entry call reaches the shared core with
      `discardFraming: true` and the wave's pose (spy on the core, don't re-assert its
      semantics — they are `entry-actions`' and already covered); the two commands'
      existing cells pass unchanged through the split
- [ ] 3.3 Surfaces: menu entries only on containers, uncounted; reset confirm gates
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
