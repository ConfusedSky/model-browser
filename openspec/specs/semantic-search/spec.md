# semantic-search Specification

## Purpose
TBD - created by archiving change semantic-search. Update Purpose after archive.
## Requirements
### Requirement: Meaning search is a mode of the search input
The client SHALL offer meaning search as a mode the search input runs in, selected by an option carried with the other search options, so that submitting from the input runs whichever search is in force. The option SHALL be sticky per browser profile and carried in the URL under the same rules as the other options that determine which results exist, and changing it while a query is committed SHALL re-run that query in the newly selected mode without the user retyping it. Which mode is in force SHALL be visible without opening the panel, since it is what explains the grid.

The client SHALL also offer the parameters that shape a meaning query: whether the phrase is read as written or expanded into the index's templates, how a model's views are reduced to a single score, and which bounds stop the result set — a minimum score, a number of results, or both together, where the floor applies first and the count caps what survives it. Each SHALL be sticky per profile and carried in the URL under the presence rule the bounds requirement records. A count in force SHALL be presented as showing the strongest matches rather than as truncation: a relevance ranking has no horizon it can run out at, and capping a floor-bounded set is a choice about grid size, not a horizon being reached. Where a count caps a floor-bounded set, the client SHALL say how many models cleared the floor, so a capped view states its own size against the set it was drawn from rather than presenting the cap as the whole answer. That figure SHALL be the index's own count of what passed the floor before the count applied, since the client receives only what survived the count and can neither observe nor estimate it; where the index does not report it, the client SHALL say nothing about it rather than guess. The count SHALL be clamped so that no user-chosen count exceeds the ceiling the index itself returns at — a count that asks for what the index would truncate anyway is not a setting this app presents. Options that do not apply to the mode in force SHALL be hidden rather than shown inert — but the controls that explain the current view SHALL NOT be hidden with them. Where meaning mode is in force and the index cannot answer it, the client SHALL still show which mode is in force, a way to leave it, why it cannot run, and the options that govern the search a submit would actually perform. A mode a user can neither see nor leave is a trap, and a link can put this app in one on a machine that has no index.

Meaning results SHALL replace the grid and SHALL render as an ordinary listing — thumbnails, orbit, lightbox, and camera persistence behave identically, and the in-flight skeleton and latest-wins supersession apply. Results SHALL be presented in the order the index returned them, which is by relevance and is never re-sorted by name. Navigating, toggling flat, or committing another search SHALL supersede them, and clearing the query SHALL restore the ordinary listing for the current path.

The UI SHALL make clear that the grid holds meaning matches for the committed phrase and that they came from the index rather than from the directory listing. Where the index reports that its own ceiling stopped it returning what was asked for, the client SHALL say so, since that bound was not the user's choice and their control is what met it.

#### Scenario: A phrase finds models whose names do not contain it
- **WHEN** the user commits a search in meaning mode for a phrase describing a subject
- **THEN** models matching that description are shown, ranked by relevance, including models whose file names and folders contain none of the words

#### Scenario: A parameter changes the result set
- **WHEN** the user changes how the phrase is read, or how views are pooled, and the query is re-run
- **THEN** the results reflect that setting, and the setting is what a later search in this profile uses

#### Scenario: A count and a floor are one choice
- **WHEN** the user sets both a minimum score and a count
- **THEN** the result set is the strongest models at or above the floor, capped at the count — the two composing rather than one replacing the other, and neither presented as having silently disabled its partner

<!-- The title is stale on purpose and cannot be fixed in passing: this
     scenario's body says the two bounds compose, which is the opposite of what
     its heading says. Renaming it aborts the archive — a MODIFIED block
     replaces a requirement's prose AND its scenarios, and archive refuses to
     drop a scenario the block does not carry, so a rename reads as a deletion
     (tested, 2026-08-27). The requirement-level escape hatch, REMOVE + ADD,
     needs a differently-named requirement, which this one is the capability's
     anchor for. Weighed and declined in
     `openspec/changes/archive/2026-08-28-floor-and-count-compose/specs/semantic-search/spec.md`,
     which carries the full reasoning. The body is what this asserts. -->

#### Scenario: The index's ceiling is reported, the ranking's horizon is not
- **WHEN** a result set is bounded by the user's count, and again when the index's own cap stopped it short
- **THEN** the first is described as the strongest matches and the second says the index returned fewer than was asked for

#### Scenario: A capped view says what it was drawn from
- **WHEN** a meaning search is bounded by both a floor and a count, and more models clear the floor than the count admits
- **THEN** the view says how many cleared the floor alongside the results it shows, rather than presenting the capped set as everything above the floor

#### Scenario: A count past the ceiling is not offered
- **WHEN** the user enters a count greater than the index's own return cap
- **THEN** the field holds the clamped value rather than the typed one, since a count above the ceiling names a result set the index cannot answer

#### Scenario: A tuned result set reproduces from its URL
- **WHEN** a user shares the URL of a meaning search run under non-default parameters
- **THEN** the recipient sees the same result set, under the sender's parameters rather than their own

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

#### Scenario: An unrunnable mode still explains itself
- **WHEN** meaning mode is in force on a machine where the index is not running
- **THEN** the search controls show that mode, why it cannot run, a way back to name search, and the options governing the search a submit would perform — rather than hiding everything that does not apply to a mode that cannot run

#### Scenario: Inapplicable options are absent
- **WHEN** meaning mode is in force
- **THEN** options that only govern name matching are not shown, rather than shown with no effect

#### Scenario: Leaving the results restores browsing
- **WHEN** meaning results are shown and the user clears the query or navigates
- **THEN** the ordinary listing for the current path is requested and rendered

### Requirement: The index's absence costs nothing
The client and server SHALL treat the semantic index as an optional, independently-operated service. All access SHALL be from the server, on the user's behalf, and SHALL reach the client only through the existing API client interface. The server SHALL determine availability by probing the index's status endpoint at startup, on failure, and on explicit retry — never once per query — and SHALL distinguish an index that is still loading from one that is not running, so that a service restarting does not read as a service absent. It SHALL likewise distinguish an index that is running but whose library storage is unavailable, since that is a condition the user can repair immediately and reporting it as an absent service would hide the repair. It SHALL for the same reason distinguish an index that is running but does not cover the browsed location — a directory outside its collection, or any archive interior — from one that is not running at all: a healthy service reported as stopped sends the user to start something already running, and the remedies differ. Where the location is merely outside the collection, the explanation SHALL name the collection the index does cover, since "not here" is only actionable beside "there". Where the index states a reason or a remedy, the client SHALL prefer it to a message composed here. The action SHALL be offered only where it can work: while the index reports itself ready, and while the browsed path lies within the collection the index covers, compared by resolved path so that remounting removable media at a different mount point is not mistaken for a different tree. It SHALL NOT be offered while browsing an archive or a directory inside one, and no archive-relative path SHALL be sent to the index. When the index is unavailable, every other behavior of the app — browsing, name search, thumbnails, the viewer — SHALL be unchanged, and meaning mode SHALL NOT be selectable. A search asked for in meaning mode where the index cannot answer SHALL be **deferred, not substituted**: the client SHALL keep naming the requested view, SHALL present the location's ordinary listing meanwhile, SHALL say which of the two is on screen, and SHALL run the query once the index becomes available. It SHALL offer a name search of the same text as an explicit choice rather than performing one, since substituting the corpus is only honest when it was asked for. Rewriting the request out of the view's name SHALL NOT happen on the app's own initiative: a link that named a meaning search must still name one after being opened without an index, or it cannot be retried, reloaded, or passed on. A meaning search that fails SHALL surface its error and SHALL NOT label the unchanged grid as its results.

#### Scenario: Nothing offered when nothing is listening
- **WHEN** the semantic index is not running
- **THEN** the meaning-search action is absent and browsing, name search, and thumbnails behave exactly as they do today

#### Scenario: A restarting index is not a missing one
- **WHEN** the index is running but still loading its model
- **THEN** the app reports it as not yet ready rather than absent, and the action becomes available once it is, without the user reloading

#### Scenario: A shared meaning link on a machine without the index
- **WHEN** a URL naming a meaning search is opened where the index is unavailable
- **THEN** the location's ordinary listing is shown, the URL still names the meaning search, and the UI says the results are waiting on the index rather than presenting what is on screen as though it were what the URL named

#### Scenario: The link does what it named once the index answers
- **WHEN** the index becomes available while such a view is open
- **THEN** the deferred query runs and its results replace the grid, without the user retyping or reloading

#### Scenario: The corpus is named, not inferred
- **WHEN** a search committed in one profile is opened in another whose default mode differs
- **THEN** it runs against the corpus the sender used, because a committed query names its corpus in the URL rather than leaving it to the reader's default

#### Scenario: The index is up but its library is unplugged
- **WHEN** the index reports itself running with its collection's storage unavailable
- **THEN** the app says the library's storage is missing rather than reporting the index as absent, so the user can plug it in rather than go looking for a stopped service

#### Scenario: Out of the indexed collection
- **WHEN** the user browses a directory outside the collection the index covers, or a zip, or a directory inside one
- **THEN** the meaning-search action is not offered there, and any explanation the app gives says the index is running and does not cover this location — naming the covered collection where the location is merely outside it — rather than reporting the index as not running or advising that it be started

#### Scenario: The same tree at a new mount point
- **WHEN** the removable volume holding the collection is remounted at a different path and the index reports the new root
- **THEN** browsing that tree still offers meaning search

#### Scenario: A failed meaning search keeps the label truthful
- **WHEN** a meaning search fails while a listing or earlier results are on screen
- **THEN** the error is surfaced and the label continues to describe what is actually shown

### Requirement: Results are assembled from this app's own view of the tree
The server SHALL build tiles for meaning results from its own listing data rather than from the index's description of a model, resolving each hit by its path relative to the collection root and naming the tile by the resulting library-relative path (see `library`). A hit that resolves to nothing on disk SHALL be omitted from the results without failing the search, since the index and this app maintain independent views of the same removable volume and a moved or deleted file is an expected difference rather than an error. A collection root that lies outside the library SHALL be treated as covering nothing: no scope within the library is offered to it, and the UI SHALL state that the index covers a location outside the library rather than naming a path the user cannot navigate to. Resolution work SHALL be bounded by the number of hits returned, never by the size of the tree: no filesystem walk SHALL be performed to answer a meaning search.

#### Scenario: Tiles carry what tiles need
- **WHEN** meaning results are rendered
- **THEN** each tile has the metadata an ordinary listing entry has, is addressed by a library-relative path, and its thumbnail resolves from the cache exactly as it would in a directory listing

#### Scenario: A stale hit is dropped, not raised
- **WHEN** the index returns a model that has since been moved or deleted
- **THEN** the remaining results are shown normally and no error is presented

#### Scenario: No walk behind a query
- **WHEN** a meaning search runs over a large collection on slow media
- **THEN** the response does not depend on walking the tree, and its cost does not grow with the size of the collection

#### Scenario: The index covers a subtree of the library
- **WHEN** the index's collection root is a directory beneath the library's top
- **THEN** hits are named by their library-relative paths, and the UI names the covered subtree as a library path

#### Scenario: The index covers something outside the library
- **WHEN** the index's collection root resolves outside the library
- **THEN** meaning search is unavailable at every location, and the UI says the index covers a location outside the library

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
When the index reports a result set as weak — its best match not standing out from the collection — the client SHALL still present the results, visibly marked as weak, rather than suppressing them. The marking SHALL apply to the **set**, and SHALL remain a statement about the set even where per-result numbers are shown beside the tiles: a weak set stays marked weak whatever any single tile reports, since the verdict is read off the best result before any cut and no per-tile number restates it. The ranking SHALL continue to express relative strength within a set, so that a set is judgeable with every number ignored. The client's earlier prohibition on presenting a per-result score or z value is lifted: the objection it rested on is that scores from different routes come from different distributions, and that is answered by naming the scale on the badge rather than by withholding the number — the requirement below states how.

#### Scenario: A weak query still shows its guesses
- **WHEN** a phrase produces no result that stands out from the collection
- **THEN** the matches are shown, marked as weak, and the user can judge them rather than being told nothing matched

#### Scenario: Strength is the order, not a number on the tile
- **WHEN** results of any kind are presented
- **THEN** their order expresses their relative strength on its own, and any per-result numbers drawn beside them add to that order rather than replace it — removing every number would leave the set still readable, and the numbers never reorder it

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
The client SHALL reflect a committed meaning search in the page URL alongside the browsed path — the phrase as the committed query and the mode as the option that selected it — so that copying the URL reproduces the same view rather than a name search of the same text. Committing and clearing a meaning search SHALL participate in browser history exactly as committing and clearing a name search does — one entry each, restored through the same request path. As with any other view, the URL SHALL name only a view that actually rendered — with one exception, stated because it is the whole point of the deferral: a meaning view the app has been asked for and cannot yet render keeps its name while the ordinary listing stands in for it, and the UI says so. The alternative is worse than an inaccurate URL, because rewriting the name discards the request itself. Opening such a URL where the index is unavailable SHALL therefore show the location's ordinary listing, keep naming the meaning search, and explain that its results are waiting on the index, rather than presenting an empty grid or an error page.

#### Scenario: A meaning search is shareable
- **WHEN** meaning results are on screen and the user copies the URL into another tab
- **THEN** the same meaning search is reproduced, not a name search of the same text

#### Scenario: A meaning URL without the index
- **WHEN** such a URL is opened while the index is unavailable
- **THEN** the location's ordinary listing renders and the UI explains that the meaning results need the index

### Requirement: A deferred meaning search belongs to its view

A meaning query held for a warming or absent index SHALL remain bound to the view that deferred it: it SHALL run when the index becomes ready only if that view is still the one on screen, and it SHALL be cancelled — silently and completely, banner and URL included — when the user moves on by navigating, emptying the search input, or searching by name. Flipping the search mode to meaning while the index is not ready SHALL defer the committed query exactly as submitting it would, never substitute a name search for it. While a deferral waits, the stand-in listing shown in its place SHALL be the ordinary nested listing for the current path, whatever flat shape the deferred search's URL names.

#### Scenario: Navigation cancels the deferral

- **WHEN** a meaning query is deferred and the user navigates to another folder
- **THEN** the deferral is cancelled — when the index later becomes ready, no query fires, no view is replaced, and no URL is rewritten

#### Scenario: Emptying the input cancels the deferral

- **WHEN** a meaning query is deferred and the user clears the search input
- **THEN** the deferred-search banner disappears, the URL stops naming the search, and the index becoming ready runs nothing

#### Scenario: A name search cancels the deferral

- **WHEN** a meaning query is deferred and the user submits a name search
- **THEN** the name results stand and the index becoming ready does not replace them

#### Scenario: The deferral fires only for the view that made it

- **WHEN** the index becomes ready while the view that deferred a meaning query is still on screen
- **THEN** the query runs for that view's path and options — and only then

#### Scenario: Mode flip while unready defers like submit

- **WHEN** a query is committed and the user flips the mode to meaning while the index is not ready
- **THEN** the query is deferred under the meaning mode — the URL names a meaning search and the banner explains the wait — rather than a name search running in its place

#### Scenario: Nothing is fetched while the index is being asked

- **WHEN** a meaning URL is opened and the index has not yet answered the availability probe
- **THEN** no listing is requested in the meantime and the view reads as loading — the probe's answer decides whether the query runs or defers behind a stand-in

#### Scenario: The stand-in listing is nested

- **WHEN** a deferred meaning view is restored from history or a link and a stand-in listing is fetched while the index warms
- **THEN** the stand-in is the nested listing for the path, not a flat walk of it — the URL's flat shape belongs to the search being deferred, not to the placeholder

### Requirement: A scored result shows its two numbers under the scale they came from
Where results came from a scored query, the client SHALL present the index's two per-result numbers — the pooled cosine and the robust z — on each result's tile and in the lightbox's info panel for a model opened from that result. Both SHALL be the index's own values, presented as the index reports them: they SHALL NOT be rescaled, banded, or otherwise recomputed here, since a number this app derived would not be the number the index's own thresholds are stated against. Rounding a value to the places it is displayed at is not such a recomputation and is required below; where that rounding leaves a sign qualifying no surviving digit, the sign SHALL be dropped, since it reports a precision the displayed value does not carry.

The cosine SHALL be labelled by the route that produced it — as `k` for a meaning search and as `sim` for a similarity view — because cosines from the two routes come from measurably different distributions (model-to-model 0.85–0.99 against text-query ~0.1) and an unlabelled number invites a comparison across them that neither supports. The z SHALL be labelled `z` in both, being comparable across queries by construction. The cosine SHALL be shown to three decimal places and the z to two.

On a tile the cosine SHALL occupy the top-left corner over the thumbnail and the z the top-right, and both SHALL be visible without hover, selection, or a setting to enable them. They SHALL be drawn over the rendered image and SHALL NOT be rendered into it, so that no cached thumbnail is invalidated by their presence or absence.

Where a surface is drawn *over* a scored tile — the orbit overlay a press promotes to — the numbers SHALL remain visible on top of it, since a press is not a request to stop seeing them and the thing being turned is the very model they describe. They SHALL NOT move when it appears: they annotate the same tile before and after, and a number that jumps as the model is grasped reads as a different number. They SHALL, however, stay beneath the surfaces that are meant to cover a tile entirely — the lightbox and the entry menu — which replace it rather than sit within it.

Both numbers SHALL also be carried by the tile's accessible name, since a tile states its accessible name rather than composing it from what it contains, and a number drawn inside it would otherwise be presented to everyone except a user who cannot see it. There the scale SHALL be named in full rather than by the short label the corner carries — a single letter being legible in a grid whose view says what produced it, and not legible read aloud on its own.

Tiles that did not come from a scored query SHALL show neither number and SHALL reserve no space for them, an ordinary directory listing being unchanged by this requirement. A similarity view's anchor — the model its neighbours were computed from — SHALL show neither number, the index having excluded it from its own ranking rather than scored it. A result the server could not resolve on disk contributes neither a tile nor a number, the two being keyed alike.

#### Scenario: A meaning result carries its numbers
- **WHEN** a meaning search returns results
- **THEN** each tile shows the pooled cosine labelled `k` in its top-left corner to three decimals and the robust z labelled `z` in its top-right to two, both visible without hovering the tile

#### Scenario: A neighbour's number is labelled as a neighbour's
- **WHEN** a similarity view's results are shown, whose cosines run far higher than a meaning search's
- **THEN** the cosine is labelled `sim` rather than `k`, at its own unaltered value, so it does not read as a stronger match than a meaning result's lower number

#### Scenario: The numbers are announced, not only drawn
- **WHEN** a scored result's tile is reached without seeing it
- **THEN** its accessible name carries both numbers with their scales named in full, rather than naming the model alone and leaving the corners unread

#### Scenario: Turning a model does not hide what it scored
- **WHEN** the user presses a scored tile and orbits it in place
- **THEN** the numbers stay visible above the model being turned, in the same place they occupied before the press

#### Scenario: A surface that replaces the tile still covers it
- **WHEN** the model is opened in the lightbox, or the entry menu is raised over its tile
- **THEN** that surface covers the tile's numbers rather than being pierced by them, the tile's own corners being no longer what the user is looking at

#### Scenario: Ordinary browsing shows no numbers
- **WHEN** the user browses a directory, a flat search, or a zip's contents
- **THEN** no tile shows either number and no space is held for them, the tiles being identical to what they were before this change

#### Scenario: The anchor is the question, not an answer
- **WHEN** a similarity view is shown with its anchor model beside the neighbours
- **THEN** the neighbours carry their numbers and the anchor carries none

#### Scenario: The panel says what the tile said
- **WHEN** the user opens a scored result in the lightbox
- **THEN** the info panel presents the same two values under the same labels as that result's tile, and a model opened from an unscored listing shows neither row

#### Scenario: A number is never baked into a thumbnail
- **WHEN** a model appears first in a meaning search and later in a plain directory listing
- **THEN** its thumbnail is the same cached image in both, carrying no trace of the badges, and re-rendering was not triggered by the difference

#### Scenario: A stale hit takes its number with it
- **WHEN** the index returns a model that no longer exists on disk
- **THEN** the hit produces no tile and no number, exactly as the tree-resolution requirement already drops it, and the remaining results keep the numbers the index gave them

### Requirement: Which bounds are in force is recorded by presence
A meaning search SHALL be bounded by a minimum score, a count, or both together, the floor applying first and the count capping what survives it. Both SHALL be in force when the user has chosen neither: the floor at the level the index's own published measurement puts text-query scores at, the count at the default the grid has always been sized for — the resting state of the controls and the meaning of an unadorned link being one and the same. Each bound SHALL be settable independently, and turning one off SHALL NOT change the other's value.

Every record of a view — a link, a stored profile — SHALL be read under one rule: a bound named in a record is in force, and a bound absent from it is not in force, never merely sitting at its default. That rule SHALL govern the URL, the stored profile, and the live state alike. A record naming neither bound SHALL be read as both bounds at their defaults, which is the single state absence does not describe and the reason a record may omit a bound it is under: a writer MAY leave both bounds unnamed where both are in force at their default values, since that record reads back as exactly the view it was written from. Every other bound in force SHALL be named, at its own default value or not.

A stored profile SHALL be read under the presence rule regardless of what its writer meant: a profile whose floor is recorded as absent names a count-only choice whether it was written as one or inherited from before the floor existed, and a profile carrying both bounds reads as both — the reading of last resort where old bytes cannot say which of the two their owner saw, being the state the defaults now name.

Where the index's own ceiling stops a bounded set short, the client SHALL say so, as it does for any bound the index's ceiling stops short.

#### Scenario: An unadorned meaning search is floored and capped
- **WHEN** a user who has set no bound of their own commits a meaning search
- **THEN** the results are the strongest models at or above the default floor, capped at the default count, rather than an unbounded floor set or a count carrying weak matches

#### Scenario: One bound can be sent away without the other
- **WHEN** the user switches from both bounds to the floor alone
- **THEN** the result set grows to everything above the floor, and the count the user had set is offered back unchanged when they switch it on again rather than being replaced by the default — for as long as the view is open, a bound out of force having no record of its own to survive in

#### Scenario: A record carries each bound it is under
- **WHEN** a meaning search is bounded by the floor alone, the count alone, or by both at values not all their defaults, and its URL is shared or its parameters are stored
- **THEN** the record names the bounds in force — a floor-only view's link names no count, and a count-only view's link names no floor — and the recipient's or the returning user's view is bounded as the sender's was, including where a bound in force sits at its own default value

#### Scenario: A link that names no bound reads as the defaults
- **WHEN** a link names a meaning option that is not a bound — how the phrase is read, or how its views are pooled — and the app rewrites that URL in place, as it does when a lightbox closes over it
- **THEN** the rewritten link still names no bound, and the search it names stays bounded by both at their defaults rather than acquiring a bound nobody chose

#### Scenario: A profile written before the bounds composed is not promoted to a choice
- **WHEN** a profile stored under the one-bound encoding is read back
- **THEN** its recorded bounds are read by presence — an absent floor meaning no floor, a chosen count staying a count — rather than being reinterpreted by rules about what the profile's writer probably meant

#### Scenario: The floor's default reaches the index's own ceiling
- **WHEN** a floor-only search matches more models than the index will return
- **THEN** the client says the index returned fewer than was asked for, rather than presenting the set as complete

### Requirement: The index's orientations reach every listing
Where the index is ready and covers the browsed location, the client SHALL be able to obtain the index's orientation for **the models a listing landed** — every shape of listing, plain, flat or name-search, and not only search results — by naming those models: through an endpoint that takes a batch of library paths and answers their poses keyed by library path, mapping and confining each path exactly as search hits are mapped and confined, and refusing nothing silently beyond leaving an unanswerable path out of its answer. A per-directory form of the same question MAY remain for a directory-shaped ask, but it SHALL NOT be what a listing's poses are obtained through: a flat listing's models live in subfolders and a name search's are drawn from a whole subtree, so a directory's direct children are neither the models on screen nor a subset of them. A listing itself SHALL NOT depend on the index: the listing request carries no poses and waits for none, poses arrive as their own request afterwards, and an index that is absent, warming, or does not cover the location answers as it answers a search — which the client SHALL treat as "no poses", leaving every tile exactly as it renders today. Poses obtained this way SHALL flow into the same client state a search's riding poses populate, so the thumbnail sweep re-evaluates displayed tiles by value, keeps each image until its replacement exists, and re-renders only tiles whose orientation actually arrived or changed, under the recipe labels and applied-only staleness the thumbnail requirements already define.

#### Scenario: A plain listing stands its models up
- **WHEN** a directory is listed while the index is ready and covers it, and the poses request answers
- **THEN** unowned models whose cached thumbnails were drawn without the index's orientation re-render posed, each keeping its image until the replacement lands, and models with a stored camera or axis are untouched

#### Scenario: A flat listing stands its models up too
- **WHEN** a flat listing or a name search lands, its models drawn from folders below the one it was run at
- **THEN** its entries' poses are asked for by path and applied exactly as a plain listing's are — the same second wave, the same merge, the same by-value re-evaluation — rather than the poses of the models sitting directly in the folder the listing was run at

#### Scenario: The index's absence costs the listing nothing
- **WHEN** a directory is listed while the index is absent, warming, or does not cover it
- **THEN** the listing renders exactly as it does today — no poses, default framing for unowned models, no error and no delay attributable to the index

#### Scenario: A pose wave does not reset the grid
- **WHEN** the poses answer arrives after a listing's tiles are already displayed
- **THEN** every tile keeps its image while any re-render it caused resolves, and a tile whose pose matches what its pixels were already drawn under issues nothing

### Requirement: Where the index is not the viewer's to operate, its states collapse
Where a deployment declares that the machine it runs on is not the viewer's concern (see
`feature-report`) — the same declaration that stops any surface naming a host location or
offering an operator's remedy, since an index condition is named by its remedy — the
distinctions *The index's absence costs nothing*
draws between index conditions SHALL be presented to the viewer as a single
unavailability. Those distinctions exist because each names a different repair — start
the service, plug the volume in, restart the wedged process — and a viewer of such a
deployment can make none of them, so naming them offers a remedy that is not theirs and
describes the operator's machine to a stranger. The states SHALL still be distinguished
*within* the server, since the operator's own diagnosis depends on them; only what the
viewer is told collapses.

A condition that resolves on its own SHALL NOT collapse: an index still loading SHALL
continue to be presented as not yet ready, and SHALL become available without the viewer
reloading, exactly as it does today. A deployment's own start is a real wait, and telling
a viewer to come back is honest where telling them to start a service is not.

The base requirement's rule that the client SHALL prefer an explanation the index itself
states to one composed here SHALL be suspended for the collapsed states, and any such
explanation SHALL be withheld rather than printed beside the collapsed sentence: that text
is the index's own, can name its cache directory or its collection root, and would restore
in a detail line exactly what the collapse removed from the sentence. It SHALL continue to
be preferred wherever a state is not collapsed. Likewise, guidance to run the classifier
over an unembedded model SHALL NOT be given, since running it is an operator's act.

Where the location is outside the collection the index covers, that SHALL continue to be
distinguished from the index being unavailable, since it is a fact about where the viewer
is browsing rather than about the operator's machine, and the viewer can act on it by
browsing elsewhere.

#### Scenario: A viewer is not sent to fix a machine they cannot reach
- **WHEN** the index is not running, or its storage is unavailable, or it is wedged, on such a deployment
- **THEN** the viewer is told meaning search is unavailable, without being told which of those it is or what to start

#### Scenario: Still loading is still said
- **WHEN** the index is loading on such a deployment
- **THEN** the viewer is told it is not yet ready, and meaning search becomes available once it is, without a reload

#### Scenario: Outside the collection still says so
- **WHEN** a viewer browses a location the index does not cover on such a deployment
- **THEN** they are told the index does not cover this location, as they are today

#### Scenario: The index's own words do not leak the collapse open
- **WHEN** the index supplies a reason or hint for a collapsed condition
- **THEN** it is withheld rather than shown beside the collapsed sentence, while an uncollapsed state still prefers the index's own words

#### Scenario: A viewer is not told to run the classifier
- **WHEN** a viewer asks for models similar to one the index has no embedding for
- **THEN** they are told it has none, without being told to run the classifier over it

#### Scenario: The operator still sees the difference
- **WHEN** the server determines the index's condition on such a deployment
- **THEN** it distinguishes the conditions internally as it does today, and only the viewer-facing account collapses

#### Scenario: An ordinary deployment is unchanged
- **WHEN** a deployment does not declare this
- **THEN** every index condition is reported to the user exactly as it is today

