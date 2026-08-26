# Tasks — open-in-slicer

> Ordering: `search-cancellation` also edits `server/src/app.ts` (its proposal cites
> the request AbortSignal work there) — re-read `app.ts` against main before starting
> section 2, and coordinate if that change is mid-flight. No spec-level collisions.

> Evidence (applied 2026-08-24, foreman run): sections 1–2 landed as `d4aee3a` and
> section 3 as `5e00cc3`, each line-reviewed by a different model than its
> implementer, with falsification evidence per behavioral guard (5 server, 11
> client inversions, each watched failing). Merged main: 173 server + 440 client
> tests, typecheck clean, independently re-run by the reviewing session. Live
> verification: `/api/apps` on this machine returns F3D · LycheeSlicer · Photon
> Workshop with `chooser:true`; the menu renders that row with zero `/api/apps`
> requests fired on raise; a Lychee pill launch warm-forwarded; a zip-entry
> Photon launch extracted to the vpath-hashed temp file and opened
> (user-confirmed). Correction on the record: the first no-probe measurement
> (a `window.fetch` wrapper) was blind — `HttpApiClient` captures its fetch at
> construction — and was redone 2026-08-25 at the network level (Playwright
> request events): 3 raises, 0 requests, genuinely proven.

## 1. Server: platform operations (L2, L6)

- [x] 1.1 Add the launch-ops module (Node APIs only — must run un-Bun'd per global D1):
      `default` via `xdg-mime query default {mime}`; `associations` and all display
      names via the targeted desktop-entry reader — mimeapps.list by section
      (Default/Added associate, **Removed excludes**), standard locations in
      precedence order, combined with entries whose `MimeType=` declares the mime,
      read from the `applications/` dirs with XDG **defaults applied**
      (`${XDG_DATA_HOME:-~/.local/share}`; `XDG_DATA_DIRS` defaulting
      `/usr/local/share:/usr/share` — the env vars alone miss `~/.local/share` on
      this machine), subdirs included (wine/Programs shape), traversal **stats
      through symlinks for files and directories** with a depth/cycle guard
      (`dirent.isFile()` is false for every dotfiles-linked entry), `-`→`/` id
      resolution, NoDisplay/Hidden filtered (load-bearing: kills the `0FileVersion`
      wine shim and the duplicate-`F3D` plugin) — not `gio mime` (localized prose)
      and not `mimeinfo.cache` (silently stale for hand-placed entries); `launch` via
      `gtk-launch {appId} {file}` with `execFile`; `chooser` config-only (unavailable
      until configured)
- [x] 1.2 Config loading: `~/.config/model-browser/launch.json` (path via
      `MODEL_BROWSER_LAUNCH_CONFIG`), argv-array overrides with per-element placeholder
      substitution, absent file → builtins
- [x] 1.3 Mime mapping from `modelFormat` (server/src/listing.ts) — no second
      extension table to drift
- [x] 1.4 Server tests: template substitution stays per-element (metacharacter file
      name arrives as one argv entry), builtin selected when config absent, override
      selected when present, reader resolves subdirectory ids (wine/Programs shape),
      reads a **symlinked file** entry (the dotfiles-link shape) and a symlinked
      directory, finds a MimeType-declaring entry missing from `mimeinfo.cache`,
      honors a `[Removed Associations]` exclusion, applies the XDG defaults when the
      env vars are unset, filters NoDisplay, names resolve from `Name=`

## 2. Server: endpoints (L5, L7, L8, L9)

- [x] 2.1 `GET /api/apps` (no path parameter, no path validation) — fresh read per
      request, returns `{chooser, types}`: `chooser` the configured boolean, `types`
      mapping each handled mime to `{default, associated}` with `{id, name}` records
- [x] 2.2 `POST /api/open` `{path, appId}` — validate as `/api/file` (nested zips rejected), absolutize, temp-extract zip entries (per-run `mkdtemp`,
      name keyed on the full virtual path with the entry's extension, repeat
      launches extract to a staging name and `rename()` over the target — never
      truncate in place — never delete mid-run), run launch op, exit 0 → success,
      spawn/nonzero → error with reason
- [x] 2.3 `POST /api/open-with` `{path}` — same validation/extraction/absolutize
      pipeline as 2.2, runs the chooser op **detached from the request lifetime**
      (client abort or hot reload must not kill it), responds when the command
      completes, unavailable (not error) when unconfigured, completion → success
      (dismissal included), spawn/nonzero → error
- [x] 2.4 Server tests: missing file errors without launching, `a.zip!/part.stl` and
      `b.zip!/part.stl` extract to distinct files, nested zip rejected, relative input
      never reaches the launcher, launch failure surfaces its reason, open-with
      reports unavailable when unconfigured, spawns the configured argv when set, and
      survives a simulated client abort with the child still running

## 3. Client: entry actions (L3, L4, L10)

- [x] 3.1 ApiClient: `apps()` fetched once per session and cached; `open(path, appId)`;
      `openWith(path)` issued with no timeout and no abort wiring, and completing it
      refetches `apps()` (the chooser may have rewritten the registry)
- [x] 3.2 Generalize EntryMenu's keyboard arithmetic from one
      fixed-size pill group to two groups, one variable-length: index math, the
      land-on-current rule, initial focus still the first command, re-seed deps —
      open-in row below the axis row, both above the commands
- [x] 3.3 Open-in pill group in `entryActions.ts` + `EntryMenu.tsx`: model entries
      only, default first, absent when no associations, data from the session cache
      (no probe on menu open — D6/2.5), one-shot launch, failure reported via a shared
      constant beside `COPY_FAILED` (`LAUNCH_FAILED`)
- [x] 3.4 "Open with…" `EntryCommand`: offered exactly when the cached report says a
      chooser is configured (absent otherwise), one-shot handoff to
      `POST /api/open-with`, no client chooser UI, failure via `CHOOSER_FAILED` — its
      own sentence since 878a854, because no application was chosen
- [x] 3.5 `MenuItemId` gains `openIn` (the group id, joining the union the way
      `orbitAxis` does — see its comment in entryActions.ts); `openWith` arrives via `CommandId`
      automatically. Both offered on tile/orbit/lightbox-menu surfaces and excluded
      in `LIGHTBOX_PANEL_EXCLUDES` — panel scope deliberate
- [x] 3.6 Client tests: group presence/absence per entry kind and association state,
      default-first ordering, Open with… present/absent on the chooser flag, no fetch
      fired by raising a menu, refetch after open-with completes, keyboard traversal
      across both pill groups, failure reporting path — grep-verify each asserted
      behavior actually has an assertion before checking this box

## 4. Config, verification, polish

- [x] 4.1 Author the machine's `launch.json` with the chooser entry (the dotfiles
      `open-with` script) — the config that makes Open with… exist; without it 4.2's
      chooser steps cannot run
- [x] 4.2 E2E against the live dev instance: pill row shows the current registry
      (default first — f3d as of writing); Open with… → pick Lychee with its
      set-default (Ctrl+Enter) → re-raise the menu and confirm the row now leads with
      Lychee (the registry loop end to end); open a zip entry; confirm the
      no-association and no-chooser-configured absences
      *(closed 2026-08-25: the user Ctrl+Entered Lychee in the invoked rofi —
      `xdg-mime query default model/stl` flipped to `lycheeslicer.desktop`, the
      completion refetch fired, and the next raised menu led LycheeSlicer · Photon
      Workshop with F3D honestly gone, since it was only ever the default pin and
      never an association. no-chooser absence remains unit-test-covered only, by
      choice — unconfiguring the live machine would mutate real config)*
- [ ] 4.3 Tune the pill row visually and settle the naming — **decided by the user
      2026-08-25 on the live app**: (a) `open` becomes kind-aware — "Open lightbox" /
      "Open folder" / "Open archive"; (b) the lightbox's information panel carries the
      launch actions after all (pill row + "Open with…"), reversing this change's own
      panel exclusion. Both implemented in 4.6. Still open: judging the pill row's
      pixels once the panel row exists. *(Wording settled `878a854`: split into
      `LAUNCH_FAILED` for a named application and `CHOOSER_FAILED` — "Could not
      open the chooser to pick an application." — for Open with…, falsified by
      reverting the split and watching both surfaces' tests fail with
      `expected "…chooser to pick an…" received "…file in that…"`.)*
      *(First pixel round done `0e0dedb`: the row inherited the axis row's
      non-wrapping `flex`, built for five tiny fixed children, so application names
      of the registry's choosing overran the panel column and it grew a horizontal
      scrollbar — `overflow-y-auto` forces `overflow-x` to `auto`. The open-in row
      now has its own class that wraps, with a softer radius since a wrapped
      `rounded-full` reads as a blob, pills that truncate rather than overrun, a
      `whitespace-nowrap` caption that no longer breaks as "open"/"in", and the menu
      gained a viewport-relative max-width so it wraps instead of growing past a
      narrow window. Measured at 907×743: pills stack one per line,
      `scrollWidth === clientWidth`, no scrollbar. Second round `df0e389`: in the
      panel the caption now takes its own full line, so every pill starts beneath
      it — one application beside the caption with the rest below read as ragged.
      The menu keeps its inline caption, where the row has width to spare and sits
      under an inline axis row; this is the second deliberate divergence between
      the two surfaces' classes)*
- [ ] 4.7 The lightbox does not adapt to narrow windows — pre-existing, surfaced
      while judging 4.3: the model area is `shrink-0` at `min(80vh,80vw)`, so at a
      640px viewport it takes 512px and the information panel is crushed from its
      `w-72` to 94px, narrow enough that the path text alone overflows it (measured
      2026-08-25; neither the pill row at 62px nor the action strip at 70px exceeds
      the column, so this is not the launch actions' doing). Not fixed here: it
      predates this change and touching the viewer's layout belongs to a change that
      owns the lightbox requirements
- [ ] 4.4 Dry-run the archive per project convention
- [x] 4.5 Give `ZipTempStore` an optional root (and `createApp` an optional store or
      root, the way it already takes `cache` and `launcher`) so tests can point it at
      their own swept dirs. Scoped 2026-08-24 (reviewer-verified): 45
      `model-browser-open-*` dirs / 7.1M in the real tmpdir; every *other* test
      mkdtemp is cleaned by its afterAll — the leak is structural, `createApp` builds
      its store internally with `join(tmpdir(), …)` hardcoded, so a test that calls
      `createApp` never gets a handle to clean. The two dirs carrying a `.zip` are
      falsification residue; the nested-zip guard is present and rejecting at HEAD.
      Sweeping the litter: only after the dev server restarts — the running store
      holds one of those paths as a *string* (no fd, `lsof` proves nothing), and an
      early rm makes its next zip launch fail on `renameSync` into a missing dir.
      systemd-tmpfiles reclaims them in 10 days regardless
      *(landed `750b946`. `ZipTempStore` took a `root` defaulting to the OS tmpdir —
      behavior unchanged with no argument — and `createApp` a fourth optional
      trailing `zipTemp`, parallel with `cache` and `launcher`; only the root moved,
      so L7's vpath-keyed names, staging-rename and never-delete rules are untouched.
      Falsified by hardcoding `ensureDir` back to the tmpdir: the new test fails
      `expected false to be true` on the under-the-injected-root assertion. Its
      negative half is a before/after snapshot delta rather than an absolute
      cleanliness claim, since the real tmpdir is shared with other processes.
      Verified on merged main by the coordinator rather than taken from the report:
      67 dirs before a full server run, 67 after)*
- [x] 4.6 Implement 4.3's two decisions: kind-aware `open` labels resolved in
      `commandsFor`; drop `openIn`/`openWith` from `LIGHTBOX_PANEL_EXCLUDES` and give
      the panel the pill row above its action strip. Inverts the panel-withholds
      assertions in `viewerPanelActions.test.tsx` (semantics-is-the-point, not
      mechanical) and updates the entry-actions delta, already rewritten to match
      *(landed `ec447bf` 2026-08-25. The implementing worker died mid-verification
      on an account spend limit; its uncommitted work was salvaged as a patch,
      and the coordinator ran the falsification independently — arguably stronger
      than author-run, since the falsifier has no stake in the tests passing.
      Falsified: restoring `openIn`/`openWith` to `LIGHTBOX_PANEL_EXCLUDES` fails
      all six panel tests; flattening `labelFor` to a fixed "Open" fails both label
      tests with `expected 'Open' to be 'Open lightbox'`. Merged main: 447 client +
      173 server tests, typecheck clean. Live: model menu reads "Open lightbox",
      zip menu "Open archive", and the lightbox panel carries `open in LycheeSlicer
      Photon Workshop` above a strip ending in "Open with…")*
