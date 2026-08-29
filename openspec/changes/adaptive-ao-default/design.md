## Context

`viewer/aoToggle.ts` holds a two-state preference (`'on'`/`'off'`, `stored` helper, per
profile) that `ViewerSession.render` reads every frame and passes to the live chain. Live
frames are driven on demand: `renderNow` per `pointermove` during a drag, and a
`requestAnimationFrame` loop while an axis tween is in flight (`runTweenLoop`). The canvas
renders above device resolution — `LIVE_SUPERSAMPLE = 1.5`, capped at
`LIVE_MAX_PIXELS = 6_000_000` — which is why the lightbox, not the overlay, is where a weak
GPU shows. `getRenderer` already asks for `powerPreference: 'high-performance'`, which
engages a discrete GPU where the OS honours it (not Linux).

The measured fact behind this change: 17 fps with occlusion vs 56 without, orbit drag,
Radeon 780M, supersampled lightbox (`viewer-ssao` design). The decision is recorded in
`docs/web-demo-notes.md` item 8.

## Goals / Non-Goals

**Goals:**

- A profile that never touches the pill ends up with occlusion off on hardware that cannot
  afford it, and on everywhere else, without knowing the pill exists.
- A user's explicit choice is never changed by the app.
- The decision is inspectable: what was measured, and that it was automatic.

**Non-Goals:**

- Sniffing the GPU (`WEBGL_debug_renderer_info`) — the wrong axis, and masked on two
  browsers.
- Lowering occlusion quality (the AO output scale) before disabling it — a gentler lever
  the `viewer-ssao` design names; a follow-up if the binary decision proves too coarse.
- Turning occlusion back on automatically. Nothing can be measured with it off; the pill
  is the way back.
- Any change to the recipes, the cache, or the wire.

## Decisions

### D1: Three states, one boolean

Stored: absent (unset), `{ choice: 'on' | 'off' }` (the user pressed the pill), or
`{ auto: 'off', ms }` (measured). `aoEnabled()` still returns the effective boolean —
`choice` if present, else `false` under `auto`, else `true` — so every consumer
(`ViewerSession.render`, `useThumbnails`, the re-render commands) is unchanged. A stored
legacy `'on'`/`'off'` string reads as `{ choice }`: it was a press. `parse(null)` is the
unset state, which the `stored` helper already distinguishes from a stored value.

### D2: Measure frame intervals in a rAF loop, not `render()`'s wall time

WebGL calls are asynchronous; timing `chain.render` on the CPU measures command submission,
not the GPU. What the GPU cannot keep up with shows as the *interval* between consecutive
rAF-driven frames stretching past the display's period. So the measurement is: in a
`requestAnimationFrame` loop that calls `renderNow()` each tick, the time between ticks.
The existing tween loop (`runTweenLoop`, axis changes only; it serves both surfaces, so it
feeds the sampler only in lightbox mode) is one such loop; the probe
adds another — on **each** lightbox open while the preference is unset, a fixed run of
`PROBE_FRAMES` ticks at the lightbox's real render size, the first `PROBE_WARMUP`
discarded (shader compilation and target allocation land there). Intervals from either
loop feed one running median over the last `SAMPLE_WINDOW` frames. Nothing else is
sampled: an orbit drag calls `renderNow` per `pointermove`, so its intervals measure the
hand as much as the GPU (below), and there is no free-running render loop to listen to.
"Continuous" therefore means *repeated on every lightbox open plus every tween*, not
every frame the viewer ever draws.

*Alternative:* time during pointer drags. Pointer events arrive at input rate, and a slow
GPU stretches those intervals too, but so does a slow hand — a drag measures the user as
much as the device. Rejected.

### D3: The budget is a tune-then-freeze constant

`AO_FRAME_BUDGET_MS` beside `LIVE_SUPERSAMPLE` in `renderSize.ts`, starting at **33 ms**
(30 fps): the 780M case sits at ~59 ms per frame with occlusion and ~18 ms without, so the
budget lands between the two with room on both sides. Not derived from the display's
refresh rate — a 120 Hz panel does not make occlusion cheaper. The tasks.md line that sets
it is not done until the number has been judged on the iGPU browser here (CLAUDE.md's
visual-tuning rule), and the constant carries the measurements that placed it, where they
can be re-run.

### D4: The lightbox is the surface measured

The overlay is a tile-sized canvas at 1.5× — a few hundred thousand pixels; the lightbox is
up to six million. A device measured in the overlay would pass and then stall in the
lightbox, which is where a visitor lingers. So the probe runs on every lightbox open while the preference is unset
and the running median is fed only by lightbox frames. Overlay frames are not sampled:
their intervals say nothing about the surface that matters, and mixing them in would
dilute the median toward "fine".

### D5: Continuous, sticky, and never overriding

While unset and on, every lightbox rAF loop keeps feeding the median; the first time it
exceeds the budget, the state becomes `{ auto: 'off', ms: median }`. From then on nothing
is measured (nothing can be), and the pill shows "ssao · auto off". Pressing it writes
`{ choice: 'on' }`, after which the probe never runs again for that profile. A `choice`
is never touched by measurement; there is no path from `choice` back to unset except
clearing storage.

Why sticky: a device that stalled once will stall again on the next heavy model; flapping
between states re-renders the grid each way (`ao-refreshes-thumbnails`) for no gain.

### D6: The decision reaches the grid through the same path a press does

`ViewerLayer` owns the sampler but `App.tsx` owns the `ao` state the pill sets and the
viewer and thumbnails read, so the decision travels up through a new `onAoAuto(ms)` prop
and `App.tsx` routes it into that state — the same setter a press uses.

`ao-as-recipe-dimension` makes thumbnails follow `aoEnabled()`; `ao-refreshes-thumbnails`
makes a change in the preference re-run the sweep in place. The automatic decision goes
through the same store write and the same React-visible state as a press, so the visible
grid switches to the unoccluded render exactly as it would have. This is why the ordering
is hard: without those two, an automatic *off* would reintroduce the handoff jump.

## Risks / Trade-offs

- [The probe itself stutters the first lightbox open] → `PROBE_FRAMES` is small (a few
  dozen frames, under a second), rendering the model already on screen; the user sees a
  lightbox that is briefly busy, on hardware where it was going to be busy anyway.
- [A one-off hitch — a tab in the background, a page cache miss — flips a fast device off]
  → A running median over a window, not a single frame; the warm-up is discarded; and the
  decision is reversible by one press, which the pill labels as auto.
- [A fast device with a heavy model briefly exceeds the budget] → Same mitigation; and a
  device that renders a heavy model below 30 fps with occlusion *is* a device that should
  have it off for that model. The binary lever is coarse; the output-scale lever is the
  follow-up if this bites.
- [The budget is wrong] → It is a constant with its measurements beside it, judged on the
  iGPU browser before the tasks line closes; changing it is one number.
- [Two browsers on one machine decide differently] → Correct: the preference is per
  profile because the everyday browser runs on the iGPU while another may not (`aoToggle`'s
  own rationale).

## Migration Plan

None. Legacy stored strings read as a choice. A profile that never pressed the pill starts
measuring on its next lightbox open.

## Open Questions

- Whether the overlay should get a lighter version of the probe for a visitor who never
  opens the lightbox (the demo's phone case). Today: no — the overlay is cheap; revisit
  with a measurement on a phone.
