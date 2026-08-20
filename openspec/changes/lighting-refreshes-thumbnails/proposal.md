# Lighting Refreshes Thumbnails

## Why

Switching the lighting mode leaves the grid you are looking at drawn under the old one.

This is not a bug against the spec — it is the spec. `model-thumbnails`' *Lighting-mode-aware
thumbnails* already requires the client to treat a hit whose stored mode or rig version
differs as needing re-render, and the client does exactly that (`useThumbnails.ts:123-124`).
But three of that requirement's four scenarios time the upgrade to a *visit*: "the user
switches lighting mode and **revisits** a directory", "a directory **is visited** whose cache
entries predate lighting-mode storage" (the fourth is about lighting matching at handoff and
says nothing about when). The effect that performs the sweep takes
`[entries, api, lru, queue, setThumb]` (`:220`), so a mode change does not re-run it.

Lazy-on-visit was the right call for the case it was written against — a rig version bumped
between releases, upgrading a library as the user wanders through it, with no moment where
they are watching for the change. A mode toggle is the opposite case: the user pressed a
control that says what it does, is looking at the thing it applies to, and gets no response
from it. The rule is right and its trigger is missing one entry point.

The workaround is to navigate away and come back, which is a thing users learn rather than
guess.

## What Changes

- **A lighting-mode change refreshes the thumbnails on screen**, through the same staleness
  rule and the same render queue that a visit uses. Nothing about *what* re-renders changes;
  only *when* the check runs.
- **The sweep keeps each tile's image while its replacement renders.** It does not today —
  it resets every tile to a spinner on each run, which is invisible while runs only follow a
  listing change. Making a toggle re-run it would blank the grid, so preserving displayed
  images is part of this change rather than a property it inherits.
- **Camera state and axis are preserved**, exactly as on a visit — this replaces pixels.
- **The rig-version path stays lazy.** A new rig version arrives with a new build, where
  there is no gesture to respond to and nothing on screen waiting for an answer, and
  re-rendering every visible tile at startup is work nobody asked for.
- Unchanged: the cache, its keys, its sidecar, the queue's ordering, and what a thumbnail
  looks like. This change alters no pixels, so no `RIG_VERSION` bump.

## Capabilities

### Modified Capabilities

- `model-thumbnails`: **MODIFIED** *Lighting-mode-aware thumbnails* — the client's staleness
  rule gains a second trigger, so a mode change re-checks the thumbnails already displayed
  rather than only those a later visit rebuilds. `thumbnail-sweep-priority` modifies a
  different requirement of this capability (*Client-side thumbnail rendering*), so the two
  do not collide.

## Impact

- `client/src/hooks/useThumbnails.ts` — the sweep effect re-runs when the active lighting
  mode changes. Its cancellation and object-URL cleanup already handle being torn down
  mid-flight, since that is what a navigation does today.
- `client/src/viewer/lighting.ts` — the mode is read through `getLightingMode()` inside the
  effect; making it a dependency means it has to be observable rather than only readable.
- Interacts with `entry-context-menu`: its per-tile re-render (D7) stays useful afterwards —
  it covers a tile that is wrong for a reason no sweep can detect, such as a PNG rendered
  from a mesh that loaded badly. Neither change depends on the other.
- Cost: a mode toggle over a large listing queues a render per visible model. That is the
  intent of the toggle, and the queue already bounds concurrency.
