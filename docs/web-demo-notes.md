# Web demo — exploration notes (2026-08-28)

The record of an `/opsx:explore` session on hosting a public demo of model-browser
over the CC-BY corpus, **before any change exists**. Nothing here is normative:
when a change is proposed, its proposal/design/specs supersede this file and it
should point at them. A second session explored in parallel and sent a briefing;
where the two differ it is noted, and everything it claimed about the code was
verified against source before being kept.

Corpus: `~/Documents/tests/test-models` (its own repo, `ConfusedSky/model-browser-corpus`;
read its `NOTES.md` — measured findings on GLB vs STL, dedup, decimation, open
items). 297 kits, 2,254 shipped models in `miniatures/clustered-hq/` (1.8 GB,
0.84 MB/model, largest file 5.9 MB), all Thingiverse, **297/297 CC-BY** (no PD in
the shipped set), no zips. Provenance per kit in `metadata/miniatures.json`
(`name`, `author`, `author_url`, `source_url`, `license`, per-file `sha256`) —
**gitignored, exists only on that disk.** Index: mini-classify `embed-cache-test`,
2,165 models = 2,254 − ~89 `NON_MODEL_TAGS` drops (consistent, not confirmed by
count), root `miniatures/deduplicated/`.

Audience: recruiters viewing a portfolio (from the other session). First
impression and the link never being dead outrank everything else.

## The inversion at the center

Every security decision in the repo rests on one premise (`guard.ts`,
directory-browsing spec "API restricted to the app's own origin"): *the server
reads and serves arbitrary local paths as the user*. Hence loopback-only bind,
refuse non-loopback `Host`, never emit CORS, absolute paths in `/api/dir`,
`/api/file`, `/api/thumb`, and in URLs. A public demo inverts all of it: the
server must accept a public `Host`, and an absolute-path API on a public box is
path traversal by design. The demo needs a **root-confined address space**, not
"the app minus some features". The guard's spec *title* already says "the app's
own origin"; only its body hardcodes loopback.

## Decided

| decision | by | note |
|---|---|---|
| Port the server (container/VM), don't bake to static | corpus NOTES + both sessions | bake was weighed: D1's `ApiClient` seam would host a static client, `similar` is image×image dot products the browser could do, but text→embedding needs the SigLIP text tower (hundreds of MB) — one endpoint at minimum |
| Always-on VM, not cold-start serverless | Masa | 16 s SigLIP load + `wedged` UI is the wrong first impression |
| CPU-only index, fp32, US-located, 4–8 GB | Masa | see Measurements; GPU warmed is tens of ms, CPU 0.3–0.6 s judged acceptable (<1 s) |
| Folder tiles get a 2×2 contact sheet — **a main-app change, before the split** | Masa | today `Grid.tsx` renders a dir as 📁 + name; the demo root is 297 of them |
| Credits/provenance shown in the lightbox info panel | Masa | plus a generated credits page for CC-BY |
| ~~Lighting menu hidden in demo mode~~ → **axis lighting mode removed from the main app; camera is the only mode; the pill goes** | Masa | the hide was only ever to stop visitors picking axis. Item 9 has the grounding (1,758 sidecars say `camera`, 0 `axis`; axis's motivating bug has no counterpart in camera mode) |
| **SSAO stays a user option** (pill kept), default chosen adaptively by sampling frames; both AO variants baked for the demo | Masa | item 8 has the design: AO becomes a thumbnail recipe dimension, cache keyed by recipe |
| **`lighting-refreshes-thumbnails` is re-targeted, not retired**: its trigger becomes the AO pill | Masa | the mechanism — a toggle re-runs the staleness sweep in place, tiles keep their image while the replacement renders (§2), `poseStale` fix (§2b) — carries over unchanged; on the demo the sweep finds the other baked variant, so toggling is instant. Prerequisite: AO as a recipe dimension (item 8). Rename/`opsx:update` the change rather than start a new one |
| Chat **tab** hidden in demo mode | Masa | the side panel keeps its search-options tab |
| app-launch dies (`/api/apps`, `/api/open`, `/api/open-with`, launch.json) | all | `openInApps` builds from the `/api/apps` report and `Open with…` gates on `ctx.apps?.chooser` — an injected empty-report launcher withholds both with zero client code (verified) |
| GLB conversion deferred | other session, agreed | touches mini-classify `COVERS`, re-embedding, client loader; wire cost is fine |

## Open — need Masa's call

1. **Override/metadata store.** Three consumers: credits (per kit), display names
   (`name` vs `stem` with thing id), and poses-for-every-model (other session
   wants a server-local pose sidecar keyed by rel path — same store, third
   field). Sidecar JSON in the folder (travels with the kit; matters because the
   real library is on removable media) vs sqlite (`node:sqlite` only — D1;
   Bun compat unverified). Deciding question: *display only, or search by it?*
   Display → sidecars. Search → sqlite as a rebuildable index over sidecars.
   Note the thumb-cache sidecar is already a per-path store for camera/axis but
   is bounded and **evicts** — provenance cannot live there.
2. **Path model.** Root-confined but absolute (`?path=/corpus/Kit…`; less code;
   PNG cache keys hash the absolute path so the bake must run at the container's
   exact path) vs root-relative (`?path=/Kit…`; clean shareable links; portable
   cache keys; touches every `isAbsolute` check in `listing.ts`, `app.ts`,
   `vpath.ts`, `launch.ts`). Other session leans absolute; this one relative.
3. **Visitor orbits.** With `PUT /api/thumb` rejected, persist a visitor's
   drag-to-orbit in *their* localStorage, or freeze curated framings?
4. **Landing.** Kit tiles with contact sheets — is that the whole first screen,
   or also a sentence for a recruiter (what this is, what to try) — banner,
   About link beside credits, or nothing?
5. **Names.** Rename folders at corpus build (re-embed — needed anyway) or
   display-name from the store (near-free if #1 is sidecars; ids stay in paths).
6. **Domain.** On the critical path for TLS and the configured-origin guard.
7. **Which session owns the proposal.** Other session's sequence:
   pose-for-every-model → library-root-confinement → web-demo-deployment. This
   session adds: folder contact sheets, credits + store, hidden controls. One
   ordered set, with hard ordering against the four in-flight changes
   (`listing-tree-cache`, `search-cancellation`, `thumbnail-sweep-priority`,
   `lighting-refreshes-thumbnails`) — the first and third overlap directly
   (a baked tree is the tree cache's limit case; the bake is a sweep).

8. **Ambient occlusion on weak GPUs** (raised by Masa). On the demo thumbnails
   are baked, so AO costs a visitor only in the live view — but the orbit
   overlay opens over an AO thumbnail, so AO-off makes every touched tile change
   shading at handoff (the "Handoff stays seamless" scenario, suspended).
   `getRenderer` already asks `powerPreference: 'high-performance'` (works on
   Windows/macOS dual-GPU; Linux ignores it — where the 17 → 56 fps figure was
   measured, Radeon 780M, supersampled lightbox). "Is it a dGPU" is the wrong
   axis (Apple M-series integrated and fast; a GTX 1050 discrete and not;
   Firefox/Safari mask `WEBGL_debug_renderer_info`). Options: (a) demo-only
   `aoDefault: off` in the features value — one line, pays the handoff jump
   everywhere; (b) **main-app change, preferred**: AO on, measure the first
   clean live frames (orbit suspends the queue; skip warm-up frames), flip the
   existing `aoToggle` preference off when the median exceeds a budget, with
   the stored value three-state (unset/auto, user-on, user-off) so a choice is
   never overridden; pill stays (Masa confirmed: SSAO remains a user option). Budget is tune-then-freeze; the lightbox is
   heavier than the overlay, so budget the heavier surface. The AO output
   scale is a gentler first step than disabling (viewer-ssao design).
   **Masa, later the same day:** agreed on sampling frames; proposed two
   pre-rendered caches (AO on / AO off) so the adaptive default keeps the
   handoff seamless, noting cost may be model-dependent and the decimated
   corpus may make it moot. Grounded: GTAO's cost is per-pixel (AO + denoise,
   supersampled lightbox) plus a per-triangle pre-pass that is trivial at this
   corpus's tri counts (median 15k, p90 32k, max 117k — `miniatures.json`),
   so decimation does not shrink the cost, canvas size does; the population
   that trips it on a portfolio link is **phones**. Unmeasured: one
   `clustered-hq` kit in the iGPU browser, lightbox, pill on/off — do this
   first. Model-dependence is weak on the demo and real locally (million-tri
   STLs) — sample *continuously* (running median; flip off when exceeded; only
   the user flips back on), not once on the first model opened. The cache
   cannot hold two variants today: key is `sha256(path)`, `lighting`/`rig`/
   `posed` are echoed and gated client-side. Design that falls out: **AO
   becomes a thumbnail recipe dimension like lighting** (thumbnails follow the
   preference; the "always with occlusion" clause is rewritten) and **the
   cache key includes the recipe variant** — locally, switching keeps the
   other variant (instant switch-back, LRU-bounded); on the demo, bake both
   AO variants at one lighting mode (~270 MB each at the observed ~120 KB/PNG;
   1,705 cached here = 205 MB). Keyed-by-recipe would also allow the lighting
   menu to stay visible on the demo if all four variants were baked (~1.1 GB)
   — moot if item 9 removes the lighting pill. Hard ordering: after
   `lighting-refreshes-thumbnails` (same files, same pattern). No
   `RIG_VERSION` bump — each recipe is unchanged; the set grows.

9. **Remove the axis/camera lighting pill from the main app** — **decided (B), remove axis mode** (Masa: "camera almost always looks better"; the demo hide was only to keep visitors off axis). Grounded: of 1,758 thumbnail sidecars
   in `~/.cache/model-browser`, **1,758 say `camera`, 0 say `axis`** — this
   machine has run camera mode throughout — while `lighting.ts` has
   `DEFAULT_MODE = 'axis'`, so every fresh profile (every demo visitor) gets
   the other mode. Axis mode's motivating bug (world-fixed +Y rig lighting
   ±X/±Z-spindle models from the side, `axis-aware-lighting`) has no
   counterpart in camera mode, so dropping it loses nothing. Consequences:
   `lighting-refreshes-thumbnails` (active, 0/22) exists only because the pill
   does — **re-target it to the AO pill** (Masa): §1's trigger changes, §2 and
   the §2b `poseStale` fix (orbited + posed models re-render and re-PUT on every
   meaning-grid visit; read-verified, not run) carry over unchanged. Cache
   `lighting` label stays (it is what makes a leftover `axis` PNG stale); no
   `RIG_VERSION` bump. With one lighting mode the AO recipe set in item 8 is
   exactly two variants, and the demo's "hide the lighting menu" row is moot.
   Chosen: (B) **remove axis mode** — spindle-frame rig orientation in
   `renderer.ts`, the tween slerp in `session.ts`, the pill, `LIGHTING_MODES`,
   spec requirement rewritten camera-only ((A), flipping the default and
   keeping axis reachable, was the two-line alternative). Main app, before the
   split; lands before the re-targeted refresh change.

## Defaults this session would take unless told otherwise

- Download replaces Open-in/Open-with; Copy path becomes Copy link.
- Demo is an **env-selected mode of this repo**, not a fork: `MODEL_BROWSER_ROOT`
  set ⇒ confinement, read-only thumbs, launcher disabled, public-origin guard;
  the hidden controls come from a `features` value resolved once in `main.tsx`
  (via `ApiClient` or `import.meta.env`), keeping `if(DEMO)` out of `App.tsx`.
- Thumbnails **pre-baked, read-only**. PNG is derivable, camera is opinion:
  anonymous `PUT` of PNG bytes for any path is thumbnail defacement, and a
  persisted orbit is a global edit under D4 (camera keyed by path). "Crowd-warmed"
  (other session's open thread) is closed here for that reason.
- Bake at the default lighting mode only, **after** pose-for-every-model — today
  `useThumbnails` poses a tile only when the last search carried a pose
  (`wantsPose = poses[path] !== undefined`), so a bake before that change would
  produce un-posed tiles corpus-wide (verified).
- Index rebuilt against the deployed tree at its deployed path: `hitsToEntries`
  resolves `collection_root + rel_path` and drops non-resolving hits silently;
  `scopeWithin` checks against the same root. Also fixes duplicate results
  (index covers a wider tree than ships).
- Two containers behind Caddy (Hono + corpus, mini-classify); Caddy for TLS and a
  light rate limit on `/api/semantic`. mini-classify serialises queries already,
  so abuse degrades to queueing.
- Semantic states on the demo: `absent`/`volume-gone`/`wedged` collapse to
  "unavailable" (a visitor can't start a service or mount a drive); `warming`
  stays (container boot is real). "not indexed yet — run the classifier" copy
  needs a visitor-facing form.
- Static client served by Hono in `index.ts` (adapter-specific ⇒ D1 puts it
  there). `client/dist` exists from an earlier build; nothing serves it today.
- Kit-dominated results ("dragon" → five files from one kit): leave; flat view
  keeps a kit contiguous (D3).

## Measurements

All re-runnable; say whose run when quoting.

- **mini-classify on CPU** (this session, 2026-08-28, `eval/cpu_dtype.py --report`
  in mini-classify, embed-cache-test, Ryzen 9 7940HS, 8 threads, 16 queries):
  shipped fp16-on-CPU 1.14 s/query, **peak 7.7 GB** (converts the fp32
  checkpoint — would OOM an 8 GB host at startup); fp32 0.31 s, peak 2.8 GB,
  identical rankings; int8 dynamic 0.10 s but top-1 differs on 3/16 and `best_z`
  moves ±1 (declined); text-tower-only no gain (checkpoint is mmapped). Pinned
  to 4 cores: fp32 0.55–0.6 s. **Fixed:** `load_siglip` now picks fp32 off-GPU
  (mini-classify LEARNINGS, "fp16 on a CPU"). GPU warmed: tens of ms (Masa's run).
  Still extrapolated: a real shared cloud vCPU (~1 s guessed) — one paid hour on
  the target instance answers it.
- **Hosting, USD/month, 8 GB always-on, US** (web, 2026-08-28): Vultr $40,
  Fly.io ~$47 + volume/egress, DigitalOcean $48, Linode $48, Hetzner Ashburn
  CPX31 ~$78–85 after the June 2026 increase (no longer the cheap option in the
  US; CX line not offered there; 3 TB traffic). 4 GB tiers $24–28 — now a
  candidate at 2.8 GB peak. Oracle Always Free (2 OCPU/12 GB after a silent
  June cut, enforcement from Aug 18, idle instances reclaimed) — rejected: a
  demo visited a few times a month *is* idle. Hetzner Falkenstein CX33 €8.49
  (~$10, no VAT outside EU) noted, not chosen — US-located preferred.
- **Corpus**: see its `NOTES.md` (STL vs GLB sizes, dedup counts, decimation
  gates). `du` on `original/` reads 516 MB vs the notes' 12 GB — hardlink
  accounting order, not a discrepancy.

## Go-live gates (corpus side, not app decisions)

- IP pass by eye over the corpus (one Monster Hunter dragon known).
- `metadata/miniatures.json` backed up or tracked — sole copy today.
- Credits page generated from it (CC-BY requires displayed attribution).
- One paid hour on the actual instance for the query-latency number.
- Optional: Caddy access logs answer "did anyone visit" without an analytics script.

## Other session's briefing — what was checked

Verified true: `openInApps` empty-report behaviour; `wantsPose` gate;
`cached.camera ?? posed?.camera ?? DEFAULT_CAMERA` precedence (stored camera
beats pose); `POSE_VERSION = 2` and `posed:` on the PUT; production serving is
Vite-dev-only. Corrected: corpus path is `test-models/miniatures/clustered-hq/`;
licence mix is 297/297 CC-BY, not "CC-BY/PD"; "flips `posed: POSE_VERSION`" is
the `wantsPose` gate opening for every model, not a version bump — same
consequence (full sweep on the real library), different cause.

## Side effects of the session

- `test-models/CLAUDE.md`: two stale passages fixed (it *is* a git repo; token
  is gitignored and was never committed; `metadata/` is gitignored too).
- mini-classify: `load_siglip` dtype-by-device, its test, `eval/cpu_dtype.py`,
  learnings entry + index + README row. Uncommitted at time of writing.
