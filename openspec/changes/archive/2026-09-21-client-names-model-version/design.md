# Design — client-names-model-version

## Context

The server half is shipped. `byteTiers` (server/src/app.ts) reads `c.req.query("mtime")`,
compares it numerically to the source's `mtimeMs`, and returns the headers the call site
spreads into its answer: a named-and-current version is pinned a year and `immutable`, a
named-but-stale one and an unnamed one are both `no-cache` with the strong
`"<mtime>-<size>"` tag, and every failure is `no-store`. The stale tier carries that tag by
`byte-route-cache-headers`' own amendment, which this change depends on and does not make
(D8). Nothing on the client sends
the parameter, so only the third row is ever reached.

Three facts about the client shape everything below.

- **`fetchModel` and `fetchModelGlb` have exactly one production caller between them**:
  `meshLoader` (client/src/three/meshLoader.ts), the function `MeshLru`'s constructor
  takes as its `load`. Nothing else in `client/src` reaches for model bytes — D1 is the
  search, not an assumption.
- **`MeshLru` is keyed by library path**, in both its resident map and its in-flight map,
  and its `load` is `(path: string) => Promise<LoadedModel<T>>`. Any version has to reach
  the request through that signature or around it.
- **Every caller that acquires a mesh holds a `DirEntry`.** Including the deep link: a
  `model` named in the URL is opened only once its entry is found in a landed listing
  (App's restore effect for `state.view.model`, `url-navigation` D3), never from the path
  alone.

The proven precedent is one file over: `thumbImageUrl` (client/src/api/thumbUrl.ts) and
`getThumb` already send `DirEntry.mtime` as the thumbnail key and `gen` as the cache
generation, interpolated into the URL with `${}` and appended only when they say
something. The server side of #36 was deliberately modelled on it; this half copies the
client side of it.

## Goals / Non-Goals

**Goals:**
- Every model fetch the app makes names the version the listing gave it, so the answer is
  pinnable instead of revalidated.
- The parameter stays optional in the client's own API, not merely on the wire: a caller
  with no version compiles, runs and behaves exactly as today.
- The app's own behaviour is unchanged — no new state, no new request, same errors, same
  LRU — and the server's answer never depends on the version named. The one behaviour that
  *does* change is a reader serving a pin it earned instead of asking again, which D8 states
  and accepts rather than hides.
- Desktop, Electron and the hosted demo behave identically, with or without a cache in
  front.

**Non-Goals:**
- Making the client react to a version (re-fetching a mesh whose mtime moved mid-session).
- Fixing the listing staleness that can make the version wrong (issue #34).
- Any change to the thumbnail path, which already does this.

## Decisions

### D1: The call-site inventory, and what each one has in hand

The thread is `DirEntry` → `MeshLru.acquire`/`warm` → `meshLoader` → `fetchModel*`. Every
row below was found by grep over `client/src`, not inferred:

| call site | symbol | version in hand | how it is supplied |
|---|---|---|---|
| `client/src/hooks/useThumbnails.ts` | the render job pushed inside the load effect (`lru.acquire(entry.path)`) | **yes** — `entry: DirEntry`; the `putThumb` below it already sends `entry.mtime` | `entry.mtime` |
| `client/src/lib/entryActions.ts` | `renderEntryThumbnail` (`deps.lru.acquire`) | **yes** — `entry: DirEntry`, parameter | `entry.mtime` |
| `client/src/lib/entryActions.ts` | `setOrbitAxis` (`host.lru.acquire`) | **yes** — `entry: DirEntry`, parameter | `entry.mtime` |
| `client/src/viewer/ViewerLayer.tsx` | the session's `Promise.all([lru.acquire(viewer.entry.path), savedPromise])` | **yes** — `viewer.entry: DirEntry` | `viewer.entry.mtime` |
| `client/src/App.tsx` | the hover warmer (`createHoverWarmer((p) => lru.warm(p))`) | **yes at the origin, no at the seam** — `Grid`'s tile calls `onModelHover(entry.path)`, so the entry exists but only its path is piped | widen the pipe (D6) |
| `client/src/jobs/bulkJobs.ts` | — | **n/a** | it declares `lru: Pick<MeshLru<…>, "acquire">` as a dependency but never calls it; every mesh it needs comes through `renderEntryThumbnail` |
| `client/src/api/localFramings.ts` | `LocalFramingClient.fetchModel` / `fetchModelGlb` | **pass-through** | none needed: the forwarders are `...args: Parameters<ApiClient["fetchModel"]>` and carry whatever the interface grows |

So: **five acquire/warm sites, all with a `DirEntry`; one of them needs a prop widened to
get it to the seam; one decorator needs nothing; and no caller in `client/src` lacks a
version today.** That last fact is why D7 exists — the version-less path has to stay a
real, tested capability rather than a branch nothing can reach.

### D2: The signature is `(path: string, mtime?: number)` — a trailing optional number

```ts
fetchModel(path: string, mtime?: number): Promise<ArrayBuffer>;
fetchModelGlb(path: string, mtime?: number): Promise<ArrayBuffer>;
```

The same shape `getThumb(path, mtime, ao?, gen?, pixels?)` and
`thumbImageUrl(path, mtime, ao, gen?)` already have in this interface, so there is one way
to spell "the version the caller believes this entry is at" across the client's whole API.
It also keeps every existing call site — and every test that writes `api.fetchModel("/m.stl")`
— compiling and behaving identically, which is what makes "optional" true of the client's
own API and not just of the URL.

Rejected:

- **`fetchModel(entry: DirEntry)`.** It reads well until the caller has no entry, which the
  user's scope note requires to keep working; it would drag a listing type into the one
  seam that is purely "bytes for a path"; and it cannot serve `MeshLru`, whose key is a
  string and whose in-flight map would have to decide what two entries with one path mean.
- **`fetchModel(path, opts?: { mtime?: number })`.** An object earns its keep when a second
  option is coming. None is: the route takes `path` and `mtime` and nothing else, and the
  proposal that would add one (a converter dimension in `MeshCache`) is out of scope in
  both halves. Every hop of D1's thread would grow a literal for one field.
- **A second method (`fetchModelVersioned`).** Two spellings of one request, and D1's
  inventory says nobody would call the old one.

### D3: The version travels through `MeshLru`, not around it

`MeshLru.acquire(path, mtime?)`, `MeshLru.warm(path, mtime?)`, and the constructor's
`load: (path: string, mtime?: number) => Promise<LoadedModel<T>>`. `meshLoader` passes what
it is given straight to `fetchModelGlb`/`fetchModel`.

The alternative is a side channel — a `Map<path, mtime>` the loader consults, or an entry
registry — which is strictly worse: it makes the version ambient state that can disagree
with the caller's own entry, and it has to be invalidated by someone. Passing it as an
argument means the version is always the one the caller was looking at when it asked.

`acquire`'s second argument is read **only on a miss**, because that is the only path that
calls `load`. Two callers racing the same path with different versions therefore resolve to
one fetch, under whichever version arrived first. That is correct here: the server always
answers with the source's *current* bytes whatever the parameter says (the sibling's
requirement makes the parameter an assertion, never a selector on the wire), so the version
decides only how the answer may be cached. The two callers then share one resident mesh
whichever of their URLs was asked for — including where a reader answers one of them from a
pin it holds, which is the same collapse `MeshLru` already performs by keying on the path
(D4, D8).

### D4: No client-side cache key changes

`MeshLru` stays keyed by library path alone, in both maps. It is already version-blind
within a session — a file overwritten while the app is open keeps serving the resident
mesh — and this change is not the one to fix that: re-keying by `path+mtime` would make a
hover warm and a press with a newer listing two entries, double the resident bytes for one
model, and start evicting by a dimension the byte budget was never sized for.

The browser's HTTP cache *does* re-key, and that is the point — but only as far as the
client's knowledge reaches. A new version is a new URL **once the client has been told the
new version**; while a listing keeps reporting the old one, the old URL is what is asked
for, and a pin earned under it answers without the server being consulted. So the client's
key is unchanged here and its *cache* key is the listing's honesty. D8 is where that leads
and what was decided about it.

### D5: `String(entry.mtime)` verbatim — no rounding, no formatting

The value goes into the URL by interpolation — `&mtime=${mtime}` — which is
`Number.prototype.toString`, the shortest round-tripping decimal of the same IEEE-754
double the listing's JSON carried. `1789446597239.1736` goes out with its fraction. No
`Math.round`, no `toFixed`, no `| 0` anywhere on this path.

Two independent reasons, either sufficient:

- The server compares `Number(named) === s.mtimeMs` exactly (`byteTiers`). A rounded value
  is a version the source never had, so every request would land in the mis-keyed tier and
  nothing would ever be pinned — the change would be a no-op that looks like it worked.
- `DirEntry.mtime` is `/api/thumb`'s key against every sidecar on disk. The moment a
  rounded spelling of it exists in the client, it is one copy-paste from the thumbnail
  call sites, and that is a library-wide thumbnail cache invalidation.

For an entry inside a zip the listing already reports the **archive's** mtime
(`shared/types.ts`, and `listing.ts` fills it from the archive's stat), which is what
`/api/model.glb` judges staleness by and what `byteTiers` compares against. The client
sends `entry.mtime` for every entry and needs no zip case at all — one rule, no second one.

### D6: The hover warm carries the version too, which costs one prop

`Grid`'s model tile calls `onModelHover(entry.path)` on pointer enter and `onModelHover(null)`
on leave; App turns that into `hover.enter(p)`, and `createHoverWarmer` calls
`lru.warm(p)` after the linger. The version is at the tile and is dropped at the first
hop. The fix is to widen that one pipe to `(path: string | null, mtime?: number)`, with
`createHoverWarmer`'s `warm` and `enter` taking the same pair — the same `(path, mtime?)`
shape as everything else in the thread, so there is nothing new to learn at this seam.

Passing the whole `DirEntry` through `onModelHover` was rejected for the reason D2 rejects
it at the API: the leave call is `onModelHover(null)` and the warmer's job is a path.

It matters more than it looks. If the warm fetched the version-less URL and the press
fetched the pinned one, the two would be different URLs in the browser's cache: the warm
would populate an entry the press cannot use, and on a cold LRU (a reload, an eviction)
every warmed model would be fetched twice. Warm and press must name the same URL.

### D7: A caller with no version omits the parameter, and that path stays real

`mtime` is `undefined` by default at every level of the thread — `ApiClient`, `MeshLru`,
`meshLoader` — and the URL builder appends nothing when it is undefined, exactly as
`getThumb` appends no `gen` when it has none. Such a request is the version-less tier:
`no-cache` with a strong validator, a 304 on a revalidation, and every byte and every
failure identical to today.

D1 found no such caller in `client/src` today, which is precisely the hazard: an untested
default is a default that rots. So the version-less path is pinned by tests at the two
levels it can be entered, and what they pin is the **URL**, not the arity of the call:
`HttpApiClient` called with no version must produce today's exact URL — no `&mtime=`, no
`undefined` anywhere in the query, which is the cell tasks §3.2 holds — and `meshLoader`
invoked with no version must reach the fetchers naming none, which the thread spells as an
explicit `undefined` forwarded down rather than as a dropped argument, since the fetchers'
own builder is what decides the URL. The interface's doc comment says what omitting it
means rather than leaving a reader to infer it from a `?`.

This is also what keeps the client honest about a future caller that genuinely has no
entry: a drag-out, a download button, a bulk export, an Electron path. Each of those can
use the seam the day it exists, with no version, and get today's behaviour.

### D8: Issue #34 — a stale version costs a revalidation for some readers and stale geometry for others, and the stale geometry is accepted

**The root cause.** The listing tree cache cannot see a model overwritten in place. An add,
a delete and a rename all move a directory's modification time and are caught; a rewrite of
a child's bytes does not move it, so `levelFor` (server/src/listing.ts) reuses the level it
holds and every flat listing and search keeps reporting the version the entry had before.
`listDir` walks the filesystem on every request, so the folder view is right — which is why
the measured blindness is *flat and search only*, and why `POST /api/reload`, running the
same directory check, heals nothing (#34, measured 2026-09-14).

**What this change does to that.** While the client sends no version, every request lands in
the version-less tier: `no-cache` with a validator, so even a client holding a stale mtime
revalidates and is handed the new mesh. Once the client names the version, the mis-keyed
model splits into two different fates, and only one of them is about cost.

- **A reader that has never held a pin for that URL** asks `?mtime=<stale>`, reaches the
  server, and gets the current bytes. What it pays is decided by the tier: with no
  validator, `no-cache` means a full download every visit, forever, since the listing never
  corrects; with one, a 304. That is the cost half, and it is fixed — the stale tier carries
  the strong tag, in `byte-route-cache-headers` (committed `253f228`), not here. §0.1 and
  §4.5 check the property from this side; the Risks section records what its loss would
  mean.
- **A reader that already earned the pin** does not reach the server at all. It fetched the
  model while the listing said `m1`, stored
  `/api/model.glb?path=X&mtime=m1` under `public, max-age=31536000, immutable`, and when the
  source is rewritten to `m2` the flat listing still says `m1`, so the client asks for the
  same URL and its own cache answers it. **No tier and no validator can intervene, because
  there is no request.** The result is old geometry in flat and search views and new
  geometry in the folder view, indefinitely — a *displayed-bytes* regression against today,
  where the version-less URL is `no-cache` and revalidating shows the new mesh. Behind the
  demo's Cloudflare rule, once it respects the origin, the edge holds the same pin for every
  visitor whose listing names `m1`.

The sibling's *An edited source is a different URL, never a stale hit* does not cover this:
its **WHEN** has the source "listed … again", and the whole of #34 is the listing that
cannot see the edit.

**The decision: accept the stale geometry, matching the thumbnail precedent** (Masa,
2026-09-18, taken with the regression stated). `/api/thumb` is already keyed
`path`+`mtime`, the client already takes that mtime from the listing, and the same in-place
rewrite already leaves a stale *render* on every tile in a flat or search view while the
folder view shows the new one — that is half of what issue #34 is filed about. Keying the
model's bytes the same way puts them under one key rather than two: wherever a listing is
stale, the render and the geometry are stale together, one symptom of one cause, and fixing
#34 clears both at once. The alternative shapes all keep the thumbnail stale and correct the
mesh — a listing that is wrong about a model in a way the user cannot see, which is harder
to diagnose than a listing that is visibly behind.

**One key, however, is not a promise that the two are never seen to disagree, and the
promise should not be made.** `MeshLru` is keyed by path alone (D4), so a stale pin becomes
the session's resident mesh for that model and is what *every* later view of it draws,
including one whose listing names the current version. That is not only display: it is what
the render job renders. A session that opens the stale flat or search view first, presses
the model — the pin answers `B1`, and `B1` goes resident — and then walks into the model's
folder, whose fresh listing names `m2`, has its `getThumb(X, m2)` miss (`cache.read` is a
hit only on an equal mtime), so `useThumbnails`' load effect acquires the path, is handed
the **resident** `B1`, renders it and `putThumb`s it under `mtime: m2`. `/api/thumb` then
serves that render as a current hit, pinned by `thumbHitTiers`, until the source moves again
or someone re-renders by hand — and the next session's folder view fetches `?mtime=m2`,
gets the corrected geometry, and draws it beside that stored render of the old shape. The
mesh is corrected and the render is not: the exact inversion of the paragraph above.

The path-keyed LRU makes this reachable today, for a rewrite that happens mid-session after
the press. What this change adds is that a *fresh* session reaches it, whenever it visits the
stale view before the fresh one, because the pin is what makes the superseded bytes resident.
It is inside what was accepted — the trigger is the same stale listing and the same key — but
it is the part a future reader would otherwise have to re-derive, so the delta carries a
scenario for it (*A superseded mesh made resident is what the session draws and persists*)
and the requirement declines to promise the two never disagree.

This was the "accept it" option, and it is worth re-stating what is being accepted now that
the cost is known to be geometry and not bytes: a model re-exported in place shows its old
shape wherever that user's stale listing named it — until that listing reports a different
version, which for that one mutation means until something else in the directory changes or
`entry-stat-revalidation` lands — and, once those bytes are resident, anywhere else in that
session until the LRU evicts them, which is a byte-budget matter and not a listing one. The reasons it is still the right trade: the folder
view, which is where a user who just re-exported a model looks, is correct; the thumbnail beside the mesh in the
stale view already says the listing is behind, so nothing there is silently wrong; a library that mutates
is the desktop posture, while the posture that gains the pin is the hosted demo over a
static corpus, where in-place rewrites do not happen between deployments; and #34 has an
owner (`entry-stat-revalidation`) that removes the cause rather than papering over one of
its symptoms. What tipped it is that no client-side shape removes the exposure without
giving up the pin entirely — see the rejected alternatives — so the real choice was between
this and not doing the change.

The delta says so rather than leaving it to be discovered: *A pin earned under a version is
served while the listing still names that version* is in `model-viewer`'s requirement, and
the requirement's prose ties it to the thumbnail key. Issue #34 carries a comment recording
that this change adds stale geometry to the stale thumbnail it already describes.

**Alternatives rejected** — kept because the reasoning outlives the decision:

- **Block this change on a fix to #34.** The fix is `entry-stat-revalidation` (active, 28
  tasks, none done), which stats every recorded model entry during revalidation. It is the
  right fix for the root cause and it is unrelated work: gating a ten-line client change on
  a server change of that size trades a certain benefit for an uncertain date. It also
  would not close the case, only narrow it — that change's own proposal records the residual
  (an overwrite preserving both mtime and size is invisible to it, to the folder view, and
  to the thumbnail cache alike) — and *any* client holding a listing from before a change is
  mis-keyed for as long as it holds it, which is a normal condition of a long-lived tab and
  nothing to do with #34.
- **Have the client omit the version when it doubts the listing.** `DirListing.stale` is
  the only signal on the wire and it is the wrong one: it means "served from a snapshot not
  yet revalidated, ask again", and the #34 case is a listing that has been revalidated and
  is *still* wrong. There is no per-entry provenance to hang this on, and inventing one
  (tagging entries by whether they came from a walk or a snapshot) would have to survive
  every place an entry travels — view state, tiles, the viewer, jobs — and would still
  forfeit pinning for the flat and search views, which are where a visitor spends the most
  time. It also would not help: a folder tile's contact-sheet cells come from the derived
  layer, so even a folder view's entries are not uniformly fresh.
- **Have the client sniff the answer's headers and re-key itself** (`no-cache` with no
  `ETag` ⇒ my version is stale ⇒ drop it for this path and refetch the listing). It makes
  the client depend on a header shape as a protocol, adds a state machine to `ApiClient`
  for a case it cannot verify, and — decisively, now — does nothing at all for the reader
  that matters here, whose request never leaves the browser to have headers read off it.
- **Name the version but refuse the pin** (send `mtime` and add something that keeps the
  answer revalidating, so the edge can key on the URL while the browser never settles). It
  gives up exactly what the change is for: the revisit that costs no round trip. A `no-cache`
  answer at a versioned URL is what the client already gets today at an unversioned one.

### D9: The client's own behaviour is unchanged; the reader's cache is where the difference lives

No new state, no new request, no reordering, no change to when a mesh is fetched or how a
failure is handled. `fetchModel`'s `if (!res.ok) throw await errorOf(res)` is untouched, so
a 404 or a 422 still becomes the viewer's existing model-load error (`model-viewer`,
*Missing-model error feedback*). Every answer the server gives carries the source's current
bytes whatever version was named, by the server's own requirement, so nothing the client
sends can make the *server* hand back something else.

The observable differences are both in the reader, not the app: a URL with `&mtime=` in the
network panel, and a revisit answered from the browser's own cache with no request at all.
The second is the change's purpose and its one behavioural cost — where the version named is
stale, that silent answer is stale geometry (D8).

### D10: No posture, no configuration, no cache required

The parameter is appended unconditionally when a version is known — not behind a feature
field, a deployment check, or a "hosted" flag. A desktop `bun run dev` and an Electron
build send it too and get the same declarations back from their own loopback server; the
only difference is who benefits from the pin. Nothing here requires a CDN, a proxy or any
network state to exist, and there is no configuration that turns it off. That is the same
stance the server half took (`byte-route-cache-headers` D10) and the reason the demo and
the desktop app stay one build.

## Risks / Trade-offs

- **A pin is a year long, and the client is now the one asserting the key.** No request
  that *reaches* the server can be answered with the wrong bytes: the assertion is checked
  against the server's own `stat`, and every way it can be wrong yields a less cacheable
  answer carrying current bytes (the sibling's D2). What the client can do is keep naming a
  version it already holds pinned, in which case the request never reaches the server and
  the pinned bytes are displayed. That is stale *geometry on screen*, not a wasted
  download, and D8 is the decision to accept it.
- **A version the client is wrong about has two costs, and they land on different
  readers.** A reader that has never held the pin reaches the server and pays a
  revalidation rather than a re-download — `byte-route-cache-headers`' stale-tier validator
  doing its job, which this change depends on and does not own, and which tasks §4.5 would
  catch the loss of. A reader that *has* held the pin does not reach the server at all and
  shows the old geometry until the listing moves or the pin expires. `entry-stat-revalidation`
  is what ends the mis-keying that causes both; this change names that dependency without
  taking it (D8).
- **The hover prop widening touches `App.tsx` and `Grid.tsx`**, which `hover-prefetch-listings`
  and `hover-prefetch-thumbnails` will also touch. Neither is implemented and neither shares
  a requirement, but both would extend the same hover seam, so whichever lands second
  re-reads it.
- **Six files for one query parameter.** The alternative — reading the version out of
  ambient state inside the loader — is fewer diffs and worse (D3). The thread is the
  honest shape: the version belongs to the entry the caller was looking at.
