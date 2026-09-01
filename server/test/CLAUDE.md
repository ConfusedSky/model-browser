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

