# directory-browsing Delta

## MODIFIED Requirements

### Requirement: Flat view toggle
The client SHALL offer a flat-view toggle alongside the path bar. While active, the grid SHALL show the current folder's flat listing — the top-level folder and zip tiles first, navigable exactly as in the nested view, then model tiles labeled by relative path — and hover-warm, drag-to-orbit, the lightbox, and thumbnail/camera persistence SHALL behave exactly as in the nested view for the same models. The toggle SHALL remain in effect across navigation within the session, including navigation into a zip, and a truncated listing SHALL be indicated to the user.

Toggling SHALL re-request the user's newest navigation target: the in-flight target while a navigation is still loading, otherwise the committed path of the listing on screen. When the newest navigation has failed, the toggle SHALL fall back to the committed path.

#### Scenario: Toggling flat view
- **WHEN** the user activates the flat toggle on a folder with nested models
- **THEN** the grid re-renders showing the folder's top-level containers followed by all models recursively with relative-path labels, and deactivating it restores the nested view

#### Scenario: Navigating down while flat
- **WHEN** flat view is active and the user clicks one of the top-level folder tiles
- **THEN** the grid shows that folder's flat listing (its own top-level containers and recursive models)

#### Scenario: Entering a zip while flat
- **WHEN** flat view is active and the user clicks a zip tile
- **THEN** the grid shows the archive's flat listing rather than falling back to a nested one

#### Scenario: Orbiting from the flat view
- **WHEN** the user orbits a model tile in flat view and later browses to its containing folder in nested view
- **THEN** the saved orientation and thumbnail are the ones persisted from the flat view

#### Scenario: Flat mode follows navigation
- **WHEN** flat view is active and the user navigates to another folder
- **THEN** the new folder is also shown flat until the toggle is turned off

#### Scenario: Untoggling mid-navigation keeps the destination
- **WHEN** flat view is active, the user navigates up a directory, and deactivates the toggle while that navigation is still loading
- **THEN** the nested listing that renders is the navigation's destination, not the directory the user navigated away from

#### Scenario: Toggling after a failed navigation
- **WHEN** the user's most recent navigation failed and they then activate or deactivate the flat toggle
- **THEN** the toggle re-requests the listing on screen (the committed path), not the failed target

#### Scenario: An abandoned flat walk cannot repaint the view that replaced it
- **WHEN** a slow flat listing finally arrives after the user has already navigated or toggled back, and a later listing is on screen
- **THEN** the late response is discarded — the grid, path, and truncation notice continue to describe the listing the user is actually viewing

#### Scenario: A failed flat request leaves the toggle off
- **WHEN** activating the flat toggle produces an error instead of a listing
- **THEN** the error is surfaced, the grid keeps showing the listing it already had, the toggle returns to its inactive state, and later navigation does not request flat listings

#### Scenario: Truncation is visible
- **WHEN** a flat listing comes back flagged as truncated
- **THEN** the UI states that the listing is incomplete, reporting the number of models actually shown rather than a fixed cap
