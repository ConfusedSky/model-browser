## MODIFIED Requirements

### Requirement: What the index covers is stated, not implied
The UI SHALL distinguish three outcomes rather than presenting one empty grid: a search that ran against indexed models and matched nothing, a location where nothing has been indexed at all, and a location the index covers only partly. Counts the UI presents SHALL be attributed to the index rather than to the location: how many models under the location the index holds, and how many the last indexing run walked and still found present when the index loaded. Neither SHALL be presented as a claim about how many models the location contains — the second in particular tracks the folder loosely rather than exactly, and can shift when the index reloads — and neither SHALL be combined with the app's own count into a single ratio the grid beside it can contradict. The two MAY be stated together as how many of the models the indexing run found here are indexed ("N of M models here are indexed"), since both are the index's own counts and the grid's count is in neither. Where the corpus differs from what the grid shows, the UI SHALL say so, taking which formats the index can hold from what the index itself publishes rather than from an assumption compiled in here: models in archives and models in formats the index does not process cannot appear in results, and a location holding only such models SHALL NOT be described as having nothing that matched.

#### Scenario: Nothing matched versus nothing indexed
- **WHEN** a meaning search returns no results in a location with indexed models, and again in a location with none
- **THEN** the first says nothing matched the phrase and the second says nothing here has been indexed yet

#### Scenario: Partly indexed
- **WHEN** results come from a location where the last indexing run saw more models than were indexed
- **THEN** the UI says the results cover part of the location and what would make it complete, stating at most how many of the models the indexing run found are indexed, and never a ratio against the app's own count of the location's contents

#### Scenario: Coverage follows the index, not this app's assumption
- **WHEN** the index reports that it holds a format it did not previously process
- **THEN** the coverage message reflects that without a change here, because the corpus is read from what the index publishes

#### Scenario: A folder the index cannot see
- **WHEN** the user runs a meaning search in a location whose models are all inside archives or in formats the index does not process
- **THEN** the UI explains that those models are outside the index rather than reporting that nothing matched

### Requirement: Meaning search is a mode of the search input
The client SHALL offer meaning search as a mode the search input runs in, selected by an option carried with the other search options, so that submitting from the input runs whichever search is in force — save that a query whose shape plainly belongs to the other corpus is asked of that corpus instead (see *A query that plainly belongs to the other corpus is asked of it until its results are left*). The option SHALL be sticky per browser profile and carried in the URL under the same rules as the other options that determine which results exist, and changing it while a query is committed SHALL re-run that query in the newly selected mode without the user retyping it. Which mode is in force SHALL be visible without opening the panel, since it is what explains the grid.

The client SHALL also offer the parameters that shape a meaning query: whether the phrase is read as written or expanded into the index's templates, how a model's views are reduced to a single score, and which bounds stop the result set — a minimum score, a number of results, or both together, where the floor applies first and the count caps what survives it. Each SHALL be sticky per profile and carried in the URL under the presence rule the bounds requirement records. A count in force SHALL be presented as showing the strongest matches rather than as truncation: a relevance ranking has no horizon it can run out at, and capping a floor-bounded set is a choice about grid size, not a horizon being reached. Where a count caps a floor-bounded set that is not weak, the client SHALL say how many models cleared the floor — a weak set's count being given to its weakness instead (see *Weak matches are shown and marked*) — so a capped view states its own size against the set it was drawn from rather than presenting the cap as the whole answer. That figure SHALL be the index's own count of what passed the floor before the count applied, since the client receives only what survived the count and can neither observe nor estimate it; where the index does not report it, the client SHALL say nothing about it rather than guess. The count SHALL be clamped so that no user-chosen count exceeds the ceiling the index itself returns at — a count that asks for what the index would truncate anyway is not a setting this app presents. Options that do not apply to the mode in force SHALL be hidden rather than shown inert — but the controls that explain the current view SHALL NOT be hidden with them. Where meaning mode is in force and the index cannot answer it, the client SHALL still show, with the search input, which mode is in force and a way to leave it, and, in the side panel's search tab one press away, why it cannot run and the options that govern the search a submit would actually perform. A mode a user can neither see nor leave is a trap, and a link can put this app in one on a machine that has no index.

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
- **WHEN** the user submits text of neither shape the other corpus claims while name mode is in force
- **THEN** a recursive name search runs as before, unaffected by the presence of the index

#### Scenario: An unrunnable mode still explains itself
- **WHEN** meaning mode is in force on a machine where the index is not running
- **THEN** the search input shows that mode and a way back to name search, and the side panel's search tab says why it cannot run and shows the options governing the search a submit would perform — rather than hiding everything that does not apply to a mode that cannot run

#### Scenario: Inapplicable options are absent
- **WHEN** meaning mode is in force
- **THEN** options that only govern name matching are not shown, rather than shown with no effect

#### Scenario: Leaving the results restores browsing
- **WHEN** meaning results are shown and the user clears the query or navigates
- **THEN** the ordinary listing for the current path is requested and rendered

### Requirement: The index's absence costs nothing
The client and server SHALL treat the semantic index as an optional, independently-operated service. All access SHALL be from the server, on the user's behalf, and SHALL reach the client only through the existing API client interface. The server SHALL determine availability by probing the index's status endpoint at startup, on failure, and on explicit retry — never once per query — and SHALL distinguish an index that is still loading from one that is not running, so that a service restarting does not read as a service absent. It SHALL likewise distinguish an index that is running but whose library storage is unavailable, since that is a condition the user can repair immediately and reporting it as an absent service would hide the repair. It SHALL for the same reason distinguish an index that is running but does not cover the browsed location — a directory outside its collection, or any archive interior — from one that is not running at all: a healthy service reported as stopped sends the user to start something already running, and the remedies differ. Where the location is merely outside the collection, the explanation SHALL name the collection the index does cover, since "not here" is only actionable beside "there". Where the index states a reason or a remedy, the client SHALL prefer it to a message composed here. The action SHALL be offered only where it can work: while the index reports itself ready, and while the browsed path lies within the collection the index covers, compared by resolved path so that remounting removable media at a different mount point is not mistaken for a different tree. It SHALL NOT be offered while browsing an archive or a directory inside one, and no archive-relative path SHALL be sent to the index. When the index is unavailable, every other behavior of the app — browsing, name search, thumbnails, the viewer — SHALL be unchanged, and meaning mode SHALL NOT be selectable. A search asked for in meaning mode where the index cannot answer SHALL be **deferred, not substituted** — a query shaped like a file name excepted, which is asked of the names rather than of the index whether or not the index can answer, being no meaning search at all (see *A query that plainly belongs to the other corpus is asked of it until its results are left*): the client SHALL keep naming the requested view, SHALL present the location's ordinary listing meanwhile, SHALL say which of the two is on screen, and SHALL run the query once the index becomes available. It SHALL offer a name search of the same text as an explicit choice rather than performing one, since substituting the corpus is only honest when it was asked for. Rewriting the request out of the view's name SHALL NOT happen on the app's own initiative: a link that named a meaning search must still name one after being opened without an index, or it cannot be retried, reloaded, or passed on. A meaning search that fails SHALL surface its error and SHALL NOT label the unchanged grid as its results.

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

#### Scenario: A file name is not deferred
- **WHEN** meaning mode is in force where the index is unavailable and the user submits `knight_32mm.stl`
- **THEN** a name search runs at once and nothing is deferred, since the query was never a meaning search

### Requirement: Weak matches are shown and marked
A meaning result set SHALL be treated as **weak** when the index reports it weak — its best match not standing out from the collection — **or** when its best robust z falls below 2.5, since the index's flag does not fire for every phrase that matches nothing and a best that low reads as a guess whatever the flag says. The client SHALL still present a weak set rather than suppress it, and SHALL change the page's shape to say what it is: the results line's count SHALL say that nothing matched strongly in place of a number of matches; the grid SHALL show a first dozen guesses until the user asks for the rest with a control naming how many the index returned; and the note beneath SHALL say that nothing stood out and gather the ways onward — showing all, the names (see *Names are counted beside a meaning search*), and, from a folder below the library's top where meaning search can run at the top, the same phrase over the whole library. The names SHALL be offered as a way out until a count has said there are none.

A set that is not weak but whose best robust z is below 3.6 is **modest**: its count SHALL call its results fair matches rather than the closest ones, and no result in it SHALL be given a strength word above Fair (see *A scored result shows its two numbers under the scale they came from*), so a guess never wears "good match".

The marking SHALL apply to the **set**, and SHALL remain a statement about the set even where per-result numbers are shown beside the tiles: a weak set stays marked weak whatever any single tile reports, since the verdict is read off the best result before any cut and no per-tile number restates it. The ranking SHALL continue to express relative strength within a set, so that a set is judgeable with every number ignored. Per-result numbers MAY be presented beside that marking: that scores from different routes come from different distributions is answered by naming the scale on the badge rather than by withholding the number — the requirement below states how.

#### Scenario: A weak query still shows its guesses
- **WHEN** a phrase produces no result that stands out from the collection
- **THEN** the matches are shown, marked as weak, and the user can judge them rather than being told nothing matched

#### Scenario: Strength is the order, not a number on the tile
- **WHEN** results of any kind are presented
- **THEN** their order expresses their relative strength on its own, and any per-result numbers drawn beside them add to that order rather than replace it — removing every number would leave the set still readable, and the numbers never reorder it

#### Scenario: A weak set shows a dozen until asked
- **WHEN** a meaning search the index flags weak returns forty results
- **THEN** the count reads "No strong matches", the grid shows the first twelve, and "Show all 40" shows the rest and moves focus onto the first of them

#### Scenario: A low best is weak without the flag
- **WHEN** the index does not flag a set weak but its best z is under 2.5
- **THEN** the set is presented as weak exactly as a flagged one is

#### Scenario: A weak set points onward
- **WHEN** a weak set is on screen in a folder below the library's top
- **THEN** its note offers to show all, to search names instead — or to see the name matches, counted, where a count found some — and to search the whole library

#### Scenario: A middling best is only fair
- **WHEN** a set is not weak and its best z is 3.2
- **THEN** its count calls its results fair matches and no result in it is called better than Fair

### Requirement: A scored result shows its two numbers under the scale they came from
Where results came from a scored query, the client SHALL be able to present the index's two per-result numbers — the pooled cosine and the robust z — on each result's tile and in the lightbox's info panel for a model opened from that result. Both SHALL be the index's own values, presented as the index reports them: they SHALL NOT be rescaled, banded, or otherwise recomputed here, since a number this app derived would not be the number the index's own thresholds are stated against. Rounding a value to the places it is displayed at is not such a recomputation and is required below; where that rounding leaves a sign qualifying no surviving digit, the sign SHALL be dropped, since it reports a precision the displayed value does not carry.

The numbers SHALL be drawn only while the profile's **Show match scores** preference is on. That preference SHALL be off for a profile that has not chosen, SHALL persist per browser profile, and SHALL be offered in the side panel's display options; it SHALL NOT enter the URL, since it changes how results are drawn and not which exist. Whether or not the numbers are drawn, each scored result SHALL also carry a relevance bar along the foot of its picture, whose length grows with the z, and a **strength word** read from the z: Strong at 4 or above, Good at 3 or above, Fair at 2 or above, Weak below, with nothing above Fair in a modest set (see *Weak matches are shown and marked*). The word is this app's reading of the index's number against fixed bands and SHALL NOT be presented as a number or as the index's own verdict; it SHALL be carried by the tile's tooltip always, by its accessible name while the numbers are not drawn, and by the lightbox panel's `match` row, which is shown for a scored result whether or not the numbers are.

The cosine SHALL be labelled by the route that produced it — as `k` for a meaning search and as `sim` for a similarity view — because cosines from the two routes come from measurably different distributions (model-to-model 0.85–0.99 against text-query ~0.1) and an unlabelled number invites a comparison across them that neither supports. The z SHALL be labelled `z` in both, being comparable across queries by construction. The cosine SHALL be shown to three decimal places and the z to two.

On a tile, where the numbers are drawn, the cosine SHALL occupy the bottom-left of the picture and the z the bottom-right, clear of the tile's actions control at the top. They SHALL be drawn over the rendered image and SHALL NOT be rendered into it, so that no cached thumbnail is invalidated by their presence or absence; the relevance bar SHALL be drawn over the image likewise.

Where a surface is drawn *over* a scored tile — the orbit overlay a press promotes to — the numbers, where drawn, SHALL remain visible on top of it, since a press is not a request to stop seeing them and the thing being turned is the very model they describe. They SHALL NOT move when it appears: they annotate the same tile before and after, and a number that jumps as the model is grasped reads as a different number. They SHALL, however, stay beneath the surfaces that are meant to cover a tile entirely — the lightbox and the entry menu — which replace it rather than sit within it.

Whatever is drawn SHALL also be carried by the tile's accessible name, since a tile states its accessible name rather than composing it from what it contains: the strength word by default, and both numbers in its place where they are drawn, the scale named in full rather than by the short label the picture carries — a single letter being legible in a grid whose view says what produced it, and not legible read aloud on its own.

Tiles that did not come from a scored query SHALL show neither number, no bar and no word, and SHALL reserve no space for them, an ordinary directory listing being unchanged by this requirement. A similarity view's anchor — the model its neighbours were computed from — SHALL show none of them, the index having excluded it from its own ranking rather than scored it. A result the server could not resolve on disk contributes neither a tile nor a number, the two being keyed alike.

#### Scenario: A meaning result carries its numbers
- **WHEN** a meaning search returns results while the profile shows match scores
- **THEN** each tile shows the pooled cosine labelled `k` at the bottom-left of its picture to three decimals and the robust z labelled `z` at the bottom-right to two, both visible without hovering the tile

#### Scenario: A result says its strength without a number
- **WHEN** a meaning search returns results for a profile that has not turned match scores on
- **THEN** no number is drawn; each tile carries a relevance bar and its strength word in its tooltip and accessible name, and opening one shows the same word in the panel's `match` row; turning the numbers on keeps the bar and the tooltip's word and puts the numbers in the accessible name in the word's place

#### Scenario: A neighbour's number is labelled as a neighbour's
- **WHEN** a similarity view's results are shown with match scores on, whose cosines run far higher than a meaning search's
- **THEN** the cosine is labelled `sim` rather than `k`, at its own unaltered value, so it does not read as a stronger match than a meaning result's lower number

#### Scenario: The numbers are announced, not only drawn
- **WHEN** a scored result's tile is reached without seeing it, with match scores on
- **THEN** its accessible name carries both numbers with their scales named in full, rather than naming the model alone and leaving the picture unread

#### Scenario: Turning a model does not hide what it scored
- **WHEN** the user presses a scored tile with match scores on and orbits it in place
- **THEN** the numbers stay visible above the model being turned, in the same place they occupied before the press

#### Scenario: A surface that replaces the tile still covers it
- **WHEN** the model is opened in the lightbox, or the entry menu is raised over its tile
- **THEN** that surface covers the tile's numbers rather than being pierced by them, the tile's own picture being no longer what the user is looking at

#### Scenario: Ordinary browsing shows no numbers
- **WHEN** the user browses a directory, a flat search, or a zip's contents, whatever the preference
- **THEN** no tile shows either number, a bar or a strength word, and no space is held for them, the tiles being identical to those of a listing no query scored

#### Scenario: The anchor is the question, not an answer
- **WHEN** a similarity view is shown with its anchor model beside the neighbours
- **THEN** the neighbours carry their strength and, with match scores on, their numbers, and the anchor carries none of them

#### Scenario: The panel says what the tile said
- **WHEN** the user opens a scored result in the lightbox
- **THEN** the info panel's `match` row gives the same strength word as that result's tile, the panel adds the two values under the same labels as the tile where match scores are on, and a model opened from an unscored listing shows none of those rows

#### Scenario: A number is never baked into a thumbnail
- **WHEN** a model appears first in a meaning search and later in a plain directory listing
- **THEN** its thumbnail is the same cached image in both, carrying no trace of the badges or the bar, and re-rendering was not triggered by the difference

#### Scenario: A stale hit takes its number with it
- **WHEN** the index returns a model that no longer exists on disk
- **THEN** the hit produces no tile and no number, exactly as the tree-resolution requirement already drops it, and the remaining results keep the numbers the index gave them

## ADDED Requirements

### Requirement: A query that plainly belongs to the other corpus is asked of it until its results are left
When the user submits from the search input, the client SHALL run a query whose shape says
which corpus it belongs to against that corpus, whatever mode is in force: a query shaped like
a file name — one token of at least three characters with no spaces, carrying an underscore, a
hyphen, a dot or a digit — submitted under meaning mode SHALL run as a name search, since
meaning search matches nothing a file name names; and a query that reads like a description —
three or more words, none of them shaped like a file name — submitted under name mode SHALL run
as a meaning search where meaning search can run at the location, since no file is named in
sentences. The results line SHALL say which corpus was searched and why, with a control that
runs the same text against the other corpus, one click away.

The corpus so chosen SHALL be in force for as long as its results are: the input's mode control
SHALL show it, and a further query submitted over those results SHALL be read under it (and
routed again by its own shape). It SHALL NOT change the mode stored as the profile's choice, and
the search's URL SHALL name the corpus the search actually ran against (see `url-navigation`).
Leaving the results — dismissing them, emptying the search input, navigating, pressing the
flat toggle, or finding models similar to one of them — SHALL put the profile's own options, its mode among them, back in force (see
`file-search`, *Leaving a search puts the profile's own options back*). The control that runs
the text against the other corpus — here, on a weak set, beside a name count, or on an empty
search — SHALL likewise switch the corpus of the results on screen without storing it as the
profile's mode. A query of neither shape SHALL run in the mode in force, as before.

#### Scenario: A file name typed under Meaning
- **WHEN** meaning mode is in force and the user submits `knight_32mm.stl`
- **THEN** a name search runs, the results line says file names were searched because the query looks like one, and "Search by meaning instead" runs the same text by meaning

#### Scenario: A description typed under Name
- **WHEN** name mode is in force, meaning search can run here, and the user submits "a knight on a horse"
- **THEN** a meaning search runs, the results line says it was searched by meaning because it reads like a description, and "Search names instead" runs the same text against the names

#### Scenario: The switch is for one search
- **WHEN** a file-name-shaped query was run as a name search under a profile whose mode is meaning, and the user dismisses the results and submits a phrase
- **THEN** the phrase runs by meaning, and the profile's stored mode was meaning throughout

#### Scenario: The routed corpus holds while its results are on screen
- **WHEN** a file-name-shaped query was run as a name search under a profile whose mode is meaning, and the user submits another plain word over its results without leaving them
- **THEN** the word runs as a name search, the input's mode control showing Name, and the profile's stored mode is still meaning

#### Scenario: A description without an index stays a name search
- **WHEN** name mode is in force where meaning search cannot run and the user submits a sentence
- **THEN** a name search runs, as it would have before

### Requirement: Names are counted beside a meaning search
Beside every meaning search whose results are on screen, the client SHALL ask, as a request of
its own, how many entries a name search of the same words would find under the same folder
with the folder-matching option in force, so that a model named for the phrase is never lost
among guesses. The count is of the entries that name search would show — matching folders and
archives included, not models alone — since that is the grid showing the names would draw. The count SHALL be keyed on the whole question — folder, folder matching and
words — and SHALL be discarded rather than shown for any other question, including while the
next one is being asked. Because the name search it runs is capped, a count at the cap SHALL
be presented as a floor rather than as a total. The meaning results SHALL NOT wait for the count, and a
client or server that cannot answer it SHALL say nothing about names beyond the ways out a weak
set always offers.

Where the meaning set is not weak and the count is above zero, the results line SHALL note how
many names match the phrase too, with a control that shows them; where the set is weak, the
count SHALL be carried by that set's own way to the names rather than by a second note. Showing the names SHALL run the same text as a name search without storing name mode as the profile's choice, as the preceding requirement defines.

#### Scenario: Names match too
- **WHEN** a meaning search for "dragon" is not weak and seven entries under the folder are named for it
- **THEN** the results line notes that 7 names match “dragon” too, and "Show them" runs the name search

#### Scenario: A weak set carries the count on its way out
- **WHEN** a meaning search is weak and names match its words
- **THEN** the weak set's note offers "See the N name matches" and no separate names note is drawn

#### Scenario: A count at the cap is a floor
- **WHEN** the name search the count runs reaches its cap
- **THEN** the count reads as the cap followed by "+", e.g. "500+"

#### Scenario: A stale count is not shown
- **WHEN** the user runs a meaning search in one folder and, before its count lands, runs another elsewhere
- **THEN** the first count is never shown beside the second search's results
