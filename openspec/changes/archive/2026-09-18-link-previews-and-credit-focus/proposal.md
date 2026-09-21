## Why

Two of the demo's open issues are about a link nobody can follow. A URL shared into Discord,
Slack or Twitter unfurls as bare text: `client/index.html` carries a `<title>` and nothing
else, so the corpus the demo exists to show never appears (issue #11). And the attribution
the CC-BY corpus obliges the demo to display is mouse-only: the lightbox's focus trap
enumerates `button:not([disabled])`, so the author, license and source links are outside the
Tab cycle entirely (issue #27). Both surface on the same public posture, and both are small.

Issue #9 (lightbox prev/next, grid arrow keys) is bundled for **closure only** — see *What
Changes*.

## What Changes

- **Link-preview metadata on the entry document (#11).** `createStaticHandler`
  (`server/src/static.ts`) gains an optional `describe` hook: given the request URL it
  answers a title, an absolute image URL, a description and an absolute canonical URL, and
  the handler splices the Open Graph / Twitter tags into the entry document's `<head>`
  before serving it. The resolver is a new `server/src/preview.ts`, wired in
  `server/src/index.ts` from the library, the thumbnail cache, the override store and the
  parsed configuration, so `static.ts` stays Node-portable and free of Hono routes
  (public-deployment D1/D8).
- The SPA fallback is where a crawler's GET of a deep link lands, and the client's deep links
  are query parameters on `/` (`serializeView` in `client/src/lib/urlState.ts`), so the
  resolver reads `path` and `model` from the **query string**, not the pathname. A model deep
  link previews that model's cached thumbnail; a folder or the library top previews a
  checked-in site image.
- **No new API route.** A model's preview image is the existing
  `GET /api/thumb/image?path=…&mtime=…&gen=…` (`thumbnail-image-serving`), with the mtime
  resolved server-side while the document is rendered.
- **A checked-in site image**, `client/public/og.png`, for every view that is not a single
  model. There is no image library on the server, so a composed "corpus contact sheet" is not
  something the server can draw; the sheet the app shows is drawn client-side in WebGL.
- **A path in an address is resolved before any of its text is used.** A title taken from an
  unresolved path would let a fabricated link
  (`/?path=/Your%20account%20has%20been%20locked`) unfurl attacker-written text under the
  demo's domain beside its name and image. A directory is titled by its own name only after
  the library resolves it; everything else is titled by the deployment.
- **Unconditional, not feature-gated.** The tags are inert on a loopback install and their
  absence on the demo is the whole bug; a flag here would be one more way for the demo to
  ship without them.
- **Credit links join the lightbox focus trap (#27).** `ViewerLayer.tsx`'s lightbox key
  effect builds `focusables` from `dialog.querySelectorAll("button:not([disabled])")`;
  the query gains `a[href]`, so the panel's author, license and source links enter the Tab
  ring in DOM order. `:not([disabled])` still governs the buttons, so the disabled end
  control the trap already had to skip is still skipped.
- **An arrow with nothing focused lands on the first tile.** The verification walk for #9
  found that with nothing focused an arrow does nothing: `Grid`'s handler is on the grid
  container, and a keydown targeted at `body` never reaches it. A document-level listener
  focuses the first tile when the active element is the body and no modal is open; every
  other case is left exactly as the archived `grid-arrow-navigation` scoped it.
- **Issue #9 closure, no code.** Both halves shipped and archived as
  `openspec/changes/archive/2026-09-15-lightbox-sibling-stepping` and
  `openspec/changes/archive/2026-09-15-grid-arrow-navigation`, applying requirements to
  `model-viewer`, `url-navigation` and `directory-browsing`; the GitHub issue is open only
  because nobody walked the shipped behaviour in a browser. This change carries that walk as
  a task — ArrowLeft/Right and the on-screen arrows in the lightbox, arrow keys across the
  grid — so the issue closes against an observation. No spec delta for #9 itself: restating an
  archived requirement would put the same normative text in one spec twice; the
  nothing-focused case above is new behaviour and MODIFIES that requirement.

## Capabilities

### New Capabilities

None. Both behaviours belong to capabilities that already exist.

### Modified Capabilities

- `public-deployment`: ADDs a requirement that the entry document carries link-preview
  metadata naming the view its URL names. The capability's existing *The server serves the
  built client* requirement is left untouched — `entry-stat-revalidation` is also active
  against this capability (it ADDs *The environment overrides single keys*), and two changes
  MODIFYing one requirement collide at archive.
- `model-viewer`: ADDs a requirement that the lightbox panel's links participate in the focus
  trap. The existing *Lightbox expanded view* requirement already says the panel's
  **controls** do; a link is not a control and the sentence is not being rewritten, so the new
  concern is its own requirement. `adaptive-ao-default` is active against this capability
  too, ADDing *Occlusion defaults by measurement* — no overlap.
- `directory-browsing`: MODIFIES *Arrow-key focus movement across the grid* so that an
  unmodified arrow with nothing focused lands on the first tile (no modal open), and carries
  the requirement's existing scenarios unchanged. No other active change carries a delta
  against this requirement (checked 2026-09-18).

## Impact

- `server/src/static.ts` — `createStaticHandler` gains the optional `describe` option and the
  head-injection path for the entry document.
- `server/src/index.ts` — builds the resolver from `library`, `cache` and `overrides` and
  passes it in; the public origin is read from the already-parsed `config`.
- `client/public/og.png` — new checked-in asset (Vite copies `public/` to the dist root; the
  repo has no `client/public` directory yet).
- `client/index.html` and `client/about.html` — the two *invariant* tags (`og:site_name`,
  `og:type`) only, so a build served without a resolver still declares what it is and no
  varying tag is ever written twice.
- `client/src/viewer/ViewerLayer.tsx` — one query string in the lightbox key effect.
- `client/src/components/Grid.tsx` — a document-level `keydown` listener beside the
  container handler, active only while nothing holds focus.
- Tests: `server/test/static.test.ts` (injection, escaping, gating), a new server cell file
  for the resolver against a fixture library + cache, and
  `client/test/lightboxPrevNext.test.tsx` (the Tab ring) and
  `client/test/gridArrowNav.test.tsx` (the nothing-focused arrow and its lightbox guard).
- No OS-specific surface: nothing spawns, no new per-OS path or `~/.config` file, so
  `docs/platform-surface.md` is unchanged.
- `CLAUDE.md` — one clause on the "3177 also serves `client/dist`" bullet. **The tags are
  invisible in the ordinary dev loop**: under `bun run dev` the entry document is served by
  Vite on 5173, which proxies only `/api`, so nothing it serves passes through
  `createStaticHandler`. They are observable on 3177 alone, and only after a `bun run build`
  — which is the same bullet's stale-`dist/` trap seen from the other side.
- No new dependency. Nothing is added to the demo's deployment files — `deploy/demo/config.json`
  already names the public origin the tags need.
