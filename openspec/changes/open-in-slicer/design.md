# Design — open-in-slicer

## Context

The entry menu system landed with `entry-context-menu`: commands are defined once in
`client/src/lib/entryActions.ts` (`ENTRY_COMMANDS`, `EntryCommand` at entryActions.ts:591)
and drawn by `EntryMenu.tsx`, which documents (EntryMenu.tsx:38) why the menu has **no
submenu machinery** — focus is one flat index over buttons, and the axis choice is an
inline pill group for exactly that reason. The server exposes `/api/file`
(server/src/app.ts:86) with virtual-path parsing (`parseVPath`, server/src/vpath.ts) and
zip extraction (`extractEntry`, server/src/zip.ts); the guard checks Origin on `/api/*`.

Spike evidence (2026-08-24, this machine — Arch, Hyprland/Wayland, Chrome):

- **Browser drag-out is dead.** Chrome strips `file://` from outbound `text/uri-list`
  drags and crashed during the attempt; LycheeSlicer accepts drops only intermittently
  across the XWayland bridge. Drag is deferred to a follow-up change riding the future
  Electron shell (global D1 preserves that seam).
- **`xdg-open` delegation is not viable**: binary STL content-sniffs to
  `application/octet-stream` on stock xdg-utils, and the fallback chain is a browser.
- **Direct launch works, cold and warm.** `lycheeslicer <path>` opens the file and
  forwards into an already-running window (Electron single-instance); Photon Workshop
  via Wine (`wine start /ProgIDOpen PhotonWorkShop <path>`) opens a new window per
  launch — accepted behavior, outside our control.
- **Broken launchers are fixed at the desktop-entry layer**: Wine's visible Photon entry
  had no `%f`; a ten-line user-authored `photon-workshop.desktop` (in the user's
  dotfiles) fixed it and, via its `MimeType=model/stl;`, made Photon discoverable as an
  STL handler. This is the configuration escape hatch the design leans on.
- **Relative paths break single-instance forwards** (resolved against the running
  instance's cwd) — the server must always hand launchers absolute paths.

## Goals / Non-Goals

**Goals:**

- One-click "open in <slicer>" from the entry menu, default first, for model entries.
- "Open with…" for one-off opens in any installed application.
- The OS registry (defaults, associations, desktop entries) is the source of truth —
  no app-owned slicer list, no settings UI.
- Platform operations behind configurable command templates so other distributions and,
  later, Windows/macOS (Electron seam) adapt without code changes.

**Non-Goals:**

- Drag-out (deferred follow-up change), touch, non-Linux implementations (only the
  template seam ships), a slicer-config UI, guaranteeing the launched app succeeds
  (only that the launch command did).

## Decisions

**L1 — Registry is freedesktop, not app config.** The menu lists what
`gio mime <type>` reports: the default application first, then registered/recommended
associations. Users configure by OS-level pinning (`xdg-mime default`) or by authoring
desktop entries; the app stores nothing. Alternative rejected: an app-owned slicer list
with a settings UI and a config API — more surface, a second registry to keep in sync,
and a "config that executes commands" trust question. Known gap, accepted: a freshly
installed slicer whose desktop entry declares no model MimeType (LycheeSlicer's
declares none) is not associated until pinned once or given an entry — the
`photon-workshop.desktop` precedent shows the fix is ten lines in user space.

**L2 — Four platform operations, each overridable by an argv template.** Operations:
`default(mime)`, `associations(mime)`, `listApps()`, `launch(appId, file)`. Built-in
implementations: `gio mime {mime}` parsed for default/associations;
`gtk-launch {appId} {file}` for launch; `listApps` is a built-in scan of
`$XDG_DATA_HOME`/`$XDG_DATA_DIRS` `applications/` dirs (subdirectories included,
desktop-file ids formed with `/`→`-`, `NoDisplay`/`Hidden` filtered, user dirs winning
dedup) — there is no stock CLI that lists all applications. Server config may override
any operation with an **argv array** template using `{mime}`, `{appId}`, `{file}`
placeholders, substituted per-element and spawned via `execFile` — never a shell string,
so no quoting/injection surface. Overrides must produce the documented line-oriented
output (`appId<TAB>name` per line; first line of `default` is the default's id).
Config lives at `~/.config/model-browser/launch.json` (path overridable via
`MODEL_BROWSER_LAUNCH_CONFIG`), read at startup, absent file = builtins. Templates are
authored by the machine's user in a local file; they are trusted config, and nothing
network-supplied ever reaches them.

**L3 — Menu shape: inline pill group, not a submenu.** Follows the axis-pill precedent
and rationale recorded at EntryMenu.tsx:38 verbatim — a submenu would add open state, a
clamp, focus handoff, and a second Escape level for a row of two-to-four names. The
group renders as `open in  <Default> <Other> …` alongside the axis group, applies only
to model entries, and participates in the flat keyboard index. Revisit a real submenu
only if the associated-app list outgrows a pill row in practice.

**L4 — "Open with…" is an in-app chooser fed by `listApps`.** A menu command (a normal
`EntryCommand`) opening a modal list — name + filter input, keyboard operable,
Escape-dismissable following the menu's own conventions — of every installed
application, launching the pick once, remembering nothing. Alternative rejected:
invoking an OS chooser (rofi et al.) — machine-specific and unavailable to the
server's trust model. Deliberately absent: a "set as default" action in the chooser;
defaults are OS-level (L1), and the chooser must not silently diverge the OS registry
from what the user's own tools maintain.

**L5 — Server endpoints.** `GET /api/apps?path=<vpath>` resolves the entry's mime (L6)
and returns `{mime, default, associated, all}` (each app as `{id, name}`);
`POST /api/open` takes `{path, appId}`, validates the path exactly as `/api/file` does
(absolute, `parseVPath`, existence), resolves zip entries per L7, absolutizes, and runs
the launch operation. The client never sends commands, only `{path, appId}`; unknown
`appId`s are passed to the launcher, whose failure is reported (L8). All client I/O via
`ApiClient` (global D1).

**L6 — Mime resolution is a fixed extension table in the server.** `.stl → model/stl`,
`.3mf → model/3mf`, `.obj → model/obj` — the formats the app already parses. No
platform call: content sniffing is exactly what the spike showed to be wrong for binary
STL, and zip entries have no file to sniff until extracted. Entries outside the table
offer no open-in actions.

**L7 — Zip entries are temp-extracted per launch.** `foo.zip!/entry` is extracted with
`extractEntry` into a per-server-run `mkdtemp` directory under the entry's basename,
overwritten on each launch, and never deleted while the server runs (the launched app
may still be reading it); the OS reclaims the temp dir. Alternative rejected: excluding
zip entries — the library leans on zips (D6), and exclusion would make the menu lie by
omission.

**L8 — Launch success means the launch command succeeded.** `execFile` exit 0 →
success; nonzero/spawn error → the menu reports failure the way other entry actions
report theirs. Honest limitation, recorded: `wine start` exits 0 once it hands off, so
a Wine app that then fails to open the file reads as success — the server cannot see
deeper, and pretending otherwise would be false precision. The server also requires the
user session environment (DISPLAY/WAYLAND_DISPLAY, PATH) to launch GUI apps — true for
a dev server started from a terminal; noted as an operational constraint, not
bootstrapped.

## Risks / Trade-offs

- [OS registry coupling] App behavior depends on machine state outside the repo →
  accepted deliberately (L1); the state is itself user-versioned here (dotfiles
  mimeapps), and the template seam (L2) is the portability story.
- [Server spawns processes] New capability class for the server → constrained: argv
  arrays via `execFile`, no shell, commands only from local trusted config or builtins,
  path validated as `/api/file` validates, guard still fronts `/api/*`.
- [Session env absent] A server launched outside the session can list apps but launches
  fail or land on the wrong display → surfaced in the launch error path; documented.
- [Temp extraction growth] Repeated zip launches accumulate files in one run →
  bounded by overwrite-per-entry naming; OS cleans the dir.
- [Node compatibility] All of this must run on Node unchanged (global D1): spawning via
  `node:child_process`, temp via `node:fs`/`node:os` — no Bun-only APIs outside
  `server/src/index.ts`.

## Open Questions

- None blocking. Pill-row visual tuning (label, ordering beyond default-first,
  truncation of long names) is judged at implementation per the usual
  tune-then-freeze convention.
