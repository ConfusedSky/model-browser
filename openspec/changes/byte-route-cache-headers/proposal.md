# Byte-route cache headers

## Why

`GET /api/thumb/image` declares the cacheability of every answer it gives and carries the
key that makes the declaration safe. The two routes that carry the *model* bytes do
neither (issue #36, confirmed live on the demo 2026-09-18):

| route | `Cache-Control` | version in the URL |
|---|---|---|
| `/api/thumb/image` | `public, max-age=31536000, immutable` when the request names the current generation; `no-cache` + ETag when it names none; `no-store` on a non-hit | yes — `gen` |
| `/api/file` | none | none — `path` only |
| `/api/model.glb` | none | none — `path` only |

The demo has been behind Cloudflare since 2026-09-18 (`deploy/demo/README.md` §10), and a
cache rule can only respect what the origin says. Cloudflare's Edge TTL default is *use
cache-control if present, bypass if not*, so an "eligible for cache" rule on a route that
sends no header is a no-op that reads as correct in the dashboard — it was nearly shipped
that way for the GLB. What is live instead is *ignore cache-control, TTL 1 day* for
`/api/model.glb`, which is a guess, and because the URL carries no version the edge cannot
see a re-derived mesh: change a source STL and the old GLB is served until the day expires
or someone purges. `/api/file` is bypassed entirely, so model bytes get no edge caching at
all. `meshCache` keys on the source mtime internally, so the server is already correct;
only the edge is wrong.

Nothing new has to be computed to fix it. `DirEntry.mtime` is in every listing the client
already reads, and for an entry inside an archive it is already the archive's mtime
(`shared/types.ts`), which is the same rule `/api/model.glb` already judges staleness by.

## What Changes

- **Both byte routes accept an optional `mtime` parameter** naming the version of the
  source the caller believes it is asking for, and **declare the cacheability of every
  answer**, in three tiers modelled on `thumbHitTiers`: named and current →
  `public, max-age=31536000, immutable`; named and not current → `no-cache` with the
  current bytes and no validator, so the caller re-keys; named not at all → `no-cache` with
  a strong ETag derived from the source's version. The pinned tier carries that **same
  ETag**, which is where these routes part company with the thumbnail's tiers: `/api/file`
  serves 206s, and a download resuming a pinned URL needs a validator to make its
  resumption conditional on (design D3). A matching `if-none-match` answers 304 in every
  tier.
- **Nothing that is not the bytes is cacheable.** A rejected request, a missing or
  non-model source, an unconvertible STL and an unsatisfiable range all answer `no-store`.
  Most of those statuses are not produced by the byte handlers at all — a missing archive,
  a corrupt one, an entry that is not there and a path outside the root all leave by
  `throw` and become responses in `app.onError` — so the header goes there, which makes
  this the change's **one cross-route edit**: every route's thrown error gains `no-store`
  (design D3). Without it a 404 is heuristically cacheable and an edge rule that respects
  the origin may store a miss.
- **Ranged reads stay correct.** A 206 carries the same directives the 200 for that same
  request would have carried; `If-Range` is evaluated against the current validator rather
  than ignored, so a resumption across a changed file yields the whole representation
  instead of a slice stitched onto stale bytes; `If-None-Match` outranks `Range`, per
  RFC 9110 §13.2.2 (*Precedence of Preconditions*).
- **`/api/file`'s zip branch learns the archive's mtime.** It does not `stat` today; it
  will, before it extracts, so a zip entry's version is the archive's — the one rule, not
  a second one.
- **Nothing is conditional.** No configuration, no capability, no deployment posture
  selects a declaration. A desktop or Electron build gets the identical bytes, statuses
  and headers a hosted one gets, and nothing here requires a CDN, a proxy or any network
  state to be present.

## Out of Scope

- **The client.** `client/src/api/client.ts` keeps today's URLs: `fetchModel` and
  `fetchModelGlb` send `path` alone. **The edge benefit arrives with a follow-up client
  change** that appends the `mtime` the listing already handed it — that change is not
  created here. Until it lands every request falls in the version-less tier, which is
  still strictly better than today (a revisit costs a revalidation rather than a
  re-download), and that is exactly what makes this half safe to land alone.
- `thumbHitTiers` and every thumbnail behaviour: untouched (design D8).
- The edge itself — cache rules, R2, the Worker (`.ai/todo.md`, issue #24). This change
  only makes those rules expressible against a truthful origin.
- A converter-version dimension in `MeshCache` (design D10 records why it is a residual
  risk and not a blocker).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `public-deployment`: ADDs two requirements — *Model byte responses are cacheable by the
  version they name* and *A ranged model read caches as consistently as a whole one*. Both
  ADD-only with distinct titles. The capability is the home because the rule is
  cross-route serving policy, which is where *The server serves the built client* already
  puts the hashed-asset/entry-document caching rule; the route-specific contracts stay
  where they are (`model-viewer`'s *STL viewer meshes served as cached GLB* for the GLB's
  staleness and zip rule, `directory-browsing`'s *API restricted to the app's own origin*
  for the byte routes' `octet-stream`/`nosniff`), and neither is modified.

## Impact

- `server/src/app.ts` — a new tier helper beside `thumbHitTiers`; the `/api/file` handler
  (both branches, the 206 and the 416); the `/api/model.glb` handler; one line in
  `app.onError`, which is the only edit reaching beyond the two byte routes (design D3).
- `server/test/api.test.ts` (a new `describe` beside *GET /api/file byte ranges* and
  *thumbnail cacheability*), `server/test/modelGlb.test.ts`.
- No client, no `shared/types.ts`, no configuration, no on-disk format.
- `docs/platform-surface.md` — no change: response headers and a query parameter are not
  an OS-specific surface.
- Ordering: independent of every active change. `entry-stat-revalidation` also edits
  `server/src/app.ts` (`/api/models` and `/api/reload` headers) and `server/test/api.test.ts`
  — different symbols and different `describe` blocks, so re-read both files before
  editing rather than planning against an earlier read. No requirement is shared with any
  active delta.
