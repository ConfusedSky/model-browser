# Tasks — library-overrides

> Ordering: after `library-root` (archived 2026-08-30 — keys are library paths, the file
> lives beside the marker in `MARKER_DIR`). Independent of the AO chain and of
> `folder-contact-sheets`. The `model-viewer` delta is ADD-only because
> `remove-axis-lighting`, `ao-as-recipe-dimension` and `adaptive-ao-default` MODIFY that
> capability while active — re-read their deltas before archiving this one.
> `pose-for-every-model` (planned, `web-demo-backlog` 1.2 — not yet drafted) and the
> demo-mode change build on this store; the `pose` field is reserved by name here and
> typed there. Re-read `library.ts`, `vpath.ts`, `app.ts`, `ViewerLayer.tsx` and
> `client/test/appHarness.tsx` against main before starting. The display-name
> consumer was folded in when backlog 2.3 was decided (display from the store, Masa
> 2026-08-31) — it adds a `directory-browsing` delta (ADD-only beside
> `search-cancellation`'s, no title overlap) and tasks 1.6/2.4.

## 1. Server: the store

- [ ] 1.1 `server/src/overrides.ts`: the store module — `loadOverrides(top)` reading
      `MARKER_DIR/overrides.json` (absent → empty; unparseable or unknown `version` →
      reported once at load, empty store; every key canonicalised via
      `canonicalLibPath` — which covers only the filesystem half, so the loader
      additionally strips a trailing slash from a key's entry half and rejects+reports
      an empty entry half (`…!/`), the forbidden zip-root spelling; unspellable keys
      reported),
      `resolveOverrides(store, libPath)` doing the field-wise merge — `name`
      excepted: it never inherits and resolves from the exact key alone (D2/D7) — over the
      **parse-then-walk** ancestor list (split on the first `!/` per `parseVPath`'s
      grammar; ancestors are `/`, the filesystem half's directories, the archive file's
      path, then the entry half's interior directories — a naive `split('/')` yields
      `a.zip!` and never finds `/kit/a.zip`, which is the trap design D2 records), and
      `writeOverrides` (temp + rename + fsync — the pattern every writer of this file
      uses, the generator first). No Bun APIs — the module must run on Node (D1 seam)
- [ ] 1.2 Types in `shared/types.ts`: the per-key fields (`name`, `credits {author,
      authorUrl, license, sourceUrl}`, `pose` reserved as opaque) and the resolved answer.
      The pose field's concrete type belongs to `pose-for-every-model` — say so where it
      is declared
- [ ] 1.3 Lifetime: the store is loaded when the library first resolves `ready` and held
      keyed to the resolved identity (id + top) — per-library, never per-process, because
      a repointed root serving the previous library's credits is a CC-BY attribution
      defect, not staleness (design D1). The mechanism is a compare, not a hook:
      `Library` exposes no event on `settled`, so the store holder keeps
      `{identity, store}` and compares against `state()`'s ready answer on each
      `/api/overrides`, reloading on mismatch — zero `library.ts` changes, keeping the
      proposal's "untouched" true. Eager load from `index.ts`'s existing
      `void library.state().then(...)` when ready at start, which is what puts the
      malformed-store report beside the `library <id> at <top>` line; a library that
      resolves later loads (and reports) on the first overrides request. Within one
      resolution the file is read once — the restart-after-editing rule, which the
      generator's output reminds the user of
- [ ] 1.4 `app.ts` `GET /api/overrides?path`: `path` required (400 `path is required`,
      like every sibling), `canonicalLibPath`, resolve through the library (refusals
      propagate), answer the resolved fields or `{}`; a path route, so the not-ready
      envelope gates it with no new code
- [ ] 1.5 Server tests (`server/test/overrides.test.ts`, conventions per
      `server/test/CLAUDE.md`): absent file; malformed file and unknown-version file
      (server still answers, store empty, condition reported); uncanonical key (`/kit/`)
      canonicalised and matched; field-wise merge (kit credits + file-only pose resolve
      together); segment boundary (`/kit` does not cover `/kit2/…`); archive inheritance
      through the parse-then-walk list (`/kit/a.zip!/parts/x.stl` resolves `/kit/a.zip`'s
      credits AND an interior key `/kit/a.zip!/parts` overrides per field) — falsify this
      one against a naive `split('/')` implementation, which must fail it; an entry-half
      trailing-slash key (`/kit/a.zip!/parts/`) is stripped and matched; an
      empty-entry-half key (`…!/`) rejected and reported; a zip-root *lookup*
      (`/kit/a.zip!/`) resolves as `/kit/a.zip` does; the library
      re-resolving to a different tree answers from the new store, never the old (drive
      `refresh()` — no production caller today, `library.test.ts` is the precedent; the
      live path is `compute()`'s returned-volume branch); route answers `{}` for
      uncovered paths, refuses what the library
      refuses, 400s a missing path, and gives the 503 envelope unconfigured;
      `writeOverrides` leaves either the old file or the new one behind a simulated
      failure, never a torn one
- [ ] 1.6 Display names ride the listing (D7): at emission, each entry's exact library
      path is looked up in the loaded store — a Map get, no prefix walk — and a hit
      attaches `displayName` to the wire `DirEntry` (optional field, `shared/types.ts`).
      Applies to every listing shape from one seam so browse, flat/deep search and
      `/api/peek` all carry it; a library with no store emits byte-identical listings.
      Server tests: a named directory's entry carries `displayName` in a browse, a flat
      listing and a peek answer; a model beneath it does not (exact key, not prefix);
      no store → no field on any entry

## 2. Client: the credits block and the tile names

- [ ] 2.1 `api/client.ts` `overrides(path)` on `ApiClient` and `HttpApiClient` — the
      resolved fields, `jsonOrThrow`
- [ ] 2.2 The lightbox panel (`ViewerLayer.tsx`): an attribution block — author (an
      `<a>` when `authorUrl` is stored, plain text otherwise), license, source link —
      rendered only when the viewed entry resolved credits, **among the metadata `<dl>`
      and before the action strip** (the main spec's "describes before it offers" rule;
      the score/z rows are the precedent for a conditional metadata block). No loading
      state, no error state: absent and failed render identically, and the block may
      appear after the panel does. The read follows the viewer subject on the panel's
      existing ignore-on-stale idiom (the `getThumb` effect's `alive` flag)
- [ ] 2.3 Client tests: harness gains an `overrides` mock (default `{}` — every
      pre-existing test then renders no block; cleared per mount like `getThumb`);
      credited model shows author/license/source with the right hrefs, positioned before
      the action strip; uncredited model and failed read render identically (no block,
      viewer unaffected); a late answer after the subject changed does not render; the
      request goes through `ApiClient` (no raw fetch)
- [ ] 2.4 Tiles render `displayName` (D7): `Grid.tsx` labels a tile with
      `entry.displayName ?? baseName(entry.name)` — dir, zip and model tiles alike, sheet
      preview cells' titles included — while `title` and the accessible name keep the real
      name (two same-named parts are told apart by the file name, and the disk is grepped
      by it). Find, deep search and the flat filter keep matching real names — display
      only (2.3's deciding question). Client tests: a named kit tile shows the stored name
      with the real name in `title`; an unnamed model beneath it keeps its file-derived
      label; the find filter matches the real name and not the stored one; no
      `displayName` → labels byte-identical to today

## 3. The generator

- [ ] 3.1 `scripts/gen-overrides.ts` (run from repo root with `bun run`, corpus side):
      args are the library top, the kit directory (default: the top; refused unless it
      is the top or beneath it — outside, `relative()` yields `..`-keys that normalise
      into plausible wrong spellings) and the metadata file; maps each kit's **top-level** `stem` (never `files[].stem` — 2,801 of those
      are file stems, not folders) to the key `/` + top-relative path of
      `<kitDir>/<stem>`; writes `name` + `credits`; merges into an existing store
      preserving fields and keys it does not own; reports written-vs-read counts and
      every missing `stem`; prints the restart-after-editing reminder
- [ ] 3.2 Generator test (or a self-checking dry-run mode): rerun over a store carrying
      a `pose` on a generated key leaves the pose; a missing `stem` is reported, not
      written; a kit directory below the top produces top-relative keys; a kit
      directory outside the top is refused before anything is written
- [ ] 3.3 Run it against the shipped demo corpus: library top **and** kit directory at
      `~/Documents/tests/test-models/miniatures/clustered-hq` (the shipped variant —
      `test-models` itself holds three copies of every stem under
      `miniatures/{original,deduplicated,clustered-hq}` and is the wrong top for the
      demo), expecting keys `/<stem>` for the 297 kits; record the written/read counts
      here beside the run date. This produces the store `web-demo-backlog` gate 3.2's
      credits page will read

## 4. Verification

- [ ] 4.1 `bun run test` / `bun run typecheck` clean (vitest from the workspace dirs)
- [ ] 4.2 Live: lightbox on a demo-corpus model shows its kit's author, license and
      source link among the metadata; the demo root's 297 kit tiles show their
      `miniatures.json` titles instead of stems, and find still matches stems; a model of the real library (no store) shows no
      block and no gap where one would be; `/api/overrides` on the demo root answers
      from memory (network panel: one small request per lightbox open, none on browse)
- [ ] 4.3 `docs/web-demo-notes.md`: item 1 points at this change as its implementation
      (`web-demo-backlog` 1.1 already ticks — done at drafting, 2026-08-31)
- [ ] 4.4 After archive: hand-write the new capability's `## Purpose` in
      `openspec/specs/library-overrides/spec.md` (archiving does not generate one —
      `library`'s was hand-authored) and check what the delta preambles left in both
      main specs, per the delta-comment rule
