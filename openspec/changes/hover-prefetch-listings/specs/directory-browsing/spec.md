## ADDED Requirements

### Requirement: Hover-warmed listings
The client SHALL warm a folder or zip tile's listing when the pointer has rested on the tile for the same linger threshold that warms a model tile's mesh: it SHALL request the plain listing the tile's click would request — the same path, the flat and folder-matching options in force, and no query — and hold the answer briefly on the client. A navigation whose request matches a held answer SHALL land from it without a listing request, through the same landing every fetched listing goes through, so the URL, the recent directories, the pose wave, and the stale follow-up behave exactly as they do for a fetched landing; a held answer the server marked stale SHALL land marked stale. A navigation that arrives while the warm's request is still in flight SHALL land from that request rather than issuing a second. A held answer SHALL be consumed by the navigation that uses it and SHALL expire unused after a short bound. A tile crossed faster than the linger threshold SHALL trigger no request, the number of warm requests in flight at once SHALL be capped, and a warm request SHALL never be a flat listing, a search, or a similarity query. Nothing in a warm SHALL write the URL, the recent directories, or the grid: the pointer resting on a tile is not a navigation.

#### Scenario: A warmed folder opens without a listing request
- **WHEN** the pointer rests on a folder tile past the linger threshold, the warm's listing request completes, and the user then clicks the tile
- **THEN** the folder's listing renders with no further listing request, and the URL, the recent directories, and the pose wave behave exactly as after a fetched landing

#### Scenario: A click that beats the warm joins it
- **WHEN** the user clicks a folder tile while its warm request is still in flight
- **THEN** exactly one listing request is made for that folder, and the click lands from it

#### Scenario: Sweeping across folder tiles
- **WHEN** the cursor crosses many folder tiles faster than the linger threshold
- **THEN** no listing request is made for the tiles that were only transiently crossed

#### Scenario: A stale warm keeps its marker
- **WHEN** a warm's answer was marked stale by the server and the user then clicks the tile
- **THEN** the listing lands marked stale, the stale affordance shows, and the one follow-up request is made exactly as for a fetched stale landing

#### Scenario: Options changed between hover and click
- **WHEN** the pointer rests on a folder tile, the user then toggles the flat view, and then clicks the tile
- **THEN** the held answer is not used and the listing is requested as the click's options ask

#### Scenario: A warm never navigates
- **WHEN** the pointer rests on a folder tile past the linger threshold and the user moves away without clicking
- **THEN** the URL, the recent directories, and the grid are unchanged

### Requirement: A warmed listing warms its first screenful of thumbnails
When a listing warm's request completes, the client SHALL start image fetches for the leading entries of the answer whose thumbnail facts name a render the client would draw without a lookup — under the client's own recipe constants and the occlusion variant currently in force — using the same image URL the tile will draw from, so the tile's later image load is a cache hit. The count SHALL be bounded to about one screen of tiles. Entries with no drawable render SHALL NOT be rendered on hover: no thumbnail lookup and no render is issued for a folder that is not on screen.

#### Scenario: A warmed folder's tiles paint from cache
- **WHEN** a folder whose leading entries all carry a current, usable render is warmed and then opened
- **THEN** those tiles' images are served from the browser cache rather than fetched after the grid mounts

#### Scenario: An unrendered entry is left alone
- **WHEN** a warmed listing carries entries with no current render
- **THEN** no lookup and no render is issued for them until their tiles come on screen in the ordinary way

#### Scenario: The warm fetches the variant the tile will use
- **WHEN** the occlusion variant in force is the no-AO variant and a folder is warmed
- **THEN** the no-AO image URLs are fetched, and the tiles drawn after the click use those same URLs
