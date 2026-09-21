# The client names the model version it is asking for

## Why

`byte-route-cache-headers` (issue #36, landed server-side) gave `/api/file` and
`/api/model.glb` an optional `mtime` parameter naming the version of the source a request
believes it is asking for, and three declarations over it: *named and current* is
`public, max-age=31536000, immutable`; *named and not current* and *not named* are
`no-cache` with a strong validator; anything that is not the bytes is `no-store`.

The client does not send the parameter, so every model fetch lands in the version-less
tier (issue #42). That is a revalidation, not a pin — an unchanged model still costs a
round trip on every visit, and the edge cannot see a re-derived mesh as a different URL.
Until it does, the demo's Cloudflare rules have to stay as they are (`/api/model.glb`
*ignore cache-control, TTL 1 day* — a guess that can serve a stale mesh for a day after
its source STL changes — and `/api/file` bypassed outright), because a rule that respects
the origin would pin nothing.

Nothing new has to be computed or carried. `DirEntry.mtime` is in every listing the client
already reads, it is already `/api/thumb`'s key, and for an entry inside an archive it is
already the archive's mtime — the same rule the GLB route judges staleness by.

## What Changes

- **`ApiClient.fetchModel` and `ApiClient.fetchModelGlb` take the version as an optional
  trailing argument** — `fetchModel(path, mtime?)` — and append `&mtime=<value>` only when
  they are given one. The value is the number's own decimal spelling, fraction included —
  what interpolating it into the URL gives, which is what `String(mtime)` produces — the
  same shape `thumbImageUrl` has emitted for the thumbnail key since it was added, because
  `DirEntry.mtime` *is* that key and rounding it would miss every sidecar on disk
  (design D5).
- **The version is threaded from the `DirEntry` the caller already holds down to the
  request.** The only production caller of the two fetchers is `meshLoader`, whose loader
  `MeshLru` invokes, so `MeshLru.acquire`, `MeshLru.warm` and the `load` signature gain the
  same optional trailing `mtime`, and each of the five call sites passes its entry's
  (design D1's inventory — every one of them holds a `DirEntry` today).
- **The parameter stays optional everywhere, on the wire and in the client's own API.** A
  caller with no entry in hand omits it, reaches the version-less tier, and behaves exactly
  as it does today — same bytes, same failures, same everything but the declaration. That
  is the shape of the API, not an accident of who calls it: the default is "no version".
- **No client-side cache key changes.** The mesh LRU stays keyed by library path alone, and
  no answer the server gives depends on the version named (design D4).
- **One accepted regression, stated up front.** Where a listing keeps reporting the version
  a model had before it was rewritten in place (#34 — flat listings and searches only, the
  folder view walks and is right), a reader that already pinned that URL serves the pinned
  bytes without asking: stale *geometry* wherever that listing named the model, and — once
  those bytes are the session's resident mesh, which is keyed by path — anywhere else in
  that session, including a view whose listing is current. That is the staleness the
  thumbnail key already has for the same entry under the same modification time, so render
  and geometry now sit under one key, and `entry-stat-revalidation` ends both at once. It
  is not a promise that the two are never seen to disagree: a render persisted from a
  resident but superseded mesh is stored under the *current* version, which a later session
  reads as current. Design D8 records the decision
  (Masa, 2026-09-18), the alternatives, and why no client-side shape avoids it without
  giving up the pin; the delta carries a scenario for it; issue #34 carries a comment.
- **Nothing on the server.** This change is client-only. It does depend on one property of
  the server it does not itself provide — a stale version is answered with a validator, so
  a client whose listing cannot be corrected pays a revalidation rather than a re-download
  — and that is `byte-route-cache-headers`' own amendment, committed there as `253f228`.
  It covers the reader that still reaches the server; the reader holding a pin is the
  accepted case above. Design D8 states the dependency and what a reversal of it would
  cost; tasks §4.5 is the check that would catch one.

## Out of Scope

- **Any server change.** No file under `server/` is touched. The stale-version tier's
  validator, which design D8 depends on, belongs to `byte-route-cache-headers` — code,
  delta and tests alike.
- **Fixing issue #34** — the listing tree cache's blindness to an in-place overwrite. That
  is `entry-stat-revalidation`'s, which is active and unimplemented. Design D8 records why
  this change does not wait for it.
- **The edge itself.** Cache rules, the 1-day guess, R2, the Worker (`.ai/todo.md`,
  `deploy/demo/README.md` §10, issue #24). This change makes "eligible for cache, respect
  origin" worth setting; setting it is deployment work and is not created here.
- **Thumbnails.** `getThumb` and `thumbImageUrl` already send their key and are untouched.
- **A version dimension in the mesh LRU's key, or any re-fetch on a changed version.** The
  LRU is version-blind within a session today and stays that way (design D4).
- **Any other consumer of `/api/file`.** There is none in `client/src`: the two fetchers
  are the client's only reach for model bytes (design D1).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-viewer`: ADDs one requirement — *The viewer names the version of the model it
  fetches*. The capability is the home because it owns model delivery to the viewer
  (*STL viewer meshes served as cached GLB*) and the warm that prefetches it
  (*Hover-warmed mesh LRU*); neither is modified, and no active change shares the title.
  It is this change's only delta, and it collides with no active change's: no requirement is
  shared, and nothing here MODIFIES a server requirement. It should still be **archived
  after `byte-route-cache-headers`**, for one reason only — its prose cites that change's
  *Model byte responses are cacheable by the version they name*, which reaches the main
  specs when that change archives (tasks header).

## Impact

- `client/src/api/client.ts` — the `ApiClient` declarations and the two `HttpApiClient`
  implementations.
- `client/src/three/lru.ts` (`MeshLru.acquire`, `warm`, the `load` field),
  `client/src/three/meshLoader.ts`, `client/src/hooks/useThumbnails.ts` (the render job in
  the load effect), `client/src/lib/entryActions.ts` (`renderEntryThumbnail`,
  `setOrbitAxis`), `client/src/viewer/ViewerLayer.tsx` (the session's `Promise.all`),
  `client/src/lib/hover.ts` (`createHoverWarmer`), `client/src/components/Grid.tsx` and
  `client/src/App.tsx` (the `onModelHover` prop and the warmer it drives).
- `client/src/api/localFramings.ts` — **no edit**: its forwarders are
  `...args: Parameters<ApiClient["fetchModel"]>` and pick the argument up on their own.
- Tests, six amended: `client/test/apiClient.test.ts`, `client/test/meshLoader.test.ts`,
  `client/test/lru.test.ts`, `client/test/interaction.test.ts`,
  `client/test/thumbnailCommands.test.ts`, `client/test/viewerLayer.test.tsx` — and one new,
  `client/test/modelVersionThread.test.tsx`, the app-mount file carrying both end-to-end
  cells (the thumbnail sweep's render job and the hover warm). `thumbnailQueue.test.tsx` is
  **not** touched: it drives the hook against a loader-less `fakeLru`, which is the reason
  the new file exists (tasks §3.7).
- Nothing under `server/`, nothing in `shared/types.ts`, no configuration, no on-disk
  format, no new route or field.
- `docs/platform-surface.md` — no change: a query parameter is not an OS-specific surface.
- Ordering: no requirement is shared with any active change, and implementation is
  unblocked. Archive **after** `byte-route-cache-headers` so the delta's citation of its
  requirement resolves in the main specs; the behavioural dependency on that change's
  stale-tier validator is a runtime one, checked by tasks §4.5.
  `hover-prefetch-listings` and `hover-prefetch-thumbnails`
  also touch `App.tsx` and hover, but neither is implemented and neither shares a
  requirement — re-read the files rather than planning against this paragraph.
