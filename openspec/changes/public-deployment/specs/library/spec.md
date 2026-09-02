# library Delta

## MODIFIED Requirements

### Requirement: The root is configured, and its absence is a state
The root SHALL be read from the `MODEL_BROWSER_ROOT` environment variable, else from `root` in the app's configuration file (`config.json` under the XDG config home — `~/.config/model-browser/` by default — location overridable by `MODEL_BROWSER_CONFIG`), at server start. That file SHALL be read whether or not the environment variable supplies a root, since it carries the rest of the deployment's configuration (see `public-deployment`); the environment variable SHALL override the `root` key alone. An absent configuration file SHALL mean no root is configured here, silently. A configuration file that is present but cannot be parsed SHALL NOT be read as an absent root: it SHALL be reported as a startup failure, because a misread file may have been the one carrying the deployment's origin and capabilities. The server SHALL start whether or not a root is configured. The library's state SHALL be reported on request as one of: `ready` (identifier, top and root known), `unconfigured` (no root given), `missing` (the configured root is not present or is not a directory, whether at start or once the volume goes away under a running server), or `nested` (the root encloses a library that already exists). A `ready` library SHALL additionally report that it is `unmarked` when no marker exists above or below the root and one could not be written; its identifier then falls back to a hash of the root's resolved location and the library behaves as though its location were its identity. While the state is not `ready`, every path route SHALL answer with that state rather than with an empty listing, and the UI SHALL show it — naming the configured root when it is missing, since mounting it is the remedy, and naming the enclosed library when the root is nested, since pointing at it is the remedy.

#### Scenario: No root configured
- **WHEN** the server starts with neither the environment variable nor a configured root
- **THEN** it serves, reports `unconfigured`, and the UI says a root must be set instead of showing an empty grid

#### Scenario: The volume is not mounted
- **WHEN** the configured root does not exist when a listing is requested
- **THEN** the response reports `missing` with the configured root, and the UI shows that the library at that location is not present

#### Scenario: The volume is unplugged mid-session
- **WHEN** the library was serving and its top stops being present under the running server
- **THEN** every path route reports `missing` with the configured root, rather than reporting that each path in it is not found; and when the same tree returns at the same location it is the same library again, with its identifier and its cache intact

#### Scenario: A root above an existing library
- **WHEN** the configured root has no marker at or above it but encloses one within reach of a bounded search below it
- **THEN** the root is refused as `nested`, naming that library's location; no marker is written; and nothing is served until the root is repointed at it or inside it

#### Scenario: A read-only library
- **WHEN** no marker exists above the root and the marker cannot be written
- **THEN** the library is served under a location-derived identifier and the state reports `unmarked`

#### Scenario: The environment overrides the file
- **WHEN** both `MODEL_BROWSER_ROOT` and a configured `root` are present
- **THEN** the environment variable is the root

#### Scenario: The environment's root does not hide the file
- **WHEN** `MODEL_BROWSER_ROOT` supplies the root and the configuration file also declares capabilities or an origin
- **THEN** those settings take effect, rather than the file going unread because the root was already known

#### Scenario: A malformed configuration file is not an absent root
- **WHEN** the configuration file exists and cannot be parsed
- **THEN** the server reports the failure naming that file rather than starting as though no root were configured
