# Design — search-cancellation

> **Rebased 2026-09-01** against main at `ebd1240`. See *Rebase* at the foot for what was
> stale and what replaced it; the decisions below are rederived, not patched.

## Context

`walkFlat` (`server/src/listing.ts`) is the traversal. `listFlat` is now a one-line wrapper
that returns its `listing` and drops the rest; `walkFlat` itself returns
`{ listing, budgetExhausted, capped }`. That split is the single most useful thing to happen
to this change: `budgetExhausted` is a property of the **traversal** (the walk holds a prefix
of the tree, the rest was never looked at), `capped` is a property of the **answer** (the
tree may have been walked in full, only the reply was cut). The wire's
`DirListing.truncated` is their OR and is unchanged.

`takeStep` decrements the budget and is the per-entry chokepoint — at exactly **two** call
sites: `listFsDir`'s charge loop, and `walkZip`'s entry loop. It is not called from
`walkFsLevel`, which spends budget indirectly through `listFsDir` and only *checks* the flag
(`if (walk.budgetExhausted) return`) to unwind. `peekLevel` checks it the same way.

Paths are library paths throughout since `library-root`: the route canonicalises with
`canonicalLibPath`, `walkFlat` resolves through `library.resolve` to an `fsPath`, `libHalfOf`
names what failures may say, and `within(realTop, …)` confines every symlink the walk meets.
`ListingError` carries the status. A registry key must be built from the canonical library
path and the resolved library, not from a raw query parameter.

There is no shared state between requests and no inbound cancellation anywhere in
`server/src` — no route reads `c.req.raw.signal` and `FlatWalk` carries no token. The abort
machinery that exists is outbound (`semantic.ts`'s `AbortSignal.timeout`) and does not apply.

Client-side, latest-wins is `pendingRequest` → `Inflight.id` → the reducer's `accepts` →
`Result.id`, and `App.tsx`'s fetch effect aborts the superseded request in its cleanup, with
`ApiClient.listDir` carrying the signal. So `c.req.raw.signal` does fire for the case this
change is about. That is a display *and* a transport guarantee; it is still not a work
guarantee, because nothing server-side is listening.

Measurements are `listing-tree-cache`'s proposal table (2026-08-18, partly re-verified
2026-08-19), not this change's: warm complete walk 0.73 s SSD / 0.80 s spinning exfat, cold
2.92 s / ~32 s. The spinning column could not be re-measured on 2026-08-19 — that volume was
not attached — so anything priced against ~32 s is priced against a figure with one run
behind it.

## Goals / Non-Goals

**Goals:**
- The walk a user is waiting on is not slowed by walks they have abandoned.
- Overlapping demand for the same tree costs one traversal.
- Nothing partial can be mistaken for complete — preferably because nothing partial exists.

**Non-Goals:**
- A time limit on a single walk (D4).
- Cancelling work that has genuinely started for a request still being awaited.
- Client changes. Latest-wins and the abort both already exist.
- Anything about semantic queries (D5).
- Anything about the folder-tile peek, which the archived requirement exempts by name.

## Decisions

### D1: Share the traversal; the expensive stage is query-independent

`walkFlat` gathers the tree; the query filters afterwards, inside it, once the walk returns.
So two requests differing only in `q` want the *same* traversal. An in-flight registry keyed
by `walkFlat`'s inputs — the library, the canonical library path, and the server-side options
— lets a second request await the first's result and filter it for itself.

That the walk's output does not depend on `q` is not an accident to be re-checked here: it is
an invariant pinned by `search-matches-folder-names` (D2, with a test that walks one fixture
under two queries and asserts the collected set is identical) and re-pinned by
`search-options`. `FlatWalk.dirs`' own comment names this change as one of the two things
that would break if it regressed. The registry is sound exactly as long as that holds.

This is the larger half of the fix and strictly better than cancelling: cancellation throws
work away, sharing reuses it. It also covers the common case exactly — a user refining a
query types several searches against one root in quick succession.

*Alternative — cancel the older request when a newer one arrives:* assumes the newer
supersedes the older, which the server cannot know (two tabs, two roots), and discards a
traversal that was about to be useful.

**What this leaves for D2.** Once sharing lands, rapid refinement is already one walk.
Cancellation's remaining job is the case sharing cannot help: the last reader of a traversal
leaving — navigate away, close the tab, go back — while a cold walk still has 30 seconds to
run. Worth stating rather than letting the proposal's "three concurrent walks" framing imply
that D2 is what fixes it. D1 is.

### D2: Abandonment is "nobody is waiting", not "a newer request exists"

A traversal is cancelled when every request joined to it has disconnected — `c.req.raw.signal`
per request, the shared traversal stopping when the last one aborts. That keeps the rule
local and true: the server stops work no one will read, and never guesses at supersession.

**The token rides `FlatWalk`, and both kinds of checkpoint need it.** `takeStep` is the
natural place for the refusal — it already runs once per entry and already returns a boolean
every caller respects — but it has only two call sites, and `walkFsLevel` unwinds by
*checking* the flag rather than by calling `takeStep`. A check in `takeStep` alone leaves
`walkFsLevel` iterating an already-read level (a `realpath` per subdirectory) until its next
descent. So the shape is the one budget exhaustion already uses: refuse in `takeStep`, and
unwind at the loop guards that today read `walk.budgetExhausted`.

**The peek is exempt, and the mechanism must make that true.** `peek` builds its own
`FlatWalk` and reaches `takeStep` through `listFsDir`. A cancellation condition consulted
globally inside `takeStep` would therefore reach the contact sheet's walk as well — which the
archived *Folder tiles preview their contents* requirement forbids in as many words: "A peek
is its own request: never served from or merged into a recursive listing, and — being bounded
— run to completion rather than stopped when its tile has scrolled away." (`ApiClient.peek`
takes no `AbortSignal` for the same reason, and says so.) The token is consequently a field a
caller sets on the walk it constructs, absent on the peek's, not an ambient condition.

### D3: A cancelled traversal rejects; it does not return a short listing

`walkFlat` rejects with a named error — `WalkCancelled` or similar; the name is the point, so
the reject site is greppable and the catch is not a bare `instanceof Error`. There is no
partial result object at all, so "never persist a partial walk" is structural rather than
disciplinary: a caller cannot cache what it was never handed.

**This is the rule `listing-tree-cache` needs, and the flag it would otherwise have used is
wrong.** That change's 4.1a rule is that only a complete traversal may be persisted, and
`FlatWalk.budgetExhausted`'s own comment names itself as the flag that answers it. It does —
today. It stops being sufficient the moment cancellation exists, because **a cancelled walk
has `budgetExhausted === false`**: it never touched the budget, and is incomplete anyway. A
`!budgetExhausted` test would then persist a cancelled prefix of the tree as though it were
the whole thing — precisely the permanently-wrong snapshot both changes exist to prevent. So
the persistable predicate is **walk completeness**: `walkFlat` resolved *and*
`budgetExhausted === false`. Never the wire's `truncated`, which a merely `capped` response
also sets while having seen the whole tree, and which would refuse to cache a 501-model
folder forever.

*Fallback, recorded so it is not re-derived:* if application reveals a caller that genuinely
needs the partial, extend the seam instead of weakening the rule — `walkFlat` returns
`{ listing, budgetExhausted, capped, cancelled }` and completeness becomes
`!budgetExhausted && !cancelled`. Do not fold cancellation into `budgetExhausted`: the flag
would then lie about its reason, and its comment (which cites the step budget specifically)
would have to lie with it.

A request arriving *after* a traversal was cancelled starts a fresh one; it does not inherit
the abandoned one's state, because there is none to inherit.

**Disagreement with `listing-tree-cache`, recorded rather than papered over.** That change's
Risks list currently reads: "[An abandoned crawl now has value, which argues against
cancelling it] → real tension with `search-cancellation`; the resolution recorded in both is
to cancel the *response*, not the crawl — the user stops waiting, the work still lands in the
cache." That resolution is **not** recorded here and never was; this change says the opposite
in its What Changes and in this decision, so "recorded in both" is false as of 2026-09-01.
The resolution taken here, deliberately, is that **cancellation wins**:

- The cache removes *repeat* cost. It does not remove *contention*, and contention is the
  measured pathology in the Why. A crawl allowed to run to completion for the cache's benefit
  still holds the disk head against the walk the user is actually waiting for — on the
  spinning column, for the better part of half a minute.
- The benefit the sibling is protecting is real but second-order: it is one future warm hit,
  bought by degrading the request in flight now.
- After D1, the abandoned-crawl case is rarer than either change's prose assumes, because
  simultaneous demand is already one walk. What remains is a genuinely departed reader.

This is a note about a sibling change's file, not an edit to it. Whoever reconciles the two
should fix that bullet in `listing-tree-cache`; nothing in this change's directory can.

### D4: No wall-clock timeout

Tempting given the idle-timeout history, and wrong for the same reason that history was
confusing: a limit that fires at 10 s is fine on an SSD and severs every cold walk on a
spinning disk. Work is bounded by the step budget, which is hardware-independent and already
tuned per operation (`MODEL_BROWSER_SEARCH_BUDGET`, `MODEL_BROWSER_FLAT_BUDGET` in
`walkFlat`'s `budget` assignment). Load is bounded by D1 and D2. Neither needs a clock.

### D5: Name search only — the semantic boundary is the index side's, and it is already drawn

Nothing here touches `/api/semantic/*`. The index's own surface doc
(mini-classify `docs/api/surface.md`, *Cancellation* under its open questions) records the
non-decision and its reasoning: a semantic query is one text forward (~50 ms) plus a matmul,
so an abandoned request costs little and latest-wins can stay client-side — with the caveat
that this stops being true if the GPU lock ever queues, and the explicit note that the
argument holds *only* because no walk happens inside a query. That is the same distinction
this change turns on, from the other side: bounded GPU work is predictable, unbounded I/O is
not. Conflating the two would import a cancellation mechanism into a request that does not
need one, and — worse — would suggest the semantic path has an unbounded traversal to stop.

## Risks / Trade-offs

- [A shared traversal means one slow request's result is another's latency] → they were going
  to do the same traversal anyway; the joiner waits at most as long as it would have alone,
  and usually less because the first has a head start.
- [Registry entries leaking if a walk throws] → the entry is removed in a `finally`; a walk
  that throws rejects every joined request identically, matching today's behavior where each
  would have thrown on its own. `WalkCancelled` is *not* that case and must not reach a
  joined request that is still waiting: cancellation only fires when the last one has gone.
- [`c.req.raw.signal` fidelity under Bun and under Node] → the Hono app must run on Node
  unchanged (architecture D1), and the signal is standard `Request` API on both. Verify at
  apply that Bun fires it on client disconnect (task 0.1); the whole of D2 rests on it. The
  client half is no longer in doubt — `App.tsx`'s fetch effect aborts on supersession — so
  what task 0.1 tests is the server's end of a wire that is known to be cut.
- [Cancellation masking a real bug by silently returning nothing] → nothing is returned:
  `WalkCancelled` is thrown and logged distinctly from a failure. A cancelled request has no
  reader by definition, so nothing is silenced that anyone would have seen — but the
  cancelled/failed distinction in the log is what keeps that claim checkable, which is why it
  is a requirement here and not a nicety.
- [The peek accidentally inheriting cancellation] → D2's mechanism prevents it and task 2.5
  tests it. Worth a test rather than a comment: `peek` shares `FlatWalk`, `takeStep` and
  `listFsDir` with the walk this change stops, and the exemption is normative in an archived
  requirement.
- [Overlap with `listing-tree-cache`] → D3, including the recorded disagreement.

## Rebase (2026-09-01) — what was stale

Kept for the next reader, so a citation that reads plausibly is not re-adopted from an
earlier draft of this file.

- **`requestRef` no longer exists.** The draft's whole client-side premise cited it. It was
  replaced by the reducer's `Inflight.id` / `accepts` / `Result.id` when
  `search-view-reducer` archived; `reducer.ts` still carries the epitaph ("`requestRef` moved
  into state"). The rederived version cites the current machinery — and notes that the client
  is *stronger* than the draft assumed, since it now aborts rather than merely ignoring.
- **"`server/src` contains no abort or timeout path at all — `grep` finds neither `signal`
  nor `abort`" is false.** `semantic.ts` uses `AbortSignal.timeout` on its index fetches and
  `launch.ts` documents deliberately having none. The true, narrower claim is that there is
  no *inbound-request* cancellation path: no route reads `c.req.raw.signal`, and `FlatWalk`
  carries no token.
- **`truncated` has been split.** The draft's D2 argued cancellation must not reuse
  `truncated`, and its D3 stated never-persist against it. `walkFlat` now returns
  `budgetExhausted` and `capped` separately. The rule belongs to walk completeness — and, as
  D3 shows, `!budgetExhausted` alone is *not* completeness once cancellation exists, which is
  the sharpest thing this rebase found.
- **`library-root` landed.** Every path in `listing.ts` and `app.ts` is a library path
  through `library.resolve`, canonicalised by `canonicalLibPath`, gated by the not-ready
  middleware, and failing as `ListingError`. The registry key is built from those, not from a
  raw parameter.
- **`folder-contact-sheets` archived.** The peek exemption is no longer a claim about a
  sibling draft; it is normative text in `openspec/specs/directory-browsing/spec.md` under
  *Folder tiles preview their contents*, and it is cited as such. `pose-for-every-model`'s
  MODIFIED block on that requirement carries the same sentence forward, so the citation
  survives that change landing.
- **The warm-walk figure was retyped from the wrong column.** The draft read "0.8 s on an
  SSD"; 0.80 s is the spinning-exfat warm figure and 0.73 s is the SSD's, both from
  `listing-tree-cache`'s table. Re-attributed rather than restated, per the repo's rule about
  measurements that live only in prose.
- **`walkFlat` landed while this rebase was being written** (main `ebd1240`, 2026-09-01),
  extracted from `listFlat` for `listing-tree-cache`'s benefit. Its shape was verified against
  the source, not assumed.
