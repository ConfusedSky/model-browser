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
  upstream change must **also** retire the ten-row count default from every place the index
  carries it — `QueryRequest.top`, `rank()`'s own signature, the REPL's `show_query`, and
  `docs/api/surface.md`'s contract row — because this app omits `top` whenever it sends a
  floor and each of those defaults to 10: the branch alone would slice every floor-only set to
  ten rows (875 → 10 on the `fantasy character` shape, measured on both sides of the upstream
  commit; design's Context carries the runs and their conditions). This app can still land first, since a
  both-request degrades to today's floor-only behaviour until the index composes; it is the
  index's own edits that must land together, not the two repos.
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
- **A capped view says what it was drawn from.** Where a count caps a floor-bounded set, the
  view states how many models cleared the floor — "60 of 875 above the floor" rather than 60
  presented as the whole answer. The figure comes from the index (`rank()` counts the floor
  set before applying the count, and it is unrecoverable from the response afterwards), so it
  is the third element of the upstream ask. It is additive on the wire like `scores`: an index
  or server that does not send it leaves the client saying nothing extra. This is not the cap
  notice under another name — that one attributes to the index's ceiling and stays narrow.
- **The record contract simplifies to one rule: a bound named is a bound in force; a bound
  absent is a bound not in force.** A link or profile naming neither bound reads as both at
  their defaults; naming only `top` reads as count-only; naming only `min` reads as
  floor-only; naming both reads as both. Three special cases die with it — the `minScore: null`
  profile sentinel, the URL's "count named even at its default" rule, and the URL's converse
  habit of *omitting* `min` when the floor sits at its default (which alone would make a
  floor-only search at 0.1 serialize to nothing and read back as both). Absence now means the
  same thing on every substrate, with one stated exception: a record naming neither bound is
  both-at-defaults, so the resting state is written as absence and read back as itself.
- **Stored profiles migrate by the same rule**: `minScore: null` (count chosen) and a
  profile carrying only `top` (pre-floor) both read as count-only — which is what each of
  them meant when written. A profile that carried a floor *and* a top (the top having been
  inert under the old encoding) reads as both — accepted rather than reconstructed, since the
  old bytes genuinely cannot say which of the two the owner saw. Note what that count is: the
  old writer emitted `top` on every write, so the inert number is whatever the disabled field
  last held, not the new default, and it can be as low as 10. Design D4 carries the corrected
  table and an open question on whether to mitigate.

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
  floor-then-top **and** the ten-row count default goes from all four places that carry it
  (`QueryRequest.top`, `rank()`'s own signature, `test_categories.py`'s `show_query` REPL, and
  `docs/api/surface.md`'s `POST /query` row) **and** the response gains `matched` — the count
  of models that cleared the floor before the count applied (design D9) — in the same change — the branch without them
  slices every floor-only request to ten rows, breaking this app as it is deployed today,
  whose default is floor-only, and the REPL alongside it. Between the two repos the order is free: until
  the index composes, a request carrying both behaves exactly as today (floor wins, count
  ignored). No such change exists in that repo yet — its `openspec/` holds only `config.yaml` —
  so this dependency is currently unowned; this change records it and group 0 verifies it,
  every carrier of the ten-row default included.
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
  index did rather than what the user chose. `resultsLabel` gains the separate `matched`
  clause (D9), which attributes to the count rather than to the index.
- `shared/types.ts` `SemanticSearchResult` and `server/src/semantic.ts` `QueryResult` — each
  gains an optional `matched`, forwarded by the route beside `capped`.
- No pixel, thumbnail, rig, or listing change. `/similar` untouched — it has no floor and
  its k-only count stays as it is.
