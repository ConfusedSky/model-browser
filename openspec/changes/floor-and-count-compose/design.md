# Design: Floor and Count Compose

## Context

The one-choice rule has three recordings: `semantic-search-tuning` D1 (the observation), the
archived `score-floor-by-default` requirement "a count and a floor remain one choice and
never both", and live comments at every layer the rule touches — `shared/types.ts`
`SemanticTuning`, `client/src/lib/searchOptions.ts` `Tuning`, the SidePanel's segmented
control, and `server/src/semantic.ts` `query()`. The rule is enforced in this repo by
*never sending both*; it is enforced upstream in `mini-classify`'s `rank()` by `min_score`
*replacing* the top-N cut:

```python
if min_score is not None:
    order = order[sims[order] >= min_score]
else:
    order = order[:top]
```

The index's request schema already accepts both fields (`api.py`'s `QueryRequest`), and its
outer cap already truncates *after* `rank()` (`truncated = bool(len(order) > req.cap)`).

**The branch is not the only upstream edit, and the other one is load-bearing.** The ten-row
count default is upstream's, and it lives in more than one place. `QueryRequest.top` is
`int = Field(10, ge=1, le=1000)` — non-nullable, defaulting to **10**. This app's `query()`
omits `top` entirely when it sends a floor, so a floor-only request arrives with
`req.top = 10` today and is unharmed only because the replace branch discards it. Change the
branch to floor-then-slice without touching the schema and that same request slices the floor
set to ten rows: **875 rows today, 10 rows after** on the `fantasy character` shape.

Both halves are measured, which an earlier draft of this document claimed before it was true:
it welded the archived 875 to a ten derived from the schema default and called the pair a
measurement of `rank()`. The composition now exists upstream (`add7fd4`), so the pair has been
run twice independently — by the session that wrote that change, and again here through the
HTTP path this app actually uses, against a second server on the same cache:

| request | rows | `matched` | `truncated` |
|---|---|---|---|
| floor 0.1, no count | 875 | 875 | false |
| floor 0.1, `top` 10 (the old schema default) | **10** | 875 | false |
| `top` 10, no floor | 10 | 3380 | false |
| floor 0.1, default cap | 500 | 875 | **true** |

Conditions: `embed-cache512`, 3380 models on `/run/media/masa/STLLibrary`, pool softmax, phrase
`fantasy character`, floor 0.1, `serve_api.py` on CPU, 2026-08-27. The floor set runs 0.1463
down to 0.1000 with its 10th at 0.1426 and its 500th at 0.1221 — the last reproducing
`score-floor-by-default`'s archived sweep (`0.146` to `0.122`) independently, which is what
makes the archived 875 in the same table trustworthy rather than merely cited. The measurement's
re-runnable home is upstream, in `rank()`'s own docstring; this table is the reading, not the
record.

The HTTP schema is not the only carrier. `rank(sims, top=10, min_score=None)` carries the
same default in its **own signature**, which no schema edit reaches, and its other caller is
`test_categories.py`'s `show_query(sims_1d, names, top=10, min_score=None)` — the REPL, which
is where querying actually happens in that repo. Composition without that signature would turn
`:min 0.1` from 875 rows into 10 with no HTTP request involved. Upstream resolved this one
differently from the schema, and correctly: `show_query` keeps its ten as a *display* default
and sends it away when a floor is in force, so `:min` still reads as "threshold instead of
top-10" and the REPL's output is unchanged. `docs/api/surface.md`'s
`POST /query` table states the rule being repealed (`top | int | 10 | ignored when min_score
is set`) and is the jointly-owned contract between the two repos.

So the count default must become absent-meaning-*no cap* upstream, in every one of those
places, in the **same** change as the composition. That also inverts this change's ordering story, which D7 revises: the
danger is not that this app lands early, it is that the index lands the branch alone, which
breaks the app *as currently deployed*, whose default is floor-only. The 500 figure exists twice upstream —
`cap: int = Field(500, ge=1, le=10000)` — and in prose in this repo (`semantic.ts`'s
TOP comment); neither side has it as a client-usable constant.

Constraints inherited from landed decisions: the index's cap is a wall, not a horizon
(`score-floor-by-default`'s measurement — the 500th tile of a capped floor set reads k 0.122
against a first of 0.146, so nothing visible is lost at the wall); a stored profile records
a complete set of choices while a URL is sparse (`score-floor-by-default` D-series); all
client I/O goes through ApiClient (D1); the server must run on Node unchanged (D1 of the
architecture constraints).

## Goals / Non-Goals

Goals:

- Floor-then-count composition end to end, this repo landable before or after the index —
  but the index's edits (the branch, the ten-row default going from the schema, `rank()`'s own
  signature, the REPL, and the surface doc, and the `matched` count of D9) landing together.
- One encoding rule — presence — across live state, profile storage, and URL.
- A count a user can set that never collides with the index's cap.

Non-Goals:

- No change to `/similar` (no floor there; k stays k).
- No change to the floor's default value (0.1 stays, being the index's own measurement).
- No rescaling, banding, or reinterpretation of scores.
- No change to what the `truncated` bit means: it is the *index's* cap bit, describing the
  index, not the user's count.

## Decisions

**D1 — Composition happens in the index, not in this app.** The alternative — keep the
index's replace semantics, have the server send the floor only, and slice to the count
client-side — was rejected on honesty grounds: the `truncated` bit would describe the floor
set, not the display set, and the wall notice ("the index returned fewer than was asked
for") would start reporting a cut this app made. With composition in `rank()`, every layer
reports its own act: the floor and count are the user's, the cap is the index's.
*Alternative rejected*: server-side slicing (same dishonesty, plus the server would need the
count twice — once for the request, once for the slice). *Alternative rejected*: sending the
user's count as the index's `cap`, which composes **today**, with no upstream change at all —
`api.py` truncates at `cap` *after* `rank()`, so `{min_score: 0.1, cap: 60}` is already
floor-then-count against the deployed index. Rejected for the same reason as client-side
slicing, one layer down: `cap` is where the index's *own* ceiling lives, and overloading it
collapses two different facts into the single `truncated` bit — a set cut by the user's 60 and
a set cut by the index's 500 become indistinguishable to the client. So the upstream change is
not what makes composition *possible*; it is what keeps `truncated` meaning the index (D8).

**D2 — Composition order is floor, then count, and the reason is D9.** "Best N of everything
at least this similar." An earlier draft rejected the reverse on the grounds that flooring the
best N "returns fewer than N for no stated reason". That is false, and the claim is worth
retracting precisely: the floor tests the same key the sort ordered by, so the floor set is a
*prefix* of the descending order, and `order[mask][:t]` and `order[:t][mask]` select the same
rows for every input. Fuzzed here at 20000 cases built to force ties across both cuts: **zero
row divergences**. The two orders are indistinguishable in what they return.

They are not indistinguishable in what they can *say*. `matched` (D9) is counted between the
two operations, so it means "how many cleared the floor" only if the floor was applied to the
whole collection first. Compose the other way and the number is bounded by the count — 60,
never 875 — and "showing 60 of 875 above the floor" becomes unsayable. In the same fuzz the
two orders disagree on `matched` in **8926 of 20000 cases**. So the order is load-bearing for
the reporting, not for the result set, which makes D2 and D9 one decision rather than two.
Floor-then-count also degrades gracefully: a floor matching nothing still returns nothing (the
floor's honest answer survives), and a floor matching more than N returns exactly N.

**D3 — Both bounds are the default.** This is the user's call and it reverses my own earlier
caution (that both-by-default would silently cut the measured specific-phrase sets of
69–177 above the floor at 60). The deciding property: a default should make a view usable
without tuning, and a grid capped at 60 above the floor is exactly what the count default
already was — the floor just stops the cap from carrying models nobody asked about. The
specific-phrase sets are cut at 60 by choice; raising the count is one field away.
*Alternative rejected*: both-in-force only as an explicit act (keeps floor-only default) —
rejected because a default that differs from the resting state of the controls is the
"two defaults" confusion `score-floor-by-default` was written to end.

**D4 — The record rule is presence, uniformly.** Every substrate — live `Tuning`,
`StoredTuning`, URL — uses one rule: *a bound named is a bound in force; a bound absent is
a bound not in force*. This kills two special cases landed the day before this change (`de264a3`, 2026-08-26): the
`minScore: null` profile sentinel (whose entire job was distinguishing "count chosen" from
"pre-floor profile" — a distinction that existed only because absence had to mean
"floor-only in force"; with absence meaning "not in force", the two collapse harmlessly) and
the URL's "count named even at its default" rule (which existed because absence had to read
as the floor; with absence reading as both-at-defaults, a count-only view names its count
because it is in force, not because it is non-default). It kills a **third** the proposal did
not name: `urlState`'s serializer skips `min` whenever the floor equals its default, so a
floor-only view at 0.1 writes no bound param at all — under the presence rule that reads back
as both, which is the opposite of what it recorded.

Migration under this rule:

| stored bytes | old meaning | new reading | faithful? |
|---|---|---|---|
| `{top: 60, minScore: null}` | count chosen | count-only | yes |
| `{top: 60}` (no minScore key) | pre-floor profile | count-only | yes — a count *was* in force when it was written |
| `{top: <inert>, minScore: 0.1}` | floor-only (top inert) | both 0.1 + that inert count | no — and worse than "the new default"; see below |
| `{minScore: 0.1}` | (impossible under old writer) | floor-only | — |

The third row is the one real loss, and it is larger than an earlier draft of this table
said. `Tuning.top` is **required** (`searchOptions.ts`'s `Tuning`) and the tuning store's
serializer spreads the whole object, so the old writer emitted `top` on *every* write,
including from a floor-only view whose count field was disabled. The stored number is
therefore whatever that disabled field last held — commonly 60, but possibly 10, or any count
its owner set before switching to the floor. Row 3 does not read as "floor plus the new
default"; it reads as "floor plus a stale inert number". A discriminator field
(`bound: 'floor' | 'count' | 'both'`) is still rejected — its only job would be reconstructing
a distinction that ceased to matter when both became the default — but "every old floor
profile would map to the default either way" was simply wrong, and whether the gap is worth a
read-side mitigation is the open question below.

**D5 — The count clamps at 500, as a constant.** `MAX_RESULT_COUNT = 500` in
`shared/types.ts`, clamped at every reader of a `top` value: the SidePanel's field entry,
`urlState`'s parse, and `searchOptions`' storage reader. The server passes `top` through
untouched. The clamp matches `api.py`'s `QueryRequest.cap` **default** of 500 rather than a
fixed index ceiling — `cap` is a per-request field (`ge=1, le=10000`) that this app never
sends, so 500 is what it gets; a constant pinned to a default we rely on, which is worth
saying so it does not rot silently if the app ever sends `cap`.

*Consequence, corrected:* an earlier draft said a clamped-500 request under a rich floor can
still be truncated by the cap. It cannot. Composition slices `order` to `top` inside `rank()`
**before** `truncated = len(order) > req.cap` is evaluated, so a count of 500 against a cap of
500 makes the bit `500 > 500` — always false. With the clamp in place the index's cap can
never fire while a count is in force, which means the wall notice is reachable only in the
floor-only state, where no `top` is sent. That is a real narrowing of D8's notice and is
stated in the spec, whose scenario is scoped to a *floor-only* search. *Alternative rejected*: clamping only in the
server (a UI that shows a field silently rewrite what was typed reads as a bug); and
clamping nowhere above 500 (a URL hand-edited to 5000 would spend the index's headroom on
rows the cap deletes).

**D6 — The control is three-way, and in the both state both fields are live.** The current
segmented control (Top / Floor) encodes exclusivity — choosing one disables the other's
field, which is the UI telling the D1 lie in pixels. The three states are count-only,
floor-only, both; in the both state both fields are enabled and either edit re-runs the
query. *Alternative rejected*: two always-live fields with no mode — visually simpler, but
it cannot represent "floor only, uncapped", which is the state `score-floor-by-default`'
s whole argument was made for (specific phrases return 69–177 above the floor; an
uncapped floor is a state worth keeping reachable, not a mode to delete).

**D7 — The server forwards presence, not choices.** `query()` sends `min_score` when the
tuning carries one and `top` when it carries one, independently; where a resolved tuning
somehow carries neither (no caller produces this today), it falls back to `top: TOP` as
now. The one-choice guard comment is deleted — the constraint it stated no longer exists.
The staging property, *corrected*. It holds in the direction originally stated: under
today's index a both-request gets floor-only (top ignored), so this app can land first with
no window where it promises composition it cannot get. It does **not** hold in the other
direction. The index landing the composition branch *alone* breaks the app as currently
deployed — today's default is floor-only, `query()` omits `top` when it sends a floor, and
`QueryRequest.top` then defaults to 10, so every default meaning search would return ten
rows (875 → 10 on the `fantasy character` shape, measured on both sides of `add7fd4`; see Context). The upstream change must retire the ten-row
default in the same commit as the branch — in `rank()`'s own signature and the REPL's, not
only in `QueryRequest`. That is a constraint on the index's change,
not on this one, and it is the reason group 0 verifies the schema and not only the branch.

**D8 — The cap notice keeps attributing to the index, and becomes floor-only.** The bit
never describes the user's count: `truncated` compares against `req.cap`, which only the
index sets. What changes is *when it can fire at all*. With a count in force and clamped at
the cap, `rank()` returns at most `top ≤ cap` rows, so the comparison is never true — the
worked example an earlier draft gave here (count 500, rich floor, notice fires) cannot
occur. The notice therefore survives exactly in the floor-only state, where no `top` is
sent and the floor set can exceed the cap. That is the state `score-floor-by-default`'s wall
measurement was taken in, so nothing that has been observed becomes unobservable — but a
user in the new default state will never see the notice, and that is a deliberate
consequence rather than an oversight. No notice is introduced for "your count cut the
set": a count is presented as showing the strongest matches, the rule "Meaning search is a
mode of the search input" already records, and a user-chosen cap cutting a floor set is that
rule's ordinary case. One thing D8 does not say, and should: the alternative it rejects was
not available to reject. `/query` answers `{scope, weak, best_z, truncated, results}` and
carries no floor-set size, so "875 matched, showing 60" was not implementable at any price
from the client side — D8's product argument was also a technical floor, and stating it only
as a choice flattered the reasoning. D9 is what lifts the constraint; it is not a nicety added
on top of a settled decision.

**D9 — The capped view says what it was drawn from.** D8 leaves the default state with no
statement of its own size against the set behind it: floor 0.1 and count 60 over the
`fantasy character` shape shows 60 of 875 with nothing on screen saying 875 exists. That is
not the wall notice returning under another name — the wall notice attributes to the index's
ceiling and must stay narrow — it is the count attributing to itself. `rank()` is being opened
anyway, and the number is free there and nowhere else: after the floor filter and *before* the
top slice, `len(order)` is exactly the figure, and it is unrecoverable from the response once
the slice has happened. It is also what makes D2's order observable at all — see there. So the upstream ask gains a third element, `matched`, alongside the
branch and the retired ten-row default. It rides this repo's existing attribution path —
index `truncated` → `QueryResult.truncated` → the route's `capped` → the label in `App`'s
`resultsLabel` — as index `matched` → `QueryResult.matched` → the route's `matched` →
`SemanticSearchResult.matched`, and is additive on the wire the way `scores` is
(`confidence-scores-on-tiles` D1): an index or server that does not send it leaves the client
saying nothing extra rather than failing. *Alternative rejected*: counting client-side — the
client only ever receives the sliced set, so there is nothing to count.

## Risks / Trade-offs

- [Upstream lands differently — e.g. count-then-floor] → **Invisible in the rows**, per D2's
  fuzz: the two orders return identical result sets, so nothing about the grid betrays it. The
  only observable is `matched`, which is bounded by the count under the wrong order, so that is
  what this repo's contract test asserts (task 4.1) and what the upstream test pins. A test
  written against rows alone would pass under either order and report a safety it does not
  have.
- [Both-by-default cuts today's floor-only views] → Measured and accepted (D3): specific
  phrases carried 69–177 above the floor; they now show 60. The count field is one edit
  away, and the default is a statement about the resting grid, not a ceiling on intent.
- [Profile migration's third-row infidelity] → Recorded in D4 with its reasoning; the
  affected profiles are those written between `score-floor-by-default` landing (today) and
  this change shipping — a window of days, on machines of one user.
- [URL rule change breaks links written under `score-floor-by-default`] → Links naming
  `top` only read as count-only — which is what their writers saw. Links naming neither
  read as both-at-defaults rather than floor-only: the one behavioural change, accepted
  because the whole point of the change is that neither-named means the defaults, which
  are now both.

## Migration Plan

No server-state migration; the profile encoding migrates on read (D4's table), the URL
encoding changes meaning in place (D4, last risk). Land order is free between the repos
(D7); within this repo, land server forwarding and client state together so the app never
sends a both-request it renders as floor-only while its own UI shows two live fields.

Rollback: revert this repo's commit — the profile reader's absence-rule reads old-style
profiles correctly in both directions (a `null`-carrying profile is just absent-`minScore`
to the new reader, and the old reader treats its absence as the floor default); URLs
written under the new rule degrade to floor-only under the old reader, their `top`
ignored — today's behaviour, not an error.

## Open Questions

None outstanding. The floor's default (0.1), the count's default (60), and the clamp (500) are
all carried from measured ground rather than chosen here. One question was raised and closed:

- **Does row 3 of D4's migration table want a mitigation? — No, decided; accepted as
  recorded.** As corrected there, a profile
  written under the old floor-only encoding reads back as floor 0.1 plus an inert count its
  owner never chose, possibly as low as 10 — a materially worse view than the defaults, not
  the defaults. The cheap fix is a schema marker written by the *new* writer only: a profile
  lacking it predates composition, so its `top` is read as the default 60 rather than as a
  choice. That is a discriminator in bytes but not the one D4 rejects — it distinguishes
  encodings, not bound-states, and it goes inert on its own once no unmarked profile remains.
  That was weighed against the affected population — profiles written between `de264a3` and
  this change, on one user's machines — and rejected: the marker costs a permanent field in
  the stored encoding to repair a window of days, which is a worse trade than the stale count
  it would fix. Row 3's infidelity stands as the table states it.
