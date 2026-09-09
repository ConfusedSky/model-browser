## 1. The fields, end to end

- [ ] 1.1 `OverrideCredits` (shared/types.ts) gains `licenseUrl?: string` and
      `modified?: string`, documented as D2/D3 say: the URL carries the version, the
      phrase is the corpus's wording, absent means unchanged
- [ ] 1.2 Generator (scripts/gen-overrides.ts): `Kit` and `creditsOf` map `license_url` →
      `licenseUrl` and `modified` → `modified`, strings only, absent yields no field; the
      run report adds the two counts (D5). Cells in server/test/genOverrides.test.ts: a
      modified kit and an unmodified one (fields and counts), a rerun over a four-field
      store from six-field metadata (regenerated, pose untouched); the `KITS` fixture
      gains the fields on one kit only. Falsify: drop one mapping → its cell fails
- [ ] 1.3 Loader (server/src/overrides.ts): the allow-list in `loadOverrides` names the six
      fields. server/test/overrides.test.ts: "serves only the four credit fields" becomes
      six and keeps its unknown-field assertion; a cell for the two new fields resolving
      beneath a kit key; a cell for a wrong-typed `modified` dropped and reported.
      Falsify: remove a name from the list → the six-field cell fails

## 2. The lightbox

- [ ] 2.1 `ViewerLayer.tsx`: the license `dd` renders a link (`CREDIT_LINK_CLASS`, new tab,
      `title` = URL) when `licenseUrl` is present, plain text otherwise; a fourth row
      `data-credit="modified"` after source draws the phrase verbatim when present (D4);
      `renderableCredits` counts `modified` among the fields that make a block worth
      drawing
- [ ] 2.2 client/test/viewerCredits.test.tsx: a stored license URL draws the label as a
      link; no URL draws plain text (the existing cell's assertion, kept); a modified
      phrase draws the row last in the block; no phrase draws no row and no empty `dt`.
      Falsify each: revert the link branch → the link cell fails; drop the row → the
      phrase cell fails

## 3. Records

- [ ] 3.1 `web-demo-backlog` tasks.md: gate 3.2 reworded to "attribution complete in the
      lightbox — license linked, modification indicated" and closed by this change when it
      lands; 1.8 downgraded to a courtesy that rides the landing page (1.5), with the
      reasoning (CC-BY's "reasonable manner", attribution where the work is shown)
- [ ] 3.2 docs/web-demo-notes.md: the decided row "Credits/provenance shown in the lightbox
      info panel" says the block carries the license link and the modification notice, and
      that the generated credits page is a courtesy, not a gate; deploy/demo/README.md
      §3.2's sentence on `overrides.json` names the two new fields

## 4. Land it

- [ ] 4.1 `bun run typecheck` and both suites green on merged main
- [ ] 4.2 Regenerate the store on the corpus once `model-browser-corpus` has written the
      fields: `bun run scripts/gen-overrides.ts` against
      `~/Documents/tests/test-models` (kit dir `miniatures/clustered-hq`); the report's two
      counts are non-zero (D5) — record them here
- [ ] 4.3 rsync the store to the box (README §3.2) and redeploy (`git pull && docker
      compose -f deploy/demo/compose.yaml up -d --build`) so the app re-reads it (D6)
- [ ] 4.4 Verify on `https://models.masamaeda.com`: `/api/overrides?path=<a modified kit>`
      carries `licenseUrl` and `modified`; the lightbox on a model beneath it shows the
      license as a link and the modified row; a kit the corpus marks unchanged shows no
      row. Record the kit paths and the wire answer here
- [ ] 4.5 `openspec validate credits-completion --strict`; archive dry run on a fresh copy;
      after archiving, check the applied `library-overrides` and `model-viewer` text
      carries no change-scoped prose
