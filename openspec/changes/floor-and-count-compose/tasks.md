> **Ordering — upstream first is cleanest, not required.** `mini-classify`'s `rank()` must
> compose floor-then-count for the both state to mean anything (design D2); until it does,
> a both-request degrades to floor-only, which is today's behaviour (D7). The upstream
> change has **landed** in that repo (`~/Documents/tests/mini-classify`, commit `add7fd4`,
> 2026-08-27) and group 0 below is checked off against it — verified in this session against the
> committed source and a live server on the library cache, not taken on report. If upstream
> moves before this change lands, re-run group 0 rather than trusting the ticks.
> Re-read `searchOptions.ts`, `urlState.ts`, `SidePanel.tsx`, and `semantic.ts` against main
> before editing — parallel sessions work this repo, and `confidence-scores-on-tiles` and
> `score-floor-by-default` touched these same files days ago.

## 0. Upstream verification

- [x] 0.1 Confirm the upstream `rank()` composes — `mini-classify/src/query.py`: with both
      `top` and `min_score` given, the returned order is floor-filtered then sliced to
      `top`; with neither, the index's own defaults apply. If it composes the other way
      (count first), stop and revise design D2 before any client work
- [x] 0.1a **Confirm the ten-row count default is gone from every place upstream carries it,
      not only from the HTTP schema** — a request or call carrying `min_score` and **no** count
      must return the whole floor set. Four carriers, each of which the composition branch
      turns into a silent ten-row cut:
      - `api.py`'s `QueryRequest.top` (`int = Field(10, ge=1, le=1000)`) — this app omits `top`
        whenever it sends a floor, so a floor-only request arrives with `req.top = 10`
        (875 → 10 on the `fantasy character` shape, now measured on both sides of `add7fd4`
        rather than derived from reading the schema — design's Context carries the table and
        conditions)
      - `query.py`'s `rank(sims, top=10, min_score=None)` — the *function's own* default, which
        no schema edit reaches
      - `test_categories.py`'s `show_query(sims_1d, names, top=10, min_score=None)` — the REPL,
        where querying actually happens in that repo; it calls `rank` with that default, so
        `:min 0.1` would go 875 → 10 by the same derivation, with no HTTP request involved
      - `docs/api/surface.md`'s `POST /query` row `top | int | 10 | ignored when min_score is
        set` — the jointly-owned contract, which must change in the same commit
      The upstream tests that encode the rule being repealed are `tests/test_query.py`'s
      `test_min_score_replaces_the_top_n_cut_with_a_floor` and
      `test_ranking_matches_the_pre_extraction_repl`, whose `repl_show_query` oracle
      reimplements the replace branch and must move with it. This breaks the app **as currently
      deployed**, whose default is floor-only, so it is a blocking precondition on the index's
      change, not a staging concern for this one. If any carrier still cuts to ten when the
      branch lands, stop and fix upstream first

      **Verified 2026-08-27 against `add7fd4`.** `QueryRequest.top` is `int | None =
      Field(None, ge=1, le=1000)`; `rank(sims, top=None, min_score=None)` composes
      floor-then-slice; `show_query` sends its ten away when a floor is in force (keeping it as
      a display default, so `:min` output is unchanged); `surface.md`'s row now reads `top | int
      | — | at most this many, of whatever min_score let through`. Measured through the HTTP
      path on `embed-cache512` (3380 models, `/run/media/masa/STLLibrary`, softmax, `fantasy
      character`, CPU): floor 0.1 with no count → 875 rows; the same floor with `top` 10 → 10
      rows. One contract change to know about even though this app never sends a bare query: a
      query with no bounds now returns up to `cap` (measured: 3380 rows with `cap` raised) where
      it used to return 10. `surface.md` states it
- [x] 0.2 Confirm the index's cap layer sits above the composition (`api.py` truncates at
      `cap` after `rank()`). Note what this now implies rather than assuming the old
      behaviour: with the count clamped at the cap, `rank()` returns at most `top ≤ cap`
      rows, so `truncated` can no longer fire while a count is in force. Verify the bit still
      fires in the **floor-only** state (no `top` sent, floor set exceeding the cap) — that
      is the only state the wall notice now has, and design D8 records why.
      **Verified**: `api.py` truncates at `cap` after `rank()` as before, and floor 0.1 with no
      count at the default cap returns 500 rows with `truncated: true` — the wall notice's one
      remaining state, still reachable
- [x] 0.3 Confirm the index reports `matched` — the number of models that cleared the floor
      *before* the count sliced them (design D9). It has to come from `rank()`: the count is
      taken after the floor filter and before the top slice, and nothing downstream can
      recover it. Verify it is present on a both-bounded response and that it equals the
      floor-only response's hit count for the same phrase and floor. If the index does not
      send it, the client says nothing rather than estimating (task 3.3a) — the change still
      lands, minus that clause.
      **Verified**: `Ranked.matched` is counted after the floor filter and before the `top` cut;
      the response carries it, and the unindexed early return carries `matched: 0` so the one
      shape that skips ranking needs no special case here. Measured: floor 0.1 with `top` 10
      reports `matched` 875 against 10 rows returned, equal to the floor-only row count for the
      same phrase and floor

## 1. Shared types and server

- [x] 1.1 `shared/types.ts` `SemanticTuning`: both `top?` and `minScore?` optional and both
      may be present; delete the "ignored when a floor is set" doc line; add
      `MAX_RESULT_COUNT = 500` with a comment naming what it matches (the index's
      `QueryRequest.cap` default) and why it is clamped client-side (design D5)
- [x] 1.1a `shared/types.ts` `SemanticSearchResult` and `server/src/semantic.ts`
      `QueryResult`: each gains an optional `matched?: number`, documented as the index's
      count of what cleared the floor before the count applied — optional on the wire for the
      same reason `scores` is (`confidence-scores-on-tiles` D1), so an older index or server
      leaves a newer client silent rather than failing. `app.ts`'s meaning route forwards it
      beside `capped`
- [x] 1.2 `server/src/semantic.ts` `query()`: forward `min_score` and `top` independently by
      presence; keep the `top: TOP` fallback only for a tuning carrying neither (no caller
      produces one — D7); delete the one-choice guard comment
- [x] 1.3 Server tests: a tuning with both bounds sends both fields; either alone sends
      alone; the neither-case fallback still fires (grep `server/test` for the existing
      `query()` forwarding tests and extend them — do not assume coverage exists).
      **Note on what these are worth**: the existing "a floor replaces the count" test asserted
      the rule being repealed and was rewritten. Of the four bound-forwarding tests, only
      "sends both bounds" falsifies against the old code — floor-alone and count-alone behave
      identically before and after, so they characterise rather than guard. Both `matched`
      tests falsify

## 2. Client state

- [x] 2.1 `searchOptions.ts`: `Tuning` makes `top` optional (`top?: number`,
      `minScore?: number`); `TUNING_DEFAULTS` carries both (`top: 60`, `minScore: 0.1`);
      `StoredTuning` drops the `minScore: null` sentinel — both fields optional, absent =
      not in force; the reader maps old encodings per design D4's table (the `null` and
      absent-`minScore` cases both arrive as absent and read as count-only when a `top` is
      present); the writer writes presence; clamp `top` to `MAX_RESULT_COUNT` on read
- [x] 2.2 `urlState.ts`: parse by presence — `min` present = floor in force, `top` present
      = count in force, neither = both at defaults; delete the "explicit `undefined`
      floor-clearing" branch and the serialize-side "count named even at its default"
      special case (a count-only view names `top` because the bound is in force); clamp
      `top` on parse; serialize names each bound in force — including a **third** special case
      the two above do not cover: the serializer skips `min` whenever the floor equals
      `TUNING_DEFAULTS.minScore`, so a floor-only search at the default 0.1 writes no bound
      param at all and reads back as both-at-defaults, silently failing the spec's "A record
      carries each bound it is under"
- [x] 2.3 Client tests for the state layer: URL round-trips for all three bound states
      (floor-only, count-only, both) including both-at-defaults serializing to no bound
      params; the D4 migration table's four rows read back as the design says; clamping at
      parse (a `top=5000` URL clamps to 500). Both-at-defaults is the one place the presence
      rule is written as *absence*, so assert the equivalence rather than assuming it: parse
      must read `min=0.1&top=60` and a bound-less URL identically. D4's "one rule, every
      substrate" holds only on that equivalence — say so where the round-trip asserts it

## 3. Side panel and notices

- [x] 3.1 `SidePanel.tsx`: the Top/Floor segmented control becomes three states — count
      only / both / floor only (order chosen at implementation; the both state is the
      resting one and is what the control shows by default); in the both state both fields
      are enabled and either edit re-runs the query; in a single-bound state the other
      field is disabled but keeps its value (scenario: one bound can be sent away without
      the other); the count field clamps on entry per D5
- [x] 3.2 The reset-link condition (the tuning-differs-from-defaults check that governs the
      panel's reset affordance) follows the new state shape: a view is at defaults when
      both bounds sit at their default values and no third state is in force.
      **Verified, unchanged.** The existing value comparison already says this: a bound out of
      force is `undefined`, which differs from its default, so floor-only and count-only both
      read as off-default without a special case. Left alone and pinned by a test instead
      (3.4), since "it happens to work" and "it is covered" are different claims
- [x] 3.3 `App.tsx` cap notice: verify (do not change blindly) that `truncated` still reads
      as the index's cap under a both-request — the notice must not fire for a
      user-count-bounded set that came back complete (D8); adjust only if the wiring
      conflates the two.
      **Verified, unchanged.** `capped: result.truncated === true` (`app.ts`) reads the index's
      bit and nothing else; nothing in the path consults the user's count, so a complete
      count-bounded set cannot set it. The wiring did not conflate them and was left alone
- [x] 3.3a `App.tsx` `resultsLabel`: add the `matched` clause beside the `capped` one and
      keep them distinct — `capped` attributes to the index's ceiling, `matched` to the user's
      count. It renders only when **both** bounds are in force, `matched` is present, and it
      exceeds the number of results shown; an absent `matched` renders nothing (never a
      client-side count of the tiles, which is the capped number by construction). Both halves
      of that gate were learned by getting them wrong: without the count the index's cap is
      what shortened the set, and without the floor `matched` is everything scored rather than
      a floor set at all
- [x] 3.4 Component tests: the three-state control renders and switches; switching to
      floor-only preserves the count value; the both state re-runs on either field's edit;
      the reset affordance appears exactly when the state is off-default; the `matched` clause
      renders under a both-bounded response that reports one, and is absent both when the
      response omits `matched` and when no count is in force

## 4. Verification and archive

- [x] 4.1 Contract test end to end: a both-request through ApiClient against the index
      returns floor-then-capped order (strongest first, none below the floor, at most the
      count) **and reports `matched` above the count**. The last clause is the whole test:
      the two composition orders return identical rows (D2's fuzz — 0 divergences in 20000),
      so an assertion over rows passes under either and reports a safety it does not have.
      `matched` is the only observable that separates them, being bounded by the count under
      the wrong order.
      **Done** as `server/test/indexContract.test.ts` — the one test here that talks to the
      real index, since a stub composes however the stub was written. It skips unless an index
      answers `/status` with `ready` (a test that passes when the thing it tests is absent is
      worse than none); point it elsewhere with `MODEL_BROWSER_INDEX_URL`. Both paths checked:
      green against the running index, skipped against a dead port
- [x] 4.2 Manual E2E: with the dev servers up, run a meaning search with
      both defaults (floored and capped), then floor-only (grows past 60 on a generic
      phrase, wall notice at 500), then both with count 60 — the D3 trade-off is visible
      and the URL round-trips each state through a reload.
      **Run 2026-08-27** against the live app and index (`embed-cache-test`, 1669 models,
      `fantasy character`; the Playwright profile was held by a parallel session, so this went
      through the Chrome extension instead). Everything measured, not eyeballed:
      - defaults → 60 tiles, both fields live, "Showing 60 of 755 above the floor", and **no
        bound params in the URL** — the resting state written as absence
      - floor-only → grid 60 → 500, the wall notice fires ("the index returned fewer than
        asked for — its cap"), `min=0.1` **is** named though it equals its own default, the
        count field greys out still holding 60, and the sole in-force bound is filled rather
        than dimmed (the reported highlighting bug, confirmed fixed in the running app)
      - back to both → the count returns to the held 60 and the bound params leave the URL
      - both at count 25 → "Showing 25 of 755", and a reload restores 25/0.1 with both bounds
        in force
      Two defects found, one fixed here and one **not**:
      - **Fixed**: the `matched` clause spoke in the floor-only state, where the set is short
        because the *cap* bit — so the label said "the index returned fewer than asked for"
        and "Showing 500 of 755" together, reporting one cut twice and crediting it to a bound
        nobody set. `labelInputs` now carries whether a count is in force and the clause is
        gated on it, per the requirement's own wording ("where a count caps a floor-bounded
        set"). Pinned by a test that fails without the gate
      - **Fixed**: a *typed* tuning value never reached the URL — only a clicked toggle did.
        Typing 25 into the count re-ran the query and relabelled the grid while the URL kept
        saying nothing; typing 0.4 into the floor left `min=0.1`. `setTuning`'s deferred path
        dispatches `run: false` to record the keystroke, and the projection effect assigned
        `projectedRef.current` before checking for an intent, so the debounced
        `commit({run: true})` read as "not advanced" and declined to write. An intentless pass
        now absorbs only a view the address bar already agrees with — which still covers what
        that ref exists for (a Back that patched the view, a URL rewritten underneath it) while
        refusing to absorb a view this app recorded and deliberately did not project
      - **Fixed, and the one this change should have caught in its own sweep**: `sameQuestion`
        exempted the count wherever a floor was set — "the index ignores `top` beneath a
        floor" — which was true under the replace rule and false under composition. A Back
        across a count change therefore took `restore`'s patch branch: the field updated, no
        re-ask went out, and the grid kept the previous count's results under a URL naming the
        new one. Both bounds are compared unconditionally now. The sweep missed it because it
        searched for the phrases this change had *written* ("one choice", "ignored when a floor
        is set") rather than for the rule; that predicate states the same rule in its own
        words, in a file the sweep did read
- [x] 4.3 `bun run typecheck` and `bun run test` across workspaces — green: 178 server, 483
      client. Every new regression test was falsified against the pre-change code first; three
      of the added forwarding assertions characterise behaviour that did not change and are
      marked as such in 1.3 rather than counted as regressions
- [ ] 4.4 Archive with a dry run first — this change MODIFIES one requirement and
      REMOVED+ADDEDs another in `semantic-search`; no other active change touches that
      capability, but gate on the temp-copy dry run anyway (one fresh copy per change). A dry
      run passes as of 2026-08-27 (`+1 ~1 -1`), and the post-archive main spec carries no
      surviving statement of the replace rule — the only residue is the retitle-blocked
      scenario heading the delta's comment explains. Re-run at archive time regardless: main
      moves
