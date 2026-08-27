## Why

A meaning search stopped at the best 60. The floor — "everything at least this similar" —
was something the user switched on, and switching it on seeded `0.2`, a number with no
recorded reason in any spec, design document, or the index's own docs. The index publishes
the measurement that makes it wrong: text-query cosines run around 0.1, so the first click of
`score ≥` cut at twice the level of the distribution it was cutting, and presented that as a
starting point rather than as an aggressive filter.

The deeper mismatch is which question each bound answers. A count answers "the best N of
whatever there is", which is a question about the grid — it always returns N, whether the
collection holds fifty good matches or none. A floor answers "everything at least this
similar", which is the question a phrase asks, and it returns nothing when nothing matches.
`semantic-search-tuning` D1 settled that the two are one choice and never both; it did not
argue for which one applies when the user has chosen neither, and made the count the default
by leaving the floor undefined.

This records the flip, which landed in `de264a3`.

## What Changes

- The default bound for a meaning search is a **score floor at 0.1** — the index's own
  measured level for text queries — rather than a count of 60.
- Turning the floor back on after choosing a count starts it at that same 0.1, so the control
  has one resting place instead of a default and an unrelated seed.
- **The URL contract inverts with it.** The count is now the bound a view opts into, so a link
  names it explicitly whenever it is in force, including at the count's own default value: a
  link naming neither bound reads back as the floor, and the count it was written to carry
  would be the field the index ignores.
- A stored profile reads an absent floor as the count being in force, not as an unset field —
  a profile records a complete set of choices, where a URL is sparse by design.
- No new control, no new parameter, and no change to how a bound is chosen or shown.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `semantic-search`: **ADD** a requirement naming which bound applies when the user has chosen
  neither, and what follows for a link and for a stored profile. The existing "Meaning search
  is a mode of the search input" requirement names neither bound as the default and is left
  alone — thirteen scenarios that this change does not touch.

## Impact

**Client**

- `TUNING_DEFAULTS` (`client/src/lib/searchOptions.ts`) carries `minScore: 0.1`. `minScore:
  undefined` still means the count is in force — the sentinel the toggle buttons, the URL
  writer and the wire builder all read — so nothing downstream learns a new shape.
- `parseUrl`/`serializeView` (`client/src/lib/urlState.ts`) invert as described: `top` alone
  selects the count and is written even at 60, `min` is written only off 0.1, neither means
  the floor.
- `SidePanel`'s reset affordance compares `minScore` against the default rather than against
  `undefined`, or it reads as modified at the defaults.

**Explicitly not affected**

- The wire and the server. The index already ignores `top` under `min_score`, and the request
  builder already sends whichever is in force.
- Every other search option, and name search entirely.

**Consequence worth stating**

- A floor at the distribution's own level admits far more than 60 models, so the default search
  will routinely meet the index's 500 `cap` and report that it returned fewer than was asked
  for. That notice is correct and already specified; it will simply be a common sight, and the
  thumbnail sweep behind 500 tiles is the cost `thumbnail-sweep-priority` measures.
