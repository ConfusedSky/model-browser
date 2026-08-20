# Design — semantic-search-tuning

## Context

`server/src/semantic.ts` sends `{text, path, top: TOP}` and nothing else. `TOP`
is 60, chosen in `semantic-search` D8 against the thumbnail sweep's cost. The
index also accepts `raw`, `pool` and `min_score`, and its `cap` (500) is a
ceiling on the response whatever selected it.

`semantic-search` D8 also declined to use the index's `truncated` flag, arguing
it reports `cap` biting under `min_score` and so could never fire in top-N mode.
The upstream contract now says otherwise: the cap "applies to `top` as well as
to a `min_score` floor… a caller that sets `top` above it gets `truncated: true`
rather than a quietly larger response."

## Goals / Non-Goals

**Goals:**
- Try a parameter against the real collection in seconds, without editing code.
- A tuned result set is shareable and reproducible, like every other view.

**Non-Goals:**
- Choosing better defaults. This makes them visible and changeable; what they
  should be is what the controls are for finding out.
- Exposing the index's cache-identity parameters (`views`, `elevations`,
  `model`). Those decide what the embeddings *are*, not how a query reads them —
  changing one invalidates the cache and is a classifier run, not a control.

## Decisions

### D1: A floor replaces the count; it does not accompany it

`top` and `min_score` answer different questions — "the best N" and "everything
at least this similar" — and the index ignores `top` when a floor is set. Two
fields both visible would state a relationship that does not exist, and the one
being ignored would still read as being in force.

So the control is a single choice: a count, or a floor. Picking one sends one.

### D2: The cap is the index's, and its bite is reported

Whatever the controls say, the index will not serialise more than its `cap`, and
it reports that with `truncated`. `semantic-search` D8's argument for ignoring
the flag rested on a contract that has since changed, so the flag is honoured
where it now applies: a result set that hit the ceiling says so.

This does not resurrect the truncation *affordance* D8 rejected for ranked
results. "There are more matches beyond this ranking" is still not news — a
ranking always has an N+1th. "The index refused to return as many as you asked
for" is different, and it is the user's own control that caused it, so it is
worth a word.

### D3: Tuning is view state, on the rule already in force

`search-options` D1 admits a preference into the URL when it determines *which
entries the view contains*. Each of these does: a phrase embedded raw finds
different models than the same phrase templated, and a floor of 0.2 is a
different result set from the top 60. So they are sticky per profile and carried
in the URL, omitted at their defaults, exactly as folder-matching and the kind
option are.

The alternative — treat them as debug knobs, kept out of the URL — was rejected
because the first thing anyone does after finding a good setting is send someone
the result.

### D4: Named for what they do, not for the field they set

`raw` is a flag about prompt templating; `pool` is a reduction over view stacks.
The controls say what the choice does to results — whether the phrase is read as
written, and whether a model has to look like the phrase from every angle or
only its best — because the person tuning is judging results, not calling an
API. The wire keeps the index's own names.

## Risks / Trade-offs

- [Four more URL parameters] → each passes D1's test, and each is omitted at its
  default, so an ordinary meaning link is unchanged.
- [A floor can return thousands of models] → the index's cap bounds the
  response and the flag reports it (D2); the thumbnail sweep is the real cost,
  and it is the same cost a large `top` already carries.
- [Tuning makes results irreproducible across profiles] → the opposite: the URL
  carries them, which is why they are in it (D3).
