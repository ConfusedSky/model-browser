# file-search Specification

## Purpose
TBD - created by archiving change file-name-search. Update Purpose after archive.
## Requirements
### Requirement: Live name filter
The client SHALL offer a name filter that narrows the tiles currently on screen as the user types, matching case-insensitively on each entry's **full name** as a substring, across every entry kind (directories, zips, models) and in nested, flat, and deep-search views alike. The filter SHALL be typed in a dedicated find control that the user summons — by the platform's find shortcut, or by an equivalent visible control offered with the results — and dismisses, rather than in the input used to submit searches. That input SHALL NOT filter: the text that produced the current results SHALL remain in it, editable and re-submittable.

Filtering SHALL be pure view state layered over the current listing: while no deep-search query is committed, it SHALL issue no requests; it SHALL NOT disturb already-loaded thumbnails for entries it hides; and it SHALL be cleared by emptying or dismissing the find control, or by navigating. Note the filter matches the entry's full name, which in flat and deep-search views is its relative path: folder fragments match here, and tiles in those views are *labeled* by file name alone (the path shows in the tooltip). The truncation notice, when present, SHALL keep describing the underlying listing rather than the filtered view. When the filter hides every tile, the UI SHALL say that the filter is hiding the listing rather than presenting an empty grid. A whitespace-only filter SHALL be treated as no filter, and whitespace surrounding the typed text SHALL be ignored when matching.

#### Scenario: Typing narrows the grid
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

#### Scenario: Typing over deep-search results filters them
- **WHEN** search results are shown and the user narrows them with the find control
- **THEN** the results narrow client-side by full name, with no new search request, whatever selected those results

#### Scenario: The filter is discoverable without the shortcut
- **WHEN** the user has never pressed the find shortcut
- **THEN** a visible control offered with the results opens the same find control

### Requirement: Deep name search
On an explicit submit action, the client SHALL commit the input text as a search query and run the search selected by the search mode in force, targeted at the user's newest requested directory (the in-flight navigation target when one exists, the committed path otherwise). **In name mode** — the default, and the only mode when no other corpus is available — the server SHALL reuse the flat walk for it: the same recursive descent, zip-entry handling, hidden/unreadable-directory skipping, symlink visited-set, step budget, and result cap, returning the models under the root whose **root-relative path** contains the query (case-insensitive) — matching a containing folder's name, a containing archive's name, or the file's own — each named by that path, plus every directory and archive under the root whose **own** name matches, likewise named by its root-relative path and navigable like any container tile. Matched containers SHALL be bounded independently of the model cap, so neither kind can crowd out the other, and either bound dropping entries SHALL set the truncation flag. Matching containers SHALL lead the response as a group, ahead of the models, ordered directories before archives as every other listing orders them and by root-relative path within a kind; the models SHALL follow in root-relative-path order, so a folder's contents stay contiguous. A folder SHALL appear exactly once however it was matched. A plain flat listing without a query keeps its file-name ordering. When the root is a zip or a directory inside one, the same rules apply within the archive. The cap SHALL bound matching models, not raw walk output, and the response SHALL carry the truncation flag under the same rules as a flat listing. The search walk SHALL run on its own step budget, independently configurable and larger by default than the browse walk's, since a search returns matches rather than everything it visits.

When a name search returns no matches AND the walk was truncated, the UI SHALL say the search ran out before covering the tree — suggesting a narrower root — rather than claiming nothing matched; the plain no-match message is reserved for searches that completed. A blank or whitespace-only query SHALL be treated as no query. A non-blank query SHALL only be honored together with the flat listing flag; one without it SHALL be rejected.

Results of any mode SHALL render as an ordinary listing — thumbnails, orbit, lightbox, and camera persistence behave identically, and the in-flight skeleton and latest-wins supersession apply. While a query is committed, the UI SHALL make clear that the grid holds search results for that query rather than the directory's contents, and SHALL make clear which search produced them. A search that matched nothing SHALL say so rather than showing an empty grid. A search that fails SHALL surface its error and SHALL NOT label the unchanged grid as its results: the results label SHALL keep describing the listing actually on screen — the last search that landed, or no label over a plain listing. Results are flat-shaped regardless of the flat toggle's state; the toggle SHALL keep reflecting its own state, and pressing it SHALL issue its ordinary listing request, superseding the search. Clearing a committed query SHALL restore the ordinary listing for the current path, and navigating away SHALL drop the search rather than carry it along.

#### Scenario: A buried part is found by name
- **WHEN** the user submits in name mode a fragment that matches models several directories down and inside zips
- **THEN** the matching models are returned with relative-path names in relative-path order, and no non-matching models appear

#### Scenario: Matching is on the file name
- **WHEN** a model's own file name contains the query while nothing in its path does
- **THEN** it is in the results, as it was before folders could match — widening the predicate adds matches rather than replacing them

#### Scenario: Matching includes containing folders
- **WHEN** a model's containing folder matches the query but its own file name does not
- **THEN** that model is in the name-search results, named by its relative path, and the matching folder is there too as a navigable tile

#### Scenario: A folder deeper than the root's children still matches
- **WHEN** the query matches a folder several levels below the search root
- **THEN** that folder comes back as a tile just as a matching child of the root does — depth does not decide whether a folder can match

#### Scenario: An archive matches like a folder
- **WHEN** the query matches a zip's name
- **THEN** the models inside it are results, on the same rule that makes a folder's contents results

#### Scenario: The search root does not match itself
- **WHEN** the user searches from inside a folder for a fragment of that folder's own name
- **THEN** only entries beneath it whose own relative paths match are returned — the root matching itself does not return everything

#### Scenario: A folder is returned once, not once per way it matched
- **WHEN** the query matches a folder that is an immediate child of the search root
- **THEN** exactly one tile for it appears in the results

#### Scenario: A folder's contents stay together
- **WHEN** a search matches folders whose files share common names with files elsewhere in the tree
- **THEN** each folder's models are listed contiguously rather than interleaved with same-named files from other folders

#### Scenario: Matching containers keep the listing's kind order
- **WHEN** a search matches both directories and archives
- **THEN** they lead the results as one group, directories before archives, exactly as an ordinary listing orders them — the query changes which containers appear, not how kinds are ranked

#### Scenario: Folders cannot crowd out models
- **WHEN** a name search matches far more folders than the container bound allows
- **THEN** the response still carries its full share of matching models, and the truncation flag reports that entries were dropped

#### Scenario: Submit runs the mode in force
- **WHEN** the user submits the same text under each available search mode
- **THEN** each submit runs that mode's search, and the results label says which one produced the grid

#### Scenario: Cap bounds matches
- **WHEN** a name search matches more models than the result cap
- **THEN** the response holds the cap's worth of matches and is flagged truncated

#### Scenario: A query needs the flat flag
- **WHEN** a listing request carries a non-blank query without the flat flag
- **THEN** the server rejects it rather than silently ignoring the query

#### Scenario: A blank query is no query
- **WHEN** a flat listing request carries an empty or whitespace-only query
- **THEN** the response is the ordinary unfiltered flat listing

#### Scenario: Deep search rooted in a zip
- **WHEN** the user searches by name while browsing a zip or a directory inside one
- **THEN** matching models beneath that prefix are returned with names relative to it, under the archive walk's usual rules

#### Scenario: Results are legible as search results
- **WHEN** search results are on screen
- **THEN** the UI identifies them as matches for the committed query, distinct from the directory listing the path bar names

#### Scenario: A search that matches nothing says so
- **WHEN** a search completes with no matching models or containers
- **THEN** the UI states that nothing matched, rather than rendering an empty grid

#### Scenario: Search reaches past the browse horizon
- **WHEN** the user searches by name over a library large enough that a flat browse of the same root truncates
- **THEN** the search still finds matches beyond the browse budget's horizon, because it walks on its own larger budget

#### Scenario: A truncated empty search admits it ran out
- **WHEN** a name search exhausts its walk budget without finding a match
- **THEN** the UI says the search could not cover the whole tree and suggests searching from a deeper folder

#### Scenario: A failed search keeps the label truthful
- **WHEN** a submitted search fails while a previous listing or an earlier search's results are on screen
- **THEN** the error is surfaced and the results label continues to describe what is actually shown

#### Scenario: Slow search shows the skeleton, a newer request wins
- **WHEN** a search over a large tree is still unresolved past the reveal delay, and the user then navigates or toggles flat
- **THEN** the skeleton shows until the newer request lands, and the search response, arriving late, is discarded

#### Scenario: Leaving the search restores browsing
- **WHEN** search results are shown and the user clears the query
- **THEN** the ordinary listing for the current path is requested and rendered, honoring the flat toggle's state

### Requirement: Search options are sticky and shareable
The client SHALL offer two options governing a deep search: whether matching considers a model's containing folders and archives or only its own file name, and whether results present containers, models, or both. Folder matching SHALL default to on, and the kind option SHALL default to both.

Each option SHALL be persisted per browser profile, so a subsequent search in that profile uses the last settings the user chose, and each SHALL also be carried in the URL alongside the query, so a copied or bookmarked search reproduces the results its sender saw rather than the recipient's stored settings. Options carried in a URL SHALL govern searches made from it without being written to the recipient's stored settings; only the user operating a control SHALL change what is stored. Where a URL names a committed search, an option it does not carry SHALL be taken as that option's default rather than as the viewer's stored preference — otherwise a link written under default options would reproduce the recipient's settings instead of the sender's view. Restoring such a view from history SHALL restore the options it ran under, and two views differing only by their options SHALL be treated as different views.

While a query is committed, changing an option SHALL take effect immediately rather than at the next search: an option that determines what the server returns SHALL re-issue the search, under the same latest-wins supersession, loading feedback, and history behavior as any other committed view change; an option that only selects among returned entries SHALL apply without a request. The truncation and empty-state reporting SHALL keep describing what the user is actually looking at under the options in force.

#### Scenario: Options persist across searches and sessions
- **WHEN** the user turns folder matching off, searches, navigates away, and later searches again in the same browser profile
- **THEN** the later search still has folder matching off, without the user setting it again

#### Scenario: A shared search reproduces the sender's results
- **WHEN** a user copies the URL of a search made with particular options and another profile opens it
- **THEN** that profile sees the same results the sender saw, under the sender's options rather than its own stored ones

#### Scenario: A link written under default options still reproduces
- **WHEN** a user whose options are the defaults shares a search URL, and a recipient whose stored options differ opens it
- **THEN** the recipient sees the sender's results, because the options the URL omits are the defaults rather than the recipient's settings

#### Scenario: History restores the options a view ran under
- **WHEN** the user changes an option with a query committed and then goes back
- **THEN** the earlier results return under the options they ran under, rather than the URL changing while the grid stays as it is

#### Scenario: A shared link does not reconfigure the recipient
- **WHEN** a profile opens a search link carrying options different from its stored ones, then navigates away and starts a fresh search
- **THEN** the fresh search uses that profile's own stored options — the link governed only the view it named

#### Scenario: Changing an option acts on the results on screen
- **WHEN** the user changes an option while search results are displayed
- **THEN** the grid reflects the new option immediately — re-searching if the option changes what the server returns, and re-presenting the existing results if it only selects among them

#### Scenario: Narrowing to one kind
- **WHEN** a search matches both folders and models and the user restricts results to folders
- **THEN** only the matching folders are presented, and the empty-state and truncation wording describe that view rather than the unrestricted one

#### Scenario: File-name-only matching still finds parts
- **WHEN** the user turns folder matching off and searches a fragment that appears in folder names but not in any file name
- **THEN** no models are returned on the strength of their folders, and the empty state says nothing matched rather than implying the search was incomplete

