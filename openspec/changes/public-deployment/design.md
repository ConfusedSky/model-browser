## Context

The server's threat model is one sentence, written into `guard`'s own comment and into
the requirement *API restricted to the app's own origin*: it reads and serves the user's
library **as the user**. Loopback binding, the `Host` refusal, and the absence of CORS
are consequences of it, not independent choices.

Two of the three things a public deployment needs are already built. `library-root` made
every path on the wire library-relative and put `resolve` in front of every path route,
so there is no absolute-path API left to traverse. `server-feature-report` built the
declaration seam, and left the comment at `index.ts`'s `createApp` call naming this
change as the one that fills it in. What remains is: a guard that can be told its
origin, and the surfaces that are safe for one user at a keyboard but not for a stranger
— writes to a shared cache, process spawning, an unfinished chat tab, and an account of
a machine the viewer cannot reach.

The decisions below were taken with Masa on 2026-09-02 and are recorded in
`docs/web-demo-notes.md` (commit `097aeae`); this document is where they become
implementable. Everything it opened is answered at the bottom; nothing is left hanging.

## Goals / Non-Goals

**Goals:**
- One configuration file describes a deployment: its library, its capabilities, its
  origin, its address.
- Every withheld capability is refused at its route, from the same value the report is
  built from.
- The maintained configuration — what a distributed desktop build runs — is what the
  suite exercises first, and the shipped deployment's configuration is exercised second.
- Nothing in the client learns that a deployment is "the demo".

**Non-Goals:**
- The landing page, the context-menu actions, the corpus bake, the credits page — each
  its own change.
- Multiple simultaneous deployments, per-request capability variation, or runtime
  re-reads of configuration. The report is per-process; restart-after-editing is the rule
  every configuration in this app already follows.
- Rate limiting, TLS, and the reverse proxy. Those are deployment infrastructure, not
  this app.

## Decisions

### D1: The configuration joins `config.json` rather than becoming a new file

Asked directly by Masa: why are `config.json` and `launch.json` two files? **There is no
recorded justification.** `open-in-slicer` introduced `launch.json`; `library-root`'s D4
introduced `config.json` citing "the `launch.json` precedent, `loadLaunchConfig`";
`server-feature-report`'s D4 cites it again — all three for the *loading mechanism* (XDG
config home, env override, read-once), never for the file being separate. `launch.json`
appears in no spec at all. The split is accretion.

The rule this change records, because it was missing: **a separate file is for a
different authoring concern; the same file is for what describes this deployment.**
`launch.json` survives that test — hand-authored argv templates naming the machine's
installed applications, normally absent, and the one configuration a public deployment
never has. The deployment's origin, capabilities and address fail it: they describe the
same deployment `root` already describes, they must be coherent with it, and splitting
them lets a container mount half of one.

Alternatives: a third file (rejected — compounds an unjustified pattern and adds a third
instance of the restart-after-editing gotcha); `.env` (rejected — a third mechanism where
two exist, and it cannot express a nested capability object without inventing a naming
convention); environment variables alone (rejected — `MODEL_BROWSER_ROOT` is the cautionary
example: it was chosen as the demo's selector in 2026-08-28's notes, and `library-root`
turned it into an ordinary local setting two days later, silently invalidating that plan).

### D2: The file is always read; a malformed file stops the server

`configuredRoot` returns before touching the file whenever `MODEL_BROWSER_ROOT` is set,
so `bun run dev` has never parsed `config.json`. That must invert: the environment
variable overrides the `root` key alone, `MODEL_BROWSER_CONFIG` still selects the file,
and everything else in it takes effect regardless.

**The file is not read once today, and that has to be fixed rather than inherited**
(found in review). `configuredRoot` is called from `evaluate`, and `compute` calls
`evaluate` on *every* `state()` while the library is unsettled — so an unconfigured
server re-parses `config.json` on every request. That is not a config-reload feature:
`evaluate`'s own comment says "every not-ready state is a question about the filesystem
right now, and is asked again every time", and it exists so a volume mounted after start
needs no restart. Re-reading the file is a side effect of re-running `evaluate` whole.
Two things say so: `library-root`'s D4 states the intent as "Read once at start; the
`Library` object exposes `refresh()` so a later change can repoint without a restart",
and CLAUDE.md tells the reader "no route re-reads the file". The documentation and the
code already disagreed; nothing depended on it, so nobody noticed.

Once this file also carries capabilities, an origin and a bind address, its keys have two
lifetimes — those are settled at start by construction, while `root` is currently
re-derived per request — and "malformed fails loudly at startup" has no meaning for a
file that goes malformed at request #400.

**Decided (Masa): split the two questions.** The file is parsed exactly once, at start,
for every key. A not-ready re-evaluation keeps re-asking the *filesystem* — is the root
present, does a marker stand above it — without re-reading the file. `refresh()` keeps
re-probing the filesystem and gains an explicit re-read when Electron's file dialog needs
one. The volume-mounted-later behaviour, the only one anything relies on, is untouched;
the configuration gets exactly one moment at which it can be found malformed; and the
code comes to match what both D4 and CLAUDE.md already claimed.

Two loose ends the wording must not leave (found in verification). `refresh()` has no
caller outside `library.ts` today, so "gains an explicit re-read" is a seam with no
consumer — it stays a seam, named for Electron, not built speculatively. And a re-read of a
file that has become malformed since start cannot mean "fail to start", since the server is
already running: it keeps what it read at start and reports, which is the only answer that
does not turn an editing slip into an outage. Note also that `compute`'s missing-to-ready
recovery calls `evaluate` on a library that *was* ready, so the rule is "re-evaluation
re-asks the filesystem", not "re-evaluation happens only while not ready".

Alternatives: keep the re-read and load only the deployment keys once (rejected — it
needs a rule for what a mid-flight malformed file means, and no answer is good, since the
origin was baked at start regardless); load everything once with no filesystem
re-evaluation (rejected — that discards the mounted-later behaviour, which is the actual
reason the re-evaluation exists). The price of the decision: writing `root` into
`config.json` under a running unconfigured server now needs a restart, which is what
CLAUDE.md already instructs.

Today's comment — "Absent, unreadable or malformed all mean the same thing: no root
here" — becomes wrong the moment that file carries the guard's origin. **Absent stays
silent** (running unconfigured is the ordinary case). **Present-but-unparseable stops the
server**, naming the file.

Refuse-to-start over a loud report-and-continue, for two reasons. A misparsed file means
the *capabilities* were not read either, so continuing serves under a posture nobody
authored — and since the defaults are loopback, a public box would come up answering
nothing while looking healthy. And it is a deploy-time error, where the operator is
watching.

This does sit against a recorded priority: the demo's "the link is never dead" outranks
almost everything. The tension is smaller than it looks — a server that comes up on
loopback defaults when its config was meant to name a public origin serves a dead link
too, just an undiagnosable one. Refusing to start makes the same outage legible. Noted
rather than dismissed: an operator's typo takes the site down either way.

Unreadable-for-permissions is treated as malformed, not absent: the file was authored.

### D3: The guard is told its origins; loopback is the default

`guard`'s `LOOPBACK_ORIGIN` and `LOOPBACK_HOST` become the configured allowed set, whose
default is exactly today's two patterns — so an unconfigured server is byte-identical in
behaviour. The guard keeps every other rule unchanged: absent `Origin` still passes (curl,
same-origin GETs), non-matching `Host` is still refused, CORS is still never emitted, and
model bytes keep `application/octet-stream` + `nosniff`.

The guard stays on `/api/*` only. The built client is public files; guarding them would
make the app unloadable from its own origin before the client could tell anyone why.
The rebinding defence lives on the API, where the data is.

**An allowed origin is not a trusted user.** This is the sentence the delta puts in the
requirement, because it is the one a future reader is most likely to lose: on a public
deployment the origin check stops other *sites*, and nothing else. Confinement (`library`)
and refusal (`feature-report`) are what stop the visitor.

### D4: One field per surface, each with its own default

Masa's call. One coarse flag would be a mode name in disguise, which the feature-report
capability forbids by construction. Five fields, named for the thing they govern, `true` meaning offered, following
`thumbWrites`:

| field | default | governs |
|---|---|---|
| `thumbWrites` | on | writes to the thumbnail cache |
| `appLaunch` | on | all three launcher routes |
| `chatTab` | **off** | the placeholder tab |
| `hostDetails` | on | host locations, operator remedies, and how a dependency's conditions are reported |
| `maintenance` | on | operations on the server's own derived state |

**`maintenance` is the field that was going to be deferred, arriving early.** The plan was
to leave the bulk-job surfaces' field to `bulk-thumbnail-jobs`, whose design says "The seam
is declared in the delta so 1.3 can gate without modifying this capability." Then
`POST /api/reload` turned up ungated (verification round), and dropping caches and running
bulk renders are the same question — *may a viewer act on this server's derived state?* So
the field exists here, with `reload` as its first consumer.

**What that change actually did, and what this one therefore has to fix** (found reviewing
against the tree, 2026-09-07): `bulk-thumbnail-jobs` landed on 2026-09-03 without a field
of its own, gating its surfaces on **`thumbWrites`** — the only capability the report
carried — at `App.tsx`'s jobs enablement and the two `entryActions` job commands. Its
capability spec says only that those surfaces are offered "where the server's feature
report declares that capability on", naming no field, which is the vagueness that let the
drift pass. So they are split by what they do rather than left where they landed:

| surface | gate | why |
|---|---|---|
| generate renders | `thumbWrites` | it writes thumbnails; with writes off it is a loop that renders and discards |
| reset framings | `maintenance` | it destroys derived state for every viewer, exactly as `reload` does |
| `POST /api/reload` | `maintenance` | the consumer this field was created for |

Left unsplit, both mixed configurations are wrong in a way a reader would have to run to
discover: `thumbWrites: false, maintenance: true` withholds a maintenance surface for the
wrong reason, and `thumbWrites: true, maintenance: false` offers a jobs panel whose reload
the server refuses.

**`hostDetails` absorbed what was going to be a separate index field** (Masa, 2026-09-03).
They were one rule written twice: the host rule already forbids offering "a remedy only an
operator can perform", and an index condition is *named by* its remedy — start the service,
mount the volume. The same rule already covered the index's `detail` under "any explanation
an external service supplies verbatim". Keeping them apart would have let a deployment
collapse index states while leaking the library's top, which is the same incoherence that
argued for keeping `hostDetails` whole in D11. (The first review round called this
quotation non-verbatim and it was paraphrased away; the verification round found it
verbatim in that change's Risks, so it is restored — a reminder that a reviewer's citation
check is itself a citation.)

**The defaults are the maintained configuration**, not a pile of initial values, and
their audience is the eventual Electron distribution (D1's seam). The chat tab's default
is **off**: it is a placeholder whose spec says submitted input "MAY be ignored or echoed
locally", and an unfinished tab is clutter in a shipped desktop app and a poor first
impression on a public link. It stays declarable, so the day chat gains a backend the
default flips and the deployment that wants it early says so.

Consequence to state where a reviewer will meet it: `ALL_FEATURES` is now a false name —
it is the *supported* set, not every capability on — and all-on becomes a configuration
nobody runs. The feature-report capability's *Everything on changes nothing* scenario is
therefore an inertness proof for the report mechanism, not a description of the shipped
app. It stays valuable and stays true; it just stopped being a picture of anything.

### D5: Declaration and refusal come from one value, and refusal is at the route

The feature-report capability requires this pairing and assigns it to whoever turns a
field off — this change. The value already flows: `createApp` takes the report as its
`features` parameter and `index.ts` constructs it. Routes read that same object; nothing
re-derives capabilities from configuration a second time.

Refusal must be at the route rather than in the client, and the reason is not
theoretical. `PUT /api/thumb` consults nothing today, and its cache is keyed by path
alone for cameras — so an accepted anonymous write re-frames the model *every later
visitor* sees. `/api/open` and `/api/open-with` spawn detached processes on the host.

**All three launcher routes run commands, not two** (found in review). `/api/apps` looks
like a read, but `report()` loops the handled model types calling `queryDefault`, whose
builtin execs `xdg-mime` and then reads the machine's application entries for their
names — deliberately per request, since a chooser can rewrite the registry mid-session.
It is also in `UNGATED`, so it answers before the library is ready. On a public origin
that is a stranger triggering process spawns and receiving a list of the operator's
installed applications. Its refusal must short-circuit before `report()`, not filter
what `report()` returned.

A client-side gate protects only clients that run our JavaScript.

A refusal answers distinguishably from a failure, so the client can tell "not offered
here" from "went wrong" without inferring it from a status code alone.

### D6: The client's write routing decorates `ApiClient`, leaving the call sites alone

With writes declared off, a visitor's orbit persists in their own browser
(`web-demo-backlog` 2.1). Six call sites write today — three in `entryActions`, one in `useThumbnails`, one in
`App.tsx`, and one in `bulkJobs` (the generate job, which arrived with
`bulk-thumbnail-jobs`) — and they want different things: some send a rendered image, some
send a camera, some send both.

Rather than gate five sites, install a decorator over `ApiClient`'s thumbnail read and
write when a known report declares writes off: the write drops the PNG (the deployment's
baked image is the one to show), stores the camera and axis in this browser, and answers
as a write would; the read overlays any locally-stored orientation onto what the server
returned. The precedence the delta states — local, then server, then an orientation
source, then default — then holds at one place instead of five, and D1's rule that all
client I/O goes through `ApiClient` is what makes that the natural seam.

Installed **only** on a known report declaring writes off. The feature-report capability
is explicit that not knowing must never relocate where a user's data is stored, so an
unresolved or failed report keeps writing to the server.

The decorator answers "as a write would", and `webp-thumbnails` (archived 2026-09-07) gave
that answer meaning: `ThumbPutResult.dropped` says the pixels did not reach the store, and
`renderEntryThumbnail` turns it into the `skipped` outcome so a job's count never claims a
cache filled while nothing was written to it. A locally-stored orientation is the same
shape of event — the orientation landed, the pixels did not — so the decorator sets that
flag rather than reporting a clean write. Otherwise a deployment running generate with
writes off reports every model as rendered, which is the accounting bug that change fixed,
arriving from the other direction.

**Hard ordering: after `thumbnail-image-serving`** (found in review; Masa's call). That
change's *A listing-known thumbnail is drawn without a lookup* has the listing entry carry
"the write generation and the stored camera and axis", and has the client draw the tile
"carrying the entry's camera, axis and generation as a lookup would have" — without
issuing a lookup at all. So the server's camera reaches the client by a second path that
does not pass through `getThumb`, and on a deployment whose thumbnails are all baked that
path is *every* tile: the decorator's overlay would never run, and a visitor's stored
orbit would be ignored exactly where it matters. This change therefore lands after that
one and applies the overlay where the tile state is seeded, covering both arrivals. The
proposal's earlier claim that nothing here touches what `thumbnail-image-serving` adds was
true of the spec text and false of the mechanism.

Rejected alternative: relocate the overlay now to the seeding function and land in either
order. That function is being rewritten by the change in question, so writing against it
today means writing against a moving target.

Alternatives: gate each call site (rejected — five copies of one rule, and the next call
site added forgets it); a separate camera store the sites consult first (rejected —
that is the decorator with extra steps, and it splits the precedence rule across two
modules).

### D7: The tab fallback changes; the recorded value does not

`SidePanel`'s `tabStore` parses `raw === 'search' ? 'search' : 'chat'` — an absent key,
an unknown value, and a recorded `'chat'` all resolve to chat. Withholding the tab
without touching this strands every profile that never opened the panel on a tab that
does not exist. That file already documents the identical hazard for the Similar tab,
which is excluded from the store's type so that `tabStore.write('similar')` will not
compile; this is the same lesson arriving from the other direction.

The fallback becomes: resolve to a tab that exists, preferring the recorded one. The
recorded *value* is not rewritten — a profile that recorded chat and then visits a
deployment withholding it must not come home with its preference erased.

**Two fallbacks, not one** (found reviewing against the tree, 2026-09-07). Since
`bulk-thumbnail-jobs`, `SidePanel` also falls back at *runtime*: when the library tab goes
away it moves a viewer sitting on it to `'chat'` — the very tab a deployment may withhold.
Fixing the store's parse alone leaves that path landing on nothing. Both resolve through
one rule: a tab that exists, preferring the recorded one.

### D8: Static serving lives in the runtime entry point

Serving files is adapter-specific, so under D1 it belongs in `index.ts` and not in the
Hono app, which must keep running on Node unchanged for the Electron seam. API routes
win over static ones, and `/api/` is **reserved**: a 404 under it is final and must never
fall through to the entry document, or a client bug becomes an HTML body with a 200. A
request matching neither is answered with the client's entry document so a deep link
opened cold resolves in the client.

Two details the trip-reduction thread already asked of this change and the first draft
dropped (found in review). The built bundle is immutable and hashed, so its assets are
served `immutable` with a long max-age while the entry document is `no-cache` — the notes
name long-lived caching of static bundles as a first-class concern for an origin a visitor
may be far from. And the served bundle is **compressed**: ~868 KB raw against ~241 KB
gzipped, and on the demo box that raw transfer measured 1.34 s of a 1.71 s first load for
a US visitor against an EU origin (`docs/web-demo-notes.md`, 2026-09-05). A change whose
own argument is "one process rather than a separate static host" cannot leave its largest
single transfer to a proxy it does not require. And the allowed host set must always
retain loopback alongside any configured origin, or a same-box health check against the bound port is refused by the
guard; a reverse proxy that rewrites `Host` is the case a local curl cannot simulate. A server with no built client
serves its API exactly as before — the local development loop, where Vite serves the
client, must not start depending on a build.

### D9: Only the viewer's account of the index collapses — under the host field, not one of its own

The states exist because each names a different repair: start the service, plug in the
volume, restart a wedged process. A visitor can perform none of them, so offering those
remedies is worse than useless — it also describes the operator's machine to a stranger.

What does **not** collapse: *warming*, because a container's boot is a real wait and
"come back in a moment" is honest; and *outside the collection*, because that is a fact
about where the viewer is browsing, which they can act on. And the server keeps every
distinction internally — the operator's own diagnosis depends on them. What the viewer *reads* collapses in `SidePanel`'s state
description.

**But the collapse is not only a client concern, and the first draft of this decision said
it was** (found in the verification round). `indexStatus` composes `detail` from the
index's own `failure.reason` and `hint` — mini-classify's free text, able to name its cache
directory — and that string leaves the server on three routes: `/api/semantic/status`
answers the status object wholesale, and both `POST /api/semantic` and
`/api/semantic/similar` put it in their 503. A client-side collapse leaves `curl` returning
what the sentence was rewritten to hide, which is the very argument D5 makes against
client-side gating. So under the host field the routes withhold `detail`; the server keeps
composing and logging it, because the operator's diagnosis depends on it. `semantic.ts`'s
own reasoning is untouched — what changes is what the routes put on the wire.

### D10: The shipped deployment's configuration is committed and tested

Masa's call, and it resolves the wrinkle the "defaults are the maintained set" framing
creates: if authored configurations are the exceptional path, the public deployment would
otherwise be, by definition, the untested one — a bad property for the most visible
instance of the project. So its `config.json` is committed to the repository rather than
hand-authored on the box, and the suite exercises that exact combination as a second
named configuration. Two tested configurations, and "you are on your own" applies only to
configurations nobody ships.

### D11: The host is a capability of its own, and the leak is wider than the index

Found in review, and the sharpest finding against the draft: D9's reasoning — a remedy
that is not the viewer's, describing the operator's machine to a stranger — was applied
only to the semantic index, while the same leak runs through four other paths.
`shared/types.ts` documents the library state's `top` as "The **filesystem** path of the
library's top", which `App.tsx` holds and hands to the lightbox and copy-path, because the
`library` capability *requires* a copied path to be a filesystem path. The not-ready
envelopes in `createApp`'s gate middleware name the configured root for `missing` and both
locations for `nested` — on every path route, to anyone — because the same capability
requires naming them, mounting being the remedy. `SidePanel` prints the index's own
`detail` beside the state sentence, and that text is mini-classify's, free to name its
cache directory. And the find-similar copy tells the reader to "run the classifier over
it". Each is correct for the user whose disk it is, and wrong for a stranger.

So the rule is stated once, as a capability of its own — **whether the machine the server
runs on is the viewer's concern** — rather than patched into four places. Default: the
host *is* the viewer's concern, since on a personal installation the viewer is the
operator and these details are the point.

Masa's call on scope: this change takes it rather than handing it to the sibling
context-menu change, and the top is withheld **only where the deployment declares it** —
copy-path keeps yielding a filesystem path everywhere else, which is what makes it useful.

That makes five fields, not four. It sits slightly against the "one field per surface"
rule, since this one governs several surfaces. **Kept whole (Masa, 2026-09-03), and that
is the settled answer, not a lean:** those surfaces share one question, and splitting it
would let a deployment withhold index states while leaking `top` — incoherent rather than
merely odd. The rule the fifth field refines: a field is per *question a deployment
answers*, not per widget; the four others are one-to-one with a surface only because each
of them happens to be one question too.

## Risks / Trade-offs

- **A baked deployment pins a recipe version, and nothing enforces it** (found reviewing
  against the tree, 2026-09-07). `usable()` treats a stored render whose `rig` differs from
  the client's `RIG_VERSION` as needing re-render; with `thumbWrites` off, the write that
  would heal it is refused. So a client build whose recipe version has moved past the baked
  corpus re-renders every tile on every visit, for every visitor, forever — silently, and
  looking exactly like a cache that never warms. `webp-thumbnails` bumped 6 → 7 on
  2026-09-07, which makes this concrete rather than hypothetical: the corpus must be baked
  by the same client build that ships, and a later bump means a re-bake before deploy. The
  deployment's committed configuration (D10) is where that coupling is visible; enforcing
  it — a served client refusing to boot against a corpus baked under another recipe — is
  not attempted here and is worth its own change if the demo outlives one bump.
- [A malformed `config.json` now takes a dev machine's server down, where it was
  previously ignored] → Absent stays silent, so the common case is untouched; only a file
  someone actually wrote can fail. The failure names the file and the parse error.
- [Refuse-to-start conflicts with "the link is never dead"] → Stated in D2 rather than
  resolved: a server that starts on loopback defaults when it was meant to be public is
  equally dead and harder to diagnose. Revisit if the deployment gains a supervisor that
  can roll back to a last-good configuration.
- [The report and the routes drift — a server declares a capability it refuses] → D5's
  one-value rule, plus a test that asserts the pairing per field rather than testing the
  report and the routes separately.
- [The `ApiClient` decorator silently swallows writes on a deployment that *should*
  accept them] → It is installed only on a known report explicitly declaring writes off;
  unknown and failed reports keep today's behaviour, which the feature-report capability
  requires normatively.
- [`SidePanel` is touched by `bulk-thumbnail-jobs` as well] → Additive on both sides (a
  tab added there, a fallback changed here); that change's proposal asks for the ordering
  to be declared here, so: no hard ordering, whichever lands first rebases the other's
  tab list.
- [The tree moves under a long-lived draft] → Already happened twice while this one was
  written: `snapshots` was appended to `createApp` after its signature was read, and
  `native-context-menu-bypass` appeared mid-draft. Re-read every cited symbol immediately
  before implementing rather than trusting this document's account of it.
- [`POST /api/reload` is reachable by anyone] → Added by `listing-tree-cache` after this
  change's routes were first enumerated, and gated by nothing: it drops every cached layer
  and revalidates each snapshot root. Reloading a server's caches is an operator's act on
  the operator's machine, so it refuses under `maintenance` — gating an action under a
  disclosure field, as the first fix did, was a category error (Masa). This is why that
  field exists now rather than being deferred. Named here because a route added by another
  change in flight is exactly what a fixed list of routes misses.
- [A viewer drives the expensive routes directly] → The guard admits requests with no
  `Origin` by design (curl, same-origin GETs), so a script reaches anything a capability
  does not refuse. `POST /api/semantic` and a flat `GET /api/dir` — whose walk budget runs
  to 200k steps — are the compute-heavy pair. Rate limiting is a stated non-goal, handled
  at the reverse proxy; noted here so the flat walk is in that bucket explicitly and not
  only the semantic route.
- [An error message carries a filesystem path out] → `app.onError` answers `err.message`
  on a 500. The typed errors in listing, zip and library do not carry one, but a raw
  `ENOENT` would; a probe for it belongs in the live verification rather than in trust.
- [Static serving makes the app depend on a build in development] → Explicitly not
  required; a missing `client/dist` leaves the API unchanged.
- [A capability field is added later without its refusal] → The feature-report delta
  states the pairing as a requirement, so a field without a refusal fails review against
  a sentence rather than a habit.

## Migration Plan

1. Land with no configuration file changes: every default matches today's behaviour
   except the chat tab, which disappears from the maintained configuration.
2. The chat tab's disappearance is the one user-visible change to the local app. A
   profile that recorded it opens on search; its recorded value survives.
3. Rollback is a configuration edit, not a code change, for everything except the chat
   default — which is a one-line revert.

## Open Questions

None remain. Every question this document opened has been answered — see below; the two
that were reversed after argument say so on their own line, so a reader can tell a
settled answer from an unchallenged one.

## Settled since drafting

- **The credits page stands alone** (Masa, 2026-09-03), rather than riding the landing
  page as this document first recommended. CC-BY attribution is go-live gate 3.2, and the
  landing-page change opens with an unanswered question about its own copy; a compliance
  item gated on aesthetics is how compliance items slip. The generator already exists from
  `library-overrides`, so standalone it is a route and a rendering. Tracked as
  `web-demo-backlog` 1.8.
- **The field set and its names** — the table in D4 (Masa, 2026-09-03), including
  `maintenance` arriving early and the index field folding into `hostDetails`.
- **The allowed origins are a set, not one value** (Masa, 2026-09-03), reversing this
  document's earlier lean. Nothing needs two names today — `models.masamaeda.com`, apex
  left bare — but widening a scalar later is the easy direction and guessing wrong on one
  is not. Loopback is in the set besides (D8).
- **Where the shipped configuration lives:** `deploy/demo/config.json`. The rest of the
  deployment's own configuration — reverse proxy, TLS, container definition — is **a
  separate change** (Masa, 2026-09-03), writable and testable earlier than this one since
  it depends on nothing here.
