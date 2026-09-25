## ADDED Requirements

### Requirement: The grid draws only what is near the view
The grid SHALL keep in the document only the tiles of the rows within the viewport and a
margin around it, together with the rows it must keep for the keyboard: the first row, so the
keyboard entering the grid from above lands on the first tile; and the row of the tile that
last held keyboard focus, until another tile takes focus or that entry leaves the listing, so
a control that returns focus to the tile it came from finds it. The number of tiles in the document SHALL NOT grow with the
length of the listing. The grid's scroll extent SHALL still describe the whole listing, and
a row drawn for the first time SHALL NOT move what is on screen when its real height differs
from the height it was given before it was drawn.

No behaviour of the grid SHALL depend on whether a tile happens to be in the document. In
particular:

- Tab and Shift+Tab SHALL reach every tile in listing order, as they did when every tile was
  in the document.
- The arrow keys SHALL step over the entries the grid shows, by the column count it is
  displaying, exactly as *Arrow-key focus movement across the grid* requires, whether or not
  the tile stepped to is in the document; the view SHALL scroll to keep that tile visible.
- A tile holding keyboard focus SHALL keep it while the user scrolls the grid away from it,
  so the next Tab or arrow continues from that tile — Tab to the tile after it in listing
  order, not to whatever tile happens to be drawn next.
- Retracing SHALL land an anchor that was not in the document exactly as one that was (see
  *Retracing restores the grid's place*), and a reveal SHALL centre and mark an entry that was
  not in the document exactly as one that was (see `entry-actions`, *Reveal an entry in its
  containing folder*).
- Every rule that puts focus on a tile — a landing navigation's, the find control's close,
  a weak meaning set's reveal (see *Keyboard focus stays with the user's place*), and the
  lightbox's close (see `model-viewer`, *Lightbox steps between sibling models*) — SHALL put
  it on that tile whether or not it was in the document, scrolling where that rule scrolls
  and not scrolling where it does not.

When the number of columns changes while a listing is shown — the window is resized or the
tile size is changed — the entry at the top of the view SHALL stay at the top of the view,
rather than the grid keeping its scroll offset in pixels.

#### Scenario: A long listing keeps a screenful in the document
- **WHEN** a flat view of several hundred models is shown
- **THEN** only the tiles on and near the screen are in the document, and the scroll bar spans the whole listing

#### Scenario: Scrolling brings tiles in as they are reached
- **WHEN** the user scrolls to any part of a long listing
- **THEN** the tiles there are drawn and respond to presses, hovers and the entry menu exactly as the tiles at the top did

#### Scenario: Back to a place far down a long listing
- **WHEN** the user scrolls far into a long listing, enters a folder from it, and goes back
- **THEN** the listing lands with the same tile at the same offset from the top edge as when it was left

#### Scenario: A reveal far down a folder
- **WHEN** the user reveals a model that sits near the end of a long folder
- **THEN** the folder is listed with that model centred in view and marked

#### Scenario: Holding ArrowDown through a long listing
- **WHEN** a tile near the top has focus and the user presses ArrowDown repeatedly until well past the first screen
- **THEN** focus moves one row per press through every row in turn, and the view follows it

#### Scenario: Tabbing through a long listing
- **WHEN** the first tile has focus and the user presses Tab repeatedly past the first screen
- **THEN** each tile in listing order takes focus in turn, and none is skipped

#### Scenario: Focus is not lost by scrolling away
- **WHEN** a tile has focus, the user scrolls the grid far away from it with the wheel or by touch, and then presses ArrowRight
- **THEN** focus moves to the tile after the one that had it, and the view scrolls to show it

#### Scenario: Tab after scrolling away
- **WHEN** a tile near the top has focus, the user scrolls far down with the wheel or by touch, and presses Tab, then Shift+Tab
- **THEN** focus moves to the tile after the one that had it, then back to it, and the view scrolls to show each

#### Scenario: Escape from the path bar after scrolling
- **WHEN** the user tabs from a tile into the path bar, scrolls the grid far away while editing, and presses Escape
- **THEN** the edit is abandoned and focus is back on the tile it came from

#### Scenario: Closing the lightbox after stepping far
- **WHEN** the user opens a model from the top of a long listing, steps forward past the models that were on screen, and closes the lightbox
- **THEN** focus is on the tile of the model that was open, and that tile is in view

#### Scenario: Going up to a folder far from the place
- **WHEN** the user goes up by keyboard and the parent lands at its remembered place, with the tile of the folder just left well outside the view
- **THEN** that folder's tile has focus and the grid stays at the remembered place

#### Scenario: A resize keeps the top entry
- **WHEN** the user has scrolled a long listing and the window is resized so the grid gains or loses columns
- **THEN** the entry that was at the top of the view is still at the top of the view
