# Tasks — adaptive-ao-default

> Ordering (hard): after `ao-as-recipe-dimension` and `ao-refreshes-thumbnails` — an
> automatic decision must reach thumbnails and the visible grid the way a press does
> (design D6). Independent of `library-root`, `remove-axis-lighting`,
> `folder-contact-sheets`. Re-read `aoToggle.ts`, `ViewerLayer.tsx`, `renderSize.ts`,
> `App.tsx` against main before starting.

> No `RIG_VERSION` bump — no recipe changes. Client only.

## 1. The three-state preference (D1)

- [ ] 1.1 `viewer/aoToggle.ts`: stored shape `{ choice: 'on'|'off' } | { auto: 'off', ms }
      | absent`; `parse` reads legacy `'on'`/`'off'` as `{ choice }` and anything malformed
      as absent; `aoEnabled()` returns the effective boolean unchanged for every consumer;
      new `aoState()` (`'choice-on' | 'choice-off' | 'auto-off' | 'unset'`),
      `chooseAo(on)`, `noteAutoOff(ms)` (no-op unless unset)
- [ ] 1.2 `App.tsx`: the pill calls `chooseAo`, reads `aoState()`, and renders an *auto*
      marker (title text says what was measured) when the state is `auto-off`; its `title`
      and `viewer/aoToggle.ts`'s docstring stop claiming thumbnails ignore the preference
      (already false after `ao-as-recipe-dimension`; verify that change removed the copy,
      else remove it here). `remove-axis-lighting` edits the same pill block — whichever
      lands second re-reads it
- [ ] 1.3 Tests (`aoToggle.test.ts`): legacy strings read as a choice; unset is on; `noteAutoOff`
      flips unset to auto-off and is a no-op on a choice; `chooseAo` clears auto; a
      malformed value is unset

## 2. The measurement (D2, D4, D5)

- [ ] 2.1 `viewer/renderSize.ts`: `AO_FRAME_BUDGET_MS = 33`, `PROBE_FRAMES`, `PROBE_WARMUP`,
      `SAMPLE_WINDOW` — each with the measurement that placed it in a comment (the 780M
      59 ms / 18 ms pair; the probe's duration at 60 Hz)
- [ ] 2.2 `viewer/ViewerLayer.tsx`: a `FrameSampler` fed by rAF-driven loops only — the
      tween loop and a new probe loop that runs on **every** lightbox open while
      `aoState() === 'unset'`; overlay frames and drag frames never feed it. Median over
      the window; on exceeding the budget call `noteAutoOff(median)` and report it through
      a new `onAoAuto(ms)` prop, which `App.tsx` routes into the same `ao` state the pill
      sets, so `useThumbnails` and the live view react as to a press
- [ ] 2.3 The probe renders the model already on screen at the lightbox's real render size
      (`liveRenderSize` of the host), discards the first `PROBE_WARMUP` intervals, and stops
      after `PROBE_FRAMES` or on the first decision; a drag or close cancels it
- [ ] 2.4 Tests (component, fake rAF clock): intervals over budget for a window → auto-off
      recorded with the median and the grid's thumbnail requests switch to `ao=off`; one
      spike in a fast window → no decision; a `choice` → the sampler never runs; overlay
      frames → the sampler is not fed; the probe cancels on close

## 3. Tune, then freeze (D3)

- [ ] 3.1 Judge the budget on this machine's iGPU browser in the lightbox: with occlusion on,
      a heavy model must trip it and a light one must not — record both medians beside the
      constant. Not done when the code lands; done when the pixels and the number have been
      judged (CLAUDE.md)
- [ ] 3.2 Judge it once on a discrete GPU (the 4060 profile): nothing trips

## 4. Verification

- [ ] 4.1 `bun run test` / `bun run typecheck` clean
- [ ] 4.2 Live: clear the profile's stored preference, open a heavy model's lightbox on the
      iGPU browser — the pill flips to auto-off within a second, the grid re-renders
      unoccluded in place (`ao-refreshes-thumbnails`), pressing the pill turns it on and
      it stays on across a reload and further heavy models
- [ ] 4.3 `docs/web-demo-notes.md` item 8: mark as drafted here; note the open question
      about an overlay-sized probe for phones
