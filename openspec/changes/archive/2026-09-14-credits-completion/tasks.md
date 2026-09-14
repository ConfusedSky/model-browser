## 1. The fields, end to end

- [x] 1.1 `OverrideCredits` (shared/types.ts) gains `licenseUrl?: string` and
      `modified?: string`, documented as D2/D3 say: the URL carries the version, the
      phrase is the corpus's wording, absent means unchanged
      *(2026-09-14, fable worker c5c189a, opus-reviewed merge-ready: `licenseUrl?`/`modified?` on `OverrideCredits`, documented per D2/D3)*
- [x] 1.2 Generator (scripts/gen-overrides.ts): `Kit` and `creditsOf` map `license_url` →
      `licenseUrl` and `modified` → `modified`, strings only, absent yields no field; the
      run report adds the two counts (D5). Cells in server/test/genOverrides.test.ts: a
      modified kit and an unmodified one (fields and counts), a rerun over a four-field
      store from six-field metadata (regenerated, pose untouched); the `KITS` fixture
      gains the fields on one kit only. Falsify: drop one mapping → its cell fails
      *(2026-09-14, fable worker c5c189a, opus-reviewed merge-ready: `creditsOf` maps both through `str()`; `GenerateResult.withLicenseUrl`/`withModified` and the report line; three cells in `genOverrides.test.ts` incl. the four→six rerun with pose untouched. Falsified: mapping dropped → `expected undefined to be 'https://creativecommons.org/licenses/…'`, `expected +0 to be 1`)*
- [x] 1.3 Loader (server/src/overrides.ts): the allow-list in `loadOverrides` names the six
      fields. server/test/overrides.test.ts: "serves only the four credit fields" becomes
      six and keeps its unknown-field assertion; a cell for the two new fields resolving
      beneath a kit key; a cell for a wrong-typed `modified` dropped and reported.
      Falsify: remove a name from the list → the six-field cell fails
      *(2026-09-14, fable worker c5c189a, opus-reviewed merge-ready: six-name allow-list; "serves only the four" → six with the unknown-field assertion kept (`problems` empty — the D6 old-loader property by proxy), wrong-typed `modified` reported, the two fields resolving beneath a kit key; plus a cell pinning that a partial per-model `credits` block replaces the kit's whole block (review's open item). Falsified: name removed → `expected { credits: { …(5) } } to deeply equal { credits: { …(6) } }`)*
## 2. The lightbox

- [x] 2.1 `ViewerLayer.tsx`: the license `dd` renders a link (`CREDIT_LINK_CLASS`, new tab,
      `title` = URL) when `licenseUrl` is present, plain text otherwise; a fourth row
      `data-credit="modified"` after source draws the phrase verbatim when present (D4);
      `renderableCredits` counts `modified` among the fields that make a block worth
      drawing
      *(2026-09-14, fable worker c5c189a, opus-reviewed merge-ready: licence `dd` is an `<a>` with the author link's exact attribute set when a URL is stored; fourth row `data-credit="modified"` after source, labelled "this copy" because the panel's file-date row already reads `modified` (D2/D4); `renderableCredits` counts `modified`. A store-supplied `javascript:` href is neutralised by React 19, same treatment as the author and source links)*
- [x] 2.2 client/test/viewerCredits.test.tsx: a stored license URL draws the label as a
      link; no URL draws plain text (the existing cell's assertion, kept); a modified
      phrase draws the row last in the block; no phrase draws no row and no empty `dt`.
      Falsify each: revert the link branch → the link cell fails; drop the row → the
      phrase cell fails
      *(2026-09-14, fable worker c5c189a, opus-reviewed merge-ready: `viewerCredits.test.tsx`: link, plain text, phrase last, no row and no blank label for an unchanged copy, phrase alone worth drawing. Falsified: link branch → `expected null not to be null`; row dropped → `expected [ 'author', 'license', 'source' ] to deeply equal [ …, 'modified' ]`)*
## 3. Records

- [x] 3.1 `web-demo-backlog` tasks.md: gate 3.2 reworded to "attribution complete in the
      lightbox — license linked, modification indicated" and closed by this change when it
      lands; 1.8 downgraded to a courtesy that rides the landing page (1.5), with the
      reasoning (the licences' "reasonable manner", attribution where the work is shown)
      *(2026-09-14, c5c189a: gate 3.2 reworded, 1.8 a courtesy riding 1.5, history kept)*
- [x] 3.2 docs/web-demo-notes.md: the decided row "Credits/provenance shown in the lightbox
      info panel" says the block carries the license link and the modification notice, and
      that the generated credits page is a courtesy, not a gate; deploy/demo/README.md
      rsync block under "Populate the volumes" names the two new fields in its sentence on
      `overrides.json` (the README labels it **3.2 The corpus** in prose, not as a heading)
      *(2026-09-14, c5c189a: the notes' decided row and gate line updated, the "297/297 CC-BY" figure annotated with 444 kits under seven CC licences; the README's rsync block names both fields and the restart rule)*
## 4. Land it

- [x] 4.1 `bun run typecheck` and both suites green on merged main
      *(2026-09-14 on merged main after c5c189a plus the replace-whole cell: client 68 files / 968 passed; server 23 files / 748 passed; `bun run typecheck` both Done, exit 0)*
- [x] 4.2 Regenerate the store on the corpus once `model-browser-corpus` has written the
      fields: `bun run scripts/gen-overrides.ts` against
      `~/Documents/tests/test-models` (kit dir `miniatures/clustered-hq`); the report's two
      counts are non-zero (D5) — record them here
      *(2026-09-14, coordinator: the previous store kept beside it as `overrides.json.bak-2026-09-14`; run against `miniatures/clustered-hq` as top with `metadata/miniatures.json`: "wrote 444 keys from 454 kits read … with license URL: 444, modified: 444"; 10 stems named no directory and were skipped, as before; the store now carries all six credit fields on all 444 keys, e.g. `/Player_Character_Pack_03_3750572` → `https://creativecommons.org/licenses/by/4.0/`, "re-exported as STL and decimated for display"; re-run after the cold review with the per-value tallies added to the report: 305 × by/4.0, 31 × by-sa/4.0, 29 × by-nd/4.0, 23 × publicdomain/zero/1.0, 22 × by-nc-sa/4.0, 18 × by-nc-nd/4.0, 16 × by-nc/4.0; 372 × "re-exported as STL and decimated for display", 72 × "re-exported as STL")*
- [x] 4.3 **Push main first** — the box redeploys with `git pull`, and an origin that stops
      before this change rebuilds the four-field app, whose loader drops the two fields
      silently (D1), so the live check would read as a store bug. Then rsync the store to
      the box (the README's **3.2 The corpus** rsync block) and redeploy (`git pull && docker
      compose -f deploy/demo/compose.yaml up -d --build`) so the app re-reads it (D6). The
      rollback material is the local backup the regeneration left beside the store,
      `miniatures/clustered-hq/.model-browser/overrides.json.bak-2026-09-14` (444 keys,
      four credit fields) — the only copy of the previous store once the rsync lands
      *(2026-09-14, coordinator on Masa's word: origin already at 32e112e (another session had pushed; `git push` → Everything up-to-date); rsync landed `overrides.json` (209,225 bytes, 444 keys, 444 with `modified`) in `/srv/corpus/miniatures/clustered-hq/.model-browser/` at 22:31:32 box time; `git pull` on the box to 32e112e, `docker compose up -d --build` rebuilt demo-app and demo-index images and recreated demo-app-1 only — caddy (up 5 days) and the index (up 47 h) untouched)*
- [x] 4.4 Verify on `https://models.masamaeda.com`: `/api/overrides?path=<a modified kit>`
      carries `licenseUrl` and `modified`; the lightbox on a model beneath it shows the
      license as a link and the "this copy" row. The demo's root is the kit directory, so a
      kit's path is `/<stem>`: `/api/overrides?path=/Player_Character_Pack_03_3750572`.
      No shipped kit is unmodified (444/444 carry a phrase), so the no-row case is the
      fixture cell's (`viewerCredits.test.tsx`, "no row and no blank label for an unchanged
      copy"), not a live check. Record the kit path and the wire answer here
      *(2026-09-14, coordinator, live: `GET /api/overrides?path=/Player_Character_Pack_03_3750572` → `{credits: {author: "Valandar", authorUrl, license: "Creative Commons - Attribution", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", modified: "re-exported as STL and decimated for display", sourceUrl: "https://www.thingiverse.com/thing:3750572"}, name: "Player Character Pack 03"}`; headless Chromium as a visitor — root → the kit tile → the `CatfolkRogue.stl` tile → the lightbox: rows author / license / source / modified, the license `dd` an `<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank">Creative Commons - Attribution</a>`, the fourth row `dt` "this copy", `dd` the phrase; the panel's `dt`s read format, size, modified, author, license, source, this copy — the file-date row and the notice row apart. The demo's folder URLs are `/?path=<folder>&model=<path>`, not path-segment URLs)*
- [x] 4.5 `openspec validate credits-completion --strict`; archive dry run on a fresh copy;
      after archiving, check the applied `library-overrides` and `model-viewer` text
      carries no change-scoped prose
      *(2026-09-14: valid under --strict; archive dry run on a fresh copy applies ~3 (library-overrides ~2, model-viewer ~1) and the applied text carries no change-scoped prose per the cold review's collapsed grep. The archive itself waits on Masa's word)*