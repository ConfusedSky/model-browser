## 1. The pure logic, tested

- [ ] 1.1 Create the `deploy/edge/` workspace (`package.json`, `tsconfig.json` with `@cloudflare/workers-types` for `worker.ts` only, root workspace entry) and verify `bun run typecheck` and `bun run test` pick it up with zero tests failing.
- [ ] 1.2 `route.ts`: classify a request — method, URL, `Range`/`If-*` headers, `request.cf.continent` — into pass-through or a key per design D3, with the versions canonicalised as `String(Number(v))`. Verify with `route.test.ts` cells for: a current-version thumbnail (both `ao` variants) and GLB; no version; a non-finite version (`NaN`, empty, `Infinity`); `1789446597239.1736` and `1789446597239.17360` producing one key; a path with `!`, with NUL, without a leading `/`, and one making the key longer than 1,024 bytes; an unknown extra parameter; HEAD and POST; a ranged and a conditional GET; continent `EU`, `AF` and absent → pass-through; the `Ø` and katakana corpus paths and a synthetic NFD name and a path carrying `#`, `?`, `%`, `+` and a space round-tripping into the key's raw bytes.
- [ ] 1.3 `route.ts`: decide whether an origin response is storable (200, `Cache-Control` containing `immutable`, the route's content-type, `Content-Length` at most 32 MB) and which headers it replays (design D4). Verify with cells for each refusal — a 404, a `no-cache` 200, a `no-store` 200, a wrong content-type, an oversized length, a missing length — and that the replayed set is exactly the allowlist, whatever else the origin sent.
- [ ] 1.4 Falsify both files' key cells: restore a text comparison in place of the numeric canonicalisation, and drop the `!` check, and confirm the matching cells go red before restoring (the repo's falsify-the-mutation rule).

## 2. The Worker

- [ ] 2.1 `worker.ts`: pass-through is `fetch(request)` returned unchanged plus `x-edge-store: pass`; a keyed request reads `<STORE_EPOCH>/<key>` and returns the stored body and replayed headers plus `x-edge-store: hit`; a miss returns the origin's answer plus `x-edge-store: filled` when it is storable (and `pass` when not), storing a clone's `ArrayBuffer` in `waitUntil` with the put conditional on the key not existing. Every store call is inside a try that falls back to `fetch(request)`. Verify with `wrangler dev` against a local R2 binding and a stub origin: the three header values, a second request after a `filled` answering `hit`, and a thrown R2 read answering `pass` with the origin's bytes.
- [ ] 2.2 `wrangler.toml`: the bucket binding, `STORE_EPOCH`, and the two routes (`models.masamaeda.com/api/thumb/image*`, `models.masamaeda.com/api/model.glb*`), with the Wrangler version pinned in the README command rather than installed. Verify `bunx wrangler@<pin> deploy --dry-run` succeeds.
- [ ] 2.3 `backfill.ts` per design D8: walk every folder, GET each current thumbnail variant that is a hit and each GLB once at concurrency 2, and print counts by `x-edge-store` and by status. Verify against `bun run dev:demo` locally (no Worker, so every answer reports no header) that it enumerates all models the folders hold — the count must equal the corpus's STL count, not the flat listing's 500.

## 3. Cloudflare, before any route serves traffic

- [ ] 3.1 Operator: create the R2 bucket with the `wnam` location hint, and give Wrangler a credential on this machine. Verify `bunx wrangler@<pin> r2 bucket list` shows it and `wrangler whoami` names the account in README §10.
- [ ] 3.2 Add a `colo` column to `.ai/probe-demo-latency.sh` (from `cf-ray`), appended after the existing columns so earlier runs stay comparable, and verify a 2-sample smoke run fills it.
- [ ] 3.3 Confirm on a throwaway key in the real bucket that a conditional `put` refuses to overwrite an existing key; if R2's conditional form differs from design D4's assumption, switch to head-before-put and record the finding in D4.
- [ ] 3.4 Baseline: run the latency probe (60×60) with `colo`, record library id, folder count and the colo split beside it, and keep the CSV in `.ai/demo-latency/`.

## 4. Turn it on

- [ ] 4.1 Deploy the Worker with both routes set to **fail open** in the dashboard (the setting lives on the route). Verify the dashboard shows fail open on both.
- [ ] 4.2 The live matrix, before anything else: a same-zone `fetch()` does not re-enter the Worker (the fallback's `cf-cache-status` and headers match today's for the same URL); no version and a stale version answer `pass`; a current version answers `filled` then `hit`; a `hit`'s status, bytes (SHA-256) and allowlisted headers equal the origin's direct answer via `--resolve` to the box. Any mismatch removes the routes before continuing.
- [ ] 4.3 Run the backfill from this machine and verify it reports every thumbnail variant and GLB as `filled` or `hit` with zero errors, and that the box's `mesh/` directory now holds one GLB per model.
- [ ] 4.4 After-probe (60×60, same conditions as 3.4) and the decision gate in design's migration plan: keep only if the cold GLB and cold thumbnail medians improve by at least ~0.2 s; otherwise remove the routes. Post both runs and the verdict to #39.

## 5. Runbook and close-out

- [ ] 5.1 README §7: advancing `STORE_EPOCH` is the last step of a bake ship and of any corpus change, after the restart and never before, with the reason. Verify by reading the ship steps top to bottom that the step sits after the restart.
- [ ] 5.2 README §10: the Worker, the bucket, the routes' fail-open setting, the kill switch (remove the routes), the diagnostic header, the backfill command and when to run it, and the measurements. Verify the kill switch by removing and restoring one route and seeing `x-edge-store` disappear and return.
- [ ] 5.3 `docs/web-demo-notes.md`: point at this change as what the CDN exploration became. Verify the note names the change.
- [ ] 5.4 Close #39 with a link to the archived change, or leave it open with the gate's numbers if 4.4 removed the routes.
