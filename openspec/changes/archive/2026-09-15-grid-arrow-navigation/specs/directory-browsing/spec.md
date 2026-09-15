## ADDED Requirements

### Requirement: Arrow-key focus movement across the grid
When a grid tile has keyboard focus, the arrow keys pressed without a modifier SHALL move
focus between tiles. `ArrowRight` and `ArrowLeft` SHALL move focus to the next and previous
tile in listing order; `ArrowDown` and `ArrowUp` SHALL move focus by one row — down and up a
column — where the number of columns is whatever the responsive grid is currently displaying.
Focus movement SHALL stop at the grid's edges: `ArrowLeft` on the first tile and `ArrowRight`
on the last SHALL leave focus unchanged, `ArrowUp` from the top row SHALL be inert (it SHALL
NOT move focus sideways), and `ArrowDown` from the bottom row SHALL be inert — except that a
downward step from a full row into a shorter final row below SHALL land on the last tile. The
arrow keys SHALL act only when a grid tile already holds focus; arrow keys pressed elsewhere —
the path bar, the find input, or any control outside the grid — SHALL be left to their own
behaviour, and an arrow that moves focus SHALL move it rather than scrolling the surrounding
view, though the view MAY scroll to keep the newly focused tile visible. Tab SHALL continue to
reach the tiles as before, and a tile reached by an arrow SHALL activate on Enter or Space
exactly as one reached by Tab does.

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
- **WHEN** the find input or the path bar has focus and the user presses an arrow key
- **THEN** the arrow behaves as it does in that field and no grid tile's focus changes

#### Scenario: A tile reached by arrow opens like any other
- **WHEN** the user moves to a tile with the arrow keys and presses Enter or Space
- **THEN** the tile activates — a model opens in the lightbox, a folder or zip is entered — as if it had been reached by Tab
