# Search Matches Folder Names

## Why

Deep search matches a model's file name and nothing else, so searching a folder fragment returns "No models matched" while that folder sits in plain view — found in use, and the failure is silent: the miss message is the same one a genuine miss produces. A 3D-print library is organized by artist and set (`Loot Studios/Sandy Dunes/…`) and the files inside are `body.stl`, `base.stl`, `supports.stl` — names that carry no identity at all. The current rule is weakest exactly where the user knows least: they remember the set, never the part.

Three things make it read as arbitrary rather than deliberate:

- The root's **immediate** containers already match the query and come back as tiles (`listing.ts:328`), but a folder one level deeper matches nothing — the same name, a different answer, decided by depth.
- The live **filter** matches folder fragments today, because it matches the entry's full name, which in flat and deep views is the relative path. Same input box: typing narrows on `Sandy`, pressing Enter throws those matches away. The archived spec calls this "a deliberate asymmetry", but nothing in the affordance signals that Enter changed the matching rule.
- The rationale never argued for it. The archived design's D1 says only that models are filtered on their base name, "the same basename the sort comparator uses" — the predicate was borrowed from the sort, and the spec scenario was written afterward to describe what the code did.

## What Changes

- **The deep-search predicate moves from base name to root-relative path**: a model matches when the query appears anywhere in its path under the search root — its own file name, any containing folder, or a zip's interior directories. This collapses the filter/search asymmetry: both now match the same string.
- **Matching folders become tiles at any depth, not just the root's children**: the walk collects directories whose own name matches, named by relative path like models are, and returns them as navigable tiles. Searching `Sandy Dunes` hands back the folder to enter *and* the parts beneath it, rather than only one or the other.
- **Deep-search results order by relative path**, so a folder's contents stay contiguous instead of scattering across the grid by base name. A plain flat browse keeps its basename ordering, which exists to sit same-named parts together — a different job.
- **Folder matches get their own result bound**, so a broad fragment cannot crowd models out of the shared cap; truncation is reported as it is today.
- **BREAKING (behavioral)**: existing queries return more. A search that matched 3 files by name may now return those 3 plus everything under a same-named folder. This is the point of the change, but it is a visible change to a shipped surface, and the cap will be reached by fragments that never reached it before.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `file-search`: two requirements change.
  - **Deep name search**: what matches (relative path, not file base name) and what comes back (matching directories at any depth as tiles, alongside the models beneath them). Its "Matching is on the file name" scenario inverts, and result ordering for a queried listing becomes relative-path order.
  - **Name filter**: its behavior is unchanged — it already matches full names — but its text asserts the asymmetry this change removes ("folder fragments match here even though deep search itself matches file names only"). That clause becomes false and must go, or the archived spec will contradict itself.

## Impact

- `server/src/listing.ts` — `matchesQuery` tests the relative path; the flat walk accumulates matching directories (currently it collects only models, and containers only at the root level); queried results sort by relative path; a bound for matched folders.
- `server/test/flat.test.ts` — the `excludes a model matched only via a containing folder name` test inverts to assert inclusion; new coverage for nested folder tiles, zip-interior directories, ordering, and the folder bound.
- `client/` — no filter change (it already matches full names). The results label and empty state may need wording that no longer implies file names only; deep-search results already render mixed containers and models, since the root's containers have always been in them.
- No API shape, cache, thumbnail, or `RIG_VERSION` impact: `/api/dir?flat=true&q=` keeps its contract, and entries keep their existing fields.
