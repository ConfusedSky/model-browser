## Context

See proposal.md — Why, for the measurements. What the design has to fit around:

- **The URLs already carry the version.** `/api/thumb/image?path=…&mtime=…[&ao=off]&gen=…`
  (`thumbImageUrl`) and `/api/model.glb?path=…&mtime=…` (`fetchModel`'s GLB leg, since
  `client-names-model-version`). The server answers a request naming the current version
  `public, max-age=31536000, immutable` (`thumbHitTiers`, `byteTiers`); anything else is
  `no-cache` or `no-store`. That split is the whole basis of this design: "immutable" is the
  origin vouching for exactly one version's bytes.
- **The zone is proxied, with three cache rules and Smart Tiered Cache** (README §10). The
  upper tier sits beside the origin, so Europe already has a near copy; the rest of the world
  does not.
- **The demo supersedes versions only when the operator ships.** `thumbWrites` is off, the
  corpus is read-only between changes; a bake ship moves every thumbnail's `gen`, and a
  corpus change moves the affected models' `mtime`.
- **The corpus is all STL and carries no archives** (measured on the live listing). The flat
  listing truncates at 500 models, so anything that must enumerate every model walks the 444
  folders.
- **Workers Free**: 100,000 requests a day, then per-route *fail open* ("Bypasses the Worker.
  Requests behave as if no Worker is configured") or fail closed; 10 ms CPU and 128 MB per
  request (developers.cloudflare.com/workers/platform/limits/, read 2026-09-28).

## Goals / Non-Goals

**Goals:**
- A US (and non-European generally) first touch and PoP miss costs an R2 read in the
  visitor's region, not a crossing to Falkenstein.
- Zero application change; removing the routes is a complete rollback.
- The bucket can only ever hold bytes the origin pinned, under the version it pinned them at.

**Non-Goals:**
- Edge-caching the Worker's own answers (the Cache API) — measure first, see D6.
- Pruning retired epochs and versions from the bucket.
- Serving Europe from R2, `/api/file`, archive entries, ranged or conditional reads.
- Making the desktop build aware of any of this.

## Decisions

### D1. The edge maps URLs to keys (shape 1 of the 2026-09-17 plan), unchanged

A Worker on routes for the two byte routes, bound to a private bucket. Alternatives, as
weighed then and still true: the client composing CDN URLs (shape 4: a config key, a
features field, a mount race, a wrong-base hole — every client test that plan listed);
the origin redirecting (a Falkenstein round trip per request, which is the cost being
removed); Origin Rules plus URL Transform rules without a Worker (Free cannot build a key
from query parameters, and nothing could fall back to the origin on a missing object).

### D2. The Worker fills the bucket on a miss — no publisher

On a store miss the Worker forwards the request unchanged, returns the origin's answer to the
visitor, and — in `waitUntil`, off the visitor's path — stores it **only if** the answer is a
200 whose `Cache-Control` contains `immutable` and whose content-type is the one that route
serves (`image/webp`, `application/octet-stream`). Since the origin marks `immutable` only a
request naming the current version, the stored bytes are by construction those of the version
in the key.

The 2026-09-17 plan's publisher (`.ai/todo.md` §5 at `e5ca7e7`) is what this replaces, and
most of its risks go with it: rclone absent on both machines; bake → publish → rsync → restart
ordering against a live box; the model-format allowlist moving from request time to publish
time (risk 2); a public bucket losing `Cross-Origin-Resource-Policy` (risk 3); the
`check-assets.sh` pin. What write-through costs instead is that *someone* pays each object's
first touch per epoch — which is what the backfill (D8) is for.

### D3. Keys

```
<epoch>/t/<path>/<gen>.webp          ao render
<epoch>/t/<path>/<gen>.noao.webp     ao=off render
<epoch>/m/<path>/<mtime>.glb
```

- `<path>` is the decoded `path` parameter, raw bytes, leading `/` kept as the separator
  (NFC as the listing sends it; no re-normalisation, since the origin does none either).
- Versions are canonicalised as `String(Number(v))`: the server compares numerically
  (`public-deployment`), so `1789446597239.1736` and `1789446597239.17360` are one entry. A
  version that is not finite, and a path that does not start with `/`, contains `!`, contains
  NUL, or would make the key longer than 1,024 bytes, is not keyed — the request passes
  through.
- A request carrying any parameter besides the route's own (`path`, `mtime`, `gen`, `ao`)
  passes through. The origin ignores unknown parameters, so two URLs differing only in junk
  would otherwise be one key — harmless for bytes, but strictness is cheaper than reasoning.
- The version is in the key and the key is never overwritten, so a key's bytes are immutable
  like the URL's.

### D4. What a stored answer replays

The Worker stores the body plus an allowlist of the origin's response headers —
`content-type`, `cache-control`, `etag`, `x-content-type-options`,
`cross-origin-resource-policy` — as the object's custom metadata, and a store hit returns
exactly those with status 200. The spec's "same headers" is then a copy, not a second
implementation of `thumbHitTiers`/`byteTiers` that could drift from the server.

Storing is `put` with an `ArrayBuffer` (a clone of the origin's response, read in
`waitUntil`), because a teed `ReadableStream` has no known length. A 32 MB cap skips storing
anything larger; the corpus's largest STL is 21.6 MB, ~5 MB as GLB at the ratio `MeshCache`'s
header states (estimated, not measured on that file). `put` is conditional on the
key not existing (R2 conditionals — to be confirmed live, task 3.3); two concurrent
first touches racing to store identical bytes is benign either way.

### D5. Continent routing: Europe and Africa pass through

`request.cf.continent` of `EU` or `AF` → pass through untouched, no read, no write. Everyone
else reads the store. A bucket hinted `wnam` read from a European PoP would cross the
Atlantic, where today the upper tier beside the box answers from a few milliseconds away —
serving Europe from R2 would be a regression the US measurements cannot see. An absent
`continent` passes through.

`wnam` rather than `enam` is the 2026-09-17 plan's choice and the measurements' vantage
(US Pacific). The hint is best-effort and permanent per bucket name
(developers.cloudflare.com/r2/reference/data-location/). An east-coast or APAC visitor still
gains — `wnam` is nearer to both than Falkenstein — but less.

### D6. No Cache API in front of the store, yet

Every request on the route invokes the Worker whether or not anything caches its answer, so
the Cache API would save only the R2 read, not an invocation. Whether that read is worth
saving is a number the after-probe gives: if a store hit's `ttfb_net` is well above a local
edge HIT's ~0.06 s, adding `caches.default` read-through is additive and changes no spec.

### D7. The epoch is a committed Worker variable

`STORE_EPOCH` in `deploy/edge/wrangler.toml`, a string (the date of the ship that set it).
Advancing it is a commit and a `wrangler deploy`, the last step of README §7's ship and of any
corpus change. Old epochs' objects are unreachable immediately and orphaned; deleting them is
hygiene for a later change (R2 at $0.015/GB-month past 10 GB). **An R2 lifecycle rule on age
is not the prune**: a current version's object is never rewritten, so an age rule would
expire live keys.

### D8. The backfill walks folders through the public hostname

`deploy/edge/backfill.ts` (Bun): list `/` and then each folder with `/api/dir?path=…`, collect
every model's current `mtime` and thumbnail `gen` (with each variant's hit state), and GET each
URL once — the thumbnail for every variant that is a hit, and the GLB. Requests go to the public
hostname so they pass through the Worker, which does the storing; the script never touches R2.
Concurrency 2, and it must run from a non-EU/AF location (from this machine) or D5 makes it a
no-op. It reports counts by the diagnostic header (D9): `filled`, `hit`, `pass`, errors.

It makes the box derive every GLB it has not derived yet — roughly 0.24x the STL bytes of disk
in `mesh/` and CPU on two vCPU — so it runs once per epoch, never on a schedule.

### D9. A diagnostic header

Every answer on the routes carries `x-edge-store: hit | filled | pass`. The probe and the
backfill need to know which path served a request, and the PoP-dependence found on 2026-09-25
means `cf-cache-status` alone cannot say. The spec permits exactly this one difference.

### D10. `deploy/edge/` is its own workspace

`worker.ts` (the fetch handler: the only file that touches Workers APIs), `route.ts` (pure:
classify a request into pass-through or a key; decide whether a response is storable and which
headers it replays), `route.test.ts`, `backfill.ts`, `wrangler.toml`, and a `package.json` so
`bun run test` and `bun run typecheck` cover it. `@cloudflare/workers-types` is a dev
dependency of that workspace only. Wrangler is run pinned through `bunx` (`bunx
wrangler@<version>`), the Prettier pattern — not a dependency.

## Risks / Trade-offs

- [A same-zone `fetch()` from the Worker re-enters the route] → the docs say routes are not
  the target of same-zone fetches; verified live before the routes serve traffic (tasks), and
  a loop would show as the Worker's own subrequest count rather than as a visitor error.
- [A wrong object under a correct key] → only possible if the origin marked the wrong bytes
  `immutable` for a version, i.e. a `gen` reissued after a cache wipe
  (`allocateGen`, risk 8 of the 2026-09-17 plan). Advancing the epoch retires it, and a wiped
  cache is a ship anyway.
- [The window between a ship and the epoch advance] → accepted and specified; the operator
  closes it and it is minutes wide. Order matters: advance *after* the ship, or the new epoch
  fills with versions the ship is about to supersede.
- [Daily request limit] → a cold first screen is ~114 requests, so ~877 cold first screens a
  day before fail-open; repeats are served from the browser's immutable cache and never reach
  the Worker. Past the limit, fail-open is today's behaviour.
- [Worker bug] → removing the routes is the rollback (spec), and every error path passes
  through; `route.ts` carries the logic that can be wrong, and is where the tests are.
- [Continent routing is untestable from here] → every probe vantage is in the US; the EU/AF
  branch is covered by `route.test.ts` only, and its failure mode is a slower answer, not a
  wrong one.
- [Terms] → R2 and Workers fall under Cloudflare's Developer Platform terms, which lack the
  CDN's "large files" clause — per the 2026-09-17 plan, not re-read for this proposal.
- [Proxied permanently] → the 125-second origin timeout (a 524) is already a standing condition
  in README §10; this makes it permanent rather than new.

## Migration Plan

1. Land `deploy/edge/` with its tests. No routes yet: nothing on the live site changes.
2. Operator: create the bucket with the `wnam` hint; give Wrangler a credential on this
   machine (OAuth login or a scoped API token — the operator's choice).
3. Baseline: the latency probe with its new `colo` column, same day as step 5.
4. Deploy the Worker with its routes set fail-open, then check the live matrix before
   anything else: `pass` for no version and for a stale one, `filled` then `hit` for a
   current one, the fallback's `cf-cache-status` unchanged from today, and the headers of a
   `hit` equal to the origin's.
5. Backfill, then the after-probe. **Decision gate**: if cold GLB and cold thumbnail medians
   do not improve by at least the ~0.2 s the upper-tier crossing costs, remove the routes and
   close #39 on the numbers.
6. README §7 gains the epoch step; §10 the Worker, its kill switch and the measurements.

**Rollback**: remove the routes (`wrangler` config, or the dashboard). The bucket can stay; it
is unreachable without them.

## Open Questions

- Whether a store hit is fast enough without the Cache API (D6) — answered by step 5's probe;
  adding it changes no spec and no task above.
- `enam` vs `wnam` if the demo's audience turns out East-coast-heavy — the hint is per bucket
  name, so a second bucket and a variable, not a redesign.
