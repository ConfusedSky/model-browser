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
  dotfiles) fixed launching. Its `MimeType=model/stl;` was at first **not** visible
  through the cache-backed registry — and the first-recorded explanation ("the cache
  does not index symlinked subdirectories") proved wrong on re-test: rebuilt
  explicitly, the cache indexes them fine. The true failure mode is **silent
  staleness**: `mimeinfo.cache` is a build artifact, and nothing reruns
  `update-desktop-database` for hand-placed entries, so a new `MimeType=` declaration
  stays invisible indefinitely (verified both ways, 2026-08-24). Direct desktop-entry
  reading is immune to that. This shapes the association builtin (L2). The user's
  dotfiles installer now links entries singly and rebuilds the cache itself, but the
  server cannot assume every machine does.
- **Relative paths break single-instance forwards** (resolved against the running
  instance's cwd) — the server must always hand launchers absolute paths.

## Goals / Non-Goals

**Goals:**

- One-click "open in <slicer>" from the entry menu, default first, for model entries.
- "Open with…" delegating to the OS's own configured chooser for opens in any
  installed application.
- The OS registry (defaults, associations, desktop entries) is the source of truth —
  no app-owned slicer list, no settings UI.
- Platform operations behind configurable command templates so other distributions and,
  later, Windows/macOS (Electron seam) adapt without code changes.

**Non-Goals:**

- Drag-out (deferred follow-up change), touch, non-Linux implementations (only the
  template seam ships), a slicer-config UI, guaranteeing the launched app succeeds
  (only that the launch command did).

## Decisions

**L1 — Registry is freedesktop, not app config.** The menu lists what the platform
registry reports: the default application first, then the associated applications.
Users configure by OS-level pinning (`xdg-mime default`, the chooser's own
set-default) or by authoring desktop entries; the app stores nothing. Alternative
rejected: an app-owned slicer list with a settings UI and a config API — more surface,
a second registry to keep in sync, and a "config that executes commands" trust
question. The registry's state is whatever the user made it, recorded honestly: on the
development machine as of 2026-08-24, `model/stl` defaults to `f3d.desktop` (a viewer,
not a slicer) and the associations after the NoDisplay filter are LycheeSlicer (via a
user-level override entry in dotfiles that adds the model MimeTypes the stock
`/usr/share/applications/lycheeslicer.desktop` omits) and Photon Workshop
(`photon-workshop.desktop`) — the raw registry also lists a Wine shim
(`Name=0FileVersion`) and f3d's NoDisplay plugin, which the filter removes (L2). The
row therefore reads `F3D · LycheeSlicer · Photon Workshop`: both slicers present, led
by the viewer, until the user pins a slicer as default. Note `f3d.desktop` itself
declares no `MimeType=` at all (verified) — it leads purely as the mimeapps default,
so default and associations are genuinely different sources and the default need not
appear among the associations. Both slicer associations exist because the user
authored entries — the escape hatch working as designed, and also proof a fresh
machine starts with less. The designed path to a
slicer-led row is the chooser loop (L4): Open with… → pick the slicer → its
set-default re-orders the row. The 4.2 E2E exercises exactly that loop.

**L2 — Four platform operations, each configurable as an argv template.** Operations:
`default(mime)`, `associations(mime)`, `launch(appId, file)`, `chooser(file)`.
Built-ins: `default` runs `xdg-mime query default {mime}` — one machine-readable line.
`associations` does **not** shell out to `gio mime`: its output is localized prose
with curly quotes and ids only (verified), unfit for a stable parse — instead a
**targeted desktop-entry reader** combines `mimeapps.list` with the entries whose
`MimeType=` declares the mime. The mimeapps read honors its sections, not a flat
union: `[Default Applications]` and `[Added Associations]` associate,
`[Removed Associations]` **excludes** — an app the user explicitly removed must not
get a pill — reading the standard locations in precedence order
(`$XDG_CONFIG_HOME/mimeapps.list` first, then per-data-dir
`applications/mimeapps.list`), with the env-var **defaults applied**: on this machine
`XDG_DATA_HOME` is unset and `~/.local/share` is absent from `XDG_DATA_DIRS`
(verified), so reading the variables literally misses the one directory holding every
entry that matters — the reader uses `${XDG_DATA_HOME:-~/.local/share}` plus the
`XDG_DATA_DIRS` default `/usr/local/share:/usr/share`. Entry scanning reads the
`applications/` dirs directly rather than `mimeinfo.cache`, because the cache is
silently stale for hand-placed entries: nothing reruns `update-desktop-database` for
them (the `photon-workshop.desktop` finding, Context). Subdirectories are descended
as deliberate spec conformance — the desktop-entry spec scans them — with ids formed
`/`→`-` and resolved back `-`→`/`. The live example, Wine's
`wine/Programs/AnycubicPhotonWorkshop/AnycubicPhotonWorkshop.desktop`, proves
subdirectoried entries exist but changes nothing the pill row reports today (it
declares no `MimeType=`); it does set the depth bar — three levels down, so the
guard's limit must comfortably exceed that — and if such an entry ever declared a
model type, its name would collide with the user's presentable entry the way the
duplicate-`F3D` plugin does, which the NoDisplay filter would not catch: a
name-collision among displayable entries is possible and simply renders as two pills. The traversal MUST `stat()` through symlinks —
**files and directories both** — with a depth/cycle guard: every dotfiles-deployed
entry is now a top-level file symlink for which `dirent.isFile()` is false (verified:
`lycheeslicer.desktop`, `photon-workshop.desktop`), so a naive `withFileTypes` filter
skips exactly the entries the feature exists for. `NoDisplay`/`Hidden` entries are
filtered from associations, and the filter is load-bearing, not cosmetic: for
`model/stl` it removes `wine-extension-stl.desktop` (`Name=0FileVersion`) and
`f3d-plugin-native.desktop`, whose `Name=F3D` would otherwise duplicate the default's
pill. The same reader resolves any id to its localized `Name=`, which is the **only
source of display names** anywhere in the design. This is not the deleted
installed-applications scan: it resolves given ids and matches three mimes; it never
enumerates for enumeration's sake. `launch` runs `gtk-launch {appId} {file}` via
`execFile`. `chooser` has **no builtin** — no stock freedesktop CLI pops an
application chooser — so it exists only when configured, and the feature depending on
it is absent otherwise (L4). Server config may supply or override any operation with
an **argv array** template using `{mime}`, `{appId}`, `{file}` placeholders,
substituted per-element and spawned via `execFile` — never a shell string, so no
quoting/injection surface. Overrides of the query operations must produce the
documented line-oriented output (`appId<TAB>name` per line; first line of `default`
is the default's id — names the override's own job, since ids alone would render a
pill as `lycheeslicer.desktop` instead of `LycheeSlicer`). Config lives at
`~/.config/model-browser/launch.json` (path
overridable via `MODEL_BROWSER_LAUNCH_CONFIG`), read at startup, absent file =
builtins. Templates are authored by the machine's user in a local file; they are
trusted config, and nothing network-supplied ever reaches them.

**L3 — Menu shape: inline pill group, not a submenu.** Follows the axis-pill precedent
and rationale recorded at EntryMenu.tsx:38 verbatim — a submenu would add open state, a
clamp, focus handoff, and a second Escape level for a row of two-to-four names. The
group renders as `open in  <Default> <Other> …` alongside the axis group, applies only
to model entries, and participates in the flat keyboard index. Revisit a real submenu
only if the associated-app list outgrows a pill row in practice.

**L4 — "Open with…" delegates to the OS's configured chooser, absent when none.** A
menu command (a normal `EntryCommand`) that asks the server to invoke the `chooser`
operation (L2) with the entry's file — behind the same validation, zip extraction, and
absolutization pipeline as launch. The chooser is whatever the user configured (here:
the dotfiles rofi `open-with` script — icons, filtering, and its Ctrl+Enter
set-default), so the app reuses the machine's one chooser instead of maintaining a
parallel one, and anything the chooser does to the OS registry — setting a default
included — is the OS layer acting on itself, legitimately re-ordering the pill row for
the next menu. With no chooser configured the action is **absent rather than present
and inert**, per entry-actions' own philosophy; the pill row still covers the
associated applications. Alternatives rejected: an in-app modal fed by an
installed-applications scan (an earlier draft of this design) — it rebuilt an OS
surface inside the app in direct tension with L1, required the hairiest builtin (an
XDG desktop-entry scanner), and had to forbid set-default to avoid diverging the
registry; and keeping that modal as a fallback for unconfigured machines — all of the
code on the least-exercised path.

**L5 — Server endpoints, and no probe on menu open.** `GET /api/apps` takes **no
path**: it returns `{chooser, types}` — `chooser` the configured-or-not boolean (a
per-server-config constant with no business on a per-entry request), `types` a map
from each handled mime (L6) to `{default, associated}` with apps as `{id, name}`. The
client fetches it **once per session** and reads the cache when a menu opens — never a
probe issued when a menu opens, which is a recorded rule (`AvailabilityContext`,
entryActions.ts:142, D6/2.5), and also what keeps the menu's command list synchronous:
EntryMenu measures, clamps, and seeds focus from `commands.length` on mount
(EntryMenu.tsx:107–160), so late-arriving commands would visibly re-position the menu
and jump focus. The cache is refetched each time an open-with completes, since the
chooser may have rewritten the registry (L9). The endpoint reads the registry fresh on
each request — no server-side memoization across requests. `POST /api/open` takes
`{path, appId}`; `POST /api/open-with` takes `{path}` and runs the chooser operation
(reporting unavailable when unconfigured). Both validate the path exactly as
`/api/file` does (absolute, `parseVPath`, existence), reject nested-zip entries as
`/api/file` does (app.ts:100), resolve zip entries per L7, and absolutize. The client
never sends commands; unknown `appId`s are passed to the launcher, whose failure is
reported (L8). All client I/O via `ApiClient` (global D1).

**L6 — Mime resolution maps the existing format detector, not a second table.**
`modelFormat` (server/src/listing.ts:17) already decides what a model is
(`/\.(stl|3mf|obj)$/i`) and is what makes an entry `kind === 'model'`; the mime is a
mapping of its result (`stl → model/stl`, `3mf → model/3mf`, `obj → model/obj`), so
the two can never drift. No platform call: content sniffing is exactly what the spike
showed to be wrong for binary STL, and zip entries have no file to sniff until
extracted. Because model-kind and mime share one detector, "unmapped extension" is
unreachable from the UI (non-models get no open-in actions at all); it exists only for
hand-typed API paths.

**L7 — Zip entries are temp-extracted per launch.** `foo.zip!/entry` is extracted with
`extractEntry` into a per-server-run `mkdtemp` directory under a name keyed on the
**full virtual path** (sanitized/hashed), not the entry's basename — `a.zip!/part.stl`
and `b.zip!/part.stl` must not share a temp file, or the second launch overwrites
bytes the first app may still be reading, the exact hazard this decision exists to
avoid. The file keeps the entry's extension (launched apps key on it). A repeat
launch of the same virtual path MUST NOT truncate in place — that would gut the very
in-flight reader the no-delete rule protects — it extracts to a staging name and
`rename()`s over the target, so a still-reading application keeps the inode it
opened; nothing is deleted while the server runs, and the OS reclaims the temp dir. Alternative rejected: excluding zip entries — the
library leans on zips (D6), and exclusion would make the menu lie by omission.

**L8 — Launch success means the launch command succeeded.** `execFile` exit 0 →
success; nonzero/spawn error → the menu reports failure the way other entry actions
report theirs. Honest limitation, recorded: `wine start` exits 0 once it hands off, so
a Wine app that then fails to open the file reads as success — the server cannot see
deeper, and pretending otherwise would be false precision. The chooser operation reads
the same way: its command completing is success, and a chooser the user dismissed
without picking is a success in which nothing happened — not an error to report. The
server also requires the user session environment (DISPLAY/WAYLAND_DISPLAY, PATH) to
launch GUI apps — true for a dev server started from a terminal; noted as an
operational constraint, not bootstrapped.

**L9 — The chooser request spans a human decision.** The chooser command blocks in its
UI until the user picks or dismisses — seconds to minutes, unbounded — and
`POST /api/open-with` completes when the command does, because completion is when the
registry may have changed (L5's refetch keys on it). Consequences, decided: the client
issues that call with no timeout and wires no abort; a dropped or aborted request MUST
NOT kill the spawned chooser (a dismissed chooser and a killed chooser must not read
the same), so the child is spawned detached from the request's lifetime — which also
keeps a `bun --hot` reload from orphan-killing a chooser mid-decision. A second
Open with… while one is up is not prevented client-side; rofi refuses a second
instance itself, which surfaces as the command failing and is reported like any
failure (L8).

**L10 — Menu integration is a generalization, not a drop-in.** EntryMenu's keyboard
arithmetic is written for exactly one fixed-size pill group (EntryMenu.tsx:107–146:
`axisCount = AXIS_LETTERS.length + 1`, `count = axisCount + commands.length`, the
land-on-the-letter rule, `focused` seeded at `axisCount`); a second, variable-length
group generalizes all of it — explicit tasks, not incidental work. Layout: the open-in
row sits below the axis row, both above the command list; the menu still opens focused
on the first command. Surface placement is chosen through the existing excludes
vocabulary: `MenuItemId` gains `openIn` and `openWith`, both offered on the three menu
surfaces (tile, orbit, lightbox menu — a one-shot launch is honest everywhere) and
both excluded from the lightbox info panel (`LIGHTBOX_PANEL_EXCLUDES`,
entryActions.ts:769) — panel scope is deliberate, not accidental. Failure reporting
uses a shared constant beside `COPY_FAILED` (entryActions.ts:148) so "reported the
same way" is structural. Naming needs the 4.2 pass: the menu already carries "Open"
(the lightbox) and "Reveal in app" (this app), and "open in <X>" plus "Open with…"
makes four flavors of open/app in one short menu — the labels are a tuning decision,
judged with the pixels.

**Apply-time adjudications** (coordinator rulings on worker check-ins, recorded so the
next contradiction is recognizable):

- *mimeapps semantics*: first decision per id wins scanning locations in precedence
  order; within one file, Removed beats Added (the user's explicit removal is the
  safer read). Association ordering: mimeapps-added ids in precedence/file order,
  then MimeType-declaring entries not already present, sorted by name.
- *Dashed-id resolution*: candidates are CUMULATIVE left-to-right dash→`/`
  substitutions (first dash; first+second; …) after the literal try — single-swap
  candidates cannot reach `wine/Programs/AnycubicPhotonWorkshop/…`, which needs three
  simultaneous replacements. Scanned entries resolve via the scan's own id map first.
- *Wire shapes beyond shared/types*: `POST /api/open` and `/api/open-with` succeed
  with `200 {ok:true}` (the PUT /api/thumb precedent); validation failures mirror
  `/api/file` (400/404, same wording); a launch command that fails is **502** (the
  indexErrorReply precedent — a downstream process failing, not our bug); chooser
  unconfigured is **503 `{error, unavailable:true}`** (the semantic-status precedent:
  availability the UI renders, not an error). The client treats any non-ok launch
  reply as the one shared failure message; it never needs to distinguish 503, since
  the action is hidden when unconfigured and a 503 can only arrive on a stale-report
  race.
- *Client-abort coverage*: asserted structurally (chooser spawn options carry
  `detached:true` and no signal; the handler never reads `c.req.raw.signal`) rather
  than via a real listening server — `app.request()` has no connection to abort, and
  a socket-level test buys flake, not confidence.
- *`createApp` grows one optional trailing `launcher` param* defaulting to the real
  factory — additive, no existing call site changes; config is read eagerly at
  construction ("read at startup").
- *The report lives in component-local App state, not the reducer* — the reducer
  holds what the search machine reads (the `index` cell feeds the corpus decision);
  nothing in it reads the apps report, so it sits with `actionText`-class ephemeral
  cells. Fetched once per session in a sibling effect beside the index fetch, deps
  `[api]` only; the refetch lives in the `openWith` command body (both outcome
  branches) via a `host.refreshApps()` capability, so the rule stays where the
  rationale lives.
- *Menu keyboard rule for the second group*: entering the open-in group from outside
  lands on its first pill (the default app); consequently ArrowUp from that pill
  enters the axis group and lands on the letter in force, exactly as the existing
  crossing rule already promises. Initial focus moves to `pillCount` (still the
  first command).
- *"Open with…" appends last in `ENTRY_COMMANDS`* — 4.3's naming/ordering pass owns
  its final position; adjacent "Open / Open with…" is the exact confusion 4.3 flags.
- *The row dedupes by id, never by name*: default first, then associated minus the
  default's id (defensive even though the server also excludes it — a configured
  override might not); name collisions still render as two pills (L1).
- *App pills are `role="menuitem"` with `data-app-id` and NO `data-command`* — ARIA
  honesty over test-helper convenience; the existing `items()` helper keeps seeing
  only commands, and a new test asserts exactly that.
- *Client mime derivation is `model/${entry.format}`* — the entry's `format` is the
  server's own `modelFormat` result, so no second table exists on either side.

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
  bounded by stable per-vpath naming (staging files renamed over targets); OS cleans
  the dir.
- [Node compatibility] All of this must run on Node unchanged (global D1): spawning via
  `node:child_process`, temp via `node:fs`/`node:os` — no Bun-only APIs outside
  `server/src/index.ts`.

## Open Questions

- None blocking. Pill-row visual tuning (label, ordering beyond default-first,
  truncation of long names) is judged at implementation per the usual
  tune-then-freeze convention.
