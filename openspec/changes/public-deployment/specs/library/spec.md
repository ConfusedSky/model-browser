# library Delta

## MODIFIED Requirements

### Requirement: The root is configured, and its absence is a state
The root SHALL be read from the `MODEL_BROWSER_ROOT` environment variable, else from `root` in the app's configuration file (`config.json` under the XDG config home — `~/.config/model-browser/` by default — location overridable by `MODEL_BROWSER_CONFIG`), at server start. That file SHALL be read whether or not the environment variable supplies a root, since it carries the rest of the deployment's configuration (see `public-deployment`); the environment variable SHALL override the `root` key alone. The file SHALL be parsed exactly once, at server start. Re-evaluating a library that is not `ready` SHALL re-ask the *filesystem* — whether the root is present, whether a marker stands above it — and SHALL NOT re-read the file, so that a volume mounted after start still needs no restart while the configuration has one moment at which it can be found malformed. Repointing a running server at a different root SHALL be an explicit re-read rather than a side effect of a state being unsettled. An absent configuration file SHALL mean no root is configured here, silently. A configuration file that is present but cannot be parsed SHALL NOT be read as an absent root: it SHALL be reported as a startup failure, because a misread file may have been the one carrying the deployment's origin and capabilities. The server SHALL start whether or not a root is configured. The library's state SHALL be reported on request as one of: `ready` (identifier, top and root known), `unconfigured` (no root given), `missing` (the configured root is not present or is not a directory, whether at start or once the volume goes away under a running server), or `nested` (the root encloses a library that already exists). A `ready` library SHALL additionally report that it is `unmarked` when no marker exists above or below the root and one could not be written; its identifier then falls back to a hash of the root's resolved location and the library behaves as though its location were its identity. While the state is not `ready`, every path route SHALL answer with that state rather than with an empty listing, and the UI SHALL show it — naming the configured root when it is missing, since mounting it is the remedy, and naming the enclosed library when the root is nested, since pointing at it is the remedy. Where the deployment declares that the machine it runs on is not the viewer's concern (see `feature-report`), those states SHALL be reported without naming any filesystem location: mounting a volume and repointing a root are an operator's remedies, so naming them to a viewer describes a machine they cannot reach and offers a repair they cannot make.

#### Scenario: No root configured
- **WHEN** the server starts with neither the environment variable nor a configured root
- **THEN** it serves, reports `unconfigured`, and the UI says a root must be set instead of showing an empty grid

#### Scenario: The volume is not mounted
- **WHEN** the configured root does not exist when a listing is requested, on a deployment where the host is the viewer's concern
- **THEN** the response reports `missing` with the configured root, and the UI shows that the library at that location is not present

#### Scenario: The volume is unplugged mid-session
- **WHEN** the library was serving and its top stops being present under the running server, on a deployment where the host is the viewer's concern
- **THEN** every path route reports `missing` with the configured root, rather than reporting that each path in it is not found; and when the same tree returns at the same location it is the same library again, with its identifier and its cache intact

#### Scenario: A root above an existing library
- **WHEN** the configured root has no marker at or above it but encloses one within reach of a bounded search below it, on a deployment where the host is the viewer's concern
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

#### Scenario: A not-ready state names no location where the machine is not the viewer's concern
- **WHEN** the library is `missing` or `nested` on a deployment declaring this
- **THEN** the state is reported without the configured root or the enclosed library's location, while the state itself is still named

#### Scenario: A volume mounted later still needs no restart
- **WHEN** the configured root's volume is absent at start and is mounted while the server runs
- **THEN** the next request finds the library, without the configuration file being read again

#### Scenario: The file is parsed once
- **WHEN** the configuration file is edited under a running server
- **THEN** the running server continues on what it read at start, until it is restarted or explicitly asked to re-read

#### Scenario: A malformed configuration file is not an absent root
- **WHEN** the configuration file exists and cannot be parsed
- **THEN** the server reports the failure naming that file rather than starting as though no root were configured

### Requirement: Every path is relative to the library
Every path the server accepts or emits — listings, file bytes, thumbnails, camera state, completion, and the `<zip-path>` half of a virtual path — SHALL be the path relative to the library's top, written with a leading slash, so that the library's top is `/`. A path that does not begin with `/` SHALL be refused. The same string SHALL name the same file wherever the library is mounted and on whichever machine holds it. Where a path is shown or copied for use outside the app — the copy-path action, the lightbox's file details — it SHALL be expanded to the filesystem path by prefixing the library's top, keeping the `!/` notation for archive entries. Where the deployment declares that the machine it runs on is not the viewer's concern (see `feature-report`), the library's top SHALL NOT be reported to the client at all, and a path SHALL be shown and copied as the library path itself: a filesystem path names a machine the viewer cannot reach, tells them where an operator keeps their files, and cannot be opened by any program of theirs. The expansion SHALL be the default and SHALL be unchanged wherever that is not declared, since a filesystem path is exactly what makes a copied path useful to the user whose disk it is.

#### Scenario: A remount changes nothing
- **WHEN** the library is mounted at a different filesystem location and the root is repointed to it
- **THEN** every listing, thumbnail, camera state and deep link that worked before resolves unchanged

#### Scenario: A copied path is a filesystem path
- **WHEN** the user copies an entry's path, or reads it in the lightbox's file details, on a deployment where the host is the viewer's concern
- **THEN** the text is the entry's filesystem path — the library's top joined to its library path, with `!/` kept for archive entries — which another program can open

#### Scenario: A filesystem path is refused
- **WHEN** a request names a path that does not begin with `/`
- **THEN** the request is refused with an error and no listing, file bytes or cache write occurs

#### Scenario: A filesystem location is only a library path that is not there
- **WHEN** a request names the library by its filesystem location, which begins with `/` and so reads as a library path
- **THEN** it resolves under the library's top like any other path — not found unless the library happens to hold that path, in which case that entry is what is served

#### Scenario: The top is withheld where the machine is not the viewer's concern
- **WHEN** a client reads the library's state from a deployment declaring this
- **THEN** the library's top is absent from the answer, and no surface can compose a filesystem path from it

#### Scenario: A copied path where the machine is not the viewer's concern
- **WHEN** a viewer copies an entry's path on such a deployment
- **THEN** the text is the entry's library path, which names the entry within this library rather than a location on the operator's disk
