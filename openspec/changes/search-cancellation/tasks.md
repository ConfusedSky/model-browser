# Tasks — search-cancellation

> Ordering: independent of the search-matching and options changes, but coordinate with `listing-tree-cache` — task 2.3's "never persist a partial walk" rule is what keeps a stopped traversal from poisoning that cache, and the two share the equivalence key. Re-read `listing.ts` and `app.ts` against main before starting (parallel sessions).

## 0. Verify the premise first

- [ ] 0.1 Confirm `c.req.raw.signal` actually fires on client disconnect under Bun, and that the same code path works on Node (the Hono app must run on Node unchanged — architecture D1). The whole design rests on this; if the signal does not fire, D2's abandonment rule needs another source and the design must be revised before code is written

## 1. Shared traversals

- [ ] 1.1 An in-flight registry in `server/src/listing.ts` keyed by the traversal's inputs — root plus any server-side options — and explicitly **not** by the query, since filtering happens after the walk (D1). A request finding an equivalent walk in flight awaits it and filters the result for itself
- [ ] 1.2 Registry entries removed in a `finally`; a walk that throws rejects every joined request identically, matching today's per-request behavior

## 2. Stopping abandoned work

- [ ] 2.1 `takeStep` (listing.ts:34) checks cancellation alongside the budget — it is already the per-entry chokepoint every path funnels through, so no new plumbing through the recursion (D2)
- [ ] 2.2 Cancellation is **not** `truncated`: that flag means results were dropped from an answer someone received, and a stopped walk has no reader. Keep them separate states or a cancellation will surface to some future reader as a truncation notice (D2)
- [ ] 2.3 A walk that did not complete is never persisted, cached, or handed to a joined request; a request arriving after a stop starts fresh (D3)
- [ ] 2.4 Distinguish cancelled from failed in server-side logging, so the two are not conflated in diagnosis

## 3. Tests

- [ ] 3.1 Several concurrent requests differing only by query against one root perform **one** traversal — instrument the walk (a step counter or a spy on the directory read) rather than inferring from timing, which is flaky
- [ ] 3.2 A request aborted mid-walk stops the traversal: assert the walk stopped early via the instrumentation, not via wall-clock
- [ ] 3.3 One of several joined requests aborting leaves the traversal running and the others correctly served
- [ ] 3.4 After a stopped traversal, the next request returns a complete listing — the regression that would appear if partial state were reused or cached
- [ ] 3.5 No response reports `truncated` as a result of cancellation; the existing budget- and cap-truncation tests stay green untouched

## 4. Verification

- [ ] 4.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 4.2 Manual check on the **spinning** volume with caches dropped, which is the only hardware where this is observable: submit three searches in quick succession against one root and confirm the last completes in about the time one cold walk takes (~32s measured 2026-08-18) rather than the contended time three concurrent walks took before. Record both numbers
