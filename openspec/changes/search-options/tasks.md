# Tasks — search-options

> Ordering: **hard dependency on `search-matches-folder-names`** — this gates the predicate that change introduces, and is meaningless before it. Composes with `listing-tree-cache` **without entering its key**: that cache holds the gathered tree, and this option filters over it just as `q` does. Keying on it would duplicate the tree per setting and force a cold walk on every toggle. Re-read `App.tsx`, `urlState.ts`, and `listing.ts` against main before starting (parallel sessions).

## 1. Preference storage

- [ ] 1.1 A search-options module following `lighting.ts` / `aoToggle.ts` exactly: module-level IIFE reading `localStorage` in a `try`, getter, setter writing back in a `try`, `model-browser:` key namespace. Defaults — folder matching on, kinds both
- [ ] 1.2 Unit tests covering the **read** path as well as the write: a stored value is honored at module init, an absent key defaults, and a malformed value defaults rather than throwing (the AO toggle's read path went untested once; do not repeat it)

## 2. URL

- [ ] 2.1 `UrlView` gains both options; `serializeView` omits them at their defaults so an ordinary search URL is byte-identical to today's and no history entry appears from making defaults explicit (D4)
- [ ] 2.2 `URLSearchParams` stays the only encoder — no `encodeURIComponent` pass on top (pinned by the existing round-trip test)
- [ ] 2.3 Boot precedence: URL options govern the session's searches and are **not** written to storage; only a control writes (D2). Test that opening a link with non-default options leaves stored preferences untouched, and that a later fresh search uses the stored ones

## 3. Server

- [ ] 3.1 The folder-matching option reaches `listFlat` as an additive `/api/dir` parameter gating the relative-path predicate from `search-matches-folder-names`; absent means the default (on). Server tests for both settings against the same fixture
- [ ] 3.2 Apply the option as a **filter over the gathered tree**, never as a walk parameter — `matchesQuery` and its callers stay outside `walkFsLevel`/`walkZip`, so the walk's output still depends on the root alone. Assert it: the same fixture walked with the option on and off collects the same set and differs only after filtering. This is what keeps `listing-tree-cache` able to key on root alone and `search-cancellation` able to share one traversal across requests

## 4. Client behavior

- [ ] 4.1 Kind option applied client-side over `kind`, like the existing filter — instant, no request (D3)
- [ ] 4.2 With a query committed, changing the matching option re-issues the search through the existing `fetchListing` path (the `toggleFlat` precedent: re-request, land, commit), inheriting latest-wins, the skeleton, and the history entry
- [ ] 4.3 Truncation notice and empty states keep describing the view actually in force — the notice describes the underlying listing, not the kind-filtered subset (D3)
- [ ] 4.4 A search tab on the existing side panel (D5): `ChatPanel.tsx` becomes a tab host — chat and search — keeping its persisted collapse state and making no network calls of its own. Tab selection persists like collapse does; neither belongs in the URL
- [ ] 4.5 The controls live in that tab, each reading as on/off at a glance
- [ ] 4.6 The tab mirrors the committed search: the query in force and the options under which it ran. The search input and the results label stay in the bar and over the grid respectively — the panel reads the search back, it does not own it
- [ ] 4.7 Non-default options in force are visible without opening the panel (a badge on the tab or equivalent), so "why are my results strange" is answerable from the grid

## 5. Tests

- [ ] 5.1 Component tests on the shared harness: options persist across searches; changing the matching option with a query committed re-issues and pushes one history entry; changing the kind option re-presents without a request; a URL with non-default options reproduces those results and leaves storage alone; navigating away and searching fresh uses stored options; both empty states and the truncation notice read correctly under a kind restriction

## 6. Verification

- [ ] 6.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 6.2 Manual E2E via Playwright MCP on the real library: a set-name search with folder matching on returns the set; the same search with it off returns nothing (or only true file-name matches) and says so honestly; restricting to folders returns the folder tiles alone; a copied URL reproduces the sender's results in a fresh profile without changing that profile's stored options
