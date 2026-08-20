# semantic-search Delta

> Written against the text `semantic-search` leaves behind — that change owns
> this requirement and is a hard prerequisite (tasks.md).

## MODIFIED Requirements

### Requirement: Meaning search is a mode of the search input
The client SHALL offer meaning search as a mode the search input runs in, selected by an option carried with the other search options, so that submitting from the input runs whichever search is in force. The option SHALL be sticky per browser profile and carried in the URL under the same rules as the other options that determine which results exist, and changing it while a query is committed SHALL re-run that query in the newly selected mode without the user retyping it. Which mode is in force SHALL be visible without opening the panel, since it is what explains the grid.

The client SHALL also offer the parameters that shape a meaning query: whether the phrase is read as written or expanded into the index's templates, how a model's views are reduced to a single score, and where the result set stops — either a number of results or a minimum score, as a single choice rather than two settings that can disagree, since the index honours only one of them. Each SHALL be sticky per profile and carried in the URL when it is not its default, on the same rule as every other option that determines which entries a view contains. Options that do not apply to the mode in force SHALL be hidden rather than shown inert — but the controls that explain the current view SHALL NOT be hidden with them. Where meaning mode is in force and the index cannot answer it, the client SHALL still show which mode is in force, a way to leave it, why it cannot run, and the options that govern the search a submit would actually perform. A mode a user can neither see nor leave is a trap, and a link can put this app in one on a machine that has no index.

Meaning results SHALL replace the grid and SHALL render as an ordinary listing — thumbnails, orbit, lightbox, and camera persistence behave identically, and the in-flight skeleton and latest-wins supersession apply. Results SHALL be presented in the order the index returned them, which is by relevance and is never re-sorted by name. Navigating, toggling flat, or committing another search SHALL supersede them, and clearing the query SHALL restore the ordinary listing for the current path.

The UI SHALL make clear that the grid holds meaning matches for the committed phrase and that they came from the index rather than from the directory listing. Where the result set is bounded by a count, that bound SHALL be presented as showing the strongest matches rather than as truncation: a relevance ranking has no horizon it can run out at. Where the index reports that its own ceiling stopped it returning what was asked for, the client SHALL say so, since that bound was not the user's choice and their control is what met it.

#### Scenario: A phrase finds models whose names do not contain it
- **WHEN** the user commits a search in meaning mode for a phrase describing a subject
- **THEN** models matching that description are shown, ranked by relevance, including models whose file names and folders contain none of the words

#### Scenario: A parameter changes the result set
- **WHEN** the user changes how the phrase is read, or how views are pooled, and the query is re-run
- **THEN** the results reflect that setting, and the setting is what a later search in this profile uses

#### Scenario: A count and a floor are one choice
- **WHEN** the user sets a minimum score
- **THEN** the result set is everything at or above it rather than a fixed number, and no count is presented as also being in force

#### Scenario: The index's ceiling is reported, the ranking's horizon is not
- **WHEN** a result set is bounded by the user's count, and again when the index's own cap stopped it short
- **THEN** the first is described as the strongest matches and the second says the index returned fewer than was asked for

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
