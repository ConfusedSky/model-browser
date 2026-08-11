# file-search Delta

## ADDED Requirements

### Requirement: Live name filter
The client SHALL offer a name filter that narrows the tiles currently on screen as the user types, matching case-insensitively on each entry's displayed name as a substring, across every entry kind (directories, zips, models) and in both nested and flat views. Filtering SHALL be pure view state: it SHALL issue no requests, SHALL NOT disturb already-loaded thumbnails for entries it hides, and SHALL be cleared by emptying the input or navigating. The truncation notice, when present, SHALL keep describing the underlying listing rather than the filtered view.

#### Scenario: Typing narrows the grid
- **WHEN** the user types a fragment into the search input over a listing
- **THEN** only tiles whose names contain the fragment (case-insensitive) remain visible, and erasing the input restores the full listing

#### Scenario: Filtering matches relative paths in flat view
- **WHEN** the flat view labels a model by its relative path and the user types a fragment of a containing folder's name
- **THEN** that model stays visible, since matching applies to the displayed name

#### Scenario: Filtering is free of requests
- **WHEN** the user types and erases filter text repeatedly
- **THEN** no listing requests are issued and previously loaded thumbnails reappear without re-rendering

#### Scenario: Navigation clears the filter
- **WHEN** a filter is active and the user navigates to another directory
- **THEN** the new listing renders unfiltered and the input is empty

### Requirement: Deep name search
On an explicit action, the client SHALL request a recursive name search of the current directory from the server. The server SHALL reuse the flat walk for it — the same recursive descent, zip-entry handling, hidden/unreadable-directory skipping, symlink visited-set, step budget, and result cap — returning the models under the root whose file name contains the query (case-insensitive), named by root-relative path in flat-listing order, plus the root's immediate directory and zip entries whose names match. The cap SHALL bound matching models, not raw walk output, and the response SHALL carry the truncation flag under the same rules as a flat listing. The query SHALL only be honored together with the flat listing flag; a query without it SHALL be rejected. Deep-search results SHALL render as an ordinary listing — thumbnails, orbit, lightbox, and camera persistence behave identically, and the in-flight skeleton and latest-wins supersession apply. Clearing the query SHALL restore the ordinary listing for the current path, and navigating away SHALL drop the search rather than carry it along.

#### Scenario: A buried part is found by name
- **WHEN** the user deep-searches a fragment that matches models several directories down and inside zips
- **THEN** the matching models are returned with relative-path labels in file-name order, and no non-matching models appear

#### Scenario: Matching is on the file name
- **WHEN** a model's containing folder matches the query but its file name does not
- **THEN** that model is not in the deep-search results

#### Scenario: Cap bounds matches
- **WHEN** a deep search matches more models than the result cap
- **THEN** the response holds the cap's worth of matches in file-name order and is flagged truncated

#### Scenario: A query needs the flat flag
- **WHEN** a listing request carries a query without the flat flag
- **THEN** the server rejects it rather than silently ignoring the query

#### Scenario: Slow search shows the skeleton, a newer request wins
- **WHEN** a deep search over a large tree is still unresolved past the reveal delay, and the user then navigates or toggles flat
- **THEN** the skeleton shows until the newer request lands, and the search response, arriving late, is discarded

#### Scenario: Leaving the search restores browsing
- **WHEN** deep-search results are shown and the user clears the query
- **THEN** the ordinary listing for the current path is requested and rendered, honoring the flat toggle's state
