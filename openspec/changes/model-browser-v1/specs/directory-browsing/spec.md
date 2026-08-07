## ADDED Requirements

### Requirement: Directory listing
The server SHALL list the contents of any readable local directory, returning subdirectories, zip files, and model files (`.stl`, `.3mf`, `.obj`) with name, type, size, and mtime. Other file types SHALL be omitted from the listing.

#### Scenario: Listing a directory
- **WHEN** the client requests a listing for a valid directory path
- **THEN** the response contains its subdirectories, zip files, and model files with name, type, size, and mtime

#### Scenario: Invalid path
- **WHEN** the client requests a listing for a path that does not exist or is not readable
- **THEN** the server responds with an error the UI surfaces without crashing

### Requirement: Thumbnail grid navigation
The client SHALL display directory contents as a responsive grid. Activating a subdirectory or zip tile SHALL navigate into it; the current location SHALL always be reflected in the path bar.

#### Scenario: Entering a subdirectory
- **WHEN** the user clicks a subdirectory tile
- **THEN** the grid shows that directory's contents and the path bar updates to its path

#### Scenario: Navigating up
- **WHEN** the user navigates to the parent of the current location
- **THEN** the grid and path bar reflect the parent directory

### Requirement: Editable path bar
The UI SHALL show the current directory path in an editable text input at the top. Submitting a valid path SHALL navigate there; an invalid path SHALL show an error and leave the current view unchanged.

#### Scenario: Typing a valid path
- **WHEN** the user edits the path bar to a valid directory and submits
- **THEN** the grid shows that directory's contents

#### Scenario: Typing an invalid path
- **WHEN** the user submits a nonexistent path
- **THEN** an error is shown and the current grid remains

### Requirement: Server-backed path autocomplete
While editing the path bar, the UI SHALL offer completion suggestions for the partial path from a server endpoint that lists matching subdirectories.

#### Scenario: Completing a partial path
- **WHEN** the user has typed a partial path whose parent directory exists
- **THEN** matching subdirectory completions are suggested and selecting one fills the path bar

### Requirement: Recent directories
The client SHALL persist recently visited directories in localStorage and offer them as suggestions when the path bar is focused.

#### Scenario: Revisiting a recent directory
- **WHEN** the user focuses the path bar after previously visiting directories
- **THEN** recent directories are listed and selecting one navigates there
