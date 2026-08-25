# Tasks — open-in-slicer

## 1. Server: platform operations (L2, L6)

- [ ] 1.1 Add the launch-ops module (Node APIs only — must run un-Bun'd per global D1):
      the four operations — `gio mime {mime}` parsed for default/associations,
      `gtk-launch {appId} {file}` via `execFile` for launch, and `chooser {file}` with
      no builtin (unavailable until configured)
- [ ] 1.2 Config loading: `~/.config/model-browser/launch.json` (path via
      `MODEL_BROWSER_LAUNCH_CONFIG`), argv-array overrides with per-element placeholder
      substitution, absent file → builtins
- [ ] 1.3 Fixed extension→mime table (`.stl`/`.3mf`/`.obj`) with unmapped → no
      default/associations
- [ ] 1.4 Server tests: template substitution stays per-element (metacharacter file
      name arrives as one argv entry), builtin selected when config absent, override
      selected when present, mime table edges (case, no extension, zip inner name)

## 2. Server: endpoints (L5, L7, L8)

- [ ] 2.1 `GET /api/apps?path=` — validate path as `/api/file` does, resolve mime,
      return `{mime, default, associated, chooser}` — apps as `{id, name}` records,
      `chooser` the configured-or-not boolean
- [ ] 2.2 `POST /api/open` `{path, appId}` — validate path, absolutize, temp-extract
      zip entries (per-run `mkdtemp`, stable per-entry name, overwrite, never delete
      mid-run), run launch op, map exit 0 → success and spawn/nonzero → error with
      reason
- [ ] 2.3 `POST /api/open-with` `{path}` — same validation/extraction/absolutize
      pipeline as 2.2, runs the chooser op, unavailable (not error) when unconfigured,
      command completion → success (dismissal included), spawn/nonzero → error
- [ ] 2.4 Server tests: missing file errors without launching, zip entry extracts then
      launches with the temp path, relative input never reaches the launcher, launch
      failure surfaces its reason, open-with reports unavailable when unconfigured and
      spawns the configured argv when set

## 3. Client: entry actions (L3, L4)

- [ ] 3.1 ApiClient: `apps(path)` and `open(path, appId)` (all I/O through ApiClient,
      global D1)
- [ ] 3.2 Open-in pill group in `entryActions.ts` + `EntryMenu.tsx` beside the axis
      group: model entries only, default first, absent when no associations, flat
      keyboard index preserved, one-shot launch with failure reported like other
      actions
- [ ] 3.3 "Open with…" `EntryCommand`: offered exactly when `/api/apps` says a chooser
      is configured (absent otherwise), one-shot handoff to `POST /api/open-with`, no
      client chooser UI, failure reported like other actions
- [ ] 3.4 Client tests: group presence/absence per entry kind and association state,
      default-first ordering, Open with… present/absent on the chooser flag, failure
      reporting path — grep-verify each asserted behavior actually has an assertion
      before checking this box

## 4. Verification and polish

- [ ] 4.1 E2E against the live dev instance: open a fixture STL in Lychee from the
      menu (cold and warm), invoke Open with… (rofi chooser appears with the file),
      open a zip entry, confirm the unmapped-extension, no-association, and
      no-chooser-configured absences
- [ ] 4.2 Tune the pill row visually (label, ordering, long-name truncation), then
      freeze — not done when the code lands, done when the pixels are judged
- [ ] 4.3 Update `openspec/specs/entry-actions/spec.md` Purpose if archive tooling
      flags it, and dry-run the archive per project convention
