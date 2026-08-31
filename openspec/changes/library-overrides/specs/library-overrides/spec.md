# library-overrides Delta

> New capability. `web-demo-backlog` design D2 decided the shape — one file in
> `.model-browser/`, keyed by library path, directory keys covering their
> subtree by longest prefix, load-once lifetime, atomic writes — and these
> requirements state that decision normatively. The **field-wise** merge is
> this change's own refinement of D2's "files overriding" (design D2 records
> the rejected wholesale alternative); the per-resolved-library lifetime is
> this change's reading of "loaded at start" against a library that can
> resolve, and change identity, after start. Consumers for `name` and `pose`
> are deliberately absent: they land with `web-demo-backlog` 2.3's decision and
> `pose-for-every-model` (planned, `web-demo-backlog` 1.2) respectively.

## ADDED Requirements

### Requirement: A per-library override store
A library MAY carry one override store at `.model-browser/overrides.json`
beside the library marker, versioned (`version: 1`) and keyed by canonical
library path. Each key SHALL hold any of: a display name, credits (author,
author URL, license, source URL), and a pose field reserved by name. The
server SHALL read the store once per resolved library — when the library first
resolves ready, held for as long as that resolution stands, and dropped with
it, so a re-resolved library (a repointed root, a different volume at the same
mount) is answered from its own store or from none, never from the previous
library's. An absent file SHALL behave as an empty store; a file that fails to
parse or carries an unknown version SHALL be reported when the load happens
and treated as empty rather than failing the library. The loader SHALL
canonicalise every key it reads and report any key it cannot; the root key is
spelled `/`. Every writer of the file SHALL write atomically and durably
(write-temp, rename, fsync), so a torn write can never replace a valid store
with half of one. (The store's directory is the marker directory, which the
`library` capability already keeps out of listings; completion and resolution
exclude it in code today — this requirement adds no reachability of its own.)

#### Scenario: Absent store
- **WHEN** a library has no `overrides.json`
- **THEN** the server starts normally and every entry resolves no overrides

#### Scenario: Malformed or unknown-version store
- **WHEN** `overrides.json` exists but is not valid JSON, or carries a version this build does not know
- **THEN** the condition is reported when the store is loaded, the library works normally, and every entry resolves no overrides

#### Scenario: Read once per resolved library
- **WHEN** the file changes while the library it belongs to stays resolved
- **THEN** answers reflect the store as loaded, until the server restarts or the library re-resolves

#### Scenario: The library changes identity
- **WHEN** the root is repointed, or a different tree arrives at the same mount, and the library re-resolves
- **THEN** overrides answer from the newly resolved library's store — or resolve nothing where it has none — never from the previous library's

#### Scenario: An uncanonical key
- **WHEN** the store holds a key spelled `/kit/` or another spelling canonicalisation changes
- **THEN** the loader canonicalises it (or reports the key it cannot), and lookups match it

### Requirement: Field-wise longest-prefix resolution
An entry's effective overrides SHALL merge the store's keys on the entry's
path per field, the nearest key winning each field independently. The ancestor
walk SHALL follow the virtual-path grammar: a lookup splits into its
filesystem half and its archive-entry half on the first `!/`; the ancestors
are the root key `/`, each ancestor directory of the filesystem half, the
archive file's own path when the lookup is inside one, and then each interior
directory of the entry half down to the entry's own key. Prefix boundaries
within each half SHALL be path segments: `/kit` covers `/kit/x.stl` and not
`/kit2/x.stl`. The archive file's key SHALL be the one key for the archive and
its interior root — a `!/`-suffixed key is not a valid spelling and is
reported by the loader like any other uncanonical key.

#### Scenario: A kit's credits reach its files
- **WHEN** `/kit` holds credits and `/kit/sub/x.stl` holds none
- **THEN** `/kit/sub/x.stl` resolves the kit's credits

#### Scenario: A file key overrides per field only
- **WHEN** `/kit` holds credits and a name, and `/kit/x.stl` holds only a pose
- **THEN** `/kit/x.stl` resolves the kit's credits and name together with its own pose

#### Scenario: Segment boundaries
- **WHEN** `/kit` holds credits and the library holds `/kit2/y.stl`
- **THEN** `/kit2/y.stl` resolves nothing from `/kit`

#### Scenario: An archive entry inherits through the archive's path
- **WHEN** `/kit/a.zip` holds credits
- **THEN** `/kit/a.zip!/parts/x.stl` resolves them, through the ancestors `/`, `/kit`, `/kit/a.zip`

#### Scenario: A key inside an archive
- **WHEN** `/kit/a.zip!/parts` holds a name and `/kit/a.zip` holds credits
- **THEN** `/kit/a.zip!/parts/x.stl` resolves the interior key's name and the archive key's credits

### Requirement: Resolved overrides are served per entry
The server SHALL answer an entry's resolved overrides for a requested library
path — the resolved fields, or an empty answer where nothing resolves. The
request SHALL require a path, be canonicalised, and be resolved through the
library exactly as the canonicalising path routes are, refused paths refused
here too, and SHALL answer the library's not-ready envelope while the library
is not ready. The client SHALL reach it only through its API client.

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
`metadata/miniatures.json`, taking the library top and the kit directory
(defaulting to the top): for each kit's top-level `stem`, the directory key is
`/` plus the top-relative path of the kit's folder under the kit directory,
and it receives the kit's display name and credits (author, author URL,
license, source URL). Only top-level `stem` values SHALL become keys — the
per-file `stem` entries in the metadata are not folders. The generator SHALL
merge into an existing store — replacing only the fields it owns on the keys
it generates, preserving every other field and key (a stored pose survives a
rerun) — and SHALL write as the store requires (write-temp, rename, fsync). A
`stem` naming no directory under the kit directory SHALL be reported and
skipped, and the run SHALL report how many keys it wrote against how many kits
it read.

#### Scenario: Fresh generation
- **WHEN** the generator runs against a kit directory with no existing store
- **THEN** every kit whose folder exists gets a key with its name and credits, and the counts are reported

#### Scenario: Keys are top-relative
- **WHEN** the library top is above the kit directory (kits at `<top>/miniatures/clustered-hq/<stem>`)
- **THEN** the generated keys carry the full top-relative path, and rooting the library at the kit directory itself yields keys `/<stem>`

#### Scenario: Rerun preserves what it does not own
- **WHEN** a key already holds a pose and the generator reruns
- **THEN** the key's name and credits are regenerated and the pose is untouched

#### Scenario: Metadata drift
- **WHEN** a kit's `stem` names no directory under the kit directory
- **THEN** that kit is reported and skipped, and no dead key is written
