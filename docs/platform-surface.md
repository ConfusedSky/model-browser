# Platform surface

The single place to look for everything OS-specific. Linux (freedesktop) is the only
implemented platform; the Windows/macOS columns are **unverified sketches** — candidate
mechanisms noted when the Linux side was built, to be validated when that port is
actually worked on. When a change introduces new OS-specific behavior, it adds a row
here as part of the change (see CLAUDE.md).

## Launch operations (app-launch capability, `open-in-slicer`)

Each operation is a configurable argv template with a Linux builtin — the seam exists
so other platforms can be served by config before they are served by code. Line-output
contracts and placeholder rules: `openspec/changes/open-in-slicer/design.md` (L2).

| Operation | Linux (builtin, verified) | Windows (sketch) | macOS (sketch) |
|---|---|---|---|
| `default(mime)` | `xdg-mime query default <mime>` (machine-readable; `gio mime` rejected — localized prose) | file-extension registry (`HKCU\...\FileExts`, `assoc`/`ftype`) | LaunchServices; no stock CLI — third-party `duti` or a tiny helper |
| `associations(mime)` | desktop-entry reader: the mimeapps.list chain by section (`$XDG_CONFIG_HOME` then per-data-dir; Default/Added associate, Removed excludes, first decision per id wins) ∪ `MimeType=` declarations read direct with XDG defaults applied (`${XDG_DATA_HOME:-~/.local/share}`, `XDG_DATA_DIRS` defaulting `/usr/local/share:/usr/share`); mimeinfo.cache is silently stale for hand-placed entries; stat through symlinks, files and dirs both | `OpenWithList`/`OpenWithProgids` registry keys | LaunchServices (`LSCopyApplicationURLsForContentType`) via helper |
| `launch(appId, file)` | `gtk-launch <id> <file>` | `cmd /c start` or direct exe path; ShellExecute under Electron | `open -a <App> <file>` — the easy one |
| `chooser(file)` | user-configured only (e.g. a rofi script); no builtin | `rundll32 shell32.dll,OpenAs_RunDLL <file>` — the native Open-With dialog | no stock chooser; likely stays unconfigured (feature absent by design) |

## Latent OS assumptions (no per-OS code yet, will surface in a port)

- **GUI session environment**: the server must carry `DISPLAY`/`WAYLAND_DISPLAY` and a
  session `PATH` to launch GUI apps (app-launch design L8). Windows/macOS spawn GUI
  processes without an equivalent requirement.
- **Paths**: paths on the wire are *library* paths — `/`-rooted and POSIX-spelled — confined
  in `server/src/library.ts`'s `resolve`, which `realpath`s the join and requires the result
  to be the library's real top or to start with it plus a separator. The `isAbsolute` checks
  that used to guard the routes no longer exist anywhere. The POSIX assumption moved rather
  than went away: `library.ts` mixes the wire grammar (`posix.normalize`, `posix.sep`) with
  the *platform* separator — `toLibPath`'s `relative(...).split(sep).join(posix.sep)` and
  `resolve`'s `realTop + sep` — and the `foo.zip!/entry` virtual-path separator
  (`server/src/vpath.ts`) is POSIX-spelled too. All of it is exercised only against POSIX
  paths; Windows drive letters and separators are untested against them.
- **User dirs**: thumbnail cache at `~/.cache/model-browser/<library-id>/` (the pre-library flat
  layout beside it is migrated once, then existence-swept), launch config at
  `~/.config/model-browser/launch.json` and the library root in
  `~/.config/model-browser/config.json` (`MODEL_BROWSER_ROOT` overrides it) are XDG-shaped;
  Windows (`%LOCALAPPDATA%`) and macOS (`~/Library/Caches`, `~/Library/Application Support`)
  differ.
- **The library marker** (`library-root` D1): `<library>/.model-browser/library.json` is the
  first file this app writes beside the models — a generated id at the library's top, found
  by walking up from the configured root. The walk stops at a **mount boundary**, compared as
  `stat().dev` on POSIX: a marker on another filesystem is never adopted. Filesystems that
  hand out per-subtree device numbers read as mounts here — btrfs subvolumes do, so a library
  top above a subvolume boundary is not found from a root inside it (the root becomes its own
  library; degraded, not broken). Windows/macOS are unverified: `st_dev` is per-volume on
  macOS, and Node reports a synthesised device number on Windows — a per-OS check before
  either is claimed. Where the walk finds nothing, a bounded probe **down** (4 levels, 2000
  directories visited) refuses a root that encloses an existing library rather than writing a
  marker over it. A volume that refuses the write (read-only media) runs `unmarked`: the id
  falls back to a hash of the top's real path, so the library's *location* is its identity —
  a remount **at a different location** is a different library and its cache does not follow,
  while one at the same location is the same library. On Linux that distinction is the one
  that usually applies: automount returns removable media to the same
  `/run/media/<user>/<label>`, so an unplug and replug keeps the id and the cache. Windows
  drive letters and macOS `/Volumes/<name>` are re-assigned rather than fixed, so the same
  volume can come back under a different path there — unverified. Listings never show the
  marker directory.
- **Secondary press**: every surface presenting an entry suppresses the platform's
  context menu to raise the app's (entry-actions), and offers Shift+secondary-press
  as the way through — recognised as Shift *plus the secondary button*
  (`nativeMenuRequested`, `client/src/lib/gesture.ts`). Shift and not Ctrl because
  Ctrl+click **is** the secondary press on macOS and arrives as `contextmenu` with
  `ctrlKey`; by the same token Ctrl+Shift+click there carries `button: 0` and is not
  the bypass — a two-finger tap or a second button is. Unverified on macOS, like the
  rest of this file. Firefox implements the same gesture below the page (Shift held,
  no `contextmenu` dispatched at all — `dom.event.contextmenu.shift_suppresses_event`);
  Chrome dispatches it with `shiftKey` set and the app declines it. Keyboard raising
  is unaffected either way: a keyboard-dispatched `contextmenu` carries `button: -1`
  (Chrome 150) or `0`, never `2`.
- **Content types**: the fixed extension→mime table (app-launch L6) is
  platform-neutral, but anything that would *consume* those mimes is registry-specific
  per the table above.
- **Unlink-while-open**: a launch or chooser collects its stderr into a temp file that
  `stderrSink` (`server/src/launch.ts`) unlinks immediately, keeping only the fd — so
  there is nothing to clean up on any exit path and the space returns when the last
  descendant closes it. POSIX allows that; Windows refuses to unlink an open file, so a
  port needs a named temp file plus explicit cleanup. The file is not incidental: stderr
  cannot be a *pipe* here, since every descendant inherits the write-end (which is what
  `close` would then wait on) and closing the read end early kills any descendant that
  writes to stderr afterwards — measured, a launched app takes SIGPIPE and dies.

## Deferred: native drag-out (future Electron change)

Drag-out of models rides the future Electron shell (global D1). Electron's
`webContents.startDrag` synthesizes the per-OS drag format — `CF_HDROP` (Windows),
file promises (macOS), `text/uri-list` (Linux XDND) — which is precisely why the
browser could not do this (spike evidence, 2026-08-24: Chrome strips `file://` from
outbound drags; see `openspec/changes/open-in-slicer/design.md` Context). Wayland
adds a caveat even under Electron: drags cross the XWayland bridge unreliably, so
source and target want to share a display protocol.
