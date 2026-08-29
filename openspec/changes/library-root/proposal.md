## Why

Every path in this app is absolute — on the wire (`/api/dir?path=/run/media/…`), in the URL,
in the recents list, and in the thumbnail cache, whose key is `sha256(absolute path)` and
whose sidecar records that path. That was the natural choice for a tool that browses any
readable directory, and it has a cost that has already been paid once and will be paid again:
the library lives on removable media, and the day its mount point changes, every thumbnail
*and every saved orientation* is orphaned, because nothing in the system knows that
`/run/media/masa/A/Kit/x.stl` and `/media/B/Kit/x.stl` are the same file. Deep links break
the same way, and a future Electron shell — where the user picks a folder from a dialog —
would break them on every pick.

The web demo needs the other half of the same fix. A public server cannot accept an
absolute path from a visitor; it needs an address space confined to one tree. Rather than
bolt confinement on as a demo mode, this change gives the app the concept it was missing:
a **library** — a tree with an identity — inside which every path is relative and outside
which nothing is reachable. Confinement then falls out for local and demo alike, the cache
survives a remount, and a deep link works on any machine that holds the same library.
The exploration behind this is recorded in `docs/web-demo-notes.md` (item 2).

## What Changes

- **A library is a tree with an identity.** Its top is marked by
  `<library>/.model-browser/library.json` carrying a generated id. Everything the app says
  about a file — wire paths, URL parameters, recents, cache keys — is relative to that top.
- **A root is where the app opens, and it lives inside a library.** The root comes from
  `~/.config/model-browser/config.json` (the `launch.json` precedent), overridable by
  `MODEL_BROWSER_ROOT`, and is **required**: with no root configured the server answers every
  listing with a state that says so, never with an empty directory. Picking a subfolder of an
  existing library opens there without changing the library; picking a folder with no marker
  above it makes that folder a new library and writes the marker. Picking a folder *above* an
  existing library is refused, naming the library it would swallow.
- **Paths outside the library are unreachable.** Every filesystem path the server resolves
  from a request — listings, file bytes, thumbnails, completion, zip entries — SHALL resolve
  (through symlinks) to a location under the library top, or be refused. Escapes by `..` and
  by symlink alike.
- **The library can be absent.** A configured root whose volume is not mounted is a state the
  UI shows ("the library at … is not present"), distinct from an empty tree — the same shape
  the semantic index already reports as `volume-gone`.
- **The thumbnail cache is namespaced by library and keyed by relative path**, living under
  `~/.cache/model-browser/<library-id>/`. A remount is a hit; two libraries with the same
  layout never collide; cameras — keyed by path alone, by design — stop leaking across
  libraries, which relative paths without an identity would have caused.
- **Existing cache entries are re-keyed once, not lost.** Every sidecar carries the absolute
  path it was written for, so entries under the new library top move to their new key on
  first start; cameras and axes survive, nothing re-renders.
- **Autocomplete completes within the library**, and the path bar shows and accepts
  library-relative paths. Recents and last-path reset to the root on first start under a
  library (they were absolute; nothing in them is worth carrying).
- **Meaning-search hits map through the index's root to library-relative paths.** The index
  keeps its own absolute `collection_root`; the server, which already resolves
  `collection_root + rel_path`, now also expresses the result as a library path, and refuses
  an index whose collection lies outside the library.
- **BREAKING:** the wire contract for `path` on every `/api/*` route changes from absolute to
  library-relative. Old deep links and stored recents do not resolve; the cache is migrated.
- **Explicitly not in this change:** the per-library override store (`overrides.json` —
  credits, display names, poses), moving camera/axis out of the thumb sidecar, the demo's
  public-origin guard, and multiple libraries at once. Each is its own change; this one
  gives them the folder and the identity to build on.

## Capabilities

### New Capabilities

- `library`: what a library is (marker, identity, top), how the root is configured and
  validated against it, the missing-volume state, and the confinement rule every server
  path goes through. The security requirement the demo will lean on lives here, stated for
  the local app first.

### Modified Capabilities

- `directory-browsing`: **MODIFY** *Directory listing* (the server lists directories within
  the library, not any readable directory), *Editable path bar* (shows and accepts
  library-relative paths; the root is `/`), *Server-backed path autocomplete* (completes
  within the library), *Recent directories* (library-relative; reset on first start under a
  library).
- `url-navigation`: **MODIFY** *The URL names the committed view* (paths are
  library-relative) and *Deep links restore the view* (a link resolves on any machine holding
  the same library; the no-parameter boot lands on the root, not a last absolute path).
- `zip-browsing`: **MODIFY** *Virtual path addressing* (the `<zip-path>` half is
  library-relative; the grammar is unchanged).
- `model-thumbnails`: **MODIFY** *Server-side thumbnail persistence* (keyed by library id +
  relative path + mtime; one cache directory per library), *Bounded, self-maintaining cache*
  (the hash is of the relative path; existence is tested against the library; entries
  written under absolute keys are migrated once).
- `semantic-search`: **MODIFY** *Results are assembled from this app's own view of the tree*
  (a hit's path is expressed relative to the library; an index whose collection lies outside
  the library is refused as a scope).

## Impact

**Server**

- New `server/src/library.ts`: config loading (`config.json` + `MODEL_BROWSER_ROOT`),
  marker discovery by walking up from the root, marker creation, the resolve-and-confine
  function every route uses, and the missing-volume state.
- `listing.ts` (`listDir`, `listFlat`, `complete`), `app.ts` (`/api/file`,
  `resolveEntryFile`, `/api/thumb`), `semantic.ts` (`scopeWithin`, `hitsToEntries`,
  `modelEntryAt`): the seven `isAbsolute` checks become "resolves under the library top";
  every entry `path` emitted is library-relative. `vpath.ts` is untouched — its grammar is
  about `!/`, not about where the zip lives.
- `cache.ts` (`ThumbCache`): directory per library id; key from the relative path; a
  one-time migration from sidecar `path` fields; the existence sweep resolves through the
  library.
- `index.ts` wires the library into `createApp`.

**Client**

- `lib/urlState.ts`: `path` and `model` are library-relative; a root path serializes as
  nothing.
- `lib/recents.ts`, `components/PathBar.tsx`, `App.tsx`'s `resolveView`: the default view is
  the root; recents are relative; the bar shows `/` for the root.
- `api/client.ts`: request shapes unchanged; one new call for the library state.
- The missing-library state gets a surface (the same in-flight/error line the path bar
  already owns).

**Shared**

- `shared/types.ts`: `DirEntry.path` documented as library-relative; a `LibraryState` type;
  `IndexAvailability.collectionRoot` gains its library-relative form.

**Docs and specs**

- `docs/platform-surface.md`: the user-dirs bullet gains `config.json` and the per-library
  cache directory; the marker file is the first thing the app writes beside the models —
  stated there deliberately.
- Five delta specs plus one new capability, as listed.

**Ordering against in-flight changes (hard)**

- `listing-tree-cache` keys its snapshots on the root path and inherits `ThumbCache`'s
  directory; after this change both are per-library (id + relative path). This change lands
  first; that change's design.md must be updated to say so before it is applied.
- `search-cancellation` and `thumbnail-sweep-priority` carry `path` through their listing and
  sweep paths; they are unaffected by the *meaning* of a path but touch the same functions.
  Land this change first, or rebase theirs onto it.
- The parallel exploration's `library-root-confinement` (absolute paths, "absent = unchanged")
  is subsumed by this change and should not be created.
