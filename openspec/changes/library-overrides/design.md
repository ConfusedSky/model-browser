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
`stem` (top-level: the kit's folder name relative to a variant directory — see
D5), `name`, `author`, `author_url`, `license`, `source_url` per kit. The lightbox panel (`ViewerLayer.tsx`) already has an
info/actions column per viewed entry. The exFAT measurements (notes, 2026-08-28)
put temp+rename+fsync at ~40 ms on the spinning volume — trivial for a store
written at corpus build and rarely after.

## Goals / Non-Goals

**Goals**

- The store: format, longest-prefix resolution, per-resolved-library load
  lifetime, atomic write helper.
- A per-entry read the client can ask (`ApiClient`, never raw fetch — D1 of the
  Electron seam).
- The lightbox credits block — the one UI consumer here.
- The generator from `metadata/miniatures.json`, rerunnable without clobbering
  fields it does not own.

**Non-Goals**

- No consumer for `name` (that was `web-demo-backlog` 2.3's call — decided
  after this draft, 2026-08-31: display names from the store, so the consumer
  is a known follow-up rather than an open question) and none for `pose`
  (`pose-for-every-model`). Fields ship, consumers wait.
- No runtime write API and no editing UI. The only writer is the generator.
- No search-by-author surface. In-memory search is trivial *later*; nothing here
  depends on it.
- No sqlite (D2 closed it), no per-kit sidecar files (the one-folder decision).

## Decisions

### D1: One JSON file, read once per resolved library

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

Read once **per resolved library**, not per process. "At start" is undefined
here: a library can be `unconfigured` or `missing` at start and resolve `ready`
later (`Library.state()` re-evaluates a not-ready state per request — its own
doc says a volume mounted after start needs no restart), and the library's
*identity* can change mid-process — `refresh()` drops `settled`, and `compute()`'s
returned-volume branch re-reads the marker and re-evaluates when the id differs.
A store cached per-process would then keep serving library A's credits for
library B's paths — and displayed attribution is a CC-BY license term, so
wrong-library credits are a compliance defect, not staleness. So: the store
loads when the library first resolves `ready` and is held keyed to the
resolved identity (id + top). The mechanism is a compare, not a hook —
`Library` exposes no event on `settled` (its six members are `state`,
`refresh`, `realTop`, `id`, `resolve`, `libPathOf`), and adding one would
break the proposal's "`library.ts` untouched". The store holder keeps
`{identity, store}` and, on each `/api/overrides`, compares the identity
against `state()`'s ready answer — already computed per request by the gate
middleware — reloading on mismatch. `index.ts`'s existing
`void library.state().then(...)` also loads eagerly when the library is ready
at start, which is what puts the malformed-store report beside the startup
line; a library that resolves later loads on the first overrides request, and
the report prints then. Within one resolved library the file is read once — the same
restart-after-editing rule `launch.json` has (`loadLaunchConfig` is read at
startup; `config.json` is the weaker precedent, re-read while the library is
unsettled) — stated in the spec so the generator's docs can repeat it.

A missing file is an empty store. A file that does not parse, or whose
`version` is unknown, is reported when the load happens — beside the
`library <id> at <top>` line when the library resolves at start, on its own
line when it resolves later — and treated as empty: a broken overrides file
must not take the library down (browsing owes it nothing), but it must not be
silent either — the one consumer surface (credits silently absent) is exactly
where a swallowed error would hide forever, and an unknown *version* silently
dropping 297 kits' credits would be that same hole.

The directory is already invisible end to end (`listFsDir`'s dot-skip,
`complete`'s `MARKER_DIR` exclusion, `resolve`'s refusal), so the store needs no
new hiding.

### D2: Field-wise longest-prefix resolution

An entry's effective overrides merge every key on its path — `/`, each ancestor
directory, then the entry's own key — **per field**, nearest key winning per
field. This narrows web-demo-backlog D2's recorded wording ("files overriding")
rather than reopening it: wholesale nearest-key-wins was rejected because the
pose writer will write file keys carrying only `pose`, and wholesale, every
posed model would silently lose its kit's credits. Field-wise is also what
makes the generator (directory keys) and the pose writer (file keys) composable
without either knowing the other exists.

The ancestor walk follows the vpath grammar, not a naive `split('/')`:
`parseVPath` splits a virtual path on the first `!/` (`SEP` in
`server/src/vpath.ts`), so `'/kit/a.zip!/x.stl'.split('/')` yields the segment
`a.zip!` and would never produce the key `/kit/a.zip`. The rule is
parse-then-walk: split the lookup into its filesystem half and entry half;
ancestors are `/`, each directory of the filesystem half, the archive file's
own path (`/kit/a.zip`), and then — when there is an entry half — each interior
directory (`/kit/a.zip!/parts`, …) down to the full key; nearest wins per
field. Prefix boundaries within each half are path segments (`/kit` covers
`/kit/x.stl`, not `/kit2/x.stl`). The archive *file's* key is the one key for
the archive and its interior root — a `!/`-suffixed key spelling is not valid,
so there is no second "zip root" key to disagree with it.

Keys must be canonical: `canonicalLibPath` normalises only the filesystem half
and drops trailing slashes, so a key written `/kit/` — the natural hand-edit
spelling for a directory — would never match any lookup, silently. The loader
canonicalises every key it reads and reports any it cannot; the root key's
spelling is `/`, and the walk special-cases it (splitting `/` yields no
segments).

### D3: A read route, asked per viewed entry

`GET /api/overrides?path` answers the resolved fields for one entry (empty
object when nothing resolves). A path route on the established pattern:
`path` required (400 without it), canonicalised with `canonicalLibPath` the way
`/api/dir`, `/api/peek` and `resolveEntryFile` do (not "like every route" —
`/api/file` resolves raw and is the exception, not the pattern), resolved
through the library (a refused path is refused here too), gated by the
not-ready envelope middleware for free.

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
its answer dropped when the subject has moved on — the ignore-on-stale idiom of
the panel's existing per-subject read (`ViewerLayer`'s `getThumb` effect with
its `alive` flag), not an `AbortController`.

One tension left deliberately unmodified: the main spec's "Lightbox expanded
view" says the panel's content "comes from the directory entry … so it SHALL
be shown from the moment the lightbox opens", and credits arrive from a read.
The delta carves the exception in its own ADDed requirement (the block may
appear late, no placeholder) rather than MODIFYing that sentence: no active
change touches "Lightbox expanded view", so a MODIFIED block would not
collide — but it would have to carry all eleven of that requirement's
scenarios forward exactly, the archive failure mode the workflow warns about,
for one sentence of scoping. The carve-out is the cheaper true statement.

### D5: The generator merges; it does not own the file

`scripts/gen-overrides.ts` (run with `bun run`, corpus side): reads
`metadata/miniatures.json` and writes `name` and `credits` from each kit's
top-level `name`/`author`/`author_url`/`license`/`source_url`. **Only top-level
`stem` values name kit folders** — the nested `files[].stem` entries (2,801 of
them) are file stems, not directories, and must not become keys.

The kit folders and the library top are two different things and the generator
takes both: the corpus lays kits out as `<root>/miniatures/<variant>/<stem>/`
(three variants — `clustered-hq` is the shipped one, per the notes), so "`/` +
stem" is only a valid key when the library top *is* the variant directory. The
generator takes the library top and the kits directory (defaulting to the top
itself; refused unless it is the top or beneath it — outside, `relative()`
yields `..`-keys that normalise into plausible wrong spellings, not errors)
and derives each key as `/` + the top-relative path of
`<kitsDir>/<stem>` — so rooting the demo at `…/miniatures/clustered-hq` gives
keys `/<stem>`, while a top above the variants gives
`/miniatures/clustered-hq/<stem>`. A top above the variants also means one
metadata entry maps to three on-disk copies; the generator writes keys only
under the kits directory it was given and says so.

It **merges into** an existing file — read, replace only the fields it owns
(`name`, `credits`) on the keys it generates, keep everything else (a `pose`
written by later tooling survives a rerun) — and writes atomically and durably:
temp + rename + fsync. The fsync price is known: ~40/~50 ms median/p90 on the
spinning exFAT volume, 0.5 ms on SSD (the 2026-08-28 session's `write_probe.py`
run, recorded in `docs/web-demo-notes.md` Measurements — its run, not re-run
here). Rare writes; cheap. A `stem` that names no directory under the kits
directory is reported and skipped, and the run says how many keys it wrote
against how many kits it read — the credits gate (`web-demo-backlog` 3.2) needs
that count to mean something.

### D6: Types in `shared/`

The resolved-fields shape lives in `shared/types.ts` like every other wire
type. The pose field is declared as an opaque `unknown` reserved by name — not
as `IndexPose`, because the stored pose's concrete shape is
`pose-for-every-model`'s to define, and pinning the index's shape here would
prejudge it. Reserving the *name* now is documentation of the file format's
contract, nothing more: the generator never writes poses and the merge
preserves unknown fields, so no generated store depends on the name — but a
third-party or future writer will, and the format doc is where they will read
it.

## Risks / Trade-offs

- [Read-once staleness: the generator runs while a server is up] → the same
  rule every config file here has — restart after editing; the generator prints
  it. Not worth a watcher for a file written at corpus build.
- [A kit copied out of the library carries no metadata] → priced and accepted in
  the notes (the one-folder decision beat per-kit sidecars).
- [`stem` drift between `miniatures.json` and the corpus folders] → the
  generator verifies each key against the filesystem and reports misses rather
  than writing dead keys.
- [The store grows fields this change did not plan] → additive evolution
  happens **within** `version: 1`: unknown fields on an entry are preserved by
  the generator's merge and ignored by resolution, so new fields need no
  migration and no version bump. Bumping `version` is a deliberate format
  break — an older reader treats it as unreadable *and reports it* (D1), so a
  bump can never silently drop a corpus's credits.

## Migration Plan

None. A new file nothing reads today; absent, everything behaves as before.

## Open Questions

- None held open here. Display-name consumption is `web-demo-backlog` 2.3;
  the pose field's concrete type is `pose-for-every-model`'s.
