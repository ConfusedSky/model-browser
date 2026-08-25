# model-browser

A local browser for a 3D-print model library. Point it at a directory tree full of
STL/3MF/OBJ files (zips included) and it gives you a thumbnail grid you can orbit,
search, and send to your slicer.

![stack](https://img.shields.io/badge/stack-Bun%20·%20Hono%20·%20React%20·%20three.js-blue)

## Quick start

```sh
bun install
bun run dev        # server on 127.0.0.1:3177, UI on http://localhost:5173
```

Open http://localhost:5173 and type an absolute path to your model library in the
path bar. That's it — thumbnails render in the background and cache to
`~/.cache/model-browser/`.

## Using it

- **Browse** — folders and zip archives open like directories (one level of zip
  nesting; paths look like `pack.zip!/part.stl`).
- **Orbit** — press and drag on any model tile to spin it live; the thumbnail
  keeps the camera angle you leave it at.
- **Expand** — click a tile for the full lightbox: orbit, zoom, orbit-axis
  control, and file details.
- **Right-click** — context menu with copy path, re-render, find similar, and
  open-in-slicer actions.
- **Search** — filename search from the top bar; optional semantic search
  ("chunky dragon, no supports") when the embedding sidecar is running.

## Opening models in your slicer

The context menu offers "open in …" for every application your OS associates with
the model's type (STL/3MF/OBJ), default first. It reads your desktop-entry
registry — there is no in-app slicer configuration:

- **Pin a default**: `xdg-mime default lycheeslicer.desktop model/stl`, or use any
  "always open with" affordance your desktop has.
- **Slicer missing from the menu?** Its desktop entry probably doesn't declare
  model types. Drop a corrected entry in `~/.local/share/applications/` — a
  ten-line file. Example (`photon-workshop.desktop` for a Wine-installed slicer):

  ```ini
  [Desktop Entry]
  Type=Application
  Name=Photon Workshop
  Exec=wine start /ProgIDOpen PhotonWorkShop %f
  MimeType=model/stl;
  ```

- **"Open with…"** hands the file to a chooser command of your choice (e.g. a
  rofi picker). Configure it in `~/.config/model-browser/launch.json`; the menu
  item is hidden until you do:

  ```json
  {
    "chooser": ["/home/you/bin/open-with", "{file}"]
  }
  ```

  The same file can override any launch operation with an argv template
  (`{mime}`, `{appId}`, `{file}` placeholders; no shell involved) — see
  `docs/platform-surface.md` for the operations and their contracts. Linux is the
  implemented platform; the doc sketches what Windows/macOS ports would swap in.

The server must run inside your graphical session (it launches GUI apps on your
display) — starting `bun run dev` from a normal terminal is exactly that.

## Semantic search (optional)

Text and similar-model search need a separate embedding service (SigLIP) answering
on port 8077. Without it the app runs fine and simply doesn't offer those
features. It takes ~15s to warm after starting; the UI shows its status.

## Development

```sh
bun run test         # vitest, both workspaces
bun run typecheck    # tsc, both workspaces
```

- Run a single workspace's tests from its directory (`cd client && bunx vitest run`)
  — not from the repo root.
- The repo is spec-driven: behavior lives in `openspec/specs/`, changes flow
  through `openspec/changes/`. `CLAUDE.md` carries the working agreements
  (architecture constraints, testing sharp edges) and is worth reading even if
  you're human.
- `server/` is Hono and must run on Node unchanged (Bun-only APIs are confined to
  its entry point); `client/` is React + Vite + three.js with a single shared
  WebGL renderer.
