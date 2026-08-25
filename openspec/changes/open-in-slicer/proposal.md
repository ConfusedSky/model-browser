# Open in Slicer

## Why

The point of browsing a print library is to print something, and today the app dead-ends at looking: getting a model into a slicer means leaving the browser and re-finding the file by hand. Spikes ruled out the browser-native routes — drag-out is blocked by Chrome (it strips `file://` from outbound drags, and crashes) and `xdg-open` delegation is unreliable — while direct launch of the user's slicers with a file path was verified working cold and warm for both installed slicers.

## What Changes

- The entry context menu on model tiles gains an inline **open-in** pill group (the axis-pill pattern — the menu deliberately has no submenu machinery) listing the applications associated with the entry's model type, default first; choosing one opens the entry's file in that application.
- The menu also gains an **Open with…** action that invokes the OS's own configured chooser (a server-configured command — e.g. the user's rofi chooser script) with the entry's file, for opens in a program that is not associated with the type. There is no portable chooser builtin, so the action is **absent when no chooser is configured** — absent rather than present and inert.
- The server gains a launch service: the client sends only `{path, appId}` (or just `{path}` for the chooser); the path is validated as `/api/file` validates, and commands never cross the wire.
- Platform integration (query the default application for a type, query associations, launch an application with a file, invoke the chooser with a file) runs on freedesktop machinery (`gio`/`gtk-launch` family) through **configurable command templates** in server config, so other distributions — and later Windows/macOS under the Electron seam (D1) — adapt without code changes.
- The system's own registry is the source of truth for what appears: no app-owned slicer list, no settings UI. Users configure by pinning defaults and associations at the OS level (or authoring desktop entries — the `photon-workshop.desktop` precedent).
- Drag-and-drop of models into other applications is explicitly **deferred** to a follow-up change riding the future Electron shell; this change delivers the same outcome through the menu.

## Capabilities

### New Capabilities
- `app-launch`: server-side service that resolves a model entry's type, reports the default and associated applications for it, launches a chosen application with the entry's file, and invokes the configured OS chooser — platform machinery behind configurable command templates.

### Modified Capabilities
- `entry-actions`: ADDED requirements only (no existing requirement changes) — the open-in pill group and the Open with… chooser as entry actions on model entries.

## Impact

- **Server**: new `/api` endpoints for application listing and launch (`server/src/app.ts`), path validation shared with `/api/file` (`vpath.ts`, `guard.ts`); zip virtual paths need temp extraction before launch (decided in design). The server process must carry the user session environment to launch GUI applications.
- **Client**: `EntryMenu.tsx` gains the pill group and the Open with… action via `entryActions` — no chooser UI of its own; all I/O through `ApiClient` (D1).
- **Specs**: `entry-actions` delta (ADDED), new `app-launch` spec. No collisions: none of the four in-flight changes touch these files.
- **Out of scope**: drag-out (deferred follow-up, Electron), touch interactions, non-Linux launch implementations (the template seam is the deliverable; only freedesktop templates ship).
