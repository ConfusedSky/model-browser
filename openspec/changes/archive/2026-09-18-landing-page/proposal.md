# Proposal — landing-page

> Backlog 1.5, contents decided 2026-09-03 and 2026-09-05 (Masa; `docs/web-demo-notes.md`
> item 4, which this change supersedes). Folds in issues
> [#12](https://github.com/ConfusedSky/model-browser/issues/12) (an entry point that
> needs no typing) and [#15](https://github.com/ConfusedSky/model-browser/issues/15)
> (example queries after the banner is gone), and gives backlog 1.8's credits list a
> place to live.

## Why

The demo at https://models.masamaeda.com opens on a bare grid of kit tiles. A visitor
who did not come from the repository has no sentence saying what this is, no query to
try, no idea that the search box understands meaning rather than names, and no way to
find the licence, the corpus's provenance or the source. The lightbox credits every
model, but nothing says so. Item 4 of the notes settled every content question a
landing page raises; what remains is to build it.

## What Changes

- **A slim banner over the grid at the library's top** — one sentence on what this is,
  example-query chips that run a meaning search on click, and three links: About,
  credits, source. It is drawn only where a deployment declares that it offers the
  introduction, and it is dismissed once per browser; About stays reachable from the
  header afterwards. The chips are withheld while meaning search cannot run.
- **A "surprise me" action** (#12) that runs one of the example queries at random — on
  the banner, and beside About in the header after dismissal.
- **Example queries in the search box** (#15): after the banner is dismissed, the search
  input's placeholder cycles through the example queries while meaning mode is in force
  and the index can answer.
- **Meaning mode is the demo's starting mode**: where the introduction is offered, a
  browser that has not chosen a search mode starts in meaning mode, so a typed example
  finds what it names. A stored choice is never overridden.
- **An About page** as a second document of the built client: licence and provenance,
  how the corpus was altered, what differs from the desktop app, a five-line how-to,
  links, privacy, a WebGL note, a technical section with posing, a Limitations section
  of verified examples, and a **credits list** of every kit generated from the override
  store (backlog 1.8's courtesy). No accuracy figure, no host location.
- **A new feature-report field, `intro`**, default off, stated in
  `deploy/demo/config.json`. It names a surface the deployment offers, never a
  deployment kind. Set on when this landed and **off again since `beaef45`**
  (2026-09-15): the introduction reached the public host unreviewed, and stays withheld
  until it has been read there (design D2, tasks 6.6). The About document follows the
  field — 404 where it is off — so the field has one route to refuse after all.
- **The store's credits become listable**: one route answers every kit's display name and
  credits, so the About page's list is drawn from the same data the lightbox shows.
- **Example queries are proven against the deployed index**: a script runs each one
  against a named origin, under the options a visitor's click runs with, and fails on
  any that returns no hit. It is a post-deploy step of the runbook, run from the
  developer machine, and is to become a call in the bake's ship step — `corpus-bake`'s
  1.5 has since landed (`4e037db`) without it, so that call is one unwritten line in
  `scripts/bake-demo.ts` rather than a pending dependency; until it is written the
  notes' "or the bake fails" is a step a human runs. The example queries
  live in one shared module the banner, the placeholder and the script import.

## Capabilities

### New Capabilities
- `visitor-intro`: the introduction a public deployment offers — the banner, its
  example queries and where they run, the surprise action, the per-browser dismissal
  and the persistent About link, the placeholder examples, the starting search mode,
  the About page's contents, and the proof that every example query returns a hit on
  the deployment it ships to.

### Modified Capabilities
- `feature-report`: MODIFIED *The client resolves the report once and shapes surfaces
  by it* — its byte-identity sentence ("every capability on renders identically to no
  report") is scoped to fields that gate a surface the client had before the report,
  since `intro` is the first field whose on state adds one; every scenario carried,
  one body reworded under its title. ADDED *A deployment may offer a visitor
  introduction* — the `intro` field, its default off, the client withholding the
  surfaces unless a known report declares it on, and the one thing the server itself
  withholds on it: the introduction's own document, the About page, refused where the
  field is off (`beaef45`; the requirement first said the field had no route to refuse). No active
  change carries a `feature-report` delta.
- `library-overrides`: ADDED *The store's credits are listable* — one answer carrying
  every kit that resolves credits, by library path, with its display name. ADD-only; no
  active change carries a `library-overrides` delta.

No delta to `public-deployment` (the config key is accepted by the strict parse from the
defaults' key set; the demo configuration test gains a field, which is implementation),
to `deployment-infrastructure` (the runbook's post-deploy check is a docs edit;
`corpus-bake` owns that capability's active ADDED block and this change stays out of it)
or to `semantic-search` (a chip submits exactly what the input submits; the mode rule
is stated on the new capability and cites the existing one).

## Impact

- `shared/types.ts` — `FeatureReport.intro`; the listed-credits answer type.
  `shared/exampleQueries.ts` (new) — the example queries, imported by client and script.
  `shared/credits.ts` (new) — the "would draw" rule, moved out of the viewer so the
  server's list and the lightbox agree.
- `server/src/app.ts` — `DEFAULT_FEATURES.intro: false`; `GET /api/credits`.
  `server/src/overrides.ts` — the store listing. `server/test/features.test.ts`,
  `refusals.test.ts`, `config.test.ts` (the demo configuration's expected report),
  `overrides.test.ts`, a new test for the check script's core.
- `client/src/App.tsx` — the banner mount under the header, the header's About and
  surprise affordances, the placeholder, the starting-mode rule, a reducer action that
  sets the draft and commits in one transition (`client/src/state/reducer.ts`).
  `client/src/state/selectors.ts` — the meaning-runnable rule lifted out of
  `client/src/components/SidePanel.tsx`. `client/src/lib/searchOptions.ts` — a
  stored-choice query and a session-only mode setter. `client/src/lib/intro.ts`,
  `client/src/lib/credits.ts`, `client/src/hooks/useCyclingPlaceholder.ts`,
  `client/src/components/IntroBanner.tsx` (new). `client/src/viewer/ViewerLayer.tsx` —
  imports its credit helpers from the two new modules. `client/about.html`,
  `client/src/about.tsx`, `client/src/components/AboutPage.tsx` (new; a second Vite
  entry in `client/vite.config.ts`). `client/src/api/client.ts` and
  `client/src/api/localFramings.ts` — `credits()`. `client/test/appHarness.tsx`'s
  spelt-out `DEFAULT_REPORT` and new cells.
- `scripts/check-example-queries.ts` (new). `deploy/demo/config.json` gains `"intro"`
  — `true` at apply, `false` since `beaef45`; `deploy/demo/README.md` §5's feature line
  and post-deploy checks (its "every field false but `intro`" is stale while the key is
  off — tasks 2.3, 6.6). `server/src/static.ts` and `server/src/index.ts` — the About
  document gated on the field (`beaef45`).
- `docs/web-demo-notes.md` item 4 marked superseded by this change; the backlog's 1.5
  and 1.8 lines closed at archive; `corpus-bake`'s tasks gain the one-line ship-step
  follow-up. Issues #12 and #15 are satisfied when this lands; #18 (licence at the
  Download action) stays with 1.6.
- Nothing changes for a deployment that does not declare `intro`: the desktop build
  renders as before, and the About document, though present in the bundle, is not
  served there at all — 404 since `beaef45`, where this line used to say it existed but
  nothing linked to it.
