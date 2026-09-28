## MODIFIED Requirements

### Requirement: A query that plainly belongs to the other corpus is asked of it until its results are left
When the user submits from the search input under meaning mode, the client SHALL run a query
shaped like a file name — one token of at least three characters with no spaces, carrying an
underscore, a hyphen, a dot or a digit — as a name search, since meaning search matches nothing
a file name names. The results line SHALL say which corpus was searched and why, with a control
that runs the same text by meaning, one click away. Under name mode, every query SHALL run as a
name search, whatever its shape: name matching reads a query as terms that may appear in any
order (see `file-search`, *Names match term by term*), so a phrase of several words names
things too, and a phrase that matches nothing is offered the other corpus by the empty state
(see `file-search`, *An empty search offers a way onward*).

The corpus so chosen SHALL be in force for as long as its results are: the input's mode control
SHALL show it, and a further query submitted over those results SHALL be read under it. It SHALL NOT change the mode stored as the profile's choice, and
the search's URL SHALL name the corpus the search actually ran against (see `url-navigation`).
Leaving the results — dismissing them, emptying the search input, navigating, pressing the
flat toggle, or finding models similar to one of them — SHALL put the profile's own options, its mode among them, back in force (see
`file-search`, *Leaving a search puts the profile's own options back*). The control that runs
the text against the other corpus — here, on a weak set, beside a name count, or on an empty
search — SHALL likewise switch the corpus of the results on screen without storing it as the
profile's mode. Any other query SHALL run in the mode in force.

#### Scenario: A file name typed under Meaning
- **WHEN** meaning mode is in force and the user submits `knight_32mm.stl`
- **THEN** a name search runs, the results line says file names were searched because the query looks like one, and "Search by meaning instead" runs the same text by meaning

#### Scenario: A description typed under Name
- **WHEN** name mode is in force, meaning search can run here, and the user submits "a knight on a horse"
- **THEN** a name search runs for those words, and if nothing matches, the empty state offers "Search by meaning instead"

#### Scenario: The switch is for one search
- **WHEN** a file-name-shaped query was run as a name search under a profile whose mode is meaning, and the user dismisses the results and submits a phrase
- **THEN** the phrase runs by meaning, and the profile's stored mode was meaning throughout

#### Scenario: The routed corpus holds while its results are on screen
- **WHEN** a file-name-shaped query was run as a name search under a profile whose mode is meaning, and the user submits another plain word over its results without leaving them
- **THEN** the word runs as a name search, the input's mode control showing Name, and the profile's stored mode is still meaning

#### Scenario: A description without an index stays a name search
- **WHEN** name mode is in force where meaning search cannot run and the user submits a sentence
- **THEN** a name search runs, exactly as it does where meaning search can run
