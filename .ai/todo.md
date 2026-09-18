# Plan: serve the demo's thumbnails and models from a CDN (issue #24)

Decided 2026-09-16, revised 2026-09-17. **Phase 1 was executed on 2026-09-18 and the demo
is now behind Cloudflare** — the zone moved, both `models` records are proxied, and three
cache rules are live. `deploy/demo/README.md` §10 is the record of what was done and
measured; this file keeps the reasoning. No app code has changed, and none is planned until
the measurement in issue #39 settles whether the R2 half is still worth building. This file was rewritten whole on 2026-09-16 after seven review
rounds, then reviewed again by opus, sonnet and fable — §R says what all of that settled and
what it cost.

**Three decisions taken 2026-09-17, and they cut the plan roughly in half:**

- **The edge composes the CDN URL** (a Worker bound to R2), not the client. Every client and
  server change below is struck — see §4.
- **The contention motive is dead**, measured: 48 ms of a 1,772 ms fetch, 2.7% (§8.1). The
  win is distance.
- **The models half waits for GLB** (issue #4). Thumbnails proceed now, and they are ~114 of
  the ~115 requests a first screen makes.

## 1. Motive, and what it is not

- **Latency.** A US visitor pays ~168 ms per round trip to Falkenstein, and a first screen
  is ~114 images.
- **Consistency — settled 2026-09-17, and it is *not* the motive.** The box's contention is
  real and far too small to matter to a visitor: measured, it costs **48 ms of a 1,772 ms
  fetch, 2.7%** (§8.1). The 1.69→4.10 s spread §8 records is network — slow start and loss —
  not the box. The models half is still worth doing, but for **distance**, which is the
  first bullet, not for contention.
- **Not cost.** The CX23 includes 20 TB/month at €5.49 (hetzner.com/cloud/regular-performance,
  fetched 2026-09-16). 500 GB of egress is 2.5% of that. Nothing here is justified as a bill
  reduction.

## 2. What moves

| asset | count | size | served today by |
|---|---|---|---|
| thumbnails, both occlusion variants | 6,244 | ~32.3 MB (33.3 MB is the whole 9,367-file ship, sidecars and manifest included) | `/api/thumb/image` |
| models (STL) | 3,122 | 4,894,875,398 B — 4.89 GB decimal, 4.56 GiB | `/api/file` |

Counts are sizing, not a pin; `check-assets.sh` (§5) asserts per key, never a total. The
thumbnail figures are the 2026-09-15 bake's, recorded in `corpus-bake`. Re-run the corpus
ones:

```sh
CORPUS_DIR=${CORPUS_DIR:-~/Documents/tests/test-models}   # the default `dev:demo` takes
find "$CORPUS_DIR/miniatures/decimated" -name '*.stl' | wc -l
find "$CORPUS_DIR/miniatures/decimated" -name '*.stl' -printf '%s\n' | awk '{s+=$1}END{print s}'
```

`du -sb` is the wrong instrument and does not reproduce the table — it counts directories,
`overrides.json` and the library marker.

Not moving: every `/api/*` answer (listings, search, credits, features), the client bundle
(hash-named and already served `immutable` by the app), and zip entries — `/api/file`
extracts those in memory per request, the demo corpus contains none, and they keep the
origin path unconditionally.

## 3. Host: Cloudflare R2 on a custom domain

Prices verified 2026-09-16 against vendor pages.

| option | 10 GB egress/mo | 500 GB egress/mo | storage | failure mode |
|---|---|---|---|---|
| **Cloudflare R2 + custom domain** | $0 | $0 | 10 GB-month free, then **$0.015/GB-month pay-as-you-go** | bills past the free tier; no hard cap, and no cliff either |
| Bunny Storage + Pull Zone | $1.00 (minimum) | ~$5.10 | $0.01–0.02/GB-month | prepaid; account pauses at €0 |
| Cloudflare CDN over the existing origin | $0 | $0 | — | Application Services terms restrict serving "a disproportionate percentage of pictures … or other large files" |
| Backblaze B2 + Cloudflare | $0 | $0 | $0.00695/GB-month | same terms restriction; B2 custom domain needs sales approval |
| CloudFront + S3 | ~$0.25 | ~$0.25 | $0.0245/GB-month | no cap; a spike past the 1 TB free tier is $0.085/GB |
| Hetzner Object Storage | €6.49 | €6.49 | €6.26/TB over 1 TB | no custom domains; their FAQ says it is not a CDN |
| Pages / Netlify / Vercel / jsDelivr / HF | — | — | — | 25 MiB per-file cap (Pages), or AUP language naming hotlinked media hosting as abuse |

What decided it: Cloudflare's **Developer Platform** terms (governing R2, dated 2026-06-02)
carry no large-file or non-HTML clause, while the **Application Services** terms (governing
the CDN) do. R2 on a custom domain is the sanctioned shape; proxying the box's own bytes
through the free CDN is the restricted one.

An R2 custom domain requires the zone on Cloudflare, so the Namecheap → Cloudflare
nameserver move is needed either way. Phase 1 takes that step early rather than spending it.

## 4. Architecture

### Keys

    <thumbnails base>/<library path>/<gen>.webp        occluded render
    <thumbnails base>/<library path>/<gen>.noao.webp   unoccluded render
    <models base>/<library path>                       model bytes

Both bases are whole URL prefixes carried in the deployment's configuration. **The
thumbnail version is the generation, in the key**; **the model version is a segment inside
the base URL** (`"models": "https://assets.example/m/2026-09-16"`). The client never
composes the *models* version — it concatenates that base and a path. Thumbnails are the
other way round: the client does place `gen` in the key, because it already holds it.

Why the split:

- Thumbnails already have a per-entry version the client holds: `gen`, an integer the
  listing annotation carries and the origin's own image URL already names. So the object
  key and the origin URL identify the same render, `immutable` is honest, a re-render
  writes a new key, and no configuration changes when the store is re-baked.
- Models have no such number. `DirEntry.mtime` is a float on the wire
  (`1789446597239.1736`), and a key built from one would depend on Python and JavaScript
  formatting the same float identically. The operator's string in the base avoids that and
  makes a rollback a one-line revert.
- The generation goes **after** the path, not in front of it. A millisecond stamp at the
  top would give no two entries a shared prefix, and the prune could never scope itself to
  a path.

### Who composes the CDN URL — DECIDED 2026-09-17: the edge does (shape 1)

**Masa chose the edge Worker.** The consequence is large and good: **§4's client sections,
the `assets` config key and the `/api/features` change are all struck from the plan.** They
were bought by shape 4 and shape 4 is not being built. What remains below is kept as the
record of why, and because the key shapes still describe what the Worker maps *to*.

Struck with it: the mount race, the wrong-base hole, the `readAssets` getter, the decorator
question, the `withLocalFramings` parameter, and every client test in §7 — none of them
exist under an edge mapping. `thumbUrl.ts` and `fetchModel` are untouched; the client keeps
asking the origin's own URLs and never learns a CDN exists.

The four shapes, kept for the record:

1. *The edge maps.* A Worker route-scoped to `/api/thumb/image*` and `/api/file*`, bound to
   R2, translating those URL shapes into object keys and falling back to the origin on a
   miss. **No app change at all**: no config key, no features field, no decorator, no race,
   no wrong-base hole, and it is Developer Platform code, so §3's terms question on the
   app's own hostname goes away. An earlier draft rejected this on the Workers Free ceiling
   — wrongly. The free plan's per-route behaviour past 100,000 requests a day is
   **fail-open**: "Bypasses the Worker. Requests behave as if no Worker is configured"
   (developers.cloudflare.com/workers/platform/limits/), which is this plan's own fallback
   philosophy. The route scope also means it is not in front of the whole site, and
   `immutable` repeats never reach it. Its real costs are different ones: the app hostname
   stays orange-clouded, so §9's 524 behaviour becomes permanent rather than time-boxed; and
   an R2-binding Worker bypasses the edge cache unless it uses the Cache API or fetches
   through the custom domain.
2. *The origin redirects.* `/api/file` answers 302 to the CDN when `assets.models` is set.
   No client code at all; `modelFormat`'s allowlist and the nested-zip rule stay per-request
   at the origin, so risk 2 disappears entirely; no race, no wrong-base hole. Costs one
   origin round trip — ~168 ms of a 1.77 s fetch by §8, about 10% of the models win, and
   none of the contention win if §1's contention turns out to be real.
3. *The server emits the URL.* The listing annotation carries the CDN URL beside
   `state:'hit'`. This puts the URL where the vouching already lives (`statusFor`/`infoFor`),
   which dissolves both the mount race and the "the override cannot enforce vouching" hole
   below, and leaves the client concatenating nothing.
4. *The client composes* — the largest, and the one every "client" paragraph below was
   written for. **Not being built.**

What shape 1 still requires, and what a later phase must specify: the Worker's own code
(a key rewrite plus an R2 `get`, with origin fallback on a miss), whether it reads through
the Cache API or fetches the custom domain so that edge caching still applies, **fail-open
chosen deliberately on the route** (it is a setting, not a default — see the cost section),
and the fact that the app hostname stays orange-clouded permanently, so §9's 524 behaviour
is a standing condition rather than a time-boxed one.

Two key *shapes* were also weighed and lost:

- *An unversioned models prefix, corrected by purge.* No retired prefix, no free-tier
  cliff, and purge by prefix is available on Free (§6, risk 8). Rejected because every
  model correction becomes a manual purge whose omission is invisible — stale bytes served
  `immutable` for a year with nothing in the client able to tell.
- *A short Edge TTL for models instead of `immutable`.* `/api/file` sends no
  `Cache-Control` at all today, so even an hour would be an improvement, and staleness
  self-heals. Rejected because it gives up most of the win on the half that carries the
  bytes, and because the reason once given for keeping it in reserve — the 10 GB free tier
  — turned out to be mispriced (risk 6).

### What any of this costs — $0, and where the ceilings are

Verified 2026-09-17 against developers.cloudflare.com (r2/pricing, workers/platform/limits).
Nothing in §4 has a monthly bill at this demo's scale, and that is true of every shape above:
a Worker's invocations come out of the same free tier as everything else.

| item | free allowance | price past it | this demo |
|---|---|---|---|
| Workers requests | 100,000/day | $5/mo Paid → 10M/mo | $0 |
| Worker CPU | 10 ms/request | — | $0; a key rewrite is I/O wait, not CPU |
| R2 storage | 10 GB-month | $0.015/GB-month | 4.93 GB → $0 |
| R2 Class A (writes) | 1M/month | $4.50/M | 9,366 per bake → $0 |
| R2 Class B (reads) | 10M/month | $0.36/M | $0 |
| R2 egress | unlimited | — | $0 |

The tighter ceiling is the Worker's: a cold first screen is ~114 requests, so 100,000/day is
~877 **cold** first screens a day. R2's read tier is ~87,000 of them a month. "Cold" carries
the argument — the renders are `immutable` and the whole set is ~32 MB, so once a PoP is
warm its visitors reach neither the Worker nor the bucket, and warming every PoP is a few
hundred × 114 ≈ 34,000 invocations.

Two things the documentation does not settle, neither of which changes the decision at this
scale: whether a `bucket.get()` through a Workers binding bills as a Class B operation, and
whether a cache HIT in front of an R2 custom domain still incurs one. Re-check both if the
demo ever carries real traffic.

Note also that **fail-open is a route setting, not a default** — the same limits page offers
fail-closed (a Cloudflare `1027` error page) for security-critical Workers. Shape 1 above is
only as safe as that setting, so it has to be chosen deliberately.

### Encoding

**Keys are raw bytes; only the URL is encoded.** The publisher writes
`Mini_Warehouse_6185614/Oildrum_Lid_Ø50.stl/<gen>.webp` exactly as the path reads on disk.
The client encodes per segment, joins with real `/`, drops the leading one. A publisher
that stores the percent-encoded form serves nothing: the edge decodes before matching, so
`…%C3%98…` looks for the raw name and 404s.

Note this is a second URL shape inside one builder — today `thumbImageUrl` puts the whole
path in a *query parameter*, where `encodeURIComponent` escapes the slashes too.

The corpus has seven non-ASCII paths: six carrying `Ø`, one katakana directory
(`Pompompurin_ポムポムプリン_4649260`). All are already NFC on disk:

```sh
find "$CORPUS_DIR/miniatures/decimated" -name '*.stl' \
  | python3 -c "import sys,unicodedata as u; print(sum(u.normalize('NFC',l)!=l for l in sys.stdin))"
```

So the falsification bucket (§7) carries those two real cases plus one **deliberately
synthetic** NFD name — kept because a corpus imported from HFS+ would arrive decomposed
even though this one did not.

### Server

- New optional top-level key in `DeploymentConfig` (shared/types.ts):
  `"assets": { "thumbnails": "https://…", "models": "https://…" }`. Both optional strings,
  validated as absolute `https:` URLs with no trailing slash. Add `"assets"` to
  `TOP_LEVEL_KEYS` in server/src/config.ts with its own `rejectUnknown` list.
- It is a **top-level** key, not a capability. `FEATURE_KEYS` derives from
  `DEFAULT_FEATURES` and must stay boolean-only, and `config.features` is typed
  `Partial<FeatureReport>`, so an `assets` field inside `FeatureReport` would be type-legal
  in a place the parser refuses at runtime.
- `/api/features` answers `FeatureReport & { assets?: AssetBases }` — **additive**. Today's
  client reads the capability booleans exactly as it does now and ignores the extra key, so
  the server phase lands alone. (A nested `{features, assets}` was carried for four review
  rounds before anyone asked what it bought: it is a breaking response change that would
  also force the server and client phases to land together.)
- `createApp` — nine positional parameters today, `cache` through `origins` — gains a tenth.
- Unchanged: `guard()` still covers `/api/*` only and still emits no CORS headers;
  `/api/thumb`, `/api/thumb/image` and `/api/file` keep their behaviour and remain both the
  fallback and the entire local/dev posture, where no `assets` key is set.

### Client

Two pieces, and **no `ApiClient` signature moves**:

1. A second getter, `readAssets`, over the **same** ref, whose type widens to
   `(FeatureReport & { assets?: AssetBases }) | null`. Every existing reader
   (`withLocalFramings`, the `useThumbnails` sweep, `notEmbeddedMessage`) takes a bare
   `FeatureReport | null` and an intersection stays assignable to that, so none of them
   change. One ref, one effect, two getters.
2. The overrides themselves — and **not** in `LocalFramingClient`. Two reasons an earlier
   draft missed: that class already holds `report`, a getter over the same ref, so widening
   its type hands it `assets` with no new parameter at all; and its concern is D6 local
   framings, so composing CDN URLs there makes the class name lie. `HttpApiClient` is the
   network-shaped class, already carrying an injectable `fetchFn`, and is where a base URL
   belongs. (Under shape 2 or 3 above, this whole item disappears.)

`client/src/api/thumbUrl.ts`'s own comment — that an `<img>` and the JSON lookup "name the
same bytes and land in the same cache tier" — is **falsified** by a CDN URL and must be
rewritten with the change. The pure builder itself keeps its current shape and every test stub (`appHarness.tsx`, `thumbnailQueue.test.tsx`,
and `folderSheets.test.tsx`, which calls the real builder) is untouched. One signature does
move — `ApiClient.features()`'s **return type** widens to carry `assets` — but a narrower
return type stays assignable, so the stubs still compile unchanged.

Rules the override follows:

- A CDN URL must only be minted where the listing already vouches for the render — variant
  `state: 'hit'` and `usable(...)` passing. **The override cannot enforce that**:
  `thumbImageUrl(path, mtime, ao, gen)` sees none of it. The invariant lives in
  `useThumbnails`' `start`, today's only caller of that method, and nothing but convention
  keeps the next caller from routing a whole screen into the base64 tier. Pin it: a comment
  at the call site and a test that a non-vouched entry never produces a CDN URL.
- `gen` is optional on the method and `infoFor` reads `meta.gen ?? 0`, so **both `undefined`
  and `0` return the origin URL unchanged**. Pin both.
- `fetchModel`: with a models base, `GET <base>/<library path>`; on a non-ok status or a
  network error, retry `/api/file?path=…`. Paths containing `!` (zip entries) always go to
  the origin. This is a `fetch()`, so the bucket must send
  `Access-Control-Allow-Origin: https://models.masamaeda.com`; thumbnails need no CORS,
  since a plain `<img>` load is not CORS-governed. Route it through `HttpApiClient`'s
  injectable `fetchFn` rather than the global, or §7's fallback tests have no seam to stub.

### What the fallback does and does not cover

A **missing** object recovers by itself: `<img onError>` → `onImageError` → the `/api/thumb`
lookup → a `blob:` URL. But that lookup carries the render base64-inlined, which is the
heavy tier `/api/thumb/image` exists to avoid — so a wrong *base* puts a whole first screen
through the expensive path. It does not loop (`getThumb` never calls `thumbImageUrl`), so it
is safe, only costly.

A **wrong** object does not recover at all: wrong pixels are a 200 that decodes, no error
event fires, and there is no client-side detection. What keeps a stale render from being
drawn is `usable()` failing on the labels a write clears — not the key.

### The race, and why it is left alone

The features effect fires at mount; the sweep runs after a listing resolves; the sweep's
dependency array holds the getter's *stable* identity alongside its other inputs (`poses`,
`libraryId` and the rest), so a report landing later changes nothing in it, so a report landing later does not
re-run it. A first screen drawn before the report resolves therefore uses origin URLs.
Accepted: the failure is benign (correct tiles, served from the box), and the ordering
favours us — the features answer is a few hundred bytes issued at mount, the listing it
races is far larger, and the sweep only starts once that lands. Pin the *benign fallback* in
a test, not the race: a tile drawn while the report is null renders the origin URL and does
not throw.

### The CDN does not decouple from the box's cache

A CDN URL is used only where the listing annotation reads `hit`, and that annotation comes
from `ThumbCache.facts`, an in-memory map seeded by `maintain`'s startup pass. So
`rm -rf <cache>/<id>` during visual tuning costs nothing *until the server restarts* — after
which the annotations are gone, every object is still in the bucket, no visitor reaches one,
and every tile re-renders locally. A republish implies a re-bake. (`maintain`'s cap eviction
is a different case: it clears a variant's labels without bumping the generation.)

### The models half waits for GLB (decided 2026-09-17)

Issue [#4](https://github.com/ConfusedSky/model-browser/issues/4) replaces STL with GLB at
roughly a third the bytes (its own table: 169.7 MB → 59.9 MB on a 200-model corpus, 2.8x;
5.8x gzipped). Masa reports it is approaching final review. Publishing 4.89 GB of STL now
would be **paid twice**: the upload, and then a retired 4.89 GB prefix to prune when the
corpus turns over — and the keys change wholesale, since the models key is the library path
and #4 changes both the extension and `MODEL_EXT`.

The saving compounds with this plan rather than merely shrinking it: fewer bytes is fewer
slow-start round trips, which is the entire models win per §8.1. At ~1/3 the size a model
needs about six round trips instead of eight, and from a `wnam` edge that is ~0.12 s against
today's 1.77 s.

So: **the thumbnails half proceeds now; the models half waits for #4.** Thumbnails are
unaffected by it — 32.3 MB of WebP, no relationship to the model container — and they are
~114 of the ~115 requests a first screen makes, so nearly all of the request-count win lands
in the half that is not waiting.

Two things to carry into #4's review, because they are cheaper to decide there than to
retrofit: whether GLB objects are served under the same `/api/file?path=` shape the Worker
maps (if the route or the extension changes, the Worker's rewrite changes with it), and
whether both formats are ever served at once — which would double the bucket rather than
shrink it.

## 5. Publishing

**Ordering, and it is the reverse of the runbook's.** `deploy/demo/README.md` §7 rsyncs
sidecars to the box and restarts the app as one `--ship` step; the moment it restarts, the
listing annotates the new generations and every CDN URL 404s until the upload finishes —
routing all 6,244 tiles through the base64 tier for the whole window. So: **bake, publish,
rsync, restart**, which means `--ship` cannot be used unsplit. `--ship` also carries the
post-ship verification `deploy/demo/README.md` §7 documents — waiting for `/api/library` to
read ready, hit-checking three models on both variants, running every example query — so
splitting it means either running those by hand or teaching the bake script a
publish-aware flag. Decide which in phase 5; do not simply lose them.

`deploy/demo/publish-assets.sh` runs **from this machine against the bake's own cache**, not
on the box after shipping. rclone against R2's S3 endpoint.

**Name the toolchain before writing either script.** `deploy/demo/check-bake.sh` records
that the box has no jq, no Bun and no Node, which is why every check there is line-oriented
`grep`/`sed`; python3 is present. **rclone is absent on the box and on this machine too**
(verified 2026-09-17), so installing it is a phase-5 step wherever the publisher runs. The
publish running from this machine (above) sidesteps the interpreter question but not that
one.

- **Thumbnails.** Walk `<cache>/<library id>/*.json`. Each sidecar carries the library path
  and the generation — `{"path":"/Kit/x.stl","gen":1789519399619,…}`, written by
  `ThumbCache.writeMeta`, read back by `infoFor`, and the same number the listing hands the
  client. Upload `<sha>.webp` → `<path>/<gen>.webp` and `<sha>.noao.webp` →
  `<path>/<gen>.noao.webp`, **per variant, only where that variant is a hit**. No sidecar
  stores that verdict: `statusFor` (server/src/cache.ts) derives it by comparing the
  variant's stored `mtime` against the model file's, so the publisher stats each model and
  compares. Recipe labels (`rig`, `lighting`, `posed`, `poseKey`) are `usable()`'s business
  at draw time, not the publisher's. One-sided entries are ordinary — a baked store carries
  both variants for every model, a browsing-built one mostly does not, which is why
  `BakeManifest` counts `renders.ao` and `renders.noao` separately.
- **Models.** `rclone sync` under the version prefix the `models` base names, with an
  include filter mirroring `modelFormat`'s allowlist. Load-bearing: `/api/file` enforces
  "model formats only, everything else answered as missing" per request, and publishing
  moves that rule to publish time. A `notes.txt` or a runbook rsynced into the corpus must
  not be published.
- **Headers at upload:** `Cache-Control: public, max-age=31536000, immutable`;
  `Content-Type: image/webp` / `application/octet-stream`; `X-Content-Type-Options:
  nosniff`. Bucket directory listing off.
- **The models prefix needs its own Cache Rule.** An R2 custom domain caches by file
  extension by default; `webp` is in that set, `stl` is not
  (developers.cloudflare.com/cache/concepts/default-cache-behavior/), so the thumbnails
  half needs nothing and the models half would otherwise be a bucket read every time. On
  the assets hostname: `ends_with(http.request.uri.path, ".stl")` → Cache eligibility
  **Eligible for cache**, Edge TTL **Respect origin** (the objects are uploaded
  `immutable`).
- **Refusing an overwrite is the publisher's job.** It must not write a key that exists with
  different bytes (risk 8). It must *not* refuse a populated prefix — that would block
  resuming an interrupted 4.89 GB upload.
- **CC-BY attribution.** Publish a `CREDITS.txt` generated from the override store at each
  prefix root. Attribution exists only inside the app today.
- **`deploy/demo/check-assets.sh`**, the pin, in two passes:
  - *Thumbnails*: per-key existence at the current generation for each hit variant, never
    assuming a pair, plus a list of keys under the thumbnails base that no sidecar names —
    that list is the prune's input. A *total* cannot work: `allocateGen` stamps each entry
    in milliseconds, so a re-bake writes a disjoint key set and the bucket holds 2x the
    manifest's count after one re-bake. `bake.json`'s `renders.ao` / `renders.noao`
    (top-level keys in `BakeManifest`, the written shape; `verify` is on `ManifestInput`
    only and never reaches the file) stay useful as the expected *sidecar* count.
  - *Models*: two directions, both read-only. Forward, from the corpus file list filtered
    by `modelFormat`'s allowlist, every expected key must exist. Backward, an enumeration of
    the models prefix must report keys the allowlist does not explain — that is what catches
    risk 2's over-broad include filter, which a corpus-driven pass alone could never see.
    It **reports**; it never proposes a deletion, since no sidecar names a model and a
    deleting sweep here would propose all 4.89 GB.
- **Pruning runs after the restart, never between publish and restart.** Its input is "keys
  no sidecar names" computed from the local bake, and between publish and restart the box is
  still serving the *previous* generation — so a prune in that window deletes exactly what
  visitors are asking for. Thumbnails: the sweep above, and **not** an R2 lifecycle
  rule on age — a current generation's object is never rewritten, so an age rule would
  expire live keys. Models: deleting the retired version prefix, which is a step of the
  bump (risk 6).
- **Rolling back differs per half too.** Thumbnails: republish, since no configuration
  string points at a generation. Models: revert the `models` base to the previous prefix —
  which is the reason the version lives there — so keep one retired prefix until the new one
  is verified, then delete it.

## 6. Risks

1. **A wrong object under a correct key is invisible and lasts a year.** No client-side
   detection exists (§4). `check-assets.sh` before the flip is the only guard.
2. **The model-format allowlist moves from per-request to publish time.** A wrong include
   filter publishes a file `/api/file` would refuse; `check-assets.sh`'s models pass is what
   catches it.
3. **`Cross-Origin-Resource-Policy` is lost for thumbnails — recoverably.** If the assets
   hostname is a subdomain of `masamaeda.com`, a Response Header Transform rule (available
   on Free) adding `Cross-Origin-Resource-Policy: same-site` restores the block; choose the
   hostname with that in mind and this closes rather than being accepted. Unrecovered, it
   reads: The origin sets
   it deliberately, so a guessed URL is not an existence oracle through `onload`/`onerror`.
   A public bucket object has no such header: a third-party page can then probe library-path
   existence and hotlink every render. Accepted cost — record it in the proposal rather than
   letting it pass silently.
4. **Model bytes are not new exposure**: `/api/file` already serves them publicly. Risk 3
   applies to thumbnails only.
5. **A wrong base is costly, not just wasteful** — see §4's fallback note.
6. **A model version bump doubles the stored bytes — and costs pennies, not a cliff.** A
   `models` base bump is the corpus again (4.89 GB) and `rclone sync` under a new prefix
   never touches the old one, so two prefixes plus both thumbnail generations is ~9.86 GB
   against a 10 GB-month free tier. Past that R2 bills **$0.015/GB-month pay-as-you-go with
   no cap and no cliff** (developers.cloudflare.com/r2/pricing/): carrying a second 4.89 GB
   prefix for a month is about **$0.07**. So deleting the retired prefix is *hygiene, done
   once the new one is verified*, not an emergency — and nothing in this plan should be
   traded away to stay under 10 GB. An earlier draft called the margin "thinner than one
   re-bake's orphans", which was backwards twice over: the margin is ~140 MB against 33 MB
   of orphans, and the overage was never a failure in the first place.
7. **`thumbWrites` with `assets` warns; it does not refuse.** A deployment accepting visitor
   writes produces renders the bucket does not carry — but that is a *missing* object, which
   the `onImageError` path recovers with correct pixels. A `ConfigError` would be a hard
   startup failure for a benign harm, and since `DEFAULT_FEATURES.thumbWrites` is `true` and
   index.ts merges `{...DEFAULT_FEATURES, ...config.features}`, it would refuse to start
   **every** deployment that sets `assets` without explicitly writing `thumbWrites: false`.
   One warning line naming both keys when `thumbWrites` resolves true and `assets.thumbnails`
   is set. The demo sets `false` explicitly and never sees it.
8. **A generation can be reissued after a cache wipe.** `allocateGen` is
   `max(Date.now(), lastGen + 1, prev + 1)` with `lastGen` module-level and reset per
   process, so after `rm -rf <cache>/<id>` there is no `prev` floor and a backwards clock
   step can reissue a generation the bucket already holds — under `immutable`. Hence the
   publisher's refusal to overwrite differing bytes. Recovery at the edge is purge by
   prefix, available on the Free plan (100 operations per request, 5 requests a minute —
   developers.cloudflare.com/cache/how-to/purge-cache/). A prefix purge covers every URI
   beneath it whatever the query string; what is unsupported is naming a query string
   *inside* the prefix, which R2 keys never carry anyway.

## 7. Verification

- **Baseline first**, per §8. It is what the change has to beat.
- **Config parse tests**: `assets` accepted; unknown sub-key refused; non-https refused;
  absent key means today's behaviour; `assets.thumbnails` with an explicit
  `features.thumbWrites: false` accepted silently; `assets.thumbnails` with `thumbWrites`
  `true` **or absent** accepted **with one warning line naming both keys** (risk 7 — absence
  is the case that matters, since the default is `true`).
- **Client tests**: the decorator with and without bases; `gen` `undefined` and `0` both
  returning the origin URL; `fetchModel`'s fallback on a 404 and on a network error; zip
  paths never leaving the origin; a tile drawn while the feature report is null rendering
  the origin URL without throwing; and key round-tripping for `Ø`, the katakana path, a
  synthetic NFD name, and a synthetic path carrying `#`, `?`, `%`, `+` and a space (no
  corpus path contains any of those, which is why it is synthetic).
- **Falsify two cases, do not assume either**: a *missing* object (the tile must still draw
  through `onImageError`) and a *stale* one (an object published under a generation the
  listing no longer names must never be reached).
- **Teach the probe the CDN before the flip.** As written it cannot measure the destination:
  it builds only origin-shaped URLs and its startup check demands `$HOST/api/features`, so
  pointing `HOST` at a bucket refuses to start and leaving it alone measures the untouched
  origin. It must read `assets` from `/api/features` and build `<base>/<path>/<gen>.webp`
  and `<base>/<path>`, keeping the origin columns beside them so one row compares both.
  This is phase 5 work, not an afterthought.
- **After the flip**: re-measure per §8; confirm `cf-cache-status: HIT` and the `immutable`
  header on a CDN response; confirm the box's egress dropped against a named instrument —
  the Hetzner cloud console's traffic figure, or `vnstat -m`, which is **not installed on
  the box** — so either use the console or install it now, because a *before* month has to
  exist before the flip.

## 8. Baseline, and the probe

From this machine (US Pacific) to Falkenstein. Run it; do not read figures out of this file:

```sh
.ai/probe-demo-latency.sh .ai/demo-latency/demo-latency-before.csv 60 60
```

The output path is an argument and the run holds a `flock` on `<output>.lock`. Two runs
writing one file interleave rows into something that looks like data and is not — that
happened twice on 2026-09-16 and cost two baselines. Do not delete the lock while a run
holds it, and **do not edit the script while a run is using it**: bash reads a script
incrementally, so a run started before an edit keeps writing the old columns. That cost a
third.

Summarise with the excluded rows *first* — a CDN that turns slow-but-complete answers into
failures (Cloudflare gives up on an origin at 125 s) would otherwise read as pure
improvement, because every row it broke left the average:

```sh
python3 - <<'PY'
import csv, collections, statistics as st
allrows = list(csv.DictReader(open('.ai/demo-latency/demo-latency-before.csv')))
rows = [r for r in allrows if r['ok'] == '1']
print('rows', len(allrows), 'ok', len(rows))
print('excluded by reason:', collections.Counter(r['why'] for r in allrows if r['ok'] != '1'))
if not rows:
    raise SystemExit('no ok rows — read the why column before reading any timing')
gate = [r for r in rows if int(r['batch_hit']) == 20 and float(r['batch_total_net']) < 0.3]
print('rows passing the phase-1 gate:', len(gate),
      '| best batch_hit:', max(int(r['batch_hit']) for r in rows))
for c in ('thumb_ttfb','thumb_ttfb_net','batch_total','batch_total_net','model_total','model_bps','dir_ttfb'):
    v = [float(r[c]) for r in rows]
    print(f'{c:16s} min {min(v):.3f} med {st.median(v):.3f} max {max(v):.3f}')
PY
```

What the probe is built to survive, and why each matters, is in its own header comment. The
three that decide whether a result means anything: `ok`/`why` (a truncated transfer still
reports HTTP 200, and a Cloudflare challenge is a fast small 403), `batch_hit` (counts only
HIT, STALE and UPDATING — REVALIDATED means the edge asked the origin first, which is the
round trip being removed), and the `*_net` columns (subtracting `time_appconnect`, which is
DNS plus TCP plus TLS — an edge shortens all three even for bypassed routes).

Structural facts, stable across every version of the probe: one round trip to Falkenstein is
~168 ms; connection setup completes at ~342 ms cold; 20 renders multiplexed over one HTTP/2
connection take ~1.0 s, ~0.68 s net of setup.

Outputs live in `.ai/demo-latency/`, which `.ai/.gitignore` excludes — the probe and this
plan are tracked, the measurements are not.

Confirmed live: `/api/thumb/image` answers `Cache-Control: public, max-age=31536000,
immutable` at a current generation, and **`/api/file` sends no `Cache-Control` at all**.
That one fact is why the phase-1 experiment caches thumbnails for free and models not at all.

**The completed baseline, 60 samples over an hour, 2026-09-16, all `ok=1`** — this is what
the change has to beat, and it is the measurement that justifies the models half:

| column | min | median | max | spread |
|---|---|---|---|---|
| `thumb_ttfb_net` (one round trip) | 0.165 | 0.168 | 0.173 | 5% |
| `batch_total_net` (20 renders) | 0.657 | 0.681 | 0.781 | 19% |
| `model_total` | 1.686 | 1.772 | 4.101 | 143% |
| `model_bps` | 696,802 | 1,960,577 | 2,084,160 | 3.0x |

The round trip is steady to 5% while model throughput swings threefold. **Do not read that
as box contention — the baseline cannot support it.** Two reasons:

- The *median* is distance, not load. 2,500,084 bytes from an IW10 initial window at a
  168 ms round trip needs 8 round trips of slow start = 1.344 s; the measured median
  transfer is `model_total − model_ttfb` = 1.772 − 0.510 = **1.262 s**, within 6%. That is
  TCP, not the box.
- The *tail* is five rows of sixty with no box-side correlate recorded beside them. One lost
  segment during slow start at this round trip costs about a second on its own, which is the
  whole of the observed spread.

What would settle it: record `/proc/loadavg` and the index's busy state per sample, or run
the same probe from a low-round-trip vantage where slow start is cheap. Note too that the
probe opens a fresh connection per model where a browser reuses the HTTP/2 one it already
has for the thumbnails, so `model_total` overstates what a visitor pays.

An earlier 8-sample run is kept at `.ai/demo-latency/demo-latency-v1-partial.csv`; its columns predate
several probe rewrites and do **not** compare with the current file.

### 8.1 The contention question, settled

The claim under test: "when the box is busy, downloads slow with it." The mechanism is real
and it is negligible at the visitor's scale. Measured 2026-09-17 with
`.ai/probe-box-contention.sh` (output kept at `.ai/demo-latency/box-contention.csv`), which
fetches the same 2.5 MB model **from the box itself** through Caddy on loopback — no round
trip, no slow start — every 2 s for a minute, firing three concurrent `/api/semantic`
queries during the middle third so the SigLIP index competes for the two vCPU:

| phase | n | total, median | worst | throughput |
|---|---|---|---|---|
| idle | 20 | 0.038 s | 0.062 s | 65.2 MB/s |
| index queries running | 10 | 0.087 s | 0.117 s | 28.9 MB/s |

So contention is a genuine **2.4x on the box** — and 2.4x of 38 ms is 48 ms, **2.7% of the
1,772 ms a visitor waits**. It cannot produce §8's 2.4-second tail; that is 20–40x larger
than the whole mechanism. The box serves this file 36x faster than the wire delivers it even
while loaded.

Two conclusions the rest of this plan rests on:

- **The models win is distance, not load.** Slow start is 1.26 s of the 1.772 s median at a
  168 ms round trip. An edge at ~20 ms turns those 8 round trips into ~0.16 s. That is the
  prize, and it is large — but only if the bytes are served from near the *visitor*.
- **Nothing here should be justified by contention again.** If it is quoted as a motive in a
  later draft, this is the measurement that refutes it.

## 9. Phase 1 — the pull-zone experiment

**Orange cloud / grey cloud** is Cloudflare's toggle on a DNS record. *Orange* (proxied)
publishes Cloudflare's address instead of the box's, so visitors land on an edge that
terminates TLS and applies caching and rules before forwarding. *Grey* (DNS only) answers
with the box's real address and Cloudflare is just a nameserver. The toggle is one click and
is the revert for everything below; nothing on the box changes either way.

Orange-cloud the existing hostname. **No second hostname and no origin rename**: Cloudflare
proxies `models.masamaeda.com` straight to the box's address and connects back with the
`Host` header unchanged, so the app's guard, `config.json`'s `origins` and Caddy's site
block all keep working untouched.

1. **Add the zone at Cloudflare** and move the nameservers at Namecheap — Masa's step, it
   needs the registrar login. Record the existing Namecheap records first: the revert is
   moving the nameservers back and re-creating them, and grey-clouding does not undo it.
   Wait for the zone to read Active.
2. **Turn off what a new zone turns on**: Browser Integrity Check (it challenges bare curl,
   which is what the probe is) and Email Obfuscation.
3. **SSL/TLS mode: Full (strict).** Caddy keeps its own Let's Encrypt certificate and
   Cloudflare validates it; anything less lets the edge talk plaintext to the box. Note the
   coupling: under Full (strict) an expired origin certificate is a 526 for every visitor,
   where today it would be a browser warning.
4. **Cache Rules — order matters.** Rules stack and the *last matching* rule wins for
   conflicting settings, so the bypass must not also match the image path. A rule is needed
   at all because the free plan caches by file extension and `/api/thumb/image` has none.
   - Rule 1: `http.request.uri.path eq "/api/thumb/image"` → Cache eligibility **Eligible
     for cache**, Edge TTL **Respect origin** (the route already says `immutable`). The
     default cache key includes the query string and Free cannot customise that, which is
     what makes `gen` part of the identity.
   - Rule 2: `starts_with(http.request.uri.path, "/api/") and http.request.uri.path ne
     "/api/thumb/image"` → **Bypass cache**. (`not` is unary in wirefilter; the
     negated-equality form is `ne`.)
5. **Protect ACME renewal.** `deploy/demo/Caddyfile` has no `tls` line, so Caddy chooses
   among the enabled challenges at random and then learns a preference
   (caddyserver.com/docs/automatic-https) — it does not deterministically try TLS-ALPN-01
   first, as an earlier draft claimed. What matters is that TLS-ALPN-01 **cannot succeed at
   all** behind a proxy terminating TLS, so half the attempts are wasted and the outcome
   depends on what Caddy happens to have learned. Pin the HTTP-01 issuer rather than
   relying on that. **Check whether this is due before doing it**: the live certificate runs
   to `notAfter Dec 8 2026` (`openssl s_client -connect models.masamaeda.com:443 </dev/null
   | openssl x509 -noout -dates`), so renewal is ~Nov 8 and a same-day experiment does not
   touch it. Then a
   Configuration Rule exempting `/.well-known/acme-challenge/*` (no Always Use HTTPS, no
   Automatic HTTPS Rewrites), the documented breakers of HTTP-01 through a proxy.
   `deploy/demo/Caddyfile.local` cannot mirror an issuer block — its site is `localhost`
   with `tls internal` — so record the line as the **second** sanctioned divergence in both
   files' headers, or the next reader "fixes" it back. **This step edits a tracked file and
   needs a commit, a push, a pull on the box and `up --build`**, so it falls under the same
   explicit go-ahead §10.6 requires.
6. **Skip `trusted_proxies`.** `deploy/demo/Caddyfile` has no `log` directive, so no access
   line records an edge address; and it is a global `servers { }` option with only a static
   IP list to maintain by hand. Revisit if logging is ever turned on.
7. **Re-measure** over a window of the same length and compare per §8. Read `batch_hit` and
   `batch_cf`, never the standalone thumbnail's `thumb_cf` — that object is drawn at random
   from a pool of over a thousand and is *meant* to read MISS. Ignore the first samples
   after a rule change: the edge is per-PoP and starts cold. Compare the two runs' `ok=0`
   counts and `why` columns before comparing any timing.
8. **End it.** Grey-cloud the records as soon as the gate has been read. This is a
   measurement, not a posture: leaving the zone proxied keeps both the terms exposure and
   the 524 behaviour below in place for however long phases 2–6 take. Re-orange only for the
   phase-6 flip, and only for the hostname that needs it.

**What it can show:** whether edge-cached thumbnails remove both the distance and the box
contention for the ~114 images of a first screen — most of the requests.

> **Re-open this before building the Worker.** GLB landed (#4) at ~4x smaller than STL and
> is now edge-cached, so a HIT already serves from a PoP near the visitor — most of what R2
> was for. What remains is cheaper *misses* on a 3,122-model long tail. Issue #39 decides it
> on the measurement rather than on this section's original reasoning.

**Where the models win actually comes from:** distance, and only distance (§8.1). Slow start
is 1.26 s of the 1.772 s median at a 168 ms round trip; an edge at ~20 ms turns those eight
round trips into ~0.16 s. But a model fetch mostly *misses* the edge (3,122 files, long
tail), and a miss is served from the bucket's region, which is **fixed when the bucket is
created** — automatic placement lands near the creating caller and the hint cannot be
changed afterwards. So the bucket cannot be created without choosing a location hint:
`wnam` for §1's US visitor, `weur` beside the box. Choose `wnam` — the box is already the
`weur` copy, and a miss served from Falkenstein buys nothing over what exists today.

**What it cannot show:** any improvement in model *throughput*. Models are bypassed (no
`Cache-Control`) and even cached would mostly miss — 4.89 GB across 3,122 files with a long
tail. Their TTFB will fall anyway because TLS now terminates at an edge, which is why the
probe reports TTFB net of setup and why `model_bps` is the column to read for models.

**What it costs while it runs:** Cloudflare's origin-response timeout is 125 seconds, so a
request the box would have served slowly — the deliberate posture in `deploy/demo/Caddyfile`,
where abuse degrades to waiting rather than failing, with a serialising index behind it —
becomes a 524 instead. A behaviour change for the duration, not just a measurement.

**Terms, plainly:** routing the box's images through the free CDN is the pattern §3's
Application Services terms restrict. As a time-boxed measurement the risk is small and the
destination is the sanctioned one. Step 8 is what keeps it time-boxed.

**Reverting:** grey-cloud (step 8). The nameserver move is not reverted that way — see
step 1.

## 10. Phases

0. **Done 2026-09-16** — motive, host and order settled; baseline measured; plan reviewed
   seven times and rewritten (§R).
1. **The experiment (§9) — DONE 2026-09-18.** Zone moved, proxied, rules live, spot-checked
   through the SJC edge: thumbnails at a current generation HIT in 69 ms against 507 ms
   direct, GLB in 0.365 s warm, the bundle in 0.234 s with no rule. **The before/after
   comparison is still outstanding** and waits on the 48-hour NS TTL — issue #39. The
   original gate, kept because it is what #39 checks against: **one row must satisfy both at
   once** — `batch_hit == 20` *and* `batch_total_net < 0.3` (it is ~0.68 s today). Two
   conditions met on different rows prove nothing; a partially cold edge would pass them
   separately. **The gate decides the thumbnail half only** — models are bypassed, so
   nothing here judges §1's consistency motive, and failing it stops the thumbnail work
   while the models still go to R2 on this plan.
2. **OpenSpec proposal `cdn-assets`**: delta specs for **public-deployment** (the config key
   and the additive features payload), **model-thumbnails** (an image URL may name an
   external base; the CORP loss, risk 3), and **deployment-infrastructure** (the publish and
   check scripts). Update docs/web-demo-notes.md, which still records the CDN question as
   open, and say there that this proposal supersedes it.
3. ~~**Server**: config key, additive features payload.~~ **Struck** — the edge Worker needs
   no config key and no features change (§4). One implementation detail is load-bearing: `server/test/features.test.ts`
   asserts the report with exact `toEqual` cells ("the whole report, not a subset"), and
   `config.test.ts` and `refusals.test.ts` do the same, so `assets` must be **omitted when
   unset**, not serialised as `assets: undefined`.
4. ~~**Client**: the decorator, the getter, the tests.~~ **Struck** — under an edge mapping
   the client is untouched. Replacing both 3 and 4: **the Worker** — key rewrite, R2 `get`,
   origin fallback, the Cache API question, and fail-open set deliberately on the route.
5. **Scripts and the runbook they live in**: `publish-assets.sh`, `check-assets.sh`, the
   prune, the `assets` key in CLAUDE.md's `DeploymentConfig` line, and — load-bearing —
   `deploy/demo/README.md` §6's redeploy line and §7's bake/ship section, which are the only
   steps an operator follows. A publish that exists in no runbook is a `models` base pointed
   at a prefix nobody uploaded: 404 on every model, silent origin fallback. Teach the probe
   the CDN URLs (§7). Rehearse against a throwaway bucket — **not** with `bun run dev:demo`,
   whose `MODEL_BROWSER_CONFIG` is a plain assignment in `package.json` and cannot be
   repointed. The seam already exists: `scripts/dev-remote.sh --demo` writes a modified copy
   of the demo configuration to `$XDG_RUNTIME_DIR` and points `MODEL_BROWSER_CONFIG` at it.
   Reuse that rather than adding a script. Name the hostname the rehearsal uses, too — an
   R2 `r2.dev` URL is rate-limited and uncached by design, so the rehearsal wants the real
   custom domain, which means it happens after §9 step 1. The throwaway bucket's CORS must
   allow the tailnet origin `dev-remote.sh --demo` appends, or `fetchModel` fails, falls
   back to the origin silently, and the rehearsal rehearses nothing.
6. **Publish, flip the config, redeploy — only on an explicit go-ahead.** Turn the
   experiment's `/api/thumb/image` cache rule off once R2 serves the thumbnails: two caches
   for one asset is two places a stale render can hide. The landing page is no longer a
   loose end to keep out of this: `intro: true` is committed in `deploy/demo/config.json`
   (`a364bf3 Landing page go live`), so it ships on the next deploy
   whatever else does. Nothing to hold back — just say in the commit which change is
   shipping.

## R. What seven review rounds settled, and what they cost

Seven adversarial rounds ran on 2026-09-16, all on opus-5 (fable-5 was out of credits on
every attempt, so no round got a cross-model reviewer). The technical core stopped moving at
round 4. Rounds 5–7 found mostly documentation defects, and three of them were the same
defect: **a correction landing beside the text it was meant to replace rather than
replacing it** — round 4's `<corpus id>`, round 5's prune scope, round 6's decorator
decision all survived in a second place. That is why this file was rewritten whole instead
of patched an eighth time.

Decisions that were reversed, recorded so they are not re-proposed:

| decision | proposed | reversed because |
|---|---|---|
| nested `{features, assets}` response | round 1 | a breaking change bought for nothing; additive works and decouples the phases |
| a second `withAssets` decorator | round 2 | duplicates the whole `ApiClient` interface to override two methods |
| `ConfigError` on `thumbWrites` + `assets` | round 2 | refuses startup over a harm the fallback already handles, for every deployment that omits the key |
| a bake-wide prefix instead of `gen` in the key | round 1 | contradicts "thumbnails keyed path+mtime"; an in-place replacement would serve stale pixels forever |
| percent-encoded object keys | round 3 | an R2 key is raw bytes; the edge decodes before matching |

Claims that were relayed from a review and folded in **without being checked**, each of
which became the next round's finding: who reads `readFeatures` (wrong twice), whether
rclone is on the box (still unverified — §5), the NFC/NFD "live risk" (measured: every
corpus path is already NFC), and the both-variant sidecar count. The lesson is the repo's
own: a review tells you what is broken; it is not automatically right about the repair, and
a relayed measurement is not a measurement.

## Related issues

- [#24 Move files to a cdn](https://github.com/ConfusedSky/model-browser/issues/24) — this
  plan answers it; the issue has no body. Not fixed.
- [#25 Skip the /api/thumb lookup when the listing already annotates the entry](https://github.com/ConfusedSky/model-browser/issues/25)
  — related, worth doing first: it widens the listing-vouched branch, which is exactly the
  branch that gets to use a CDN URL.
- [#4 glTF/GLB support — 5.8x smaller than STL](https://github.com/ConfusedSky/model-browser/issues/4)
  — related: attacks the same 4.89 GB from the other side, and the two compose.
- [#2 Review the demo corpus for third-party IP before publishing](https://github.com/ConfusedSky/model-browser/issues/2)
  — related, and heavier here: publishing to a bucket is a second act of redistribution,
  which is also why §5 adds `CREDITS.txt`.
