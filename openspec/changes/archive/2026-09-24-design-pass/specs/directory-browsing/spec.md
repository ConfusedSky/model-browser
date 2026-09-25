## MODIFIED Requirements

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

## ADDED Requirements

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
