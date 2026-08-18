# Design — search-cancellation

## Context

`listFlat` walks synchronously within one request: `takeStep` (server/src/listing.ts:34) decrements the budget once per directory entry and is the single chokepoint every path funnels through — `listFsDir`, `walkFsLevel`, and `walkZip` all call it before doing per-entry work. There is no shared state between requests and no cancellation anywhere in `server/src`.

The client's `requestRef` (App.tsx) stamps each request and ignores all but the newest response. That is a display guarantee, not a work guarantee.

Measured 2026-08-18: a cold complete walk is 2.92s on USB SSD and ~32s on spinning exfat (2.405 ms/entry cold, against 0.030 ms warm). Bun's 10s idle timeout used to sever these connections; `26d42cc` raised it to 255s, which is right and also removes the accidental cap on how long an abandoned walk could run.

## Goals / Non-Goals

**Goals:**
- The walk a user is waiting on is not slowed by walks they have abandoned.
- Overlapping demand for the same tree costs one traversal.
- Nothing partial is ever mistaken for complete.

**Non-Goals:**
- A time limit on a single walk. The step budget bounds work per request and is the existing knob; a wall-clock limit would fail differently on different hardware, which is exactly the property that made the 10s idle default so confusing.
- Cancelling work that has genuinely started for a request still being awaited.
- Client changes. Latest-wins already covers the display side.

## Decisions

### D1: Share the walk; the expensive stage is query-independent

The walk gathers the tree; the query filters afterwards (`listFlat` filters and sorts once the walk returns). So two requests differing only in `q` want the *same* traversal. An in-flight registry keyed by the walk's inputs — root, and whatever options reach the server — lets a second request await the first's result and filter it for itself.

This is the larger half of the fix, and it is strictly better than cancelling: cancellation throws work away, sharing reuses it. It also covers the common case exactly — a user refining a query types several searches against one root in quick succession.

*Alternative — cancel the older request when a newer one arrives:* assumes the newer supersedes the older, which the server cannot know (two browser tabs, two roots), and discards a traversal that was about to be useful.

### D2: Abandonment is "nobody is waiting", not "a newer request exists"

A walk is cancelled when every request joined to it has disconnected — `c.req.raw.signal` per request, and the shared walk stops when the last one aborts. That keeps the rule local and true: the server stops work no one will read, and never guesses at supersession.

`takeStep` is where the check goes. It already runs once per entry, already returns a boolean the callers respect, and already marks the walk finished-early via `truncated`. Cancellation must *not* reuse `truncated` — that flag means "results were dropped", which the client renders as an honest partial answer. A cancelled walk has no reader and returns nothing; conflating the two would let a cancellation surface as a truncation notice.

### D3: A cancelled walk yields nothing durable

Partial results are discarded. This matters more once `listing-tree-cache` exists: a snapshot persisted from a walk that stopped halfway would be indistinguishable from a complete one and would serve a permanently truncated view of the tree. The rule is therefore stated at this level rather than left to the cache — only a walk that ran to completion may be persisted or shared with a joined request.

A joined request that arrives *after* a walk was cancelled starts a fresh walk; it does not inherit the abandoned one's partial state.

### D4: No wall-clock timeout

Tempting, given the idle-timeout history, and wrong for the same reason that history was confusing: a limit that fires at 10s is fine on an SSD and severs every cold walk on a spinning disk. Work is bounded by the step budget, which is hardware-independent and already tuned per operation (`MODEL_BROWSER_SEARCH_BUDGET`, `MODEL_BROWSER_FLAT_BUDGET`). Load is bounded by D1 and D2. Neither needs a clock.

## Risks / Trade-offs

- [A shared walk means one slow request's result is another's latency] → they were going to do the same traversal anyway; the joiner waits at most as long as it would have taken alone, and usually less because the first has a head start.
- [Registry entries leaking if a walk throws] → the entry is removed in a `finally`; a walk that throws rejects every joined request identically, matching today's behavior where each would have thrown on its own.
- [`c.req.raw.signal` fidelity under Bun and under Node] → the Hono app must run on Node unchanged (architecture D1), and the signal is standard `Request` API on both; verify at apply that Bun fires it on client disconnect, since the whole decision rests on that.
- [Cancellation could mask a real bug by silently returning nothing] → a cancelled request has no reader by definition; nothing is silenced that anyone would have seen. Server-side logging distinguishes cancelled from failed so the two are not conflated in diagnosis.
- [Overlap with `listing-tree-cache`] → deliberate: that change shares a walk across time, this one across simultaneity. Either alone is useful; together the second search of a session is free and the third concurrent one is not a third traversal.
