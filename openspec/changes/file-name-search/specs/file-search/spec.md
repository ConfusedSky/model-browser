# file-search Delta

## ADDED Requirements

### Requirement: Live name filter
The client SHALL offer a name filter that narrows the tiles currently on screen as the user types, matching case-insensitively on each entry's **full name** as a substring, across every entry kind (directories, zips, models) and in nested, flat, and deep-search views alike. Filtering SHALL be pure view state layered over the current listing: while no deep-search query is committed, it SHALL issue no requests; it SHALL NOT disturb already-loaded thumbnails for entries it hides; and it SHALL be cleared by emptying the input or navigating (clearing the input while a deep-search query is committed instead restores the ordinary listing, per the deep-search requirement). Note the filter matches the entry's full name, which in flat and deep-search views is its relative path: folder fragments match here even though deep search itself matches file names only, and even though tiles in those views are *labeled* by file name alone (the path shows in the tooltip). The truncation notice, when present, SHALL keep describing the underlying listing rather than the filtered view. When the filter hides every tile, the UI SHALL say that the filter is hiding the listing rather than presenting an empty grid. A whitespace-only filter SHALL be treated as no filter, and whitespace surrounding the typed text SHALL be ignored when matching.

#### Scenario: Typing narrows the grid
- **WHEN** the user types a fragment into the search input over a listing
- **THEN** only tiles whose names contain the fragment (case-insensitive) remain visible, and erasing the input restores the full listing

#### Scenario: Filtering matches relative paths in flat view
- **WHEN** the flat view shows a model whose name is a relative path and the user types a fragment of a containing folder's name
- **THEN** that model stays visible, since matching applies to the full name even though the tile is labeled by file name alone

#### Scenario: Filtering is free of requests
- **WHEN** the user types and erases filter text repeatedly
- **THEN** no listing requests are issued and previously loaded thumbnails reappear without re-rendering

#### Scenario: Navigation clears the filter
- **WHEN** a filter is active and the user navigates to another directory
- **THEN** the new listing renders unfiltered and the input is empty

#### Scenario: A filter that hides everything explains itself
- **WHEN** the user types a fragment that matches no entry in the current listing
- **THEN** the UI states that the filter is hiding the tiles, and erasing the input restores them

#### Scenario: Whitespace does not filter
- **WHEN** the input holds only whitespace, or a fragment padded with whitespace
- **THEN** whitespace-only text filters nothing, and a padded fragment matches as if unpadded

#### Scenario: Typing over deep-search results filters them
- **WHEN** deep-search results are shown and the user edits the input text without submitting again
- **THEN** the results narrow client-side by full name, with no new search request

### Requirement: Deep name search
On an explicit submit action — distinct from typing, which only filters — the client SHALL commit the input text as a search query and request a recursive name search from the server, targeted at the user's newest requested directory (the in-flight navigation target when one exists, the committed path otherwise). The server SHALL reuse the flat walk for it — the same recursive descent, zip-entry handling, hidden/unreadable-directory skipping, symlink visited-set, step budget, and result cap — returning the models under the root whose file name contains the query (case-insensitive), named by root-relative path in flat-listing order, plus the root's immediate directory and zip entries whose names match. When the root is a zip or a directory inside one, the same rules apply within the archive. The cap SHALL bound matching models, not raw walk output, and the response SHALL carry the truncation flag under the same rules as a flat listing. The search walk SHALL run on its own step budget, independently configurable and larger by default than the browse walk's, since a search returns matches rather than everything it visits. When a search returns no matches AND the walk was truncated, the UI SHALL say the search ran out before covering the tree — suggesting a narrower root — rather than claiming nothing matched; the plain no-match message is reserved for searches that completed. A blank or whitespace-only query SHALL be treated as no query. A non-blank query SHALL only be honored together with the flat listing flag; one without it SHALL be rejected. Deep-search results SHALL render as an ordinary listing — thumbnails, orbit, lightbox, and camera persistence behave identically, and the in-flight skeleton and latest-wins supersession apply. While a query is committed, the UI SHALL make clear that the grid holds search results for that query rather than the directory's contents, and a search that matched nothing SHALL say so rather than showing an empty grid. A search that fails SHALL surface its error and SHALL NOT label the unchanged grid as its results: the results label SHALL keep describing the listing actually on screen — the last search that landed, or no label over a plain listing. Results are flat-shaped regardless of the flat toggle's state; the toggle SHALL keep reflecting its own state, and pressing it SHALL issue its ordinary listing request, superseding the search. Clearing a committed query SHALL restore the ordinary listing for the current path, and navigating away SHALL drop the search rather than carry it along.

#### Scenario: A buried part is found by name
- **WHEN** the user deep-searches a fragment that matches models several directories down and inside zips
- **THEN** the matching models are returned with relative-path names in file-name order, and no non-matching models appear

#### Scenario: Matching is on the file name
- **WHEN** a model's containing folder matches the query but its file name does not
- **THEN** that model is not in the deep-search results

#### Scenario: Cap bounds matches
- **WHEN** a deep search matches more models than the result cap
- **THEN** the response holds the cap's worth of matches in file-name order and is flagged truncated

#### Scenario: A query needs the flat flag
- **WHEN** a listing request carries a non-blank query without the flat flag
- **THEN** the server rejects it rather than silently ignoring the query

#### Scenario: A blank query is no query
- **WHEN** a flat listing request carries an empty or whitespace-only query
- **THEN** the response is the ordinary unfiltered flat listing

#### Scenario: Deep search rooted in a zip
- **WHEN** the user deep-searches while browsing a zip or a directory inside one
- **THEN** matching models beneath that prefix are returned with names relative to it, under the archive walk's usual rules (no descent into a further archive)

#### Scenario: Results are legible as search results
- **WHEN** deep-search results are on screen
- **THEN** the UI identifies them as matches for the committed query, distinct from the directory listing the path bar names

#### Scenario: A search that matches nothing says so
- **WHEN** a deep search completes with no matching models or containers
- **THEN** the UI states that nothing matched, rather than rendering an empty grid

#### Scenario: Search reaches past the browse horizon
- **WHEN** the user deep-searches a library large enough that a flat browse of the same root truncates
- **THEN** the search still finds matches beyond the browse budget's horizon, because it walks on its own larger budget

#### Scenario: A truncated empty search admits it ran out
- **WHEN** a deep search exhausts its walk budget without finding a match
- **THEN** the UI says the search could not cover the whole tree and suggests searching from a deeper folder — it does not claim that nothing matched

#### Scenario: A failed search keeps the label truthful
- **WHEN** a submitted search fails while a previous listing or an earlier search's results are on screen
- **THEN** the error is surfaced and the results label continues to describe what is actually shown, naming the last search that landed or nothing at all — never the failed query

#### Scenario: Slow search shows the skeleton, a newer request wins
- **WHEN** a deep search over a large tree is still unresolved past the reveal delay, and the user then navigates or toggles flat
- **THEN** the skeleton shows until the newer request lands, and the search response, arriving late, is discarded

#### Scenario: Leaving the search restores browsing
- **WHEN** deep-search results are shown and the user clears the query
- **THEN** the ordinary listing for the current path is requested and rendered, honoring the flat toggle's state
