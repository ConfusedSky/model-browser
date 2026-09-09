## Why

A directory tile inside an archive never shows a contact sheet. Browsing into
`/Oni+Cyber+Punk+Mask.zip` gives two folder tiles, `files` and `images`, both
drawn as bare emoji — while `/api/dir` on `…zip!/files` returns two STLs whose
thumbnails are already rendered and cached. The sheet is missing for a reason
that no longer applies at that path: `peek` refuses **any** path carrying an
entry half, a rule `folder-contact-sheets` wrote to keep a listing of zip *tiles*
from paying a central-directory read per tile (6.7 s across the real library,
that change's proposal). Written on the path's shape rather than on the cost, it
also refuses the interior of an archive the user has already opened, where that
read is paid and the archive layer holds the answer.

The result reads as a bug rather than a boundary: the same kit previews itself
when it is a folder and does not when it is zipped, and the library's zipped kits
are exactly the ones whose contents a sheet would identify.

## What Changes

- A directory **inside** an archive (`/kit.zip!/parts`) derives and shows a
  contact sheet, chosen from the models under it, exactly as a filesystem
  directory's tile does.
- The peek's walk inside an archive is over the archive's own entry names under
  a prefix — no filesystem walk.
- `listZipDir` reads through the archive layer, so listing an archive and
  previewing the directories inside it share one read of it instead of paying
  one each. Browsing an archive consequently records it, as every walk already
  does.
- **The `.zip` tile itself is unchanged and still shows the archive icon.** The
  non-goal `folder-contact-sheets` recorded stands, but not on the cost it
  recorded — see Measurement. What holds it is the cost nobody wrote down: a zip
  tile's four cells must *extract* model bytes out of the archive, where a
  directory tile's four read four files. An interior pays that too and is
  accepted; a listing of a hundred archives paying it on first paint is not.
- The requirement's "Nothing to preview" scenario stops conflating the two. It
  currently retires a whole archive with "or is an archive", which now names only
  the archive's own tile.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `directory-browsing`: **Folder tiles preview their contents** — the preview
  rule extends to directories inside an archive, states how their models are
  chosen (archive entries under a prefix), and separates "a zip tile is not
  previewed" from "a folder inside a zip is".

## Measurement

The non-goal this change works around cites 6.7 s of archive-tail reads across
the library. Re-run on 2026-09-09 against the real `listZipEntries` under Bun,
over all 453 archives (139 GB) with the page cache dropped per file, that is
**0.25 s** — ~0.55 ms per archive, 8 ms with the layer warm. The old figure is
consistent with a spindle and is treated as unverified on unknown hardware, not
wrong. Nothing here leans on it; design.md carries the full table and the probe
lands as `scripts/zip-tail-cost.ts`.

## Impact

- `server/src/listing.ts` — `peek`'s entry-half refusal, and the level walk it
  delegates to for an archive interior.
- `server/src/app.ts` — `/api/dir`, `/api/peek` and the emission-time fill all
  pass the archive layer down; the fill (`FILL_PREVIEW_MAX`, the `unchosen`
  collection) now has archive-interior directories among the tiles it derives.
- `server/src/layers.ts` — a comment only. An interior's sheet has no
  invalidation path through the revalidation route (`changedDirs` comes from
  `dirMtimes`, which archives never populate, and a pass never runs for a nested
  browse), so staleness is caught at emission instead: every interior cell
  carries the containing archive's mtime and validates itself against the
  listing's (design D9).
- No client change. `Grid.tsx` already marks every `dir` tile for peeking and
  `App.tsx` already asks; both currently receive `[]`.
- No wire-shape change: an archive interior's peek answers ordinary listing
  entries like every other peek.
