# Design — landing-page

## Context

See proposal.md — Why. The contents were decided in `docs/web-demo-notes.md` item 4
(2026-09-03, Limitations added 2026-09-05, the partial-match example 2026-09-07). The
constraints this design works under, each verified against the source on 2026-09-15:

- **No mode name reaches the client** (`feature-report`'s *No mode is named*). The
  report is `FeatureReport` in `shared/types.ts`, built once in `server/src/index.ts`
  as `{ ...DEFAULT_FEATURES, ...config.features }` (`DEFAULT_FEATURES` is in
  `server/src/app.ts`) and read by the client through `ApiClient.features`. `App`
  holds it in `features` state, `null` until known, with a retry on each navigation
  until it resolves. Every gate follows one pattern — `features?.chatTab === true`
  offers, anything else withholds. The config parser's `FEATURE_KEYS` is
  `Object.keys(DEFAULT_FEATURES)`, so a new field is accepted by the strict parse the
  moment it has a default. The demo config sets every field false and the runbook's §5
  check reads "the demo posture: every field false".
- **The client has one route** (`client/src/lib/urlState.ts`: all state in query
  params, `commitUrl` preserves `window.location.pathname`). No router dependency.
  `createStaticHandler` in `server/src/static.ts` serves any file under `client/dist`
  — `/assets/*` immutable, everything else `no-cache` — and answers `index.html` for
  a name matching no file; `route` only composes it with the API. Vite serves whatever
  `.html` files exist under `client/`.
- **`App`'s tree** is `<div className="flex h-screen flex-col">` → `<header>` → a row
  `<div className="flex min-h-0 flex-1">` holding `<main ref={mainRef} … overflow-auto>`
  and the side panel as siblings. `View.subject` is a discriminated union whose empty
  case is `{ kind: 'none' }`. `navigate` commits `prefs: ownPrefs()`, and `ownPrefs`
  reads `searchMode()` — the module closure in `searchOptions.ts`, not the view — so
  a mode that is not in that closure is lost on the first folder click.
- **A search is submitted by the reducer**: `submitSearch` in `App` calls
  `commit({ type: 'submit' })`, whose case in `client/src/state/reducer.ts` reads
  `drafts.queryText` and calls `askCommitted`; the mode comes from `View.mode`, set
  by `setMode` in `App` which calls `setSearchMode` (persisting under
  `model-browser:search-mode`) and dispatches `{ type: 'setMode' }`. The stored mode
  is read once into a module closure in `client/src/lib/searchOptions.ts`
  (`modeStore.read()` → `mode`), default `'name'`. `corpusOf` in
  `client/src/state/view.ts` decides `'meaning' | 'name' | 'defer' | 'wait'` from
  `state.index`; `SidePanel`'s `meaningRunnable` is
  `index.state === 'ready' && indexCovers(index, path)`.
- **Credits** reach the client per entry only: `GET /api/overrides?path=` →
  `resolveOverrides(store, libPath)` in `server/src/overrides.ts`; the store is an
  in-memory `OverrideStore` (`ReadonlyMap<string, OverrideEntry>`) behind
  `OverrideHolder.store()`, which exposes nothing else. `ViewerLayer` draws the block
  — `renderableCredits`, the `data-credit` rows, `hostLabel` for a link's text,
  `CREDIT_LINK_CLASS`.
- **Browser storage** goes through `stored<T>(key, parse, serialize)` in
  `client/src/lib/stored.ts` (never throws); preference keys use the
  `model-browser:` prefix. `client/test/CLAUDE.md` warns that a value read into a
  module closure is not reset by `localStorage.clear()` between cells.
- **The bake** (`corpus-bake`): `scripts/bake-demo.ts` has landed (35a3b77); its
  `--ship` step (that change's task 1.5) has not, and will be the one place that fires
  HTTP at the public origin after a restart. Its on-box check `deploy/demo/check-bake.sh`
  is POSIX-only and offline by contract, so no query test can live there. The box has
  no Bun outside the container: anything written in TypeScript runs from the developer
  machine.
- **A chip's search carries the profile's tuning**: `HttpApiClient.semanticSearch`
  sends `{ text, path, ...tuning }`, and the defaults are `TUNING_DEFAULTS` in
  `searchOptions.ts` (`minScore: 0.1`, `top: 60`, softmax pooling), which the route
  passes to the index. A query posted without them is judged under the index's own
  looser floor.
- **`ViewerLayer.tsx` value-imports the renderer** (`getRenderer`, `ViewerSession`,
  `MeshLru`), so any module that imports from it drags three.js along. `hostLabel` is
  exported from it; `CREDIT_LINK_CLASS` and `renderableCredits` are module-local.
  The loader in `server/src/overrides.ts` builds `entry.credits` field by field and
  can leave it `{}` when every field is wrong-typed.
- **`JobChip`** already means the bulk-job status chip in this repo. The banner's
  items are "example queries" in code (`EXAMPLE_QUERIES`, `ExampleQuery`), "chips"
  only in prose.

## Goals / Non-Goals

**Goals:**
- Everything the notes decided, drawn only where a deployment declares it, with the
  desktop build byte-identical to today.
- One source of truth for the example queries, read by the banner, the placeholder and
  the proof.
- The About page as a document: static copy, one dynamic section (credits), no reducer
  or history involvement.

**Non-Goals:**
- Open Graph tags, the phone pass, lightbox prev/next (#9–#11): separate issues.
- The licence line at the Download action (#18) and Download itself: backlog 1.6.
- A curated collection (#12's second option): the surprise action covers the issue's
  ask with no corpus curation; a collection can be a later change if a random chip is
  not enough.
- Crediting the publishers of deduplicated copies (`duplicate_of`): the store has no
  such field; noted on issue #1 at close.
- Making meaning search the default anywhere the introduction is not offered.

## Decisions

### D1: A new report field, `intro`, default off — not a proxy on other fields

The banner could be gated on `hostDetails: false` or `thumbWrites: false`, which the
demo sets. That is inferring a deployment kind from unrelated capabilities, which
`feature-report` forbids in words (*names a surface … never a deployment kind*). So
`FeatureReport.intro: boolean`, default `false` in `DEFAULT_FEATURES`, `true` in
`deploy/demo/config.json`. It has no route to refuse — like `chatTab`, it is an offer
the client draws or withholds. Every gate reads `features?.intro === true`; a `null`
report withholds, matching *No flash of a denied surface*.

Consequences that must land together: `server/test/features.test.ts` and
`refusals.test.ts` spell the report out and gain the field; `config.test.ts`'s demo
configuration cell expects `intro: true`; `client/test/appHarness.tsx`'s `DEFAULT_REPORT`
gains `intro: false` (spelt out on purpose — do not import the server constant); the
runbook's "every field false" line becomes "every field false but `intro`".

### D2: The About page is a second Vite entry, `client/about.html`, not a view of the app

Alternatives: (a) an in-app overlay opened by a URL param, participating in history as
the lightbox does; (b) a pathname `/about` read by the app. Both put a document through
the reducer, the focus trap and `commitUrl` (which preserves the pathname, so (b) would
write `/about?path=…` after the first navigation away). A second HTML entry is what
Vite's multi-page build exists for: `build.rollupOptions.input = { main: 'index.html',
about: 'about.html' }` in `client/vite.config.ts` — Vite keeps the file's resolved name
for the HTML asset, so `dist/about.html` appears beside `dist/index.html` and the static
handler serves it at `/about.html` with no change ([Vite: Building for
Production](https://vite.dev/guide/build)). Vite dev serves `/about.html` from the
source tree. The entry `client/src/about.tsx` renders `AboutPage` into its own root,
imports `index.css` for the same Tailwind layers, and constructs its own
`HttpApiClient` for the one dynamic section (D1 of the app: no raw fetch). The way back
is a plain `<a href="/">`. The page is not gated: it is a file in the bundle, reachable
by typing its name on any deployment, and nothing on a desktop build links to it —
accepted, and stated in the proposal's Impact.

The URL is `/about.html`, not `/about`: an extensionless name would need the static
handler to try `<name>.html` before its fallback, a `public-deployment` requirement
change this courtesy does not justify. If it grates, that is a one-line follow-up.

### D3: The banner lives in `App`, under `<header>`, outside `<main>`

`<main>` holds `noticeBar`, `FindBar` and `Grid`. Inside it the banner would scroll
with the grid and — because the skeleton branch renders `noticeBar('', '')` to keep
the grid's height constant — would have to be rendered in both branches or make tiles
jump. So `<IntroBanner>` mounts between `<header>` and the row that holds `<main>`
and the side panel, which means it spans the panel too — a full-width strip under the
header, which is the shape wanted. It renders when
`features?.intro === true && !dismissed && atTop`, where `atTop` is the committed view
being `/` with `subject.kind === 'none'` and `flat === false` (the top's shortest URL,
`url-navigation`). It takes what it needs as props: the example queries, an `onRun(text)`,
`meaningRunnable`, `onDismiss`, and the links. Header affordances after dismissal: an
`About` link and, when `meaningRunnable`, a `Surprise me` button at the right end of
the header's flex row — the header is the one chrome that never scrolls, and the
bottom-left pill is for view options.

`meaningRunnable` is computed in `App` from `state.index` exactly as `SidePanel`
computes it (`index.state === 'ready' && indexCovers(index, '/')`) — lifted into
`client/src/state/selectors.ts` as `meaningRunnableAt(index, path)` so the two cannot
drift; `SidePanel` switches to it in the same commit.

### D4: A chip is one reducer transition, `{ type: 'runQuery', text, mode: 'meaning' }`

`'submit'` reads the draft out of state, so "set the draft, then submit" is two
dispatches across a render, which needs a pending ref and an effect. A new action does
the draft write and the commit in one transition: the case sets `drafts.queryText`,
sets `mode` as `'setMode'` does, and then runs the `'submit'` body. `App` wraps it as
`runQuery(text)`: it calls `setSearchMode('meaning')` first (the same persistence the
mode radio performs — a chip is the visitor choosing meaning mode), then
`commit({ type: 'runQuery', … })` so the URL-intent and scroll-placement bookkeeping
in `commit` apply as for any submit. The surprise action is `runQuery(pick())` with
`pick` a uniform choice over `EXAMPLE_QUERIES`; in tests the choice is injected so the
cell asserts on one query.

### D5: The starting mode is applied once, in memory, when the report and the index both allow it

`searchOptions.ts` gains two functions: `hasStoredSearchMode(): boolean`, which reads
the raw key inside the same never-throw guard `stored` uses (blocked storage answers
`false`), and `applySessionSearchMode(next)`, which sets the module closure `mode`
**without** writing `modeStore` — because `ownPrefs()` reads that closure on every
`navigate`, a mode set only in the view would revert on the first folder click.

The rule fires once per page, on the first render in which all of these hold: the
report is known with `intro: true`; `meaningRunnableAt(state.index, '/')` (the
`semantic-search` rule that meaning mode is not selectable while the index cannot
answer applies to a start as much as to a radio); no mode is stored; the boot URL
carried no `mode` (captured at mount from `parseUrl()`); and
`liveView(state).subject.kind === 'none'` — a report that resolves after the visitor
already committed a name search must not re-run it, which `'setMode'` would do. It
calls `applySessionSearchMode('meaning')` and dispatches
`{ type: 'setMode', mode: 'meaning' }`; with nothing committed that is a fetchless
patch. `model-browser:search-mode` stays unset, so a browser that never chose keeps
following the deployment; a later radio click stores as today. This is the one
behaviour the field moves besides drawing surfaces, and it moves only on a known
report declaring the field on — *Not knowing does not move a behavior* permits it,
and the byte-identity sentence of the same requirement is modified by this change to
scope it to fields that gate a pre-existing surface (the delta explains why `intro`
is the first field whose on state adds one).

### D6: The placeholder cycles inside `App`, from one hook

`useCyclingPlaceholder(items, active, periodMs)` in `client/src/hooks/` returns the
current item or `null`; active is `features?.intro === true && !bannerDrawn &&
state.view.mode === 'meaning' && meaningRunnable && state.drafts.queryText === ''`.
Period 4 s, `setInterval` cleared on inactivity. The input's `placeholder` becomes
`example ?? 'Search names and folders…'`; `aria-label` is untouched, which is also what
`client/test/appHarness.tsx`'s `searchInput()` selects by. A visible placeholder that
changes is not announced by screen readers, which is the accessible outcome wanted.

### D7: Dismissal is a `stored` flag read in component state

`introDismissedStore = stored<boolean>('model-browser:intro-dismissed', raw => raw
=== '1', v => v ? '1' : '0')` in `client/src/lib/intro.ts`; `App` reads it with
`useState(() => introDismissedStore.read())` (the `SidePanel` `collapsed` pattern), so
`localStorage.clear()` between test cells actually resets it. Dismissing writes `'1'`
and sets state; a failed write leaves state set, so the banner is gone for the page's
lifetime and back next load, as the spec says.

### D8: One credits route, `GET /api/credits`, answering the store's own keys

`listCredits(store: OverrideStore): CreditedKit[]` in `server/src/overrides.ts` walks
the map in insertion order and keeps every entry whose own `credits` would draw in the
lightbox, answering `{ path, name?, credits }`. No resolution: a kit's own stored
credits are what the generator wrote, and inheriting keys are not kits. "Would draw"
is the lightbox's rule — at least one of author, licence, source URL or modification
phrase — so `renderableCredits` moves from `ViewerLayer` to `shared/credits.ts`, where
the server's filter and the client's rows both import it and cannot disagree
(a loader-produced `{}` is skipped by both). Route: `app.get('/api/credits')` beside
`/api/overrides`, same not-ready envelope, no path parameter, no capability gate (the
store is library data, like `/api/overrides`; the `intro` field has no route by D1).
`ApiClient.credits()` and the `LocalFramingClient` pass-through.

`AboutPage`'s `CreditsList` renders each line with the same link rules as
`ViewerLayer`'s rows. It must not import from `ViewerLayer`, which value-imports the
renderer and would pull three.js into the About bundle: `hostLabel` and
`CREDIT_LINK_CLASS` move to a dependency-free `client/src/lib/credits.ts`, and
`ViewerLayer` imports them from there. The answer's size is not measured yet — the
shipped store is 209,225 bytes for 444 keys (`credits-completion` 4.3), so the listed
answer is of that order; measure it with
`curl -s https://models.masamaeda.com/api/credits | wc -c` once the route is live
and record the figure beside the route. Acceptable for a page a reader opens on
purpose; paginate if the corpus reaches thousands.

### D9: The example queries are a shared module, proven by a script, not a test

`shared/exampleQueries.ts` exports `EXAMPLE_QUERIES: readonly string[]` — five to seven
phrases, decided at apply by running candidates against the live index and keeping
ones whose top results are unmistakably right (the first impression). A vitest cell in
`client/test` asserts each is non-empty, unique and under `SEARCH_TEXT_MAX`.
`scripts/check-example-queries.ts <origin>` POSTs each to `<origin>/api/semantic` with
`{ text, ...TUNING_DEFAULTS }` — the body a chip's search sends (no path: the chips run
at the top), under the floor and count the visitor's grid is drawn with, since a query
that clears the index's own floor but not `minScore: 0.1` would pass the check and
show an empty grid — and exits 1 naming each query whose `entries` is empty (or whose
request failed), else prints `N example queries answer on <origin>`. Bun, Node APIs
only (`fetch`), imports the queries and the defaults so neither can be restated
(`TUNING_DEFAULTS` is importable from a script: `stored().read()` swallows the missing
`localStorage`). It runs **from the developer machine** against the public origin —
the box has no Bun outside the container, and the guard admits an `Origin`-less POST
with the right `Host` — as a step of the runbook (§5, after the feature and library
checks, labelled as run from the workstation) and of `corpus-bake`'s `--ship` step:
that change adds the one call when its 1.5 lands — a soft ordering, either may
archive first, recorded in both tasks files. Until then the proof is a runbook step
a human runs, which is what the notes' "or the bake fails" becomes for now.

### D10: The About copy is written at apply against named sources, not drafted here

Every factual sentence on the page has a source it is checked against when written:
the corpus alterations against the corpus repository's `NOTES.md` and `convert.py`
(quadric decimation since 2026-09-15; vertex clustering before it — the page describes
what ships), the desktop-differences list against `deploy/demo/config.json` and the
`public-deployment` spec, the how-to against `App`'s keydown effect and
`nativeMenuRequested` in `client/src/lib/gesture.ts`, the posing blurb against
mini-classify's write-ups as item 4 summarises them, and each Limitations example and
each example query against the live index on the day. The page carries no number that
would have to be re-run to be true (no accuracy figure, no corpus count — the credits
list's length is the one count, and it is computed).

**Decided at apply (2026-09-15), on the About-page worker's check-in:** the pinned
differences list named "Download in place of opening in an application" and "Copy link
in place of Copy path", but neither exists — both are backlog 1.6's, unbuilt
(`grep -rnai download client/src server/src shared` matches nothing; the only label is
`entryActions.ts`'s `Copy path`). A visitor opening a tile menu would falsify both
lines at once. The page therefore describes what ships: opening in an application is
not offered; a copied path is a library path. The `visitor-intro` requirement was
reworded to say the list describes the deployment as it behaves, never as a promise,
and 1.6 owns updating this copy when its actions land (a follow-up line in tasks.md).
Two more findings from the same pass: the corpus repository
(`ConfusedSky/model-browser-corpus`) is private, so the page names it and does not
link it; and "a bicycle" returned **zero** results under the visitor's `minScore: 0.1`,
so the notes' claim that meaning search "always answers" holds only at the index's own
floor — the Limitations copy says what comes back is whatever was least far, and does
not claim there is never an empty answer. The fragment link `#credits` needed one
mount effect: the browser resolves the fragment before React has rendered a section,
so `AboutPage` scrolls to the named section itself after mount (found on 5173).

## Risks / Trade-offs

- [The report arrives after first paint, so the banner appears a frame or two late]
  → It is withheld, never withdrawn; the grid does not move because the banner sits
  outside `<main>`. Accepted, matches every gated surface today.
- [A visitor's meaning-mode start makes name search one radio away] → the mode is
  visible without opening the panel (`semantic-search`), and a stored choice is never
  overridden. The start waits for the index to be ready, so it never opens on the
  "cannot run" state.
- [The report resolves after the visitor committed a search] → the start rule requires
  nothing committed (D5), so a late report moves nothing; a cell asserts it.
- [The example queries go stale as the corpus changes] → the check runs on every
  redeploy and the bake's ship step; a failing check names the query to replace.
- [`/about.html` is reachable on the desktop build] → nothing links to it there;
  its copy names the demo explicitly. Accepted (D2).
- [The credits answer grows with the corpus] → 444 kits today; if the corpus
  reaches thousands, paginate then. Not now.
- [`corpus-bake` and this change both touch `deploy/demo/README.md` §5] → different
  lines (its §5 rewrite is thumbnail checks; this adds one command). Re-read before
  editing; no spec collision, `deployment-infrastructure` gets no delta here.
- [Tailwind: the banner's class strings] → whole literals, never glued to `${`
  (CLAUDE.md, 2026-09-03).

## Migration Plan

1. Land server + shared + client together (one field, one route, the banner, the
   page, the script); `bun run test` and `typecheck` green.
2. `deploy/demo/config.json` gains `"intro": true` in the same commit.
3. Redeploy per the runbook (`git pull && … up -d --build`; with `corpus-bake`
   landed, its check gates the pull as it specifies). Run
   `bun run scripts/check-example-queries.ts https://models.masamaeda.com`.
4. Verify on the live host: banner at `/`, none at a folder URL, chips run, dismiss
   holds across reload, `/about.html#credits` lists the kits.
5. Rollback: revert the commit and redeploy; the stored dismissal flag is harmless
   to a client that never reads it.

## Open Questions

- Whether the surprise action should also live on the banner's row as the last chip or
  only as a button beside the dismiss affordance — a layout call for apply, judged on
  the pixels; the spec requires it on the banner and in the header, not where.
- Copy for the one sentence. Candidates are tried at apply; the requirement is that
  it says what this is and does not promise search when the chips are withheld.
