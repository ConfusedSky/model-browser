# directory-browsing Delta

## MODIFIED Requirements

### Requirement: Thumbnail grid navigation
The client SHALL display directory contents as a responsive grid. Activating a subdirectory or zip tile SHALL navigate into it; the current location SHALL always be reflected in the path bar.

Navigating to the parent SHALL derive it from the user's newest navigation target — the in-flight target while a navigation is still loading, otherwise the committed path — so repeated parent navigations during a slow listing ascend the ancestry rather than re-requesting the same parent. When the newest navigation has failed, parent navigation SHALL ascend from the committed path.

#### Scenario: Entering a subdirectory
- **WHEN** the user clicks a subdirectory tile
- **THEN** the grid shows that directory's contents and the path bar updates to its path

#### Scenario: Navigating up
- **WHEN** the user navigates to the parent of the current location
- **THEN** the grid and path bar reflect the parent directory

#### Scenario: Navigating up twice during a slow listing
- **WHEN** the user navigates up while that parent's listing is still loading and navigates up again
- **THEN** the second navigation requests the grandparent, and the listing that renders is the grandparent's

### Requirement: Editable path bar
The UI SHALL show the current directory path in an editable text input at the top. The input SHALL reflect the user's newest navigation target as soon as the navigation is requested — before its listing arrives — and SHALL revert to the committed path when that navigation fails. Submitting a valid path SHALL navigate there; an invalid path SHALL show an error and leave the current view unchanged.

#### Scenario: Typing a valid path
- **WHEN** the user edits the path bar to a valid directory and submits
- **THEN** the grid shows that directory's contents

#### Scenario: Typing an invalid path
- **WHEN** the user submits a nonexistent path
- **THEN** an error is shown and the current grid remains

#### Scenario: The bar reflects an in-flight navigation
- **WHEN** the user navigates while the destination's listing is still loading
- **THEN** the path bar already shows the destination, and if the navigation fails it reverts to the committed path alongside the error

### Requirement: Flat view toggle
The client SHALL offer a flat-view toggle alongside the path bar. While active, the grid SHALL show the current folder's flat listing — the top-level folder and zip tiles first, navigable exactly as in the nested view, then model tiles labeled by **file name**, with the entry's full relative path carried in the tile's tooltip and accessible name — and hover-warm, drag-to-orbit, the lightbox, and thumbnail/camera persistence SHALL behave exactly as in the nested view for the same models. The toggle SHALL remain in effect across navigation within the session, including navigation into a zip, and a truncated listing SHALL be indicated to the user.

Toggling SHALL re-request the user's newest navigation target: the in-flight target while a navigation is still loading, otherwise the committed path of the listing on screen. When the newest navigation has failed, the toggle SHALL fall back to the committed path.

#### Scenario: Toggling flat view
- **WHEN** the user activates the flat toggle on a folder with nested models
- **THEN** the grid re-renders showing the folder's top-level containers followed by all models recursively, each labeled by file name with its relative path in the tooltip, and deactivating it restores the nested view

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
