# semantic-search Delta

## ADDED Requirements

### Requirement: Meaning search is a mode of the search input
The client SHALL offer meaning search as a mode the search input runs in, selected by an option carried with the other search options, so that submitting from the input runs whichever search is in force. The option SHALL be sticky per browser profile and carried in the URL under the same rules as the other options that determine which results exist, and changing it while a query is committed SHALL re-run that query in the newly selected mode without the user retyping it. Which mode is in force SHALL be visible without opening the panel, since it is what explains the grid.

Meaning results SHALL replace the grid and SHALL render as an ordinary listing — thumbnails, orbit, lightbox, and camera persistence behave identically, and the in-flight skeleton and latest-wins supersession apply. Results SHALL be presented in the order the index returned them, which is by relevance and is never re-sorted by name. Navigating, toggling flat, or committing another search SHALL supersede them, and clearing the query SHALL restore the ordinary listing for the current path.

The UI SHALL make clear that the grid holds meaning matches for the committed phrase and that they came from the index rather than from the directory listing. The number of results SHALL be bounded by this app's own choice of how many ranked models a grid should hold, and that bound SHALL be presented as showing the strongest matches rather than as truncation: a relevance ranking has no horizon it can run out at, so the truncation affordance a name search uses does not apply and SHALL NOT be reused.

Options that do not apply to the mode in force SHALL be hidden rather than shown inert.

#### Scenario: A phrase finds models whose names do not contain it
- **WHEN** the user commits a search in meaning mode for a phrase describing a subject
- **THEN** models matching that description are shown, ranked by relevance, including models whose file names and folders contain none of the words

#### Scenario: Flipping the mode re-runs the same text
- **WHEN** a name search returns nothing and the user switches to meaning mode
- **THEN** the same text is run against the index without being retyped, and the results replace the grid

#### Scenario: Meaning results are an ordinary grid
- **WHEN** meaning results are on screen
- **THEN** tiles render thumbnails, orbit, and the lightbox as in any listing

#### Scenario: Relevance order survives
- **WHEN** the index returns hits ordered by score
- **THEN** the grid presents them in that order rather than in name order

#### Scenario: The mode is visible from the grid
- **WHEN** meaning results are on screen and the side panel is collapsed
- **THEN** the user can still tell that the grid holds meaning matches rather than a name search's results

#### Scenario: Name search still answers the input's submit
- **WHEN** the user submits while name mode is in force
- **THEN** a recursive name search runs as before, unaffected by the presence of the index

#### Scenario: Inapplicable options are absent
- **WHEN** meaning mode is in force
- **THEN** options that only govern name matching are not shown, rather than shown with no effect

#### Scenario: Leaving the results restores browsing
- **WHEN** meaning results are shown and the user clears the query or navigates
- **THEN** the ordinary listing for the current path is requested and rendered

### Requirement: The index's absence costs nothing
The client and server SHALL treat the semantic index as an optional, independently-operated service. All access SHALL be from the server, on the user's behalf, and SHALL reach the client only through the existing API client interface. The server SHALL determine availability by probing the index's status endpoint at startup, on failure, and on explicit retry — never once per query — and SHALL distinguish an index that is still loading from one that is not running, so that a service restarting does not read as a service absent. The action SHALL be offered only where it can work: while the index reports itself ready, and while the browsed path lies within the collection the index covers, compared by resolved path so that remounting removable media at a different mount point is not mistaken for a different tree. It SHALL NOT be offered while browsing an archive or a directory inside one, and no archive-relative path SHALL be sent to the index. When the index is unavailable, every other behavior of the app — browsing, name search, thumbnails, the viewer — SHALL be unchanged, and meaning mode SHALL NOT be selectable. A stored or URL-carried selection of meaning mode arriving where the index is unavailable SHALL fall back to name search and SHALL say so, rather than silently answering a different question than the one the URL names. A meaning search that fails SHALL surface its error and SHALL NOT label the unchanged grid as its results.

#### Scenario: Nothing offered when nothing is listening
- **WHEN** the semantic index is not running
- **THEN** the meaning-search action is absent and browsing, name search, and thumbnails behave exactly as they do today

#### Scenario: A restarting index is not a missing one
- **WHEN** the index is running but still loading its model
- **THEN** the app reports it as not yet ready rather than absent, and the action becomes available once it is, without the user reloading

#### Scenario: A shared meaning link on a machine without the index
- **WHEN** a URL naming a meaning search is opened where the index is unavailable
- **THEN** the app falls back to a name search of the same text and says that the meaning results need the index, rather than presenting the fallback as though it were what the URL named

#### Scenario: Out of the indexed collection
- **WHEN** the user browses a directory outside the collection the index covers, or a zip, or a directory inside one
- **THEN** the meaning-search action is not offered there

#### Scenario: The same tree at a new mount point
- **WHEN** the removable volume holding the collection is remounted at a different path and the index reports the new root
- **THEN** browsing that tree still offers meaning search

#### Scenario: A failed meaning search keeps the label truthful
- **WHEN** a meaning search fails while a listing or earlier results are on screen
- **THEN** the error is surfaced and the label continues to describe what is actually shown

### Requirement: Results are assembled from this app's own view of the tree
The server SHALL build tiles for meaning results from its own listing data rather than from the index's description of a model, resolving each hit by its path relative to the collection root. A hit that resolves to nothing on disk SHALL be omitted from the results without failing the search, since the index and this app maintain independent views of the same removable volume and a moved or deleted file is an expected difference rather than an error. Resolution work SHALL be bounded by the number of hits returned, never by the size of the tree: no filesystem walk SHALL be performed to answer a meaning search.

#### Scenario: Tiles carry what tiles need
- **WHEN** meaning results are rendered
- **THEN** each tile has the metadata an ordinary listing entry has, and its thumbnail resolves from the cache exactly as it would in a directory listing

#### Scenario: A stale hit is dropped, not raised
- **WHEN** the index returns a model that has since been moved or deleted
- **THEN** the remaining results are shown normally and no error is presented

#### Scenario: No walk behind a query
- **WHEN** a meaning search runs over a large collection on slow media
- **THEN** the response does not depend on walking the tree, and its cost does not grow with the size of the collection

### Requirement: What the index covers is stated, not implied
The UI SHALL distinguish three outcomes rather than presenting one empty grid: a search that ran against indexed models and matched nothing, a location where nothing has been indexed at all, and a location the index covers only partly. Counts the UI presents SHALL be attributed to the index rather than to the location: how many models under the location the index holds, and how many the last indexing run walked and still found present when the index loaded. Neither SHALL be presented as a claim about how many models the location contains — the second in particular tracks the folder loosely rather than exactly, and can shift when the index reloads — and neither SHALL be combined with the app's own count into a single ratio the grid beside it can contradict. Where the corpus differs from what the grid shows, the UI SHALL say so, taking which formats the index can hold from what the index itself publishes rather than from an assumption compiled in here: models in archives and models in formats the index does not process cannot appear in results, and a location holding only such models SHALL NOT be described as having nothing that matched.

#### Scenario: Nothing matched versus nothing indexed
- **WHEN** a meaning search returns no results in a location with indexed models, and again in a location with none
- **THEN** the first says nothing matched the phrase and the second says nothing here has been indexed yet

#### Scenario: Partly indexed
- **WHEN** results come from a location where the last indexing run saw more models than were indexed
- **THEN** the UI says the results cover part of the location and what would make it complete, without stating a ratio against the location's own contents

#### Scenario: Coverage follows the index, not this app's assumption
- **WHEN** the index reports that it holds a format it did not previously process
- **THEN** the coverage message reflects that without a change here, because the corpus is read from what the index publishes

#### Scenario: A folder the index cannot see
- **WHEN** the user runs a meaning search in a location whose models are all inside archives or in formats the index does not process
- **THEN** the UI explains that those models are outside the index rather than reporting that nothing matched

### Requirement: Weak matches are shown and marked
When the index reports a result set as weak — its best match not standing out from the collection — the client SHALL still present the results, visibly marked as weak, rather than suppressing them. The marking SHALL apply to the set, and per-result strength SHALL be available to the user rather than only to the ranking.

#### Scenario: A weak query still shows its guesses
- **WHEN** a phrase produces no result that stands out from the collection
- **THEN** the matches are shown, marked as weak, and the user can judge them rather than being told nothing matched

### Requirement: A pose orients the model without becoming its stored camera
Where the index supplies an orientation for a model, the client SHALL use it to open that model the right way up: its up axis SHALL correspond to one of the app's six orbit spindles and SHALL be mapped to that spindle directly, and any front-view angles SHALL be applied as the live view's orientation, leaving framing distance and target to the viewer. An up axis that does not correspond to one of the six, or an orientation that is internally inconsistent, SHALL be treated as a fault in the index — the orientation ignored and the model opened as though none were supplied — and SHALL NOT be rounded to the nearest spindle, since rounding would conceal an upstream defect behind a plausible result and then persist it if the user orbited. The orientation presented SHALL be the one the index describes for every up axis it reports, not only for models already modelled about the app's default frame. Where the index supplies an up axis but no front view for it, the client SHALL present the model upright at the index's own stated default starting angle rather than discarding the orientation entirely. An orientation from the index SHALL NOT override an axis the user has already established for that model, and applying one SHALL NOT persist a camera or re-render a stored thumbnail — only the user's own manipulation of the view SHALL do that.

#### Scenario: Opening a model the right way up
- **WHEN** the user opens a model the index has an orientation for and no axis of their own
- **THEN** the model is presented upright at the index's front angles, framed by the viewer as usual

#### Scenario: Every up axis reproduces the same view
- **WHEN** models sharing a front view but modelled about different up axes are opened at the index's orientation
- **THEN** each is presented from the same side of the model, since the index measures its angles about a common up direction and this app measures them about the model's own spindle

#### Scenario: An orientation outside the enumeration is a fault, not a rounding
- **WHEN** the index supplies an up axis that is not one of the six spindles
- **THEN** the model opens without an index orientation and the condition is reported as an index fault, rather than being rounded to the nearest spindle

#### Scenario: The user's own choice wins
- **WHEN** the user has previously established an orbit axis for a model
- **THEN** opening it again uses that axis, not the index's

#### Scenario: An orientation is not a saved camera
- **WHEN** a model is opened at an index-supplied orientation and closed without the user orbiting
- **THEN** no camera is persisted for it and its thumbnail is unchanged

### Requirement: The meaning view is nameable
The client SHALL reflect a committed meaning search in the page URL alongside the browsed path — the phrase as the committed query and the mode as the option that selected it — so that copying the URL reproduces the same view rather than a name search of the same text. Committing and clearing a meaning search SHALL participate in browser history exactly as committing and clearing a name search does — one entry each, restored through the same request path. As with any other view, the URL SHALL name only a view that actually rendered. Opening such a URL where the index is unavailable SHALL show the location's ordinary listing and explain that the results cannot be reproduced without the index, rather than presenting an empty grid or an error page.

#### Scenario: A meaning search is shareable
- **WHEN** meaning results are on screen and the user copies the URL into another tab
- **THEN** the same meaning search is reproduced, not a name search of the same text

#### Scenario: A meaning URL without the index
- **WHEN** such a URL is opened while the index is unavailable
- **THEN** the location's ordinary listing renders and the UI explains that the meaning results need the index
