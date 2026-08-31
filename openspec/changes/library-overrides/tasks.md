# Tasks — library-overrides

> Ordering: after `library-root` (archived 2026-08-30 — keys are library paths, the file
> lives beside the marker in `MARKER_DIR`). Independent of the AO chain and of
> `folder-contact-sheets`. The `model-viewer` delta is ADD-only because
> `remove-axis-lighting`, `ao-as-recipe-dimension` and `adaptive-ao-default` MODIFY that
> capability while active — re-read their deltas before archiving this one.
> `pose-for-every-model` and the demo-mode change build on this store; the `pose` field is
> reserved by name here and typed there. Re-read `library.ts`, `app.ts`, `ViewerLayer.tsx`
> and `client/test/appHarness.tsx` against main before starting.

## 1. Server: the store

- [ ] 1.1 `server/src/overrides.ts`: the store module — `loadOverrides(top)` reading
      `MARKER_DIR/overrides.json` (absent → empty; unparseable or unknown `version` →
      report once on the startup path, empty store), `resolveOverrides(store, libPath)`
      doing the field-wise longest-prefix merge (segment boundaries; keys and lookups are
      library paths, so `!` vpaths need no special case), and `writeOverrides` (temp +
      rename + fsync — the atomic pattern every writer of this file uses, the generator
      first among them)
- [ ] 1.2 Types in `shared/types.ts`: the per-key fields (`name`, `credits {author,
      authorUrl, license, sourceUrl}`, `pose` reserved as opaque) and the resolved answer.
      The pose field's concrete type belongs to `pose-for-every-model` — say so where it
      is declared
- [ ] 1.3 Load at start: the store is read once when the library resolves (beside the
      `library <id> at <top>` startup line; a report for a malformed file prints there),
      and held in memory for the server's life — the read-once rule `config.json` and
      `launch.json` already follow
- [ ] 1.4 `app.ts` `GET /api/overrides?path`: `canonicalLibPath`, resolve through the
      library (refusals propagate), answer the resolved fields or `{}`; a path route, so
      the not-ready envelope gates it with no new code
- [ ] 1.5 Server tests (`server/test/overrides.test.ts`, conventions per
      `server/test/CLAUDE.md`): absent file; malformed file (server still answers, store
      empty); field-wise merge (kit credits + file-only pose resolve together); segment
      boundary (`/kit` does not cover `/kit2/…`); archive inheritance
      (`/kit/a.zip!/x.stl` gets `/kit/a.zip`'s or `/kit`'s fields); route answers `{}`
      for uncovered paths, refuses what the library refuses, and gives the 503 envelope
      unconfigured; `writeOverrides` leaves either the old file or the new one behind a
      simulated failure, never a torn one

## 2. Client: the credits block

- [ ] 2.1 `api/client.ts` `overrides(path)` on `ApiClient` and `HttpApiClient` — the
      resolved fields, `jsonOrThrow`
- [ ] 2.2 The lightbox panel (`ViewerLayer.tsx`): an attribution block — author (an
      `<a>` when `authorUrl` is stored, plain text otherwise), license, source link —
      rendered only when the viewed entry resolved credits. No loading state, no error
      state: absent and failed render identically (spec: displayed where it exists,
      never advertised as missing). The read follows the viewer subject; a late answer
      for a departed subject is dropped
- [ ] 2.3 Client tests: harness gains an `overrides` mock (default `{}` — every
      pre-existing test then renders no block; cleared per mount like `getThumb`);
      credited model shows author/license/source with the right hrefs; uncredited model
      and failed read render identically (no block, viewer unaffected); a late answer
      after the subject changed does not render; the request goes through `ApiClient`
      (no raw fetch)

## 3. The generator

- [ ] 3.1 `scripts/gen-overrides.ts` (run from repo root with `bun run`, corpus side):
      args are the corpus root and the metadata file; maps each kit's `stem` to
      directory key `/<stem>`; writes `name` + `credits`; merges into an existing store
      preserving fields and keys it does not own; reports written-vs-read counts and
      every missing `stem`; prints the restart-after-editing reminder
- [ ] 3.2 Generator test (or a self-checking dry-run mode): rerun over a store carrying
      a `pose` on a generated key leaves the pose; a missing `stem` is reported, not
      written
- [ ] 3.3 Run it against the demo corpus root (`~/Documents/tests/test-models`, metadata
      at `metadata/miniatures.json`, 297 kits): record the counts here beside the run
      date. This produces the store `web-demo-backlog` gate 3.2's credits page will read

## 4. Verification

- [ ] 4.1 `bun run test` / `bun run typecheck` clean (vitest from the workspace dirs)
- [ ] 4.2 Live: lightbox on a demo-corpus model shows its kit's author, license and
      source link; a model of the real library (no store) shows no block and no gap
      where one would be; `/api/overrides` on the demo root answers from memory
      (network panel: one small request per lightbox open, none on browse)
- [ ] 4.3 `docs/web-demo-notes.md`: item 1 points at this change as its implementation;
      `web-demo-backlog` 1.1 ticks with this change's name
