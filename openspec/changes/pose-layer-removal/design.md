## Context

See proposal.md — Why. What is in place today, by symbol, since the design deletes half of it:

- `DerivedLayers` (`server/src/layers.ts`) holds two maps. The pose half — `recordPoses`,
  `poseKnown`, `poseFor`, `held`, `HeldPose`, `POSE_ANNOTATION_TTL_MS = 5 * 60_000` — is
  written by the two pose proxy routes (`GET`/`POST /api/semantic/poses`), by `fillPoses`
  and by `fillPreviews`, and read by `annotate`. An entry ages out after five minutes and
  the next fill re-asks; the TTL's own comment calls it "the convergence bound", chosen
  so "the common case pays nothing". The preview half — `recordPreview`, `previewFor`,
  `previewStamp`, `forgetPreview`, `noteDirChanged`, `dropPreviewsUnder` — holds contact
  sheets derived by `posedFirstPeek`, keyed per `(directory, cell count)`.
- Emission (`/api/dir`, both branches) runs `fillAnnotations` → `fillOnce` before
  `annotate`. `fillOnce` is gated on `memoisedStatus()` — a synchronous read of the probe
  memo `probeStatus` maintains (per-state TTLs in `TTL_MS`: `ready` 30 s, `absent` 10 s),
  refreshed by `/api/semantic/status` (which the client reads on every navigation) and by
  the POST wave route. It collects `unposed` from `kind === 'model'` entries the layer
  cannot answer and `unchosen` directories with no sheet, then races
  `fillPoses` ∥ `fillPreviews` against `ANNOTATION_BUDGET_MS = 300`. `fillPreviews` starts
  at most `FILL_PREVIEW_MAX = 12` derivations, `FILL_PREVIEW_CONCURRENCY = 4` at once.
- `/api/peek` calls `posedFirstPeek`, which returns `learned` (the poses the derivation
  saw, and the paths it is entitled to record a negative for) — and the route drops it:
  "recording would make the `annotate` below attach a `pose` to every cell — a wire change
  to a shape another capability owns."
- The index answers `/poses` from its own store: **1.4–1.7 ms for 33 paths, 16–19 ms for
  500** (coordinator's measurement, 2026-09-11, loopback). `askIndex` takes the caller's
  timeout (`POSES_TIMEOUT_MS = 2000` for `/poses`); a timeout is `notAnswering()`, which
  calls `resetIndexStatus()`.
- The client: the listing wave (`App.tsx`, `wavePaths`) asks for `kind === 'model' &&
  pose === undefined`; the preview wave (`askedPreviewPoses`) asks for sheet cells under the
  same test; `carriedPoses` reads `e.pose != null` off `thumbEntries` straight into the
  sweep. `DirEntry.pose` has three wire states: an `IndexPose`, `null` ("asked, none"),
  absent ("not derived").
- Search routes are untouched by any of this: a hit's pose rides `hitsToEntries`' own
  `poses` map, never the layer.

What was promised, quoted so the deltas can be checked against it:

- `semantic-search`, *The index's orientations reach every listing*: "A listing itself
  SHALL NOT depend on the index: the listing request carries no poses and waits for none,
  poses arrive as their own request afterwards".
- `listing-cache`, *Derived annotations ride the listing*: "so a first sight arrives whole
  instead of popping in through client follow-ups … the client issues no follow-up wave or
  peek for what arrived"; "Emission-time filling … SHALL record the poses its derivations
  learn rather than discard them".
- `listing-tree-cache` archive, design D7 (emission-time filling, 2026-09-03): "Root
  problem this solves: the client-side fill produced a round trip and visible pop-in per
  first sight"; and `fillAnnotations`' own doc, which is where the archived task 6.9's
  reasoning lives in code: "Moving the same calls to emission costs the same work and
  deletes the round trip — the server is the process next to the index."

The first promise and the second already disagree — a listing "carries no poses" and "a
first sight arrives whole" — and the code resolves it in favour of the second. This change
keeps the second and rewrites the first to match, and keeps every scenario under both.

## Goals / Non-Goals

**Goals:**

- One source for a pose on the wire: the index's answer to *this* emission or *this* peek.
  No server-side pose state between requests.
- A changed index opinion reaches the client at the next listing, not after a horizon.
- The peek's cells arrive posed, so the client's preview wave has nothing to ask about
  when the index is ready.
- Emission covers a typical folder's sheets, not a third of them.
- A listing never waits on the index past a stated bound, never fails for it, and costs an
  unready index nothing — the gate and the budget stay.

**Non-Goals:**

- The preview-choice layer (sheets), its invalidation (`noteDirChanged`,
  `dropPreviewsUnder`, `forgetPreview`, the archive-mtime stamp) and `LAYER_VERSION` —
  untouched.
- The client's waves, its skip rule, its merge precedence, the sweep — untouched. The
  routes they land on keep their shape.
- Polling the index for readiness (`pose-rerender` D1, Masa: "I don't want it to poll").
- The byte cost of a preview cell (a landing cell still costs the client a model download
  to render) — `web-demo-backlog` territory, D3 below says why.
- Anything about what a pose *is* or how the index derives it.

## Decisions

### D1: Emission asks the index fresh, under a bound, gated on the memo it already reads

`fillOnce` keeps its gate — `memoisedStatus()`, a read and never a probe, `state === 'ready'`
with a collection root — and past it makes **one** batched ask for every model on the
listing **and every cell of every sheet the listing carries** from the preview layer (the
set `fillOnce` collects today misses the second half, which is finding 3 in the proposal).
The ask goes through `posesAsked` — `posesForPaths` plus `answered` — with a timeout of its
own, `POSE_ASK_TIMEOUT_MS`, threaded down to `askIndex` in place of `POSES_TIMEOUT_MS`.
`fillAnnotations` resolves to the answer instead of to `void`, and `annotate` takes it as an
argument: for a model the answer names, `entry.pose` is the orientation; for a model in the
asked set the answer does not name, `entry.pose = null` **when `answered` is true** (the
same-request negative, D4); otherwise the field is absent. A sheet derived at emission by
`fillPreviews` attaches its own `learned` to its cells the same way — `/under` reports a
pose per model it names and `walkRanked` asks `/poses` over its finds, so those cells are
already asked-and-answered without a second call. The single-flight join
(`fills` map) now shares an answer rather than a layer: the second request awaits the same
promise and annotates from its value. Nothing is written anywhere.

The preview derivations stay on the `ANNOTATION_BUDGET_MS` race exactly as they are: the
budget bounds emission as a whole, and `POSE_ASK_TIMEOUT_MS` bounds the poses half inside it.

**Why the bound is the call's own timeout, and why ~150 ms.** The measured `/poses` is a
store lookup: 16–19 ms for 500 paths, and a flat listing is capped at 500 models (a plain
listing is uncapped but `askPoses` chunks at `POSES_MAX = 1024`, which projects linearly to
~35–40 ms a chunk). 150 ms is ~8× the largest measured batch and half the 300 ms budget, so
the poses half can never consume the room the previews half needs. Past 150 ms the index
is not the lookup it was measured to be — the volume it lives on has gone away, or the
process is wedged — and waiting further buys nothing, because with no memo a late answer
has nowhere to land: every millisecond past "something is wrong" is pure loss on the browse
path. Making the bound the fetch's own `AbortSignal.timeout` rather than a race means a
timeout *is* a failed ask: the connection is closed (no orphan continuation), `posesAsked`
reports `answered: false` (no negatives stamped on a silence), and `askIndex`'s
`notAnswering` resets the status memo — so the next emission declines to ask until a surface
that may probe looks again, which the client does on its next navigation. That is the
wedge-limiter `memoisedStatus`' doc already leans on, reached by the same door.

*Alternatives considered.* (a) Wait the full `ANNOTATION_BUDGET_MS` for poses — rejected:
a slow index would eat the whole budget on every listing, and a late answer is discarded now
rather than recorded, so the extra wait has no payoff. (b) A `Promise.race` inside the
budget with the upstream call left running — rejected: the continuation would complete into
nothing, and the memo would stay `ready`, so every following listing pays the same wait
again until something else fails. (c) Keep the memo but drop the TTL to seconds — rejected
by the measurement: a Map get against a 1.4 ms lookup saves ~1 ms per listing and costs a
second source of truth that the TTL comment itself calls a "convergence bound" it must then
bound; Masa's direction is the memo goes.

### D2: The pose half of the layers is deleted; the preview half stays

Deleted from `layers.ts`: `recordPoses`, `poseKnown`, `poseFor`, `held`, `HeldPose`,
`POSE_ANNOTATION_TTL_MS`, the `poses` map, the `now` clock seam (its only reader was the
TTL), the pose half of `dropAll` and `size`. `reroot` stays — the preview layer still
records the collection root a sheet was derived against, since an index-first sheet is a
function of which collection answered — and so do `isLive` and `LAYER_VERSION`, which now
gate only preview derivations: the pose ask is not gated on `isLive`, because its answer is
attached, never recorded, so an inert layer cannot throw it away. `rootUnmoved` keeps its
one caller in `fillPreviews`; `fillPoses` goes, and `collectionRoot()` loses its two pose
route callers (the POST route's `posesListingAsked` already probes for itself).

`Layers` keeps the sheets because a sheet is a derivation the index does not answer: it is a
bounded walk of the filesystem plus a ranking, deterministic per (directory, index answer),
invalidated by directory change, archive rewrite, reload and repoint — a fact the server
*computes*. A pose is a fact the index *holds* and answers in a millisecond; holding a copy
of it is what the proposal's three findings are about. `posedFirstPeek` keeps asking the
index first (`pose-for-every-model` D5) and keeps handing `learned` back; the only change
is that its callers attach `learned` instead of one recording it and one dropping it.

*Alternative considered:* keep `recordPoses` for the peek route only, so a sheet's cells are
posed on the *next* listing — rejected: it is the memo again, at the surface where the
answer is already in hand; attaching it costs one assignment per cell.

### D3: The preview cap stays as the bound on derivations; twelve becomes thirty-two

`FILL_PREVIEW_MAX` and `ANNOTATION_BUDGET_MS` remain, for the reason the constant's doc gives:
the budget bounds *time* and the cap bounds *work* the budget cannot un-launch — a peek is a
walk of the tree, and a folder of three hundred kits must not queue three hundred of them
behind a listing that has shipped. The question is only the number. Twelve was chosen as
"what a first paint actually asks for" from two Playwright runs (12 peeks on first paint,
297-tile demo corpus and 26-kit real root). The 2026-09-11 measurement on a cold
`/Loot Studios` saw **19** client peeks before the pose POSTs, and the two folders measured
hold 26 and 31 directories: twelve leaves half to two thirds of a typical folder's sheets to
the client, each a round trip the emission was built to delete. A warm peek answers in
3–12 ms; at four concurrent, thirty-two derivations project to 24–96 ms, inside the 300 ms
budget with the poses ask (≤ 19 ms measured) beside them, and the `stop.expired` check
still ends the queue when the budget does, so a cold volume runs at most four derivations
past expiry. Thirty-two covers both measured folder counts whole with headroom and is
still a bound.

The cost that does not belong here: a preview cell that lands costs the client a full model
download to render its thumbnail when none is cached — that is bytes over the demo's ocean
RTT, the lever `docs/web-demo-notes.md` files under trip count and `web-demo-backlog`
owns. Raising the cap moves *when* those cells are asked for (with the listing rather than
per tile) and not whether; this change does not touch that trade.

### D4: Negatives come from the same answer, not from a memo

With no memo, "the index has none" is known only for the duration of the request that
asked. It still rides the wire, from that request: an entry in the asked set that the answer
does not name is emitted `pose: null` when `answered` is true, and absent when the ask was
not made, failed or timed out. The client's rule is unchanged (`pose === undefined` is
"unknown, ask"; `null` is "known, none") and is what keeps a never-embedded folder from
costing a wave on every landing — the property the archived round-3 finding 6 added, kept
without the state it was added with. An uncovered model — outside the collection, a
symlink out, an archive interior — is structurally excluded before the ask (`scopeDetail`)
and emitted `null` as today when the exclusion was structural and the ask answered; a
transient exclusion (a `realpath` that failed) keeps `answered: false` and emits absent.

*The cost, stated:* one `/poses` call per emission and none per peek beyond the ones the
peek already makes (`/under`, and `walkRanked`'s own `/poses`). For a 33-model listing that
is 1.4–1.7 ms on the emission path where the memo was a Map get; for a 500-model flat
listing 16–19 ms. Against that, on the measured cold `/Loot Studios`, the client's 5 pose
POSTs (76 paths) go to 0 and the 71-cell revisit POST goes to 0; the index sees one request
per listing where it saw one per horizon plus the client's, and every one of them is a
lookup it answers in single-digit milliseconds. A stale-marked listing's client re-request
is one more emission and one more ask, same price.

*Alternative considered:* absent for everything unnamed (pure absence, no `null`) — rejected:
the client's wave would then ask about every model the index has no orientation for on
every landing, which is exactly the standing traffic the null state was introduced to
stop, and the information is free — `posesAsked` already returns `answered`.

### D5: The client keeps its waves; `pose-rerender`'s key is the companion

Nothing in `client/src` changes behaviour. The listing wave and the preview wave stay as the
fill for a not-ready index, a timed-out ask, and the sheets past the cap; their skip test
(`e.pose !== undefined`) is already right for the three wire states; `carriedPoses` already
reads an emitted pose into the sweep. `listingRefresh.test.tsx` already holds "a listing
whose models all carry poses asks nothing at all" and "names the unposed models only".

What makes a *fresh* emission-time pose matter on screen is `pose-rerender` D2: a posed
render records the key of the pose it was drawn under, and a render whose key differs from
the pose now held is stale and re-rendered. Without it, a re-classified pose reaching the
client at the next listing would change nothing visible. That change's proposal says "the
server's five-minute pose memo is the bound on how long a changed opinion takes to reach
it" — this change supersedes that sentence: the bound is the next emission. Its D1 (a
navigation is the trigger, no polling) stands and is the trigger this design relies on.

### D6: The enumeration stops carrying poses; search routes are untouched

`/api/models` (`listings.enumerate` + `annotate`) carried a pose wherever the layer held
one; with no layer it carries none, and that is correct rather than a loss: the
requirement *A subtree's models are enumerable with their derived facts* names the
thumbnail facts only, and the route's one consumer already waves for what it lacks
(`bulkJobs.test.ts`: "asks about exactly the models the enumeration had no pose for"). An
enumeration is a work list, not a first sight; asking the index for a whole subtree's poses
on it would be a second pose supply for a caller that has one. The meaning and similarity
routes never read the layer — a hit's pose rides `hitsToEntries`' own `poses` map — so
nothing there moves.

## Risks / Trade-offs

- [Every emission pays an index round trip where a warm memo paid a Map get] → measured at
  1.4–19 ms on loopback, inside a budget that already exists; the timeout bounds the worst
  case at 150 ms and its expiry resets the memo so a sick index is asked once, not per
  listing.
- [A 150 ms timeout fires on a healthy but momentarily slow index, and the memo reset makes
  the next listing decline until a probe] → the client probes `/api/semantic/status` on every
  navigation, so the decline lasts one listing; the wave covers that landing, which is
  today's path. If the live task (tasks 3.x) shows the timeout firing on a warm index, the
  number is wrong, not the mechanism — raise it and record the measurement.
- [The peek's answer changes shape for a ready index — cells now carry `pose`] → the client
  already reads `pose` off preview cells (`carriedPoses` walks `thumbEntries`, which includes
  sheet cells); the unindexed answer is byte-identical to today's (`poses.test.ts`: "an
  unindexed answer is the walk's own sheet, byte for byte" — no ask, no field).
- [Raising the cap to 32 starts more walks per listing on a cold volume] → the budget's
  `stop.expired` still ends the queue at 300 ms, concurrency stays 4, and the derivations
  are snapshot-served walks where a tree is cached. If the library-on-removable-media case
  shows emission stretching, lower the cap before touching the budget.
- [A stale-marked listing's follow-up re-request asks again] → same 1–19 ms; and the answer
  is the same unless the index changed, in which case it is the answer we want.
- [Two requests for one listing joined by the single-flight now share an *answer* object]
  → `annotate` reads it and writes entries it owns per request; the answer is never mutated.

## Migration Plan

Server-only, one commit shape, no data migration: the deleted layer was process-local
(nothing on disk to drop), the wire keeps its fields, and the client needs no change to
work against either server. Rollback is `git revert`. The live check (tasks 3.x) runs
against the dev instance with the index up and with it stopped.

## Open Questions

None that change the specs or the tasks. The exact `POSE_ASK_TIMEOUT_MS` and
`FILL_PREVIEW_MAX` values are decisions above with their measurements; the live task is
where they are confirmed or corrected.
