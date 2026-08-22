# Search Cancellation

## Why

Recorded as a known limit when the search budget was raised, and now measurable. Latest-wins is client-side only: `requestRef` discards a superseded *response*, but nothing stops the walk that produced it. `server/src` contains no abort or timeout path at all — `grep` finds neither `signal` nor `abort`. Submitting several searches in a row therefore stacks that many concurrent full walks, each free to spend its whole 200k-step budget.

Warm, on an SSD, that costs 0.8s per abandoned walk and nobody notices. On the spinning volume measured 2026-08-18, a cold walk is ~32 seconds of seek-bound metadata reads — and three of them running at once do not take 32 seconds, they contend for the same head and take considerably longer than one. The walk a user is actually waiting for is slowed by the two they have already given up on.

The step budget bounds work *per request*. Nothing bounds concurrent load, and the 10s idle default that used to cut these walks short has been raised to 255s (`26d42cc`) — which is correct, and removes the accidental brake that was hiding this.

## What Changes

- **Concurrent walks over the same tree are shared, not duplicated**: a request whose walk is already in flight for that root joins it rather than starting a second one. This is the largest part of the problem, because the expensive stage is query-*independent* — the walk gathers the tree, and filtering by query happens afterwards. Three rapid searches of the same library are three filters over one walk, not three walks.
- **Genuinely abandoned work stops**: when nothing is waiting on a walk — the client has navigated elsewhere and no other request has joined it — it is cancelled at its next step rather than run to completion. The step loop is already the natural checkpoint.
- **A cancelled walk never poisons a cache**: partial results are discarded, not persisted as though the tree had been fully walked.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `directory-browsing`: gains an **ADDED** requirement covering concurrent and abandoned listing work — that overlapping walks of one tree are served by one walk, that work nobody awaits is stopped, and that a stopped walk yields nothing durable. Added rather than folded into the existing flat-listing requirement, which describes what a listing contains; this is about the work behind it.

## Impact

- `server/src/listing.ts` — an in-flight registry keyed by root, so a second request joins the first; `takeStep` gains a cancellation check alongside its budget check (it is already the per-entry chokepoint, so no new plumbing through the recursion).
- `server/src/app.ts` — the request's own `AbortSignal` (`c.req.raw.signal`) is the source of "nobody is waiting any more"; a shared walk is only abandoned once every joined request has gone.
- Interacts with `listing-tree-cache`: the two solve the same problem on different axes — that change makes one walk serve many requests *across time*, this one makes it serve many requests *at the same moment*. They compose, and the partial-results rule above exists because they do.
- No client change needed — and since `search-view-reducer` landed (2026-08-21), the client already aborts superseded listing fetches (`listDir` carries an `AbortSignal` through ApiClient), so `c.req.raw.signal` genuinely fires for the rapid-search case this change is about; before that, a superseded request kept its connection open and the signal never fired.
- No API shape change.
