# model-browser

3D-print model library browser: Bun+Hono server (127.0.0.1:3177) + React/Vite/three.js
client (5173, proxies /api). Spec-driven via OpenSpec — specs in openspec/, workflow via
/opsx:* commands; design rationale in the change's design.md (decisions D1–D10).

## Commands

- `bun run dev` - start server + client together. The server needs a library root:
  `MODEL_BROWSER_ROOT=<dir>` or `root` in `~/.config/model-browser/config.json`, whose path
  `MODEL_BROWSER_CONFIG` overrides; without one every path route answers 503
  `{state:'unconfigured'}`. Restart after editing it (the `launch.json` rule) — but
  "read once at server start" is **not** what the code does today, and this line said it
  was: `configuredRoot` is called from `evaluate`, which `compute` re-runs on every
  `state()` while the library is unsettled, so an *unconfigured* server re-parses the file
  on every request and does pick up a `root` written under it. A settled `ready` library
  never re-reads (one `stat` on the top per request instead). The re-read is a side effect
  of re-asking a filesystem question, not a feature — `public-deployment` (1.2a) makes the
  parse genuinely once and leaves the filesystem question re-asked, at which point this
  line becomes true as originally written. Paths on the wire and in URLs are
  library-relative (`/` is the library top); the server writes
  `<library>/.model-browser/library.json` on first start — but the marker found *above* the
  root wins. The walk now stops at a mount boundary (same `st_dev`), so a stray marker on
  another volume is not adopted; a stray `.model-browser/library.json` in `$HOME` (left by an
  earlier root choice) still captures a root that is **on the same filesystem**, making your
  home directory the library and widening confinement to all of it. Symptom: the app opens on
  your home folders instead of your kits. A root that *encloses* a library is refused
  instead — state `nested`, nothing written — but only within the probe's bounds (4 levels
  down, 2000 directories *visited*, which bounds the `readdir`s, the marker opens and the
  queue alike). A root with fewer than 2000 direct children has every child checked whatever
  order the filesystem listed them in; past that, and at depth ≥ 2 in a tree wide enough to
  fill the queue, what is found depends on listing order — and that order differs between
  runtimes, so a fixture built to be deterministic under vitest (Node sorts `readdir`) can
  answer differently under the server (Bun does not: 600 `kit-<i>` directories put `kit-599`
  at index 555 on Node and index 0 on Bun). A `nested` answer is memoised for 5 s, so
  repointing the root shows up on the next window rather than the next request. The startup
  line `library <id> at <top>` names the top actually resolved — read it
- Semantic search needs a second server, not started by `bun run dev` (its collection root
  must lie inside the library, or the index covers nothing):
  `cd <mini-classify checkout> && .venv/bin/python serve_api.py --cache-dir <cache> --port 8077`
  — the checkout location and which embedding cache holds which collection are
  machine-specific, so they live outside the repo; ask the running server's `/status`
  which cache and root it loaded rather than assuming. It answers `/status` at once with
  `ready:false` and 503s queries for ~16s while SigLIP loads, so a connection refusal
  means not started, not warming — and a server that *stays* `ready:false` with a
  `CacheUnusable` failure was started against a cache with no embeddings, which is a
  wrong `--cache-dir`, not a warming delay
- `bun run test` / `bun run typecheck` - vitest + tsc across workspaces
- Launch config (open-in-slicer): `~/.config/model-browser/launch.json`, path
  overridable via `MODEL_BROWSER_LAUNCH_CONFIG` — argv-array templates for the four
  platform operations; the chooser op has no builtin, so "Open with…" is absent until
  configured (this machine: chooser → the dotfiles rofi `open-with` script). Read once
  at server start — restart after editing. `/api/open` launches GUI apps, so the
  server needs the user session env (a terminal-started `bun run dev` has it)
- `scripts/spec-diff.sh [change | capability change [requirement]]` - diff delta specs
  vs main specs (no args = all active changes; prints `new spec <path>` for new capabilities)
- `openspec validate <name>` takes the change name positionally (`--change` works on
  status/instructions, not validate)

## Workflow

- Parallel Claude sessions implement/archive changes concurrently — re-read files and
  `git status` before planning or editing against earlier reads
- Before writing delta specs, read other active changes' specs/ deltas: two changes
  MODIFYing the same requirement collide at archive — ADD a separate requirement for a
  new concern, and declare hard ordering in tasks.md when changes share files/constants
- Work is committed directly to `main` — no feature branches
- design.md cites specific code (classes, call sites, geometry) — re-check those citations
  against the source when reviewing; plausible-sounding ones have been wrong
- Cite code by **symbol name, never `file.ts:123`** — line numbers rot silently as code is
  inserted above them. All sixteen of open-in-slicer's citations, across ten symbols, were
  wrong within two weeks of the code landing (`LIGHTBOX_PANEL_EXCLUDES` 769→1018), and
  `COPY_FAILED` was re-fixed twice — cited in two files at two different wrong values —
  before the numbers were dropped. A name is what a reader greps for anyway;
  where no symbol encloses the spot, name the nearest one and say which part ("`useThumbnails`'
  load effect", "`listFlat`'s `budget` assignment")
- Search spec/design prose with **whitespace collapsed**, not line-by-line — markdown wraps
  mid-phrase, so `grep` misses what spans a newline. A retracted claim survived two
  correction passes in normative spec text this way, and it hides edits too, not just reads:
  `python3 -c "import re,sys;print(re.sub(r'\s+',' ',open(sys.argv[1]).read()))" FILE | grep …`
- A dev instance is usually already running (check first — not always up; ports 3177/5173,
  EADDRINUSE on a second `bun run dev`) — server (`bun --hot`) and client (Vite HMR) pick
  up edits live
- tasks.md lines that bundle code with a visual-tuning clause ("tune … then freeze") are not
  done when the code lands — leave them open until the pixels are judged
- Archive changes with plain `openspec archive` (it applies delta specs); if the deltas
  were already synced via /opsx:sync, archive with `--skip-specs` or it errors on collisions
- `openspec archive` needs `--yes` non-interactively, and refuses to drop a scenario the
  MODIFIED block does not carry (MODIFIED replaces prose *and* scenarios). Gate every
  archive on a dry run — `T=$(mktemp -d); cp -r openspec $T/; (cd $T && openspec archive
  <change> --yes)` — **one fresh copy per change**: a successful archive mutates the copy,
  so a loop over one copy reports phantom blocks for later changes. Main moves under
  long-lived deltas, so nothing is wrong when they are written. To retire a scenario a
  change invalidates, rewrite its body under the same title — RENAMED/REMOVED exist for
  requirements, never for scenarios. Renaming one at the *requirement* level via REMOVE+ADD
  is refused too: archive rejects a title present in both blocks (`Requirement present in
  both ADDED and REMOVED`), so the hatch only opens under a different name
- **A delta's HTML comments land in the main spec verbatim.** Prose written for the change
  — "this delta", the alternatives weighed, citations to sibling changes — reads as the
  capability's own description once applied, permanently. Write comments a delta needs in
  the delta and check `openspec/specs/<cap>/spec.md` after archiving: keep only what a
  future editor of the *capability* needs, and point at the archived change for the rest
  (`floor-and-count-compose` carried 45 lines of change-scoped argument across)
- A tasks.md line claiming test coverage is not coverage — grep the test file before
  checking it off; `search-options` 5.1 claimed the truncation notice was tested, it was
  not, and the notice contradicted its own requirement through two reviews
- Put a measurement where it can be **re-run**, not where it can be **re-typed** — in the
  source beside what it justifies, with the conditions that produce it (`formatCosine`
  carries its own sweep). A number living only in prose gets copied by hand, and a hand
  keeps digits its probe already dropped: a `round(x, 4)` printout of `-0.0` was relayed
  as "-0.00004" when `-0.0` at four places means anything in (-0.00005, 0) — the value was
  -5.0e-06. Counts from the same sweep were mechanical and all correct; only the retyped
  magnitude was wrong. So re-run a relayed measurement before citing it and say whose run
  it is from — and grep for a bad figure yourself, since "it never spread" is the claim
  the relaying session is least able to check about itself

## Architecture constraints (violating these breaks recorded design decisions)

- Bun-only APIs allowed ONLY in server/src/index.ts — the Hono app must run on Node
  unchanged (Electron seam, D1)
- All client I/O goes through ApiClient (client/src/api/client.ts) — never raw fetch in
  components (D1)
- Exactly one WebGLRenderer app-wide (client/src/three/renderer.ts); the render queue
  suspends while orbit/lightbox is active (D2/D3)
- Mesh LRU eviction must call geometry.dispose() — dropping the reference leaks VRAM (D5)
- Camera state is bounds-relative, never world coords; thumbnails keyed path+mtime,
  camera by path only (D4)
- Thumbnails always capture 512² at aspect 1 (three/renderer.ts); the live view uses its
  host's aspect — a non-square viewer host persists a thumbnail framed unlike what was seen
- Zip entries use virtual paths `foo.zip!/entry`, one level only — nested zips are
  rejected by design (D6)
- Any change that alters thumbnail pixel output (rig lights, materials, tone mapping) must
  bump RIG_VERSION in client/src/three/renderer.ts — never re-declare its value in a test
  mock (spread the real module; a literal silently masks the bump). A new recipe
  *dimension* is a new key, not a bump: adding a variant (`ao-as-recipe-dimension`'s
  `.noao.png` sibling) changes no existing render's pixels, so old entries stay valid
- Scene population goes through `stageModel` (three/renderer.ts) for both thumbnails and
  live sessions — it pivots the model's bounds to the origin and fits the key light found
  by name (KEY_LIGHT); a light added to makeScene without that name is silently never fitted
- Scene teardown (renderThumbnail's finally, ViewerSession.close) disposes every
  DirectionalLight — shadow maps are VRAM; the model is LRU-owned and never disposed there

## Tailwind

- **Never glue a utility to a template-literal `${`.** Tailwind's scanner reads source
  text and takes `object-contain${pending` as one candidate, so the utility never reaches
  the stylesheet and the browser computes the property's default — `object-fit: fill`
  stretched every folder-sheet cell (2026-09-03). Write whole class strings as literals
  and pick between them (`pending ? 'a b c opacity-0' : 'a b c'`); a computed style
  read in the browser (`getComputedStyle(el).objectFit`) is how a missing rule shows
  itself, since vitest's happy-dom applies no Tailwind CSS at all

## Web demo (not yet a change)

- docs/web-demo-notes.md records the 2026-08-28 exploration of a public demo over the
  CC-BY corpus: what is decided, what still needs a call, the defaults a proposal
  would take, and the measurements (CPU index sizing, hosting prices) with where
  each can be re-run. Read it before proposing anything demo-shaped; a proposal
  supersedes it and should say so there

## OS-specific surface

- docs/platform-surface.md catalogs everything OS-specific: the per-OS operations
  (launch/default/associations/chooser), latent POSIX assumptions (paths, XDG dirs,
  session env), and the deferred Electron drag-out. Only Linux is implemented;
  Windows/macOS columns are unverified sketches.
- A change that adds OS-specific behavior — spawning, file-type registries, per-OS
  paths/dirs, display-server dependencies — adds or updates its row there as part of
  the change (e.g. a new launch operation adds a table row; a new `~/.config` file
  extends the user-dirs bullet)

## Testing

- Suite-specific conventions live with the tests: client/test/CLAUDE.md, server/test/CLAUDE.md
- Run vitest from the workspace dir (`cd client && bunx vitest run …`) — from the
  repo root bunx fetches an unpinned vitest that can't resolve workspace deps
- **vitest runs on Node, the server runs on Bun, and their `readdir` order differs** — Node
  sorts what libuv returns, Bun hands back raw directory order. A fixture whose expected
  answer depends on *which* entry is reached first passes green and asserts nothing about
  production: 600 `kit-<i>` directories put `kit-599` at index 555 on Node and index 0 on
  Bun, which is how a probe test claiming "deterministic in every order" survived a review
  round, and how its replacement's own control cell was wrong until it was run under Bun.
  Assert the order-free property (that *some* match is found, that a bound is respected),
  and re-run anything order-sensitive with `bun run <script.ts>` against the real module
- Manual/E2E: Playwright MCP works here including headless WebGL
  - E2E fixture models: there is no dedicated fixture set. The six STLs this line used to
    name (Enforcer, paint-rack, bod_test_cube, fat_cat) lived under
    `.superpowers/sdd/tasks/e2e-models/`, which no longer exists and whose contents were not
    tracked — do not go looking for it. Drive E2E against a leaf directory of the real
    library instead, e.g.
    `~/Documents/tests/test-models/miniatures/original/Locked_Chest_3040102`
    (one STL, `case_meshmixed.stl`). Since `library-root` a model is addressed as a **root
    plus a library path**, never a filesystem path: run with
    `MODEL_BROWSER_ROOT=~/Documents/tests/test-models` and browse
    `/miniatures/original/Locked_Chest_3040102`, or root the library at the kit itself and
    browse `/`. A case the old set covered deliberately — flat-faced
    for acne/AO, large-flat, organic — has to be picked out of the library by hand now
  - Thumbnail cache: `~/.cache/model-browser/<library-id>/<sha256(library path)>.{png,json}`.
    The .json sidecar's `path` is the **library** path (`/Kit/x.stl`), not the filesystem one,
    so map a fixture by its library path — hashing its `/run/media/…` path finds nothing.
    Alongside it: `{mtime, lighting, rig, posed}` — grep those to verify a RIG_VERSION sweep.
    `rm -rf` the id directory (or the whole cache dir) to force re-renders during visual
    tuning
  - Orbit/lightbox E2E persists path-keyed cameras — tile thumbnails later re-render from
    the new angles; that is not a pixel regression. The pointerup also queues a full
    thumbnail re-render (persist), so wait ~5s before frame-time measurements
  - Playwright MCP writes files only under the repo root or `.playwright-mcp/`; and
    `browser_run_code_unsafe` has no require()/import — move bytes via in-page fetch/canvas,
    or serve them over localhost with a CORS header
  - Model tiles respond only to PointerEvents: dispatch pointerdown on the tile, wait
    ~300ms for the overlay to mount its window listeners, then pointerup on window —
    same-tick release is silently missed. Dir/zip tiles take normal clicks.
  - Grant clipboard upfront via `context.grantPermissions(['clipboard-read',
    'clipboard-write'])` — clipboard calls otherwise hang forever on a permission
    prompt in the headed MCP browser
  - Set React-controlled inputs via the native value setter + `input` event; for
    path-bar navigation, focus the input first and press Enter on the input itself
  - The MCP script sandbox has no setTimeout/setImmediate: page.route handlers, delays, and
    locator-click retry loops die with "setTimeout is not defined". Do waits/interception
    inside page.evaluate (in-page timers); a crashed route handler persists across reloads
    and silently hangs every matched request — recover with page.unrouteAll()
  - browser_evaluate runs in an isolated world (own window.* and fetch); run_code_unsafe's
    page.evaluate is the main world — install fetch wrappers/globals there
  - Vite (5173) binds IPv6-only: curl 127.0.0.1:5173 refuses while localhost/[::1]
    works; the API (3177) binds IPv4 127.0.0.1
  - Verify layout claims by measuring (`getBoundingClientRect` via `browser_evaluate`), not
    screenshots — the MCP screenshot file may not land anywhere findable in the repo
  - A probe that mutates the DOM poisons every later measurement in that tab. One left the
    path error `position:absolute`; the next run read the moved geometry as the app's own,
    and "the suggestion list already covered the error" reached a commit message as recorded
    fact when the opposite was true. Restore what you set inside the same `evaluate`, or
    reload before measuring again — and prefer rebuilding the *other* layout in the live DOM
    over trusting a memory of what it measured
  - Generated STL fixtures need outward *winding* (vertex order): parsing ignores stored
    facet normals and recomputes from winding, so a zeroed normal field is fine — but
    inverted winding still mirrors lighting left/right (false bugs in lighting assertions)
