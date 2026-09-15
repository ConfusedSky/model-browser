# Tasks — landing-page

> **Ordering and collisions (checked 2026-09-15 against every active change's deltas).**
> This change MODIFIES `feature-report`'s *The client resolves the report once and
> shapes surfaces by it* (the byte-identity sentence) and ADDs one requirement there,
> ADDs one to `library-overrides`, and creates `visitor-intro`; no active change
> carries a delta on any of the three. `corpus-bake` owns the active
> `deployment-infrastructure` block, so the runbook edit here is docs only and its
> script call into the bake's `--ship` step (its 1.5, not yet landed) is that change's
> one-line follow-up (D9) — either may archive first. `entry-stat-revalidation`'s
> `public-deployment` delta gives every report field an environment override the
> moment it has a default, so `intro` gains one for free whichever lands first.
> **Shared files:** `deploy/demo/README.md` §5 with `corpus-bake` (different lines;
> re-read before editing); `client/src/App.tsx` with `search-cancellation` (its fetch
> effect; the header/banner mount, `runQuery` and the placeholder here);
> `client/test/appHarness.tsx`'s `DEFAULT_REPORT` with nothing active. Verify each
> claim with `git status` and a re-read at apply — main moves under long-lived drafts.

## 1. The field and the credits route (server + shared)

- [x] 1.1 *(worker A, commit 8686bbc; server 801/client 996 green; falsified by dropping `intro` from DEFAULT_FEATURES: 4 cells failed incl. the strict parser refusing the shipped file)* Add `intro: boolean` to `FeatureReport` in `shared/types.ts` with its doc
      comment (an offer, no route, default off) and `intro: false` to `DEFAULT_FEATURES`
      in `server/src/app.ts`; verify `server/test/features.test.ts`' spelt-out report and
      `refusals.test.ts`' `reported(app)` equality gain the field and pass, and that
      `FEATURE_KEYS` accepts `intro` in `config.test.ts` (a config with `"intro": true`
      loads; a misspelt key is still refused)
- [x] 1.2 *(worker A, commit 8686bbc; server 801/client 996 green; falsified)* Set `"intro": true` in `deploy/demo/config.json`; verify the demo
      configuration cell in `server/test/config.test.ts` expects the field on and every
      other field as before
- [x] 1.3 *(worker A, 8686bbc: `shared/credits.ts` and `client/src/lib/credits.ts`; ViewerLayer imports both)* Move `renderableCredits` from `client/src/viewer/ViewerLayer.tsx` to
      `shared/credits.ts` (pure, no imports) and import it back in `ViewerLayer`; move
      `hostLabel` and `CREDIT_LINK_CLASS` to a new `client/src/lib/credits.ts` and
      import them in `ViewerLayer` (D8 — nothing the About entry imports may reach the
      renderer); verify the client suite is green and `grep -rn "from '../viewer/ViewerLayer'" client/src/lib client/src/components` matches nothing new
- [x] 1.4 *(worker A, commit 8686bbc; server 801/client 996 green; falsified by removing the renderableCredits filter: the `{}`-credits cell failed)* `listCredits(store)` in `server/src/overrides.ts`, filtering by
      `renderableCredits`, and `CreditedKit` in `shared/types.ts` (D8); verify
      `server/test/overrides.test.ts` cells: every kit with its own credits once in key
      order, an inheriting key with a name but no credits absent, a key whose credits are
      `{}` absent, an empty store answers `[]`
- [x] 1.5 *(worker A, 8686bbc: three route cells incl. the raw-body grep for the fixture top; the not-ready envelope is the `/api/*` gate, which the doc comment names)* `GET /api/credits` beside `/api/overrides` in `server/src/app.ts` with the
      not-ready envelope; verify a route test answers the list on a ready library and
      the state envelope when unconfigured, and that the answer carries library paths
      only (grep the body for the fixture's filesystem top: no match)
- [x] 1.6 *(worker A, 8686bbc; five more spelt-out reports in client tests gained `intro: false` (mechanical, typecheck-forced))* `ApiClient.credits()` in `client/src/api/client.ts` and the pass-through in
      `client/src/api/localFramings.ts`; verify `client/test/appHarness.tsx`'s fake
      gains `credits` (default `[]`) and `DEFAULT_REPORT` gains `intro: false`, and the
      client suite is green before any UI lands

## 2. The example queries and their proof

- [x] 2.1 *(worker A, 8686bbc: six phrases from ten candidates probed live 2026-09-15 — counts 60/60/60/60/58/60; "a knight…" (hobgoblin first), "a pirate" and "a giant spider" (10 hits) dropped; the coordinator concurred)* `shared/exampleQueries.ts` with `EXAMPLE_QUERIES` — five to seven phrases
      chosen by running candidates against the live index at
      https://models.masamaeda.com and keeping those whose first screen is
      unmistakably right; record the date and the index's `/status` counts in the
      module's comment; verify a `client/test/exampleQueries.test.ts` cell asserts
      non-empty, unique, each under `SEARCH_TEXT_MAX`
- [x] 2.2 *(worker A, 8686bbc: six cells; falsified by ignoring an empty `entries`; live run `6 example queries answer on https://models.masamaeda.com`, exit 0; against 127.0.0.1:1 six `failed:` lines, exit 1)* `scripts/check-example-queries.ts <origin>` (D9): POST each query to
      `<origin>/api/semantic` as `{ text, ...TUNING_DEFAULTS }` (imported from
      `client/src/lib/searchOptions.ts`), exit 1 naming every query with no `entries`
      or a failed request, else print the count; verify by running it from this
      machine against the live origin (exit 0, the count) and, in
      `server/test/checkExampleQueries.test.ts` over the exported core with a fake
      `fetch`: a stub answering `[]` for one query exits 1 naming it, and the body
      sent carries `minScore` and `top` at the defaults
- [x] 2.3 *(worker A, 8686bbc; only §5 touched)* `deploy/demo/README.md` §5: change "every field false" to "every field false
      but `intro`", and add the check as a post-deploy step after the library check,
      labelled as run from the developer machine (the box has no Bun); verify the
      section reads in order and `corpus-bake`'s pending §5 edits are not overwritten
      (re-read the file first)

## 3. The banner, the header affordances and the chip transition (client)

- [x] 3.1 *(worker B, commit fee0cbb; client 1037 green)* `meaningRunnableAt(index, path)` in `client/src/state/selectors.ts`, and
      `SidePanel`'s `meaningRunnable` switched to it; verify `client/test/sidePanel.test.tsx`
      is unchanged and green
- [x] 3.2 *(worker B, commit fee0cbb; client 1037 green: `commitDraft` shared by submit and runQuery; app cell asserts q= and mode=meaning and Back to the top)* Reducer action `{ type: 'runQuery'; text; mode }` in
      `client/src/state/reducer.ts` (D4: draft, mode, then the `'submit'` body) and
      `runQuery(text)` in `App` calling `setSearchMode('meaning')` then `commit`;
      verify a reducer cell shows one transition yields the committed meaning view with
      the draft set, and an app cell shows the URL names `q` and `mode=meaning` and
      that history goes back to the top
- [x] 3.3 *(worker B, commit fee0cbb; client 1037 green)* `client/src/lib/intro.ts` — `introDismissedStore` (D7), the links
      (`ABOUT_URL = '/about.html'`, `CREDITS_URL = '/about.html#credits'`,
      `SOURCE_URL = 'https://github.com/ConfusedSky/model-browser'`) and `pickExample`;
      verify a cell reads default false, writes '1', and reads it back
- [x] 3.4 *(worker B, commit fee0cbb; client 1037 green: 17 cells in introBanner.test.tsx; index mocked `{ state: ready, collectionRoot: / }`)* `client/src/components/IntroBanner.tsx` — the sentence, the query row, the
      surprise button, the three links, the dismiss button (`aria-label`), whole-literal
      Tailwind classes; mounted in `App` between `<header>` and `<main>` under
      `features?.intro === true && !dismissed && atTop` (D3); verify app cells: drawn
      at `/` with `intro: true`; absent with `DEFAULT_REPORT`, with a never-resolving
      report, and on a folder or query URL; chips and surprise absent with the index
      `absent` and present once `indexAvailability` resolves
      `{ state: 'ready', collectionRoot: '/' }` (`indexCovers` is false without a
      `collectionRoot`); the surprise button runs the injected pick
- [x] 3.5 *(worker B, commit fee0cbb; client 1037 green; a throwing setItem spied on the instance (Storage.prototype does not intercept happy-dom))* Dismissal: the button writes the flag and unmounts the banner; verify app
      cells: after dismiss, remount at `/` draws no banner; a chip click then back does
      not dismiss (banner drawn again); a `localStorage.setItem` throwing in the cell
      still hides the banner for the page's lifetime
- [x] 3.6 *(worker B, commit fee0cbb; client 1037 green)* Header affordances: `About` link always, `Surprise me` when
      `meaningRunnableAt(index, '/')`, both only when `features?.intro === true`; verify
      app cells show both after dismissal with the index ready, the button absent with
      the index absent, and neither with `DEFAULT_REPORT`
- [x] 3.7 *(worker B, commit fee0cbb; client 1037 green — the happy-dom cell asserts the banner is outside `<main>` in both branches (falsified by moving it inside: that one cell failed); browser on 5173 2026-09-15: banner top 63 / height 55, `<main>` top 118, first tile top 130 with the banner outside the scroller)* Grid height: a happy-dom cell asserts only what it can — the banner node is
      not a descendant of `<main>` while the listing is in flight and after it renders
      (happy-dom lays nothing out, so no rect is meaningful there); the real check is in
      the browser on 5173, measuring `getBoundingClientRect` of the grid's first tile
      before and after the top listing resolves (equal `top`), restoring anything the
      probe touches inside the same `evaluate`

## 4. The placeholder and the starting mode

- [x] 4.1 *(worker B, commit fee0cbb; client 1037 green: 8 cells under fake timers; live on 5173 after dismissal the placeholder read "a skeleton warrior" then "a wizard casting a spell" 4.5 s later, aria-label unchanged)* `useCyclingPlaceholder` in `client/src/hooks/useCyclingPlaceholder.ts` (D6)
      and the input's `placeholder` expression in `App`; verify app cells under fake
      timers: cycles in meaning mode with the index ready and the banner dismissed,
      shows the ordinary text in name mode, with a draft, with the banner drawn, and
      with `DEFAULT_REPORT`; `aria-label` unchanged (`searchInput()` still resolves)
- [x] 4.2 *(worker B, commit fee0cbb; client 1037 green: 8 cells; falsified by no-op applySessionSearchMode (folder-click cell failed) and by dropping the subject guard (late-report cell failed); live on 5173 with storage cleared: `model-browser:search-mode` stayed null while the panel showed Meaning)* `hasStoredSearchMode()` (never throws) and `applySessionSearchMode(next)`
      (closure only, no write) in `client/src/lib/searchOptions.ts`, and the one-shot
      rule in `App` (D5); verify app cells: with `intro: true`, the index
      `{ state: 'ready', collectionRoot: '/' }`, no stored mode and a bare `/` URL the
      mode is meaning and `model-browser:search-mode` stays unset; a folder click then
      keeps meaning mode (`ownPrefs` reads the closure) and the key is still unset; with
      the index `absent` the mode stays name until the index resolves ready; with a
      stored `name` it stays name; with `?q=x&mode=name` the view is name; a name search
      committed before the report resolves is not re-run (`semanticSearch` never called)
      and the mode stays name; with `DEFAULT_REPORT` the mode is name — the closure is
      reset in `beforeEach` with `applySessionSearchMode('name')` plus
      `localStorage.clear()`, never with `setSearchMode`, which writes the key the
      cells test for absence

## 5. The About page

- [x] 5.1 *(worker C, commit 9ea1d0d: `bun run build` emits about.html beside index.html; about.html loads about-*.js + index-*.js with 0 `WebGLRenderer` hits, main-*.js has 5; the viteEntries cell falsified by dropping the entry)* `client/about.html`, `client/src/about.tsx` and the second entry in
      `client/vite.config.ts` (D2); verify `bun run build` emits `dist/about.html` beside
      `dist/index.html`, the server on 3177 serves `/about.html` as HTML with
      `no-cache` (`createStaticHandler`'s non-asset header), `rm -rf client/dist`
      afterwards — and a cell reading `../vite.config.ts?raw` asserts both entries are
      named, so a dropped entry fails in CI rather than on the box
- [x] 5.2 *(worker C, 9ea1d0d, every section with a `{/* source: … */}` comment; Limitations run live 2026-09-15, all three reproduced (first-five paths in the JSX comment); "a bicycle" answered 0 at minScore 0.1, so the copy does not claim the search always answers; the differences list describes what ships (design, "Decided at apply"); corpus repo private → named, not linked. Coordinator fixes after: the fragment scroll (df051fb, twice — measured 758 px short after the first) and the page's own dark ground (2e807dd))* `client/src/components/AboutPage.tsx` — every section the spec lists, in that
      order, with `id`s (`#credits` among them) and the way back; the copy written at
      apply against D10's sources, each Limitations example and each example query run
      against the live index that day; verify a cell renders every section heading, and
      a grep of the page for `%`, `/run/`, `/srv/`, `/home/` and `cache` matches nothing
      but the privacy line's "this browser's storage"
- [x] 5.3 *(worker C, 9ea1d0d; falsified by removing the empty-answer branch)* `CreditsList` in `AboutPage` via `api.credits()`, importing `hostLabel` and
      `CREDIT_LINK_CLASS` from `client/src/lib/credits.ts` (never from `ViewerLayer`;
      verify with `bun run build` that `dist/assets` has no three.js chunk reachable
      from `about.html`); verify a cell with three fake kits renders
      three lines with author, licence and source linked and the modification phrase on
      the one that has it, and an empty answer renders the "no credits" sentence
- [x] 5.4 *(live 2026-09-15 on models.masamaeda.com: `/api/overrides?path=/Player_Character_Pack_03_3750572` and its `/api/credits` line agree field for field; every one of the 444 kits carries `modified` ("re-exported as STL and decimated for display"), so there is no unmodified kit to compare — the list says so through the phrase on every line)* Verify the credits list agrees with the lightbox on the live host for two
      kits (one modified, one not): same author, licence link, source, phrase

## 6. Records, deploy, verify live

- [x] 6.1 *(done at draft time, f1a0391, and the "a bicycle" finding added 2026-09-15)* `docs/web-demo-notes.md` item 4: one line saying it is superseded by
      `landing-page` (this change), the decisions kept there for history; verify the
      line is present and no decision text was removed
- [x] 6.2 *(backlog 1.5/1.8 and corpus-bake's follow-up line written 2026-09-15; the corpus-bake session was not reachable, so the line names this change and asks nothing of theirs)* `openspec/changes/web-demo-backlog/tasks.md`: 1.5 names this change; 1.8 says
      the credits list rides `/about.html#credits`; `corpus-bake`'s tasks gain the
      one-line follow-up to call `scripts/check-example-queries.ts` from its `--ship`
      step (message that session first — `shared-tree-collision-recovery`); verify
      `git diff` shows exactly those lines
- [x] 6.3 *(server 801 / client 1047+ green on merged main 2026-09-15; typecheck 0/0; validate and archive dry-run clean after the spec rewording)* `bun run test`, `bun run typecheck`, `openspec validate landing-page` and the
      archive dry-run (`T=$(mktemp -d); cp -r openspec $T/; (cd $T && openspec archive
      landing-page --yes)`) all pass
- [x] 6.4 *(deployed 2026-09-15 at cbad523 after two image fixes (c53f64a copies scripts/, cbad523 un-ignores it — corpus-bake's checkBake.test.ts had broken the box build); check-bake ok; from outside: features every field false but intro, /about.html 200, /api/credits 444, `6 example queries answer`; in the browser on the live host: banner at /, six chips, a chip → q=a stone golem&mode=meaning with 60 tiles, Back → banner again, dismissal flag written)* Deploy per the runbook and run the check against the public origin; verify
      on https://models.masamaeda.com: banner at `/`, none on a folder URL, a chip runs
      and the URL names it, dismissal holds across reload, `/about.html#credits` lists
      the kits, and `curl /api/features` shows `intro: true` with every other field
      false
- [ ] 6.5 Close issues #12 and #15 with the live evidence; leave #18 to 1.6

## 7. Follow-ups found at apply (2026-09-15)

- [ ] 7.1 Backlog 1.6 updates the About page's differences list when Download and Copy
      link land — the list describes what ships (spec reworded at apply; design "Decided at
      apply"); verify by re-reading `#differences` on the live host after 1.6
- [ ] 7.2 `corpus-bake` 1.5 (`--ship`) calls `bun run scripts/check-example-queries.ts
      <origin>` after the restart — one line in that script; recorded in its tasks.md as a
      follow-up; verify the ship run prints the count
- [x] 7.3 *(fixed c53f64a + cbad523)* the demo image's build stage copies `scripts/` and the
      build context no longer ignores it — `client/test/checkBake.test.ts` (corpus-bake)
      imports `../../scripts/bake-demo`, and the client build runs `tsc --noEmit` over its
      tests, so the box had been unable to build since that test landed; the old container
      kept serving through both failed builds
- [ ] 7.4 The About page could take the `/about` name if the static handler tried
      `<name>.html` before its fallback (design D2 declined it); leave unless it grates

