## Why

The demo's server is in Falkenstein and most of its visitors are not. Measured from US
Pacific (issue #39, comments of 2026-09-21, 09-25 and 09-26), once Cloudflare holds an
object it keeps it for at least a day and the box is not asked again. What a US visitor
still pays is distance:

- **~0.54 s** to first-touch a GLB that no Cloudflare tier holds yet (`ttfb_net`), and
  **1.34 s** total against **0.59 s** for a hit. With 3,122 models on a long tail and little
  traffic, first touch is most requests for most objects.
- **~0.21 s** for a hit that has to cross to the upper tier, which Smart Tiered Cache places
  next to the origin — in Europe — because the local PoP did not hold a copy. A local hit
  is ~0.06 s.

Neither is fixable from Falkenstein. A copy of the bytes stored in the US is, and R2 with a
`wnam` location hint is the free way to have one: no egress fees, 10 GB-month and 10M reads
free, and the demo's thumbnails and GLBs together come to roughly 1.2 GB (32 MB of renders,
plus the corpus's 4.89 GB of STL at the ~0.24x `MeshCache` states for its GLBs — an
estimate, not a measurement). Cache Reserve was
weighed and is not what the measurements ask for — it solves eviction, which the overnight
run found no sign of, and it needs a paid plan.

## What Changes

- A Cloudflare **Worker**, committed to this repository, on routes for exactly the two
  versioned byte routes: `/api/thumb/image*` and `/api/model.glb*` on the demo's hostname.
- An **R2 bucket** with a `wnam` location hint, bound to the Worker and not public: no custom
  domain, no public access, so nothing but the Worker can read it.
- **The Worker fills the bucket itself.** A request that names a version — `gen` for a
  thumbnail, `mtime` for a GLB, which the client has sent since #36 and #42 — is looked up in
  the bucket under a key built from that version. On a miss the Worker asks the origin
  exactly as today and, **only if the origin declared that answer immutable for that
  version**, stores it. There is no publisher, no upload step and no coupling to the bake:
  the bucket holds only bytes the origin itself has vouched for, under the version it vouched
  for them at.
- **Reads are routed by the visitor's continent.** Requests from Europe and Africa are passed
  straight through to today's path, where the upper tier beside the box is already the near
  copy; everywhere else is served from the bucket. The bucket is the US copy and the box is
  the European one.
- **Everything the Worker does not recognise goes to the origin untouched**: a request naming
  no version, an archive entry (`foo.zip!/entry`), a ranged or conditional request, a
  malformed parameter, any method but GET. So does any failure of the Worker or the bucket,
  and the route is set to **fail open** past the Workers free-tier daily limit.
- A **backfill** script that requests every current thumbnail (both variants) and GLB once
  through the site, so first touch is paid by the script rather than by a visitor.
- The latency probe records the **colo** and the path that served each request, since the
  answer now depends on the visitor's continent, the PoP this machine reaches is not fixed,
  and an answer from the store carries no `cf-cache-status` for the existing columns to read.
- **No application change.** The client keeps asking the origin's own URLs; the server's
  answers are unchanged; the desktop build never sees any of this. Removing the routes
  restores today's behaviour exactly.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `deployment-infrastructure`: ADDS a requirement that versioned byte requests are served
  from a copy near the visitor, filled only with what the origin declared immutable for that
  version, and that anything else — and any failure — reaches the origin as it does today.

## Impact

- **New files**: `deploy/edge/` — the Worker, its pure request-classification and key logic
  with tests, and its `wrangler.toml`; `deploy/edge/backfill.ts`.
- **Tooling**: Wrangler, run pinned through `bunx` as Prettier is, not installed as a
  dependency. Deploying the Worker needs a Cloudflare credential on this machine — an
  operator step, recorded in `deploy/demo/README.md` §10.
- **Cloudflare**: one R2 bucket (`wnam`), one Worker, two routes, both routes fail-open. The
  demo's hostname stays proxied permanently, so the 125-second origin timeout already
  recorded in §10 becomes a standing condition rather than an experiment's.
- **Cost**: $0 at this scale — Workers 100,000 requests/day free, then fail-open; R2 storage,
  reads and writes all inside the free tier with the corpus stored once per epoch.
- **Operator steps**: two epochs (thumbnails, meshes), advanced after a bake ship and after a
  corpus change respectively — README §7 and §6.
- **`.ai/probe-demo-latency.sh`**: `colo` and store-path columns; `batch_hit` stops meaning
  "served without the origin" once the Worker answers, and a `batch_store` count replaces it.
- **Docs**: `deploy/demo/README.md` §10 (the Worker, its kill switch, the backfill, the
  measurements), and issue #39 closes on the after-measurement.
- **Not in scope**: `/api/file` (STL for `obj`/`3mf` only on this corpus, and ranged), pruning
  retired versions from the bucket (hygiene at $0.015/GB-month, a later change), and any
  client-composed CDN URL (shape 4 of the 2026-09-17 plan, rejected then).
