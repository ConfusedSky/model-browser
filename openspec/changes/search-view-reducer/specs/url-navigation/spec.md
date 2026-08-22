# url-navigation Delta

## ADDED Requirements

### Requirement: Every history write names the whole view

Every URL the client writes into history SHALL be produced by serializing the complete committed view — path, flat, query, mode, kinds, folder matching, tuning, and model — never a hand-assembled subset of its fields. The `flat` URL parameter (the flat-view choice the parameter-enumerating requirement names) SHALL record the flat toggle's state, not be implied by the presence of a query: a search runs flat-shaped without asserting the toggle, and the toggle's state survives the search in the URL it names.

#### Scenario: Opening a lightbox keeps the view's options

- **WHEN** a meaning search is on screen under non-default options and the user opens a model's lightbox
- **THEN** the history entry written for the lightbox carries the search's mode, kinds, and tuning alongside the model, and reloading or sharing that URL reproduces the same search behind the lightbox

#### Scenario: Dropping a stale model keeps the view's options

- **WHEN** a deep link names a model that the landed view does not contain
- **THEN** the model is dropped from the URL by rewriting only that field, and the view's remaining options survive in the corrected entry

#### Scenario: A deferred commit carries its tuning

- **WHEN** a meaning search is committed while the index is not ready, under non-default tuning
- **THEN** the URL written for the deferred view carries that tuning, and the query runs under it once the index answers

#### Scenario: The flat param records the toggle

- **WHEN** the user searches with the flat toggle off, shares the resulting URL, and the recipient clears the query
- **THEN** the recipient sees the nested listing — the same listing the sender would see clearing it — because the search's URL recorded the toggle, not the flat shape the search ran in
