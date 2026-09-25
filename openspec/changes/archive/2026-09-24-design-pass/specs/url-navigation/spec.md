## ADDED Requirements

### Requirement: The URL names the corpus a search actually ran against
Where a search runs against a corpus other than the mode the profile or the input's switch
has in force — a query routed by its shape, or a results-line control that asks the same text
of the other corpus (see `semantic-search`, *A query that plainly belongs to the other corpus is asked of it until its results are left*) — the URL SHALL name the mode the search ran under, as it names
the mode of any committed query, so that copying it reproduces what was shown rather than the
search the switch would have run. Such a search SHALL enter history as any committed search
does. The display preferences this capability's first requirement keeps out of the URL SHALL
include the tile size, whether match scores are drawn, and whether the side panel is open,
since none of them changes which entries a view contains.

#### Scenario: A routed file name is shared as a name search
- **WHEN** meaning mode is in force, the user submits `knight_32mm.stl`, which runs as a name search, and copies the URL into another tab
- **THEN** the other tab shows the same name search, not a meaning search for that text

#### Scenario: The other corpus is a step in history
- **WHEN** the user runs a meaning search, follows "Search names instead", and presses Back
- **THEN** the meaning results return

#### Scenario: Drawing preferences stay out
- **WHEN** the user changes the tile size, turns match scores on, or opens the side panel
- **THEN** the URL is unchanged
