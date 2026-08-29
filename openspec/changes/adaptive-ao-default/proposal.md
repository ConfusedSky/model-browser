## Why

Ambient occlusion is on by default and off by choice. The choice exists because the cost is
real on the GPUs that feel it — 17 → 56 fps on an orbit drag with occlusion off, measured
on this machine's Radeon 780M in the supersampled lightbox (`viewer-ssao`) — but the user
has to know the pill exists, know what "ssao" means, and connect it to the stutter they
are seeing. Someone opening a public demo on a laptop's integrated GPU, or on a phone, will
do none of those things; they will see a viewer that stutters and conclude the app is slow.

"Is this a discrete GPU" is the wrong question to ask the browser — Apple's integrated GPUs
are fast, a GTX 1050 is discrete and struggles at six million pixels, and Firefox and
Safari mask the renderer string anyway. The app already knows the right question and its
answer: how long a frame takes here. This change makes it take that answer itself.
`docs/web-demo-notes.md` item 8 records the decision (Masa: "sampling frames to tune it to
the user's GPU").

## What Changes

- **The occlusion preference gains an *unset* state, and unset means measured.** A profile
  that has never pressed the pill starts with occlusion on and, the first time the lightbox
  opens, times a short run of frames; if the median exceeds a budget, occlusion is turned
  off for that profile, recorded as an automatic decision alongside the number that made
  it.
- **A choice is never overridden.** Pressing the pill makes the state a user's choice — on
  or off — and no measurement touches it again. An automatic *off* is sticky until the user
  turns it on; the pill shows when the current state was decided automatically.
- **Measurement is continuous, not one-shot.** While occlusion is on in the unset state,
  every rAF-driven run of live frames feeds the same running median, so a device that
  passed on a small model and stalls on a heavy one is caught the first time it stalls.
- **The lightbox is the surface measured**, because it is the heavier one: the orbit
  overlay renders a tile-sized canvas at 1.5× and would pass on hardware the lightbox
  chokes on.
- Because thumbnails follow the preference (`ao-as-recipe-dimension`) and the pill refreshes
  the grid in place (`ao-refreshes-thumbnails`), an automatic decision re-renders the visible
  grid the same way a press does. Nothing here changes a pixel of either recipe; no
  `RIG_VERSION` bump.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-viewer`: **ADD** *Occlusion defaults by measurement* — the unset state, the probe,
  the budget as a tune-then-freeze constant, the stickiness rules, and what the pill shows.
  The *Ambient-occlusion shading* requirement (MODIFIED by `ao-as-recipe-dimension`) is not
  touched: "on by default … a toggle … persisted per browser profile" remains true; this
  adds how the default is chosen when nobody has.

## Impact

**Client only.**

- `viewer/aoToggle.ts`: the stored value becomes `{ choice: 'on' | 'off' } | { auto: 'off',
  ms: number } | absent`; `aoEnabled()` keeps returning a boolean (the effective state);
  new `aoState()` for the pill and `recordFrame(ms)` / `noteAutoOff(ms)` for the probe.
  Old stored values (`'on'`/`'off'`) read as a user choice — they were one.
- `viewer/ViewerLayer.tsx`: the rAF-driven loops (the tween loop, and a new short probe
  loop on lightbox open in the unset state) report inter-frame intervals; the budget lives
  beside `LIVE_SUPERSAMPLE` in `viewer/renderSize.ts` as the other live-view tuning
  constant.
- `App.tsx`: the pill reads `aoState()` and shows an *auto* marker when the state was
  decided by measurement.
- No server, wire, or cache change.

**Ordering (hard)**

- After `ao-as-recipe-dimension` and `ao-refreshes-thumbnails`: an automatic decision must
  reach thumbnails and the visible grid the way a press does, or the decision would
  reintroduce the handoff jump it exists to avoid.
- Independent of `library-root`, `remove-axis-lighting` and `folder-contact-sheets`.
