# file-search Delta

> Written against the text `search-matches-folder-names` leaves behind — that change
> modifies this same requirement and is a hard prerequisite (tasks.md).

## MODIFIED Requirements

### Requirement: Live name filter
The client SHALL offer a name filter that narrows the tiles currently on screen as the user types, matching case-insensitively on each entry's **full name** as a substring, across every entry kind (directories, zips, models) and in nested, flat, and deep-search views alike. The filter SHALL be typed in a dedicated find control that the user summons — by the platform's find shortcut, or by an equivalent visible control offered with the results — and dismisses, rather than in the input used to submit searches. That input SHALL NOT filter: the text that produced the current results SHALL remain in it, editable and re-submittable.

Filtering SHALL be pure view state layered over the current listing: while no deep-search query is committed, it SHALL issue no requests; it SHALL NOT disturb already-loaded thumbnails for entries it hides; and it SHALL be cleared by emptying or dismissing the find control, or by navigating. Note the filter matches the entry's full name, which in flat and deep-search views is its relative path: folder fragments match here, and tiles in those views are *labeled* by file name alone (the path shows in the tooltip). The truncation notice, when present, SHALL keep describing the underlying listing rather than the filtered view. When the filter hides every tile, the UI SHALL say that the filter is hiding the listing rather than presenting an empty grid. A whitespace-only filter SHALL be treated as no filter, and whitespace surrounding the typed text SHALL be ignored when matching.

#### Scenario: Summoning the filter narrows the grid
- **WHEN** the user opens the find control over a listing and types a fragment
- **THEN** only tiles whose names contain the fragment (case-insensitive) remain visible, and dismissing the control restores the full listing

#### Scenario: The search input no longer filters
- **WHEN** the user types in the input used to submit searches
- **THEN** the grid is unchanged until they submit, and the text they typed stays available to edit and submit again

#### Scenario: Filtering matches relative paths in flat view
- **WHEN** the flat view shows a model whose name is a relative path and the user types a fragment of a containing folder's name
- **THEN** that model stays visible, since matching applies to the full name even though the tile is labeled by file name alone

#### Scenario: Filtering is free of requests
- **WHEN** the user opens the find control and types and erases text repeatedly
- **THEN** no listing requests are issued and previously loaded thumbnails reappear without re-rendering

#### Scenario: Navigation clears the filter
- **WHEN** a filter is active and the user navigates to another directory
- **THEN** the new listing renders unfiltered

#### Scenario: A filter that hides everything explains itself
- **WHEN** the user types a fragment that matches no entry in the current listing
- **THEN** the UI states that the filter is hiding the tiles, and clearing the find control restores them

#### Scenario: Whitespace does not filter
- **WHEN** the find control holds only whitespace, or a fragment padded with whitespace
- **THEN** whitespace-only text filters nothing, and a padded fragment matches as if unpadded

#### Scenario: Filtering search results
- **WHEN** search results are shown and the user narrows them with the find control
- **THEN** the results narrow client-side by full name, with no new search request, whatever selected those results

#### Scenario: The filter is discoverable without the shortcut
- **WHEN** the user has never pressed the find shortcut
- **THEN** a visible control offered with the results opens the same find control
