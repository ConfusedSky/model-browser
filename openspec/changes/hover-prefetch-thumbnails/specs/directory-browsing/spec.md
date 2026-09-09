# directory-browsing Delta

## ADDED Requirements

### Requirement: A warmed listing warms the thumbnails its first screen will draw
When a listing warm's request completes, the client SHALL start image fetches for the entries of the answer whose thumbnail facts name a render it would draw without a lookup — under the client's own recipe constants, the orientation the entry carries, and the occlusion variant in force — using the same image URL the tile will draw from, so the tile's later image load is a cache hit. Entries a listing carries inside another entry, as a folder tile's contact-sheet cells are carried, SHALL be reached as the entries drawn beside them are: a listing of folders draws images and a warm that walked only its top level would warm none of them. The number of images started SHALL be bounded to about one screen's worth, counted as images rather than as tiles. An entry naming no drawable render SHALL be left alone: no lookup and no render SHALL be issued for a tile that is not on screen, and warming SHALL NOT compete with the renders the visible grid is waiting on.

#### Scenario: A warmed folder's tiles paint from cache
- **WHEN** a folder whose leading entries all name a current, drawable render is warmed and then opened
- **THEN** those tiles' images are served from the browser's cache rather than fetched after the grid mounts

#### Scenario: A folder of folders warms its sheet cells
- **WHEN** the warmed listing's leading entries are folders carrying contact-sheet cells
- **THEN** the cells' images are the ones warmed, since they are what the screen will draw

#### Scenario: An unrendered entry is left alone
- **WHEN** a warmed listing carries entries naming no current render
- **THEN** no lookup and no render is issued for them until their tiles come on screen in the ordinary way

#### Scenario: The warm fetches the variant the tile will use
- **WHEN** the occlusion variant in force is the unoccluded one and a folder is warmed
- **THEN** the unoccluded image URLs are fetched, and the tiles drawn after the click use those same URLs
