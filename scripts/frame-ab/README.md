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
node scripts/frame-ab/run.mjs             # the nine STL samples + the OBJ fixture
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
| the default camera (the OBJ fixture) | the default camera with `az + swapOffset(axis)` — what the D5 migration does to a stored OBJ camera: 0 at `y`, +90° at `z` |

Names: an STL row is its library path with every character outside `[A-Za-z0-9._-]` replaced
by `_`, plus `-noao` for the AO-off render (`_fat_cat.stl-noao`); the OBJ rows are
`OBJ_axis_{y,z}` and `OBJ_axis_{y,z}-noao`.

Output per row: `out/<name>.png` (today's render, lossless) and `out/sheet_<name>.png`
(baseline | current), plus `out/results.json` with every row and the config used. `out/` is
gitignored. Exit code 1 if any row fails.

## Tolerance, and where it comes from

| frames | pixels differing | max channel delta |
|---|---|---|
| AO on | ≤ 5 % of 65,536 | ≤ 96 |
| `-noao` | ≤ 2 % of 65,536 | ≤ 96 |

The basis (D6, spike report `REPORT.md` in the archived change):

- **The bake residual.** Within one process the change moves 240–1,147 pixels per STL
  (0.4–1.8 % of the frame), max channel delta 28–60, mean ≈ 4, 73–85 % of them on an edge
  already present in the baseline. Isolated by elimination: with the key light not casting,
  three of four samples go to 0/0 and the fourth from 1,008 to 53; MSAA 1 vs 4 changes
  nothing; float32 rounding is excluded (≤ 6.1e-17 relative, and a `rotateX(+π/2);
  rotateX(−π/2)` round trip gives 0/0). It is the shadow map's texel grid landing sub-texel
  differently in the rotated world. Nothing structural moves; the OBJ at `y` (a fixed point
  of the table) is 0/0.
- **The AO-noise floor.** `GTAOPass` seeds its noise texture from an unseeded `SimplexNoise`
  (`Math.random`), so two browser *processes* render the same scene with different AO noise:
  on the L-bracket, three fresh processes, AO on, 1,788–3,035 px / max 14–27 between any pair;
  AO off, 0/0 on every pair. The spike measured within one process and never saw it; this
  harness compares a fresh process against stored frames and always does. Up to ≈ 4.6 % of
  the frame, hence 5 % for AO-on rows.
- **So the `-noao` rows are the exact check** — the residual alone, ≤ 2 % — and 96 bounds "a
  shadow edge moved a texel" (≤ 60) plus AO noise (≤ 27), still far below the 255 a rotated
  or mis-framed model produces (a quarter turn moves 5k–45k pixels at 255).

A row outside tolerance is a finding, not a threshold to widen. A widening has to argue
against the numbers above.

**First run (2026-09-10, task 4.1's plumbing check, Chromium 1228, this machine, the code at
that commit):** every `-noao` row and every OBJ row inside its bound; the `-noao` STL rows at
1.41 % / max 12 (`fat_cat`) and 0.43 % / max 10 (`xyzCalibration_cube`), which is the spike's
residual (951 and 285 px within one process). Eight of nine AO-on STL rows were *outside* 5 % —
9–23 % of pixels, max 22–79. Attributed by re-running the mechanism, not the code: the same
code in two fresh Chromium processes differs by 22.40 % on `bod_test_cube_5s` (the harness row:
22.90 %), 13.62 % on `Pikachu_X_Kakashi` (13.98 %), 5.37 % on `xyzCalibration_cube` (5.52 %),
and 0/0 on each with AO off. So the AO-noise floor on a real STL is 5–23 % of the frame, not the
≤ 4.6 % the L-bracket measured for D6 — the bracket has little occluded area and a print model
has a lot. The bound is left as D6 states it; what to do about the AO-on rows (compare AO-off
only, seed the noise, or a bound stated per sample) is the change's call, recorded there.

## Baselines

`baseline/` holds the frames the spike wrote from the pre-change code (`C0`): eleven STL
frames (nine samples, `fat_cat` and `xyzCalibration_cube` also without AO), the L-bracket at
`y` and `z` with and without AO, the OBJ fixture's text, and `results.json`, the spike's
record of the run that produced them — kept beside them because it is the framing source
above. They are lossless PNGs of the raw canvas (`toDataURL('image/png')`), 594,030 bytes in
all, and they are **the repository's first tracked binaries**: half a megabyte of fixtures
that cannot be regenerated, because the code that rendered them is gone.

The OBJ AO-on frames are one process's sample of the AO noise; the `-noao` OBJ frames were
captured beside them so the fixture's exact check exists.

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

It has no runtime switches — what renders is what the app renders. It typechecks because
`spike` is in `client/tsconfig.json`'s `include`, and it is **not built into `dist`**:
`client/vite.config.ts` sets no `build.rollupOptions.input`, so `vite build`'s only entry is
`client/index.html`. Only the dev server serves it.
