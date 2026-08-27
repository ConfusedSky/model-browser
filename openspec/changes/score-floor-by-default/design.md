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

*Consequence, now measured rather than feared.* The worry when this landed was that 0.1 sits at
the *centre* of the text-query distribution, so the default would admit nearly everything and
meet the index's 500 `cap` on every phrase. Measured against the running index — 97 models,
`embed-cache-test`, softmax — that is wrong, and wrong in the useful direction. 0.1 sits near
the *top* of the distribution, whose median is 0.02–0.05 and whose floor is negative:

| phrase | at the floor | at the old count of 60 |
|---|---|---|
| `treasure chest` | 1 | 60, tail at 0.038 |
| `spaceship` (nothing in the collection) | 2, weak | 60 |
| `winged demon` | 8 | 60, tail at **0.003** |
| `dragon` | 10 | 60 |
| `a model` / `fantasy character` (deliberately generic) | 21–24 | 60 |

The count's failure is in that last column: eight real matches for `winged demon`, and fifty-two
tiles of noise under them, the last scoring 0.003. That is the grid the floor removes, and it
is the argument for this change stated in numbers rather than in principle.

The cap is a *broad-phrase* outcome, not the routine one — and that half is now measured too,
against the library itself (`embed-cache512`, 3380 models on `/run/media/masa/STLLibrary`):

| phrase | tiles at the floor | |
|---|---|---|
| `treasure chest` | 69 | floor-bounded |
| `a knight with a sword` | 125 | floor-bounded |
| `winged demon` | 177 | floor-bounded |
| `a model` / `a miniature figure` / `fantasy character` | **500** | capped |

**Where the cap bites it is a wall, not a horizon.** `fantasy character` scores 875 models above
the floor; the 500 returned run from k 0.146 down to k 0.122 — the last tile at 84% of the
first. Nothing tapers, so the cut falls mid-distribution and the badges say so on the tile
itself, which is the only reason it is legible at all. The notice is correct and reads as a
bound met rather than as a failure: *"Meaning matches for "fantasy character". The index
returned fewer than asked for — its cap."*

*Not resolvable by moving the floor,* which is why the number stays at 0.1. Counted across the
same three phrases:

| floor | `winged demon` | `fantasy character` | `treasure chest` |
|---|---|---|---|
| 0.10 | 177 | 875 | 69 |
| 0.12 | 66 | 558 | 30 |
| 0.13 | 43 | 275 | 24 |
| 0.14 | 30 | 39 | 21 |

No floor both keeps a specific phrase's set rich and holds a generic one under the cap. 0.13 is
the first that clears the cap for all three, and it does so by cutting `treasure chest` to 24
and `winged demon` to 43 — punishing the phrases that work in order to tame the ones that do
not. A vague phrase matching a third of a miniatures library is a true answer to a vague
question, and the honest response is the notice, not a floor tuned to hide it.

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

### D3: A stored count is an explicit `null`, because `undefined` does not survive the write

The first version of this decision said a stored profile with no floor was a user who had
turned the floor off, where a URL's absence resolves to the default — two rules disagreeing
deliberately. The storage half could not hold: `setSearchTuning` writes through
`JSON.stringify`, which **drops** a key whose value is `undefined`, and the count's in-memory
sentinel is exactly `undefined`. So a chosen count wrote itself as a missing key — byte for
byte the same as every profile written before this change, when `TUNING_DEFAULTS` had no
`minScore` at all. The rule asserted a distinction the stored bytes could not carry, and its
victim was every existing user: each would have read back as having opted out of a decision
nobody had asked them about.

A count is therefore written as `null` and read as the count. A *missing* key is a profile
older than the field and takes the default, like every other option here that nobody has set;
a malformed value falls back the same way, to the default rather than to the count, since a
count is a choice and a fallback is not. That leaves storage and the URL agreeing after all —
absence means the default in both — and the count explicit in both.

*Found by review, not by design:* the original rule read plausibly and had a comment at its
site explaining reasoning that was never true of the code beneath it.

## Risks / Trade-offs

- **The default search meets the index's cap.** → Only on generic phrases, and measured on the
  real library: specific phrases return 69–177 tiles floor-bounded, generic ones cap at 500
  (D1). Reported by a notice that reads as a bound met, and the badges make the cut visible —
  a 500th tile at 84% of the first is a wall, and it looks like one.
- **A generic phrase now builds the most expensive grid the app can produce.** → 500 tiles is
  the worst case the old count of 60 could never reach. Thumbnails filled at ~1.07/s in the
  measurement above (24 → 40 tiles in 15s, cold cache on removable media), so such a grid
  sweeps for minutes. That cost is `thumbnail-sweep-priority`'s subject — an active change that
  prioritises visible tiles — and not a reason to move the floor, but the two now interact and
  whichever lands second should re-measure.
- **A user's stored count survives, so two profiles disagree about what "default" means.** →
  Correct: one of them chose. The reset affordance restores the floor in one click, and it now
  compares against the default rather than against `undefined`, so it appears exactly when
  something is off-default.

## Migration Plan

No cache is invalidated and no wire field moves. One stored value does change meaning, and
deliberately: a profile written before this change carries no `minScore` key, and now resolves
to the floor rather than to the count (D3). That is the intended reading — such a profile
predates the option and recorded no choice about it — and it is why the count is written as an
explicit `null` from here on, so that a real choice is distinguishable from a record that
predates the question. Nobody loses a setting they made; some people gain the new default,
which is the point of moving it.
