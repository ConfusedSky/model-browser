# Semantic Search Tuning

## Why

`/query` takes five parameters that shape what comes back, and this app sends
one of them. `text` and `path` are the query; `raw`, `pool`, `top` and
`min_score` decide how the phrase is embedded, how a model's views are reduced
to one score, and where the result set stops. `semantic-search` fixed all four
at defaults chosen once, in a design document, before anyone had run a query
against the real collection.

They are not settings to get right once. Whether a phrase reads better
templated or verbatim depends on the phrase; whether `max` beats `softmax`
depends on whether the subject is visible from every angle or only one; the
useful `top` depends on whether you are hunting one model or surveying a set.
The only way to know is to try them on the library in front of you, which is
exactly what cannot be done today.

## What Changes

- **Four tuning controls in the search tab**, alongside the mode: how the text
  is embedded (templated or verbatim), how views are pooled, how many results,
  and optionally a score floor instead of a count.
- **A floor and a count are alternatives, not both.** Setting a floor answers
  "everything at least this similar", which has no N; the count is what applies
  otherwise, and the UI presents them as one choice rather than two fields that
  can disagree.
- **The index's `truncated` becomes meaningful and is reported.** It is the cap
  biting — now on `top` as well as on a floor — so a result set that hit the
  ceiling says so rather than looking complete. `semantic-search` D8 dismissed
  this flag on the grounds that it could not fire in top-N mode; that stopped
  being true upstream.
- **Sticky per profile and carried in the URL**, on the same rule as the other
  search options: they determine which entries the view contains, so a shared
  result set that omitted them would reproduce differently for its recipient.
- Unchanged: the mode, the scope, the join, the pose, and every empty state.

## Capabilities

### Modified Capabilities

- `semantic-search`: **MODIFIED** *Meaning search is a mode of the search input*
  — the bound on results stops being a constant this app chooses and becomes a
  control, and the index's truncation flag is honoured where it applies.
- `url-navigation`: **MODIFIED** *The URL names the committed view* — four more
  parameters, each carried only when it is not the default.

## Impact

- `server/src/semantic.ts` — `query()` takes the tuning it is given rather than
  a module constant; `TOP` becomes a default, not a rule.
- `server/src/app.ts`, `client/src/api/client.ts` — the parameters travel.
- `client/src/lib/searchOptions.ts`, `lib/urlState.ts` — four more sticky, URL-
  carried options.
- `client/src/components/SidePanel.tsx` — the controls, shown in meaning mode.
- Ordering: **after `semantic-search`**, which owns everything this adjusts.
