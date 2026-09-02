# Tasks — public-deployment

> Change "A" of the five `web-demo-backlog` 1.3 became. No hard ordering against any
> change in flight. `bulk-thumbnail-jobs` also touches `SidePanel` — additive on both
> sides (it adds a tab, this changes the fallback), so whichever lands first, the other
> rebases its tab list; that change's proposal asked for the ordering to be declared
> here, and this is it.
>
> Cite code by symbol name, never `file.ts:123` (CLAUDE.md). Bun-only APIs stay in
> `server/src/index.ts` (D1). No thumbnail pixel output changes, so no `RIG_VERSION` bump.

## 1. Configuration

- [ ] 1.1 Extend the configuration file's shape beside `root`: the capability fields, the
      allowed origin, and the listening address. Type it in `shared/types.ts` beside
      `FeatureReport` so both sides compile against one declaration
- [ ] 1.2 Split the config read out of `configuredRoot` (`library.ts`) into one load that
      returns the whole file, and have `configuredRoot` take the root from it —
      `MODEL_BROWSER_ROOT` overriding the `root` key alone and no longer returning before
      the file is read (D2). `MODEL_BROWSER_CONFIG` keeps selecting the file
- [ ] 1.3 Absent file stays silent and means the defaults; a present file that cannot be
      parsed (including unreadable-for-permissions) raises a startup failure naming the
      file and the parse error, and the server does not start (D2). Today's
      "Absent, unreadable or malformed all mean the same thing" comment goes with it
- [ ] 1.4 Wire the load into `index.ts` so the failure surfaces beside the
      `library <id> at <top>` startup line, where `library-overrides` already reports a
      broken store

## 2. The guard and the listening address

- [ ] 2.1 `guard`'s `LOOPBACK_ORIGIN`/`LOOPBACK_HOST` become the configured allowed set,
      defaulting to exactly today's two patterns. Every other rule unchanged: absent
      `Origin` passes, non-matching `Host` refused, CORS never emitted, model bytes keep
      `application/octet-stream` + `nosniff` (D3)
- [ ] 2.2 The guard stays mounted on `/api/*` only — the built client is public files and
      guarding them would make the app unloadable from its own origin (D3)
- [ ] 2.3 `index.ts`'s `hostname` and `port` come from the configuration, defaulting to
      loopback and 3177

## 3. Capability fields and their refusals

- [ ] 3.1 Add three fields to `FeatureReport` beside `thumbWrites` — the launcher, the
      chat tab, and whether index operation is the viewer's concern — each with its own
      default, chat's being off (D4). Names are an open design question; settle before
      exporting the type
- [ ] 3.2 Rename and re-document `ALL_FEATURES`: it is the supported/default set, not
      "every capability on" (D4). Update `createApp`'s parameter comment and `index.ts`'s
      construction comment, which currently promises this change replaces the value with
      "its env selection"
- [ ] 3.3 Build the report from the configuration in `index.ts`, one value, and pass it
      to `createApp` as today (D5)
- [ ] 3.4 `PUT /api/thumb` refuses when thumbnail writes are declared off — it consults
      nothing today. Refusal answers distinguishably from a failure (D5)
- [ ] 3.5 `/api/open` and `/api/open-with` refuse when the launcher is declared off, and
      `/api/apps` answers an empty report — no applications, no configured chooser.
      Refusal is at the route: these spawn detached processes on the host (D5)

## 4. Client consumers

- [ ] 4.1 Decorate `ApiClient`'s thumbnail read and write when a known report declares
      writes off (D6): the write drops the PNG and stores camera and axis in this
      browser, answering as a write would; the read overlays a locally-stored orientation
      onto the server's answer. Precedence: local, then server, then an orientation
      source, then default. The five existing `putThumb` call sites are untouched
- [ ] 4.2 Install the decorator **only** on a known report explicitly declaring writes
      off — unknown and failed reports keep writing to the server, which the
      feature-report capability requires normatively (D6)
- [ ] 4.3 `SidePanel` withholds the chat tab when it is not declared on, absent rather
      than disabled; `tabStore` resolves to a tab that exists, preferring the recorded
      one, and does not rewrite the recorded value (D7)
- [ ] 4.4 `SidePanel`'s index-state description collapses the operator-repairable
      conditions into one unavailability where the deployment declares index operation
      not the viewer's concern; `warming` and outside-the-collection stay distinct, and
      `semantic.ts` is untouched (D9)

## 5. Serving the built client

- [ ] 5.1 Serve `client/dist` from `index.ts` (D8): API routes win, a request matching
      neither is answered with the client's entry document so a cold deep link resolves,
      and a server with no built client serves its API exactly as before

## 6. The shipped deployment's configuration

- [ ] 6.1 Commit the public deployment's `config.json` to the repository (D10). Its
      location in the repo is an open question in design
- [ ] 6.2 Exercise that exact configuration in the suite as a second named
      configuration, so the deployment cannot drift from what CI proves (D10)

## 7. Tests

- [ ] 7.1 Server: an absent config file is silent and yields the defaults; a malformed one
      fails at startup naming the file; `MODEL_BROWSER_ROOT` overrides the root while the
      file's other settings still take effect; `MODEL_BROWSER_CONFIG` selects the file
- [ ] 7.2 Server: the guard allows exactly loopback when unconfigured (assert the
      byte-identical behaviour, not a re-spelling of it), allows a configured origin,
      refuses another public origin, refuses a non-matching `Host`, and never emits CORS
- [ ] 7.3 Server: per field, assert the **pairing** — the report declares it off and the
      route refuses, from one configuration — rather than testing the report and the
      routes separately (D5's drift risk)
- [ ] 7.4 Server: `/api/apps` empty under a withheld launcher; `/api/open` and
      `/api/open-with` refuse and spawn nothing
- [ ] 7.5 Client: with writes declared off, an orbit release stores locally and sends
      nothing, a read prefers the local orientation, and one browser's framing does not
      reach another; with the report unknown or failed, writes still go to the server
- [ ] 7.6 Client: a profile with no recorded tab, and one recording `chat`, both open on
      search when the chat tab is withheld, and neither has its recorded value rewritten;
      with chat declared on, the panel behaves exactly as today
- [ ] 7.7 Client: the collapsed index states say one thing for the three operator-only
      conditions, while `warming` and outside-the-collection still say their own
- [ ] 7.8 Falsify every behavioural cell before trusting it — remove the guard's origin
      check, the refusal in each route, the decorator's install condition, the tab
      fallback — and confirm the corresponding cell fails

## 8. Verification

- [ ] 8.1 `bun run test` / `bun run typecheck` clean from the workspace dirs
- [ ] 8.2 Live, dev instance: the app is byte-identical to today except the absent chat
      tab; `/api/features` reports the defaults; a malformed `config.json` refuses to
      start with a legible message; `MODEL_BROWSER_ROOT` set no longer hides the file
- [ ] 8.3 Live, a locally-simulated public deployment (the committed configuration, a
      non-loopback `Host`/`Origin` via curl): the guard admits the configured origin and
      refuses another; thumbnail writes, launches and the chooser are refused; the built
      client is served and a cold deep link resolves
- [ ] 8.4 After archiving, write the `public-deployment` capability's `## Purpose` in
      `openspec/specs/public-deployment/spec.md` — a new capability lands with a `TBD`
      placeholder otherwise (`chat-panel` still carries one)
