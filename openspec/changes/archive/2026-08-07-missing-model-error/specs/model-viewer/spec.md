## ADDED Requirements

### Requirement: Missing-model error feedback
When the mesh for an orbit overlay or lightbox fails to load — the file no longer exists, its zip entry is gone, or the model cannot be parsed — the viewer SHALL display an explicit error in place of the model rather than silently dismissing: the orbit overlay SHALL show a compact error indicator in the tile box, and the lightbox SHALL show the file name and the failure reason, keeping its normal close paths (Esc, outside click, close button). The same failure SHALL mark the model's grid tile with the error state so the stale cached thumbnail is no longer presented as a healthy model. An errored viewer SHALL NOT persist camera state, orbit axis, or a thumbnail, and dismissing it SHALL skip the settle/persist path. Clicking an errored orbit overlay SHALL still open the lightbox, where the full reason is readable.

#### Scenario: Opening the lightbox for a deleted model
- **WHEN** the user clicks a tile whose model file has been deleted since the thumbnail was cached
- **THEN** the lightbox opens and shows the file name with an explicit error (e.g. "no such file") instead of a spinner that silently vanishes, and closes only via the normal close paths

#### Scenario: Orbiting a deleted model
- **WHEN** the user presses and drags on a tile whose model file no longer exists
- **THEN** the orbit overlay shows an error indicator instead of the loading spinner, and the tile is marked with the error state after the overlay is dismissed

#### Scenario: No persistence from an errored viewer
- **WHEN** an errored lightbox is closed
- **THEN** no camera state, axis, or thumbnail is written to the server

#### Scenario: Errored overlay promotes to lightbox
- **WHEN** the user clicks (press-and-release without drag) on an errored orbit overlay
- **THEN** the lightbox opens showing the full error message

#### Scenario: Transient failure recovers on refresh
- **WHEN** a tile was marked errored and the user re-enters the directory after the failure cause is resolved
- **THEN** the thumbnail pipeline runs again and the tile returns to its normal rendering
