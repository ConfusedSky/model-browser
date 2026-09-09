# library Specification

## Purpose
The library is the one marked directory tree the app serves: its identity, where it begins,
how the configured root sits inside it, and the rule that every path on the wire is relative
to its top. Everything that reads or writes files — listings, thumbnails, the semantic index,
the launcher — goes through it, so confinement and identity are decided once here rather
than per route. Established by the change `library-root` (archived 2026-08-30); the reasoning
behind each requirement is in that change's design.md (D1–D7, R1).
## Requirements
### Requirement: A library is a tree with an identity
A library SHALL be a directory tree whose top is marked by `.model-browser/library.json` carrying a generated identifier. The server SHALL locate the library by walking upward from the configured root until a marker is found, stopping before it would leave the filesystem the root sits on; the first marker found SHALL define the library, and the root SHALL be a location inside it. When no marker exists at or above the root, the root SHALL become a new library and the marker SHALL be written there. The marker directory SHALL be the home of every file this app keeps inside a library, and listings SHALL never show it.

#### Scenario: A subfolder of a library is picked as the root
- **WHEN** the root is set to a folder beneath an existing marker
- **THEN** the library is the marked tree, its identifier is unchanged, and the app opens at the chosen folder

#### Scenario: A folder with no marker above it becomes a library
- **WHEN** the root is set to a folder with no marker at or above it
- **THEN** a marker with a fresh identifier is written at that folder and it is the library's top

#### Scenario: A marker on another filesystem is not adopted
- **WHEN** a marker sits above the root but on a different filesystem from it — one left in a home directory by an earlier root choice, above a mounted volume
- **THEN** it is not the library: the walk stops at the mount, and the root is served under whatever the volume itself says

#### Scenario: The marker is invisible
- **WHEN** the library's top is listed
- **THEN** the `.model-browser` directory does not appear among its entries

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

### Requirement: Nothing outside the library is reachable
Every filesystem location the server derives from a request path SHALL resolve, through symlinks, to the library's top or a location beneath it, or the request SHALL be refused without naming any filesystem detail. `..` components SHALL be normalised before resolution and SHALL NOT escape. Any entry — file, archive or directory — that resolves outside the library SHALL be omitted from listings and skipped by walks: never named, fetched, thumbnailed, or, for an archive, enumerated. A path under the library's top that does not exist SHALL be reported as not found, distinct from a refusal, and confinement SHALL be decided for such a path on the nearest existing ancestor of its filesystem half; an archive entry that does not exist inside an existing archive is the archive layer's not-found, not a confinement decision. Confinement is decided on paths, not on inodes: a hardlink inside the library to a file outside it is indistinguishable from an ordinary file and SHALL be served.

#### Scenario: Dot-dot cannot escape
- **WHEN** a request path contains `..` components that would climb above the library's top
- **THEN** they fold against the top — the path resolves under the library like any other, is not found unless the library holds it, and nothing outside the library is read

#### Scenario: A symlink out of the library is refused
- **WHEN** a path inside the library is a symlink whose target lies outside it
- **THEN** naming it as a request is refused; as an entry of its parent it is omitted from the listing and skipped by a recursive walk

#### Scenario: An escaping entry is omitted, whatever it is
- **WHEN** a directory inside the library holds a symlinked file, archive or subdirectory whose target lies outside
- **THEN** none of them appears in the directory's listing, no archive names are enumerated, and a flat walk emits nothing for them

#### Scenario: A symlink within the library is followed
- **WHEN** a path inside the library is a symlink whose target also lies inside it
- **THEN** it is listed and served like any other entry

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

### Requirement: Hidden entries are unreachable
A path naming a dot-prefixed component **in its filesystem half** SHALL be refused by the
library exactly as a path that does not exist is, and path completion SHALL NOT offer one,
so that what a listing hides is also what a request cannot reach. Skipping hidden
directories in a walk was never the same thing as making them unreachable, and on a
deployment that answers strangers the difference is a trash directory browsable by
spelling its name. The library's own marker directory was already refused; this widens
that rule to every hidden component. An archive is opaque to this rule: the entry half of
a virtual path is a name the archive reader looks up, its members are neither hidden nor
filtered by format, and a deployment whose corpus must not expose an archive's members
ships no archives (the public corpus holds none).

#### Scenario: A hidden directory cannot be browsed by name
- **WHEN** a request names a path with a dot-prefixed component
- **THEN** it is answered as a path that does not exist, whatever the filesystem holds there

#### Scenario: Completion does not reveal one
- **WHEN** completion is asked for a prefix beginning with a dot
- **THEN** no hidden entry is offered

