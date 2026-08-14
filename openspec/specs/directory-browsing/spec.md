# directory-browsing Specification

## Purpose
TBD - created by archiving change model-browser-v1. Update Purpose after archive.
## Requirements
### Requirement: Directory listing
The server SHALL list the contents of any readable local directory, returning subdirectories, zip files, and model files (`.stl`, `.3mf`, `.obj`) with name, type, size, and mtime. Other file types SHALL be omitted from the listing.

#### Scenario: Listing a directory
- **WHEN** the client requests a listing for a valid directory path
- **THEN** the response contains its subdirectories, zip files, and model files with name, type, size, and mtime

#### Scenario: Invalid path
- **WHEN** the client requests a listing for a path that does not exist or is not readable
- **THEN** the server responds with an error the UI surfaces without crashing

### Requirement: API restricted to the app's own origin
Because the server reads and serves arbitrary local paths as the user, the server SHALL bind to 127.0.0.1 only and SHALL reject every `/api/*` request that does not originate from the app itself: requests carrying an `Origin` header that is not a loopback origin SHALL be refused, requests whose `Host` header is not a loopback host SHALL be refused, and CORS headers SHALL never be emitted. Localhost binding alone is NOT sufficient, since any page open in the user's browser can reach a localhost port. Because no-cors subresource embeds (`<img src>`, `<script src>`) carry no `Origin` header and so pass the origin check, model bytes SHALL be served as `Content-Type: application/octet-stream` with `X-Content-Type-Options: nosniff`.

#### Scenario: Another site probes the API
- **WHEN** a page served from a non-loopback origin fetches any `/api/*` endpoint
- **THEN** the request is refused, and no listing, file bytes, or cache write occurs

#### Scenario: DNS rebinding attempt
- **WHEN** a request arrives whose `Host` header is not a loopback host
- **THEN** the request is refused regardless of its `Origin`

#### Scenario: No-cors embed cannot read model bytes
- **WHEN** a cross-origin page embeds `/api/file` as an `<img>` or `<script>` source, sending no `Origin` header
- **THEN** the response declares `application/octet-stream` with `nosniff`, so the browser blocks the load instead of decoding or executing it

#### Scenario: The app's own requests
- **WHEN** the client makes an API request, in dev through the Vite proxy or in production from the served origin
- **THEN** the request is allowed

### Requirement: Thumbnail grid navigation
The client SHALL display directory contents as a responsive grid. Activating a subdirectory or zip tile SHALL navigate into it; the current location SHALL always be reflected in the path bar.

#### Scenario: Entering a subdirectory
- **WHEN** the user clicks a subdirectory tile
- **THEN** the grid shows that directory's contents and the path bar updates to its path

#### Scenario: Navigating up
- **WHEN** the user navigates to the parent of the current location
- **THEN** the grid and path bar reflect the parent directory

### Requirement: Editable path bar
The UI SHALL show the current directory path in an editable text input at the top. Submitting a valid path SHALL navigate there; an invalid path SHALL show an error and leave the current view unchanged.

#### Scenario: Typing a valid path
- **WHEN** the user edits the path bar to a valid directory and submits
- **THEN** the grid shows that directory's contents

#### Scenario: Typing an invalid path
- **WHEN** the user submits a nonexistent path
- **THEN** an error is shown and the current grid remains

### Requirement: Server-backed path autocomplete
While editing the path bar, the UI SHALL offer completion suggestions for the partial path from a server endpoint that lists matching subdirectories.

#### Scenario: Completing a partial path
- **WHEN** the user has typed a partial path whose parent directory exists
- **THEN** matching subdirectory completions are suggested and selecting one fills the path bar

### Requirement: Recent directories
The client SHALL persist recently visited directories in localStorage and offer them as suggestions when the path bar is focused.

#### Scenario: Revisiting a recent directory
- **WHEN** the user focuses the path bar after previously visiting directories
- **THEN** recent directories are listed and selecting one navigates there

### Requirement: Recursive flat listing
The server SHALL support a flat variant of the directory listing, requested by an explicit query flag; any other value of that flag, or its absence, SHALL yield the ordinary nested listing. A flat listing SHALL return the requested root's immediate subdirectory and zip entries (top level only — deeper folders are not listed as tiles) followed by every model file recursively under the root, the models ordered by **file name** with ties broken by the full relative path. The walk SHALL descend into subdirectories and into zip files' contents (one archive level; nested zip *file entries* are skipped, while a directory inside an archive whose name ends in `.zip` is walked normally), and SHALL skip hidden (dot-prefixed) directories and unreadable subdirectories without failing the request.

The walk SHALL enter each real directory at most once, keyed by its resolved real path. Symlink cycles therefore terminate, and a directory reachable by several routes SHALL contribute its models once — under the first route walked — rather than once per route; consequently a flat listing is not required to include models that nested browsing shows under an aliased route.

Each model entry's virtual path SHALL be identical to the path a nested browse would yield, so thumbnails and camera state are shared between the two views, and each model entry's name SHALL be its path relative to the requested root. When the requested root is a zip or a directory inside one, the same rules SHALL apply within the archive: its immediate directories are the container entries, every model under the prefix is listed with names relative to that prefix, and no further descent is attempted.

The walk SHALL be bounded by a hard budget on the work it does, charged once per directory entry examined — every filesystem entry and every archive entry the walk inspects, whether or not it is kept — independent of the cap on the number of models returned. A malformed or non-positive configured limit SHALL fall back to its default rather than disable the bound. Because the ordering is by file name rather than by walk order, the returned models SHALL be the cap's worth taken from the sorted result rather than the first ones encountered. A response SHALL carry an explicit truncation flag whenever any model was dropped, whether by the cap or by the budget.

#### Scenario: Models across subfolders in one listing
- **WHEN** the client requests a flat listing of a folder containing models nested several directories deep
- **THEN** all of them are returned as model entries named by their relative paths and ordered by file name, preceded by the folder's immediate subdirectory and zip entries — and no deeper directories appear as entries

#### Scenario: Same-named parts sort together
- **WHEN** a flat-listed folder contains `a/bracket.stl` and `z/bracket.stl`
- **THEN** the two entries are adjacent in the listing, ordered by file name rather than by containing folder

#### Scenario: Flag must be explicit
- **WHEN** the listing is requested without the flat flag, or with a value that does not enable it
- **THEN** the ordinary single-level nested listing is returned

#### Scenario: Zip contents included
- **WHEN** a flat-listed folder contains a zip with model entries
- **THEN** those models appear in the listing under their `zip!/entry` virtual paths, and any zip *file* nested inside the archive is skipped while a directory named `*.zip` inside it is walked normally

#### Scenario: Flat listing rooted inside a zip
- **WHEN** the client requests a flat listing of a zip, or of a directory inside one
- **THEN** the response contains that prefix's immediate directories as entries plus every model beneath the prefix, named relative to the prefix, with no attempt to descend into a further archive

#### Scenario: Symlink cycle
- **WHEN** a flat-listed folder contains a symlink cycle among its subdirectories
- **THEN** the request completes, listing each real directory's models once

#### Scenario: Aliased directory is listed once
- **WHEN** a flat-listed folder contains a subdirectory and a symlink to that same subdirectory
- **THEN** its models appear once, under the route walked first, and are not duplicated under the alias

#### Scenario: Oversized tree is truncated
- **WHEN** a flat-listed folder contains more models than the cap
- **THEN** the response contains the cap's worth of entries — the first of them in file-name order — and is flagged truncated

#### Scenario: Model-sparse giant tree stops at the budget
- **WHEN** a flat-listed folder contains far more directories than the walk budget allows, holding too few models to reach the model cap
- **THEN** the walk stops when the budget is exhausted, the request completes, and the response is flagged truncated

#### Scenario: Entries that are examined but not kept still cost budget
- **WHEN** a flat-listed folder holds a subdirectory of many files that are neither models nor directories
- **THEN** examining them consumes the walk budget, so the request stays bounded and reports truncation rather than scanning them all for free

### Requirement: Flat view toggle
The client SHALL offer a flat-view toggle alongside the path bar. While active, the grid SHALL show the current folder's flat listing — the top-level folder and zip tiles first, navigable exactly as in the nested view, then model tiles labeled by **file name**, with the entry's full relative path carried in the tile's tooltip and accessible name — and hover-warm, drag-to-orbit, the lightbox, and thumbnail/camera persistence SHALL behave exactly as in the nested view for the same models. The toggle SHALL remain in effect across navigation within the session, including navigation into a zip, and a truncated listing SHALL be indicated to the user.

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

#### Scenario: An abandoned flat walk cannot repaint the view that replaced it
- **WHEN** a slow flat listing finally arrives after the user has already navigated or toggled back, and a later listing is on screen
- **THEN** the late response is discarded — the grid, path, and truncation notice continue to describe the listing the user is actually viewing

#### Scenario: A failed flat request leaves the toggle off
- **WHEN** activating the flat toggle produces an error instead of a listing
- **THEN** the error is surfaced, the grid keeps showing the listing it already had, the toggle returns to its inactive state, and later navigation does not request flat listings

#### Scenario: Truncation is visible
- **WHEN** a flat listing comes back flagged as truncated
- **THEN** the UI states that the listing is incomplete, reporting the number of models actually shown rather than a fixed cap

### Requirement: In-flight listing feedback
While a directory listing request is in flight, the client SHALL acknowledge it visibly: once a listing request has been continuously in flight for a short reveal delay, the grid SHALL be replaced by a skeleton of placeholder tiles until the newest request lands. The delay is measured over continuous in-flight time, not per request — a navigation issued while an earlier request is already pending does not re-arm it. A navigation issued while nothing is in flight that resolves within the delay SHALL never show the skeleton. While the skeleton is shown, the previous listing's tiles SHALL NOT be interactive, but the path bar, parent navigation, and the flat toggle SHALL remain usable. The in-flight indication SHALL follow the newest request only: a superseded request's landing SHALL neither dismiss nor re-trigger it, and a failed request SHALL clear it and surface the error over the listing the user was already viewing.

#### Scenario: Slow navigation shows the skeleton
- **WHEN** the user navigates and the listing request is still unresolved after the reveal delay
- **THEN** the grid is replaced by pulsing placeholder tiles until the response lands, at which point the new listing renders

#### Scenario: Fast navigation never flickers
- **WHEN** the user navigates while no other listing request is in flight and the listing resolves within the reveal delay
- **THEN** the new listing renders directly and no skeleton appears

#### Scenario: Escaping a slow request
- **WHEN** the skeleton is showing and the user submits a different path, navigates up, or toggles flat off
- **THEN** the newer request takes over the in-flight indication, and whichever response is newest when it lands is what renders

#### Scenario: Failure clears the skeleton
- **WHEN** the in-flight request fails
- **THEN** the skeleton is dismissed, the error is surfaced, and the previously shown listing returns

