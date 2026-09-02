## Why

Every security decision in this server rests on one premise, stated in `guard`'s own
comment and in the requirement *API restricted to the app's own origin*: the server
reads and serves the user's model library **as the user**. Loopback binding, the
refusal of a non-loopback `Host`, and never emitting CORS all follow from it. A public
deployment inverts the premise — and the app cannot be deployed by removing the guard,
because the guard is the only thing standing between a stranger and the user's disk.

Half of the inversion is already paid for. `library-root` made every path on the wire
library-relative and put `resolve` in front of every path route, so the address space is
root-confined and an absolute-path API no longer exists. `server-feature-report` built
the seam a deployment declares itself through, and its `index.ts` construction site
carries a comment naming this change as the one that fills it in. What is left is the
origin half: a guard that can be told its origin, a bind address that is not hardcoded,
the four surfaces a stranger must not reach, and **refusal at the routes**, not merely
buttons withheld in a client that a stranger does not have to run.

This is the first of the five changes `web-demo-backlog` 1.3 became. It is the only one
with no dependency on work in flight, and nothing about it is demo-specific: what it
produces is an app that can be *configured* for where it runs, which is also what the
eventual Electron distribution needs.

## What Changes

- **The deployment's settings join the existing `config.json`**, beside `root` — the
  capability fields, the allowed origin, and the bind address. Not a new file and not
  `.env`: no justification was ever recorded for the `config.json`/`launch.json` split,
  and the rule this change records is that a separate file is for a different *authoring*
  concern, while one file describes *this deployment*.
- **BREAKING (operator-visible): a malformed `config.json` fails loudly at startup.**
  Today `configuredRoot` treats absent, unreadable and malformed as one case — "no root
  here" — so a typo in the file is indistinguishable from having no file. Once that file
  also carries the guard's origin, silently falling back is silently changing a security
  posture. An absent file stays quiet and means the defaults.
- **BREAKING (operator-visible): `MODEL_BROWSER_ROOT` stops suppressing the file.**
  `configuredRoot` returns before reading it today, so `bun run dev` never parses
  `config.json`. The env var now overrides only the `root` key; `MODEL_BROWSER_CONFIG`
  still chooses which file is read.
- **The guard takes its origin from configuration**, loopback remaining the default, and
  the bind host and port stop being literals in `index.ts`.
- **Four capability fields, one per surface, each with its own default**: thumbnail
  writes (on), the launcher (on), the chat tab (**off** — a placeholder with no backend),
  and the semantic states a visitor can do nothing about (collapsed). The built-in set is
  the *maintained* configuration, whose audience is the distributed Electron app;
  authoring flags is the exceptional path.
- **Every field is paired with refusal at the routes it describes**, from one source, as
  the feature-report capability requires. `PUT /api/thumb` consults nothing today;
  `/api/open` and `/api/open-with` spawn processes, which on a container is a live
  concern rather than a cosmetic one.
- **A visitor's orbit persists in their own browser.** With thumbnail writes declared
  off, the client's `putThumb` sites route to `localStorage`, and camera reads fall back
  localStorage → stored sidecar (`web-demo-backlog` 2.1).
- **`SidePanel`'s tab fallback becomes `search`.** Its `tabStore` resolves an absent key,
  an unknown value *and* a recorded `'chat'` all to chat, so withholding the chat tab
  without this strands every profile that never touched the panel on a tab that is not
  there. The file already documents this hazard for the Similar tab.
- **The built client is served by the server.** Nothing serves `client/dist` today; Vite
  dev is the only thing that has ever served the app.
- **`ALL_FEATURES` is renamed and re-documented** — it is the supported set, not "every
  capability on".
- **The demo's own `config.json` is checked into the repo** and tested as a named second
  configuration, so a public deployment cannot drift from what CI proves.

## Capabilities

### New Capabilities
- `public-deployment`: how a deployment of this server is configured and served — the
  configuration file's keys and loading rules beyond `root`, the bind address, the
  serving of the built client, and the rule that the built-in defaults are the
  maintained configuration while an authored configuration is the exceptional path.

### Modified Capabilities
- `directory-browsing`: **MODIFY** *API restricted to the app's own origin*. The title
  already says "the app's own origin"; only the body hardcodes 127.0.0.1. Restated so
  the app's origin is what it is configured to be, with loopback the default, and with
  the reasoning that made loopback the answer preserved rather than deleted.
- `library`: **MODIFY** *The root is configured, and its absence is a state*. The file is
  read whether or not the environment supplies the root, and a malformed file is a
  startup failure rather than an absent root.
- `feature-report`: **ADD** a requirement naming this change's four fields, their
  defaults, and the pairing of each with refusal. ADD rather than MODIFY, so a later
  field-owner does not collide with this delta at archive.
- `model-thumbnails`: thumbnail writes are refused when the deployment declares them off,
  and a client whose writes are refused keeps its framings locally.
- `chat-panel`: the tab is withheld when the deployment declares it off, and which tab a
  profile falls back to.
- `app-launch`: the launcher is withheld *and* its routes refuse.
- `semantic-search`: the index states a visitor cannot act on are collapsed into one.

## Impact

**Server.** `guard` (its two loopback patterns); `configuredRoot` and the config-file
read in `library.ts`; `createApp`'s `features` parameter and `ALL_FEATURES`; the
`PUT /api/thumb`, `/api/open` and `/api/open-with` handlers; `index.ts` for the bind
address, the static serving, and the construction of the report — Bun-only APIs stay
confined there (D1).

**Client.** The `putThumb` call sites in `entryActions`, `useThumbnails` and `App.tsx`,
and the camera read that precedes them; `SidePanel`'s `tabStore` and its tab host; the
index-state rendering in `SidePanel`. All I/O continues through `ApiClient` (D1); no
surface learns a deployment kind, only capabilities.

**Shared.** `FeatureReport` in `shared/types.ts` grows three fields.

**Ordering.** No dependency on any change in flight. `bulk-thumbnail-jobs` also touches
`SidePanel` and adds the fifth capability field for its own surfaces — additive on both
sides; whichever lands second adds that field. Nothing here touches the requirements
`search-cancellation` or `thumbnail-image-serving` add.

**Out of scope**, each its own change: the landing page (its first task is deciding its
contents), the context-menu actions (Download replacing Open-in/Open-with, Copy path
becoming Copy link), the corpus bake, and the credits page. The credits page is
go-live gate 3.2 and CC-BY requires displayed attribution; it wants a decision on
whether it belongs with the landing page — one visitor-facing page change with one set
of copy decisions — or stands alone as a generated document with a route. This proposal
recommends the former and does not settle it.
