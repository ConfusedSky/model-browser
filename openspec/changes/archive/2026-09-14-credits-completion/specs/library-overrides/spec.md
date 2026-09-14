## MODIFIED Requirements

### Requirement: A per-library override store
A library MAY carry one override store at `.model-browser/overrides.json`
beside the library marker, versioned (`version: 1`) and keyed by canonical
library path. Each key SHALL hold any of: a display name, credits (author,
author URL, license, license URL, modified, source URL — each a string), and a
pose field reserved by name. The loader SHALL resolve and serve exactly those
credit fields: a credit field the build does not know SHALL be left on disk and
never served, silently, and a known field of the wrong type SHALL be dropped
and reported — so a store written for a newer build is safe under an older
one, and a hand-written field never rides the wire to a renderer. The
server SHALL read the store once per resolved library — when the library first
resolves ready, held for as long as that resolution stands, and dropped with
it, so a re-resolved library (a repointed root, a different volume at the same
mount) is answered from its own store or from none, never from the previous
library's. An absent file SHALL behave as an empty store; a file that fails to
parse or carries an unknown version SHALL be reported when the load happens
and treated as empty rather than failing the library. The loader SHALL
canonicalise every key it reads and report any key it cannot; the root key is
spelled `/`. Canonicalisation covers only the filesystem half, so the loader
SHALL additionally strip a trailing slash from a key's entry half (or report
the key) — zip listings commonly spell directory entries `parts/`, and an
unstripped `/kit/a.zip!/parts/` would silently never match the walk's
`/kit/a.zip!/parts` — and SHALL reject and report a key whose entry half is
empty (`…!/`), the store's forbidden zip-root spelling. Every writer of the file SHALL write atomically and durably
(write-temp, rename, fsync), so a torn write can never replace a valid store
with half of one. (The store's directory is the marker directory, which the
`library` capability already keeps out of listings — the capability where any
wider invisibility promise would belong; this requirement adds no reachability
of its own.)

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

#### Scenario: An archive-interior key with a trailing slash
- **WHEN** the store holds a key spelled `/kit/a.zip!/parts/`
- **THEN** the loader stores it as `/kit/a.zip!/parts` (or reports it), and lookups beneath that interior directory match it

#### Scenario: Credits carry a license URL and a modified phrase
- **WHEN** a key's credits hold `licenseUrl` and `modified` beside the author, license and source URL
- **THEN** entries beneath that key resolve all six strings

#### Scenario: A credit field the build does not know
- **WHEN** a key's credits hold a field this build does not name
- **THEN** the field is neither served nor reported, and the fields the build knows resolve normally

### Requirement: Credits are generated from the corpus metadata
A generator SHALL populate a library's override store from
`metadata/miniatures.json`, taking the library top and the kit directory
(defaulting to the top). The kit directory SHALL be the library top or a
directory beneath it; any other kit directory SHALL be refused before anything
is written — outside the top, `relative()` yields `..`-keys that normalise
into plausible-but-wrong spellings rather than errors. For each kit's
top-level `stem`, the directory key is
`/` plus the top-relative path of the kit's folder under the kit directory,
and it receives the kit's display name and credits (author, author URL,
license, license URL, modified, source URL — from the kit's `author`,
`author_url`, `license`, `license_url`, `modified` and `source_url`). A
metadata field that is absent or not a string SHALL yield no credit field: a
kit without `modified` is one served unchanged, and the generator SHALL NOT
infer modification from anything else in the metadata. Only top-level `stem`
values SHALL become keys — the
per-file `stem` entries in the metadata are not folders. The generator SHALL
merge into an existing store — replacing only the fields it owns on the keys
it generates, preserving every other field and key (a stored pose survives a
rerun) — and SHALL write as the store requires (write-temp, rename, fsync). A
`stem` naming no directory under the kit directory SHALL be reported and
skipped, and the run SHALL report how many keys it wrote against how many kits
it read, and how many of the written keys carry a license URL and how many a
modified phrase — so a metadata file spelling either field differently shows
as a zero rather than as a silently thinner store.

#### Scenario: Fresh generation
- **WHEN** the generator runs against a library whose top has no existing store
- **THEN** every kit whose folder exists gets a key with its name and credits, and the counts are reported

#### Scenario: A kit directory outside the top is refused
- **WHEN** the generator is given a kit directory that is not the top or beneath it
- **THEN** it refuses before writing anything

#### Scenario: Keys are top-relative
- **WHEN** the library top is above the kit directory (kits at `<top>/miniatures/clustered-hq/<stem>`)
- **THEN** the generated keys carry the full top-relative path, and rooting the library at the kit directory itself yields keys `/<stem>`

#### Scenario: Rerun preserves what it does not own
- **WHEN** a key already holds a pose and the generator reruns
- **THEN** the key's name and credits are regenerated and the pose is untouched

#### Scenario: Metadata drift
- **WHEN** a kit's `stem` names no directory under the kit directory
- **THEN** that kit is reported and skipped, and no dead key is written

#### Scenario: A modified kit and an unmodified one
- **WHEN** one kit carries `license_url` and `modified` and another carries neither
- **THEN** the first key's credits hold `licenseUrl` and `modified`, the second's hold neither, and the run reports one of each

#### Scenario: A rerun over metadata that gained the fields
- **WHEN** the generator reruns over a store whose keys hold four-field credits, from metadata that now carries `license_url` and `modified`
- **THEN** the regenerated keys hold the six fields and every other field and key is untouched
