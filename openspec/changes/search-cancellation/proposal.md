# Search Cancellation

> **Rebased 2026-09-01.** Drafted 2026-08-18, before `library-root`,
> `search-view-reducer`, `folder-contact-sheets` and the `walkFlat` seam landed. Enough
> ground moved under it that its citations named symbols that no longer exist
> (`requestRef`), asserted a `grep` result that is no longer true, and stated its
> never-persist rule against a flag (`truncated`) that has since been split into the two
> facts it was conflating. Every artifact below was rederived against main at `ebd1240`
> rather than patched; the change's intent — abandoning a deep/flat name-search walk
> server-side once the client has moved on — is unchanged. What each dead premise was, and
> what replaced it, is recorded in design.md's *Rebase* section so the next reader does not
> re-derive it.

## Why

Latest-wins is a display guarantee, not a work guarantee. The client tags each asking event
(`Inflight.id`), and the reducer's `accepts` admits only the response that still belongs;
`Result.id` keeps that identity past the landing. Since `search-view-reducer` the client
also *aborts* the superseded request — `App.tsx`'s fetch effect creates an `AbortController`
per request and aborts it in the effect's cleanup, and `ApiClient.listDir` carries the
signal through. So the connection genuinely closes. Nothing on the server notices.

There is no inbound-request cancellation path in `server/src`. No route reads
`c.req.raw.signal`; `FlatWalk` carries no token; `takeStep` refuses only on budget. (The
abort machinery that does exist is outbound and unrelated: `semantic.ts` wraps its index
fetches in `AbortSignal.timeout`, and `launch.ts` documents deliberately having none because
the chooser spans a human decision.) Submitting several searches in a row therefore stacks
that many concurrent full walks server-side, each free to spend its whole 200k-step budget,
long after the client stopped reading.

The cost, from `listing-tree-cache`'s measurement table (measured 2026-08-18, partly
re-verified 2026-08-19 — that change's proposal is the primary record, not this one): a
complete walk warm is **0.73 s** on the USB-SSD column and **0.80 s** on the spinning-exfat
column, and cold it is **2.92 s** against **~32 s**. Warm, nobody notices an abandoned walk.
Cold on a spinning volume, ~32 s is seek-bound metadata reading, and three of them at once
do not take 32 s — they contend for one head and take considerably longer than one. The walk
the user is actually waiting for is slowed by the two they have already given up on. The
2026-08-19 re-run could not re-measure the spinning column (that volume was not attached);
the ext4 volume present measured 0.54–0.86 s warm, consistent with the SSD column.

The step budget bounds work *per request*. Nothing bounds concurrent load, and the 10 s idle
default that used to cut these walks short was raised to 255 s in `26d42cc` (`idleTimeout` in
`server/src/index.ts`) — which is correct, and removes the accidental brake that was hiding
this.

Two processes walking one volume is a pathology the index side already declines to create on
our account: mini-classify's `docs/api/surface.md` cites this change by name as the reason
`/status` answers from the index rather than walking the tree itself.

## What Changes

- **Concurrent walks over the same tree are shared, not duplicated**: a request whose
  traversal is already in flight for that root joins it rather than starting a second one.
  This is the largest part of the problem, because the expensive stage is
  query-*independent* — `walkFlat` gathers the tree and the query filters afterwards. Three
  rapid searches of one library become three filters over one walk.
- **Genuinely abandoned work stops**: when nothing is waiting on a traversal — every joined
  request has disconnected — it is cancelled at its next step rather than run to completion.
- **A cancelled walk cannot yield anything durable, by construction**: it does not return a
  short listing, it rejects. There is no partial result object for a caller or a future cache
  to mistake for a complete one.

The value here is narrower than the draft claimed, and saying so plainly is part of the
rederivation. Sharing already collapses the rapid-refine case to one walk, so cancellation's
remaining job is the case sharing cannot help: the *last* reader of a traversal leaving —
navigating away, closing the tab, going back — while a cold walk still has 30 seconds to run.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `directory-browsing`: gains an **ADDED** requirement covering concurrent and abandoned
  listing work — that overlapping traversals of one tree are served by one traversal, that
  work nobody awaits is stopped, and that a stopped traversal yields nothing at all. Added
  rather than folded into the existing *Recursive flat listing* requirement, which describes
  what a listing contains; this is about the work behind it. No collision: the two other
  active `directory-browsing` deltas are `library-overrides` (ADDED, different title) and
  `pose-for-every-model` (MODIFIED *Folder tiles preview their contents*).

## Impact

- `server/src/listing.ts` — an in-flight registry keyed by the traversal's inputs, which are
  now exactly `walkFlat`'s: the library, the library path, and the server-side options.
  Never the query. A cancellation token rides `FlatWalk` beside `budget`, and `takeStep`
  refuses on it as it already refuses on budget — but `takeStep` has only two call sites
  (`listFsDir`'s charge loop and `walkZip`'s entry loop), so the recursion's own guards
  (`walkFsLevel`'s and `peekLevel`'s `if (walk.budgetExhausted) return`) need the same
  treatment or the unwind stalls between directories.
- **The peek must not inherit this.** `peek` builds its own `FlatWalk` and reaches `takeStep`
  through `listFsDir`, so a cancellation check written into `takeStep` alone would reach the
  contact sheet's walk too — which the archived *Folder tiles preview their contents*
  requirement forbids in as many words ("A peek is its own request: never served from or
  merged into a recursive listing, and — being bounded — run to completion rather than
  stopped when its tile has scrolled away"). The token is therefore a field a caller sets,
  absent on the peek's walk, not a condition `takeStep` consults globally.
- `server/src/app.ts` — `/api/dir`'s flat branch. `c.req.raw.signal` is the source of "nobody
  is waiting any more"; a shared traversal is abandoned only once every joined request has
  gone. The registry key is built from what the route has already canonicalised
  (`canonicalLibPath`) and the library it resolved against, downstream of the not-ready gate
  — a key built from the raw query string would let `//kit` and `/kit` miss each other.
- `server/src/index.ts` is untouched: the token, the registry and the signal are all standard
  `Request`/`AbortSignal`, so the Hono app still runs on Node unchanged (architecture D1).
- Interacts with `listing-tree-cache`: the two solve the same problem on different axes —
  that change makes one walk serve many requests *across time*, this one makes it serve many
  requests *at the same moment*. **They currently disagree in writing**; design.md's D3
  records the disagreement and this change's resolution.
- **No overlap with semantic search.** A meaning query is one text forward plus a matmul, not
  a walk, so an abandoned one costs little and latest-wins stays client-side. That is the
  index side's own recorded reasoning (mini-classify `docs/api/surface.md`, the *Cancellation*
  open question), and it holds *only* because no walk happens inside a semantic request.
  Nothing here changes for `/api/semantic/*`.
- No API shape change. `DirListing.truncated` keeps meaning exactly what it means today.
