# Plan: serve the demo's thumbnails and models from a CDN (issue #24)

Status: decided 2026-09-16 (§D), revised after review the same day (§R). Phase 1 is the
pull-zone experiment; nothing else started, no repo code changed.

## D. Decisions taken 2026-09-16

- **Motive: latency and consistency.** Not cost. The box shares two vCPU with a SigLIP
  index, and when it is busy the file downloads slow with it. Consistency is the harder
  half — an edge that answers without touching the box removes the contention, not just
  the distance.
- **Host: Cloudflare R2**, on a custom domain. Its Developer Platform terms carry no
  large-file clause (§2).
- **Order: run the pull-zone experiment first** (§8), before building anything in §3.

One consequence worth naming: an R2 custom domain requires the zone to be on Cloudflare,
so the Namecheap → Cloudflare nameserver move is needed either way. The experiment does not
spend that step, it takes it early.

### Baseline, from this machine (US Pacific → Falkenstein)

Run it, do not read it here:
`.ai/probe-demo-latency.sh .ai/demo-latency-before.csv 60 60`, then summarise with the
snippet at the end of this section. The output path is an argument and the run holds a
`flock` on `<output>.lock`, because two runs writing one file interleave rows and produce a
file that looks like data and is not — which happened twice on 2026-09-16 and cost two
baselines. Do not delete the lock file while a run holds it, and **do not edit the script
while a run is using it**: bash reads a script incrementally, and a run started before an
edit keeps writing the old columns. The snippet below reports min / median / max over the
rows with `ok=1`; that file, written by the current script, is what a later claim must be
checked against.

**The probe was rewritten repeatedly through §R, and its columns changed almost every
time** — `model_bps` became transfer-only, `batch_hit`, `batch_cf` and `why` arrived later
still. Only rows written by the *current* script compare with each other. The table below
predates all of it and is kept solely as evidence that the model spread is real.

The run in flight writes `.ai/demo-latency-before.csv` and its PID is in
`.ai/demo-latency-before.pid`; the file is **partial until the run ends** (60 samples, one
per interval — the sleep runs to a deadline taken before the work, so a run only runs long
if a sample exceeds the interval). `kill "$(cat .ai/demo-latency-before.pid)"` stops it.

A first run of 8 samples (2026-09-16, ~11:53 PT, the first version of the probe, which
reused one model and divided by the wrong denominator) gave:

| column | min | median | max |
|---|---|---|---|
| `thumb_ttfb` | 0.505 | 0.513 | 0.518 |
| `batch_total` (20 renders) | 1.169 | 1.185 | 1.250 |
| `model_total` (2.5 MB) | 1.723 | 1.747 | **4.064** |
| `model_bps` | 615,117 | 1,431,350 | 1,451,317 |
| `dir_ttfb` | 0.524 | 0.538 | 0.549 |

The model column is the consistency complaint, measured: the same file, same probe, 1.72 s
and 4.06 s minutes apart. Nothing else in the table moves by more than 3%. Do not read the
throughput spread off *that* table — those rows divided by a total containing the round
trip, and a later version drew files of differing sizes, so part of any spread there was
arithmetic. The current probe fixes both (one size band, transfer-only throughput); the
spread it reports is the number to quote. That run is kept as
`.ai/demo-latency-v1-partial.csv`.

Structural facts from the same measurements, which do not vary: one round trip to
Falkenstein is ~168 ms (`*_ttfb_net`, TTFB net of connection setup — the subtracted
`time_appconnect` is DNS plus TCP plus TLS, not the TLS handshake alone); setup completes
at ~342 ms cold; 20 renders multiplexed over one HTTP/2 connection take ~1.0 s.

Confirmed live against the demo: `/api/thumb/image` answers `Cache-Control: public,
max-age=31536000, immutable` at a current generation, and **`/api/file` sends no
`Cache-Control` at all**. That single fact is why the experiment caches thumbnails for
free and models not at all.

```sh
python3 - <<'PY'
import csv, statistics as st
import collections
allrows = list(csv.DictReader(open('.ai/demo-latency-before.csv')))
rows = [r for r in allrows if r['ok'] == '1']
print('rows', len(allrows), 'ok', len(rows))
print('excluded by reason:', collections.Counter(r['why'] for r in allrows if r['ok'] != '1'))
if not rows:
    raise SystemExit('no ok rows — read the why column before reading any timing')
gate = [r for r in rows if int(r['batch_hit']) == 20 and float(r['batch_total_net']) < 0.3]
print('rows passing the phase-1 gate (batch_hit==20 and batch_total_net<0.3):', len(gate))
print('best batch_hit seen:', max((int(r['batch_hit']) for r in rows), default=0))
for c in ('thumb_ttfb','thumb_ttfb_net','batch_total','batch_total_net','model_total','model_bps','dir_ttfb'):
    v = [float(r[c]) for r in rows]
    print(f'{c:16s} min {min(v):.3f} med {st.median(v):.3f} max {max(v):.3f}')
PY
```

## R. Review findings folded in, 2026-09-16

A review of the first draft found three blockers and a list of wrong claims. What changed:

- The §8 cache rules were ordered so the bypass rule also matched `/api/thumb/image`, and
  Cloudflare's last-matching-rule-wins would have made the experiment answer "no
  improvement" whatever the truth. Fixed in §8.4.
- The probe checked no status codes, so a challenge page or a 5xx would have been recorded
  as a fast small success — and a new Cloudflare zone turns Browser Integrity Check on by
  default, which challenges bare curl. The probe was rewritten: status columns,
  `cf-cache-status`, an `ok` flag, TTFB net of the handshake, a fresh random model per
  sample, and no concurrency cap on the batch.
- §D quoted figures that were not in the CSV it cited. Rewritten to point at the file.
- The thumbnail key no longer drops the generation (§3), which was in conflict with the
  recorded "thumbnails keyed path+mtime" decision and would have made an in-place model
  replacement serve stale pixels forever.
- Corrected claims: the `<img onError>` fallback catches a *missing* object, never a wrong
  one; the client change is not one-place; `Cross-Origin-Resource-Policy: same-origin` is
  real exposure that a public bucket loses; Cloudflare Free includes the query string in
  the cache key and does not let you customise it, so the argument against query-string
  versioning was backwards.

A second review of the corrected draft found two more blockers. What changed again:

- §4 claimed the generation "is not in the sidecar" and invented a re-derivation. False:
  `ThumbCache.writeMeta` writes `gen` into `<sha>.json` and `infoFor` reads it back. The
  publisher reads it from there.
- Risk 8's rule refused `features.thumbWrites: true`, but `DEFAULT_FEATURES.thumbWrites`
  is `true` and index.ts merges over it — so a config with `assets` and no `thumbWrites`
  key would have passed the check and accepted writes. The rule now requires an explicit
  `false`.
- §3 said the bases need "no new plumbing" while the server section put `assets` outside
  `FeatureReport`; and `fetchModel` had no route to a base at all. Both answered by a
  `readAssets` getter and a `withAssets` decorator.
- The generation moved to the end of the key, so prefixes stay purgeable.
- `check-assets.sh` pinned bucket object *counts*, which a re-bake doubles. It now pins
  per-key existence and reports the prune list.
- The probe was rewritten a second time: `model_bps` is transfer-only, the models are drawn
  from one size band, the standalone thumbnail is random and excluded from the batch, the
  header file is a `mktemp` (a fixed `/tmp/probe.h` was being written by two concurrent
  runs, corrupting the `cf-cache-status` column the whole experiment rests on),
  `batch_total_net` removes the handshake, a non-`immutable` thumbnail fails the row, and
  there is no trailing sleep.
- The phase-1 gate moved onto handshake-net columns and now requires `cf_cache: HIT`;
  both of the old gate's thresholds could be met by a zone that cached nothing.
- Also corrected: the CDN is gated on the box's own cache annotations, so `rm -rf` on the
  cache makes every published object unreachable; `usable()`, not the key, is what catches
  a stale render; the bucket needs its own Cache Rule because R2 custom domains cache by
  extension; `not … eq` is not valid wirefilter; and Caddy tries TLS-ALPN-01 before
  HTTP-01, which a terminating proxy breaks.

The second review independently confirmed what the first got wrong: `renders: {ao, noao}`
is top-level in the written `BakeManifest`, and `verify` never reaches the file.

A third review found three more blockers. What changed again:

- The experiment recorded **no edge evidence at all**: `cf-cache-status` was captured only
  for the standalone thumbnail, which is drawn at random from a pool of over a thousand
  URLs and so reads MISS on a working edge. The batch now carries
  `%header{cf-cache-status}` per transfer, the new `batch_hit` column counts HITs, and the
  phase-1 gate is stated on it.
- `batch_total_net` subtracted the *first* completed transfer's handshake, but only one of
  the 20 pays it and `-Z` finishes them out of order — so the column silently equalled
  `batch_total` on an unpredictable subset of rows, an error larger than the whole gate
  margin. It now takes the maximum across all transfers.
- §3 told the publisher to percent-encode object keys. An R2 key is a raw byte string and
  the edge decodes before matching, so that would have 404'd every non-ASCII path. Keys are
  raw; only the URL builder encodes.
- A truncated transfer still reports HTTP 200 — reproduced live: `-m 1` against the demo
  gave `200`, exit 28, 81,920 of 2,500,084 bytes. That is precisely the stall being
  measured, and it read as a fast row. The gate now checks curl's exit code and the byte
  count against the listing's `size`.
- §4 assumed every sidecar names two renders. A baked store does carry both, but a
  browsing-built one mostly does not (505 sidecars with `noao` labels against 35 with both,
  on this machine), so publish and check are per variant.
- `readAssets` cannot share `featuresRef`, whose readers — `withLocalFramings`
  (client/src/api/localFramings.ts) and the `useThumbnails` sweep — take a bare
  `FeatureReport | null`; two refs, one effect.
- The publish scripts were specified for a box that has no jq, no Bun, no Node and no
  rclone. §4 now names that as a decision to take, not an assumption.
- The encoding test matrix pinned `#`, `?`, `%`, `+` — none of which occur in the corpus.
  The real class is `Ø` and katakana, i.e. multi-byte UTF-8 and NFC/NFD.
- Also corrected: `rm -rf <cache>/<id>` costs nothing until a *restart* (the annotations are
  served from an in-memory map); a wrong base puts the first screen through the heavy
  base64 tier, not one wasted request each; `allocateGen` can reissue a generation after a
  cache wipe and a backwards clock, so the publisher must refuse to overwrite; the symbol
  is `ApiClient.features`, not `getFeatures`; and the probe's period is interval plus work,
  not a flat minute.

Confirmed across reviews, not re-litigated: `renders: {ao, noao}` is top-level in the
written `BakeManifest` and `verify` never reaches the file; the key shape produces no
collision on the real corpus (zero segment-prefix pairs across 3,122 paths, and a path
cannot be both a file and a directory); and the `ok` gate does fail when it should —
falsified against a missing `immutable` header, a challenge page, and a truncated
transfer.

A fourth review found one blocker and five majors. What changed again:

- The model key named a `<corpus id>` segment that **nothing on the wire carried**: the
  config holds two base strings and the client was told to compose an id it never receives.
  The version now lives inside the `models` base URL itself, and the client only
  concatenates.
- §1's counts were described as what `check-assets.sh` pins against, contradicting §4,
  which says a total cannot work. They are sizing; the check is per key.
- The phase-1 gate stated its two conditions independently, so a partially cold edge could
  satisfy each on a different row. One row must satisfy both, and the §D snippet now counts
  exactly those rows.
- The gate was thumbnail-shaped while the motive is the model spread. It now says so:
  failing it stops the thumbnail work only.
- §8 said not to leave the experiment running and nothing discharged it — phase 6 turned
  off the cache rule but left the zone orange, which keeps every `/api/file` byte flowing
  through the free CDN. Phase 6 now grey-clouds.
- The claim that `featuresRef` is read by "`keepsFramingsLocally` and four
  App/SidePanel/entryActions call sites" was fabricated — it was relayed from a review
  without being checked. Every `readFeatures` reader lives in App.tsx. The real reason for
  a second ref is simply that `assets` is not a `FeatureReport` field.
- `createApp` takes nine positional parameters, not ten; `assets` would be the tenth.
- The probe counted only the literal `HIT`, so `REVALIDATED`/`UPDATING`/`STALE` — all
  edge-served — would have failed the gate; and the batch carried no exit code or byte
  count, so round 3's own truncated-200 argument had never been applied to the twenty
  transfers the gate rests on. Both fixed, plus a `batch_cf` histogram and a startup check
  that fails fast when curl cannot expand `%header{}`.
- Also corrected: the key-ordering argument no longer rests on purge arithmetic (single-file
  purges run at 800 URLs/second on Free, so the store purges in seconds either way); the
  encoding paragraph names `Ø`, katakana and an NFC/NFD pair instead of dangling a
  reference to five ASCII specials it no longer argues; `gen === 0` is pinned alongside
  `undefined`, since `infoFor` reads `meta.gen ?? 0`; `Caddyfile.local` cannot mirror an
  ACME issuer block and needs a recorded second divergence; and §8 now records that
  Cloudflare's 100-second origin timeout turns the box's "degrade to waiting" posture into
  524s while the experiment runs.

A fifth review found two blockers and eight majors. What changed again:

- Round 4's `<corpus id>` removal **missed the one bullet an implementer acts on**:
  `fetchModel` still said `GET <base>/<corpus id>/<path>`, which would 404 every model and
  fall back to the origin forever without a visible error. Fixed, and the stray sentence
  two paragraphs up with it.
- **Two probe runs were writing the baseline CSV at once**, having survived a `kill` that
  read a stale PID file, and the file held NUL bytes, out-of-order rows and rows of the
  wrong width — the summary snippet reported a `model_total` median of 1,179,694 before
  dying on a path. Both were killed, the file was discarded, and the probe now takes its
  output path as an argument and holds a `flock` on it; a second run refuses to start
  (falsified).
- `batch_hit` counted `REVALIDATED`, which is served only *after* a blocking origin
  revalidation — the exact round trip the experiment removes — so twenty 304s could have
  passed the gate with the box contacted twenty times. It now counts HIT, STALE and
  UPDATING; REVALIDATED still shows in `batch_cf`.
- Every failure a CDN introduces (a 524 at Cloudflare's 100-second origin timeout, a
  truncation) lands in `ok=0`, and those rows left every average — so a CDN that converts
  slow answers into failures would have read as pure improvement. Rows now carry a `why`
  column, and §D's snippet prints the excluded count and reasons first.
- `check-assets.sh`'s prune list was unscoped: no sidecar names a model, so it would have
  proposed deleting the entire 4.6 GB models prefix. Scoped to the thumbnails base.
- Risk 7 blamed re-bakes for the free-tier cliff. A re-bake orphans 33.3 MB; a `models`
  base bump is 4.6 GB, so the second bump exceeds the 10 GB free tier. Deleting the retired
  prefix is now part of the bump.
- "Rolling back is republishing, not reverting a config string" became false for models the
  moment the version moved into the base: reverting that string *is* the models rollback.
  Split per half.
- §8.7 still told the operator to read `cf_cache` per row — the mistake §7's gate was
  rewritten to forbid, since the standalone thumbnail is *meant* to read MISS.
- §8.5's issuer pin is a tracked-file edit plus a redeploy, which phase 1 is not allowed to
  be. It now says so and falls under the phase-6 go-ahead.
- Corrections: 105 sidecars carry both renders, not 35; `readFeatures`' readers are
  `withLocalFramings` and the `useThumbnails` sweep (the round-4 note "every reader lives in
  App.tsx" was itself wrong, relayed a second time without checking);
  `thumbnailQueue.test.tsx` is `.tsx` and `folderSheets.test.tsx` calls the real builder in
  eight assertions; whether rclone is on the box was relayed, not verified, and is now
  marked as such; the key-ordering argument no longer rests on purge arithmetic; and the
  `%header{}` startup check no longer blames curl for an unreachable host (falsified).

**Status after five rounds: not yet "safe as written".** The review cap agreed with Masa is
spent. What remains open is listed as such above — §3's open decisions (the box's
toolchain, `/api/features`'s breaking shape) and §4's unverified rclone availability are
proposal-time questions, not implementation surprises, but they have not had a review pass
of their own.

A sixth review found three blockers and eight majors. What changed again:

- **Round 5's prune fix landed beside the old text instead of replacing it**, so the
  sentence still ended "report anything in the bucket no sidecar names" — rebuilding the
  unscoped sweep that proposes deleting all 4.6 GB. Same failure as round 4's missed
  `<corpus id>` bullet: a correction added, the wrong version left standing.
- **§6 had no instrument for what it verifies.** The probe builds only origin-shaped URLs
  and its startup check demands `/api/features`, so pointing `HOST` at a bucket refuses to
  start and leaving it alone measures the untouched origin. Teaching it the CDN URLs is now
  a phase-5 task, before any flip.
- Phases 3 and 4 were not independently landable: a nested `{features, assets}` response
  would leave `main` between them reporting every capability `undefined`. **The wire shape
  is now additive** — `FeatureReport & { assets?: AssetBases }` — which breaks nothing and
  was the right shape anyway; the nested form had been asserted with no argument behind it.
- Publishing had no stated ordering, and `deploy/demo/README.md` §7 prescribes the opposite: ship
  sidecars, restart, *then* the CDN URLs exist. Publish first, then ship, then restart.
- Nothing in the phase list touched `deploy/demo/README.md`, the only steps an operator
  follows, or CLAUDE.md's `DeploymentConfig` line. Both are phase 5 now.
- `bun run dev:demo` cannot rehearse this: its `MODEL_BROWSER_CONFIG` is a plain assignment
  in `package.json`, so a scratch config cannot be pointed at.
- The publisher cannot read a hit verdict from a sidecar — none is stored. `statusFor`
  (server/src/cache.ts) derives it by comparing the variant's `mtime` against the model
  file's.
- `withAssets` as a second decorator would duplicate all 19 of `LocalFramingClient`'s
  explicit delegates to override two, and raise a composition-order question. One more
  parameter on `withLocalFramings` instead.
- Risk 8's hard `ConfigError` refused startup over a harm §3 calls benign — and since
  `thumbWrites` defaults true, it would have refused **every** deployment that set `assets`
  without writing `thumbWrites: false`. Downgraded to a startup warning.
- The version-in-prefix design had never been weighed against alternatives. Both are now
  recorded with the reason each lost, and the short-Edge-TTL option is named as the one to
  take if the 10 GB free tier binds.
- Probe: `asorti` is a gawk extension, so `batch_cf` would have died under mawk; the EXIT
  trap unlinked a lock file the process still held; `model_path` and `why` were unquoted in
  CSV. All fixed and re-run.
- Corrections: every non-ASCII corpus path is already NFC, so the NFD case is synthetic and
  is now labelled so — the "live risk" claim was relayed, not measured; the example path
  said `Mini_Warehouse` where the directory is `Mini_Warehouse_6185614`; and the "net"
  columns subtract `time_appconnect`, which is DNS + TCP + TLS, not the TLS handshake, as
  the header comment and §D both claimed.

A seventh review found two blockers and seven majors, and was asked to sweep the whole
document for the failure this process kept repeating: a correction landing *beside* the
text it should have replaced. It found three more instances. What changed:

- §6's config-parse test list still specified the `ConfigError` round 6 had downgraded —
  the risk said "warns", the test said "refused".
- §3 and phase 4 still described "a base parameter across the interface", the design round 6
  replaced with a decorator override. **No `ApiClient` signature moves**, so the test stubs
  are untouched; both places now say so.
- §4 said `publish-assets.sh` runs "on the box after a bake", which is exactly the ordering
  the same section forbids two paragraphs earlier. It runs from this machine between the
  bake and `--ship`, and `deploy/demo/README.md` §7's `--ship` cannot be used unsplit
  because it rsyncs and restarts in one step.
- Risk 2 named `check-assets.sh` as what catches a wrong models include filter, while §4
  forbids that sweep from enumerating the models base at all. It gets an assert-only
  models-side pass.
- "`check-assets.sh` refuses a publish into a prefix the bucket already holds" contradicted
  that script's job and would block resuming an interrupted 4.6 GB upload. The refusal is
  the publisher's, and it is about a key whose bytes differ.
- §8 never discharged the orange cloud between phase 1 and phase 6 — weeks of terms
  exposure and 524s for a measurement. Grey-cloud as soon as the gate is read.
- **The in-flight baseline was started before the round-6 probe edits and kept writing the
  old columns** — §R's "fixed and re-run" was false for the file §D calls the baseline.
  Discarded and restarted. The lesson is recorded in §D: never edit the script while a run
  is using it, since bash reads a script incrementally.
- Corrections: the corpus has seven non-ASCII paths (six `Ø`, one katakana directory), not
  "six and seven"; `LocalFramingClient` already carries real logic in `getThumb`/`putThumb`
  and the delegate count is not worth pinning; an R2 lifecycle rule on *age* would expire
  live thumbnail keys, so it is no longer offered as an alternative to the prune; risk 7's
  free-tier arithmetic now uses decimal GB (4.89 GB per corpus copy, ~9.86 GB against 10),
  where GiB had flattered the margin; §3's "under a version segment" contradicted "the
  generation goes after the path"; §D overstated what its own table covers and undercounted
  the probe rewrites; and the probe now sets `LC_ALL=C`, since a comma-decimal locale would
  have made every `sub()` a malformed awk program.

**Where this stands: seven review rounds, and the verdict is still not "safe as written".**
Rounds 5, 6 and 7 each found a fix from the previous round sitting beside the text it was
meant to replace — the process's own characteristic failure, and the reason a final
end-to-end read by someone new is worth more than another round of the same.

## 0. Motive — cost is not one

The CX23 already includes **20 TB/month of traffic** at €5.49/mo
(hetzner.com/cloud/regular-performance, fetched 2026-09-16). 500 GB of egress is 2.5% of
that. The motive is §D's: latency, and the box's own contention showing up in download
times.

## 1. What moves, and what does not

| asset | count | size | today |
|---|---|---|---|
| thumbnails (WebP, both occlusion variants) | 6,244 | 33.3 MB | `/api/thumb/image`, baked 2026-09-15 |
| models (STL) | 3,122 | 4.6 GB | `/api/file`, streamed from `/library` |

Re-run the two counts rather than trusting them. They are corpus **sizing** — what to
budget for storage and upload — and not a pin: `check-assets.sh` asserts per-key existence,
never a total (§4). The 6,244 is two renders for each of 3,122 models because the demo bake
deliberately produces both occlusion variants; a store built by browsing is mostly
one-sided, which is why the publisher must not assume the pair.

```sh
find "$CORPUS_DIR/miniatures/decimated" -type f -name '*.stl' | wc -l   # models
du -sh "$CORPUS_DIR/miniatures/decimated"
ls "$CACHE_DIR/<library id>"/*.webp | wc -l                            # renders
du -sh --exclude=bake --exclude=snapshots "$CACHE_DIR/<library id>"
```

Not moving: every `/api/*` answer (listings, search, credits, features), the client bundle
(already hash-named and served `immutable` by the app), and zip entries — `/api/file`
extracts those in memory per request and the demo corpus contains none, so they keep the
origin path unconditionally.

## 2. Host

Prices verified 2026-09-16 against vendor pages.

| option | 10 GB egress/mo | 500 GB egress/mo | storage 5 GB | failure mode |
|---|---|---|---|---|
| **Cloudflare R2 + custom domain** | $0 | $0 | $0 (10 GB free) | bills, no cap; free tier discretionary |
| Bunny Storage + Pull Zone | $1.00 (minimum) | ~$5.10 | ~$0.05 | prepaid — account pauses at €0 |
| Cloudflare CDN over the existing origin | $0 | $0 | — | Application Services terms restrict serving "a disproportionate percentage of pictures … or other large files" |
| Backblaze B2 + Cloudflare | $0 | $0 | $0.03 | same terms restriction; B2 custom domain needs sales approval |
| CloudFront + S3 | ~$0.25 | ~$0.25 | $0.12 | no hard cap; a spike past the 1 TB free tier is $0.085/GB |
| Hetzner Object Storage | €6.49 | €6.49 | included | ruled out: no custom domains, and their FAQ says it is not a CDN |
| Pages / Netlify / Vercel / jsDelivr / HF | — | — | — | ruled out: 25 MiB per-file cap (Pages), or AUP language naming hotlinked media hosting as abuse |

The terms detail that picked the winner: Cloudflare's **Developer Platform** terms (which
govern R2, dated 2026-06-02) carry **no** large-file or non-HTML clause, while the
**Application Services** terms (which govern the CDN) do.

## 3. Architecture: version-in-the-key, config-driven, origin fallback

Object keys mirror the library path, with a version segment **after** it for thumbnails
(the generation, which the client already holds) and **inside the base URL** for models:

    <thumbnails base>/<library path>/<gen>.webp        occluded render
    <thumbnails base>/<library path>/<gen>.noao.webp   unoccluded render
    <models base>/<library path>                       model bytes

Both bases are **whole URL prefixes carried in the configuration**, and a version lives
inside them: `"models": "https://assets.example/m/2026-09-16"`. There is no separate
corpus-id field on the wire and the client never composes one — it concatenates a base and
a path, nothing else. Bumping the corpus is editing that one string, which is why the
models side is a config change and a redeploy where the thumbnails side is not.

The generation goes **after** the path, not in front of it: a per-entry millisecond stamp
at the top would give no two entries a shared prefix, so the prune could never scope
itself to a path and would have to enumerate the bucket. (Do not rest this on purge speed:
single-file purges on Free run at 800 URLs a second, so the store purges in seconds either
way.)

**Thumbnails carry the generation**, which the listing annotation already supplies and
which the origin's own image URL already names. So the object key and the origin URL
identify the same render, `immutable` is honest, a re-render writes a new key, and no
config bump is coupled to a publish. This is the shape the recorded "thumbnails keyed
path+mtime" decision asks for.

**Models are versioned by their base URL**, which the operator bumps when the corpus is
rsynced. Two simpler options were weighed and lost, but only just, and the second is worth
revisiting if risk 7 bites:

- *An unversioned models prefix, corrected by purge.* Cheapest in storage — no retired
  prefix, no free-tier cliff — and purge by prefix is available on Free (risk 9). Rejected
  because it makes every model correction a manual purge whose omission is invisible: the
  stale bytes are served `immutable` for a year and nothing in the client can tell.
- *A short Edge TTL for models instead of `immutable`.* `/api/file` sends no
  `Cache-Control` at all today, so even an hour would be an improvement, and staleness
  self-heals. Rejected because it gives up the thing the CDN is for on the half that
  carries the bytes — but if the 10 GB free tier turns out to be the binding constraint,
  this is the option to take, not a paid plan.

The version segment is not an mtime: `DirEntry.mtime` is a float on the wire (`1789446597239.1736`), and a key built from
one would depend on Python and JavaScript formatting the same float identically. The version is a string the operator puts in the base URL, and models change only when the
operator replaces them.

Consequences, and they differ per half. **Thumbnails**: a re-bake writes new keys and
leaves the old ones, so the bucket needs a prune (a sweep in `publish-assets.sh` that deletes keys no sidecar names — **not** an R2 lifecycle rule on
age, which would expire live keys, since a current generation's object is never rewritten),
and rolling back means
republishing, since no config string points at a generation. **Models**: reverting the
`models` base to the previous version prefix *is* the rollback — that is why the version
lives in the base — so keep one retired prefix until the new one is verified, then delete
it (risk 7).

**Encoding belongs to the URL alone, never to the key.** An R2 object key is a raw byte
string: the publisher writes `Mini_Warehouse_6185614/Oildrum_Lid_Ø50.stl/<gen>.webp` with
the bytes
as they are on disk, and only the *client* percent-encodes, per segment, joined with real
`/`, leading slash dropped. A publisher that stores the encoded form serves nothing: the
edge decodes the request path before matching, so `…%C3%98…` looks for the raw name and
404s. Note this is a **second URL shape** inside one builder — today `thumbImageUrl` puts
the whole path in a *query parameter*, where `encodeURIComponent` escapes the slashes too.

The characters that actually matter are not the ASCII specials: a scan of all 3,122 corpus
paths finds **seven** non-ASCII paths in total: six carrying `Ø`, and one katakana
directory (`Pompompurin_ポムポムプリン_4649260`). Nothing else falls outside
`[A-Za-z0-9/._-]`.
Every one of those is already NFC on disk — re-run it rather than trusting the line:

```sh
find "$CORPUS_DIR/miniatures/decimated" -name '*.stl' \
  | python3 -c "import sys,unicodedata as u; print(sum(u.normalize('NFC',l)!=l for l in sys.stdin))"
```

So the falsification bucket carries two real cases — `/Mini_Warehouse_6185614/Oildrum_Lid_Ø50.stl`
and a katakana path — plus one **deliberately synthetic** NFD name, kept because a corpus
imported from HFS+ would arrive decomposed even though this one did not.

### Server

- New optional top-level key in `DeploymentConfig` (shared/types.ts):
  `"assets": { "thumbnails": "https://…", "models": "https://…" }`. Both optional strings;
  validate absolute `https:` URL, no trailing slash. Add `"assets"` to `TOP_LEVEL_KEYS` in
  server/src/config.ts with its own `rejectUnknown` key list. It sits at the top level,
  **not** under `features`: `FEATURE_KEYS` derives from `DEFAULT_FEATURES` and must stay
  boolean-only, and `config.features` is typed `Partial<FeatureReport>`, so an `assets`
  field inside `FeatureReport` would be type-legal in a place the parser refuses at
  runtime.
- The wire shape is **additive, not nested**: `/api/features` answers
  `FeatureReport & { assets?: AssetBases }`. Nothing breaks — today's client reads the
  capability booleans exactly as it does now and ignores the extra key — and nothing about
  the parser changes either, because `assets` stays a *top-level config* key and
  `FEATURE_KEYS` still derives from `DEFAULT_FEATURES`, which is a plain `FeatureReport`.
  A nested `{features, assets}` was considered and rejected: it is a breaking response
  change bought for nothing, and it would force the server and client phases to land
  together. `createApp` — nine positional parameters today, `cache` through `origins` —
  gains a tenth — "nothing else on the server changes" is not true.
- `guard()` still covers `/api/*` only and still emits no CORS headers; `/api/thumb`,
  `/api/thumb/image` and `/api/file` are unchanged and remain both the fallback and the
  whole local/dev posture (no `assets` key).

### Client — bigger than one file

`thumbImageUrl` is a pure builder in client/src/api/thumbUrl.ts, and also a method on the
`ApiClient` interface, on `HttpApiClient`, delegated through `withLocalFramings`, and
stubbed in `client/test/appHarness.tsx` and `client/test/thumbnailQueue.test.tsx` (with
`client/test/folderSheets.test.tsx` calling the real builder). **No `ApiClient` signature
moves.** The decorator composes the CDN URL itself and the pure builder keeps its current
five-argument shape, so every stub and every caller stays as it is — which is the point of
doing this in the decorator rather than in the interface.

The base cannot arrive through the `ApiClient` constructor: the client is memoised at
mount and feature-report D6 forbids rebuilding it when the report resolves. The shape that
fits is the one already in the tree — `withLocalFramings` decorates a client and reads a
report through a stable getter. Add a **second ref and getter** `readAssets` — not a second reader over `featuresRef`,
which is `useRef<FeatureReport | null>` and whose every reader takes a bare
`FeatureReport | null`, so it cannot carry a `{features, assets}` shape without changing
all of them; the one features effect writes both refs — and a **fifth parameter on `withLocalFramings`** rather than a second decorator.
`LocalFramingClient` delegates every `ApiClient` method explicitly, on purpose, so that a
new method fails to compile, and already carries real logic in `getThumb` and `putThumb`; a
`withAssets` wrapper would duplicate the whole interface to override two
and would raise a composition-order question with no good answer. Overriding
`thumbImageUrl` and `fetchModel` in the class that already holds a report getter costs one
parameter. That is what answers both call
sites: `HttpApiClient` is constructed with no getter and must not gain one, and
`useThumbnails` calls `api.thumbImageUrl`, so the decorator reaches the vouched branch
without touching the hook's signature at all. `thumbImageUrl`'s `gen` is optional and a
key cannot be built without one: with `gen` undefined the decorator returns the origin URL
unchanged, pinned by a test. Pin `gen === 0` the same way — `infoFor` reads `meta.gen ?? 0`,
so zero is the degenerate value that can actually arrive, and it would otherwise key
`…/0.webp`. It is new plumbing — one ref, one getter and one parameter on the decorator that already
exists — not none, and the earlier draft claiming otherwise contradicted its own server
section.

**The race, and why it is left alone.** The features effect fires at mount; the sweep runs
after a listing resolves; the sweep's dependency array holds only the getter's stable
identity, so a report landing later does not re-run it. A first screen drawn before the
report resolves would therefore use origin URLs. Accepted, because the failure is benign
(the tiles are correct, merely served from the box) and because the ordering is heavily in
our favour: the features answer is a few hundred bytes issued at mount, the listing it
races is orders of magnitude larger and the sweep only starts once that lands. Neither
alternative earns its cost — injecting the bases into the served HTML loses the
"configuration is a commit" shape, and re-running the sweep pays a second pass over every
first screen to win a race that is already won. Pin the *benign fallback* in a test, not
the race: a tile whose draw sees a null report must render from the origin URL and must not
throw.

**The CDN does not decouple from the box's own cache.** A CDN URL is used only where the
listing annotation reads `hit`, and that annotation is the *box's* thumbnail store. The
annotation is served from `ThumbCache.facts`, an in-memory map seeded by `maintain`'s
startup pass, so the documented `rm -rf <cache>/<id>` costs nothing *until the server
restarts* — after that the annotations are gone, every object is still in the bucket, no
visitor reaches one, and every tile re-renders locally. (`maintain`'s cap eviction is not
this case: it clears a variant's labels without bumping the generation, so it moves the
staleness state rather than the key.) So a republish implies a re-bake, and losing
the box's cache loses the CDN's usefulness with it.

Other client points:

- Use the CDN URL only where the listing already vouches for the render: variant
  `state: 'hit'` and `usable(...)` passes. Everything else keeps today's path.
- The existing `<img onError>` → `onImageError` → JSON-lookup path recovers a **missing**
  object at one wasted request. It does **not** recover a *wrong* one: wrong pixels are a
  200 that decodes, no error event fires, and there is no client-side detection at all.
  What actually keeps a stale render from being drawn is `usable()` failing on the labels a
  write clears, not the key — a write to one occlusion variant bumps the shared generation
  and clears the sibling's recipe labels while leaving the sibling's pixels alone, so at
  the new generation those bytes are the old render and only the label check catches it.
- `HttpApiClient.fetchModel`: with a models base, `GET <base>/<library path>`; on a
  non-ok status or a network error, retry `/api/file?path=…` (the base already carries
  whatever version segment the operator put in it). Paths containing `!` (zip
  entries) always go to the origin. This is a `fetch()`, so the bucket must send
  `Access-Control-Allow-Origin: https://models.masamaeda.com`; thumbnails need no CORS
  because a plain `<img>` load is not CORS-governed.

## 4. Publishing

**Hard ordering, and it is the reverse of what the runbook does today.** `deploy/demo/README.md` §7
rsyncs sidecars to the box and restarts the app; the moment it restarts, the listing
annotates the new generations and every CDN URL 404s until the upload finishes — which
routes all 6,244 tiles through `getThumb`'s base64 tier for the whole window (risk 5).
Publish to the bucket **first**, then ship the sidecars, then restart.

New `deploy/demo/publish-assets.sh`. It runs **from this machine against the bake's own
cache, between the bake and `--ship`** — not on the box after shipping, which is the
ordering the paragraph above forbids. `deploy/demo/README.md` §7's `--ship` does the rsync
and the restart as one step, so it cannot be used unsplit: rsync, publish, then restart.
rclone against R2's S3 endpoint.

**Name the toolchain first.** `deploy/demo/check-bake.sh` records that the box has no jq,
no Bun and no Node, which is why every existing check there is line-oriented `grep`/`sed`.
Whether rclone is installed is unchecked — confirm on the box rather than assuming. Walking thousands of JSON sidecars is not a shell job, so
either add an interpreter and rclone to the box's provisioning in `deploy/demo/README.md` §1, or run
the publish from this machine against a `rsync`'d copy of the cache. Decide in the proposal
— the scripts below are unrunnable on the box as it stands.

- **Thumbnails.** Walk `<cache>/<library id>/*.json`; each sidecar carries the **library**
  path *and* the generation — `{"path":"/Kit/x.stl","gen":1789519399619,…}`, written by
  `ThumbCache.writeMeta` and read back by `infoFor`, which is the same number the listing
  annotation hands the client. Upload `<sha>.webp` → `<path>/<gen>.webp` and
  `<sha>.noao.webp` → `<path>/<gen>.noao.webp` — **per variant, only where that variant is
  a hit**. No sidecar stores that verdict: `statusFor` (server/src/cache.ts) derives it by
  comparing the variant's stored `mtime` against the model file's, so the publisher stats
  each model and compares. The recipe labels (`rig`, `lighting`, `posed`, `poseKey`) are
  `usable()`'s business at draw time, not the publisher's. The demo's *baked* store does carry both variants for every model (6,244 for
  3,122), but a store is not always baked: on this machine's browsing-built store all 505
  sidecars carry `noao` labels while 105 carry both renders. That asymmetry is why
  `BakeManifest` counts `renders.ao` and `renders.noao` separately, and why the publisher
  reads each variant's state rather than assuming a pair. Skip `bake/` and `snapshots/`, and publish
  neither the sidecars nor `bake.json`.
- **Models.** `rclone sync` under the version prefix the `models` base names, with an
  include filter mirroring
  `modelFormat`'s allowlist. Load-bearing: `/api/file` enforces "model formats only,
  everything else answered as missing" per request, and publishing moves that rule to
  publish time. A `notes.txt` or a runbook rsynced into the corpus must not be published.
- **Headers at upload:** `Cache-Control: public, max-age=31536000, immutable`;
  `Content-Type: image/webp` / `application/octet-stream`;
  `X-Content-Type-Options: nosniff`. Bucket directory listing off.
- **The bucket needs its own Cache Rule**, for the reason §8.4 records for the origin: an
  R2 custom domain caches by file extension by default, and `.stl` is not in that set. Set
  the models prefix eligible for cache explicitly, or the CDN in front of R2 caches nothing
  and every model download is a bucket read.
- **CC-BY attribution.** Publish a `CREDITS.txt` generated from the override store at each
  prefix root. Attribution currently exists only inside the app.
- **`deploy/demo/check-assets.sh`**, the pin: **per-key existence at the current
  generation**, not a total. A total cannot work: `allocateGen` stamps each entry in
  milliseconds, so a re-bake writes a fully disjoint key set and the bucket holds 2x the
  manifest's count after one re-bake and 3x after two. Walk the sidecars, assert that the
  object for **each hit variant** is present (never assuming both), and report anything
  **under the thumbnails base** that no sidecar names — that list is the prune's input. The
  sweep must never reach the models base: no sidecar names a model, so an unscoped sweep
  proposes deleting all 4.6 GB. `bake.json`'s `renders.ao` / `renders.noao` (top-level
  keys in `BakeManifest`, the written shape; `verify` is on `ManifestInput` only and never
  reaches the file) stay useful as the *expected* sidecar count, not as a bucket count.
- **The version segment** is the operator's string inside the `models` base — no
  derivation from `bake.json`'s optional `client.commit` or its `dirty` flag, which would
  need rules for an absent commit and a dirty tree. `publish-assets.sh` refuses to overwrite an
  existing key whose bytes differ (risk 9); it does **not** refuse a populated prefix,
  which would block resuming an interrupted 4.6 GB upload. `check-assets.sh` asserts after
  a publish, so it finds the prefix populated by definition.

## 5. Risks

1. **A wrong object is undetectable client-side** (§3). Carrying `gen` in the thumbnail key
   is the whole mitigation; nothing catches it if the publisher gets a key wrong.
2. **The allowlist moves from per-request to publish time.** A wrong include filter
   publishes a file `/api/file` would refuse. `check-assets.sh` catches it with a
   **models-side pass of its own** — driven by the corpus file list and `modelFormat`'s
   allowlist, assert-only, never proposing a deletion — since its thumbnail sweep is
   forbidden from enumerating the models base (§4).
3. **`Cross-Origin-Resource-Policy: same-origin` is lost** for thumbnails. The origin sets
   it deliberately, so that a guessed URL is not an existence oracle through
   `onload`/`onerror`. A public bucket object has no such header: any third-party page can
   then probe library-path existence and hotlink every render. Accepted cost — record it in
   the proposal, do not let it pass silently.
4. **Model bytes are not new exposure**: `/api/file` already serves them publicly. Risk 3
   applies to thumbnails only.
5. **A wrong base costs more than one wasted request per tile.** Every tile 404s at the
   CDN and then falls back to `getThumb`, whose answer carries the render base64-inlined —
   the heavy tier `/api/thumb/image` exists to avoid. A wrong base therefore puts a whole
   first screen through the expensive path. It does not loop (`getThumb` never calls
   `thumbImageUrl`), so it is safe, only costly. Falsify the fallback first.
6. **Vendor cliff.** R2's free tier bills past its limits with no cap. Set a budget alert.
7. **The free tier is spent by model *versions*, not by re-bakes.** A re-bake orphans
   33.3 MB of thumbnail keys, which the prune handles. A `models` base bump is the corpus
   again — 4,894,873,256 bytes, i.e. **4.89 GB decimal**, which is what a bucket bills in —
   and `rclone sync` under a new prefix never touches the old one: two prefixes plus both
   thumbnail generations is ~9.86 GB against a 10 GB free tier, a margin thinner than one
   re-bake's orphans. **Deleting the retired prefix is a step of the
   bump**, once the new one is verified — not a later cleanup.
8. **`thumbWrites` with `assets` warns at startup; it does not refuse.** A deployment that
   accepts visitor writes produces renders the bucket does not carry — but that is a
   *missing object*, which §3's `onImageError` path already recovers with correct pixels at
   one extra request. A `ConfigError` would be a hard startup failure for a benign harm,
   and since `DEFAULT_FEATURES.thumbWrites` is `true` and index.ts merges
   `{...DEFAULT_FEATURES, ...config.features}`, it would refuse to start **every**
   deployment that sets `assets` without explicitly writing `thumbWrites: false`. So: one
   warning line naming both keys when `thumbWrites` resolves true and `assets.thumbnails`
   is set. The demo sets `false` explicitly and never sees it.
9. **A wrong object under a correct generation is a year-long error.** It is published
   `immutable` and the client has no way to see it (risk 1). Recovery is: fix the object,
   then purge. Cloudflare's purge by **prefix** is available on the Free plan (up to 100
   operations per request, 5 requests per minute — developers.cloudflare.com/cache/how-to/
   purge-cache/), so a bad publish is recoverable at the edge without Purge Everything.
   That lever is the reason `check-assets.sh` runs *before* the config points at a new
   prefix, not after. One way a wrong object arises with no publisher mistake at all:
   `allocateGen` is `max(Date.now(), lastGen + 1, prev + 1)` with `lastGen` module-level and
   reset per process, so after an `rm -rf <cache>/<id>` there is no `prev` floor and a
   backwards clock step can reissue a generation the bucket already holds — under
   `immutable`. The publisher must refuse to overwrite an existing key with different
   bytes. Two caveats the docs attach: a URL's query string cannot be purged
   by prefix, and an R2 custom domain caches by file extension by default — so §4's models
   Cache Rule is what makes the model objects cacheable and therefore purgeable at all.

## 6. Verification

- Baseline first, per §D, with the current probe. That is the number the change must beat.
- Config parse tests: `assets` accepted, unknown sub-key refused, non-https refused, absent
  key means today's behaviour, `assets.thumbnails` with an explicit
  `features.thumbWrites: false` accepted **silently**, and `assets.thumbnails` with
  `thumbWrites` set `true` **or absent** accepted **with one warning line naming both
  keys** (risk 8 — absence is the case that matters, since the default is `true`; this is
  a warning, not a refusal).
- Client tests: the builder with and without a base; `fetchModel`'s fallback on 404 and on
  a network error; zip paths never leaving the origin; a path containing `#`, `?`, `%`, `+`
  and a space round-tripping to the right key (synthetic, deliberately — no corpus path
  contains any of them), plus the cases §3 names: `Ø` and katakana from the real corpus,
  and a synthetic NFD name; a tile drawn while the feature report is
  still null rendering from the origin URL without throwing (§3's race).
- **Falsify two cases, do not assume either**: a *missing* object (the tile must still draw
  through `onImageError`) and a *stale* one (an object published under a generation the
  listing no longer names must never be reached).
- After the flip: re-measure per §D — but **the probe cannot measure the §3 destination as
  written**, and fixing that is a phase-5 task, not an afterthought. It builds only
  origin-shaped URLs (`$HOST/api/thumb/image?path=…&gen=…`, `$HOST/api/file?path=…`) and
  its startup check demands `$HOST/api/features`, so pointing `HOST` at a bucket refuses to
  start and leaving it alone measures the untouched origin. Teach it to read `assets` from
  `/api/features` and build `<base>/<path>/<gen>.webp` and `<base>/<path>`, keeping the
  origin columns beside them so one row compares both.
- Confirm `cf-cache-status: HIT` and the `immutable` header on a CDN response.
- Confirm the box's egress dropped, against a named instrument: the Hetzner cloud console's
  traffic figure for the server, or `vnstat -m` on the box. Record the before number at
  phase 1 or there is nothing to compare.

## 7. Phases

0. **Done 2026-09-16** — motive, host and order settled (§D); baseline measured; plan
   reviewed and corrected (§R).
1. **The pull-zone experiment (§8).** Gate, stated so it can fail, and stated on the
   handshake-net columns because an edge terminating TLS moves the raw ones by itself:
   **one row must satisfy both at once** — `batch_hit == 20` *and* `batch_total_net < 0.3`
   (`batch_hit` counts only HIT, STALE and UPDATING: REVALIDATED means the edge asked the
   origin before answering, which is the round trip being removed)
   (it is ~0.68 s today). Two conditions met on different rows prove nothing: a partially
   cold edge would pass them separately. Read `batch_hit`, not `thumb_cf`: the standalone
   thumbnail is drawn at random from a pool of over a thousand and is *meant* to be a cold
   object, so it reads MISS on a perfectly working edge. Ignore the first samples after a
   rule change; the edge is per-PoP and starts cold.

   **The gate decides the thumbnail half only.** The models are bypassed, so nothing here
   can pass or fail judgement on §D's motive — the model throughput spread. Failing it
   stops the thumbnail work; the models still go to R2 on the §3 plan either way, since
   that is the only thing that addresses them.
2. OpenSpec proposal `cdn-assets`: delta specs for **public-deployment** (the config key and
   the features payload), **model-thumbnails** (an image URL may name an external base, and
   the CORP loss), and **deployment-infrastructure** (the publish and check scripts).
   Update
   docs/web-demo-notes.md, which still records the CDN question as open, and say there that
   this proposal supersedes it.
3. Server: config key, additive features payload, tests. Landable alone **because** the
   payload is additive (§3): a client that has not been taught about `assets` reads the
   capability booleans exactly as before. A nested `{features, assets}` would have made
   `main` between phases 3 and 4 report every capability `undefined` — `intro` off,
   framings not kept — which is why that shape was dropped.
4. Client: the `withLocalFramings` parameter and its two overrides (`thumbImageUrl`,
   `fetchModel`), the `readAssets` ref and getter, and the falsified tests. No `ApiClient`
   signature changes, so the existing stubs are untouched.
5. `publish-assets.sh` + `check-assets.sh` + the prune, **and the runbook edits that make
   them real**: `deploy/demo/README.md` §6's redeploy line and §7's bake/ship section are
   the only steps an operator follows, so a publish that exists in no runbook is a `models`
   base pointed at a prefix nobody uploaded — 404 on every model, silent origin fallback.
   Add the `assets` key to CLAUDE.md's `DeploymentConfig` line in the same phase. Teach the
   probe the CDN URLs (§6). Rehearse against a throwaway bucket — **not** with
   `bun run dev:demo`, whose `MODEL_BROWSER_CONFIG` is a plain assignment in `package.json`
   and so cannot be pointed elsewhere; add a `dev:cdn` script, or make that line
   `${MODEL_BROWSER_CONFIG:-…}`.
6. Publish, flip the config, redeploy — **only on an explicit go-ahead**. `deploy/demo/
   config.json` currently has an *uncommitted* `intro: false → true` in the tree, and a
   deploy is push-then-pull: say in the commit which change is shipping, and do not let the
   withheld landing page ride along with the CDN flip. Verify per §6.
   Then **end the experiment**, which §8 says not to leave running: turn the
   `/api/thumb/image` cache rule off (two caches for one asset is two places a stale render
   can hide) **and grey-cloud the records**, so the origin's own bytes stop flowing through
   the free CDN. Only the R2 custom domain stays proxied — that is the hostname the
   Developer Platform terms cover, and leaving the app's hostname orange would keep exactly
   the exposure §2 chose R2 to avoid.

## 8. Phase 1 — the pull-zone experiment

Orange-cloud the existing hostname. **No second hostname, no origin rename**: Cloudflare
proxies `models.masamaeda.com` straight to the box's address and connects back with the
`Host` header unchanged, so the app's guard, `config.json`'s `origins` and Caddy's site
block all keep working untouched.

1. **Add the zone at Cloudflare** and move the nameservers at Namecheap. Masa's step — it
   needs the registrar login. Record the existing Namecheap records first: the revert is
   moving the nameservers back and re-creating them, and grey-clouding does not undo it.
   Wait for the zone to read Active.
2. **Turn off what a new zone turns on by default**: Browser Integrity Check (it challenges
   bare curl, which is what the probe is) and Email Obfuscation.
3. **SSL/TLS mode: Full (strict).** Caddy keeps its own Let's Encrypt certificate and
   Cloudflare validates it. Anything less lets the edge talk plaintext to the box. Note the
   coupling this creates: under Full (strict) an expired origin certificate is a 526 for
   every visitor, where today it would be a browser warning.
4. **Cache Rules — order matters.** Cloudflare's rules stack and the *last matching* rule
   wins for conflicting settings, so the bypass rule must not also match the image path:
   - Rule 1: `http.request.uri.path eq "/api/thumb/image"` → Cache eligibility **Eligible
     for cache**, Edge TTL **Respect origin** (the route already says `immutable`). The
     default cache key includes the query string, and Free cannot customise that — which
     is what makes `gen` part of the identity.
   - Rule 2: `starts_with(http.request.uri.path, "/api/") and
     http.request.uri.path ne "/api/thumb/image"` → **Bypass cache**. (`not` is unary in
     wirefilter; the negated-equality form is `ne`.)
   A Cache Rule is needed at all because the free plan caches by file extension and
   `/api/thumb/image` has none.
5. **Protect the ACME challenge** before the next renewal, not after. Note this step
   breaks phase 1's "no repo code changed" shape: pinning the issuer edits a tracked file
   and needs a commit, a push, a pull on the box and `up --build`, so it falls under the
   same explicit go-ahead §7.6 requires. Two parts:
   `deploy/demo/Caddyfile` has no `tls` line, so Caddy tries **TLS-ALPN-01 first**, and
   that challenge cannot succeed behind a proxy that terminates TLS — pin the HTTP-01
   issuer rather than relying on the fallback. `deploy/demo/Caddyfile.local` cannot mirror
   that block — its site is `localhost` with `tls internal`, and its header names the
   internal CA as the permitted difference — so record the issuer line as the **second**
   sanctioned divergence between the two files, in both headers, or the next reader
   "fixes" it back. Then a Configuration Rule exempting
   `/.well-known/acme-challenge/*` (no Always Use HTTPS, no Automatic HTTPS Rewrites),
   which are the documented breakers of HTTP-01 through a proxy.
6. **Skip `trusted_proxies` for now.** `deploy/demo/Caddyfile` has no `log` directive, so
   there are no access-log lines to record an edge address in; and it is a global
   `servers { }` option, not a site-block line, with stock Caddy offering only a static IP
   list that must be pasted and maintained by hand. Revisit if logging is ever turned on.
7. **Re-measure** with `.ai/probe-demo-latency.sh` over a window of the same length and
   compare against §D. Read **`batch_hit` and `batch_cf`**, never the standalone
   thumbnail's `thumb_cf` — that object is drawn at random from a pool of over a thousand
   and is meant to read MISS. Compare the two runs' `ok=0` counts and their `why` columns
   *before* comparing any timing: excluded rows are not noise here, they are the failure
   mode an edge introduces.

**What it can show:** whether edge-cached thumbnails remove both the distance and the
box contention for the ~114 images of a first screen. That is most of the requests.

**What it costs while it runs:** Cloudflare's origin-response timeout is 100 seconds, so a
request the box would have served slowly — the deliberate posture in
`deploy/demo/Caddyfile`, where abuse degrades to waiting rather than to failure, with a
serialising index behind it — becomes a 524 for the visitor instead. That is a behaviour
change for the duration, not just a measurement.

**What it cannot show:** any improvement for model *throughput*. Models are bypassed (no
`Cache-Control`), and even cached they would mostly miss — 4.6 GB across 3,122 files with a
long tail. Expect their TTFB to fall anyway, purely because TLS now terminates at an edge;
that is why the probe reports TTFB net of the handshake, and why `model_bps` is the column
to read for models.

**Ending it.** Grey-cloud the records as soon as the gate in §7.1 has been read. The
experiment is a measurement, not a posture: leaving the zone proxied keeps both the terms
exposure below and the 524 behaviour above in place for however many weeks phases 2–6 take.
Re-orange only for the phase-6 flip, and only for the hostname that needs it.

**Terms, stated plainly:** serving the box's images through the free CDN is the pattern
Cloudflare's Application Services terms restrict (§2). As a time-boxed measurement the risk
is small, and the destination — R2 — is the sanctioned one. Do not leave the experiment
running as the permanent arrangement.

## Related issues

- [#24 Move files to a cdn](https://github.com/ConfusedSky/model-browser/issues/24) — this
  plan is the answer to it; the issue has no body. Not fixed.
- [#25 Skip the /api/thumb lookup when the listing already annotates the entry](https://github.com/ConfusedSky/model-browser/issues/25)
  — related and worth doing first. It widens the listing-vouched branch, which is exactly
  the branch that gets to use a CDN URL.
- [#4 glTF/GLB support — 5.8x smaller than STL](https://github.com/ConfusedSky/model-browser/issues/4)
  — related: it attacks the same 4.6 GB from the other side, and the two compose.
- [#2 Review the demo corpus for third-party IP before publishing](https://github.com/ConfusedSky/model-browser/issues/2)
  — related, and it gains weight here: publishing to a bucket is a second act of
  redistribution, which is also why §4 adds `CREDITS.txt`.
