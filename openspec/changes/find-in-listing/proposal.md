# Find In Listing

## Why

One input box does two jobs. Typing in it filters the tiles on screen; pressing Enter
commits a search. `App.tsx:54-59` keeps those as two pieces of state — `filter` and
`query` — with a comment explaining why they are separate, and then the UI collapses both
onto one control.

Today that collapse is harmless, because the filter and the search match the same string:
`search-matches-folder-names` makes the deep-search predicate match the relative path,
which is exactly what the filter matches, so filtering over search results is a
refinement. The moment a search matches on anything else, the two jobs disagree, and the
box does the wrong one. `semantic-search` is that moment — a search whose entire purpose
is returning models whose names do not contain the phrase, sitting in a box that then
filters those results by name and hides them. That change carries a decision (D9) to clear
the input at commit, which fixes the hiding at the cost of the phrase: refining a query
means retyping it.

Both problems are the same problem, and neither is really about semantic search. Filtering
is view state — no requests, cleared by navigation — and it does not need to live in the
control that submits searches.

## What Changes

- **Filtering moves to a summoned box**, opened with `Ctrl-F` (and `Cmd-F`) over any
  listing, dismissed with `Escape`. What it matches, and how it reports hiding everything,
  are unchanged; only where the text is typed changes.
- **The search input holds the query and nothing else.** Typing in it no longer filters,
  so the text that produced a set of results stays put and can be edited and re-submitted.
- **A visible way in**, so the affordance is not Ctrl-F-or-nothing: a control on the
  results header opens the same box.
- **The browser's own find is superseded** while the app has focus, which is a deliberate
  trade (D2).
- Unchanged: what the filter matches, that it issues no requests, that navigation clears
  it, and what it says when it hides every tile.

## Capabilities

### Modified Capabilities

- `file-search`: **MODIFIED** *Live name filter* — the filter keeps its matching rules,
  its request-free behavior, and its clearing rules, and changes how it is opened and
  where it is typed. The requirement's coupling of filtering to the search input is the
  part that goes.

## Impact

- `client/src/App.tsx` — `filter` stops being seeded from the search input's `onChange`
  (`:177`) and from the URL's `q` on boot (`:58`) and history restore (`:263`); those
  seedings exist only because the two shared a box.
- A new find control component, and a keydown handler that must not fire while a text
  input has focus for other reasons.
- Ordering: **after `search-matches-folder-names`**, which modifies this same requirement.
