# server tests

- Hono app.request() MUST pass a loopback `host` header — the same-origin guard 403s
  requests without one
- Zip fixtures: fflate zipSync (see helpers.ts); cache dir per-test via the
  MODEL_BROWSER_CACHE env var
- Ad-hoc `bun -e` fixture scripts must run from server/ (fflate is a workspace dep, not a
  root one)
