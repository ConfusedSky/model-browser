## Context

See proposal.md — Why, for the measurements. What the design has to fit around:

- **The URLs already carry the version.** `/api/thumb/image?path=…&mtime=…[&ao=off]&gen=…`
  (`thumbImageUrl`) and `/api/model.glb?path=…&mtime=…` (`fetchModel`'s GLB leg, since
  `client-names-model-version`). The server answers a request naming the current version
  `public, max-age=31536000, immutable` and anything else `no-cache` or `no-store`. The two
  routes identify a version differently, and the store must copy each exactly:
  `thumbHitTiers` compares `gen` **as text** (`named === String(gen)`); `byteTiers` compares
  `mtime` **as a number**. "Immutable" is the origin vouching for exactly one version's bytes.
- **The thumbnail route is keyed by more than `gen`.** `thumbKeyOf` reads `path`, `mtime`
  and `ao` (`on`, `off` or absent); `cache.image` finds no render when the stored `mtime`
  does not match. `canonicalLibPath` normalises the path (`posix.normalize`, trailing `/`
  dropped) before either route uses it.
- **The zone is proxied, with three cache rules and Smart Tiered Cache** (README §10). The
  upper tier sits beside the origin, in Europe; a US visitor's miss crosses the Atlantic. Workers run before the cache, so a route puts *every* request on its paths
  through the Worker — edge-warm ones included.
- **The demo supersedes versions only when the operator ships.** `thumbWrites` is off and
  the corpus is read-only between changes; a bake ship moves every thumbnail's `gen`, a
  corpus change moves the affected models' `mtime`.
- **The corpus is all STL and carries no archives** (measured on the live listing). The flat
  listing truncates at 500 models, so anything that must enumerate every model walks the 444
  folders.
- **Workers Free**: 100,000 requests a day, then per-route *fail open* ("Bypasses the Worker.
  Requests behave as if no Worker is configured") or fail closed, set on the route; 10 ms CPU
  and 128 MB per request; `waitUntil` up to 30 s
  (developers.cloudflare.com/workers/platform/limits/, read 2026-09-28). Fetch subrequests go
  through the zone's cache and Tiered Cache; the Cache API does not use Tiered Cache.

## Goals / Non-Goals

**Goals:**
- A North American first touch or PoP miss costs an R2 read in the visitor's region, not a
  crossing to Falkenstein — without making today's warm answers slower.
- Zero application change; removing the routes is a complete rollback.
- The bucket can only ever hold bytes the origin pinned, under the version it pinned them at.

**Non-Goals:**
- Edge-caching the Worker's own answers (the Cache API) — measure first, see D6.
- Pruning retired epochs and versions from the bucket.
- Any continent but North America, `/api/file`, archive entries, ranged or
  conditional reads.
- Making the desktop build aware of any of this.

## Decisions

### D1. The edge maps URLs to keys (shape 1 of the 2026-09-17 plan), unchanged

A Worker on routes for the two byte routes, bound to a private bucket. Alternatives, as
weighed then and still true: the client composing CDN URLs (shape 4: a config key, a
features field, a mount race, a wrong-base hole — every client test that plan listed);
the origin redirecting (a Falkenstein round trip per request, which is the cost being
removed); Origin Rules plus URL Transform rules without a Worker (Free cannot build a key
from query parameters, and nothing could fall back to the origin on a missing object).
Route matching considers the whole URL including the query string, so the routes' trailing
`*` is load-bearing.

### D2. The Worker fills the bucket on a miss — no publisher

On a store miss the Worker forwards the request unchanged, returns the origin's answer to the
visitor, and — in `waitUntil`, off the visitor's path — stores it **only if** the answer is a
200 whose `Cache-Control` contains `immutable`, whose content-type is the one that route
serves (`image/webp`, `application/octet-stream`), and whose `Content-Length` is present and
at most 32 MB. Since the origin marks `immutable` only a request naming the current version,
the stored bytes are those of the version in the key — with the exceptions under Risks, which
are the origin's own hazards and which the store inherits rather than causes.

The 2026-09-17 plan's publisher (`.ai/todo.md` §5 at `e5ca7e7`) is what this replaces, and
most of its risks go with it: rclone absent on both machines; bake → publish → rsync → restart
ordering against a live box; the model-format allowlist moving from request time to publish
time (its risk 2); a public bucket losing `Cross-Origin-Resource-Policy` (its risk 3); the
`check-assets.sh` pin. What write-through costs instead is that *someone* pays each object's
first touch per epoch — which is what the backfill (D8) is for.

### D3. Keys, and what is keyed at all

```
<THUMB_EPOCH>/t/<path>/<mtime>/<gen>.webp          ao render (ao absent or on)
<THUMB_EPOCH>/t/<path>/<mtime>/<gen>.noao.webp     ao=off
<MESH_EPOCH>/m/<path>/<mtime>.glb
```

A request is keyed only if all of these hold; otherwise it passes through:

- **Parameters**: exactly the route's own (`path`, `mtime`, `gen`, `ao` for thumbnails;
  `path`, `mtime` for meshes), each at most once. The origin reads the first of a repeated
  parameter and ignores unknown ones, so strictness here costs nothing and removes two ways
  for two different requests to meet at one key.
- **`gen`**: required, `^[0-9]+$` exactly, and kept verbatim — the origin compares it as
  text, so `1789519399619.0` is a different (unpinned) request at the origin and must be one
  here too.
- **`mtime`**: required, finite as a number, canonicalised to `String(Number(v))` — the mesh
  route compares numerically, so every spelling of one value is one key. On the thumbnail
  route it is part of the key because `cache.image` answers per `mtime`: a request naming the
  current `gen` with a stale `mtime` is a 404 at the origin, and must not be a 200 here.
- **`ao`**: absent or `on` → the ao key; `off` → the `.noao` key; anything else passes through
  (the origin answers it 400).
- **`path`**: starts with `/`, already in the form `canonicalLibPath` would produce (no `//`,
  no `.` or `..` segment, no trailing `/` except the root), no `!`, no NUL, and short enough
  that the key stays within R2's 1,024 bytes. It is kept as raw bytes with **no Unicode
  normalisation**, since the origin does none. A non-canonical spelling passes through rather
  than being normalised here, so the Worker never re-implements the server's path rules.
- **Percent-encoding**: the query string must decode (`decodeURIComponent`, `+` as a space)
  or the request passes through. `URLSearchParams` replaces an undecodable `%XX` run with
  U+FFFD while the origin's decoder keeps it raw, so `/%FF.stl` and `/%EF%BF%BD.stl` would
  otherwise be one key for two origin files. A genuine U+FFFD name, sent encoded, is keyed.

The version is in the key and the key is never overwritten, so a key's bytes are immutable
like the URL's.

### D4. What a stored answer replays

The Worker stores the body with the origin's `content-type` and `cache-control` as the
object's R2 HTTP metadata, and `etag`, `x-content-type-options` and
`cross-origin-resource-policy` as custom metadata. A store hit answers 200 with
`writeHttpMetadata`'s headers, the three custom ones, and `content-length` from the object's
size — an R2 stream carries no length of its own, and the latency probe's `glb_ok` rejects an
answer whose byte count it cannot check. The spec's "same headers" is then a copy of the
origin's answer, not a second implementation of `thumbHitTiers`/`byteTiers` that could drift
from the server.

Storing is `put` with an `ArrayBuffer` (a clone of the origin's response, read in
`waitUntil`), because a teed `ReadableStream` has no known length. The corpus's largest GLB is 7.8 MB (every GLB derived locally from the demo corpus, 2026-09-28), well inside the 32 MB cap and the 128 MB isolate. `put` is conditional on the key
not existing, and returns `null` when the condition fails. The object form
`onlyIf: { etagDoesNotMatch: '*' }` refuses an existing key under the current runtime
(verified locally under `wrangler dev`; the wildcard mis-parse of workerd issue #2572 was fixed
by workerd PR #2611). R2's reference says the `Headers` form takes RFC 7232's conditional headers,
which include `If-None-Match: *` ("absent only"), and locally it refuses an existing key too;
it is the fallback if the real bucket answers differently;
the live check against the real bucket (task 3.3) still decides. Two concurrent first touches racing to store
identical bytes is benign either way.

### D5. Only North America reads the store

`request.cf.continent === "NA"` → the store; any other value, or none, → pass through
untouched, no read and no write. The US is the only audience this change is for (decided
2026-09-28), so an allow-list of one is the whole rule: every other continent keeps exactly
today's path, which means nothing outside North America gets faster and — the reason not to
serve the world from `wnam` — nothing gets slower. A bucket in western North America read
from a European PoP would cross the Atlantic where today the upper tier beside the box
answers, and whether Asia or South America would gain was a question with no vantage to
measure it from. A pass-through list (`EU`, `AF`) was the earlier draft; dropped with that
question.

It is a constant in `route.ts`, not a variable: widening it would be a decision that needs
measurement, not a redeploy.

`wnam` rather than `enam` is the 2026-09-17 plan's choice and the measurements' vantage (US
Pacific). The hint is best-effort and permanent per bucket name
(developers.cloudflare.com/r2/reference/data-location/).

### D6. No Cache API in front of the store, yet — and the warm path is gated

Every request on the route invokes the Worker whether or not anything caches its answer, so
the Cache API would save only the R2 read, not the invocation. But it matters for the
**warm** path: today a PoP-warm object answers in ~0.06 s without a Worker; with the route, the
same request becomes a Worker invocation plus an R2 read whose latency from a distant PoP is
not documented. So the decision gate (Migration Plan step 5) requires the warm columns not to
regress, per colo. If they do, adding `caches.default` read-through in front of the store is
additive and changes no spec.

### D7. Two epochs, committed as Worker variables

`THUMB_EPOCH` and `MESH_EPOCH` in `deploy/edge/wrangler.toml`, strings (the date of the change
that set them). Advancing one is a commit and a `wrangler deploy`:

- **`THUMB_EPOCH`** after a bake ship;
- **`MESH_EPOCH`** after a corpus change;
- **both** after a server change to what the byte routes' immutable answers carry (a header,
  the ETag's shape), since a stored answer replays the headers it was stored with; and as the
  lever for an incident (a wrong object stored, see Risks).

Always **after** the change reaches the box — after the restart — never before, or the new
epoch fills with versions the change is about to supersede. One epoch would force every GLB to
refill on a bake-only ship, making the box re-serve ~1.2 GB for versions that did not move.

Old epochs' objects are unreachable immediately and orphaned; deleting them is hygiene for a
later change (R2 at $0.015/GB-month past 10 GB). **An R2 lifecycle rule on age is not the
prune**: a current version's object is never rewritten, so an age rule would expire live keys.

A `docker compose` rollback of the box does not roll back the Worker or its epochs; README §6
says so.

### D8. The backfill walks folders through the public hostname

`deploy/edge/backfill.ts` (Bun): list `/` and each folder with `/api/dir?path=…`, collect every
model's current `mtime` and thumbnail `gen` with each variant's hit state, and GET each URL
once — the thumbnail for every variant that is a hit, and the GLB. Requests go to the public
hostname so they pass through the Worker, which does the storing; the script never touches R2.
Concurrency 2, and it must run from North America (this machine)
or D5 makes it a no-op.

A listing's `thumb` annotation says what the server has *seen*, not what exists: a model whose
render the server has not read yet, or never made, carries none. For those the backfill asks
`/api/thumb` (`pixels=off`, as `ApiClient.getThumb` would) per variant — a `hit` gives the
`gen` to name, a `miss` or `stale` counts the variant absent as information, and anything else
fails naming the model. A listing still `stale` after bounded re-asks, or `truncated`, fails
naming the folder, so the URL set is never a silent subset.

A `filled` answer says the Worker *tried* to store — the put runs after the response. So the
backfill makes a **second pass** over the same URLs and reports every one that does not answer
`hit`; that, not the first pass, is the check.

It makes the box derive every GLB it has not derived yet — roughly 0.24x the STL bytes of disk
in `mesh/` and CPU on two vCPU — so it runs once per epoch advance, never on a schedule, and
only after the epochs for the current ship have been advanced. Shipping the bake machine's
`mesh/` with the bake would spare the box the derivation; not adopted, because nothing has
checked that the bake's rsync carries `mesh/` or that the mesh cache's mtime stamps survive it.

### D9. A diagnostic header, and what the probe reads

Every answer on the routes carries `x-edge-store: hit | filled | pass`. A store hit has no
`cf-cache-status`, so once the Worker answers, the probe's `batch_hit` (which counts
`cf-cache-status` HIT/STALE/UPDATING) stops meaning "served without the origin" and the README
§10 gate reads zero. The probe gains `colo` and a store column per fetch (`thumb_store`,
`glbcold_store`, `glbwarm_store`) and a `batch_store` count of `hit`s; `batch_hit` stays, for
comparability with earlier runs, and is documented as void for rows the Worker answered.

### D10. `deploy/edge/` is its own workspace

`worker.ts` (the fetch handler: the only file that touches Workers APIs; it calls
`passThroughOnException` so an uncaught throw fails open to the origin), `route.ts` (pure:
classify a request into pass-through or a key; decide whether a response is storable and what
it replays), `route.test.ts`, `backfill.ts`, `wrangler.toml`, and a `package.json` so `bun run
test` and `bun run typecheck` cover it. Three tsconfigs, all run by `typecheck`: `tsconfig.route.json` holds `route.ts`
alone with no ambient types, so it stays runnable on Workers, Node and Bun (a `Buffer` or a
Workers global there fails the check); `tsconfig.worker.json` holds `worker.ts` and its test
under `@cloudflare/workers-types`; `tsconfig.json` holds the backfill and the tests under
Node's types. The test files cannot share `route.ts`'s config, because vitest's own types pull
Node's in. Wrangler is run pinned through `bunx` (`bunx wrangler@<version>`), the Prettier
pattern — not a dependency. The Prettier glob covers `deploy/edge/*.ts` by design.

Under `wrangler dev`, `fetch(request)` targets the dev server itself rather than an origin, so
the Worker takes an optional `ORIGIN` variable used only in development to reach a stub; in
production it is unset and `fetch(request)` goes to the zone's origin.

## Risks / Trade-offs

- [A wrong object under a correct key] → the store trusts the origin's `immutable`, so it
  inherits the origin's hazards. Three are known: a `gen` reissued after a cache wipe
  (`allocateGen`, risk 8 of the 2026-09-17 plan); a ship rsyncing into the live cache, where a
  request can name the new `gen` from a refreshed sidecar before the new `.webp` lands and get
  the old pixels marked immutable (a window of the rsync's duration, unmeasured); and
  `MeshCache.read`'s < 1 ms mtime tolerance, under which a source replaced by an
  mtime-preserving tool serves the previous GLB pinned under the new version. Each is also a
  browser-cache hazard today; advancing the epoch after the change retires what the store took
  in, which is why D7 orders the advance after the restart and D8 the backfill after the advance.
- [The window between a change and the epoch advance] → accepted and specified; the operator
  closes it and it is minutes wide.
- [Daily request limit] → every request on the two paths invokes the Worker — other
  continents, PoP-warm objects and other visitors' repeats included; only the same browser's
  `immutable` cache avoids it. A first screen is ~114 requests (`.ai/todo.md` §1 at `e5ca7e7`),
  so ~877 first screens a day before fail-open, which is today's behaviour.
- [The warm path regresses] → gated per colo (D6, step 5).
- [Worker bug] → removing the routes is the rollback (spec), and every error path passes
  through; `route.ts` carries the logic that can be wrong, and is where the tests are.
- [The pass-through branch is untestable from here] → every probe vantage is in North
  America; the other-continent branch is covered by `route.test.ts` only, and a live check of
  it would need a vantage elsewhere. Its failure mode is a slower answer, not a wrong one.
- [Terms] → R2 and Workers fall under Cloudflare's Developer Platform terms, which lack the
  CDN's "large files" clause — per the 2026-09-17 plan, not re-read for this proposal.
- [Proxied permanently] → the 125-second origin timeout (a 524) is already a standing condition
  in README §10; this makes it permanent rather than new.

## Migration Plan

1. Land `deploy/edge/` with its tests. No routes yet: nothing on the live site changes.
2. Operator: create the bucket with the `wnam` hint; give Wrangler a credential on this
   machine (OAuth login or a scoped API token — the operator's choice).
3. Baseline: the latency probe with its new columns, the same day as step 5, colo recorded.
4. Deploy the Worker with its routes set fail-open, then check the live matrix before
   anything else: `pass` for no version, a stale version and each malformed shape; `filled`
   then `hit` for a current one; a `hit`'s status, bytes, length and application headers equal
   to the origin's direct answer.
5. Backfill (two passes), then the after-probe. **Decision gate**, comparing only rows served
   by the same colo in both runs: keep if cold GLB and cold thumbnail medians improve by at
   least the ~0.2 s an upper-tier crossing costs **and** the warm GLB and batch medians do not
   get worse; otherwise remove the routes and close #39 on the numbers.
6. README §7 and §6 gain the epoch steps; §10 the Worker, its kill switch and the measurements.

**Rollback**: remove the routes (`wrangler` config, or the dashboard). The bucket can stay; it
is unreachable without them.

## Open Questions

- Whether a store hit is fast enough without the Cache API (D6) — answered by step 5's probe;
  adding it changes no spec and no task above.
- `enam` vs `wnam` if the demo's audience turns out East-coast-heavy — the hint is per bucket
  name, so a second bucket and a variable, not a redesign.
