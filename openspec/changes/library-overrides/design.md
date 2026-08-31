# Design — library-overrides

## Context

Decided shape (web-demo-backlog D2, notes item 1 — do not reopen): one
`<library>/.model-browser/overrides.json` keyed by library path, directory keys
applying to their subtree by longest prefix, file keys overriding; loaded at
start; written atomically; poses are a field in it; the demo's credits are
generated into it from `metadata/miniatures.json`; sqlite only if a library
outgrows load-at-start.

What exists to build on: `library-root` put per-library data in `MARKER_DIR`
(`.model-browser/`, `server/src/library.ts`) beside `library.json`, made every
wire path a library path, and made that directory invisible — dot-prefixed
entries are skipped by `listFsDir`, `complete` excludes `MARKER_DIR` by name,
and the resolver refuses paths whose first segment is `MARKER_DIR` (the guard in
`resolve`). The corpus metadata (`metadata/miniatures.json`, 297 kits) carries
`stem` (the kit's folder name), `name`, `author`, `author_url`, `license`,
`source_url` per kit. The lightbox panel (`ViewerLayer.tsx`) already has an
info/actions column per viewed entry. The exFAT measurements (notes, 2026-08-28)
put temp+rename+fsync at ~40 ms on the spinning volume — trivial for a store
written at corpus build and rarely after.

## Goals / Non-Goals

**Goals**

- The store: format, longest-prefix resolution, load-at-start lifetime, atomic
  write helper.
- A per-entry read the client can ask (`ApiClient`, never raw fetch — D1 of the
  Electron seam).
- The lightbox credits block — the one UI consumer here.
- The generator from `metadata/miniatures.json`, rerunnable without clobbering
  fields it does not own.

**Non-Goals**

- No consumer for `name` (that is `web-demo-backlog` 2.3's call) and none for
  `pose` (`pose-for-every-model`). Fields ship, consumers wait.
- No runtime write API and no editing UI. The only writer is the generator.
- No search-by-author surface. In-memory search is trivial *later*; nothing here
  depends on it.
- No sqlite (D2 closed it), no per-kit sidecar files (the one-folder decision).

## Decisions

### D1: One JSON file, read once at server start

`<library>/.model-browser/overrides.json`, sibling of `library.json`:

```json
{ "version": 1,
  "entries": {
    "/Player_Character_Pack_03_3750572": {
      "name": "Player Character Pack 03",
      "credits": { "author": "Valandar",
                   "authorUrl": "https://www.thingiverse.com/Valandar",
                   "license": "Creative Commons - Attribution",
                   "sourceUrl": "https://www.thingiverse.com/thing:3750572" } },
    "/Player_Character_Pack_03_3750572/hero.stl": { "pose": { } }
  } }
```

Read once when the library resolves, like `config.json` and `launch.json` are
read once at server start — the same restart-after-editing rule, stated in the
spec so the generator's docs can repeat it. A missing file is an empty store. A
file that does not parse is reported on the startup line and treated as empty:
a broken overrides file must not take the library down (browsing owes it
nothing), but it must not be silent either — the one consumer surface (credits
silently absent) is exactly where a swallowed error would hide forever.

The directory is already invisible end to end (`listFsDir`'s dot-skip,
`complete`'s `MARKER_DIR` exclusion, `resolve`'s refusal), so the store needs no
new hiding.

### D2: Field-wise longest-prefix resolution

An entry's effective overrides merge every key on its path — `/`, each ancestor
directory, then the entry's own key — **per field**, nearest key winning per
field. Wholesale nearest-key-wins was rejected: the pose writer will write file
keys carrying only `pose`, and wholesale, every posed model would silently lose
its kit's credits. Field-wise is also what makes the generator (directory keys)
and the pose writer (file keys) composable without either knowing the other
exists.

Zip interiors need no special case: keys and lookups are both library paths, so
an entry `a.zip!/x.stl` inherits from `/`, its directories, and `/kit/a.zip` by
plain prefix rules. The spec states prefix boundaries are path segments
(`/kit` covers `/kit/x.stl`, not `/kit2/x.stl`).

### D3: A read route, asked per viewed entry

`GET /api/overrides?path` answers the resolved fields for one entry (empty
object when nothing resolves). A path route like the rest: canonicalised
(`canonicalLibPath`), resolved through the library (a refused path is refused
here too), gated by the not-ready envelope middleware for free.

Rejected: folding overrides into `/api/dir` entries. Listings are the hot path
(`folder-contact-sheets` exists to keep them lean) and would pay resolution for
hundreds of entries per request to serve a panel that shows one. The lightbox
asks when it opens; the answer is a memory lookup server-side.

### D4: Credits in the lightbox panel, silently absent otherwise

The panel renders a credits block — author (linking to `authorUrl` when
present), license, and a source link — when the viewed entry resolves
`credits`; nothing otherwise. No loading state and no error state: the panel
must not gain a spinner for metadata most libraries do not have, and a failed
overrides read renders the same as no credits (the demo is where credits
matter, and there the store is generated and the read is local memory).
Fetched through `ApiClient.overrides(path)` when the viewer subject changes,
aborted/ignored on close like the panel's other per-subject reads.

### D5: The generator merges; it does not own the file

`scripts/gen-overrides.ts` (run with `bun run`, corpus side): reads
`metadata/miniatures.json`, maps each kit's `stem` to the directory key
`/<stem>`, writes `name` and `credits` from `name`/`author`/`author_url`/
`license`/`source_url`. It **merges into** an existing file — read, replace only
the fields it owns (`name`, `credits`) on the keys it generates, keep everything
else (a `pose` written by later tooling survives a rerun) — and writes
atomically: temp + rename + fsync, the durable pattern the exFAT measurement
priced at ~40 ms (rare writes; cheap). A `stem` that names no directory under
the given root is reported and skipped, and the run says how many keys it wrote
against how many kits it read — the credits gate (`web-demo-backlog` 3.2) needs
that count to mean something.

### D6: Types in `shared/`

The resolved-fields shape (and the pose field's type, which is the index's pose
shape `IndexPose` is *not* — the stored pose is whatever `pose-for-every-model`
defines, so here it is an opaque `unknown` field reserved by name) live in
`shared/types.ts` like every other wire type. Reserving the field name now is
deliberate: the file format is this change's contract, and a later change
renaming the field would invalidate generated stores.

## Risks / Trade-offs

- [Read-once staleness: the generator runs while a server is up] → the same
  rule every config file here has — restart after editing; the generator prints
  it. Not worth a watcher for a file written at corpus build.
- [A kit copied out of the library carries no metadata] → priced and accepted in
  the notes (the one-folder decision beat per-kit sidecars).
- [`stem` drift between `miniatures.json` and the corpus folders] → the
  generator verifies each key against the filesystem and reports misses rather
  than writing dead keys.
- [The store grows fields this change did not plan] → `version: 1` in the file;
  unknown fields on an entry are preserved by the generator's merge and ignored
  by resolution, so additive evolution needs no migration.

## Migration Plan

None. A new file nothing reads today; absent, everything behaves as before.

## Open Questions

- None held open here. Display-name consumption is `web-demo-backlog` 2.3;
  the pose field's concrete type is `pose-for-every-model`'s.
