# directory-browsing Specification

## Purpose
TBD - created by archiving change model-browser-v1. Update Purpose after archive.
## Requirements
### Requirement: Directory listing
The server SHALL list the contents of any readable directory within the library (see `library`), returning subdirectories, zip files, and model files (`.stl`, `.3mf`, `.obj`) with name, type, size, and mtime. Other file types SHALL be omitted from the listing. Every entry's path SHALL be its library-relative path.

#### Scenario: Listing a directory
- **WHEN** the client requests a listing for a valid library path
- **THEN** the response contains its subdirectories, zip files, and model files with name, type, size, and mtime, each addressed by a library-relative path

#### Scenario: Invalid path
- **WHEN** the client requests a listing for a path that does not exist or is not readable
- **THEN** the server responds with an error the UI surfaces without crashing

#### Scenario: A path outside the library
- **WHEN** the client requests a listing for a path that resolves outside the library
- **THEN** the server refuses it and the UI surfaces the refusal without crashing

### Requirement: API restricted to the app's own origin
Because the server reads and serves the user's model library as the user, the server
SHALL reject every `/api/*` request that does not originate from the app itself.
Which origins *are* the app's own SHALL come from the deployment's configuration
(see `public-deployment`) as a set rather than a single value, since one deployment may
answer more than one name, and SHALL default to loopback: requests carrying an `Origin`
header that is not an allowed origin SHALL be refused, requests whose `Host` header is
not an allowed host SHALL be refused, and CORS headers SHALL never be emitted. The
listening address SHALL likewise be configured and SHALL default to loopback. Loopback
SHALL remain allowed whatever else is configured, so that a health check or an operator's
own request from the machine itself is not refused by the deployment it is checking. Binding
alone is NOT sufficient, since on a loopback deployment any page open in the user's
browser can reach a localhost port, and on a public deployment any client anywhere can
reach the address at all. A deployment that answers a public origin SHALL therefore
still confine every path to its library (see `library`) and SHALL refuse the operations
its capabilities declare off (see `feature-report`), because an allowed origin is not a
trusted user. Because no-cors subresource embeds (`<img src>`, `<script src>`) carry no
`Origin` header and so pass the origin check, model bytes SHALL be served as
`Content-Type: application/octet-stream` with `X-Content-Type-Options: nosniff`.

#### Scenario: Another site probes the API
- **WHEN** a page served from an origin the deployment does not allow fetches any `/api/*` endpoint
- **THEN** the request is refused, and no listing, file bytes, or cache write occurs

#### Scenario: DNS rebinding attempt
- **WHEN** a request arrives whose `Host` header is not an allowed host
- **THEN** the request is refused regardless of its `Origin`

#### Scenario: No-cors embed cannot read model bytes
- **WHEN** a cross-origin page embeds `/api/file` as an `<img>` or `<script>` source, sending no `Origin` header
- **THEN** the response declares `application/octet-stream` with `nosniff`, so the browser blocks the load instead of decoding or executing it

#### Scenario: The app's own requests
- **WHEN** the client makes an API request, in dev through the Vite proxy or from the origin the deployment serves it from
- **THEN** the request is allowed

#### Scenario: An unconfigured server is loopback-only
- **WHEN** the server runs with no configured origin
- **THEN** it allows exactly the loopback origins and hosts it allows today, and refuses every other

#### Scenario: A public deployment answers its own origin and no other
- **WHEN** a deployment configures a public origin and a request arrives from a different public origin
- **THEN** the request is refused, and a request from the configured origin is served

#### Scenario: A deployment answering two names
- **WHEN** a deployment configures more than one origin and a request arrives from the second
- **THEN** it is served, as one from the first is

#### Scenario: The machine can always ask itself
- **WHEN** a request arrives from loopback on a deployment that has configured a public origin
- **THEN** it is served, so a health check against the bound port is not refused

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
The UI SHALL show the current library-relative path in an editable text input at the top, showing `/` at the library's top. The input SHALL reflect the user's newest navigation target as soon as the navigation is requested — before its listing arrives — and SHALL revert to the committed path when that navigation fails. Submitting a valid library path SHALL navigate there; an invalid path, or one outside the library, SHALL show an error and leave the current view unchanged.

#### Scenario: Typing a valid path
- **WHEN** the user edits the path bar to a valid library path and submits
- **THEN** the grid shows that directory's contents

#### Scenario: Typing an invalid path
- **WHEN** the user submits a nonexistent path
- **THEN** an error is shown and the current grid remains

#### Scenario: The bar reflects an in-flight navigation
- **WHEN** the user navigates while the destination's listing is still loading
- **THEN** the path bar already shows the destination, and if the navigation fails it reverts to the committed path alongside the error

#### Scenario: The library's top is a slash
- **WHEN** the view is at the library's top
- **THEN** the path bar shows `/`, and submitting `/` navigates there

### Requirement: Server-backed path autocomplete
While editing the path bar, the UI SHALL offer completion suggestions for the partial library path from a server endpoint that lists matching subdirectories within the library. Suggestions SHALL be library-relative paths.

#### Scenario: Completing a partial path
- **WHEN** the user has typed a partial library path whose parent directory exists
- **THEN** matching subdirectory completions are suggested as library-relative paths and selecting one fills the path bar

#### Scenario: Nothing outside the library completes
- **WHEN** the user has typed a prefix that does not begin with `/`, or one that resolves outside the library
- **THEN** no completions are offered

### Requirement: Recent directories
The client SHALL persist recently visited library-relative directories in localStorage and offer them as suggestions when the path bar is focused. Recents recorded before paths were library-relative SHALL NOT be offered.

#### Scenario: Revisiting a recent directory
- **WHEN** the user focuses the path bar after previously visiting directories
- **THEN** recent directories are listed as library-relative paths and selecting one navigates there

#### Scenario: Old recents are not offered
- **WHEN** the app first runs with a library after recents were stored as filesystem paths
- **THEN** those recents are not offered and the list starts empty

### Requirement: Recursive flat listing
The server SHALL support a flat variant of the directory listing, requested by an explicit query flag; any other value of that flag, or its absence, SHALL yield the ordinary nested listing — except that a request carrying a file-search query without the flat flag SHALL be rejected rather than silently ignored (see the file-search capability). A flat listing SHALL return the requested root's immediate subdirectory and zip entries (top level only — deeper folders are not listed as tiles) followed by every model file recursively under the root — all of them when no file-search query narrows the walk; only matching ones when one does — the models ordered by **file name** with ties broken by the full relative path. The walk SHALL descend into subdirectories and into zip files' contents (one archive level; nested zip *file entries* are skipped, while a directory inside an archive whose name ends in `.zip` is walked normally), and SHALL skip hidden (dot-prefixed) directories and unreadable subdirectories without failing the request.

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
- **WHEN** the listing is requested without the flat flag, or with a value that does not enable it, and no file-search query accompanies it
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

### Requirement: Folder tiles preview their contents
A directory tile SHALL show up to four thumbnails of models found within it, arranged as a contact sheet, with the directory's name beneath. The models SHALL be chosen from the index first, where it is ready and covers the location: the index is asked for the models it holds under the directory — no filesystem walk — and the sheet is the first posed ones in the index's deterministic order, unposed indexed ones filling remaining cells; each such path is confined exactly as a search hit is. When that answer names fewer models than the sheet holds, the remaining cells SHALL be filled from the walk's finds, deduplicated by path, so a sheet is never emptier than the walk alone would have made it. Only when that answer is empty, or the index is silent, SHALL the models be chosen entirely by a bounded, deterministic walk of the directory — at each level its models in sorted order before its subdirectories in sorted order, descending in that order — preferring models the index holds an orientation for: the walk runs to its entry bound, one bounded request to the index decides which finds are posed, and the sheet is the posed finds in walk order, models found without a pose filling the remaining cells in walk order. Posedness comes from the index in one bounded request over the walk's finds; when the index is absent, warming, or does not cover the location, the selection is the walk's first four models exactly as before, so the preview never waits on the index. The same directory with the same index answer previews the same models on every visit and on every machine. The walk SHALL examine no more than a fixed number of entries, counting every entry it stats at any level, so a single wide directory is bounded too, and SHALL take a level's entries in code-point name order before counting — not a locale collation — so that the bound cuts the same entries on every machine; a directory that exhausts that bound before four posed models are found SHALL preview the posed ones found, filled out with unposed finds in walk order. A peek is its own request: never served from or merged into a recursive listing, and — being bounded — run to completion rather than stopped when its tile has scrolled away. A peek SHALL be confined exactly as a listing is: an entry that resolves outside the library is neither previewed nor descended into. The preview SHALL be requested per tile, when the tile comes on screen or within the prefetch band of it — the same boundary the thumbnail queue ranks work as near by, so a sheet is usually landed before its tile is seen — through a server endpoint that returns the previewed models as ordinary listing entries; a directory listing SHALL NOT compute previews. Preview thumbnails SHALL be produced, cached and refreshed exactly as a model tile's thumbnail is, sharing an entry with the same model wherever it appears. A directory with no previewable models, an unreadable directory, a tile whose preview has not yet answered, or a tile whose preview request failed SHALL show its own icon — for a directory that icon is the folder chrome, drawn whether or not a preview has landed, so a landing preview fills it rather than replacing a different resting icon; fewer than four previews SHALL fill the sheet without empty cells. Zip tiles SHALL NOT be previewed.

#### Scenario: A kit shows its parts
- **WHEN** a directory containing several models is on screen as a tile
- **THEN** the tile shows thumbnails of four of its models as a 2×2 sheet — the first four posed ones in name order where the index answers, its first four in name order where it does not — and its name

#### Scenario: A folder of folders shows its first kit
- **WHEN** a directory whose own level holds only subdirectories is on screen as a tile
- **THEN** the tile shows the first four models found by descending its subdirectories in order

#### Scenario: Fewer than four
- **WHEN** a directory holds one, two or three models and nothing below them
- **THEN** the tile shows that many thumbnails filling the sheet, with no empty cells

#### Scenario: Nothing to preview
- **WHEN** a directory holds no models within the walk's bound, or cannot be read, or is an archive
- **THEN** the tile shows its own icon — the directory icon for a directory, the archive icon for an archive

#### Scenario: A failed peek shows the icon
- **WHEN** a tile's preview request fails — the library not ready, or a network error
- **THEN** the tile shows its own icon and the rest of the grid is unaffected

#### Scenario: The listing is not slower for it
- **WHEN** a directory of many subdirectories is listed
- **THEN** the listing request does no preview work, and previews are requested only for tiles that come on screen or within the prefetch band of it

#### Scenario: A preview is an ordinary thumbnail
- **WHEN** a model previewed in a folder tile is also shown as its own tile, or the occlusion preference changes, or its thumbnail is re-rendered
- **THEN** the folder tile shows the same image the model tile shows, from the same cache entry

#### Scenario: The index sees past the walk's budget
- **WHEN** a folder-of-folders tile is previewed whose first-sorted subtree would consume a walk's entry budget, while the index holds posed models deeper in the folder
- **THEN** the sheet shows posed models from anywhere under the folder, because the selection asked the index rather than walking — and a folder the index knows nothing about falls back to the walk exactly as before

#### Scenario: Determinism
- **WHEN** the same directory is previewed twice, or on two machines holding the same library, with the index answering the same poses — or not answering — in both
- **THEN** the same models are previewed in the same order

### Requirement: Entries display their stored name
A listing entry whose exact library path holds a display name in the library's
override store SHALL carry that name, attached at listing emission from the
loaded store — an exact-key lookup, never the prefix resolution, so a kit's
name labels the kit's own tile and nothing beneath it. Tiles SHALL render the
display name in place of the file-derived label wherever one is carried, in
each listing shape the seam covers — a browse, a flat or deep-search listing,
and a folder tile's preview entries alike; semantic and similarity answers are
deliberately outside it (design D7: hits are models, generated names are
kit-level) — while the entry's real name SHALL remain in the
tile's own title and accessible name (a named directory tile's accessible name
is "folder " plus the real name — the type signal its content-derived name
would otherwise lose), and SHALL remain what find, deep search
and the flat filter match: display names are display only. A folder tile's
preview cell is the one exception by construction: it has no visible label, so
its title IS its label surface and SHALL carry the display name where one is
stored (falling back to the entry's real name, unchanged) — the enclosing
tile's title still carries the real name. An entry with no stored
name SHALL be labelled exactly as before, and a library with no store SHALL
list and label identically to today.

#### Scenario: A kit tile shows its title
- **WHEN** the store holds a name for a directory and its tile is listed
- **THEN** the tile's label is the stored name, and its title still carries the directory's real name

#### Scenario: A kit's models keep their own names
- **WHEN** the store holds a name for `/kit` and none for `/kit/x.stl`
- **THEN** `/kit/x.stl`'s tile is labelled from its file name, not the kit's stored name

#### Scenario: Matching is untouched
- **WHEN** a directory's stored name and real name differ and the user types a fragment of each into find
- **THEN** the real-name fragment matches the tile and the stored-name fragment does not

#### Scenario: No store, no change
- **WHEN** a library carries no override store
- **THEN** every listing and label is byte-identical to what it was before this capability existed

