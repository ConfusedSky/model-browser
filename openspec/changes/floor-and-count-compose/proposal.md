# Floor and Count Compose

## Why

A meaning search stops at one bound: either a count or a floor, never both — a rule this app
inherited from the index's own implementation, where `min_score` *replaces* the top-N cut
rather than composing with it. That forces a false choice. The floor answers "everything at
least this similar" but is unbounded above; the count answers "the best N" but carries
models nobody asked about. What a user actually wants in one view is both: *everything
relevant, capped at a size the grid can carry*. `semantic-search-tuning` D1 and
`score-floor-by-default` both recorded the two as one choice; that was a fact about the
index's `rank()`, not a fact about the question, and the index is this project's own —
`mini-classify` — and can change.

## What Changes

- **The index composes the bounds**: where both a floor and a count are given, the result
  set is the best N *of everything at or above the floor* — floor first, count as a cap on
  what survives it. This is a change to `mini-classify`'s `rank()` (floor-then-slice); the
  index's own return cap (500) stays the outer wall above any user-chosen count. That
  upstream change must **also** make `top` nullable — absent meaning no cap — because this
  app omits `top` whenever it sends a floor and `QueryRequest.top` defaults to 10: the branch
  alone would slice every floor-only set to ten rows (measured on the real `rank()`,
  875 → 10). This app can still land first, since a both-request degrades to today's
  floor-only behaviour until the index composes; it is the index's two edits that must land
  together, not the two repos.
- **Both bounds are in force by default**: a meaning search with no choice made is bounded
  at floor 0.1 *and* capped at the default count of 60 — relevant results, at a size the
  grid has always been sized for. This reverses `score-floor-by-default`'s "a count and a
  floor remain one choice and never both", recorded the day before this one (`de264a3`,
  2026-08-26).
- **Each bound is settable independently.** The two-way Top/Floor toggle becomes a three-way
  choice: count only, floor only, or both. In the both state both fields are live. Defaults:
  floor 0.1, count 60.
- **The count field is clamped to 500** — the default of the index's own return cap
  (`QueryRequest.cap`, which this app never overrides), carried here as a named constant
  rather than a bare literal — so a user-chosen count can never ask for what the index would
  truncate anyway. A consequence worth stating: with the count clamped at the cap, the
  index's truncation bit can no longer fire while a count is in force, so the "returned fewer
  than asked for" notice becomes reachable only in the floor-only state.
- **The record contract simplifies to one rule: a bound named is a bound in force; a bound
  absent is a bound not in force.** A link or profile naming neither bound reads as both at
  their defaults; naming only `top` reads as count-only; naming only `min` reads as
  floor-only; naming both reads as both. The `minScore: null` profile sentinel and the
  "count named even at its default" URL special case both die — absence now means the same
  thing on every substrate.
- **Stored profiles migrate by the same rule**: `minScore: null` (count chosen) and a
  profile carrying only `top` (pre-floor) both read as count-only — which is what each of
  them meant when written. A profile that carried a floor *and* a top (the top having been
  inert under the old encoding) reads as both — the new default, accepted rather than
  reconstructed, since the old bytes genuinely cannot say which of the two the owner saw.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `semantic-search` — MODIFIES "Meaning search is a mode of the search input" (the
  parameters clause: a count and a floor are no longer one choice) and REMOVES and re-adds
  "The score floor is the default bound" as a requirement about which bounds are in force
  and how they compose, carry, and clamp.

## Impact

- **Upstream, with one hard ordering inside it**: `mini-classify`'s `rank()` gains
  floor-then-top **and** `QueryRequest.top` becomes nullable, in the same change — the branch
  without the schema slices every floor-only request to ten rows, breaking this app as it is
  deployed today, whose default is floor-only. Between the two repos the order is free: until
  the index composes, a request carrying both behaves exactly as today (floor wins, count
  ignored). That repo plans its own change; this one records the dependency and group 0
  verifies it, schema included.
- `server/src/semantic.ts` `query()` — forwards whichever bounds are present instead of
  choosing one; the "one choice" guard comment goes.
- `shared/types.ts` `SemanticTuning` — both fields optional, both may be present; the
  "ignored when a floor is set" doc line goes. Gains the count-clamp constant.
- `client/src/lib/searchOptions.ts` — `Tuning` makes `top` optional alongside `minScore`;
  `StoredTuning` loses the `null` sentinel; defaults become both-at-defaults.
- `client/src/lib/urlState.ts` — parse/serialize by presence; no bound-acquisition special
  case; clamp on parse.
- `client/src/components/SidePanel.tsx` — the Top/Floor segmented control becomes three-way;
  both fields live in the both state; the reset link condition follows the state shape.
- `client/src/App.tsx` — the cap notice: with a user count below the index cap, the index's
  `truncated` bit describes the cap, not the user's count; the notice keeps saying what the
  index did rather than what the user chose.
- No pixel, thumbnail, rig, or listing change. `/similar` untouched — it has no floor and
  its k-only count stays as it is.
