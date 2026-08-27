## Context

`semantic-search-tuning` D1 settled that a count and a floor are one choice, never both,
because the index honours only one of them. It said nothing about which one applies to a user
who has chosen neither, and the implementation answered that by omission: `minScore` was
optional, absence meant the count, and the count's default of 60 was therefore the default
bound. The floor's own starting value — `0.2`, seeded where the control is switched on — was
never recorded anywhere and does not match the distribution it cuts.

## Goals / Non-Goals

**Goals:**

- Make the floor the bound a meaning search has when nobody has chosen one, at the index's own
  measured level.
- Keep a link and a stored profile reproducing the bound they were written under, now that the
  default has moved.

**Non-Goals:**

- A new control, a new parameter, or any change to how a bound is chosen or displayed.
- Revisiting D1. A count and a floor remain one choice; only which one is the resting state
  changes.
- Tuning the floor per query, per scope, or against the set's own distribution. The number is
  a default a user overrides, not a computation.

## Decisions

### D1: 0.1, because the index measured it

The index's `docs/api/surface.md` records text-query cosines running around 0.1 against
model-to-model cosines of 0.85–0.99, over 200 random query models. A default floor is a
statement about where the interesting part of that distribution starts, so it takes the
distribution's own number. 0.2 was double it, which is why the control's first click behaved
like a filter rather than like a starting point.

*Consequence accepted:* a floor at the distribution's own level admits far more than a count of
60 would, so the default search will routinely meet the index's 500 `cap`. That is reported
already, by a requirement that exists for exactly this, and it is the honest shape of the
question — "everything at least this similar" has no reason to return sixty things.

### D2: `undefined` still means the count; only the URL inverts

The obvious implementation is to make the floor non-optional and give the count its own
sentinel. It is the wrong move: `minScore: undefined` is read by the two toggle buttons, by
the URL writer, and by the request builder, and all three agree today. Changing the sentinel
would touch a shared type, the wire builder and every stored profile to express something the
existing one already expresses.

So the sentinel stays and the *URL* carries the inversion. The count is the off-default choice
now, so it is named whenever it is in force — including at its own default value of 60 — while
the floor is named only when it is not 0.1, and a URL naming neither means the floor.

*Why the reader half is not optional:* a view resolves as the defaults with the URL's fields
spread over them. Without a rule that a bare `top` clears the floor, a shared `?top=12` link
arrives with the floor still in force, and `top` is precisely the field the index ignores in
that state — the link would land on a different result set than the one it was copied from,
silently.

### D3: A profile reads absence the other way round from a URL

A stored profile is written whole by `setSearchTuning`, so a stored set with no floor is a user
who turned the floor off, not a field nobody has filled in. A URL is sparse by construction —
"omitted at its default" is its rule — so absence there resolves to the default.

The two rules disagree deliberately, and both are commented at their site. Reading storage the
URL's way would silently overwrite a user's standing choice of the count the first time they
opened the app after this change.

## Risks / Trade-offs

- **The default search meets the index's cap.** → Accepted (D1), reported already, and visible
  rather than silent.
- **A user's stored count survives, so two profiles disagree about what "default" means.** →
  Correct: one of them chose. The reset affordance restores the floor in one click, and it now
  compares against the default rather than against `undefined`, so it appears exactly when
  something is off-default.

## Migration Plan

None. No stored value changes meaning, no cache is invalidated, and no wire field moves. A
pre-existing profile that recorded a count keeps it; one that never set tuning gets the floor.
