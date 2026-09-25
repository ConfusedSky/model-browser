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
own request from the machine itself is not refused by the deployment it is checking.
Loopback SHALL mean the loopback addresses and the whole `.localhost` top-level domain that
RFC 6761 §6.3 reserves for it — any name whose labels end at `localhost` — and not merely the
bare name `localhost`, since browsers resolve such a name to this machine without a DNS
lookup, so a deployment reached under one is being reached by the machine it runs on. A name
that ends elsewhere SHALL NOT be loopback however it is spelt, whether it carries the word as a
label of some other domain or merely ends in the word with no label boundary before it. Which of
these a request names SHALL NOT depend on the case it is written in. The `.localhost` rule does
not widen the listening address: what a deployment binds to SHALL stay an address the operating
system itself resolves. Binding
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
- **THEN** it allows exactly the loopback origins and hosts — the loopback addresses and every
  name under `.localhost` — and refuses every other

#### Scenario: A name under the reserved .localhost domain is loopback
- **WHEN** a request states a host or an origin under `.localhost` that no configuration names,
  such as one dev build's `build-a.localhost`
- **THEN** it is served, with no entry in the deployment's configured origins and whatever case
  the name is written in

#### Scenario: A name that only looks like loopback is refused
- **WHEN** a request states a host or an origin that contains `localhost` without its labels
  ending at it — a name under another domain (`localhost.evil.com`), or one that ends in the word
  with no label boundary before it (`notlocalhost`)
- **THEN** it is refused, as any other unconfigured public name is

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
The UI SHALL hold the current library-relative path in an editable text input at the top, holding `/` at the library's top. While the input does not have focus it SHALL be presented as breadcrumbs over it (see *Breadcrumbs stand over the path bar*); focusing it — by a press on the bar's empty part or on a folded crumb, or from the keyboard — SHALL show the path as text to edit. The input SHALL reflect the user's newest navigation target as soon as the navigation is requested — before its listing arrives — and SHALL revert to the committed path when that navigation fails; the breadcrumbs SHALL follow the same target. Submitting a valid library path SHALL navigate there; an invalid path, or one outside the library, SHALL show an error and leave the current view unchanged. Escape while editing SHALL abandon the edit, restoring the path, and SHALL return the keyboard to the element that held it before the input took it.

#### Scenario: Typing a valid path
- **WHEN** the user edits the path bar to a valid library path and submits
- **THEN** the grid shows that directory's contents

#### Scenario: Typing an invalid path
- **WHEN** the user submits a nonexistent path
- **THEN** an error is shown and the current grid remains

#### Scenario: The bar reflects an in-flight navigation
- **WHEN** the user navigates while the destination's listing is still loading
- **THEN** the path bar and its breadcrumbs already show the destination, and if the navigation fails they revert to the committed path alongside the error

#### Scenario: The library's top is a slash
- **WHEN** the view is at the library's top
- **THEN** the breadcrumbs name the library, the input holds `/` once focused, and submitting `/` navigates there

#### Scenario: Escape gives the keyboard back
- **WHEN** the user tabs into the path bar from a tile, types, and presses Escape
- **THEN** the typed text is abandoned, the breadcrumbs return, and focus is back on the tile it came from

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
The server SHALL support a flat variant of the directory listing, requested by an explicit query flag; any other value of that flag, or its absence, SHALL yield the ordinary nested listing — except that a request carrying a file-search query without the flat flag SHALL be rejected rather than silently ignored (see the file-search capability). A flat listing SHALL return the requested root's immediate subdirectory and zip entries (top level only — deeper folders are not listed as tiles) followed by every model file recursively under the root — all of them when no file-search query narrows the walk; only matching ones when one does — the models ordered by **file name** with ties broken by the full relative path. The walk SHALL descend into subdirectories and into zip files' contents (one archive level; nested zip *file entries* are skipped, while a directory inside an archive whose name ends in `.zip` is walked normally), and SHALL skip hidden (dot-prefixed) filesystem entries, directories and files alike (archive members are opaque — see `library`, *Hidden entries are unreachable*) and unreadable subdirectories without failing the request.

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
The client SHALL offer a flat-view toggle alongside the path bar. While active, the grid SHALL show the current folder's flat listing — model tiles first, labeled by **file name**, with the entry's full relative path carried in the tile's tooltip and accessible name and its containing folders on a line beneath the name (see *A result tile names the folder it lives in*), then the top-level folder and zip tiles, navigable exactly as in the nested view — and hover-warm, drag-to-orbit, the lightbox, and thumbnail/camera persistence SHALL behave exactly as in the nested view for the same models. Models lead because a flat view is asked for to see the models under a folder; the containers it also lists are a way onward and SHALL NOT bury the first model. The toggle SHALL remain in effect across navigation within the session, including navigation into a zip, and a truncated listing SHALL be indicated to the user.

Toggling SHALL re-request the user's newest navigation target: the in-flight target while a navigation is still loading, otherwise the committed path of the listing on screen. When the newest navigation has failed, the toggle SHALL fall back to the committed path.

#### Scenario: Toggling flat view
- **WHEN** the user activates the flat toggle on a folder with nested models
- **THEN** the grid re-renders showing all models recursively, each labeled by file name with its relative path in the tooltip and its folders beneath the name, followed by the folder's top-level containers, and deactivating it restores the nested view

#### Scenario: Navigating down while flat
- **WHEN** flat view is active and the user clicks one of the top-level folder tiles
- **THEN** the grid shows that folder's flat listing (its own recursive models and top-level containers)

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
A directory tile SHALL show up to four thumbnails of models found within it, arranged as a contact sheet, with the directory's name beneath. The models SHALL be chosen from the index first, where it is ready and covers the location: the index is asked for the models it holds under the directory — no filesystem walk — and the sheet is the first posed ones in the index's deterministic order, unposed indexed ones filling remaining cells; each such path is confined exactly as a search hit is. When that answer names fewer models than the sheet holds, the remaining cells SHALL be filled from the walk's finds, deduplicated by path, so a sheet is never emptier than the walk alone would have made it. Only when that answer is empty, or the index is silent, SHALL the models be chosen entirely by a bounded, deterministic walk of the directory — at each level its models in sorted order before its subdirectories in sorted order, descending in that order — preferring models the index holds an orientation for: the walk runs to its entry bound, one bounded request to the index decides which finds are posed, and the sheet is the posed finds in walk order, models found without a pose filling the remaining cells in walk order. Posedness comes from the index in one bounded request over the walk's finds; when the index is absent, warming, or does not cover the location, the selection is the walk's first four models exactly as before, so the preview never waits on the index. The same directory with the same index answer previews the same models on every visit and on every machine. The walk SHALL examine no more than a fixed number of entries, counting every entry it stats at any level, so a single wide directory is bounded too, and SHALL take a level's entries in code-point name order before counting — not a locale collation — so that the bound cuts the same entries on every machine; a directory that exhausts that bound before four posed models are found SHALL preview the posed ones found, filled out with unposed finds in walk order. A peek is its own request: never served from or merged into a recursive listing, and — being bounded — run to completion rather than stopped when its tile has scrolled away. A peek SHALL be confined exactly as a listing is: an entry that resolves outside the library is neither previewed nor descended into. The preview SHALL be requested per tile, when the tile comes on screen or within the prefetch band of it — the same boundary the thumbnail queue ranks work as near by, so a sheet is usually landed before its tile is seen — through a server endpoint that returns the previewed models as ordinary listing entries; a directory listing SHALL NOT compute previews. Preview thumbnails SHALL be produced, cached and refreshed exactly as a model tile's thumbnail is, sharing an entry with the same model wherever it appears. A directory with no previewable models, an unreadable directory, a tile whose preview has not yet answered, or a tile whose preview request failed SHALL show its own icon — for a directory that icon is the folder chrome, drawn whether or not a preview has landed, so a landing preview fills it rather than replacing a different resting icon; fewer than four previews SHALL fill the sheet without empty cells.

A directory **inside** an archive SHALL be previewed like any other directory, and the tile of the **archive itself** SHALL NOT be previewed. An archive interior's models SHALL be chosen from the archive's own entries under that directory's prefix, taken in code-point name order under the same entry bound, its models before its subdirectories, so the sheet is deterministic and bounded exactly as a filesystem directory's is. The entries SHALL be read through the layer that holds them against the archive's `{mtime, size}` wherever one is available, by the listing and by the previews alike, so that browsing an archive and previewing the directories it holds do not each pay their own read of it. No filesystem descent is involved and nothing inside an archive can leave the library, so confinement is decided by the archive's own path; a nested archive is not enterable and is neither previewed nor descended into, and a path inside an archive that names a file rather than a directory SHALL be refused as a listing of that path refuses it rather than answered as an empty sheet. The index is **not** consulted for an archive interior — nothing inside an archive is embedded, and such paths are excluded structurally before the index is asked — so an interior's sheet is always the walk's own choice in walk order, and no part of it waits on the index. An interior's sheet SHALL be recorded against the containing archive's modification time and SHALL be re-derived rather than served once that has moved — including a sheet that is **empty**, which has no cell of its own to disagree with the archive and would otherwise be served unchanged for as long as the server ran. A sheet held with no such record SHALL be re-derived rather than trusted. Names beginning with a dot SHALL be skipped when choosing an interior's models, as they are skipped when choosing a filesystem directory's; a listing of that interior still shows them, since what a sheet declines to draw and what a listing declines to name are different questions. This does not contradict the rule above that archive members are opaque to the hidden-entry test (`library`, *Hidden entries are unreachable*): that rule is about what a listing may name and a path may reach, and this one is about what a sheet chooses to draw out of what the listing already shows — a real library's archives carry `__MACOSX` trees whose `._name.stl` resource forks are reachable, listed, and not models.

#### Scenario: A kit shows its parts
- **WHEN** a directory containing several models is on screen as a tile
- **THEN** the tile shows thumbnails of four of its models as a 2×2 sheet — the first four posed ones in name order where the index answers, its first four in name order where it does not — and its name

#### Scenario: A folder of folders shows its first kit
- **WHEN** a directory whose own level holds only subdirectories is on screen as a tile
- **THEN** the tile shows the first four models found by descending its subdirectories in order

#### Scenario: Fewer than four
- **WHEN** a directory holds one, two or three models and nothing below them
- **THEN** the tile shows that many thumbnails filling the sheet, with no empty cells

#### Scenario: A folder inside a zip shows its parts
- **WHEN** a directory inside an archive is on screen as a tile — reached by browsing into the archive, or emitted as a match by a deep search that never opened it
- **THEN** the tile shows thumbnails of the models under it, chosen from the archive's entries under that directory's prefix, exactly as a filesystem directory's tile is filled

#### Scenario: An interior's cells are the archive's own entries
- **WHEN** a model inside an archive appears both in a folder tile's sheet and as its own tile in a listing of that directory
- **THEN** both carry the same entry — the same path and the same modification time, taken from the containing archive — so both draw one cached thumbnail rather than two

#### Scenario: A path inside an archive that is not a directory
- **WHEN** a preview is asked for a path inside an archive that names a file entry or a nested archive
- **THEN** it is refused exactly as a listing of that path is refused, rather than answered as a sheet with nothing in it

#### Scenario: A zip tile keeps its icon
- **WHEN** an archive is on screen as a tile in the directory that holds it
- **THEN** the tile shows the archive icon and no archive is opened to fill it

#### Scenario: Previewing an archive's folders does not read it per tile
- **WHEN** an archive is listed and several of the directories inside it are previewed
- **THEN** the archive's entries are read through the layer that holds them rather than once for the listing and once per tile

#### Scenario: A rewritten archive drops its interiors' sheets
- **WHEN** an archive is rewritten in place and its contents are listed again, so its entries carry a modification time later than the one the held sheets were derived against
- **THEN** those sheets are re-derived rather than served from the version that is gone, and their cells never draw against a thumbnail keyed on the archive that is gone

#### Scenario: Nothing to preview
- **WHEN** a directory holds no models within the walk's bound, or cannot be read, or is an archive's own tile, or is a nested archive inside one
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
- **WHEN** the same directory is previewed twice, or on two machines holding the same library, with the index answering the same poses — or not answering — in both, an archive interior included
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

### Requirement: Retracing restores the grid's place
Retracing a navigation SHALL return the grid to the place it was left, and arriving SHALL
NOT. A history entry's place SHALL be remembered as an anchor tile and that tile's offset
from the scrollport's top edge — not as a scroll offset — so that the place survives a
change of window size or of the listing's contents by the tile rather than by the pixel.
Going back, going forward, and dismissing a subject SHALL land the entry they arrive at
where it was left. Navigating to the parent SHALL land where the parent was when the user
went into the child — found by tracing the history that led here, not by the parent's
latest visit on any other branch — and SHALL change the path alone, keeping the user's
flat or nested choice. Entering a folder from a tile, opening a typed path or a deep link,
and committing a new search or similarity view SHALL land at the top, except that a
revealed entry is brought into view centred as the reveal already requires. Where a
remembered anchor is not in the listing that landed, the place SHALL fall through: for
the parent, to the child folder tile centred where that tile exists, else the top; for
every other retrace, to the top. The remembered place SHALL live with the history entry
for the session and SHALL NOT be restored by any arrival that is not a retrace.

#### Scenario: Back to a listing that has to be fetched again
- **WHEN** the user scrolls a listing, follows a tile into a folder, and goes back
- **THEN** the listing is fetched again and lands with the same tile at the same offset from the top edge as when it was left

#### Scenario: Dismissing a search raised from halfway down
- **WHEN** the user scrolls a listing, commits a search from it, and dismisses the search
- **THEN** the listing lands where it was left

#### Scenario: Up returns to the view the user went in from
- **WHEN** the user scrolls a listing, enters a folder from it, and navigates to the parent
- **THEN** the parent lands with the same tile at the same offset as when the user went in

#### Scenario: Up finds the visit that led here, not a later one
- **WHEN** the user enters a folder from a scrolled parent, raises and dismisses a search, and then navigates to the parent
- **THEN** the parent lands where it was when the user went into the folder

#### Scenario: Up from a deep arrival centres the child
- **WHEN** the user opens a folder by deep link or typed path and navigates to the parent
- **THEN** the parent lands with the folder the user came out of centred in view

#### Scenario: Up keeps the flat choice and falls through
- **WHEN** the user enters a folder from a nested parent, switches to flat, and navigates to the parent
- **THEN** the parent lands flat, and — the remembered anchor being a folder that flat does not show, and the child likewise — at the top

#### Scenario: Arriving lands at the top
- **WHEN** the user enters a folder from a tile, types a path, opens a deep link, or commits a new search
- **THEN** the grid lands at the top, whatever that listing looked like on an earlier visit

#### Scenario: A window resized in between
- **WHEN** the window is resized between leaving a listing and going back to it
- **THEN** the remembered anchor tile is the tile at the remembered offset, whatever its new row

#### Scenario: Closing the lightbox keeps the place
- **WHEN** the user opens a model from a scrolled listing and closes it
- **THEN** the listing is exactly as it was, nothing re-fetched and nothing moved

### Requirement: Arrow-key focus movement across the grid
When a grid tile has keyboard focus, the arrow keys pressed without a modifier SHALL move
focus between tiles. `ArrowRight` and `ArrowLeft` SHALL move focus to the next and previous
tile in listing order; `ArrowDown` and `ArrowUp` SHALL move focus by one row — down and up a
column — where the number of columns is whatever the responsive grid is currently displaying.
Focus movement SHALL stop at the grid's edges: `ArrowLeft` on the first tile and `ArrowRight`
on the last SHALL leave focus unchanged, `ArrowUp` from the top row SHALL be inert (it SHALL
NOT move focus sideways), and `ArrowDown` from the bottom row SHALL be inert — except that a
downward step from a full row into a shorter final row below SHALL land on the last tile.
When **nothing** holds focus — the document's active element is its body, as after a fresh
load or a click on empty space — an unmodified arrow key, whichever of the four, SHALL move
focus to the first tile of the grid rather than doing nothing, provided no modal view is open
over the grid; while the lightbox is open the arrows are its own, whatever holds focus.
`ArrowDown` pressed in the search input, or in the find control's input, SHALL move focus to
the first tile the grid shows: those fields sit above the grid, and down from them is down
into it. In every other case the arrow keys SHALL act only when a grid tile already holds
focus; arrow keys pressed elsewhere — the path bar, the other arrows in the search and find
inputs, or any control outside the grid — SHALL be left to their own behaviour, and an arrow
that moves focus SHALL move it rather than scrolling the surrounding view, though the view MAY
scroll to keep the newly focused tile visible. Tab SHALL continue to reach the tiles as
before, and a tile reached by an arrow SHALL activate on Enter or Space exactly as one reached
by Tab does.

#### Scenario: Arrow keys move focus between tiles
- **WHEN** a grid tile has focus and the user presses ArrowRight, then ArrowLeft
- **THEN** focus moves to the next tile in listing order, then back to the tile it started on

#### Scenario: Up and down move by a row
- **WHEN** a tile has focus and the user presses ArrowDown, then ArrowUp
- **THEN** focus moves down one row and back up, by the grid's current column count

#### Scenario: Focus stops at the horizontal edges
- **WHEN** the first tile has focus and the user presses ArrowLeft, and when the last tile has focus and the user presses ArrowRight
- **THEN** focus stays on the same tile in each case

#### Scenario: Up from the top row does not move sideways
- **WHEN** a tile in the top row (not the first tile) has focus and the user presses ArrowUp
- **THEN** focus stays on that tile — it does not slide to the first tile of the row

#### Scenario: Down into a short final row lands on the last tile
- **WHEN** a tile in the last full row has focus, the row below it is partial, and a straight-down step would fall past the end
- **THEN** focus moves to the last tile

#### Scenario: Arrows outside the grid are untouched
- **WHEN** the path bar has focus and the user presses any arrow key, or the find input or the search input has focus and the user presses ArrowLeft, ArrowRight or ArrowUp
- **THEN** the arrow behaves as it does in that field and no grid tile's focus changes

#### Scenario: Down from a field above the grid enters it
- **WHEN** the search input or the find input has focus and the user presses ArrowDown
- **THEN** the first tile the grid shows takes focus — under a find filter, the first tile the filter left standing

#### Scenario: A tile reached by arrow opens like any other
- **WHEN** the user moves to a tile with the arrow keys and presses Enter or Space
- **THEN** the tile activates — a model opens in the lightbox, a folder or zip is entered — as if it had been reached by Tab

#### Scenario: An arrow with nothing focused lands on the first tile
- **WHEN** nothing holds focus and the user presses any arrow key without a modifier
- **THEN** the first tile takes focus, and the page does not scroll for that press

#### Scenario: An unfocused arrow is the lightbox's while it is open
- **WHEN** the lightbox is open, nothing holds focus, and the user presses ArrowRight
- **THEN** the lightbox steps to the next model and no grid tile takes focus

### Requirement: Breadcrumbs stand over the path bar
While the path bar is not being edited, the client SHALL present the current location as a
row of breadcrumbs: the library's top first, then one crumb per folder, a zip archive being a
crumb of its own that enters the archive. Activating a crumb SHALL navigate to it; activating
the bar where no crumb stands SHALL focus the input for typing. The current location's crumb
SHALL be marked as the current location for assistive technology, and the top's crumb SHALL
carry an accessible name for the library even where its visible label is reduced to a glyph.
The header's brand SHALL navigate to the library's top, so the top stays one press away
whatever the crumbs show.

When the crumbs do not fit, the client SHALL fold them by **measuring** the row rather than by
counting crumbs, in this order: every crumb whole; the top, a fold, the parent and the current
location; the top, a fold and the current location, where the current location's name may
shrink but not below a readable width (or its own width, if shorter); and finally a fold and
the current location alone. A fold SHALL be a control that opens the path for typing. The
folding SHALL be re-measured whenever the path or the room available changes, and a path too
short to fold SHALL be shown whole.

#### Scenario: A crumb navigates
- **WHEN** the user is three folders deep and activates the first folder's crumb
- **THEN** the grid shows that folder's listing and the crumbs end at it

#### Scenario: The empty part of the bar edits
- **WHEN** the user clicks the bar past its last crumb
- **THEN** the input takes focus and shows the path as text

#### Scenario: A deep path folds its middle first
- **WHEN** a path's crumbs overflow the bar at full width
- **THEN** the middle crumbs fold into one control and the top, the parent and the current location stay, and only if that still overflows does the parent fold too

#### Scenario: The current name is never crushed
- **WHEN** the room left for the current location's name would fall below a readable width with the top still shown
- **THEN** the top folds away rather than the name being squeezed further

#### Scenario: An archive is a crumb
- **WHEN** the location is a folder inside `kit.zip`
- **THEN** a crumb names the archive and activating it lists the archive's contents

### Requirement: The results line says what the grid holds and what it is waiting for
Above the grid the client SHALL draw one results line whose height does not depend on
whether a listing is in flight. Over a committed view it SHALL lead with a **count** — the
number of results, or the qualified phrases the meaning and similarity requirements define
(see `semantic-search`, `entry-actions`) — then the committed query or source model as a
chip, then the one dismissal control; qualifying notes
and caveats SHALL go on a line of their own beneath it rather than lengthen the first. A
narrow screen SHALL truncate the chip, never the count. Over a plain listing the line SHALL
summarise the listing by kind — folders, archives and models, each with its count, omitting a
kind with none.

The line SHALL carry one status slot, showing at most one of these, in this order of
precedence: while a request the user asked for is in flight, what it is for — the query being
searched for, the model whose neighbours are being found, or the location being opened; while
a background revalidation of the listing on screen runs, that it is refreshing; otherwise,
while models on screen — a folder's sheet cells included — are still waiting for a first
picture, how many, shown only after a short delay so a set the caches answer at once never
flashes a count. Over the in-flight skeleton the line SHALL describe the wait and nothing that
left: the status slot SHALL NOT be drawn, since the renders it would count belong to the
listing that left; neither SHALL the departed view's count, query or notes, since the answer
they describe is no longer on screen; and in their place the line SHALL say what the wait is
for. While a request the user asked for is in
flight and before the skeleton replaces it, the grid on screen SHALL be drawn dimmed, so a
press on the old answer does not read as the new one.

Dismissing a committed view SHALL empty the search input as well, since the text no longer
names anything on screen. A brief confirmation — a copied path — SHALL be shown without
moving the grid; an error SHALL stay in the page's flow until dealt with.

#### Scenario: The count comes first
- **WHEN** a name search for "dragon" returns 81 entries
- **THEN** the line reads "81 results", then the chip "“dragon”", then the dismissal, and a narrow screen shortens the chip rather than the count

#### Scenario: A plain listing is summarised
- **WHEN** a folder holding 26 folders, 14 archives and 33 models is listed with nothing committed
- **THEN** the line summarises it by kind, e.g. "26 folders · 14 archives · 33 models"

#### Scenario: The wait says what it is for
- **WHEN** the user submits a search and its answer has not arrived
- **THEN** the status slot says it is searching for that query and the previous grid is dimmed until the answer or the skeleton replaces it

#### Scenario: The skeleton carries nothing of the view that left
- **WHEN** search results are on screen and the user goes up to a listing slow enough for the skeleton to show
- **THEN** the line over the skeleton says the location is being opened, and shows neither the search's count nor its query

#### Scenario: Rendering is counted once, not per tile
- **WHEN** a listing lands with uncached models and folders whose sheets are uncached
- **THEN** after a short delay the line says how many thumbnails are still rendering, counting the sheet cells, and the count goes when they have all drawn

#### Scenario: A refresh outranks the renders
- **WHEN** a background revalidation runs while thumbnails are still rendering
- **THEN** the status slot says the listing is refreshing and not the render count

#### Scenario: Dismissing empties the box
- **WHEN** the user dismisses a committed search
- **THEN** the listing returns and the search input is empty

### Requirement: Keyboard focus stays with the user's place
When a navigation lands — entering a folder, going up, dismissing a committed view — and
nothing holds focus because the element that did left with the listing it belonged to, the
client SHALL put focus on a tile: going up, on the tile of the folder just left where it is in
the listing; otherwise, on the first tile. It SHALL NOT take focus from an element that holds
it, and SHALL NOT scroll the grid to do so, since the landing place is the retrace rule's (see
*Retracing restores the grid's place*).

`/` pressed without a modifier, outside a text field, with no lightbox or menu open, SHALL
focus the search input and select its text. The platform's find shortcut SHALL open the find
control from an empty search input too, since an empty box is not a draft the browser's own
find would serve. Closing the find control from inside it SHALL return focus to the tile that
held it when the control was opened, where that tile is still shown, and otherwise to the
first tile. Revealing the rest of a weak meaning set (see `semantic-search`) SHALL move focus
onto the first result it reveals.

#### Scenario: Entering a folder keeps the keyboard in the grid
- **WHEN** the user presses Enter on a folder tile and its listing lands
- **THEN** the first tile of the new listing has focus, so the next Tab or arrow continues from the grid rather than from the top of the page

#### Scenario: Going up lands on the folder left
- **WHEN** the user goes up from a folder by keyboard
- **THEN** the parent's tile for that folder has focus

#### Scenario: Focus that is held is left alone
- **WHEN** a navigation lands while the search input holds focus
- **THEN** the search input keeps it

#### Scenario: Slash to search
- **WHEN** a tile has focus and the user presses `/`
- **THEN** the search input takes focus with its text selected, and no `/` is typed into it

#### Scenario: Escape from Narrow returns to the tile
- **WHEN** the user opens the find control from a focused tile, types, and presses Escape
- **THEN** the control closes, the grid is unfiltered, and that tile has focus again

### Requirement: A result tile names the folder it lives in
Wherever a tile's entry is named by a path relative to where the view was asked — a flat
view, a name search, a meaning search — the tile SHALL carry, beneath its label, a line
naming the folders that hold it, so two same-named models from different kits do not read
as duplicates. The nearest folder SHALL be kept whole and the rest give way from its end when
the line is short of room. For a model inside an archive the archive's name SHALL be kept
whole in that line, marked as an archive, since it is what tells the archived copy from an
extracted twin. A tile whose entry sits directly in the listed folder SHALL carry no such line.

#### Scenario: Two parts with one name
- **WHEN** a flat view lists `KitA/base.stl` and `KitB/base.stl`
- **THEN** both tiles are labelled `base.stl`, one with `KitA` beneath and the other with `KitB`

#### Scenario: An archived copy says so
- **WHEN** a search returns `Kit/parts.zip!/arm.stl`
- **THEN** the line beneath its name names `parts.zip` as an archive

#### Scenario: A plain listing carries no line
- **WHEN** a folder is listed nested
- **THEN** its tiles carry no folder line

### Requirement: Tile size is the profile's choice
The client SHALL offer small, medium and large tiles where the screen has room for the
choice, SHALL persist the choice per browser profile, and SHALL NOT carry it in the URL, since
it changes how a view is drawn and not which entries it contains. The in-flight skeleton SHALL
be drawn at the size in force, so the grid does not change shape when the listing lands.

#### Scenario: A size survives a reload
- **WHEN** the user picks large tiles and reloads
- **THEN** the grid is drawn with large tiles and the URL is unchanged by the choice

### Requirement: A location that cannot be opened says so in the grid's place
When a listing fails and no listing has landed to keep on screen — a link naming a location
that does not exist, opened with nothing before it — the client SHALL say,
where the grid would be, that the location could not be opened, naming it, and SHALL offer a
way to the library's top unless that location *is* the top. It SHALL NOT say the location is
empty, which is a claim about a folder that may not exist. Where a listing has landed — an
empty folder's included, which is a listing with nothing in it rather than a failure — a later
failure SHALL keep leaving it there as the path bar's requirement states.

#### Scenario: A dead link
- **WHEN** a URL naming a folder that no longer exists is opened fresh
- **THEN** the page says the folder could not be opened and offers to go to the library, rather than showing an empty grid

#### Scenario: An empty folder is not a failure
- **WHEN** an empty folder is listed and the user then submits a path that does not exist
- **THEN** the error is shown and the empty folder stays as it was, not replaced by the could-not-open state
