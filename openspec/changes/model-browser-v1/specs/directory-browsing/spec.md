## ADDED Requirements

### Requirement: Directory listing
The server SHALL list the contents of any readable local directory, returning subdirectories, zip files, and model files (`.stl`, `.3mf`, `.obj`) with name, type, size, and mtime. Other file types SHALL be omitted from the listing.

#### Scenario: Listing a directory
- **WHEN** the client requests a listing for a valid directory path
- **THEN** the response contains its subdirectories, zip files, and model files with name, type, size, and mtime

#### Scenario: Invalid path
- **WHEN** the client requests a listing for a path that does not exist or is not readable
- **THEN** the server responds with an error the UI surfaces without crashing

### Requirement: API restricted to the app's own origin
Because the server reads and serves arbitrary local paths as the user, the server SHALL bind to 127.0.0.1 only and SHALL reject every `/api/*` request that does not originate from the app itself: requests carrying an `Origin` header that is not a loopback origin SHALL be refused, requests whose `Host` header is not a loopback host SHALL be refused, and CORS headers SHALL never be emitted. Localhost binding alone is NOT sufficient, since any page open in the user's browser can reach a localhost port. Because no-cors subresource embeds (`<img src>`, `<script src>`) carry no `Origin` header and so pass the origin check, model bytes SHALL be served as `Content-Type: application/octet-stream` with `X-Content-Type-Options: nosniff`.

#### Scenario: Another site probes the API
- **WHEN** a page served from a non-loopback origin fetches any `/api/*` endpoint
- **THEN** the request is refused, and no listing, file bytes, or cache write occurs

#### Scenario: DNS rebinding attempt
- **WHEN** a request arrives whose `Host` header is not a loopback host
- **THEN** the request is refused regardless of its `Origin`

#### Scenario: No-cors embed cannot read model bytes
- **WHEN** a cross-origin page embeds `/api/file` as an `<img>` or `<script>` source, sending no `Origin` header
- **THEN** the response declares `application/octet-stream` with `nosniff`, so the browser blocks the load instead of decoding or executing it

#### Scenario: The app's own requests
- **WHEN** the client makes an API request, in dev through the Vite proxy or in production from the served origin
- **THEN** the request is allowed

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
