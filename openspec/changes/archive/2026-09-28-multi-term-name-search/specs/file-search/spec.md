## ADDED Requirements

### Requirement: Names match term by term
A name query SHALL be read as **terms**: the text is trimmed and split on runs of whitespace,
and text with no terms is no query. Each term SHALL match case-insensitively as a substring,
and every character of a term other than whitespace SHALL be literal — underscores, hyphens
and dots included, so `young_bronze` is one term and matches only names containing it. An
entry SHALL match a query only when **every** term matches it, in any order. Different terms
MAY match different names of the entry, but a single term SHALL match within one name, never
across two.

Which names a term is tested against depends on the entry's kind, and is taken below the
root the matching runs from — the folder a search runs from, or the location of the listing
being narrowed:

- A **model**, where folder matching is on, SHALL be tested against its root-relative path
  and against every stored display name along it: its own, and that of each folder and
  archive containing it below the root, a folder inside an archive included.
- A **model**, where folder matching is off (see *Search options are sticky and
  shareable*), SHALL be tested against its own file name and its own stored display name
  only.
- A **directory or archive** SHALL be tested against its own name and its own stored
  display name only, never against the names of what contains it, so that one hit does not
  return a whole subtree of folder tiles.

A stored display name is the name the library's override store holds for that exact path
(see `library-overrides`, and `directory-browsing`, *Entries display their stored name*),
from the store as the server has loaded it — the same store the tiles' labels are drawn
from, so a tile can be found by the name it shows for exactly as long as it shows it. The
root's own stored name, and those of the folders above the root, SHALL NOT take part, just
as the root's own real name does not. Where the entries on screen are named relative to some
other root — meaning and similarity results, named relative to the index's collection — the
folders taken are those the entry's relative name passes through.

This SHALL be one rule wherever names are matched: the deep name search, the count of name
matches offered beside a meaning search, and the live name filter, so that typing text and
submitting it mean the same thing.

#### Scenario: Terms match in any order
- **WHEN** a name search for `Young Bronze`, and another for `Bronze Young`, runs from the top of a library holding `Bronze_Dragon_2832574/Young_Bronze_Dragon.stl`
- **THEN** that model is among the results of both

#### Scenario: A separator inside a term is literal
- **WHEN** a name search for `young_bronze` runs over a library holding `Young_Bronze_Dragon.stl` and `Young-Bronze.stl`
- **THEN** the first matches and the second does not, the query being one term that contains an underscore

#### Scenario: Every term must match
- **WHEN** a name search for `bronze paladin` runs over a library where no model's names hold both words
- **THEN** nothing matches, although each word alone would match something

#### Scenario: A folder is found by its stored name
- **WHEN** the folder `DD_minis_945822` has the stored name "D&D minis" and a name search for `D&D` runs from the library's top
- **THEN** that folder is a result tile, and the models inside it are results too

#### Scenario: Terms may be split across names
- **WHEN** a name search for `D&D paladin` runs from the library's top, "D&D" appearing only in the stored name "D&D minis" of the folder `DD_minis_945822`, and "paladin" only in the file name of `DD_minis_945822/paladin.stl`
- **THEN** that model is a result

#### Scenario: A container matches on its own names only
- **WHEN** the folder `Kit` has the stored name "Heroes", its subfolder `Kit/bases` has none, and a name search for `heroes bases` runs from the library's top
- **THEN** the models under `Kit/bases` are results, while `Kit/bases` itself is not a result tile, since "heroes" is in neither of its own names

#### Scenario: The root's stored name does not match
- **WHEN** the user searches by name for `D&D` from inside `DD_minis_945822`, whose stored name is "D&D minis"
- **THEN** no entry is returned on the strength of that folder's stored name

#### Scenario: File-name-only matching ignores the folders' stored names
- **WHEN** folder matching is off and a name search for `D&D paladin` runs from the library's top
- **THEN** `DD_minis_945822/paladin.stl` is not a result, since "d&d" is in neither its file name nor its own stored name

#### Scenario: Typing what was submitted keeps every result
- **WHEN** the user submits `D&D paladin` in name mode, then opens the find control over the results and types the same text
- **THEN** every result stays visible

#### Scenario: A library without stored names
- **WHEN** a library has no override store and a query of one term is submitted
- **THEN** a model matches exactly when its root-relative path contains the term, and a container when its own name does

## MODIFIED Requirements

### Requirement: Live name filter
The client SHALL offer a name filter that narrows the tiles currently on screen as the user types, matching each entry by *Names match term by term*, with folder matching on and the listing's own location as the root, across every entry kind (directories, zips, models) and in nested, flat, and deep-search views alike. Narrowing a nested, flat or name-search listing by some text SHALL therefore keep exactly those of its entries that a name search for the same text from the same location, with folder matching on, would match. Meaning and similarity results are named relative to the index's collection rather than to the listing's location, and SHALL be narrowed by the same rule over the names they carry: their real relative path, their own stored name, and the stored names of the folders that path passes through (see `directory-browsing`, *Entries display their stored name*). The filter SHALL be typed in a dedicated find control that the user summons — by the platform's find shortcut, pressed outside a text field or in the search input while it is empty, or by an equivalent visible control, a *Narrow* toggle in the toolbar that is shown whatever the grid holds and marked pressed while the find control is open — and dismisses, rather than in the input used to submit searches. That input SHALL NOT filter: the text that produced the current results SHALL remain in it, editable and re-submittable, for as long as those results are on screen.

Filtering SHALL be pure view state layered over the current listing: while no deep-search query is committed, it SHALL issue no requests; it SHALL NOT disturb already-loaded thumbnails for entries it hides; and it SHALL be cleared by emptying or dismissing the find control, or by navigating. Note a model is matched on its full name, which in flat and deep-search views is its relative path, and on the stored names of the folders along it: folder fragments match here, and tiles in those views are *labeled* by file name alone (the path shows in the tooltip, and the containing folders on a line beneath the name). The truncation notice, when present, SHALL keep describing the underlying listing rather than the filtered view. When the filter hides every tile, the UI SHALL say that the filter is hiding the listing rather than presenting an empty grid. A whitespace-only filter SHALL be treated as no filter, and whitespace surrounding the typed text SHALL be ignored when matching.

#### Scenario: Typing narrows the grid
- **WHEN** the user opens the find control over a listing and types a fragment
- **THEN** only tiles whose names contain the fragment (case-insensitive) — a real name or a stored name the matching rule reads — remain visible, and dismissing the control restores the full listing

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
- **THEN** the results narrow client-side by the rule a name search applies, with no new search request, whatever selected those results — and narrowing name-search results by the very text that produced them hides none of them

#### Scenario: The filter is discoverable without the shortcut
- **WHEN** the user has never pressed the find shortcut
- **THEN** the toolbar's Narrow toggle opens the same find control, and pressing it again closes it

#### Scenario: The shortcut from an empty search box
- **WHEN** the search input has focus and is empty, and the user presses the find shortcut
- **THEN** the find control opens rather than the browser's own find; with a draft in the input, the browser's find is left alone

#### Scenario: Words narrow in any order
- **WHEN** the find control holds `bronze young` over a listing that includes `Young_Bronze_Dragon.stl`
- **THEN** that tile stays visible, as it does for `young bronze`

#### Scenario: A stored name narrows like a real one
- **WHEN** a flat listing includes `DD_minis_945822/paladin.stl`, the folder's stored name is "D&D minis", and the user types `d&d paladin` into the find control
- **THEN** that tile stays visible, although neither its file name nor its path contains "d&d"

### Requirement: Deep name search
On an explicit submit action, the client SHALL commit the input text as a search query and run the search selected by the search mode in force — or by the corpus the query's shape belongs to, where `semantic-search` routes it (*A query that plainly belongs to the other corpus is asked of it until its results are left*) — targeted at the user's newest requested directory (the in-flight navigation target when one exists, the committed path otherwise). **In name mode** — the default, and the only mode when no other corpus is available — the server SHALL reuse the flat walk for it: the same recursive descent, zip-entry handling, hidden/unreadable-directory skipping, symlink visited-set, step budget, and result cap, returning the models under the root that the query matches by *Names match term by term* — through the **root-relative path**, which holds a containing folder's name, a containing archive's name and the file's own, or through a stored name along that path — each named by that path, plus every directory and archive under the root whose **own** names match, likewise named by its root-relative path and navigable like any container tile. Matched containers SHALL be bounded independently of the model cap, so neither kind can crowd out the other, and either bound dropping entries SHALL set the truncation flag. Matching containers SHALL lead the response as a group, ahead of the models, ordered directories before archives as every other listing orders them and by root-relative path within a kind; the models SHALL follow in root-relative-path order, so a folder's contents stay contiguous. The client SHALL **present** the models first and the matched containers after them, in the response's order within each group: a name search is asked in order to find models, and the containers it also finds are a way onward that SHALL NOT bury the first model. A folder SHALL appear exactly once however it was matched. A plain flat listing without a query keeps its file-name ordering. When the root is a zip or a directory inside one, the same rules apply within the archive. The cap SHALL bound matching models, not raw walk output, and the response SHALL carry the truncation flag under the same rules as a flat listing. The search walk SHALL run on its own step budget, independently configurable and larger by default than the browse walk's, since a search returns matches rather than everything it visits.

When a name search returns no matches AND the walk was truncated, the UI SHALL say the search ran out before covering the tree — suggesting a narrower root — rather than claiming nothing matched; the plain no-match message is reserved for searches that completed. A blank or whitespace-only query SHALL be treated as no query. A non-blank query SHALL only be honored together with the flat listing flag; one without it SHALL be rejected.

Results of any mode SHALL render as an ordinary listing — thumbnails, orbit, lightbox, and camera persistence behave identically, and the in-flight skeleton and latest-wins supersession apply. While a query is committed, the UI SHALL make clear that the grid holds search results for that query rather than the directory's contents, and SHALL make clear which search produced them. A search that matched nothing SHALL say so rather than showing an empty grid. A search that fails SHALL surface its error and SHALL NOT label the unchanged grid as its results: the results label SHALL keep describing the listing actually on screen — the last search that landed, or no label over a plain listing. Results are flat-shaped regardless of the flat toggle's state; the toggle SHALL keep reflecting its own state, and pressing it SHALL issue its ordinary listing request, superseding the search. Clearing a committed query SHALL restore the ordinary listing for the current path, and navigating away SHALL drop the search rather than carry it along.

#### Scenario: A buried part is found by name
- **WHEN** the user submits in name mode a fragment that matches models several directories down and inside zips
- **THEN** the matching models are returned with relative-path names in relative-path order, and no non-matching models appear

#### Scenario: Matching is on the file name
- **WHEN** a model's own file name contains the query while nothing in its path does
- **THEN** it is in the results — matching the whole relative path adds matches to the file name's own rather than replacing them

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
- **THEN** the response leads with them as one group, directories before archives, exactly as an ordinary listing orders them, and the grid presents that group after the matching models, in the same order — the query changes which containers appear, not how kinds are ranked among themselves

#### Scenario: Models come first on screen
- **WHEN** a name search matches both folders and models
- **THEN** the first tiles in the grid are the matching models and the matching folders follow them

#### Scenario: Folders cannot crowd out models
- **WHEN** a name search matches far more folders than the container bound allows
- **THEN** the response still carries its full share of matching models, and the truncation flag reports that entries were dropped

#### Scenario: Submit runs the mode in force
- **WHEN** the user submits the same text under each available search mode, the text being of neither shape the other corpus claims
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

#### Scenario: Words written with spaces find a name written with underscores
- **WHEN** the user submits `Young Bronze` in name mode from the library's top, over a library holding `Bronze_Dragon_2832574/Young_Bronze_Dragon.stl`
- **THEN** that model is among the results, as it is for `Bronze Young` and for `young_bronze`

#### Scenario: Meaning results narrow by stored names too
- **WHEN** meaning results include `DD_minis_945822/paladin.stl`, the folder's stored name is "D&D minis", and the user types `d&d` into the find control
- **THEN** that tile stays visible
