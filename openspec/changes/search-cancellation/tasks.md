# Tasks — search-cancellation

> Rederived 2026-09-01 against main at `ebd1240`; see design.md's *Rebase* section for the
> premises that died.
>
> Ordering: `library-root`, `search-view-reducer` and `folder-contact-sheets` have all
> landed and archived — nothing here waits on them, and their seams are what the tasks
> below are written against. The `walkFlat` seam has landed too (`ebd1240`), which is what
> tasks 2.3 and 3.x depend on. `folder-contact-sheets`' peek is **exempt** by archived
> requirement, not by convention — 2.5 tests that.
>
> Coordinate with `listing-tree-cache`: 2.3's never-persist rule is what keeps a stopped
> traversal from poisoning that cache, and the two share the equivalence key. Its design's
> Risks bullet currently claims the opposite resolution to D3's and asserts it is "recorded
> in both"; it is not, and reconciling that bullet is that change's job, not this one's.
>
> Also edits `server/src/app.ts`. Re-read `listing.ts` and `app.ts` against main before
> starting (parallel sessions).

## 0. Verify the premise first

- [ ] 0.1 Confirm `c.req.raw.signal` fires on client disconnect under Bun, and that the same
      code path works on Node (the Hono app must run on Node unchanged — architecture D1).
      The whole design rests on this; if it does not fire, D2's abandonment rule needs another
      source and the design must be revised before code is written. The *client* half is no
      longer in question — `App.tsx`'s fetch effect aborts the superseded request in its
      cleanup and `ApiClient.listDir` carries the signal — so what is being tested is the
      server's end of a wire known to be cut

## 1. Shared traversals

- [ ] 1.1 An in-flight registry in `server/src/listing.ts` keyed by `walkFlat`'s inputs — the
      library, the canonical library path, and the server-side options — and explicitly
      **not** by the query, since filtering happens inside `walkFlat` after the walk (D1). A
      request finding an equivalent traversal in flight awaits it and filters the result for
      itself
- [ ] 1.2 The key is built from what `/api/dir` has already canonicalised (`canonicalLibPath`)
      and the library it resolved against, downstream of the not-ready gate — not from the raw
      `path` parameter, or `//kit` and `/kit` miss each other and share nothing
- [ ] 1.3 Registry entries removed in a `finally`; a traversal that throws rejects every
      joined request identically, matching today's per-request behavior

## 2. Stopping abandoned work

- [ ] 2.1 A cancellation token on `FlatWalk` beside `budget`, set by the caller that
      constructs the walk. `takeStep` refuses on it as it refuses on budget (D2)
- [ ] 2.2 The recursion's own guards unwind on it too. `takeStep` has exactly two call sites
      (`listFsDir`'s charge loop, `walkZip`'s entry loop); `walkFsLevel` spends budget
      indirectly and unwinds by *checking* the flag, so a refusal in `takeStep` alone leaves
      it iterating an already-read level. Give cancellation the same two-part shape budget
      exhaustion already has (D2)
- [ ] 2.3 A cancelled traversal **rejects** with a named error class (e.g. `WalkCancelled`) —
      it does not return a short listing. Nothing partial exists to be persisted, cached, or
      handed to a joined request, so the rule is structural rather than disciplinary (D3). A
      request arriving after a stop starts fresh
- [ ] 2.4 Where completeness is tested — here or by `listing-tree-cache` — the predicate is
      **`walkFlat` resolved AND `budgetExhausted === false`**, never the wire's `truncated`. A
      cancelled walk has `budgetExhausted === false` and is incomplete anyway, which is why
      the resolve/reject distinction carries half the predicate; a merely `capped` response saw
      the whole tree and is cacheable (D3). If application reveals a caller that needs the
      partial, add a fourth field `cancelled` to `walkFlat`'s return rather than folding
      cancellation into `budgetExhausted` — design.md D3 records why
- [ ] 2.5 **The peek stays exempt, and it is tested, not asserted.** `peek` builds its own
      `FlatWalk` and reaches `takeStep` through `listFsDir`, so a condition consulted globally
      inside `takeStep` would stop the contact sheet's walk too — which the archived *Folder
      tiles preview their contents* requirement forbids ("run to completion rather than
      stopped when its tile has scrolled away"). The token must be a field the peek simply
      does not set
- [ ] 2.6 Server-side logging distinguishes cancelled from failed. Load-bearing, not a
      nicety: D3's claim that cancellation silences nothing anyone would have seen is only
      checkable if the two are distinguishable in the log

## 3. Tests

- [ ] 3.1 Several concurrent requests differing only by query against one root perform **one**
      traversal — instrument the walk (a step counter or a spy on the directory read) rather
      than inferring from timing, which is flaky
- [ ] 3.2 A request aborted mid-walk stops the traversal: assert via the instrumentation that
      the walk stopped early, not via wall-clock
- [ ] 3.3 One of several joined requests aborting leaves the traversal running and the others
      correctly served — and none of them sees `WalkCancelled`
- [ ] 3.4 After a stopped traversal, the next request returns a complete listing — the
      regression that would appear if partial state were reused or cached
- [ ] 3.5 A cancelled traversal produces **no listing at all**: `walkFlat` rejects, and no
      response reports `truncated` on account of a cancellation. `flat.test.ts`'s existing
      `budgetExhausted`/`capped` cells stay green untouched
- [ ] 3.6 A walk that ran to completion but was `capped` is still complete —
      `budgetExhausted === false` and it resolved — so the completeness predicate admits it.
      This is the cell that fails if someone "simplifies" 2.4 back to `truncated`
- [ ] 3.7 An abandoned `/api/peek` request runs to completion (2.5). Assert on the walk, not
      on the response, since the abandoned request has no reader by construction

## 4. Verification

- [ ] 4.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 4.2 Manual check on the **spinning** volume with caches dropped, which is the only
      hardware where this is observable: submit three searches in quick succession against one
      root and confirm the last completes in about the time one cold walk takes (~32 s, from
      `listing-tree-cache`'s 2026-08-18 table) rather than the contended time three concurrent
      walks took before. Record both numbers. **That volume was already unattached on
      2026-08-19** and its column could not be re-measured then; if it is unavailable again,
      measure what is present, say which column is missing, and do not report an SSD number as
      though it settled this — warm is 0.73 s there and the effect is invisible
- [ ] 4.3 Separately, with sharing in place, confirm the case D1 actually fixes: three rapid
      searches of one root cost one traversal (3.1 proves the mechanism; this confirms it on
      real hardware). Cancellation's own win is the navigate-away case in 4.2, and the two
      should be reported as two numbers, not one
