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
implementable. Four remain open at the bottom.

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
capability forbids by construction. Four fields whose consumers exist today: thumbnail
writes, the launcher, the chat tab, and whether index operation is the viewer's concern.

The fifth field — the bulk-job surfaces — is deliberately absent. Its consumer does not
exist until `bulk-thumbnail-jobs` lands, and that change's design already says "the seam
is declared in the delta so 1.3 can gate without modifying this capability". Whichever of
the two lands second adds one field and one gate.

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
last parameter and `index.ts` constructs it. Routes read that same object; nothing
re-derives capabilities from configuration a second time.

Refusal must be at the route rather than in the client, and the reason is not
theoretical. `PUT /api/thumb` consults nothing today, and its cache is keyed by path
alone for cameras — so an accepted anonymous write re-frames the model *every later
visitor* sees. `/api/open` and `/api/open-with` spawn detached processes on the host.
A client-side gate protects only clients that run our JavaScript.

A refusal answers distinguishably from a failure, so the client can tell "not offered
here" from "went wrong" without inferring it from a status code alone.

### D6: The client's write routing decorates `ApiClient`, leaving the call sites alone

With writes declared off, a visitor's orbit persists in their own browser
(`web-demo-backlog` 2.1). Five call sites write today — three in `entryActions`, one in
`useThumbnails`, one in `App.tsx` — and they want different things: some send a rendered
PNG, some send a camera, some send both.

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

### D8: Static serving lives in the runtime entry point

Serving files is adapter-specific, so under D1 it belongs in `index.ts` and not in the
Hono app, which must keep running on Node unchanged for the Electron seam. API routes
win over static ones; a request matching neither is answered with the client's entry
document so a deep link opened cold resolves in the client. A server with no built client
serves its API exactly as before — the local development loop, where Vite serves the
client, must not start depending on a build.

### D9: Only the viewer's account of the index collapses

The states exist because each names a different repair: start the service, plug in the
volume, restart a wedged process. A visitor can perform none of them, so offering those
remedies is worse than useless — it also describes the operator's machine to a stranger.

What does **not** collapse: *warming*, because a container's boot is a real wait and
"come back in a moment" is honest; and *outside the collection*, because that is a fact
about where the viewer is browsing, which they can act on. And the server keeps every
distinction internally — the operator's own diagnosis depends on them. Only the sentence
the viewer reads collapses, which puts this change in `SidePanel`'s state description and
nowhere near `semantic.ts`.

### D10: The shipped deployment's configuration is committed and tested

Masa's call, and it resolves the wrinkle the "defaults are the maintained set" framing
creates: if authored configurations are the exceptional path, the public deployment would
otherwise be, by definition, the untested one — a bad property for the most visible
instance of the project. So its `config.json` is committed to the repository rather than
hand-authored on the box, and the suite exercises that exact combination as a second
named configuration. Two tested configurations, and "you are on your own" applies only to
configurations nobody ships.

## Risks / Trade-offs

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

- **Field names.** The four want names that read as capabilities, not as modes.
  `thumbWrites` exists; the other three are unnamed. Not blocking implementation, but
  worth settling before the type is exported, since renaming a published field later
  costs a compatibility note.
- **Where the shipped deployment's `config.json` lives in the repo** (D10), and how the
  suite names it as its second configuration.
- **The credits page's home** — with the landing page, sharing one set of copy decisions,
  or standing alone as a generated document with a route. It is go-live gate 3.2 and
  CC-BY requires displayed attribution. This change recommends the former and does not
  settle it.
- **Whether the allowed origin is one value or a list.** A list costs nothing to
  implement and covers an apex-plus-subdomain deployment; a single value is harder to
  misconfigure. Leaning single, with the loopback default remaining a set internally.
