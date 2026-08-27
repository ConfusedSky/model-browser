> **Ordering — upstream first is cleanest, not required.** `mini-classify`'s `rank()` must
> compose floor-then-count for the both state to mean anything (design D2); until it does,
> a both-request degrades to floor-only, which is today's behaviour (D7). The upstream
> change is planned in that repo (`~/Documents/tests/mini-classify`, its own openspec);
> tasks here assume it is landed or landing in parallel, and group 0 verifies the assumption.
> Re-read `searchOptions.ts`, `urlState.ts`, `SidePanel.tsx`, and `semantic.ts` against main
> before editing — parallel sessions work this repo, and `confidence-scores-on-tiles` and
> `score-floor-by-default` touched these same files days ago.

## 0. Upstream verification

- [ ] 0.1 Confirm the upstream `rank()` composes — `mini-classify/src/query.py`: with both
      `top` and `min_score` given, the returned order is floor-filtered then sliced to
      `top`; with neither, the index's own defaults apply. If it composes the other way
      (count first), stop and revise design D2 before any client work
- [ ] 0.1a **Confirm `QueryRequest.top` is nullable upstream, and test the floor-only case
      explicitly** — a request carrying `min_score` and **no** `top` must return the whole
      floor set, not the schema's default. This is the case that breaks: `top` is
      `int = Field(10, ge=1, le=1000)` today, this app omits `top` whenever it sends a floor,
      and composition without the schema change slices that set to ten rows (measured against
      the real `rank()` on the `fantasy character` shape: 875 → 10). It breaks the app **as
      currently deployed**, whose default is floor-only, so it is not a staging concern for
      this change — it is a blocking precondition on the index's. If `top` is still
      non-nullable when the branch lands, stop and fix upstream first
- [ ] 0.2 Confirm the index's cap layer sits above the composition (`api.py` truncates at
      `cap` after `rank()`). Note what this now implies rather than assuming the old
      behaviour: with the count clamped at the cap, `rank()` returns at most `top ≤ cap`
      rows, so `truncated` can no longer fire while a count is in force. Verify the bit still
      fires in the **floor-only** state (no `top` sent, floor set exceeding the cap) — that
      is the only state the wall notice now has, and design D8 records why

## 1. Shared types and server

- [ ] 1.1 `shared/types.ts` `SemanticTuning`: both `top?` and `minScore?` optional and both
      may be present; delete the "ignored when a floor is set" doc line; add
      `MAX_RESULT_COUNT = 500` with a comment naming what it matches (the index's
      `QueryRequest.cap` default) and why it is clamped client-side (design D5)
- [ ] 1.2 `server/src/semantic.ts` `query()`: forward `min_score` and `top` independently by
      presence; keep the `top: TOP` fallback only for a tuning carrying neither (no caller
      produces one — D7); delete the one-choice guard comment
- [ ] 1.3 Server tests: a tuning with both bounds sends both fields; either alone sends
      alone; the neither-case fallback still fires (grep `server/test` for the existing
      `query()` forwarding tests and extend them — do not assume coverage exists)

## 2. Client state

- [ ] 2.1 `searchOptions.ts`: `Tuning` makes `top` optional (`top?: number`,
      `minScore?: number`); `TUNING_DEFAULTS` carries both (`top: 60`, `minScore: 0.1`);
      `StoredTuning` drops the `minScore: null` sentinel — both fields optional, absent =
      not in force; the reader maps old encodings per design D4's table (the `null` and
      absent-`minScore` cases both arrive as absent and read as count-only when a `top` is
      present); the writer writes presence; clamp `top` to `MAX_RESULT_COUNT` on read
- [ ] 2.2 `urlState.ts`: parse by presence — `min` present = floor in force, `top` present
      = count in force, neither = both at defaults; delete the "explicit `undefined`
      floor-clearing" branch and the serialize-side "count named even at its default"
      special case (a count-only view names `top` because the bound is in force); clamp
      `top` on parse; serialize names each bound in force
- [ ] 2.3 Client tests for the state layer: URL round-trips for all three bound states
      (floor-only, count-only, both) including both-at-defaults serializing to no bound
      params; the D4 migration table's four rows read back as the design says; clamping at
      parse (a `top=5000` URL clamps to 500)

## 3. Side panel and notices

- [ ] 3.1 `SidePanel.tsx`: the Top/Floor segmented control becomes three states — count
      only / both / floor only (order chosen at implementation; the both state is the
      resting one and is what the control shows by default); in the both state both fields
      are enabled and either edit re-runs the query; in a single-bound state the other
      field is disabled but keeps its value (scenario: one bound can be sent away without
      the other); the count field clamps on entry per D5
- [ ] 3.2 The reset-link condition (the tuning-differs-from-defaults check that governs the
      panel's reset affordance) follows the new state shape: a view is at defaults when
      both bounds sit at their default values and no third state is in force
- [ ] 3.3 `App.tsx` cap notice: verify (do not change blindly) that `truncated` still reads
      as the index's cap under a both-request — the notice must not fire for a
      user-count-bounded set that came back complete (D8); adjust only if the wiring
      conflates the two
- [ ] 3.4 Component tests: the three-state control renders and switches; switching to
      floor-only preserves the count value; the both state re-runs on either field's edit;
      the reset affordance appears exactly when the state is off-default

## 4. Verification and archive

- [ ] 4.1 Contract test end to end: a both-request through ApiClient against the index
      returns floor-then-capped order (strongest first, none below the floor, at most the
      count) — this is the test that fails if upstream composes the other way (D2's risk)
- [ ] 4.2 Manual E2E via Playwright MCP: with the dev servers up, run a meaning search with
      both defaults (floored and capped), then floor-only (grows past 60 on a generic
      phrase, wall notice at 500), then both with count 60 — the D3 trade-off is visible
      and the URL round-trips each state through a reload
- [ ] 4.3 `bun run typecheck` and `bun run test` across workspaces
- [ ] 4.4 Archive with a dry run first — this change MODIFIES one requirement and
      REMOVED+ADDEDs another in `semantic-search`; no other active change touches that
      capability, but gate on the temp-copy dry run anyway (one fresh copy per change)
