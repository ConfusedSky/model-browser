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
> **What can start today:** 1.0 (the PUT's two fields), 1.3's `refreshThumbnail` split,
> and 1.2's pinned-band argument on `RenderQueue.push` — none touches what the
> enumeration owns. **Everything else waits for 6.7 to be on main.**

> Hard ordering, all three before this change: `thumbnail-sweep-priority` (archived
> 2026-09-02 — the priority bands the job drains through), `listing-tree-cache` §6
> through 6.7 (the thumbnail-state index — presence, staleness, generation, the `framed`
> bit its 6.2 carries for this change — and the scope enumeration 6.7 adds for it),
> `immutable-thumbnail-serving` (landed 2026-09-02 — the write generation D4's skip
> reads). `thumbnail-image-serving` (committed 2026-09-02 in e787add, not started)
> stacks on the same §6 and names the annotation shape (`DirEntry.thumb`) the
> enumeration carries; whichever of it and this lands second reuses the other's
> extraction of the hook's hit test (1.1). Re-read all of them against main before
> starting — active and parallel-owned.

> **Implemented 2026-09-02** (foreman run: opus workers in isolated worktrees, one per
> stage, every diff line-reviewed by the coordinator on a different model, every
> behavioural cell falsified before trusted). Stage A — server PUT fields and the
> hook/queue seams (28a9393, c2270f3); Stage B — the runner and the per-entry ops
> (4d3d5c1); Stage C — the surfaces (f47f3d0); the coordinator's review fixes
> (652b05f); then a merge of main, which had landed `thumbnail-image-serving` §2/§4 in
> the same files. Evidence per task is on its line. **4.2 is not run** — see its note.
> `SidePanel` is also touched by `public-deployment` (its chat-tab fallback): additive on
> both sides, no hard ordering — whichever lands second rebases its tab list, as that
> change's tasks declare too. Its `maintenance` field is what these surfaces gate on
> once it exists (5.1).

## 1. The job runner

- [x] 1.0 Server: two additive fields on `PUT /api/thumb` (`app.ts`, `cache.ts`; the
      delta's new `model-thumbnails` requirement, ADD-only — `thumbnail-image-serving`
      and `public-deployment` both hold ADD-only deltas there with distinct titles,
      checked against main 2026-09-02). `png: null` is its **own branch** in
      `ThumbCache.put`, never a value fed through the `opts.png !== undefined` tests —
      every one of them reads `null` as pixels: it would adopt the mtime, label a render
      that has no bytes, and can trip `supersedes`, and `get` would then answer `stale`
      rather than a miss. The branch: both PNGs `rm`'d, both renders' labels emptied, no
      mtime adopted, the sidecar kept — camera and axis governed by the same write's own
      fields, `gen` bumped through `allocateGen` as every write is, so the number stays
      monotonic across the emptying. Both hops must tell `null` from absent:
      `ApiClient.putThumb`'s png ternary (`save.png !== undefined ? … : undefined`)
      drops a `null` on the wire today, and the route's `body.png !== undefined ?
      Buffer.from(…)` would read one as bytes. `ifGen: number` makes the write
      conditional: a value other than the entry's current generation answers 412 with
      nothing written (a missing entry's current generation is 0). Cells in
      `cache.test.ts` / `api.test.ts`: a delete that also discards the camera empties
      both variants and the next GET of each is a miss (the reset job's own write); a
      delete that keeps a camera answers `stale` with no pixels and the camera intact
      (`get`'s camera-bearing rule); a matching `ifGen` writes and a stale one 412s with
      the sidecar byte-identical; the 412 is distinguishable from a 400; a `null` png
      survives `putThumb`'s serialization. `ApiClient.putThumb`'s `ThumbSave` grows both
      fields; the harness mock extended additively
      — landed 2026-09-02 (28a9393, worker A1): the deletion is its own early-return
      branch in `ThumbCache.put` (`merged` helper for the orientation fields);
      `StaleWriteError` carries the current gen and the route answers
      `ThumbPutRefused` at 412 from a local try/catch; `putThumb` serialises `null`
      and sends `ifGen`; `ApiClient.models` added beside `listDir`. Cells: both variants
      miss after a delete-with-discard; a kept camera answers `stale`; a stale `ifGen`
      leaves the sidecar byte-identical; 412 ≠ 400; `"png":null` on the raw body.
      Falsified ×3 (the client ternary, the precondition, `null` through the pixel
      path)
- [x] 1.1 A job module beside `useThumbnails`' queue plumbing: `(operation, scope)`. At
      launch, in order: enumerate the scope through `ApiClient` (the tree cache's 6.7
      route — the app's root for the library tab, the tile's path for a menu launch);
      run the job's own orientation wave over only the enumerated models whose
      annotation carries no pose — the tree cache's pose layer rides the enumeration as
      it rides a listing, so this is 6.4's rule: ask the index about the unknowns, not
      the library (`semanticPosesFor`, chunked as the listing wave is, failure is
      silence — D7/D8); then derive.
      Generate keeps every model whose recipe-in-force variant fails the hook's own hit
      test — missing, stale, `lighting`/`rig` off the constants, or `posed` behind the
      pose the wave holds — through that predicate **extracted** from `useThumbnails`'
      hit branch, never restated (`thumbnail-image-serving` 2.2 extracts the same one;
      whichever lands second reuses it). Reset keeps `framed` entries. Snapshot each kept
      entry's `gen` (D1, D4). An enumeration that reports itself incomplete still runs,
      over what it found, and the chip says the scope was cut. The enumeration reaches
      the client through `ApiClient` — the method 6.7 adds, or one this change adds
      beside `listDir` if 6.7 left the seam server-side — with the harness mock extended
      additively. The library tab's buttons read "Counting…" until the derivation lands,
      and a launch re-derives: a count is a derivation, not a reservation. No
      persistence
      — landed 2026-09-02 (4d3d5c1, worker B1; 652b05f, coordinator): `BulkJobs` in
      `client/src/jobs/bulkJobs.ts`, `derive`/`count` over one private `enumerate`
      (one walk, one wave — the review found the tab paying two), `keeps` the shared
      filter. Cells: what generate keeps and drops (each label, the ao variant in
      force, unowned-behind-pose vs owned), reset keeps `framed`, the wave asks only
      the unposed, a rejected wave derives silent, `incomplete`, `count` walks once
- [x] 1.2 Generate's entries feed the render queue through `RenderQueue.push` with the band
      **pinned to `far`** — a third, optional argument that bypasses the ranking lookup,
      because the job's key is a path the grid may rank *visible* and the spec says no
      better than far. One entry in flight at a time: the next is pushed when the
      previous settles, so a two-wide queue always keeps a slot for interactive work and
      cancel is instant. The queue's nearest-first draining is the rest of the preemption
      story (the sweep change's 26dcc18 rederivation: deferred work is outranked, never
      cancelled). The far gate `thumbnail-image-serving` D5 adds (its `setFarGate`,
      bounded by `FAR_GATE_MAX_MS`) will hold a pinned-far job entry while a nearer
      lookup is pending — with one entry in flight that stalls the whole job for as long
      as the user is actively browsing, bounded by the gate's own timeout. Accepted and
      stated here: that is the preemption the spec asks for, and an exemption would put
      a mesh read ahead of a visible tile's lookup
      — landed 2026-09-02 (c2270f3, worker A2): `RenderQueue.push(run, key?, band?)`,
      `rankOf` reads a pinned band before the ranking. Cells under the render-order
      rule: pinned far waits for a later near though its key ranks visible; ties with
      ranked far in insertion order both ways; survives a promoting re-rank; a pinned
      visible outruns unreported work. Falsified (rankOf ignoring the pin: all four
      fail). One entry in flight is the runner's loop (4d3d5c1, cell "at most one entry
      is in the queue at a time" holding both slots). The far gate landed on main in
      the same day (`thumbnail-image-serving` 4.x) — the interaction stated above holds
      as written
- [x] 1.3 Two per-entry ops. **Generate**: split `refreshThumbnail` (`entryActions.ts`)
      into a core — `renderEntryThumbnail(entry, deps, { discardFraming, pose, ifGen })`,
      the lookup (kept, deliberately: the orientation rendered from is the one in force
      when the render runs, not when the scope was enumerated — one small GET per model
      against a render-bound job), the resolution (`framingAfterDiscard` on discard, the
      sweep's rule otherwise), the render, the PUT (forwarding `ifGen`) and the
      `setThumb`; answers
      `'done' | 'skipped'` (a 412 is `skipped`), throws on failure — and the command's
      wrapper, which keeps the queue push, the pose read from `host.poses` and the
      `RENDER_FAILED` report. No behaviour change for the two commands; their cells stay
      untouched. While there, correct `ActionHost.poses`' doc comment: it says the map
      is filled by a meaning or similarity landing only, but `App` hands it the merged
      `poses` memo, which the listing wave fills for plain listings too (the review
      caught this; D7). The job calls the core with `discardFraming: false`, the wave's
      pose and the entry's snapshotted `gen` (D7). **Reset**: no render, no queue, no
      mesh — one PUT per entry, `{ camera: null, axis, png: null, ifGen }` with
      `axis: null` exactly where `framingAfterDiscard` (the shared reading of the
      discard rule, D3) reports a usable pose replaced it against the wave's pose, else
      `undefined` (keep). Its `keptAxis` argument is immaterial here — `posed` is
      `cameraForPose(pose) !== null`, independent of the axis — which is exactly why the
      axis rule can be evaluated without a render; pass the annotation's axis. Then the
      in-memory half — a tile on screen drops its image and re-looks-up through a new
      `refetch(path)` on `useThumbnails` beside `setThumb` (nothing restarts a slot on
      a server-side write: the sweep effect restarts one only on add, mtime, `ao` or a
      pose change by value), a tile off screen is simply not in the map. Sequential,
      one PUT in flight, cancel between two: a few thousand small writes at loopback
      latency is seconds. An axis-only entry with no usable pose has nothing to discard
      yet still loses its renders and moves its `gen` — one forced re-render, accepted
      rather than special-cased: it was counted, and the user asked for it. A 412 is
      `skipped`
      — landed 2026-09-02 (4d3d5c1, worker B1): `renderEntryThumbnail(entry, deps,
      { discardFraming, pose, ifGen?, skipIfCurrent? })` answers `'done' | 'skipped' |
      'current'` — the third value was added at implementation (a job's derivation
      reads an annotation that may be older than the cache; the core's own fresh read
      is the last word, so a current entry costs one GET and no render; D7 updated) —
      and `refreshThumbnail` is the wrapper; the reset op is the plain PUT with
      `framingAfterDiscard` spied in its cell. `refetch(path)` on `useThumbnails`
      (c2270f3) blanks, forgets the gen, restarts through the effect's own `start` via a
      ref — and B1 moved the hook's gen adoption below the `alive()` gate after A2's
      review found a late pre-reset lookup could hand its deleted-entry gen to the
      restart (cell "never lets the pre-write lookup hand its generation to the
      restart"). `ActionHost.poses`' comment corrected. The two commands' cells pass
      unchanged through the split
- [x] 1.4 Per-entry failure counted from the core's throw or the PUT's rejection — never
      through `host.report` — and the job continues; generation-moved entries (412)
      skipped and counted (D4); cancel stops un-started work at once (nothing further is
      pushed or sent) and lets the in-flight entry finish or fail
      — landed 2026-09-02 (4d3d5c1). Cells: 412 counts skipped, a thrown render counts
      failed and the job reaches `done`; all-failed sets `NOTHING_PROCESSED`; an
      unreadable scope sets `SCOPE_UNREADABLE`; cancel mid-run pushes nothing further
      and still counts the in-flight entry. **An all-skipped job ends `done` with
      "0 of N · N skipped"** — the pin kept, since every skip is the user's own
      later write and the chip shows exactly that
- [x] 1.5 One active job: a second launch surfaces the running chip (D2)
      — landed 2026-09-02 (4d3d5c1). The coordinator's review found the hole the pin
      did not name: a run cancelled mid-entry and replaced by a new launch settled its
      last patches onto the *new* job's state. `RunToken` is now a run's identity and
      every patch from `run` goes through `patchRun(token, …)`; cell "lets a stale run
      report nothing onto the job that replaced it", falsified against the bare patch

## 2. Surfaces

- [x] 2.1 `ENTRY_COMMANDS` + `commandsFor` (`entryActions.ts` — the one per-kind
      table; `EntryMenu` only draws it, review M7; new `CommandId`s, `applies` on
      containers, the ASCII per-kind table in the doc comment updated, and a
      job-launch capability on `ActionHost`): on dir and zip entries, "Generate
      thumbnails beneath" and "Reset framings beneath" — **uncounted** labels (D5,
      review M6); absent on model entries. Reset confirms with the derived count before
      anything is discarded; generate's count appears on the chip as the job starts (D5)
      — landed 2026-09-02 (f47f3d0, worker C): rows between `findSimilar` and
      `reRenderThumbnail`, `applies` on containers gated on
      `ctx.features?.thumbWrites === true` (`AvailabilityContext.features` added; the
      offer rule); `ActionHost.launchJob`; `JOB_BUSY` beside `RENDER_FAILED`. Eight
      pre-existing exact-list assertions widened (entryMenu, openInApps,
      orbitAxisMenu, thumbnailActions, similarTuning ×4) — semantics-is-the-point, each
      named in the worker's report, and falsified once with `thumbWrites: false`
- [x] 2.2 `SidePanel`: fourth tab `library` with "Generate N missing thumbnails" and
      "Reset N framings" for the whole library; counts from the index, no walk. Tab
      does NOT join the stored-tab rules — it follows `similar`'s exclusion instead:
      a tab the feature report can empty is a tab that can be absent, which is the
      condition `StoredTab` exists to exclude, and the `tabStore` parser must not
      learn a value that can name a missing tab (review M8, overturning this line's
      first version)
      — landed 2026-09-02 (f47f3d0; 652b05f): `library` last in the strip, only with a
      non-null `library` prop; `StoredTab` excludes it, the parser unchanged; leaving-
      only fallback to `chat`; one token-guarded count per opening and per job end
      (`recountKey`). The coordinator's review fixed two things: the count seam was
      keyed on a closure rebuilt with the action host — every pose landing would have
      re-enumerated the library (cell "counts once per opening, not once per landing",
      falsified) — and a failed enumeration left the buttons counting forever; they now
      read "Count failed" and reselecting the tab asks again.
      **Two more from Masa's live presses (2026-09-02, on main):** a subtree reset left
      its models in the library's count — `framed` (camera OR axis) counts an axis the
      per-model rule keeps when no usable pose replaces it, so a reset could never
      clear it and the button offered a reset that reset nothing; `keeps('reset')` now
      asks the shared rule and counts exactly what a discard would change (cell "keeps
      exactly the models whose framing a reset would change", falsified against the
      bare `framed`). And the count moved only when a job ended: `ActionHost.framingChanged`
      is now called by the four hand-written framing sites — App's `persist`, the axis
      command, the lightbox's live reset, the core's discard. **Then Masa's second
      objection, same day:** re-deriving per hand change was 7.8 MB and sixteen index
      requests per orbit on the real library (18,737 models, measured), and the phase-keyed
      recount re-derived twice per press of the tab's own Reset before anything was written.
      Now: the sites report the write in the PUT's three states, App turns it into ±1
      against the tile's pre-write state through `resettable` (the one rule, shared with
      the derivation), the tab shows its derived count plus the change since it landed, and
      re-derives only on opening and when a job that wrote something ends; a count's wave
      covers axis-only models alone (design D8). Cells: "moves the reset count by hand
      without re-deriving the library" (falsified twice: signal muted, delta never
      applied), "does not recount for a launch that wrote nothing" (falsified: phase-keyed
      recount made four enumerations for one press), "waves only over the axis-only models".
      **Opus review of the four main-side commits (2026-09-03), six should-fixes, all
      applied:** the delta read a loading or errored tile as "unframed" (+1 on an orbit of
      a framed model, −1 lost on a reset) — the discard now hands over its own lookup's
      before-state and App falls back to the tile's ready state, then the annotation,
      then silence; an unknown pose made an axis-only state read −1 and clamped the button
      shut — silent now; the recount was keyed on the phase, which Cancel sets before the
      in-flight write lands — the runner reports `settled` and `wrote`, and only a settled
      job that wrote recounts (`'current'` no longer counts as a write); the panel's
      baseline was read at landing, swallowing a hand change made while the count was in
      flight — captured at request time; `resettable`'s `framed` parameter was dead on the
      wire and load-bearing only for fixtures — dropped, fixtures spell the camera; the
      detached JSDoc and three stale comments corrected. Cells: "reads the before-state from
      the discard's own lookup when the tile is still loading", "adds a hand change made
      while the count was in flight", "recounts for the write a cancel could not recall",
      "does not recount for a generate that found everything current", and the runner's
      `wrote`/`settled` cells — each falsified against its restored bug.
      **A fresh Opus review of that fix (2026-09-03), two should-fixes and seven nits,
      all applied:** the recount was keyed on the state object, and every patch is a new
      object, so × on a settled chip re-derived the library — keyed on `JobState.runId`
      now (cell "does not recount again when the settled chip is dismissed", falsified);
      the annotation fallback was stale in both directions after a reset's own refetch or
      a failed render — dropped, the delta reads the site's lookup or the tile's ready
      state and is otherwise silent; a derivation that threw while cancelled never
      settled; the chip's "Generated N" counted entries found current — it counts writes
      and says "· N already current"; the `wrote` cell's fixture was symmetric and could
      not tell `wrote` from `done − wrote` — asymmetric now; the dead `framed` guard in
      `keeps`, the detached runner JSDoc and the `framingChanged` doc's dropped ordering
      clause corrected; the unindexed-library consequence of the silence rule recorded in
      D8
- [x] 2.3 The progress chip: app-level, survives navigation, shows
      operation/scope/done/total/failed/skipped, Cancel; dismiss hides without
      cancelling (D2)
      — landed 2026-09-02 (f47f3d0; 652b05f): `JobChip`, pure props, five phases,
      buttons named Cancel/Reset/Dismiss; sits at `bottom-14 left-3` because the
      occlusion pill owns `bottom-3 left-3` and drew over it (the worker's own
      finding). Cells: survives navigation and Cancel there stops the job; Dismiss
      does not cancel (two-entry scope, falsified); a second launch keeps one job and
      says `JOB_BUSY`

## 3. Tests

- [x] 3.1 Runner: derivation picks exactly missing/stale (generate) and framed (reset)
      from a mocked enumeration; the wave asks poses for exactly the enumerated models,
      and an unowned entry whose `posed` is behind the wave's pose counts as stale;
      relaunch after cancel derives the remainder; generation-moved entry skipped and
      counted; per-entry failure counted, job completes; second launch does not start a
      second job; an incomplete enumeration still runs and is reported cut; every push
      carries the pinned `far` band and at most one job entry is in the queue at a time
      (hold both slots — `client/test/CLAUDE.md`'s render-order rule)
      — `client/test/bulkJobs.test.ts`, 29 cells (2026-09-02)
- [x] 3.2 Reset op: one PUT per framed entry carrying `camera: null`, `png: null` and
      the snapshotted `ifGen`, with `axis: null` exactly when `framingAfterDiscard`
      reports a usable pose (spy on it — the rule is `entry-actions`' and already
      covered); no render pushed, no mesh acquired, the wave asked first; a 412 counts as
      skipped; an on-screen tile re-looks-up after the write. Generate op: the job's call
      reaches the shared core with `discardFraming: false`; the two commands' existing
      cells pass unchanged through the split
      — `client/test/thumbnailCommands.test.ts` (+5) and the reset cells in
      `bulkJobs.test.ts` (2026-09-02)
- [x] 3.3 Surfaces: menu entries only on containers, uncounted; reset confirm gates
      the launch and cancelling it launches nothing; library tab buttons state counts;
      chip persists across navigation and cancels the job; harness mocks extended
      additively (every pre-existing test unchanged)
      — `client/test/bulkJobSurfaces.test.tsx` (11 cells) and `entryActions.test.ts`
      (+4), 2026-09-02. "Every pre-existing test unchanged" was false as written: the
      harness's all-on report is the app's real default, so eight exact-list
      assertions had to widen (2.1's note)

## 4. Verification

- [x] 4.1 `bun run test` / `bun run typecheck` clean from the workspace dirs
      — 2026-09-02 on the merged tree (this branch + main's `thumbnail-image-serving`
      §2/§4): client 770 passed, server 617 passed, typecheck 0 in both;
      `indexContract.test.ts`'s live-index cell flaked once in the full run and passed
      alone (the known flake in `server/test/CLAUDE.md`)
- [ ] 4.2 **Not run (2026-09-02).** A dev instance from another session held 3177/5173
      throughout, serving main rather than this branch, and stopping it was not this
      session's call. What 4.2 still owes, unchanged below; two things to look at first
      when it runs: the chip against the occlusion pill at `bottom-14`, and the library
      tab's count on the real 3,380-model library (one `/api/models` plus one pose wave
      over the unposed — time it). **Masa's first live press found the bug the suite
      could not** (2026-09-02): after a reset the tile sat on "loading" forever —
      `refetch` restarted the slot through `start`, which since main's listing-drawn
      branch trusts the entry's `thumb` annotation first; that annotation was the
      listing's word from before the write, so `start` seeded an image URL at deleted
      pixels and returned a state `refetch` discards. Fixed by refusing the annotation's
      generation before the restart (`slot.refusedGen`, the word `reportImageError`
      already uses); cell "goes through the lookup even when the listing still vouches
      for the render", falsified (no lookup at all without the refusal). The hook-level
      cells passed because their entries carried no annotation — a fixture gap 4.2 exists
      to catch.
      Live: generate over a partly-rendered kit fills only its gaps while
      scrolling elsewhere stays responsive (visible tiles render first); reset over
      an orbited subtree empties its renders in seconds — on-screen tiles refill
      through the sweep, a model orbited mid-job is skipped — and a following generate
      draws them at the index's orientation, storing no framing; cancel + relaunch
      continues; whole-library generate from
      the library tab shows an honest count before and true progress during

## 5. Follow-ups (2026-09-02)

- [ ] 5.1 Gate the three surfaces — the two container menu rows (`applies` in
      `ENTRY_COMMANDS`) and the `library` tab (`libraryJobs` in `App`) — on the report's
      `maintenance` field once `public-deployment` lands it, instead of `thumbWrites`.
      They are operations on the server's own derived state, the question that field
      answers and `POST /api/reload` already gates under; two fields for one question
      would collide at archive (design risks). Whichever change lands second does the
      rebase; the cells in `entryActions.test.ts` and `bulkJobSurfaces.test.tsx` that
      withhold under `thumbWrites: false` move to the new field with it
- [ ] 5.2 Chip copy under the far gate: with `thumbnail-image-serving` D5 landed, a
      generate job holds while the user browses (1.2's accepted stall). The chip's
      "N of M" does not move for up to `FAR_GATE_MAX_MS` and reads as hung; say
      "paused while you browse" when the queue reports the gate closed — a small
      `RenderQueue` observation, not a runner change
