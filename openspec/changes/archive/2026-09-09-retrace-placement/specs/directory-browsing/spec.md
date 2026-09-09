## ADDED Requirements

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
