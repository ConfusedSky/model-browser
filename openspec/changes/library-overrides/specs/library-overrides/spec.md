# library-overrides Delta

> New capability. The store's shape was decided in `web-demo-backlog` design D2
> (one file in `.model-browser/`, longest-prefix keys, load at start, atomic
> writes) — these requirements state that decision normatively. Consumers for
> `name` and `pose` are deliberately absent: they land with `web-demo-backlog`
> 2.3's decision and `pose-for-every-model` respectively.

## ADDED Requirements

### Requirement: A per-library override store
A library MAY carry one override store at `.model-browser/overrides.json`
beside the library marker, versioned (`version: 1`) and keyed by library path.
Each key SHALL hold any of: a display name, credits (author, author URL,
license, source URL), and a pose field reserved by name. The server SHALL read
the store once at start; an absent file SHALL behave as an empty store; a file
that fails to parse SHALL be reported at startup and treated as empty rather
than failing the library. The store's directory is already invisible to
browsing, completion and resolution, and the store SHALL NOT become reachable
through any path route. Every writer of the file SHALL write atomically
(write-temp then rename), so a torn write can never replace a valid store with
half of one.

#### Scenario: Absent store
- **WHEN** a library has no `overrides.json`
- **THEN** the server starts normally and every entry resolves no overrides

#### Scenario: Malformed store
- **WHEN** `overrides.json` exists but is not valid JSON or has no known version
- **THEN** the server reports it at startup, starts normally, and every entry resolves no overrides

#### Scenario: Read once
- **WHEN** the file changes while the server is running
- **THEN** answers reflect the store as read at start, until restart — the rule every config file here has

### Requirement: Field-wise longest-prefix resolution
An entry's effective overrides SHALL merge the store's keys on the entry's
path — the root key, each ancestor directory key in order, then the entry's own
key — per field, the nearest key winning each field independently. Prefix
boundaries SHALL be path segments: `/kit` covers `/kit/x.stl` and not
`/kit2/x.stl`. Keys and lookups are both library paths, so entries inside
archives inherit through the archive file's key and its ancestors by the same
rule, with no archive-specific case.

#### Scenario: A kit's credits reach its files
- **WHEN** `/kit` holds credits and `/kit/sub/x.stl` holds none
- **THEN** `/kit/sub/x.stl` resolves the kit's credits

#### Scenario: A file key overrides per field only
- **WHEN** `/kit` holds credits and a name, and `/kit/x.stl` holds only a pose
- **THEN** `/kit/x.stl` resolves the kit's credits and name together with its own pose

#### Scenario: Segment boundaries
- **WHEN** `/kit` holds credits and the library holds `/kit2/y.stl`
- **THEN** `/kit2/y.stl` resolves nothing from `/kit`

#### Scenario: An archive entry inherits
- **WHEN** `/kit/a.zip` holds credits
- **THEN** `/kit/a.zip!/x.stl` resolves them

### Requirement: Resolved overrides are served per entry
The server SHALL answer an entry's resolved overrides for a requested library
path — the resolved fields, or an empty answer where nothing resolves. The
request SHALL be canonicalised and resolved through the library exactly as
other path routes are, refused paths refused here too, and SHALL answer the
library's not-ready envelope while the library is not ready. The client SHALL
reach it only through its API client.

#### Scenario: An entry with credits
- **WHEN** the client asks for an entry beneath a kit key holding credits
- **THEN** the answer carries those credits

#### Scenario: Nothing resolves
- **WHEN** the client asks for an entry no key covers
- **THEN** the answer is empty, not an error

#### Scenario: Library not ready
- **WHEN** the library is unconfigured or missing
- **THEN** the route answers the same state envelope every path route gives

### Requirement: Credits are generated from the corpus metadata
A generator SHALL populate a library's override store from
`metadata/miniatures.json`: for each kit, the directory key named by the kit's
`stem` receives the kit's display name and credits (author, author URL,
license, source URL). The generator SHALL merge into an existing store —
replacing only the fields it owns on the keys it generates, preserving every
other field and key (a stored pose survives a rerun) — and SHALL write
atomically and durably (write-temp, rename, fsync). A `stem` naming no
directory under the target root SHALL be reported and skipped, and the run
SHALL report how many keys it wrote against how many kits it read.

#### Scenario: Fresh generation
- **WHEN** the generator runs against a corpus root with no existing store
- **THEN** every kit whose folder exists gets a key with its name and credits, and the counts are reported

#### Scenario: Rerun preserves what it does not own
- **WHEN** a key already holds a pose and the generator reruns
- **THEN** the key's name and credits are regenerated and the pose is untouched

#### Scenario: Metadata drift
- **WHEN** a kit's `stem` names no directory under the root
- **THEN** that kit is reported and skipped, and no dead key is written
