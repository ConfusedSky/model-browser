## Context

Two findings from Masa's live test on 2026-09-11, each reproduced in a cell that fails on
main and confirmed against the dev instance by the investigating worker:

1. **The index becoming ready does not reach a landed listing.** `App`'s listing-wave
   effect has deps `[waveId, wavePaths, libraryReady, api, dispatch]` — the index's state is
   not an input — and the preview wave is the same shape with an "already asked" set. The
   availability read runs on mount, on a path change, and on a 2 s timer only while the
   index reports `warming`; an `absent` index that starts later is never re-read. Live: the
   index killed, the page landed (status read `absent` twice, eight pose POSTs answered
   `n=0`), the index restarted and the server read `ready` 20 s after landing — through
   80 s no status re-read, no pose POST, the watched tile's image URL and sidecar unchanged.
   A navigation heals it (the new landing's own wave), which is why this survived: the
   sequence "index off at landing, turned on, no navigation" is what a developer toggling
   the index does and what a user waiting for it to warm does.

2. **A render made under one pose is never stale under another.** `usable`'s pose test
   (`useThumbnails`) is `pose !== undefined && camera === undefined && axis === undefined
   && labels.posed !== POSE_VERSION`: the label is the mapping recipe's version, not the
   pose. `samePose` retires the slot and re-looks-up when the pose changes by value, but
   the hit then passes `usable`. Cell: a hit labelled `posed: 2` rendered under pose A
   (front az 225°), a second landing whose wave says pose B (az 45°): two waves, zero
   renders. On this machine the index's poses have not changed since the renders were
   made, so this was not what Masa saw — but a re-classification is the index's normal
   life, and nothing would show it.

Not a hole: a pose carried at emission, or arriving by wave, over a hit labelled without
`posed` — the reload case — re-renders (three passing cells), which is the mechanism
`pose-for-every-model` built.

## Goals / Non-Goals

**Goals:**
- A listing on screen when the index turns ready gets its poses once; an absent index
  started later is noticed without a navigation.
- A posed render records what it was drawn under, so a changed opinion is detectable.
- Renders labelled before this change are not swept.

**Non-Goals:**
- Any change to the pose itself, its derivation, or `POSE_VERSION`.
- Re-asking poses on every availability read (a same-state read is inert).
- A visibility/focus hook — one mechanism, the timer, covers every case including a user
  who never leaves the tab.

## Decisions

### D1: The index's readiness is an input of both wave effects

`indexReady = state.index?.state === 'ready'` joins the listing-wave effect's deps and the
preview wave's, the way `libraryReady` already does. A boolean, so a same-state re-read
re-renders nothing and re-asks nothing; the ready edge re-runs the wave for the landed
paths. The preview wave keeps its "already asked" set across a landing; on the ready edge
that set is cleared, or its entries stay marked asked with no answer. The accepted cost
`pose-for-every-model` already records for a ready→absent→ready flap: one extra ask, and
the sweep no-ops by value.

### D2: An absent index is re-read every 10 s, alongside the 2 s warming poll

The server memoises an absent probe for 10 s, so a read at that cadence costs a cached
answer and no probe; the 2 s poll while warming stays. Nothing is read while the index is
ready — the existing reads on mount and on a path change cover a ready index going away,
which the next navigation notices as today. Chosen over a `focus`/`visibilitychange`
re-read because a timer also serves the user who keeps the tab in front while starting
the index elsewhere, and one mechanism is easier to reason about than two.

### D3: A pose key beside the mapping version, compared only when present

A new optional label `poseKey?: string` on `ThumbSave`, `ThumbRenderInfo` and
`ThumbResult`, stored and echoed by `cache.ts` like `posed` and included in the
sibling-render comparison (`mine.poseKey !== theirs.poseKey` beside the `posed` compare),
passed through by the PUT route. Its value is what the pixels depended on and nothing
else: `poseKeyOf(pose)` = `${axis}:${az.toFixed(4)}:${el.toFixed(4)}` from
`cameraForPose`'s answer — `source` and `confidence` are excluded because they do not
touch pixels, and the raw `up`/`azimuth_zero`/`front` are excluded because two poses that
derive the same camera should not re-render. `usable` adds `labels.poseKey !== undefined &&
labels.poseKey !== poseKeyOf(pose)` to `poseStale`. Compared only when present: the 92
posed sidecars on this machine carry no key and stay hits until something else re-renders
them, which is what keeps `thumbnailQueue`'s "changed by value … keeping its image" cell
true; treating absence as stale would sweep every posed render once, a cost with no
finding behind it. `posed: number` keeps its type and meaning.

## Risks / Trade-offs

- [The 10 s absent poll runs forever on a machine with no index] → one cached GET per
  10 s; the server's absent memo means no probe. Acceptable; noted in the README if it
  ever shows up in a profile.
- [A pose whose derived camera differs in the fifth decimal re-renders] → `toFixed(4)`
  rounds below what a 256² render can show; a real re-classification moves degrees.
- [A ready→absent→ready flap re-asks once] → the recorded accepted cost; the sweep no-ops
  by value.
- [Old posed renders keep an outdated pose until re-rendered by another cause] →
  deliberate (D3); a rig bump or a reset framing catches them.

## Migration Plan

None for data: the label is optional and absent means "compare on the mapping version",
which is today's rule. The first landing after the client ships asks nothing new.

## Open Questions

- None. Masa's call on the timer cadence (10 s) and the compare-when-present rule was
  taken by the coordinator on 2026-09-11 at the worker's check-in.
