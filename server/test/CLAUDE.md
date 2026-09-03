# server tests

- Hono app.request() MUST pass a loopback `host` header — the same-origin guard 403s
  requests without one
- Zip fixtures: fflate zipSync (see helpers.ts)
- Cache dir and library are **constructor arguments, not env vars** — nothing in the suite
  reads `MODEL_BROWSER_CACHE`. A per-test cache is `new ThumbCache(dir)`, or
  `new ThumbCache(dir, cap, maintainEvery, libraryFor(top))` for a library-backed one; an app
  is `createApp(cache, launcher, zipTemp, libraryFor(dir))`. `libraryFor` (helpers.ts) pins
  `MODEL_BROWSER_ROOT` at the fixture and `HOME`/`XDG_CONFIG_HOME` at a temp dir, so no test
  can fall back to the developer's real `config.json`
- Ad-hoc `bun -e` fixture scripts must run from server/ (fflate is a workspace dep, not a
  root one)
- Any cell that requests `/api/peek` (or a semantic route) probes the index first:
  stub `fetch` (refused = absent = the plain walk) and call `resetIndexStatus()`, or the
  cell silently depends on whether a dev index is up on 8077 — a real 2s-timeout call
  inside a unit suite. `semantic.test.ts`'s `stubIndex` and the overrides peek cell are
  the patterns
- **Since `listing-tree-cache` §6.9 that rule reaches `/api/dir` too**: both branches run
  `fillAnnotations` before annotating, so a browse or flat listing can now issue `/poses`
  and a `/under` + walk per folder tile. Two consequences for a cell that lists anything.
  *One*, stub and `resetIndexStatus()` on `/api/dir` cells as well — an unstubbed one is a
  live call to whatever is on 8077. *Two*, the gate is the **probe memo's last known
  state**, not its age (`memoisedStatus`), so a cell that never probes fills nothing and a
  cell that probes once fills from then on: `resetIndexStatus()` in `beforeEach` is what
  keeps one cell's warm memo out of the next. A stub must answer **every** route the fill
  can reach — `/status`, `/poses`, `/under` — because an unhandled route throws, `askIndex`
  turns that into `resetIndexStatus()`, and the cell then silently stops filling partway
  through (that is how the annotation-TTL cell passed for the wrong reason; task 6.9a).
  `layers.test.ts`'s `stubFillIndex` is the pattern, and it is the one to copy rather than
  the two-route `stubIndex` beside it
- Known once-seen flake (2026-09-01, not yet reproduced): `indexContract.test.ts`'s
  "floors the whole collection first, then caps" hit the 5s vitest timeout against the
  live index during a 6-way parallel stress sweep — 1 occurrence, absent from the 20
  verification runs that followed. If it recurs, suspect live-index latency under
  parallel load before the test's own logic; the suite skips cleanly when :8077 is down

