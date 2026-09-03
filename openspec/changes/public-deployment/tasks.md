# Tasks — public-deployment

> Change "A" of the five `web-demo-backlog` 1.3 became. **Hard ordering: after
> `thumbnail-image-serving`** — it introduces a second path by which a stored camera
> reaches the client, which task 4.1's overlay must cover (design D6).
> `bulk-thumbnail-jobs` also touches `SidePanel` — additive on both sides (it adds a tab,
> this changes the fallback), so whichever lands first, the other rebases its tab list;
> that change's proposal asked for the ordering to be declared here, and this is it.
>
> The tree moved twice under the drafting of this change (`snapshots` appended to
> `createApp`; `native-context-menu-bypass` appearing). Re-read every symbol named below
> before editing it.
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
- [ ] 1.2a Parse the file exactly once at start (D2). `evaluate` keeps re-asking the
      *filesystem* while the library is unsettled — that is why it re-runs, and a volume
      mounted later must still need no restart — but stops re-reading the file. Give
      `refresh()` an explicit re-read and correct its comment, which today calls itself
      "Re-evaluate config, marker and probe from scratch"
- [ ] 1.3 Absent file stays silent and means the defaults; a present file that cannot be
      parsed (including unreadable-for-permissions) raises a startup failure naming the
      file and the parse error, and the server does not start (D2). Today's
      "Absent, unreadable or malformed all mean the same thing" comment goes with it
- [ ] 1.4 Wire the load into `index.ts` so the failure surfaces beside the
      `library <id> at <top>` startup line, where `library-overrides` already reports a
      broken store

## 2. The guard and the listening address

- [ ] 2.1 `guard`'s `LOOPBACK_ORIGIN`/`LOOPBACK_HOST` become the configured allowed set —
      a **list** of origins, not one value, with loopback always in it whatever is
      configured — defaulting to exactly today's two patterns. Every other rule unchanged: absent
      `Origin` passes, non-matching `Host` refused, CORS never emitted, model bytes keep
      `application/octet-stream` + `nosniff` (D3)
- [ ] 2.2 The guard stays mounted on `/api/*` only — the built client is public files and
      guarding them would make the app unloadable from its own origin (D3)
- [ ] 2.3 `index.ts`'s `hostname` and `port` come from the configuration, defaulting to
      loopback and 3177

## 3. Capability fields and their refusals

- [ ] 3.1 Add four fields to `FeatureReport` beside `thumbWrites`: `appLaunch`,
      `chatTab`, `hostDetails`, `maintenance` — `true` means offered, and every default is
      on except `chatTab` (D4's table). There is no separate index field: `hostDetails`
      governs the index-state collapse too, since a condition is named by its remedy
- [ ] 3.2 Rename and re-document `ALL_FEATURES`: it is the supported/default set, not
      "every capability on" (D4). Update `createApp`'s parameter comment and `index.ts`'s
      construction comment, which currently promises this change replaces the value with
      "its env selection"
- [ ] 3.3 Build the report from the configuration in `index.ts`, one value, and pass it
      to `createApp` as today (D5)
- [ ] 3.4 `PUT /api/thumb` refuses when thumbnail writes are declared off — it consults
      nothing today. Refusal answers distinguishably from a failure (D5)
- [ ] 3.5 `/api/open` and `/api/open-with` refuse when the launcher is declared off, and
      `/api/apps` answers an empty report — no applications, no configured chooser. The
      `/api/apps` short-circuit is **before** `launcher.report()`, not a filter over its
      result: `report()` execs `xdg-mime` per handled type and reads the machine's
      application entries, so filtering afterwards still spawns and still reads (D5)
- [ ] 3.6 Under `hostDetails` (D11): `/api/library` omits
      `top` and the locations its `missing`/`nested` states carry, and the `missing`/
      `nested` envelopes in `createApp`'s gate middleware name no host location while
      still naming the state. `top` becomes optional in
      `LibraryState`, so every client read of it is a compile error until handled

- [ ] 3.7 Under `hostDetails`, the routes withhold the index's `detail`:
      `/api/semantic/status` answers the status object without it, and the 503s from
      `POST /api/semantic` and `/api/semantic/similar` omit it. It is mini-classify's free
      text and can name its cache directory, and a client-side collapse leaves `curl`
      returning what the sentence was rewritten to hide (D9). The server keeps composing
      and logging it — the operator's diagnosis depends on it
- [ ] 3.8 `POST /api/reload` refuses under `maintenance`: it drops every cached layer and
      revalidates each snapshot root, which is acting on the server's derived state, not a
      question about the library. Added by `listing-tree-cache` after this change first
      enumerated the routes — re-enumerate before implementing rather than trusting this
      list, and check whether any other maintenance route has appeared since

## 4. Client consumers

> **Where the client reads the report.** `bulk-thumbnail-jobs` adds `features:
> FeatureReport | null` to `AvailabilityContext` (`entryActions.ts`) and threads it into
> all four contexts from `App` — on its branch, not on main, where that interface carries
> `apps` and no `features`. If it lands first, 4.1–4.6 read the report there rather than
> adding a second plumb; if this change lands first, it adds the plumb and that change
> rebases onto it. Either way there is one path, not two (coordinated with that change's
> session, 2026-09-03).

- [ ] 4.1 Decorate `ApiClient`'s thumbnail read and write when a known report declares
      writes off (D6): the write drops the PNG and stores camera and axis in this
      browser, answering as a write would; the read overlays a locally-stored orientation
      onto the server's answer. Precedence: local, then server, then an orientation
      source, then default. The five existing `putThumb` call sites are untouched.
      **Cover both arrival paths**: after `thumbnail-image-serving`, a listing entry
      carries the stored camera and the tile is drawn with no lookup at all, so an overlay
      that lives only on the lookup answer misses every baked tile — apply it where the
      tile state is seeded
- [ ] 4.2 Install the decorator **only** on a known report explicitly declaring writes
      off — unknown and failed reports keep writing to the server, which the
      feature-report capability requires normatively (D6)
- [ ] 4.3 `SidePanel` withholds the chat tab when it is not declared on, absent rather
      than disabled; `tabStore` resolves to a tab that exists, preferring the recorded
      one, and does not rewrite the recorded value (D7)
- [ ] 4.4 `SidePanel`'s index-state description collapses the operator-repairable
      conditions into one unavailability where the deployment declares index operation
      not the viewer's concern; `warming` and outside-the-collection stay distinct (D9).
      `indexStatus`'s reasoning is untouched — what changes is what reaches the client
- [ ] 4.5 The find-similar copy for an unembedded model stops telling the viewer to run
      the classifier under `hostDetails` (D11) — the notes flagged this
      copy as needing a visitor-facing form
- [ ] 4.6 Where `top` is withheld under `hostDetails` (D11) — read off
      `AvailabilityContext` per the note above, since copy-path is built there — copy-path and the lightbox's file details show
      the library path instead of composing a filesystem path

## 5. Serving the built client

- [ ] 5.1 Serve `client/dist` from `index.ts` (D8): API routes win, a request matching
      neither is answered with the client's entry document so a cold deep link resolves,
      and a server with no built client serves its API exactly as before
- [ ] 5.2 `/api/` is reserved: a 404 under it is final and never falls through to the
      entry document (D8), as the delta now requires
- [ ] 5.3 Cache headers (D8): the hashed bundle assets `immutable` with a long max-age,
      the entry document `no-cache`. The trip-reduction thread names static-bundle caching
      as this change's concern, and the first draft dropped it

## 6. The shipped deployment's configuration

- [ ] 6.1 Commit the public deployment's configuration at `deploy/demo/config.json`
      (D10). The rest of that deployment's own configuration — reverse proxy, TLS,
      container definition — is a separate change and does not belong here
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
- [ ] 7.4 Server: `/api/apps` empty under a withheld launcher **and spawning nothing**
      (assert no command runs, not merely that the body is empty); `/api/open` and
      `/api/open-with` refuse and spawn nothing
- [ ] 7.4a Server: with the host declared not the viewer's concern, no response from any
      route contains a location on the host — assert the absence of the specific strings
      (the real library top, the configured root, an enclosed library's location, the
      config and cache directories, the index's cache directory), not of anything
      path-shaped: library paths, archive virtual paths and errors naming them are
      unaffected and must still be asserted *present*. Cover `/api/library` in every
      state, the not-ready envelopes, `/api/semantic/status`, both semantic 503s, and an
      error path
- [ ] 7.5 Client: with writes declared off, an orbit release stores locally and sends
      nothing, a read prefers the local orientation, and one browser's framing does not
      reach another; with the report unknown or failed, writes still go to the server
- [ ] 7.6 Client: a profile with no recorded tab, and one recording `chat`, both open on
      search when the chat tab is withheld, and neither has its recorded value rewritten;
      with chat declared on **and the report known**, the panel behaves exactly as today;
      while the report is in flight the tab is withheld like any gated surface
- [ ] 7.7 Client: the collapsed index states say one thing for the three operator-only
      conditions, while `warming` and outside-the-collection still say their own; `detail`
      is absent in the collapsed states and still preferred in the uncollapsed ones
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
