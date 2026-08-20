# file-search Delta

> Written against the text `search-matches-folder-names` and then `find-in-listing` leave
> behind — both modify this requirement and both are hard prerequisites (tasks.md). Every
> scenario those changes established is carried forward here: a MODIFIED requirement
> replaces prose *and* scenarios at archive, so one dropped silently on the way through is
> one deleted from the shipped spec.

## MODIFIED Requirements

### Requirement: Deep name search
On an explicit submit action, the client SHALL commit the input text as a search query and run the search selected by the search mode in force, targeted at the user's newest requested directory (the in-flight navigation target when one exists, the committed path otherwise). **In name mode** — the default, and the only mode when no other corpus is available — the server SHALL reuse the flat walk for it: the same recursive descent, zip-entry handling, hidden/unreadable-directory skipping, symlink visited-set, step budget, and result cap, returning the models under the root whose **root-relative path** contains the query (case-insensitive) — matching a containing folder's name, a containing archive's name, or the file's own — each named by that path, plus every directory and archive under the root whose **own** name matches, likewise named by its root-relative path and navigable like any container tile. Matched containers SHALL be bounded independently of the model cap, so neither kind can crowd out the other, and either bound dropping entries SHALL set the truncation flag. Matching containers SHALL lead the response as a group, ahead of the models, ordered directories before archives as every other listing orders them and by root-relative path within a kind; the models SHALL follow in root-relative-path order, so a folder's contents stay contiguous. A folder SHALL appear exactly once however it was matched. A plain flat listing without a query keeps its file-name ordering. When the root is a zip or a directory inside one, the same rules apply within the archive. The cap SHALL bound matching models, not raw walk output, and the response SHALL carry the truncation flag under the same rules as a flat listing. The search walk SHALL run on its own step budget, independently configurable and larger by default than the browse walk's, since a search returns matches rather than everything it visits.

When a name search returns no matches AND the walk was truncated, the UI SHALL say the search ran out before covering the tree — suggesting a narrower root — rather than claiming nothing matched; the plain no-match message is reserved for searches that completed. A blank or whitespace-only query SHALL be treated as no query. A non-blank query SHALL only be honored together with the flat listing flag; one without it SHALL be rejected.

Results of any mode SHALL render as an ordinary listing — thumbnails, orbit, lightbox, and camera persistence behave identically, and the in-flight skeleton and latest-wins supersession apply. While a query is committed, the UI SHALL make clear that the grid holds search results for that query rather than the directory's contents, and SHALL make clear which search produced them. A search that matched nothing SHALL say so rather than showing an empty grid. A search that fails SHALL surface its error and SHALL NOT label the unchanged grid as its results: the results label SHALL keep describing the listing actually on screen — the last search that landed, or no label over a plain listing. Results are flat-shaped regardless of the flat toggle's state; the toggle SHALL keep reflecting its own state, and pressing it SHALL issue its ordinary listing request, superseding the search. Clearing a committed query SHALL restore the ordinary listing for the current path, and navigating away SHALL drop the search rather than carry it along.

#### Scenario: A buried part is found by name
- **WHEN** the user submits in name mode a fragment that matches models several directories down and inside zips
- **THEN** the matching models are returned with relative-path names in relative-path order, and no non-matching models appear

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
