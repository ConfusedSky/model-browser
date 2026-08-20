# Tasks — find-in-listing

> **Ordering: hard dependency on `search-matches-folder-names`**, which modifies both
> requirements this change touches — these deltas are written against the text that change
> leaves behind. This change depends on nothing else; `semantic-search` depends on **it**
> and must re-base its own *Deep name search* MODIFY onto the text this one leaves. Pairs
> with `search-options` (the panel) without depending on it. Re-read `App.tsx` against main
> before starting — parallel sessions.
>
> Note this change MODIFIES *Deep name search* as well as *Live name filter*, for one
> clause: it opens "distinct from typing, which only filters", which this change makes
> false. Leaving it to `semantic-search`'s later MODIFY would ship a self-contradicting
> spec in between.

## 1. Separate the two jobs

- [x] 1.1 The search input stops writing `filter`: `onChange` (`App.tsx:177`) sets query
      text only, and `submitSearch` (`:186`) commits that text rather than `filter.trim()`
- [x] 1.2 Remove the URL seedings of `filter` — `useState(boot.q ?? '')` (`:58`) and
      `setFilter(v.q ?? '')` on popstate (`:263`). They exist only because the two shared a
      box; the query now seeds the query input and the filter starts empty (D4)
- [x] 1.3 Keep `filteredListing` (`:325`) and the hides-everything message (`:537`) exactly
      as they are — this change moves where text is typed, not what filtering does
- [x] 1.4 **Preserve clear-to-restore.** `handleFilterChange` (`:177-183`) is being rewritten
      by 1.1, and it is also where emptying the input while a query is committed restores the
      ordinary listing (`setQuery(null)` + refetch, `:180-183`). That rule belongs to *Deep
      name search* and survives this change — it just moves to the query input, which is now
      the only thing that box holds. A test asserting it still fires, since nothing else
      covers a behavior whose implementation this change deletes and rebuilds

## 2. The find control

- [x] 2.1 A find control that mounts on demand over the listing, with its own input,
      focused on open, dismissed on `Escape` — from anywhere while it is open, not only
      from inside its own field, since the user may have clicked a tile since opening it.
      Clearing the text clears the *filter* and leaves the control up; this task read as
      though clearing dismissed it, which the spec never required and the code never did
- [x] 2.2 `Ctrl-F` / `Cmd-F` opens it, with `preventDefault` (D2). The handler must not
      fire while focus is in another text input — search bar, path bar, chat box — nor
      while the lightbox or orbit overlay owns the keyboard. **Both halves**: the first
      shipped and the second did not, and a find control opening behind the focus-trapped
      lightbox pulls focus out of the trap into a box the user cannot see. The listener
      subscribes once, so the viewer state reaches it through a ref
- [x] 2.5 The control survives a listing it outlives: it stays mounted across the
      skeleton, showing no count while one is in flight (the count would describe the
      listing being replaced). Unmounting it there shifted the grid and re-stole focus
      when the new listing landed
- [x] 2.3 A visible control with the results opens the same box (D3)
- [x] 2.4 Dismissing clears the filter, so a dismissed control never leaves the grid
      silently narrowed

## 3. Tests

- [x] 3.1 Component tests: the shortcut opens and `Escape` closes; typing narrows; the
      search input no longer narrows; navigating clears; the hides-everything message still
      appears; dismissing restores the full grid
- [x] 3.2 The shortcut does not fire while focus is in the search input, the path bar, or
      the chat box
- [x] 3.3 A committed search's text survives in the search input across filtering, so
      editing and re-submitting needs no retyping — the behavior this change exists for
- [x] 3.4 Deep-link and history-restore tests still pass with the seedings removed: a
      restored search view shows its query in the search input and an empty filter

## 4. Verification

- [ ] 4.0 **Before archiving**, diff this delta's scenario titles against current
      `openspec/specs/file-search/spec.md`: a MODIFIED requirement replaces scenarios, and
      main moved under this delta once already (`search-matches-folder-names` repurposed
      "Matching is on the file name" during its own archive, after this was written)

- [x] 4.1 `bun run typecheck` and `bun run test` pass across workspaces
- [x] 4.2 Manual E2E via Playwright MCP: `Ctrl-F` over a large listing narrows it; the
      browser's own find does not open; `Escape` restores; a committed search's text is
      still in the bar afterwards
