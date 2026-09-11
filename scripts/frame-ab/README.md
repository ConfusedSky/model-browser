# frame-ab — the pixel claim behind `file-frame-spindle`, re-runnable

`file-frame-spindle` removed the `rotateX(-π/2)` bake `parseModel` applied to every STL and
redefined the spindle frame table as its image under the inverse bake (design D3, strategy
B). The claim that let cached thumbnails stay unrendered is that the same model, framed the
same way, is *the same picture* after the change. This directory is that claim as a
measurement rather than a sentence: baseline renders from the pre-change code, and a script
that renders the same samples with the code the app imports today and diffs them pixel by
pixel (design D6).

The spike that produced the numbers is archived at
`openspec/changes/file-frame-spindle/` (its `design.md` D3 and D6 quote them); the baselines
here are the frames that spike wrote.

## Run

```
node scripts/frame-ab/run.mjs             # the nine STL samples + the OBJ fixture, against baseline/
node scripts/frame-ab/run.mjs --obj-only  # the OBJ fixture alone: no library, no dev server
```

Preconditions, stated plainly:

- **This machine, as shipped.** The STL samples are nine files at the root of the real
  library (`/run/media/masa/STLLibrary`, id `97ecc020…`), read through a **live dev server
  on 3177** — `/api/library`, `/api/dir?path=/`, `/api/file`, GET only; the script never
  writes a thumbnail or a framing. The samples are not redistributable and are not in the
  repo; a sample missing from the listing is reported and skipped. The only fixture that
  travels is the L-bracket OBJ (`baseline/lbracket.obj`), so a machine without the library
  can run `--obj-only`, which pins the frame math but not the shadow residual.
- **Chromium 1228** from the Playwright cache and **playwright-core** from the npx cache,
  at the paths in `config.example.json`. Headless, default GL (swiftshader is tried as a
  fallback if the launch fails). A different Chromium or GPU driver is a different rasterizer
  and may move the residual; say which one a run used.
- Node ≥ 24 (`fetch`, `import.meta`), `bunx` on `PATH`.

The script starts its own Vite on `vitePort` (`bunx vite --port 5174 --strictPort` from
`client/`) — 5174, not the dev instance's 5173 — drives
`http://localhost:5174/spike/ab.html`, and stops Vite when it exits, also on error. The page's
`/api/file` fetches go through that Vite's `/api` proxy, which `client/vite.config.ts` points
at `127.0.0.1:3177`; `apiBase` is what the script itself reads the library and listing from
and should name the same server.

## What is gated

Today's render of each sample is compared against the frame the pre-change code wrote,
`baseline/<name>_C0.png`, in a fresh browser process. Only the `-noao` rows are gated
(≤ 2 % / ≤ 96); the AO-on rows are rendered, diffed and printed with `bound: reference` and
`pass: —`, and never fail the run, because the AO pass is not deterministic across processes
(next section).

For one day (2026-09-10 to 2026-09-11) the harness also had an `--mode in-process` that
rendered C0 live in the same page through the app's temporary compare pill (`file-frame-spindle`
D7) and gated every row; it went with the pill (task 5.2). Its run is kept below as history —
it is where seven of the nine `-noao` baselines came from.

## Config

`config.example.json` is checked in and holds this machine's paths. A `config.json` beside it
(gitignored) overrides any of its keys; an unknown key is an error.

| key | meaning |
|---|---|
| `playwrightCore` | directory of `playwright-core` (its `index.mjs` is imported) |
| `chromium` | the Chromium executable |
| `vitePort` | the port the script's own Vite serves the page on |
| `apiBase` | the dev server the listing and `/api/library` are read from |

## What a row is

Each sample is rendered through `renderThumbnailCanvas` (`client/src/three/renderer.ts`) — the
lossless half of `renderThumbnail`, the same staging, chain and readback as every thumbnail
the app writes, minus the WebP encode — and compared with `baseline/<name>_C0.png`, both
sides composited over the same opaque ground (`#3a3a40`, the contact-sheet cell colour; a
canvas stores premultiplied alpha, so raw RGBA disagrees with any viewer where alpha is low).
`diff px` counts pixels where any channel differs; `max Δ` is the largest channel delta.

Framing follows `baseline/results.json`, the record of the run that produced the baselines —
not the live listing, which has moved since (a sample framed since the spike would otherwise
be rendered from a camera the baseline never saw). Per sample the record says what C0 used,
in the old scene convention, and the script re-expresses it in the file convention:

| C0 was framed by | today's render uses |
|---|---|
| a stored camera at scene axis A | the camera unchanged, at `migrateAxis(A)` (D3: basis and camera pass through R⁻¹ together) |
| the index's pose | the listing's pose through `cameraForPose`, the app's own path; the axis and az/el it derives are checked against the record and a mismatch is printed as a note |
| the default camera (the OBJ fixture) | the default camera with `az + swapOffset(axis)` — the scene-to-file conversion of an OBJ camera: 0 at `y`, +90° at `z` |

Names: an STL row is its library path with every character outside `[A-Za-z0-9._-]` replaced
by `_`, plus `-noao` for the AO-off render (`_fat_cat.stl-noao`); the OBJ rows are
`OBJ_axis_{y,z}` and `OBJ_axis_{y,z}-noao`.

Output per row: `out/<name>.png` (today's render, lossless) and `out/sheet_<name>.png`
(baseline | current), plus `out/results.json` with every row and the config used. `out/` is
gitignored. Exit code 1 if any row fails.

## Tolerance, and where it comes from

| rows | pixels differing | max channel delta |
|---|---|---|
| `-noao` rows | ≤ 2 % of 65,536 | ≤ 96 |
| AO-on rows | reference only — printed, never gated | |

The basis (D6; the spike report `REPORT.md` in the archived change; the runs named below):

- **The bake residual** is what the harness measures. Within one process the change moves
  240–1,147 pixels per STL (0.4–1.8 % of the frame), mean channel delta ≈ 4, 73–85 % of
  them on an edge already present in the baseline — the spike's numbers, raw RGBA. Isolated
  by elimination: with the key light not casting, three of four samples go to 0/0 and the
  fourth from 1,008 to 53; MSAA 1 vs 4 changes nothing; float32 rounding is excluded
  (≤ 6.1e-17 relative, and a `rotateX(+π/2); rotateX(−π/2)` round trip gives 0/0). It is the
  shadow map's texel grid landing sub-texel differently in the rotated world. Nothing
  structural moves; the OBJ at `y` (a fixed point of the table) is 0/0. 2 % bounds the
  count; 96 bounds "a shadow edge moved a texel" with room, still far below the 255 a
  rotated or mis-framed model produces (a quarter turn moves 5k–45k pixels at 255).
- **The AO pass is not deterministic across browser processes, and on a real STL the
  difference is 5–23 % of the frame.** `GTAOPass` seeds its noise texture from an unseeded
  `SimplexNoise` (`Math.random`), so two *processes* render the same scene with different AO
  noise, while one process renders it the same way every time (the spike's noise floor,
  0/0 on every sample). The L-bracket measured for D6 put the cross-process floor at
  ≈ 4.6 % (1,788–3,035 px / max 14–27 between three fresh processes); the plumbing run
  below showed that the bracket, with little occluded area, was the wrong yardstick. This
  is why the harness cannot gate AO-on rows: no bound absorbs 23 % without also passing a
  mis-framed model. Seeding the noise would make them gateable, but it changes production
  pixels and is therefore a `RIG_VERSION` matter for another change, not this harness's.
- **So the `-noao` rows are the exact check.** (The in-process run below had no floor at
  all — it was the spike's own comparison, re-run — which is why it could gate every row.)

A row outside tolerance is a finding, not a threshold to widen. A widening has to argue
against the numbers above.

**Plumbing run (2026-09-10, task 4.1 — Chromium 1228, this machine, the code at that
commit, AO-on rows still gated at 5 %):** every `-noao`
row and every OBJ row inside its bound; the `-noao` STL rows at 1.41 % / max 12 (`fat_cat`)
and 0.43 % / max 10 (`xyzCalibration_cube`), which is the spike's residual (951 and 285 px
within one process). Eight of nine AO-on STL rows were *outside* 5 % — 9–23 % of pixels,
max 22–79. Attributed by re-running the mechanism, not the code: the same code in two fresh
Chromium processes differs by 22.40 % on `bod_test_cube_5s` (the harness row: 22.90 %),
13.62 % on `Pikachu_X_Kakashi` (13.98 %), 5.37 % on `xyzCalibration_cube` (5.52 %), and 0/0
on each with AO off. That run is what moved the AO-on rows to reference-only.

**In-process run (2026-09-10, task 4.2, the since-deleted `--mode in-process`, Chromium
1228, this machine, the compare pill present — before the pill and the mode were removed on
2026-09-11):** 22 rows, 0 failed. The STL rows at 0.38–1.87 % of pixels, max
channel delta 7–15, AO on and off alike — the AO-on row of a sample within a few pixels of
its `-noao` row (`fat_cat` 874 vs 922, `xyzCalibration_cube` 248 vs 282), which is the
spike's finding that the AO pass adds nothing within a process; the four OBJ rows 0/0. The
four self-checks (the legacy render against the stored `-noao` C0s: `fat_cat`,
`xyzCalibration_cube`, both OBJ spindles) were 0/0, so the pill's flag reproduces the
spike's C0 pixel for pixel, and the seven `-noao` baselines that run wrote are C0. The max
deltas are lower than the spike's 28–60 because the spike compared raw RGBA and this
harness composites both sides over the ground first — measured on that run's output: the
stored `fat_cat-noao` C0 against `out/_fat_cat.stl-noao.png` is 951 px / max 31 raw and
929 / 12 composited (PIL, rounding once), the spike's own 951/31 and the table's 922/12;
`xyzCalibration_cube-noao` 285/28 raw, 283/10 composited, against the spike's 285/28 and
the table's 282/10. The two `-noao` counts match the plumbing run exactly (922/12, 282/10).

**Baseline run (2026-09-10, task 4.2, `--mode baseline` — then a mode, now the only way
the harness runs — the same Chromium and commit, straight after the in-process run):** 22
rows, 0 failed, 11 reference only. All nine STL `-noao` rows gate green against the stored C0s — seven of them the frames the in-process
run had just written — at the **same counts and deltas** the in-process run gave
(`Pikachu_X_Kakashi` 1,037/10, `Main_Tubeless` 1,224/10, `Main_Complete` 1,123/15,
`bod_test_cube_5s` 688/15, `3DBenchy` 447/9, `BeardedGentleman` 629/8, `Octopus_sup_v5.6`
590/8, `fat_cat` 922/12, `xyzCalibration_cube` 282/10), the OBJ `-noao` rows 0/0; the AO-on
reference rows at 3.9–23.1 % / max 26–88 on the STLs and 2.8–4.6 % / max 18–19 on the
L-bracket, which is the cross-process AO floor once more, sample by sample.

## Baselines

`baseline/` holds the pre-change code's frames (`C0`): eighteen STL frames — the nine
samples with AO, from the spike, and the nine without, two from the spike and seven written
by the in-process run of 2026-09-10 through the pill's flag, after that run's self-check
showed the flag pixel-identical to the spike on the two the spike had written — the
L-bracket at `y` and `z` with and without AO, the OBJ fixture's text, and `results.json`,
the spike's record of the run that produced the originals — kept beside them because it is
the framing source above. They are lossless PNGs of the raw canvas
(`toDataURL('image/png')`), 902,357 bytes in all (884,473 of PNG), and they are **the
repository's first tracked binaries**: fixtures that cannot be regenerated, because the code
that rendered them is gone — the pill that wrote the seven went on 2026-09-11 (task 5.2).

The AO-on frames are one process's sample of the AO noise, which is why they are reference
only; the `-noao` frames exist so that every sample has an exact check.

**Regenerating them is legitimate exactly when the pixel recipe changes on purpose** — a
`RIG_VERSION` bump (`client/src/three/renderer.ts`), which has its own sweep and re-renders
every cached thumbnail anyway. Then: run the harness, judge `out/sheet_*.png` by eye, copy
`out/<name>.png` over `baseline/<name>_C0.png`, and record the run (the table, the Chromium,
the commit) in the change that bumped the version. Never regenerate to make a failing row
pass: the failing row is the measurement.

## The page

`client/spike/ab.{html,ts}` imports the app's modules (`parseModel`, `renderThumbnailCanvas`,
`cameraForPose`, `DEFAULT_CAMERA`, `formatOf`, `defaultAxisFor`, and `migrateAxis`/`swapOffset`
from `shared/frames`) and exposes `window.ab`:

- `render({ path, format?, bytes? | text?, axis?, camera?, pose?, ao? })` →
  `{ axis, camera, pngDataUrl }` — bytes given, else text, else `/api/file?path=`;
- `compare(pngA, pngB)` → `{ diff, max, pixels }`, both composited over the ground;
- `sheet([{ label, pngDataUrl }…], title)` → a PNG data URL;
- `migrateAxis`, `swapOffset`, `defaultCamera`, `thumbSize`.

It has no runtime switches of its own — what renders is what the app renders. It typechecks
because `spike` is in `client/tsconfig.json`'s `include`, and it is **not built into `dist`**:
`client/vite.config.ts` sets no `build.rollupOptions.input`, so `vite build`'s only entry is
`client/index.html`. Only the dev server serves it.
