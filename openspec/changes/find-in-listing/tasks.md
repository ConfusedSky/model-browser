# Tasks — find-in-listing

> **Ordering: hard dependency on `search-matches-folder-names`**, which modifies this same
> requirement — this delta is written against the text that change leaves behind. Pairs
> with `search-options` (the panel) and `semantic-search` (which stops needing its D9 once
> this lands) but depends on neither. Re-read `App.tsx` against main before starting —
> parallel sessions.

## 1. Separate the two jobs

- [ ] 1.1 The search input stops writing `filter`: `onChange` (`App.tsx:177`) sets query
      text only, and `submitSearch` (`:186`) commits that text rather than `filter.trim()`
- [ ] 1.2 Remove the URL seedings of `filter` — `useState(boot.q ?? '')` (`:58`) and
      `setFilter(v.q ?? '')` on popstate (`:263`). They exist only because the two shared a
      box; the query now seeds the query input and the filter starts empty (D4)
- [ ] 1.3 Keep `filteredListing` (`:325`) and the hides-everything message (`:537`) exactly
      as they are — this change moves where text is typed, not what filtering does

## 2. The find control

- [ ] 2.1 A find control that mounts on demand over the listing, with its own input,
      focused on open, dismissed on `Escape` and by clearing
- [ ] 2.2 `Ctrl-F` / `Cmd-F` opens it, with `preventDefault` (D2). The handler must not
      fire while focus is in another text input — search bar, path bar, chat box — nor
      while the lightbox or orbit overlay owns the keyboard
- [ ] 2.3 A visible control with the results opens the same box (D3)
- [ ] 2.4 Dismissing clears the filter, so a dismissed control never leaves the grid
      silently narrowed

## 3. Tests

- [ ] 3.1 Component tests: the shortcut opens and `Escape` closes; typing narrows; the
      search input no longer narrows; navigating clears; the hides-everything message still
      appears; dismissing restores the full grid
- [ ] 3.2 The shortcut does not fire while focus is in the search input, the path bar, or
      the chat box
- [ ] 3.3 A committed search's text survives in the search input across filtering, so
      editing and re-submitting needs no retyping — the behavior this change exists for
- [ ] 3.4 Deep-link and history-restore tests still pass with the seedings removed: a
      restored search view shows its query in the search input and an empty filter

## 4. Verification

- [ ] 4.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 4.2 Manual E2E via Playwright MCP: `Ctrl-F` over a large listing narrows it; the
      browser's own find does not open; `Escape` restores; a committed search's text is
      still in the bar afterwards
