## ADDED Requirements

### Requirement: A tile's position is where it lies, not whether it is drawn
This requirement qualifies *Client-side thumbnail rendering*'s positions, and the moment
`directory-browsing`'s *Folder tiles preview their contents* asks for a folder's preview,
for a grid that keeps only the tiles near the view in the document (see `directory-browsing`,
*The grid draws only what is near the view*). A tile's position SHALL be decided by where the
tile lies in the grid's layout relative to the viewport, whether or not it is in the document:
on screen where its row meets the viewport, near where its row lies within the prefetch band
around the viewport, and far otherwise. Every entry of the shown listing SHALL therefore have a
reported position — an entry SHALL NOT go unreported for not being in the document, since where
it lies is known. A folder's preview SHALL be requested when its tile's position becomes on
screen or near, whether or not the tile is in the document. Positions SHALL be re-derived as the
view scrolls, as its size changes, and as the listing changes. Where rows the grid has not yet
drawn are placed by an estimated height, positions SHALL be decided by that estimate until the
rows are drawn. Every other rule of *Client-side thumbnail rendering* — how positions order work,
a position one step farther for a model shown only inside another tile, the nearest of several
positions winning, and a model hidden by a filter being reported far by the one layer that knows
it was hidden — applies unchanged.

#### Scenario: A tile below the drawn rows is still near
- **WHEN** a long uncached listing is opened at its top, and a tile lies below the rows in the document but within the prefetch band
- **THEN** its render is ranked near, ahead of work for tiles farther down, and if it is a folder its preview is requested

#### Scenario: A tile far down is far, not unreported
- **WHEN** a long uncached listing is opened at its top
- **THEN** a tile far below the view is ranked far — its work is taken only once nothing nearer is pending — rather than taken in listing order as an unreported tile's would be

#### Scenario: Scrolling re-ranks tiles that were never drawn
- **WHEN** the user scrolls quickly to the end of a long uncached listing and stops
- **THEN** the tiles now on screen are rendered next, including tiles whose rows were never drawn while the user was scrolling past them
