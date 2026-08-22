# Tasks — semantic-search-tuning

> **Ordering: hard dependency on `semantic-search`**, which owns the mode, the
> route, and the index client this adjusts. The spec delta is written against
> the text that change leaves behind. Before archiving, dry-run the real
> command against a throwaway copy of `openspec/` (see CLAUDE.md).

## 1. The parameters reach the index

- [x] 1.1 `query()` takes the tuning it is given; `TOP` becomes its default rather
      than a rule
- [x] 1.2 A floor replaces the count on the wire rather than accompanying it (D1) —
      the index ignores `top` under `min_score`, so sending both states a
      relationship that does not exist. Asserted on the request body, not inferred
- [x] 1.3 `raw` and `pool` are sent only when set, so an untuned query is the
      request it always was
- [x] 1.4 The index's `truncated` is carried back as `capped` (D2)

## 2. Sticky, and in the URL

- [x] 2.1 A tuning shape beside the other search options, per-field validated on
      read so one malformed value does not discard a usable set
- [x] 2.2 Each field in the URL, omitted at its default; a floor and a count are
      never both present
- [x] 2.3 Over a URL-named search an absent field means the **default**, never the
      reader's stored value — the rule `search-options` settled

## 3. Controls

- [x] 3.1 Controls in the search tab, meaning mode only, named for what they do to
      results rather than for the field they set (D4)
- [x] 3.2 The count and the floor are one choice, with the inactive one visibly
      inactive
- [x] 3.3 Changing a parameter re-runs a committed meaning query — trying it is the
      point, and a setting that applied only to the next search makes trying it a
      two-step
- [x] 3.4 A reset, shown only when something is off-default

## 4. Reporting

- [x] 4.1 A count-bounded set still reads as "the strongest matches", never as
      truncation; the index's own cap biting is reported separately, since that
      bound was not the user's choice and their control is what met it

## 5. Verification

- [x] 5.1 `bun run typecheck` and `bun run test` pass across workspaces
- [x] 5.2 Manual E2E against the running index: change each parameter and see the
      result set change; a tuned URL reproduces in a fresh profile; a `top` above
      the index's cap reports the cap rather than looking complete
      (run 2026-08-21 over the 3396-model library: pool/raw/top/min each changed
      the set; top=999 reported the index's 500 cap; a pool+raw+top link
      reproduced cold in a wiped profile without writing its options to storage —
      after the `raw`→`score-raw` param rename, since Vite 403s its own reserved
      `raw` query on any cold load)
