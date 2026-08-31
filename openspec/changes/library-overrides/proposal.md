# Proposal — library-overrides

## Why

Three consumers need per-entry metadata the filesystem cannot carry: attribution
(the demo corpus is CC-BY — displayed credit is a license term, and the corpus's
provenance already exists in `metadata/miniatures.json`), display names (folder
names in the library are build ids like `Player_Character_Pack_03_3750572`), and
a stored pose per model (`pose-for-every-model`, the next change in the demo
sequence, reads it). Today the only per-path store is the thumbnail cache's
sidecar, which is bounded and **evicts** — provenance cannot live in a cache.
The shape was decided in the 2026-08-28 exploration and recorded in
`web-demo-backlog` design D2; this change drafts from that decision and does not
reopen it.

## What Changes

- One `<library>/.model-browser/overrides.json` beside the library marker: keyed
  by library path, directory keys applying to their whole subtree by longest
  prefix, file keys overriding; loaded once at server start; written atomically
  (temp + rename). Fields per key: credits (author, author URL, license, source
  URL), display name, pose.
- The server resolves an entry's effective overrides (longest-prefix merge) and
  serves them; the resolution is this change's server work, the file format its
  contract.
- The lightbox side panel gains a credits section: author, license, and a source
  link for the model being viewed, shown when the entry resolves credits and
  absent otherwise. This is the one UI consumer in this change.
- A generator populates the demo library's `overrides.json` from
  `metadata/miniatures.json` (297 kits: `author`, `author_url`, `license`,
  `source_url`, `name` per kit) — run at corpus build, rerunnable, output
  regenerable.
- Display names and poses are **fields only** here: the store carries them, and
  their consumers land separately — display names hang on `web-demo-backlog`
  decision 2.3 (rename at build vs display from store), poses on
  `pose-for-every-model`. Storing them now is what makes both follow-ups small.
- Deliberately not sqlite: "search by author" is trivial in memory once loaded;
  sqlite only if a library outgrows load-at-start, which hundreds of kits do not
  (D2, closed).

## Capabilities

### New Capabilities

- `library-overrides`: the store — file location and format, longest-prefix
  resolution, load-at-start lifetime, atomic writes, the entry-overrides answer
  the server gives, and the corpus generator.

### Modified Capabilities

- `model-viewer`: ADDs one requirement — the panel's credits section for an
  entry that resolves attribution. (Three active changes MODIFY other
  `model-viewer` requirements — `remove-axis-lighting`,
  `ao-as-recipe-dimension`, `adaptive-ao-default` — so this delta is ADD-only
  under a new title; no collision at archive.)

## Impact

- Server: a new module for the store (load, resolve, atomic write), a read
  route; `library.ts` untouched except that the store lives in the directory
  `MARKER_DIR` already names and is invisible to listings the way the marker is.
- Client: `ApiClient` gains the overrides read; the lightbox panel
  (`ViewerLayer.tsx`) renders the credits block.
- Scripts: the generator (corpus side, reads `metadata/miniatures.json`).
- Ordering: after `library-root` (archived 2026-08-30 — keys are library paths,
  the file lives beside the marker). Independent of the AO chain and of
  `folder-contact-sheets`. `pose-for-every-model` and the demo-mode change
  build on it.
- `web-demo-backlog` 1.1 is done when this change exists; its 2.3 stays open.
