## ADDED Requirements

### Requirement: The store's credits are listable
The server SHALL answer, in one request, every key of the library's override store
that holds credits of its own — not credits inherited from an ancestor — each with its
library path, its display name where one is stored, and its credits as stored, in the
store's key order. A key SHALL be listed only where its credits would be drawn where a
single kit's credits are shown — at least one of author, licence, source or
modification present — so the list and the lightbox agree on what counts as credited. The answer SHALL carry library paths only, never a location on the
host. It SHALL answer the library's not-ready envelope while the library is not ready,
and an empty list where the store holds no credits. The client SHALL reach it only
through its API client. The per-entry route remains the lightbox's source; this one
exists for a reader who wants the whole corpus's attribution in one place.

#### Scenario: Every credited kit, once
- **WHEN** the store holds credits on a number of kit keys and none elsewhere
- **THEN** the answer lists exactly those keys, each with its stored name and credits

#### Scenario: Inherited credits are not repeated
- **WHEN** a key beneath a credited kit stores a name but no credits
- **THEN** it is absent from the list, since its credits are the kit's

#### Scenario: Credits with nothing to draw
- **WHEN** a key's stored credits hold no field this build knows how to show
- **THEN** it is absent from the list, as it would draw nothing in the lightbox

#### Scenario: An empty store
- **WHEN** the library has no store, or the store holds no credits
- **THEN** the answer is an empty list, not an error

#### Scenario: Library not ready
- **WHEN** the library is unconfigured or missing
- **THEN** the route answers the same state envelope every path route gives
