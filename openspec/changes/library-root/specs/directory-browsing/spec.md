## MODIFIED Requirements

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

### Requirement: Editable path bar
The UI SHALL show the current library-relative path in an editable text input at the top, showing `/` at the library's top. The input SHALL reflect the user's newest navigation target as soon as the navigation is requested — before its listing arrives — and SHALL revert to the committed path when that navigation fails. Submitting a valid library path SHALL navigate there; an invalid path, or one outside the library, SHALL show an error and leave the current view unchanged.

#### Scenario: Typing a valid path
- **WHEN** the user edits the path bar to a valid library path and submits
- **THEN** the grid shows that directory's contents

#### Scenario: Typing an invalid path
- **WHEN** the user submits a nonexistent path
- **THEN** an error is shown and the current grid remains

#### Scenario: The bar reflects an in-flight navigation
- **WHEN** the user navigates while the destination's listing is still loading
- **THEN** the path bar already shows the destination, and if the navigation fails it reverts to the committed path alongside the error

#### Scenario: The library's top is a slash
- **WHEN** the view is at the library's top
- **THEN** the path bar shows `/`, and submitting `/` navigates there

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
