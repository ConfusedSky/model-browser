# Tasks — semantic-search

> **Ordering.** No longer blocked on the index: it is implemented and verified against this
> change's assumptions (2026-08-19) — `src/api.py` serves `/status`, `/query`, `/similar`,
> `/reload`; `/status` carries `ready` from process start plus `elapsed`; the scope block is
> `{path, status, n_indexed, n_scanned, covers}`; hits carry `rel_path`; `pose` carries
> `azimuth_zero` as `rotation_to_z_up(up).T @ [1,0,0]`. Start the server before working
> section 1 rather than stubbing it. **Hard dependencies, all UI-side:**
> `search-matches-folder-names` (this change MODIFIES the same `file-search` requirement),
> `search-options` (the mode is one of its options and lives in the panel tab it builds),
> and `find-in-listing` (which separates filtering from the search input — without it the
> committed phrase filters its own results away). **Composes with `listing-tree-cache`
> without depending on it** (D3): the snapshot is an opportunistic shortcut, the bounded
> `stat` is the contract. Re-read `App.tsx`, `urlState.ts`, `listing.ts`, `ChatPanel.tsx`,
> and `api/client.ts` against main before starting — parallel sessions.

## 1. Server: reaching the index

- [x] 1.1 An index-client module in `server/src`: base URL from an env setting defaulting to
      `http://127.0.0.1:8077` (the setting cleared = feature off), `fetch` with
      `AbortSignal.timeout`, no Bun-only APIs — the Hono app
      must still run on Node unchanged (architecture D1). Note `envLimit` (`listing.ts:265`)
      is an unexported numeric parser and `app.ts` has no config plumbing at all, so this
      is a new helper in its spirit, not a reuse of it
- [x] 1.2 Availability state: probe `/status` at startup, on failure, on explicit retry,
      and on a bounded backoff while the index reports itself warming; never per query
      (D4). Model **four** states, each read from the wire rather than guessed: absent
      (connection refused — the only one `/status` cannot report), warming (`ready: false`,
      or a 503 from a query racing the probe; ~16 s for SigLIP), volume-gone
      (`status.volume.present === false` — the likeliest failure on removable media and the
      one the user repairs in a second), ready. Hold `collection_root` from the ready
      answer. The backoff is what makes an index that was loading at startup become
      available without the user intervening
- [x] 1.3 Use elapsed-since-start from `/status` to stop re-probing a load that has plainly
      gone wrong, and to distinguish *warming* from *wedged* in what the UI says. Treat it
      as elapsed only — the index does not estimate remaining time and this app SHALL NOT
      present one
- [x] 1.4 Root comparison by **resolved** path, not string prefix (D4): a remount at a
      different mount point is the same tree. Unit test with a symlinked fixture root
- [x] 1.5 Reject archive-relative paths before they leave this server (D7): a scope
      containing `!/` is never sent

## 2. Server: the query route

- [x] 2.1 `/api/semantic` (or the shape settled at apply) taking phrase + scope path,
      returning tiles plus the index's own scope/weak/truncated reporting. Not folded into
      `/api/dir`: it consults a different corpus and its failure modes are its own
- [x] 2.2 Send this app's own `top` (60, tunable — D8), never the index's default of 10,
      and do not treat the index's `truncated` as meaningful: it reports `cap` biting under
      `min_score`, which is not the mode used here. The client is told "strongest matches",
      not "truncated"
- [x] 2.3 Pass the scope block's `covers` through to the client rather than deriving the
      corpus locally (D3) — the classifier gaining `.3mf` must not require a change here
- [x] 2.4 The hit→tile join (D3): resolve each hit by `rel_path` against this server's
      listing data, with a bounded `stat` fallback — at most one per returned hit, never a
      walk. Assert the bound in a test, since this is the whole reason the two caches can
      disagree safely
- [x] 2.5 Unresolvable hits are omitted, the search still succeeds. Test with a hit whose
      path does not exist
- [x] 2.6 Counts pass through with their real attribution (D3): `n_indexed` is an index
      claim, `n_scanned` is the last run's walk minus what had vanished at load and can
      shift across a reload. Never combine either with this app's own count into a ratio
- [x] 2.7 Index unavailable / timing out / erroring → a distinct, non-fatal response the
      client can render as "the index is not there", not a 500. A 503 from a query racing
      the probe during warmup folds back into the warming state and is not a failure

## 3. Client: the action and its results

- [x] 3.1 `ApiClient` gains the semantic calls — availability and query. No raw `fetch` in
      components (architecture D1); the in-memory fake used by the component tests gains
      the same methods
- [x] 3.2 A search-mode option added to `search-options`' set — same persistence, same URL
      carriage, same re-issue-on-change behavior (D2). Meaning mode is selectable only when
      the index is ready and the browsed path is in range; otherwise absent rather than
      disabled
- [x] 3.3 Changing the mode with a query committed re-runs that query in the new mode
      through the existing re-issue path. Test the flip explicitly: a name search returning
      nothing, flipped, returns index results for the same text without retyping
- [x] 3.4 Results replace the grid through the existing listing commit path, inheriting
      the skeleton, latest-wins supersession, and history behavior. **Do not sort** — the
      client sorts nothing today and relevance order depends on that staying true
- [x] 3.5 Verify `find-in-listing` has landed before this ships: with filtering still on
      the search input, committing a meaning phrase hides its own results behind that
      phrase. One regression test here regardless — commit a phrase matching no result's
      name, assert every result is visible — since this is the failure mode most likely to
      return
- [x] 3.6 Options that do not apply in meaning mode (folder matching, and the kind option
      insofar as the index returns only models) are hidden rather than shown inert (D2)
- [x] 3.7 A stored or URL-carried meaning mode arriving where the index is unavailable
      falls back to name search and says so — never a silent substitution (D2). Test both
      entries: a fresh boot with the preference stored, and a shared URL
- [x] 3.8 The client re-checks availability so a warming index becomes usable without a
      reload (spec: "without the user reloading"). Cheapest shape consistent with D1: the
      client re-reads availability on the interactions it already makes — mount, landed
      listing, navigation — rather than a timer of its own; the server's backoff (1.2) is
      what makes those re-reads cheap
- [x] 3.9 Results label identifies which search produced the grid, readable with the panel
      collapsed, and a failed search leaves the previous label alone (the shipped
      `file-search` rule)
- [x] 3.10 The panel's search tab mirrors the meaning search too: mode in force, phrase,
      index status (ready/warming/absent), and what the corpus covers — the read-back
      `search-options` builds, extended rather than duplicated
- [x] 3.11 Weak **sets** rendered marked rather than suppressed. No per-result score or z on
      the tile — order carries strength (D10). This removes the change's only new tile
      decoration: no `DirEntry` widening and no parallel score map through the grid

## 4. Client: empty states and coverage

- [x] 4.1 The three outcomes as distinct messages: matched nothing / nothing indexed here /
      partly indexed, plus the corpus note where the location's models are archive-resident
      or in a format the index does not process
- [x] 4.2 Take the corpus from the scope block's `covers`, combined with what this app
      knows locally about archives. Deriving the format list here instead would hardcode an
      upstream fact that drifts (D3)

## 5. URL  *(after `search-options`)*

- [x] 5.1 Land both spec MODIFYs with the code — `url-navigation` (its parameter list is
      closed) and `file-search` (submit runs the mode in force). Both deltas are written
      against post-`search-matches-folder-names`/`search-options` text; re-check them
      against main before applying, since those changes own the same requirements
- [x] 5.2 `UrlView` carries the mode alongside `q`, omitted at its default so a name search
      URL stays byte-identical to today's
- [x] 5.3 Committing and clearing a search each push exactly one history entry, restored through the same
      request path as any other committed view (`url-navigation`'s history requirement
      covers "a committed or cleared search"; a meaning search is one)
- [x] 5.4 Opening a meaning URL with the index unavailable renders the location's ordinary
      listing and explains why, rather than an empty grid or an error page

## 6. Pose

- [x] 6.1 Map the index's up axis to `OrbitAxis` by **exact lookup over the six unit axis
      vectors** — explicitly not a nearest-axis snap (D5). Unit test all six, and test that
      a vector a few degrees off axis is rejected as an index fault rather than rounded;
      that rejection is the point of the task, not an edge case of it
- [x] 6.2 Apply front angles as az/el under that spindle **plus an azimuth offset derived
      from the pose's `azimuth_zero`** — `atan2(u₀·a, u₀·b)` against `frameFor(axis)` (D5).
      Do not hard-code the six constants: derived means a change to the index's rotation
      arrives as a value we already read. Passing `azimuth_deg` through unmodified is a
      quarter turn out for three of the six axes — 1,520 of the 2,945 models in the primary
      cache, 52%, including `y`, the library's most common up axis; degrees→radians alone
      is the bug, not the conversion. The viewer keeps `distR` and `target`
- [x] 6.3 Test the derivation over all six axes against a known camera direction via
      `statePosition` — not a round-trip, which passes under any consistent wrong offset.
      Assert it lands on 0/0/0/+90/+90/−90 for `z`/`-y`/`-x`/`y`/`-z`/`x` as an
      *expectation* of the current index behavior, distinct from the derivation being the
      contract. A `y`-up model is the mandatory case: the *most* common axis in the
      collection (1,118 of 2,945) and one the shortcut gets wrong
- [x] 6.4 Validate `azimuth_zero ⟂ up` and treat a violation as an index fault alongside a
      non-enumerated `up` (D5) — not a projection onto the plane, which would hide it
- [x] 6.5 Handle `front: null` — the index prescribes falling back to azimuth 0 at the
      first elevation (view 0), which is an orientation, not an absence of one. Keep the up
      axis and drop only the front angles
- [x] 6.6 A stored axis wins over the index's; applying a pose runs no persist path and
      queues no thumbnail render. Test that the sidecar is untouched after opening and
      closing a posed model without orbiting (this is the regression that would silently
      re-render tiles at angles nobody chose)

## 7. Verification

- [x] 7.0 **Before archiving**, diff this delta's scenario titles against current
      `openspec/specs/file-search/spec.md`: a MODIFIED requirement replaces scenarios, and
      main moved under this delta once already (`search-matches-folder-names` repurposed
      "Matching is on the file name" during its own archive, after this was written)

- [x] 7.1 `bun run typecheck` and `bun run test` pass across workspaces
- [x] 7.2 Server tests with the index stubbed: ready, loading, absent, timeout, and a
      response holding stale hits — each producing its own client-visible state
- [x] 7.3 Component tests: the action appears and disappears with availability and path;
      results replace the grid in relevance order; the filter narrows them; each empty
      state reads correctly; a failed search does not relabel the grid
- [x] 7.4 Manual E2E via Playwright MCP against the real library and a running index: a
      subject phrase returns models whose names never mention it; the same phrase inside a
      kit is scoped to that kit; stopping the index mid-session removes the affordance
      without disturbing browsing or name search
- [x] 7.5 Confirm no thumbnail pixel path was touched — no `RIG_VERSION` bump is part of
      this change, and if one becomes necessary the pose work has strayed into rendering
