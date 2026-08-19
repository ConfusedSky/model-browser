# Tasks — semantic-search

> **Ordering.** Blocked on the index side: `mini-classify`'s `docs/api/surface.md` is a
> proposal and nothing behind it is implemented. Nothing below 1.x can be verified until
> `/status` and `/query` answer. **Hard dependency on `search-options`** for 5.x only — it
> reshapes `UrlView`/`serializeView`, and adding a second search kind to a moving
> serializer is a merge conflict for no reason. **Composes with `listing-tree-cache`
> without depending on it** (D3): the snapshot is the join's fast path, the bounded `stat`
> fallback is the contract. Re-read `App.tsx`, `urlState.ts`, `listing.ts`, and
> `api/client.ts` against main before starting — parallel sessions.

## 1. Server: reaching the index

- [ ] 1.1 An index-client module in `server/src`: base URL from an env setting (absent =
      feature off), `fetch` with `AbortSignal.timeout`, no Bun-only APIs — the Hono app
      must still run on Node unchanged (architecture D1). Note `envLimit` (`listing.ts:265`)
      is an unexported numeric parser and `app.ts` has no config plumbing at all, so this
      is a new helper in its spirit, not a reuse of it
- [ ] 1.2 Availability state: probe `/status` at startup, on failure, on explicit retry,
      and on a bounded backoff while the index reports itself warming; never per query
      (D4). Model three states — ready, warming, absent — from the required `ready` flag,
      and hold `collection_root` from the ready answer. The backoff is what makes an index
      that was loading at startup become available without the user intervening
- [ ] 1.3 Use elapsed-since-start from `/status` to stop re-probing a load that has plainly
      gone wrong, and to distinguish *warming* from *wedged* in what the UI says. Treat it
      as elapsed only — the index does not estimate remaining time and this app SHALL NOT
      present one
- [ ] 1.4 Root comparison by **resolved** path, not string prefix (D4): a remount at a
      different mount point is the same tree. Unit test with a symlinked fixture root
- [ ] 1.5 Reject archive-relative paths before they leave this server (D7): a scope
      containing `!/` is never sent

## 2. Server: the query route

- [ ] 2.1 `/api/semantic` (or the shape settled at apply) taking phrase + scope path,
      returning tiles plus the index's own scope/weak/truncated reporting. Not folded into
      `/api/dir`: it consults a different corpus and its failure modes are its own
- [ ] 2.2 Send this app's own `top` (60, tunable — D8), never the index's default of 10,
      and do not treat the index's `truncated` as meaningful: it reports `cap` biting under
      `min_score`, which is not the mode used here. The client is told "strongest matches",
      not "truncated"
- [ ] 2.3 Pass the scope block's `covers` through to the client rather than deriving the
      corpus locally (D3) — the classifier gaining `.3mf` must not require a change here
- [ ] 2.4 The hit→tile join (D3): resolve each hit by `rel_path` against this server's
      listing data, with a bounded `stat` fallback — at most one per returned hit, never a
      walk. Assert the bound in a test, since this is the whole reason the two caches can
      disagree safely
- [ ] 2.5 Unresolvable hits are omitted, the search still succeeds. Test with a hit whose
      path does not exist
- [ ] 2.6 Counts pass through with their real attribution (D3): `n_indexed` is an index
      claim, `n_scanned` is the last run's walk minus what had vanished at load and can
      shift across a reload. Never combine either with this app's own count into a ratio
- [ ] 2.7 Index unavailable / timing out / erroring → a distinct, non-fatal response the
      client can render as "the index is not there", not a 500. A 503 from a query racing
      the probe during warmup folds back into the warming state and is not a failure

## 3. Client: the action and its results

- [ ] 3.1 `ApiClient` gains the semantic calls — availability and query. No raw `fetch` in
      components (architecture D1); the in-memory fake used by the component tests gains
      the same methods
- [ ] 3.2 A meaning-search control beside the input, distinct from submit (D2), shown only
      when the index is ready and the browsed path is in range. Absent otherwise — no
      disabled control explaining a service the user may not have
- [ ] 3.3 Results replace the grid through the existing listing commit path, inheriting
      the skeleton, latest-wins supersession, and history behavior. **Do not sort** — the
      client sorts nothing today and relevance order depends on that staying true
- [ ] 3.4 **Committing a meaning search clears the filter input** (D9). `submitSearch`
      (`App.tsx:186`) leaves the phrase in `filter` and `filteredListing` (`:325`) applies
      it to whatever is on screen — for a meaning search that hides the results by
      definition and renders "The filter is hiding everything below." (`:537`). Regression
      test: commit a phrase matching no result's name, assert every result is visible
- [ ] 3.5 The same rule on the two non-commit entries: boot (`App.tsx:58`, `useState(boot.q
      ?? '')`) and history restoration (`:263`, `setFilter(v.q ?? '')`) seed the input from
      the URL, which is correct for `q` and wrong for a meaning phrase. Tests for both — a
      deep link into meaning results whose phrase matches no result's name, and Back into a
      meaning view — each asserting every result visible and the input empty
- [ ] 3.6 An explicit dismiss on the results label restores the ordinary listing, since
      erase-to-exit (`App.tsx:180`) no longer applies to an input that is already empty.
      Programmatic clearing must not route through the filter-change handler, or it would
      trip that exit path at commit time
- [ ] 3.7 The filter still narrows meaning results once the user types — available, just
      not pre-populated
- [ ] 3.8 The client re-checks availability so a warming index becomes usable without a
      reload (spec: "without the user reloading"). Cheapest shape consistent with D1: the
      client re-reads availability on the interactions it already makes — mount, landed
      listing, navigation — rather than a timer of its own; the server's backoff (1.2) is
      what makes those re-reads cheap
- [ ] 3.9 Results label identifies them as meaning matches for the phrase, and a failed
      search leaves the previous label alone (the shipped `file-search` rule)
- [ ] 3.10 Weak sets rendered marked rather than suppressed; per-result strength surfaced
      (tooltip or tile affordance — settle at apply, it is the one new tile decoration)

## 4. Client: empty states and coverage

- [ ] 4.1 The three outcomes as distinct messages: matched nothing / nothing indexed here /
      partly indexed, plus the corpus note where the location's models are archive-resident
      or in a format the index does not process
- [ ] 4.2 Take the corpus from the scope block's `covers`, combined with what this app
      knows locally about archives. Deriving the format list here instead would hardcode an
      upstream fact that drifts (D3)

## 5. URL  *(after `search-options`)*

- [ ] 5.1 Land the `url-navigation` MODIFY together with the code: that requirement
      enumerates its parameters as a closed list, so the shipped spec is false the moment a
      meaning parameter exists without it. The delta is written against the
      post-`search-options` text — re-check it against main before applying, since that
      change owns the same requirement
- [ ] 5.2 `UrlView` carries the meaning phrase distinguishably from `q`; a name search URL
      stays byte-identical to today's
- [ ] 5.3 Commit and dismiss each push exactly one history entry, restored through the same
      request path as any other committed view (`url-navigation`'s history requirement
      covers "a committed or cleared search"; a meaning search is one)
- [ ] 5.4 Opening a meaning URL with the index unavailable renders the location's ordinary
      listing and explains why, rather than an empty grid or an error page

## 6. Pose

- [ ] 6.1 Map the index's up axis to `OrbitAxis` by **exact lookup over the six unit axis
      vectors** — explicitly not a nearest-axis snap (D5). Unit test all six, and test that
      a vector a few degrees off axis is rejected as an index fault rather than rounded;
      that rejection is the point of the task, not an edge case of it
- [ ] 6.2 Apply front angles as az/el under that spindle **plus an azimuth offset derived
      from the pose's `azimuth_zero`** — `atan2(u₀·a, u₀·b)` against `frameFor(axis)` (D5).
      Do not hard-code the six constants: derived means a change to the index's rotation
      arrives as a value we already read. Passing `azimuth_deg` through unmodified is
      correct for 114 of the 133 models in the live cache and a quarter turn out for the
      other 19; degrees→radians alone is the bug, not the conversion. The viewer keeps
      `distR` and `target`
- [ ] 6.3 Test the derivation over all six axes against a known camera direction via
      `statePosition` — not a round-trip, which passes under any consistent wrong offset.
      Assert it lands on 0/0/0/+90/+90/−90 for `z`/`-y`/`-x`/`y`/`-z`/`x` as an
      *expectation* of the current index behavior, distinct from the derivation being the
      contract. A `y`-up model is the mandatory case: second most common axis in the
      collection, and one the shortcut gets wrong
- [ ] 6.4 Validate `azimuth_zero ⟂ up` and treat a violation as an index fault alongside a
      non-enumerated `up` (D5) — not a projection onto the plane, which would hide it
- [ ] 6.5 Handle `front: null` — the index prescribes falling back to azimuth 0 at the
      first elevation (view 0), which is an orientation, not an absence of one. Keep the up
      axis and drop only the front angles
- [ ] 6.6 A stored axis wins over the index's; applying a pose runs no persist path and
      queues no thumbnail render. Test that the sidecar is untouched after opening and
      closing a posed model without orbiting (this is the regression that would silently
      re-render tiles at angles nobody chose)

## 7. Verification

- [ ] 7.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 7.2 Server tests with the index stubbed: ready, loading, absent, timeout, and a
      response holding stale hits — each producing its own client-visible state
- [ ] 7.3 Component tests: the action appears and disappears with availability and path;
      results replace the grid in relevance order; the filter narrows them; each empty
      state reads correctly; a failed search does not relabel the grid
- [ ] 7.4 Manual E2E via Playwright MCP against the real library and a running index: a
      subject phrase returns models whose names never mention it; the same phrase inside a
      kit is scoped to that kit; stopping the index mid-session removes the affordance
      without disturbing browsing or name search
- [ ] 7.5 Confirm no thumbnail pixel path was touched — no `RIG_VERSION` bump is part of
      this change, and if one becomes necessary the pose work has strayed into rendering
