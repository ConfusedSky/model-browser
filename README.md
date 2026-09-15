# model-browser

**Live demo:** [models.masamaeda.com](https://models.masamaeda.com)

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
- **Search** — filename search from the top bar, and an optional *meaning* mode
  ("a chunky dragon on a rocky base") when the embedding sidecar is running. The same
  sidecar powers "find similar" and the upright pose each tile is drawn at.

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

A separate embedding service (SigLIP) answering on port 8077 adds three things, all
from the same index — the UI calls it **meaning search**:

- **Meaning mode** on the top-bar search ranks the models in the folder you're
  browsing against a phrase, instead of matching filenames.
- **Find similar**, in a tile's context menu, ranks the whole collection against
  that model.
- **Poses** — the orientation each model is drawn at, so tiles sit upright rather
  than however the file happened to be authored. An orbit still overrides it.

### Starting it

The service is [mini-classify](https://github.com/ConfusedSky/mini-classify), started
by hand:

```sh
cd mini-classify
.venv/bin/python serve_api.py <collection root> --cache-dir <embedding cache> --port 8077
```

The collection root must lie **inside** your model library — an index of models the
app can't reach covers nothing. The positional root overrides whichever root the
cache recorded when it was built, which is how one cache can serve a moved or
re-derived copy of its corpus. For a containerised setup, see `deploy/demo/README.md`.

`MODEL_BROWSER_INDEX` points the server at a different address; setting it to the
empty string turns the feature off outright.

### Without it, and while it warms

The app runs fine: browsing, thumbnails and name search don't touch the index, and
the meaning toggle simply doesn't appear. The states the UI reports are distinct and
worth reading literally:

- **Not running** — a refused connection. This is not "still warming"; nothing is
  listening.
- **Starting up** — roughly 15s while SigLIP loads, during which queries are
  refused. A meaning search typed now isn't lost: you get the folder listing
  meanwhile and the search runs when the index answers.
- **Didn't finish starting** — the load reported a failure, or stalled past three
  minutes. Most often the wrong `--cache-dir`: a cache with no embeddings in it.

The panel also states what the index *covers* for the folder you're in ("12 of 40
models here are indexed"), so a thin result set is legible rather than mysterious.

### Tuning

The Search tab exposes what the ranking does: read the phrase as written or through
a template, pool a model's views by mean/max/softmax, and bound the results by a
count (default 60), a score floor (default 0.10), or both — at least one is always in
force, since an unbounded meaning search is the entire collection. Mode and tuning
ride in the URL, so a meaning search is a link you can share.

### What it's bad at

Worth knowing before you read a flat result as a bug:

- **It ranks, it doesn't judge.** A query the corpus barely represents either
  returns nothing ("Nothing matched"), or returns whatever was least far. The
  "Nothing stood out — these are the closest" notice catches only the second case,
  and only when the result is unambiguous noise — it measures how far the best hit
  stands out from the collection's own spread, not whether it is right. A confident
  near-miss clears that bar easily and arrives unmarked.
- **A near miss is often a legitimate reading of your query.** "Wizard with a staff"
  brings back an orc shaman, who does carry a staff; "witch on a broomstick" brings
  back a mounted rider. Neighbouring concepts smear together for the same reason —
  vampires, zombies and skeletons all sit near "undead", so searching one brings the
  others.
- **It matches multi-part queries part by part.** "An elf carrying an orb" brings back
  elves, and people holding orbs, alongside the elves holding orbs.

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
