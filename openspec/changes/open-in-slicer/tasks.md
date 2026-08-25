# Tasks — open-in-slicer

> Ordering: `search-cancellation` also edits `server/src/app.ts` (its proposal cites
> the request AbortSignal work there) — re-read `app.ts` against main before starting
> section 2, and coordinate if that change is mid-flight. No spec-level collisions.

## 1. Server: platform operations (L2, L6)

- [ ] 1.1 Add the launch-ops module (Node APIs only — must run un-Bun'd per global D1):
      `default` via `xdg-mime query default {mime}`; `associations` and all display
      names via the targeted desktop-entry reader — union of `mimeapps.list` ids and
      entries whose `MimeType=` declares the mime, read directly from
      `$XDG_DATA_HOME`/`$XDG_DATA_DIRS` `applications/` dirs (subdirs included,
      traversal stats through symlinks with a depth/cycle guard —
      `dirent.isDirectory()` is false for the symlinked `dot_applications`,
      `-`→`/` id resolution, NoDisplay/Hidden filtered) — not `gio mime` (localized
      prose) and not `mimeinfo.cache` (misses subdir entries); `launch` via
      `gtk-launch {appId} {file}` with `execFile`; `chooser` config-only (unavailable
      until configured)
- [ ] 1.2 Config loading: `~/.config/model-browser/launch.json` (path via
      `MODEL_BROWSER_LAUNCH_CONFIG`), argv-array overrides with per-element placeholder
      substitution, absent file → builtins
- [ ] 1.3 Mime mapping from `modelFormat` (server/src/listing.ts:17) — no second
      extension table to drift
- [ ] 1.4 Server tests: template substitution stays per-element (metacharacter file
      name arrives as one argv entry), builtin selected when config absent, override
      selected when present, reader resolves subdirectory ids, traverses a
      **symlinked** subdirectory (the dot_applications shape) and finds a
      MimeType-declaring entry missing from `mimeinfo.cache`, names resolve from
      `Name=`

## 2. Server: endpoints (L5, L7, L8, L9)

- [ ] 2.1 `GET /api/apps` (no path parameter, no path validation) — fresh read per
      request, returns `{chooser, types}`: `chooser` the configured boolean, `types`
      mapping each handled mime to `{default, associated}` with `{id, name}` records
- [ ] 2.2 `POST /api/open` `{path, appId}` — validate as `/api/file` (nested zips
      rejected, app.ts:100), absolutize, temp-extract zip entries (per-run `mkdtemp`,
      name keyed on the full virtual path with the entry's extension, overwrite per
      vpath, never delete mid-run), run launch op, exit 0 → success, spawn/nonzero →
      error with reason
- [ ] 2.3 `POST /api/open-with` `{path}` — same validation/extraction/absolutize
      pipeline as 2.2, runs the chooser op **detached from the request lifetime**
      (client abort or hot reload must not kill it), responds when the command
      completes, unavailable (not error) when unconfigured, completion → success
      (dismissal included), spawn/nonzero → error
- [ ] 2.4 Server tests: missing file errors without launching, `a.zip!/part.stl` and
      `b.zip!/part.stl` extract to distinct files, nested zip rejected, relative input
      never reaches the launcher, launch failure surfaces its reason, open-with
      reports unavailable when unconfigured, spawns the configured argv when set, and
      survives a simulated client abort with the child still running

## 3. Client: entry actions (L3, L4, L10)

- [ ] 3.1 ApiClient: `apps()` fetched once per session and cached; `open(path, appId)`;
      `openWith(path)` issued with no timeout and no abort wiring, and completing it
      refetches `apps()` (the chooser may have rewritten the registry)
- [ ] 3.2 Generalize EntryMenu's keyboard arithmetic (EntryMenu.tsx:107–146) from one
      fixed-size pill group to two groups, one variable-length: index math, the
      land-on-current rule, initial focus still the first command, re-seed deps —
      open-in row below the axis row, both above the commands
- [ ] 3.3 Open-in pill group in `entryActions.ts` + `EntryMenu.tsx`: model entries
      only, default first, absent when no associations, data from the session cache
      (no probe on menu open — D6/2.5), one-shot launch, failure reported via a shared
      constant beside `COPY_FAILED` (entryActions.ts:145)
- [ ] 3.4 "Open with…" `EntryCommand`: offered exactly when the cached report says a
      chooser is configured (absent otherwise), one-shot handoff to
      `POST /api/open-with`, no client chooser UI, failure via the shared constant
- [ ] 3.5 `MenuItemId` gains `openIn` and `openWith`; both offered on tile/orbit/
      lightbox-menu surfaces and excluded in `LIGHTBOX_PANEL_EXCLUDES`
      (entryActions.ts:769) — panel scope deliberate
- [ ] 3.6 Client tests: group presence/absence per entry kind and association state,
      default-first ordering, Open with… present/absent on the chooser flag, no fetch
      fired by raising a menu, refetch after open-with completes, keyboard traversal
      across both pill groups, failure reporting path — grep-verify each asserted
      behavior actually has an assertion before checking this box

## 4. Config, verification, polish

- [ ] 4.1 Author the machine's `launch.json` with the chooser entry (the dotfiles
      `open-with` script) — the config that makes Open with… exist; without it 4.2's
      chooser steps cannot run
- [ ] 4.2 E2E against the live dev instance: pill row shows the current registry
      (default first — f3d as of writing); Open with… → pick Lychee with its
      set-default (Ctrl+Enter) → re-raise the menu and confirm the row now leads with
      Lychee (the registry loop end to end); open a zip entry; confirm the
      no-association and no-chooser-configured absences
- [ ] 4.3 Tune the pill row visually and settle the naming — the menu will hold
      "Open", "Reveal in app", "open in <X>", and "Open with…", four flavors of
      open/app — then freeze: not done when the code lands, done when the pixels are
      judged
- [ ] 4.4 Dry-run the archive per project convention
