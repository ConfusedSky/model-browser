## Context

See proposal.md — Why. What shapes the approach is where a crawler's request actually lands
and what the server is able to answer with.

- **The crawler lands on the SPA fallback.** `createStaticHandler` (`server/src/static.ts`)
  answers any path matching no file with `dist/index.html`. The client's deep links are
  *query parameters on `/`* — `serializeView` (`client/src/lib/urlState.ts`) writes
  `?path=…&flat=1&q=…&model=…`, and `commitUrl` keeps `window.location.pathname`. So for
  every view the demo can share, the crawler GETs `/` with a query string and gets the one
  document that has only a `<title>`.
- **`static.ts` must stay portable.** Its header states the rule and public-deployment D1/D8
  record it: no Bun APIs, no Hono routes, because the app has to run unchanged on Node for
  the Electron seam. Anything that reads a library, a cache or an override store is
  composition, and composition happens in `server/src/index.ts`, which already builds
  `library`, `cache`, `overrides` and `config` before it calls `createStaticHandler`.
- **The guard does not cover this.** `guard` (`server/src/guard.ts`) is mounted on `/api/*`
  only — guarding the built client would make the app unloadable from its own origin — so the
  entry document is served to anyone who reaches the port. The demo's Caddy site block
  (`deploy/demo/Caddyfile`) matches one name and passes `Host` through unchanged, adding
  `X-Forwarded-Proto` and `X-Forwarded-For`.
- **There is no image library on the server.** Nothing in `server/src` decodes or composes
  pixels; the folder contact sheets are drawn client-side in WebGL, and the thumbnail
  pipeline runs in the browser's own encoder (`three/renderer.ts`). A server-composed
  "corpus contact sheet" is not an option this change can take.
- **Thumbnail bytes already have a route.** `GET /api/thumb/image?path=…&mtime=…[&ao=][&gen=]`
  serves `THUMB_MIME` (`image/webp`, 256²) for a **cached hit only** — `ThumbCache.image`
  answers `png: undefined` on a miss and the route 404s. The demo's store is fully baked
  (`corpus-bake`) and `thumbWrites:false`, so on the demo every model in the corpus is a hit.
  The key needs the entry's `mtime`, which the route takes from the query because the client
  has it from the listing; a server rendering the document has to resolve it itself.
- **The overrides hold the words.** `displayNameOf` and `resolveOverrides`
  (`server/src/overrides.ts`) give a model's display name and its kit's credits from a store
  already loaded at startup, keyed by library path — no walk, no listing.
- **The focus trap is one line.** `ViewerLayer.tsx`'s lightbox key effect (the `useEffect`
  gated on `viewer.mode !== "lightbox"`, `onKey`'s `Tab` branch) builds
  `[dialog, ...dialog.querySelectorAll("button:not([disabled])")]`. The credits block in the
  same component renders author, license and source as `<a href target="_blank">` with
  `CREDIT_LINK_CLASS`; they are the only anchors inside the dialog.

## Goals / Non-Goals

**Goals:**

- A shared URL — the library top, a folder, a search, a model deep link — unfurls with a
  title, a description and an image on the services that read Open Graph.
- The per-model image is the model's own thumbnail, at no new cost: the bytes the demo
  already baked, through the route that already serves them.
- The lightbox's attribution links are reachable, and left, by the keyboard alone.
- `static.ts` stays Node-portable and route-free; nothing in it learns what a library is.

**Non-Goals:**

- Server-side image composition of any kind — no contact sheet, no overlay, no resize.
- A render-on-demand preview: a model with no cached thumbnail previews the site image rather
  than warming the cache from a crawler's GET. A crawler must not be able to make the server
  draw.
- Server-side rendering of the app, or any prerendered body. Only `<head>` metadata changes;
  the document's body is the same empty `#root`.
- `oEmbed`, `link rel=canonical` beyond `og:url`, JSON-LD, or a sitemap.
- Per-view images for search and similarity views: they preview as the site does.
- Re-opening issue #9's behaviour. It shipped; this change only observes it.

## Decisions

### D1 — The tags are injected by an optional hook on `createStaticHandler`, not by a route

`createStaticHandler(distDir, { intro, describe })`, where `describe` is
`(url: URL, headers: Headers) => Promise<Preview | null>`: the handler calls it only when it
is about to send
an **entry document**, splices the resulting tags into that document's `<head>`, and serves
the bytes otherwise unchanged. `static.ts` therefore never imports `library`, `cache` or
`overrides` — it receives a function and knows nothing about what fills it. The resolver
itself is a new `server/src/preview.ts` — Node-portable like everything but `index.ts`, and
unit-testable without a running server — which `index.ts` builds from `library`, `cache`,
`overrides` and `config` beside the other composition and hands in.

*Alternatives.* A Hono route for `/` in `app.ts`: refused — serving files is adapter-specific
and `static.ts` exists precisely so the Hono app has no file-serving routes (D1/D8); it would
also miss the fallback, which is where deep links land, not `/`. A Caddy-side
`templates`/`replace` directive: refused — it would move behaviour into the proxy, the same
reason the Caddyfile refuses to rewrite `Host`, and the local rehearsal and the loopback
install would preview differently from the box. A build-time prerender of one document per
model: refused — the corpus is the library, not the build, and the document would go stale
with every rename.

### D2 — The resolver reads the request's **query string**, not its pathname

`describe` is handed the whole `URL`. It reads `path` and `model` with `URLSearchParams`, the
same two names `serializeView` writes, and treats absence of `path` as the library top (the
url-navigation rule: the top is named by omitting the parameter). A `model` names a model and
wins; a `path` alone *claims* to name a directory, which D8 then makes it prove; neither
names the top.

This is the single fact that decides whether the feature works at all. Parsing the pathname
would describe every shareable URL as "the library top", because every shareable URL *is* `/`.

*Alternative.* Teaching the client to write path-shaped URLs (`/browse/Kit/x.stl`) so the
server could route on them: refused — it rewrites `url-navigation`'s whole contract for a
preview, and `serializeView` is deliberately the one writer of every history entry.

### D3 — The absolute origin is the configuration's first non-loopback `origins` entry, and the request's `Host` only as a fallback

`og:image` and `og:url` must be absolute. The deployment already declares its public identity
once, in the file that describes the whole deployment: `origins` in
`~/.config/model-browser/config.json` (`https://models.masamaeda.com` in
`deploy/demo/config.json`). The resolver takes the first entry there that is not a loopback
origin. With no such entry — every loopback install — it falls back to the request's `Host`
header with the scheme from `X-Forwarded-Proto` (`http` when absent), which makes a local
`curl` see well-formed absolute URLs against itself.

The `Host` half of the fallback is read from the `URL` the handler has **already**
constructed (`new URL(req.url)` at the top of `handle`), not re-parsed from the header, so
this change adds no new place for a malformed host to throw — a request whose host the URL
constructor refuses never reaches the resolver today either. Only `X-Forwarded-Proto` is
genuinely a header read, which is why the hook still takes `Headers` alongside the URL.

Config-first, header-second, because a header is the requester's to choose: `Host` reaches
the app unrewritten by design, and an attacker-chosen `Host` on a config-first deployment
cannot move `og:image` onto a host of their choosing. On the demo the two agree anyway — Caddy
matches one name — so the fallback is only ever exercised where there is nothing to spoof.
Loopback is recognised the way the guard recognises it; `LOOPBACK_ORIGIN` in `guard.ts` is the
existing predicate and should be exported rather than re-spelled, so the two cannot drift. The
entry that wins is restated as `new URL(entry).origin` — the spelling the guard normalises to —
so a configuration written `HTTPS://Models.Example` cannot reach `og:url` in a shape nothing
else in the process uses.

*Alternative.* `Host` + `X-Forwarded-Proto` first: rejected for the reason above.
A new `publicOrigin` configuration key: rejected — `config.ts` parsing is strict, an unknown
key stops the server, and a second name for a value `origins` already holds is one more thing
for a deployment to get half-right.

### D4 — A model's image is the existing thumbnail route, emitted only on a cache hit

The resolver resolves the model's library path through `library.resolve`, stats the resulting
file for its `mtimeMs` (what `listing.ts` puts on a `DirEntry`), asks `ThumbCache.image` for
that path and mtime, and — **only if the answer is a hit** — emits
`<origin>/api/thumb/image?path=…&mtime=…&gen=…` as `og:image`, with `og:image:type`
`image/webp` and `og:image:width`/`height` `256`. A square image is a `twitter:card` of
`summary`, not `summary_large_image`, which crops a square badly.

**`resolve` confines; the `stat` is what proves existence.** `library.resolve` does *not*
throw for a path that is merely absent — it decides confinement on the nearest ancestor that
exists and answers `join(anchorReal, ...missing)`, because a missing path is the ordinary 404
of every route that calls it. It throws only for a path outside the library, a hidden
component, an over-long path, or a virtual path it refuses. So for
`?model=/Your%20account%20has%20been%20locked.stl` the resolve succeeds and the **`stat` is
the only existence check there is**. That fixes the order of operations, and it is the one
place this branch is easy to get wrong: **the title is computed after the `stat` succeeds,
never before it.** The natural-looking shape — take the last segment as the title, then
`try { stat; cache } catch {}` — titles the fabricated path and defeats D8's whole rule.

**A model is a file, and not an archive.** The same `stat` answers the kind, and `?model=/Kit`
or `?model=/Kit/models.zip!/parts` — a directory and an archive's interior, both browsable
and neither a model — take D8's deployment strings rather than a title from their own last
segment. So does `?model=/Kit/models.zip` itself: a file on disk, a folder in the app
(`isZipName`, the listing's own predicate). A directory titled as a model is the fabricated-path hole wearing a real path.

**A `stat` throw and a cache miss are different answers.** A throw means the model is not
there, and goes to D8's deployment strings, image and all. A miss means the model is there
and its picture is not: the title and attribution stay the model's (D8's words — its display
name and its kit's credits) and only the image falls back to D5's. Collapsing the two would
either make every model on an unbaked install unfurl as the deployment — what a local
developer sees every time — or let an absent path keep its own text, which is the hole.

**Either variant is the model's picture.** The store holds two renders per entry — the
occluded one and the `noao` one a browser with AO off draws — and a hit on either is a
thumbnail of that model. The resolver asks for the occluded variant first and the plain one
when that misses, naming `ao=off` on the image URL in that case, so an install whose visitors
render with AO off (or a bake that wrote one variant) still previews its models rather than
falling back to the site image. Two cache reads at most, still no render.

**A zip entry shares the key, but not the existence check.** `library.resolve` answers
`{ fsPath: <the archive>, entry }` for a virtual path, so `stat(fsPath).mtimeMs` is the
*archive's* mtime — which is exactly the mtime `listing.ts` puts on an interior entry
(`zipStat.mtimeMs`) and therefore exactly the cache key the entry was written under. The
`path` on the wire stays the virtual path (`foo.zip!/entry`), one level only — the
architecture decision D6 that CLAUDE.md records, enforced in `parseVPath` (`vpath.ts`); a
nested one is refused before any of this.

That much needs no special case. What the `stat` does **not** do for a virtual path is prove
the entry: it proves the *archive*. `?model=/Kit/a.zip!/Your%20account%20has%20been%20locked`
stats clean, and the rule above — the title is computed after the `stat` — would then title it
by its own words, which is the whole hole reopened one level down. So for a virtual path the
**held render is the existence proof**: the path's words are used only on a cache hit (either
variant), and with nothing held the deployment answers, title, description and image alike. An
entry nobody has rendered therefore previews as the deployment even though it is really there —
accepted, and the same trade D8 takes for a zip *view*. The alternative is reading the
archive's central directory on a path a crawler chose, for a word, which is exactly what D8's
no-listing rule declines. The one trap: `mtimeMs` is
a **float** and the cache compares it with `===`, so the URL must carry it verbatim — any
`Math.floor`, `toFixed` or `| 0` on the way into the query turns every hit into a miss, on
plain files as much as on zip entries.

**The fall-through is catch-all, not typed.** The failures on this path are not one class:
`library.resolve` throws `LibraryError` for a bad or out-of-library path, `requireReady`
throws a plain `Error` when the library is not ready, `canonicalLibPath` → `parseVPath`
throws `VPathError` on a nested `!/`, and `stat` throws an `ErrnoException`. A `catch` that
named only `LibraryError` would let `?model=/a.zip!/b.zip!/c` escape to the handler's own
guard (D7), which serves the document with **no varying tags at all** — the preview silently
disappears for a class of address rather than falling back. So the model branch catches
everything — the `stat`'s `ErrnoException` included, per the paragraph above — and answers
with D8's deployment strings.

No new route: the one that exists already serves exactly these bytes with `nosniff` and
`Cross-Origin-Resource-Policy: same-origin`. CORP is a browser-enforced rule for no-cors
*embeds*; an unfurl service fetches the URL server-side and is unaffected. The `gen`
parameter is carried because it is what pins the bytes immutably — `thumbnail-image-serving`
D1, which owns the route's cache tiers — so a crawler's copy is cacheable and a re-render
moves the URL.

The hit check costs one `ThumbCache.image` read per entry document naming a model — a sidecar
read and a file read of ~5 KB, on a document already served `no-cache`. Emitting the URL
blindly would be cheaper and would unfurl as a broken image on every local install, where the
store is not baked.

*Alternative.* A dedicated `/api/preview/image?path=…` that resolves the mtime itself:
rejected — it is a second name for the same bytes, it needs its own cache-header story, and
`thumbnail-image-serving`'s requirement would have to grow a sibling. The mtime is not a
secret and appears in every listing the client already receives.

### D5 — Everything that is not a single model previews one checked-in site image

`client/public/og.png` — a 1200×630 PNG, committed, which Vite copies to the dist root. Every
view that is not a model deep link (the library top, a folder, a search, a similarity view,
the About page) uses it, with `twitter:card` `summary_large_image` for that shape.

The server cannot compose a sheet (see Context), and the two cheap alternatives are both
worse. *The folder's first model thumbnail*: it needs a listing — a walk, a cache read, or
`DirEntry.preview` from the bake — on a path a crawler chooses, which is a directory walk
triggered by an anonymous GET; and the demo's top folder previewing as one random miniature
says less than a picture of the app does. *No image at all for folders*: the top-level link is
the one most often shared, and it is the one with nothing to show.

How the file is produced is a documented one-off, not a build step: a screenshot of the demo's
grid at 1200×630, taken with Playwright (`browser_resize` to 1200×630, then
`browser_take_screenshot` to a path under the repo root — the MCP browser writes nowhere
else) and recorded in `docs/web-demo-notes.md` with the URL, viewport and posture it was
taken at so it can be retaken. It lands under `client/public/`, so it is served from the dist
root with `REVALIDATE` (`no-cache`) rather than the immutable tier, which only covers
`/assets/` — correct, since its name never changes while its content might. A screenshot of a
grid of miniatures is a photographic image: if the PNG lands above ~500 KB it becomes
`og.jpg` at q0.85 instead, which every consumer renders and which halves what a preview
costs. The name is referenced in exactly one place (the resolver), and its **shape travels with
it** — `og:image:type`, `:width` and `:height` are declared beside the file name rather than
guessed at by a consumer — so the PNG-or-JPEG choice stays one edit in one object.

**A missing file must not unfurl as the app.** The SPA fallback answers any path matching no
file with `index.html`, so a deleted or unbuilt `og.png` would be advertised as an image and
fetched as a 200 `text/html` document — annotated, at that. Two guards, because the failure is
silent either way: the resolver stats `<dist>/<the site image>` **once** and omits
`og:image` entirely when it is not there; and a cell asserts the file is present in the repo,
so a build cannot quietly ship without it. `createDescribe` returns its function
synchronously, so that one stat is `statSync` from `node:fs` — not a top-level `await`, which
would make the module's shape depend on the runtime, and not a per-request `stat`, which
would pay for the check on every document.

### D6 — Unconditional, not gated on `intro` or any new feature field

The tags are inert on a loopback install: nothing fetches them, and the two reads they cost
(the override store, already in memory; one cache read for a model URL) are trivial against a
document served `no-cache`. Gating them on `intro` would mean the one posture that needs them
is also the one where a mis-set flag silently removes them, and `features` is a report of what
a visitor may *do* (`feature-report`), not of what the server says about itself. A deployment
that does not want to be described is a deployment that is not reachable.

**The tags are unconditional; the library half of them is not.** `guard` is mounted on
`/api/*` only, so the entry document is served under whatever `Host` a request states —
including a name that resolves to this machine and is not this deployment's, which is what
DNS rebinding is. The head must not answer for the library there: `/api/dir` refuses that
`Host` outright, and a description carrying a model's display name and its kit's credits
would hand a rebound page precisely what the API withheld. So the resolver applies the
guard's own host rule itself — `isAllowedHost` in `guard.ts`, loopback plus the hosts the
configured origins name, exported rather than re-spelled — and a host that fails it takes the
deployment strings with **no library read at all**. What the deployment says about *itself*
still ships unconditionally, and the advertised origin is still the deployment's (D3), that
being the deployment's to state and not the requester's.

*Consequence to accept:* a private instance reached at a name it does declare — its own, or
loopback — leaks model display names into the documents it serves, which are the same names
`/api/dir` serves that host anyway. Confinement is the library's job, not the head's.

### D7 — Injection is a splice into the entry document's `</head>`, escaped, on documents only

The handler builds the tag block as text and inserts it immediately before the first
`</head>` in the document (the document is the build's own output, so there is exactly one and
it is well-formed). Every attribute value is HTML-escaped (`&`, `<`, `>`, `"`) and every URL
is built with `new URL`, so a display name containing a quote cannot end the attribute and a
library path cannot escape the query string. A document with no `</head>` is served unchanged
rather than half-annotated.

Injection happens only where `send` is about to return an **entry document** — `index.html` or
`about.html`. An asset is never rewritten: assets are served immutably and a rewritten one
would be cached forever with one URL's tags in it. `client/index.html` and `client/about.html`
carry only the *invariant* tags statically (`og:site_name`, `og:type`), so a resolver-less
build — the Vite dev server at 5173, a server started with `describe` unset — still declares
what it is, and the four varying tags (`og:title`, `og:description`, `og:image`, `og:url`,
plus `twitter:card`) exist only in the injected block. No tag is ever written twice, so no
consumer has to choose between two of them.

The entry document is already `no-cache` (`REVALIDATE`), which is what makes a per-URL head
safe to serve at all; nothing upstream caches it — Caddy has no cache directive.

### D8 — Titles and descriptions come from the override store, over a path the library resolved

- **A model**: title is `displayNameOf(store, path)` falling back to the entry's file name;
  description is the kit's credits as `"<author> — <license>"` from `resolveOverrides`,
  falling back to the containing folder's name. The demo's compliance surface thus travels
  with the link.
- **A directory**: title is its display name or its last path segment — but only after
  `library.resolve` answers *and* a single `stat` says the result is a directory. `resolve`
  confines rather than proves existence (it answers a joined path for an absent one, D4), so
  that `stat` is doing both jobs: the existence check and the kind check. Description
  names the library.
- **The top, the About page, and anything that did not resolve**: the fixed strings below.

**The path is resolved before any of its text is used.** This is the one rule that is about
safety rather than words. The path in the address is chosen by whoever composed the link, and
a resolver that titled a directory by the path's own last segment without checking would let
`/?path=/Your%20account%20has%20been%20locked` unfurl, under the demo's domain and beside its
name and image, as if the deployment had said it. Resolving first costs one `resolve` and one
`stat` — the same budget the model branch already spends — and makes every title either a
thing that exists in the library or the deployment's own. The same `stat` answers *kind* as
well as existence, on both branches: a directory is not a model and a file is not a folder,
so `?model=/Kit` and `?path=/Kit/x.stl` are the deployment rather than titles taken from
paths that happen to resolve. The model branch's fall-through
(D4) lands here, so it inherits the same rule rather than re-deriving it.

**The rule covers the title and the description, not the address.** `og:url` restates the
address that was requested, query and all, because that is what it is for — a consumer uses
it to canonicalise the link it was given. So a fabricated path *does* appear in `og:url`,
percent-encoded exactly as it arrived, and that is correct: it is the address the reader
already clicked, not something the deployment is made to say. Anything asserting that a
fabricated path appears nowhere must be scoped to the title and the description, or it fails
against the correct implementation and can only be greened by stripping the query from
`og:url`, which the requirement forbids.

**A zip is titled as the deployment, and that is a choice.** `?path=/Kit/a.zip` and
`?path=/Kit/a.zip!/parts` are folders in the app (`zip-browsing`) but files on disk, so the
`isDirectory` check above says no and they take the deployment's title rather than the
archive's name. A zip *entry named as a model* is the other half of the same rule and is
answered in D4: it is titled by its own name where a render is held for it, and by the
deployment where none is, because only the render proves the entry is there. Accepted rather than special-cased: the check exists so that a title is only
ever a thing the library holds, and teaching it about archives means resolving the interior
through the zip reader — a read of the central directory, on a path a crawler chose, for a
word. A shared zip view unfurls as the deployment with the site image, which is a worse
preview and not a wrong one. If it ever matters, the seam is the same `resolve` already
answering `entry`, and it is one branch.

**The fixed strings are literals in `preview.ts`.** Nothing names the deployment: `config.ts`
is strict and has no such key (adding one would be a second spelling of something `origins`
already implies), and the server cannot import the About page's copy — `client/src/about.tsx`
is a React entry that would drag the client bundle into the server. So they are written once,
in the resolver, and this is where they are recorded rather than left to the implementer:

- site name: `Model Browser`
- top title: `Model Browser`
- top / directory description: `Browse a library of 3D-printable models in your browser.`
- About title: `About — Model Browser`
- About description: `What this deployment is, and the models it shows.`

No listing, no walk, no `readdir`: the store is a map loaded at startup, the path is already
in the address, and a `resolve` plus a `stat` is the whole filesystem cost. That is what keeps
an anonymous GET from paying for a directory scan, and it is why D5 declines the
folder-first-thumbnail option.

### D9 — The trap's query gains `a[href]`; it does not become a curated focusable list

`dialog.querySelectorAll("button:not([disabled]), a[href]")` — one selector, still in DOM
order, which is what puts the credit links where a reader meets them. `:not([disabled])`
continues to govern the buttons, so the disabled end control the trap must skip (the D2 the
sibling-stepping change recorded, covered by the existing *Tab is not dead-stopped by a
disabled end control (first model)* cell) is still skipped; `[disabled]` is not a thing an
anchor has, so the one selector covers both kinds.

The panel never renders an `<a>` without an `href` — an author with no stored URL draws as a
`<span>`, a license with none draws as text, and the source row exists only when a source URL
does — so `a[href]` and `a` would select the same elements here. `a[href]` is still the right
selector, because it states the rule rather than relying on today's markup; but nothing in
this change may claim to *test* the href-less case, since there is no way to produce one
through the panel, and happy-dom focuses an href-less anchor anyway. The spec says nothing
about it for the same reason.

The ring's **order** is the load-bearing half, and it is document order through the dialog:
Previous, Next, the axis buttons, flip, Copy path, then the attribution links inside the
`<dl>`, then the Open-in pills and the model-action buttons, then Close. Appending the
anchors after the buttons would still make all three reachable while putting them nowhere
near what the panel reads — which is why the cell asserts the neighbours on both sides of the
run, not merely that each link is reached.

*Alternative.* The full canonical focusable selector (`input`, `select`, `textarea`,
`[tabindex]:not([tabindex="-1"])`, …): refused — the dialog contains none of them today, and
a selector that admits elements that do not exist is a rule nobody can falsify. When the panel
gains a field, that change extends the query and brings its own cell.

### D10 — Issue #9 closes on an observation, not on a delta

Both halves are archived (`2026-09-15-lightbox-sibling-stepping`,
`2026-09-15-grid-arrow-navigation`) and their requirements are in `model-viewer`,
`url-navigation` and `directory-browsing`. Writing a delta to restate them would put the same
normative text in the same spec twice and collide at archive. The only thing missing is that
nobody watched it work, so the only artifact is a verification task — which is the repo's own
rule that a tasks line claiming coverage is not coverage.

### D11 — An arrow with nothing focused lands on the first tile, from a document listener

`Grid`'s arrow handler is `onKeyDown` on the grid container (grid-arrow-navigation D3: the
find input and the path bar render outside `gridRef`, so container scoping — not a guard —
keeps their arrows theirs). That scoping has a hole the verification walk showed: with
nothing focused, the keydown's target is `body`, the event never enters the grid, and an
arrow does nothing at all. A fresh visitor's first arrow has no tile to start from, and a
click on the space between tiles blurs the one it had.

The fix is a second listener, on `document`, that fires only when `document.activeElement`
is `body` (or null) and focuses the first tile. Focus anywhere else is still left to the
container handler or to the control that has it, so the scoping argument D3 rests on is
unchanged: the new listener never runs while the find input, the path bar, or a tile holds
focus. It ignores modified arrows for the same reason the container handler does.

One guard beyond that: the lightbox steps models on `ArrowLeft`/`ArrowRight` from a `window`
listener whatever holds focus, and a click on its canvas can leave focus on `body`; the
document listener stands down while an `[aria-modal="true"]` element is in the document, so
that press steps once and the grid behind the dialog does not take focus. The lightbox
pulls focus back into itself on every step, so the cell for this guard asserts through a spy
on the tile's `focus` rather than through `activeElement` — the latter is green with the
guard removed.

Every arrow, not only the sideways ones, lands on the first tile: with no tile to step from,
`ArrowUp`/`ArrowDown` have no row to move along either, and a visitor pressing either
expects the grid to answer. Alternatives declined: focusing the first tile on mount (steals
focus from the path bar, and a visitor who typed an address would lose it), and a
`tabindex="0"` roving pattern over the container (a redesign of D3's scoping for the same
one gesture).

## Risks / Trade-offs

- **A consumer that will not render WebP** shows no image for model deep links. The three
  services issue #11 names — Discord, Slack and X — do render it; **Facebook and LinkedIn are
  reported not to**, and they are the two where a model deep link would therefore unfurl
  titled and described but blank. *This is relayed, not verified from here*: it is a claim
  about someone else's crawler, and the way to check it is each service's own sharing
  debugger against a live model URL, which task 6.x notes. → The site image (D5) is a PNG or
  JPEG, so the most-shared link — the top — is unaffected everywhere; `og:image:type` declares
  `image/webp` so a consumer that cannot use it declines cleanly rather than showing a broken
  tile. If the two matter enough later, the fix is a PNG variant of the thumbnail route, not a
  change to this design.
- **The tags are invisible in the ordinary dev loop** → `bun run dev` serves the entry document
  from Vite on 5173, which proxies only `/api` to the server; nothing Vite serves passes
  through `createStaticHandler`, so no amount of browsing at 5173 will ever show a tag. They
  are observable only on 3177, and only after `bun run build` has produced `client/dist`.
  That is also the trap CLAUDE.md already warns about from the other direction — 3177 serves
  whatever `dist/` holds, however stale — so the mitigation is a clause in that bullet and a
  `rm -rf client/dist` when the verification is done.
- **A local install unfurls the site image for every model** (nothing baked, so D4's hit check
  always falls through) → accepted; it is the honest answer, and warming a render from a
  crawler's GET is an explicit non-goal.
- **The entry document gains one cache read and one `stat` per model deep link** → bounded by
  D8's "no walk" rule: an anonymous GET can cost at most a `resolve`, a `stat` and one small
  file read, whatever path it names. `library.resolve` is the only way a request's path
  becomes a filesystem path (`library` D3), so confinement is unchanged.
- **`og:image` outlives its `mtime`** — a model re-saved after a crawler cached the document
  makes the image URL 404 → the document is `no-cache`, so the next fetch carries the new
  mtime; a stale unfurl in someone's chat history showing no image is not worth a redirect
  route.
- **A display name is attacker-controlled on a library whose overrides someone else wrote** →
  D7's escaping is the whole mitigation, and it is worth a cell of its own (a name carrying
  `"` and `<`), because an unescaped one is an HTML injection into every document the server
  serves.
- **Touching `client/index.html` and `client/about.html` while `landing-page` is in flight** →
  `landing-page` owns `about.html` (`landing-page` D2); the edit here is two invariant `<meta>`
  lines. tasks.md declares the ordering: land this after `landing-page`, and re-read both
  files before editing.
- **The site image is a screenshot and will look dated** → it is one committed file with a
  recorded recipe (D5); retaking it is not a code change.
