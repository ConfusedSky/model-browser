# Tasks — library-overrides

> Ordering: after `library-root` (archived 2026-08-30 — keys are library paths, the file
> lives beside the marker in `MARKER_DIR`). Independent of the AO chain and of
> `folder-contact-sheets`. The `model-viewer` delta is ADD-only because
> `remove-axis-lighting`, `ao-as-recipe-dimension` and `adaptive-ao-default` MODIFY that
> capability while active — re-read their deltas before archiving this one.
> `pose-for-every-model` (planned, `web-demo-backlog` 1.2 — not yet drafted) and the
> demo-mode change build on this store; the `pose` field is reserved by name here and
> typed there. Re-read `library.ts`, `vpath.ts`, `app.ts`, `ViewerLayer.tsx` and
> `client/test/appHarness.tsx` against main before starting.

## 1. Server: the store

- [ ] 1.1 `server/src/overrides.ts`: the store module — `loadOverrides(top)` reading
      `MARKER_DIR/overrides.json` (absent → empty; unparseable or unknown `version` →
      reported once at load, empty store; every key canonicalised via
      `canonicalLibPath`, unspellable and `!/`-suffixed keys reported),
      `resolveOverrides(store, libPath)` doing the field-wise merge over the
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
- [ ] 1.3 Lifetime: the store is loaded when the library first resolves `ready`, held
      keyed to the resolved identity (id + top), and dropped wherever the library drops
      `settled` (`refresh()`, the returned-volume identity check) — per-library, never
      per-process, because a repointed root serving the previous library's credits is a
      CC-BY attribution defect, not staleness (design D1). The malformed-store report
      prints when the load happens — beside the `library <id> at <top>` line at a ready
      start, on its own line when the library resolves later. Within one resolution the
      file is read once — the restart-after-editing rule, which the generator's output
      reminds the user of
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
      one against a naive `split('/')` implementation, which must fail it; the library
      re-resolving to a different tree answers from the new store, never the old (drive
      `refresh()`); route answers `{}` for uncovered paths, refuses what the library
      refuses, 400s a missing path, and gives the 503 envelope unconfigured;
      `writeOverrides` leaves either the old file or the new one behind a simulated
      failure, never a torn one

## 2. Client: the credits block

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

## 3. The generator

- [ ] 3.1 `scripts/gen-overrides.ts` (run from repo root with `bun run`, corpus side):
      args are the library top, the kit directory (default: the top) and the metadata
      file; maps each kit's **top-level** `stem` (never `files[].stem` — 2,801 of those
      are file stems, not folders) to the key `/` + top-relative path of
      `<kitDir>/<stem>`; writes `name` + `credits`; merges into an existing store
      preserving fields and keys it does not own; reports written-vs-read counts and
      every missing `stem`; prints the restart-after-editing reminder
- [ ] 3.2 Generator test (or a self-checking dry-run mode): rerun over a store carrying
      a `pose` on a generated key leaves the pose; a missing `stem` is reported, not
      written; a kit directory below the top produces top-relative keys
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
      source link among the metadata; a model of the real library (no store) shows no
      block and no gap where one would be; `/api/overrides` on the demo root answers
      from memory (network panel: one small request per lightbox open, none on browse)
- [ ] 4.3 `docs/web-demo-notes.md`: item 1 points at this change as its implementation
      (`web-demo-backlog` 1.1 already ticks — done at drafting, 2026-08-31)
- [ ] 4.4 After archive: hand-write the new capability's `## Purpose` in
      `openspec/specs/library-overrides/spec.md` (archiving does not generate one —
      `library`'s was hand-authored) and check what the delta preambles left in both
      main specs, per the delta-comment rule
