# Tasks — public-deployment

> Change "A" of the five `web-demo-backlog` 1.3 became. **Everything this change waited
> on has landed** (2026-09-07 re-read): `thumbnail-image-serving` and
> `bulk-thumbnail-jobs` on 2026-09-03, `webp-thumbnails` on 2026-09-07. So what were
> ordering conditions are now facts to write against. A listing entry already carries the
> write generation and the stored camera and axis, which is the second path a stored
> camera reaches the client by and which task 4.1's overlay must cover (design D6).
> `SidePanel` already has its `library` tab, so the tab list needs no rebase — only the
> two fallbacks D7 names. The bulk-job surfaces already gate on `thumbWrites`, which that
> change's own open task 5.1 declared an interim until this field exists (3.8a closes it).
>
> The tree moved twice under the drafting of this change (`snapshots` appended to
> `createApp`; `native-context-menu-bypass` appearing). Re-read every symbol named below
> before editing it.
>
> Cite code by symbol name, never `file.ts:123` (CLAUDE.md). Bun-only APIs stay in
> `server/src/index.ts` (D1). No thumbnail pixel output changes, so no `RIG_VERSION` bump.

## 1. Configuration

- [x] 1.1 Extend the configuration file's shape beside `root`: the capability fields, the
      allowed origin, and the listening address. Type it in `shared/types.ts` beside
      `FeatureReport` so both sides compile against one declaration.
      **Done 2026-09-07** — `DeploymentConfig` in `shared/types.ts` beside
      `FeatureReport`: `root`, `origins` (a list), `listen` and `features`, and
      nothing else. Parsing is strict and there is no free-text key — an unknown
      key at either level, or a wrong type anywhere, is a failure, since a typo
      quietly dropped is the disease D2 exists to cure
- [x] 1.2 Split the config read out of `configuredRoot` (`library.ts`) into one load that
      returns the whole file, and have `configuredRoot` take the root from it —
      `MODEL_BROWSER_ROOT` overriding the `root` key alone and no longer returning before
      the file is read (D2). `MODEL_BROWSER_CONFIG` keeps selecting the file.
      **Done 2026-09-07** — the read moved to `loadConfig` in the new
      `server/src/config.ts` (Node APIs only); `configuredRoot` is now a pure
      function of env + config and opens nothing. `loadConfig` applies the env
      override to the `root` key of the value it *returns*, so every consumer
      reads one resolved root rather than each re-applying the precedence
- [x] 1.2a Parse the file exactly once at start (D2). `evaluate` keeps re-asking the
      *filesystem* while the library is unsettled — that is why it re-runs, and a volume
      mounted later must still need no restart — but stops re-reading the file. Give
      `refresh()` an explicit re-read and correct its comment, which today calls itself
      "Re-evaluate config, marker and probe from scratch".
      **Done 2026-09-07** — `createLibrary(env, config)` takes the already-parsed
      configuration; `evaluate` still re-runs per `state()` while unsettled and
      still re-asks the filesystem, but opens no file. `refresh()`'s comment now
      says it re-asks the filesystem and does **not** re-read the file.
      *No re-read method was built*: D2's loose-ends paragraph says the Electron
      re-read "stays a seam with no consumer — named, not built speculatively",
      which supersedes this line's "gains an explicit re-read"; the seam is named
      in `refresh()`'s comment instead. Cell: `library.test.ts` "opens no
      configuration file while it re-asks the filesystem"
- [x] 1.3 Absent file stays silent and means the defaults; a present file that cannot be
      parsed (including unreadable-for-permissions) raises a startup failure naming the
      file and the parse error, and the server does not start (D2). Today's
      "Absent, unreadable or malformed all mean the same thing" comment goes with it.
      **Done 2026-09-07** — ENOENT is `{}` silently; unreadable (EACCES), unparseable or
      failing validation raises `ConfigError` naming the file and the reason. The
      old comment went with `configuredRoot`'s file read. Cells in
      `config.test.ts`, including a chmod-000 one that skips under root
- [x] 1.4 Wire the load into `index.ts` so the failure surfaces beside the
      `library <id> at <top>` startup line, where `library-overrides` already reports a
      broken store.
      **Done 2026-09-07** — `index.ts` awaits `loadConfig(process.env)` at the top and,
      on `ConfigError`, prints the message to stderr and `process.exit(1)`; the
      `library <id> at <top>` line is untouched

## 2. The guard and the listening address

- [x] 2.1 `guard`'s `LOOPBACK_ORIGIN`/`LOOPBACK_HOST` become the configured allowed set —
      a **list** of origins, not one value, with loopback always in it whatever is
      configured — defaulting to exactly today's two patterns. Every other rule unchanged: absent
      `Origin` passes, non-matching `Host` refused, CORS never emitted, model bytes keep
      `application/octet-stream` + `nosniff` (D3).
      **Done 2026-09-07** — `guard` is now a factory, `guard(origins)`, normalising each
      configured origin once into the `Origin` spelling and the `Host` spellings
      that name it (the scheme's default port implied when the origin names
      none). The two loopback regexes are unchanged and always consulted, so with
      nothing configured the behaviour is byte-identical — asserted, not
      re-spelt, by `guard.test.ts`'s first block, which repeats `api.test.ts`'s
      own guard requests
- [x] 2.2 The guard stays mounted on `/api/*` only — the built client is public files and
      guarding them would make the app unloadable from its own origin (D3).
      **Done 2026-09-07** — `app.use('/api/*', guard(origins))` is still the only mount;
      the static handler is composed in `index.ts`'s `fetch` and never sees the
      middleware
- [x] 2.3 `index.ts`'s `hostname` and `port` come from the configuration, defaulting to
      loopback and 3177. **Done 2026-09-07** — `config.listen?.port ?? 3177`,
      `config.listen?.host ?? '127.0.0.1'`

## 3. Capability fields and their refusals

- [x] 3.1 Add four fields to `FeatureReport` beside `thumbWrites`: `appLaunch`,
      `chatTab`, `hostDetails`, `maintenance` — `true` means offered, and every default is
      on except `chatTab` (D4's table). There is no separate index field: `hostDetails`
      governs the index-state collapse too, since a condition is named by its remedy.
      **Done 2026-09-07** — the four fields are on `FeatureReport` in `shared/types.ts`,
      each with a doc comment saying what it governs (D4's table). No separate
      index field
- [x] 3.2 Rename and re-document `ALL_FEATURES`: it is the supported/default set, not
      "every capability on" (D4). Update `createApp`'s parameter comment and `index.ts`'s
      construction comment, which currently promises this change replaces the value with
      "its env selection".
      **Done 2026-09-07** — `ALL_FEATURES` becomes `DEFAULT_FEATURES`, documented as the
      *maintained* set rather than "everything on", with the note that all-on is
      now a configuration nobody runs and that feature-report's *Everything on
      changes nothing* is an inertness proof. `createApp`'s parameter comment and
      `index.ts`'s construction comment both rewritten; `listingCache.test.ts`'s
      four uses renamed mechanically
- [x] 3.3 Build the report from the configuration in `index.ts`, one value, and pass it
      to `createApp` as today (D5). **Done 2026-09-07** —
      `const features: FeatureReport = { ...DEFAULT_FEATURES, ...config.features }`,
      passed positionally as before. Nothing re-derives a capability from the
      configuration a second time
- [x] 3.4 `PUT /api/thumb` refuses when thumbnail writes are declared off — it consults
      nothing today. Refusal answers distinguishably from a failure (D5)
      **Done 2026-09-07** — the handler's first line, before `c.req.json()` and long
      before `cache.put`. The shape is `Refused` (`shared/types.ts`): 403 with
      `{ error: 'not offered by this deployment', refused: '<field>' }`, one
      `refuse` helper in `createApp` for all four refusing routes, so "not
      offered here" reads apart from a fault without inferring it from the
      status. Cell: `refusals.test.ts` thumbWrites, which also asserts
      `/api/thumb/image` still 404s — nothing was written. Falsified: with the
      line removed the write answers 200
- [x] 3.5 `/api/open` and `/api/open-with` refuse when the launcher is declared off, and
      `/api/apps` answers an empty report — no applications, no configured chooser. The
      `/api/apps` short-circuit is **before** `launcher.report()`, not a filter over its
      result: `report()` execs `xdg-mime` per handled type and reads the machine's
      application entries, so filtering afterwards still spawns and still reads (D5)
      **Done 2026-09-07** — `/api/open` and `/api/open-with` refuse on their first line
      (open-with before `chooserConfigured` too, so a withholding deployment
      says so rather than reporting on the operator's chooser); `/api/apps`
      short-circuits to `{ chooser: false, types: {} }` **before**
      `launcher.report()` is named, and answers 200 — it is advisory by
      definition and an empty report is the whole of the client's withholding.
      `UNGATED` is untouched. Falsified: with the short-circuit moved after
      `await launcher.report()`, `open.test.ts`'s recording launcher reads
      `['report']` where the cell wants `[]` — the body was identical both
      ways, which is the mistake D5 records
- [x] 3.6 Under `hostDetails` (D11): `/api/library` omits
      `top` and the locations its `missing`/`nested` states carry, and the `missing`/
      `nested` envelopes in `createApp`'s gate middleware name no host location while
      still naming the state. **`ready.root` stays** — it reads like a sibling of `top`
      and is not: `shared/types.ts` documents it as "The configured root as a **library
      path**", `/` at the top, and `bulk-thumbnail-jobs` uses it as its whole-library job
      scope, so withholding it would break that change while protecting nothing.
      `missing.root` and `nested.root`/`nested.library` *are* filesystem paths, verbatim,
      and those are the ones that go. `top` becomes optional in
      `LibraryState`, so every client read of it is a compile error until handled
      **Done 2026-09-07** — `top`, `missing.root`, `nested.root` and `nested.library` are
      optional in `LibraryState`; `ready.root` and `id` stay required. One
      helper, `viewerState` in `createApp`, does the withholding, and both
      `/api/library` and the gate middleware read through it — the middleware
      now narrows on its *result*, so the two accounts of one state cannot
      drift. The envelopes become `the library is not present` and
      `the root contains a library`, state named, location gone. Two internal
      narrowings the optional `top` forced, neither on the wire: `library.ts`'s
      `Ready` is intersected with `{ top: string }` (a ready library always
      knows its own top), and `createOverrideHolder` takes the top from
      `library.realTop()` rather than from the state. Falsified: with the
      `ready` branch of `viewerState` removed, two `refusals.test.ts` cells fail

- [x] 3.7 Under `hostDetails`, the routes withhold the index's `detail`:
      `/api/semantic/status` answers the status object without it, and the 503s from
      `POST /api/semantic` and `/api/semantic/similar` omit it. It is mini-classify's free
      text and can name its cache directory, and a client-side collapse leaves `curl`
      returning what the sentence was rewritten to hide (D9). The server keeps composing
      and logging it — the operator's diagnosis depends on it
      **Done 2026-09-07** — one helper, `viewerIndexStatus` in `createApp`, read at all
      three sites: `/api/semantic/status` answers through it, and both 503s take
      their `detail` from it (`JSON.stringify` drops the key when it is
      undefined, so the wire loses it rather than carrying a null).
      `semantic.ts` is untouched — `indexStatus` composes `detail` exactly as
      before, and no logging was added or removed. Falsified: with the strip
      undone on `POST /api/semantic` alone, that route's leg of the cell fails
      and `/api/semantic/similar`'s passes
- [x] 3.8 `POST /api/reload` refuses under `maintenance`: it drops every cached layer and
      revalidates each snapshot root, which is acting on the server's derived state, not a
      question about the library. Added by `listing-tree-cache` after this change first
      enumerated the routes — re-enumerate before implementing rather than trusting this
      list, and check whether any other maintenance route has appeared since
      **Done 2026-09-07** — refused before `layers.dropAll()`, so a refused reload drops
      nothing and re-walks nothing. Re-enumerated (`grep -an "app\.\(get\|post\|put\|delete\)('"`):
      twenty routes, and `reload` is still the only one that acts on derived
      state *instead of* answering a question about the library. Two that write
      derived state were weighed and left alone, both on the requirement's own
      wording: `POST /api/semantic/poses` records what it was just told (a pose
      wave on the ordinary browsing path), and `/api/dir` fills the listing
      cache — each caches the answer it was asked for, which is not a
      maintenance operation. No other maintenance route has appeared
- [x] 3.8a Move the three bulk-job surfaces from `thumbWrites` to `maintenance` —
      `App.tsx`'s jobs enablement and the two `entryActions` job commands — which closes
      the open task 5.1 of the archived `bulk-thumbnail-jobs`, where `thumbWrites` was
      declared an interim until this field existed. The generate launcher takes **both**
      `maintenance` and `thumbWrites`, or a write-refusing deployment offers a loop that
      renders and discards (D4). The reset job is a client loop over `PUT /api/thumb`, so
      it is withheld at its launcher and its writes stay refused by `thumbWrites` at the
      route; only `reload` is refused as maintenance
      **Done 2026-09-07** — all three moved: App's `libraryJobs` and
      `entryActions`' `resetBeneath` read `maintenance` alone, `generateBeneath` reads
      `maintenance && thumbWrites`. Comments naming `thumbWrites` as the field rewritten
      in all four places (`ENTRY_COMMANDS`' preamble, both rows, `libraryJobs`,
      `SidePanel`'s `library` prop and `StoredTab`). The library tab's **generate
      control carries the same second condition** — `libraryOps` renders it only under
      `thumbWrites`, since it is the other surface of the offer `generateBeneath` gates and
      the capability's *A launcher whose work would be refused anyway is not offered* names
      the surface, not the menu entry; the tab itself stays on `maintenance`, because reset
      lives there. **This closes the archived `bulk-thumbnail-jobs` task 5.1**, which declared `thumbWrites` an interim until this
      field existed — the archive itself is not edited. Covered by `entryActions.test.ts`'s
      *withholds both unless a KNOWN report offers maintenance* and the new *splits the two
      when maintenance and thumbnail writes disagree* (the spec's *Bulk work is gated by
      what it does*), and by `bulkJobSurfaces.test.tsx`'s *is absent while the report is
      unknown*, which gained the write-refusing-but-maintained configuration that keeps the
      tab and now also pins that the tab's generate button is absent there while reset
      stays, against an all-on control. Falsified four ways: `generateBeneath` on
      `thumbWrites` alone, on `maintenance` alone, `libraryJobs` back on `thumbWrites`, and
      `libraryOps` rendering generate unconditionally — each fails its own cell

## 4. Client consumers

> **Where the client reads the report.** `bulk-thumbnail-jobs` adds `features:
> FeatureReport | null` to `AvailabilityContext` (`entryActions.ts`) and threads it into
> all four contexts from `App` — on main since it landed, so that interface already carries `features` beside `apps`. If it lands first, 4.1–4.6 read the report there rather than
> adding a second plumb; if this change lands first, it adds the plumb and that change
> rebases onto it. Either way there is one path, not two (coordinated with that change's
> session, 2026-09-03).

- [x] 4.1 Decorate `ApiClient`'s thumbnail read and write when a known report declares
      writes off (D6): the write drops the PNG and stores camera and axis in this
      browser, answering as a write would; the read overlays a locally-stored orientation
      onto the server's answer. Precedence: local, then server, then an orientation source, then default. The six
      existing `putThumb` call sites are untouched. A locally-kept write answers with the
      result's dropped-pixels flag set, so anything counting renders counts it honestly.
      **Cover both arrival paths**: after `thumbnail-image-serving`, a listing entry
      carries the stored camera and the tile is drawn with no lookup at all, so an overlay
      that lives only on the lookup answer misses every baked tile — apply it where the
      tile state is seeded
      — 2026-09-08: `client/src/api/localFramings.ts` (`withLocalFramings`, the store, and
      `keepsFramingsLocally`), installed at `App`'s `api` `useMemo`. Both arrivals: the
      decorator's `getThumb` overlay, and `useThumbnails`' `start` listing-annotation
      branch, which reads the same store under the same predicate. All six `putThumb` call
      sites and `renderEntryThumbnail` are untouched — including `bulkJobs`' reset write,
      whose `camera: null` deletes the kept half rather than leaving a stale override, and
      whose `png: null` needs no special case. `LocalFramingClient.putThumb` answers
      `{ dropped: true }` with no `gen`, which `renderEntryThumbnail` already turns into
      `skipped`. See D6's Implementation notes
- [x] 4.2 Install the decorator **only** on a known report explicitly declaring writes
      off — unknown and failed reports keep writing to the server, which the
      feature-report capability requires normatively (D6)
      — 2026-09-08: `keepsFramingsLocally` is `report !== null && report.thumbWrites ===
      false`, read per call through a getter so a late report changes no client identity.
      Falsified: widening it to admit `null` failed three cells across both suites
- [x] 4.3 `SidePanel` withholds the chat tab when it is not declared on, absent rather
      than disabled; **both** its fallbacks resolve to a tab that exists, preferring the
      recorded one, and neither rewrites the recorded value (D7): `tabStore`'s parse, and
      the runtime move off a `library` tab that has gone away, which lands on `'chat'`
      today — the tab a deployment may withhold
      **Done 2026-09-07** — `SidePanel` takes `features: FeatureReport | null` from App and
      lists `chat` only under `features?.chatTab === true`, so an in-flight or failed report
      withholds it like any gated offer. One exported pure `resolveTab(preferred,
      available)` serves all three resolutions: the opening tab, the runtime move off
      `similar`/`library`, and the report landing (which re-reads the recorded preference,
      exempting `similar`/`library` since neither is ever recorded and a report resolving is
      not a thing the user did). `tabStore`'s parse and `StoredTab` are unchanged and
      nothing writes a resolved value back. Covered by `sidePanel.test.tsx` (7.6);
      falsified by restoring the `'chat'` landing, which fails the library-tab cell with
      *expected undefined to be 'search'*
- [x] 4.4 `SidePanel`'s index-state description collapses the operator-repairable
      conditions into one unavailability where the deployment declares index operation
      not the viewer's concern; `warming` and outside-the-collection stay distinct (D9).
      `indexStatus`'s reasoning is untouched — what changes is what reaches the client
      **Done 2026-09-07** — `indexAccount` (SidePanel) returns the whole paragraph, and
      under a known `hostDetails: false` answers `INDEX_UNAVAILABLE` for `absent`,
      `volume-gone` and `wedged` with no `detail`; `warming` and the out-of-range `ready`
      keep their own sentences and their `detail`. Sentence and `detail` come from one call
      because a collapse withholds both together. Nothing on the server or in `indexStatus`
      touched. Covered by `sidePanel.test.tsx` (7.7)
- [x] 4.5 The find-similar copy for an unembedded model stops telling the viewer to run
      the classifier under `hostDetails` (D11) — the notes flagged this
      copy as needing a visitor-facing form
      **Done 2026-09-07** — `notEmbeddedMessage(features)` in App picks `NOT_EMBEDDED_VISITOR`
      ("This model is not in the index, so it has no neighbours yet.") under a known
      `hostDetails: false`, and the existing `NOT_EMBEDDED` otherwise. Not a truncation of
      it: "yet" and "try again" both promise a repair this viewer cannot make. Read through
      `readFeatures()` rather than the `features` state, since the effect's deps are
      `[requestId]` alone and a report landing must not re-ask the index. Covered by a new
      cell in `findSimilar.test.tsx` beside the operator sentence's own —
      7.6/7.7 name no cell for this task, and an untested copy change is not a done one;
      falsified by collapsing the chooser to `NOT_EMBEDDED`, which fails it
- [x] 4.6 Where `top` is withheld under `hostDetails` (D11) — read off
      `AvailabilityContext` per the note above, since copy-path is built there — copy-path and the lightbox's file details show
      the library path instead of composing a filesystem path
      **Done 2026-09-07** — and it needed **no** second read of the report: both surfaces
      already expand through one `expandLibraryPath(libraryTop, path)`, whose
      `top` is `string | null` and which hands the library path over unchanged
      on null. So the whole edit is `App`'s `libraryTop`, now
      `libraryState.top ?? null` — the server's omission arrives as the null
      that already meant "no top to join onto", and `entryActions`' copy-path
      and `ViewerLayer`'s file details are untouched. Beside it, the two
      not-ready sentences (`libraryMissingText`, `libraryNestedText`) take the
      location as optional and name the state alone without one

## 5. Serving the built client

- [x] 5.1 Serve `client/dist` from `index.ts` (D8): API routes win, a request matching
      neither is answered with the client's entry document so a cold deep link resolves,
      and a server with no built client serves its API exactly as before.
      **Done 2026-09-07** — the new `server/src/static.ts` (Node APIs only, no Hono
      routes) exports `createStaticHandler(dist)` and the pure
      `route(req, api, client)` that `index.ts` wires; `clientDist(env)` resolves
      `server/../client/dist`, overridable by `MODEL_BROWSER_CLIENT`. With no
      dist directory `index.ts` passes `null` and every request goes to the app.
      Nothing is compressed, per D8 — the proxy that fronts the deployment this
      is for already encodes. A path naming its way out of the dist is refused
      403; measured, WHATWG URL eats a literal `..` *and* a `%2e%2e` segment, so
      the traversal that reaches a handler is the encoded-slash one
- [x] 5.2 `/api/` is reserved: a 404 under it is final and never falls through to the
      entry document (D8), as the delta now requires. **Done 2026-09-07** — the rule is
      the pure `isApiRequest` (`/api` itself included: it is the prefix, not a
      document), consumed by `route`; `index.ts` only wires it. Falsified: with
      `isApiRequest` returning false, the reservation cell reads 200/HTML
- [x] 5.3 Cache headers (D8): the hashed bundle assets `immutable` with a long max-age,
      the entry document `no-cache`. The trip-reduction thread names static-bundle caching
      as this change's concern, and the first draft dropped it.
      **Done 2026-09-07** — anything under `/assets/` gets
      `public, max-age=31536000, immutable`; everything else, the entry document
      included, gets `no-cache`. This is the half a proxy cannot supply, which is
      why it is a rule here and compression is not

## 6. The shipped deployment's configuration

- [x] 6.1 Commit the public deployment's configuration at `deploy/demo/config.json`
      (D10). The rest of that deployment's own configuration — reverse proxy, TLS,
      container definition — is a separate change and does not belong here.
      **Done 2026-09-07** — every field stated including the ones matching a default, so
      a later default flip is an edit there. `listen` is loopback on purpose
      (`demo-infrastructure` D1 puts the proxy, the app and the index in one
      network namespace), and the file carries no free-text key — the
      bake-pins-the-recipe note lives on that change's bake step.
      **For the coordinator**: `demo-infrastructure`'s task 5.2 expected to
      create this file with `root` only; it is created in full here, and nothing
      was ticked there
- [x] 6.2 Exercise that exact configuration in the suite as a second named
      configuration, so the deployment cannot drift from what CI proves (D10).
      **Done 2026-09-07** — `config.test.ts`'s "the committed demo configuration" block
      loads `deploy/demo/config.json` through `loadConfig` and asserts the report
      it yields, that a guard built from it admits
      `Origin: https://models.masamaeda.com` / `Host: models.masamaeda.com`, that
      loopback is still admitted, and that another public origin is not

## 7. Tests

- [x] 7.1 Server: an absent config file is silent and yields the defaults; a malformed one
      fails at startup naming the file; `MODEL_BROWSER_ROOT` overrides the root while the
      file's other settings still take effect; `MODEL_BROWSER_CONFIG` selects the file.
      **Done 2026-09-07** — `server/test/config.test.ts`, 11 cells: absent (both the
      named file and the XDG default), the file the environment selects,
      malformed naming the file, unreadable (skipped under root), an unknown key
      at each of the three levels, a wrong type at each, an origin that is not
      `scheme://host[:port]`, and the env override leaving `origins`/`features`
      in force. Falsified: with the parse error swallowed, the malformed cell
      reads a resolved `{}`
- [x] 7.2 Server: the guard allows exactly loopback when unconfigured (assert the
      byte-identical behaviour, not a re-spelling of it), allows a configured origin,
      refuses another public origin, refuses a non-matching `Host`, and never emits CORS.
      **Done 2026-09-07** — `server/test/guard.test.ts`. The first block makes
      `api.test.ts`'s own guard requests against an unconfigured app, so the
      byte-identical claim is tested rather than restated, and includes the
      control that the public origin is refused *until* it is configured. The
      second covers the configured origin by `Origin` and by both `Host`
      spellings, loopback still admitted beside it, a subdomain/suffix near miss,
      a wrong port, a wrong scheme, and no `Access-Control-*` on any answer.
      Falsified: with the origin comparison removed, five cells across three
      files fail
- [x] 7.3 Server: per field, assert the **pairing** — the report declares it off and the
      route refuses, from one configuration — rather than testing the report and the
      routes separately (D5's drift risk)
      **Done 2026-09-07** — `server/test/refusals.test.ts`, one cell per field
      (`thumbWrites`, `appLaunch`, `maintenance`, `hostDetails`): each builds ONE
      app from ONE report and asserts in the same cell that `/api/features` says
      the field is off *and* that the route acts on it. A fifth cell is the
      control — the same fixture with every field at its default, where the
      write, the reload and the applications report all answer as today
- [x] 7.4 Server: `/api/apps` empty under a withheld launcher **and spawning nothing**
      (assert no command runs, not merely that the body is empty); `/api/open` and
      `/api/open-with` refuse and spawn nothing
      **Done 2026-09-07** — `open.test.ts`'s "a deployment that withholds the launcher":
      a `Launcher` whose `report`/`launch`/`chooser` record their calls, so the
      assertion is that the launcher was never *asked*, not that the body came
      back empty — the two are indistinguishable from the body alone. Three
      cells: the empty report with no `report` call, both refusals with no
      `launch`/`chooser` call, and the control where the same recording launcher
      is reached for all three with the field on
- [x] 7.4a Server: with the host declared not the viewer's concern, no response from any
      route contains a location on the host — assert the absence of the specific strings
      (the real library top, the configured root, an enclosed library's location, the
      config and cache directories, the index's cache directory), not of anything
      path-shaped: library paths, archive virtual paths and errors naming them are
      unaffected and must still be asserted *present*. Cover `/api/library` in every
      state, the not-ready envelopes, `/api/semantic/status`, both semantic 503s, and an
      error path
      **Done 2026-09-07** — `refusals.test.ts`'s second describe, seven cells. `ready`
      sweeps nine routes for the fixture's real top; `missing`, `nested` and
      `unconfigured` assert the exact `/api/library` body and the exact envelope
      a path route gives, plus the absence of the configured root and the
      enclosed library's location; the index cells stub a `CacheUnusable`
      failure whose reason and hint both name a cache directory, and assert its
      absence from `/api/semantic/status` and both 503s, with the uncollapsed
      control keeping it. Present-side: a listing's library paths, a one-level
      archive virtual path (`/models.zip!/box.stl`), and a 404 naming the
      library path it could not find
- [x] 7.5 Client: with writes declared off, an orbit release stores locally and sends
      nothing, a read prefers the local orientation, and one browser's framing does not
      reach another; with the report unknown or failed, writes still go to the server
      — 2026-09-08: nine cells in `apiClient.test.ts`'s `withLocalFramings` block (two
      injected stores make "nobody else's" a claim about two stores, not one) and three in
      `thumbnailQueue.test.tsx` for the seeding arrival. A failed read is the same `null`
      the unknown cells drive. Falsified four ways — installing regardless of the report,
      forwarding the write to `inner`, dropping the seeding overlay, and treating a
      discard as "keep" — each failing only its own cells
- [x] 7.6 Client: a profile with no recorded tab, and one recording `chat`, both open on
      search when the chat tab is withheld, and neither has its recorded value rewritten;
      with chat declared on **and the report known**, the panel behaves exactly as today;
      while the report is in flight the tab is withheld like any gated surface. A cell for
      the runtime fallback too: a viewer on the `library` tab when it goes away, on a
      deployment withholding chat, lands on a tab that exists
      **Done 2026-09-07** — `client/test/sidePanel.test.tsx`, six cells plus two
      `resolveTab` unit cells, driven against the component rather than through App since
      both rules are about inputs App only passes through. The harness's default report
      became the server's own defaults (`DEFAULT_REPORT` in `appHarness.tsx`, `chatTab`
      **off**) rather than "every capability on", which is what made three
      `similarTuning.test.tsx` cells and one `bulkJobSurfaces.test.tsx` cell change: two
      opt into a chat-offering report because the rule under test is about that tab, and
      two now expect the maintained configuration's tab strip
- [x] 7.7 Client: the collapsed index states say one thing for the three operator-only
      conditions, while `warming` and outside-the-collection still say their own; `detail`
      is absent in the collapsed states and still preferred in the uncollapsed ones
      **Done 2026-09-07** — four cells in `client/test/sidePanel.test.tsx`. Every collapsed
      cell is driven with a `detail` present, so the client's own suppression is what is
      asserted rather than the server's (3.7) — a cell fed no `detail` would pass with the
      client rule deleted. Falsified both ways: never collapsing fails the collapse cell,
      always collapsing fails the *today's sentences* cell
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
- [ ] 8.4 Update `CLAUDE.md`'s `config.json` bullet — the new keys, fail-loud, and
      `MODEL_BROWSER_ROOT` no longer suppressing the file. The read-once half is already
      corrected there (`5dd6096` replaced the false "no route re-reads the file" with what
      the code actually does and a pointer to 1.2a); once 1.2a lands, that passage
      collapses back to the simple claim
- [ ] 8.5 Update `docs/platform-surface.md`'s user-dirs bullet, which names `config.json`
      as holding the library root — the house rule is that a change extending a
      `~/.config` file extends that bullet as part of the change
- [ ] 8.6 Point `docs/web-demo-notes.md` at this change where it supersedes the notes'
      Defaults section, as that file's own rule requires
- [ ] 8.7 After archiving, write the `public-deployment` capability's `## Purpose` in
      `openspec/specs/public-deployment/spec.md` — a new capability lands with a `TBD`
      placeholder otherwise (`chat-panel` still carries one)
