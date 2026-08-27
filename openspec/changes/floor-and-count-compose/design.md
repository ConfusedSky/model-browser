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

**The branch is not the only upstream edit, and the other one is load-bearing.**
`QueryRequest.top` is `int = Field(10, ge=1, le=1000)` — non-nullable, defaulting to **10**.
This app's `query()` omits `top` entirely when it sends a floor, so a floor-only request
arrives with `req.top = 10` today and is unharmed only because the replace branch discards
it. Change the branch to floor-then-slice without touching the schema and that same request
slices the floor set to ten rows. Measured against the real `rank()` on the
`fantasy character` shape (875 models above the floor): **875 rows today, 10 rows after**.

So `top` must become nullable upstream — absent meaning *no cap* — in the **same** change as
the composition. That also inverts this change's ordering story, which D7 revises: the
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
  but the index's two edits (the branch, and `top` becoming nullable) landing together.
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
count twice — once for the request, once for the slice).

**D2 — Composition order is floor, then count.** "Best N of everything at least this
similar." The reverse (floor the best N) returns fewer than N for no stated reason and makes
the count a floor's guard rather than a cap — a reading nobody asking for "60" means.
Floor-then-count also degrades gracefully: a floor matching nothing still returns nothing
(the floor's honest answer survives), and a floor matching more than N returns exactly N.

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
because it is in force, not because it is non-default).

Migration under this rule:

| stored bytes | old meaning | new reading | faithful? |
|---|---|---|---|
| `{top: 60, minScore: null}` | count chosen | count-only | yes |
| `{top: 60}` (no minScore key) | pre-floor profile | count-only | yes — a count *was* in force when it was written |
| `{top: 60, minScore: 0.1}` | floor-only (top inert) | both 0.1 + 60 | no — but the old bytes cannot say so, and this is the new default |
| `{minScore: 0.1}` | (impossible under old writer) | floor-only | — |

The third row is the one real loss. It is accepted because the alternative is a
discriminator field (`bound: 'floor' | 'count' | 'both'`) whose only job is to reconstruct
a distinction that ceased to matter when both became the default — every old floor profile
would map to the default either way.

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
rows (measured: 875 → 10 on the `fantasy character` shape). The upstream change must make
`top` nullable in the same commit as the branch. That is a constraint on the index's change,
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
consequence rather than an oversight. No new notice is introduced for "your
count cut the set": a count is presented as showing the strongest matches, the rule
"Meaning search is a mode of the search input" already records, and a user-chosen cap
cutting a floor set is that rule's ordinary case.

## Risks / Trade-offs

- [Upstream lands differently — e.g. count-then-floor] → The staging test in D7 breaks
  visibly: with the index composing the other way, a both-request returns fewer than N for
  no stated reason. The upstream task pins the order with a test of its own; this repo's
  contract test asserts the composed shape end to end.
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

None outstanding. The floor's default (0.1), the count's default (60), and the clamp (500)
are all carried from measured ground rather than chosen here.
