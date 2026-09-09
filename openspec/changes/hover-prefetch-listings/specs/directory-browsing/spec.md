## ADDED Requirements

### Requirement: Hover-warmed listings
The client SHALL warm a folder or zip tile's listing when the pointer has rested on the tile for the same linger threshold that warms a model tile's mesh: it SHALL request the plain listing the tile's click would request — the same path, the flat and folder-matching options in force, and no query — and hold the answer briefly on the client. A navigation whose request matches a held answer SHALL land from it without a listing
request, through the same landing every fetched listing goes through, so the URL, the
recent directories, the pose wave and the stale follow-up behave exactly as they do for a
fetched landing, and whatever the answer carried the landing carries. A request made to
refresh a listing already landed SHALL NOT be answered from a held answer, since it is
asking for the very thing it would be given. A navigation that arrives while the warm's request is still in flight SHALL land from that request rather than issuing a second. A held answer SHALL be consumed by the navigation that uses it and SHALL expire unused after a short bound. A tile crossed faster than the linger threshold SHALL trigger no request, and the number
of warm requests in flight at once SHALL be capped. A warm SHALL never be a search or a
similarity query, and SHALL NOT happen at all while the view is flat: a flat listing walks
a subtree rather than reading a directory, and putting an unbounded, uncancellable
traversal behind a pointer is not a thing a hover may do. A warm whose request fails SHALL
be discarded rather than held, so that a navigation is never answered with a failure it
did not make. Nothing in a warm SHALL write the URL, the recent directories, or the grid: the pointer resting on a tile is not a navigation.

#### Scenario: A warmed folder opens without a listing request
- **WHEN** the pointer rests on a folder tile past the linger threshold, the warm's listing request completes, and the user then clicks the tile
- **THEN** the folder's listing renders with no further listing request, and the URL, the recent directories, and the pose wave behave exactly as after a fetched landing

#### Scenario: A click that beats the warm joins it
- **WHEN** the user clicks a folder tile while its warm request is still in flight
- **THEN** exactly one listing request is made for that folder, and the click lands from it

#### Scenario: Sweeping across folder tiles
- **WHEN** the cursor crosses many folder tiles faster than the linger threshold
- **THEN** no listing request is made for the tiles that were only transiently crossed



#### Scenario: Hovering while the view is flat warms nothing
- **WHEN** the pointer rests past the linger threshold on a folder tile while the flat view is on
- **THEN** no request is made, and the click fetches its listing as it does today

#### Scenario: A warm that failed is not what the click gets
- **WHEN** a warm's request fails and the user then clicks the tile
- **THEN** the click makes its own listing request rather than inheriting the failure

#### Scenario: Options changed between hover and click
- **WHEN** the pointer rests on a folder tile, the user then changes an option the request carries, and then clicks the tile
- **THEN** the held answer is not used and the listing is requested as the click's options ask

#### Scenario: A warm never navigates
- **WHEN** the pointer rests on a folder tile past the linger threshold and the user moves away without clicking
- **THEN** the URL, the recent directories, and the grid are unchanged
