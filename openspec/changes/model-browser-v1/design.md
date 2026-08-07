## Context

Greenfield app. A personal 3D-print model library browser: point it at a directory, see every STL/3MF/OBJ as an orbitable thumbnail, step into zips as if they were folders. Runs locally (server reads arbitrary local paths), single user, no auth. All architectural decisions below were settled in an explore session; this document records them and their rationale.

## Goals / Non-Goals

**Goals:**
- Browser UI served by a local Bun server; `bun run dev` is the whole setup.
- Thumbnails feel live: hover pre-warms, mousedown orbits instantly, released orientation persists across sessions and browsers.
- Zips browse like folders with nothing written into the browsed directory.
- Every seam needed for a later Electron port exists from day one, at near-zero extra cost.

**Non-Goals:**
- Electron shell itself (only the seams for it).
- AI chat backend (panel is a placeholder).
- Hosted/multi-user deployment; user authentication. (The API is same-origin guarded per D10 — that is a correctness floor for a tool that reads arbitrary paths, not "hardening" — but there are no users, accounts, or authorization.)
- Decimated proxy meshes or handling for pathological file counts (scale target: dozens of files per directory, 1–100MB each).

## Decisions

### D1: Local Bun + Hono server with browser UI (not Electron, not pure-browser)
Pure browser (File System Access API) cannot accept a typed path or reveal real paths — it kills the editable path bar. Electron is heavier dev experience for no v1 benefit. A local server fits the stack (Bun/Vite/React/TS/Tailwind), allows arbitrary path reads, and is where a future AI-chat API key will live.

**Electron-readiness constraints:**
- API layer is Hono, which runs identically on Bun and Node (Electron main is Node).
- No Bun-only APIs (`Bun.serve` internals, `Bun.file`) leak into shared app logic; isolate runtime-specifics at the entry point.
- Frontend performs all I/O through an `ApiClient` interface (`listDir`, `getFile`, `getThumb`, …) — never raw `fetch` in components. Electron later swaps the implementation (HTTP → IPC) or keeps localhost HTTP unchanged.

### D2: Thumbnails are static PNGs; orbit uses one shared live overlay canvas (option B)
Browsers cap live WebGL contexts (~8–16), so per-tile canvases collapse at ~40 files. Full-page scissor-rect rendering (every tile live) is more machinery than the feel requires. Instead: grid tiles are `<img>` PNGs; on mousedown over a tile, the single shared WebGL canvas overlays that tile and drives OrbitControls. One context total — the same renderer also rasterizes thumbnails for the render queue (D3), so the app holds exactly one WebGL context, not one per purpose. It feels like every thumbnail orbits. One pointer gesture carries both tile actions: drag past a small threshold (~5px) orbits in place; release under it is a click and opens the lightbox — so no separate expand affordance is needed.

### D3: Client renders thumbnails; server persists them
Server-side WebGL means headless-gl (fragile native deps, shaky under Bun) or hidden-Chrome puppeteer. The client already has a GPU and the exact three.js scene (same loaders, materials, lighting) as the orbit view, so thumbnails match the live view pixel-for-pixel. The full-mesh load this implies is unavoidable wherever rendering happens (you cannot rasterize unloaded triangles), transfers are loopback, and the cost is paid once per file version. Bytes loaded for thumbnailing seed the mesh LRU.

Flow: on cache miss, a render queue (limited concurrency, geometry discarded after snapshot) loads → parses → renders → POSTs the PNG to the server.

The queue and the orbit overlay share **one** `WebGLRenderer` (the single context of D2): thumbnails render into an offscreen render target and are read back, the overlay renders to the visible canvas. Only one may render at a time, so the queue suspends while an orbit overlay or lightbox is active and resumes on dismissal — queue work can never hitch an interaction, and the "one live context" guarantee holds app-wide rather than only across successive orbits.

**Note — the escape hatch if suspending isn't enough.** Sharing one renderer is a main-thread decision, not a context-count decision. Two contexts *on the main thread* would be the worst available option: the queue would still block drags (one JS thread, one GPU), while every mesh rendered down both paths carries a second GPU-side copy and two renderer configs have to be kept pixel-identical by hand. The only split that actually buys parallelism is moving the render queue into a Web Worker with `OffscreenCanvas` — it then has its own context by necessity, parses and renders without touching the main thread, and the suspend rule becomes unnecessary rather than merely tolerable. If first-visit rendering janks interaction badly enough that suspending is insufficient, that is the change to make, and the doubled GPU residency plus the two-config discipline are its price. Deliberately not v1: at dozens of files per directory, suspending is enough.

Thumbnails are **512×512 PNGs with a transparent background**, fixed regardless of tile size or device pixel ratio: a cache entry then stays valid across grid densities, window sizes, and machines, and tiles simply scale it down. Transparency lets tiles theme freely without rebaking.

### D4: Cache keying — thumbnails by `path + mtime`, camera state by `path` only, both server-side
- Thumbnail keyed by `path + mtime`: file content changed → pixels stale → regenerate.
- Camera state keyed by `path` only: re-exporting a model should keep its saved orientation; only the pixels regenerate (using the saved camera).
- Both live server-side (e.g. `~/.cache/model-browser/`), stored together per file as `{png, cameraState}`. localStorage would strand orientation per-browser while server-side thumbnails claimed otherwise — same class of data, same store.
- On orbit release (and lightbox close), client saves camera state + re-snapshotted PNG in one request.
- **Zip entries key on the containing zip's mtime**, never the entry's stored timestamp. Archive timestamps are preserved verbatim across re-downloads, so an entry timestamp cannot detect a replaced zip — thumbnails would stay stale forever. The zip's own mtime detects it. Cost: re-downloading a byte-identical zip invalidates every thumbnail inside it. Correctness over hit rate; a re-render is cheap and a permanently wrong thumbnail is not.
- **Camera state is stored bounds-relative**, not in world coordinates: azimuth, elevation, and distance as a multiple of the model's bounding-sphere radius, with the target expressed relative to the bounding box. World coordinates would break D4's own promise — a re-export that is scaled, re-centered, or unit-converted (mm↔in is routine between CAD and slicer) would restore a camera aimed at empty space. Bounds-relative restores the same *view*.
- **Entries are stored under a hash of the virtual path**, with the plain path kept inside the entry for sweeps and debugging. Paths contain `/`, `!`, and spaces, and can exceed filename length limits.
- **The cache is bounded and swept.** On startup (and after writes crossing a threshold): superseded PNGs for a path are deleted, entries whose source path no longer exists are swept, and if total size exceeds a configurable cap (default 2GB) least-recently-read thumbnails are evicted. For a virtual path the existence test is against the **containing zip**, not the entry — checking entries would mean opening every zip and reading its central directory on every sweep. An entry deleted from a zip that still exists is therefore not swept; it is already unservable (its key carries the old zip mtime, so it can never be a cache hit) and is reclaimed by the size cap's LRU eviction. Camera state survives size-cap eviction of its thumbnail — it is a few hundred bytes, cannot be regenerated, and represents real user effort — but the existence sweep removes whole entries, camera state included: a path that no longer exists has nothing left to orient. (Entries inside a still-existing zip are safe either way, since the sweep's existence test is against the containing zip.)

### D5: Hover-warmed, byte-budgeted mesh LRU
On tile hover (after ~120ms linger debounce), fetch + parse the mesh into a client-side LRU so mousedown-orbit is instant. Concurrency cap (~2 parses in flight) prevents hover-storms. LRU budget is measured in **bytes** (default ~1GB, configurable), not entry count — with 1–100MB files, "last N entries" is meaningless as a bound, and a budget much below 1GB couldn't hold even one larger directory's worth of meshes. Mousedown before warm completes → brief spinner in the overlay (no worse than the unwarmed baseline).

The budget measures **parsed geometry on the JS heap** — typed arrays produced by the loaders. GPU residency is a separate, lazily-created copy: three.js uploads a geometry to VRAM on the first render that touches it and keeps it there until `dispose()`. So a full LRU's true peak is ~1GB of heap *plus* the VRAM share of whatever subset has actually been rendered (thumbnailed or orbited); hover-warmed-but-never-rendered meshes cost heap only. Sizing the budget against heap keeps the accounting something we can actually measure at parse time.

The consequence that matters: **eviction must call `geometry.dispose()` explicitly.** three.js tracks GPU buffers in a `WeakMap` keyed off the attribute, so a geometry merely dropped from the LRU and garbage-collected frees its heap and leaks its VRAM. The symptom — GPU memory climbing across a long browsing session until the tab dies — looks nothing like its cause, and no test catches it unless one is written for it.

### D6: Zip-as-virtual-folder via central directory; no extraction to the browsed directory
The zip central directory (tiny, at end of file) lists contents without decompressing anything. Entering a zip reads only that; entries render in the grid like a normal folder. Individual entries are decompressed server-side on demand when bytes are requested. Virtual path scheme: `<zip-path>!/<entry-path>` (e.g. `models/foo.zip!/parts/lid.stl`) so the rest of the app treats zip entries as ordinary paths. Decompressed bytes are throwaway; the persisted thumbnail is the durable artifact, so zip re-entry never re-decompresses just for thumbs. Zip library: fflate (or equivalent) on the server. Nested zips (a zip inside a zip) are out of scope: an inner zip is listed but activating it reports "nested zips are unsupported" rather than recursing — supporting it means either buffering the inner zip in memory or a second `!/` level in the path grammar, neither of which a Printables download has ever needed.

### D7: Formats — STL, 3MF, OBJ via three.js loaders, parsed client-side
Server streams raw bytes; client parses with STLLoader / ThreeMFLoader / OBJLoader. 3MF packages that embed `/Metadata/thumbnail.png` use it as an instant placeholder; our own render replaces it for visual consistency and rotation-state support.

### D8: UI structure
- **Path bar**: editable text input; server-backed autocomplete (directory-listing endpoint); recents in localStorage. Native system picker deferred to Electron (browsers cannot yield absolute paths).
- **Grid**: responsive thumbnail grid of subdirectories, zips, and model files; tiles pop in as the render queue completes.
- **Lightbox**: opened by clicking a model tile (press released under the drag threshold); expanded view as a modal overlay with full orbit/zoom; Esc/click-out closes; closing persists camera + thumbnail like orbit release.
- **Chat panel**: collapsible right-side panel, placeholder message UI only.

### D9: Vite + React SPA + Hono over Next.js (considered exception to stack preference)
Next.js was considered (it's in the preferred stack) and rejected for this app:
- The UI is a single-page, fully client-interactive WebGL app — every component would be `"use client"`; SSR/SEO/routing buy nothing on localhost.
- The server is a filesystem service (streaming large files, zip decompression, thumbnail cache), not page rendering; Hono expresses it with less framework around it.
- Next-in-Electron is awkward in exactly the wrong way: static export (`output: 'export'`) strips API routes — requiring a separate API server anyway — while embedding a Next production server in Electron means bundling it into the asar and managing ports. A Vite SPA builds to static files Electron loads directly, and Hono drops into Electron's Node main (or a sidecar) unchanged.
- Node-vs-Bun doesn't affect this: Hono runs identically on both, so "run it on Node" is already supported by D1.

Revisit if this ever becomes a hosted, multi-page, SEO-visible web app (explicitly a non-goal).

### D10: The API is same-origin guarded, because localhost binding is not a threat model
Binding to 127.0.0.1 keeps the server off the network but does nothing about the browser, which is the actual attack surface. Any page the user has open in another tab can issue

```js
fetch('http://127.0.0.1:PORT/api/file?path=/home/masa/.ssh/id_rsa')
```

and read the response; `PUT /api/thumb` is a write primitive with the same exposure. "Localhost-only" is what makes this dangerous, not what makes it safe: the server's whole job is reading arbitrary local paths as the user.

Guard, applied as middleware to all `/api/*` routes:
- Reject any request whose `Origin` header is present and is **not** a loopback origin (`http://localhost:*`, `http://127.0.0.1:*`). Absent `Origin` is allowed so non-browser clients (tests, curl) work; browsers send it on every `fetch`. It is *not* sent by no-cors subresource embeds (`<img src>`, `<script src>`), which therefore pass this check — closed by the next bullet.
- Serve model bytes as `Content-Type: application/octet-stream` with `X-Content-Type-Options: nosniff`. A cross-origin `<img src="…/api/file?path=…">` cannot read the response body regardless (canvas tainting), so the exposure is existence and image dimensions rather than contents — but ORB/CORB only blocks such embeds *dependably* when the response declares a non-media type and forbids sniffing, and `/api/file` accepts arbitrary paths, so it can be aimed at a real image. These two headers turn an incidental mitigation into a guaranteed one.
- Reject any request whose `Host` is not a loopback host — this is what closes DNS rebinding, where an attacker's domain resolves to 127.0.0.1 and the `Origin` looks legitimate to a naive check.
- Never emit CORS headers, so cross-origin reads fail even if a check were bypassed.

Loopback origins are allowed rather than one exact origin because the Vite dev proxy forwards `Origin: http://localhost:5173` to the API on another port; pinning a single origin would break `bun run dev`. The residual exposure — another *local* server's page attacking ours — is not in the threat model for a single-user personal tool.

This is ~10 lines and is the difference between "reads your files" and "lets any website read your files".

## Risks / Trade-offs

- [First visit to a fresh folder loads every mesh (potentially ~600MB over loopback)] → one-time per file version; queue + tile pop-in reads as progressive, not broken; loopback bandwidth makes transfer negligible.
- [Very large meshes (>100MB) may cause parse/render hitches] → limited-concurrency queue bounds memory; accepted at this scale; decimation is explicitly deferred.
- [Server reads and serves arbitrary local paths] → bind to 127.0.0.1 **and** enforce the D10 same-origin/Host guard, which is what actually stops other web pages reading your filesystem; acceptable for a personal localhost tool; revisit before any non-local deployment.
- [Nested zips are unsupported] → listed but not enterable, with an explicit message rather than a silent failure.
- [`!/` virtual path separator could theoretically collide with a real filename] → `!` in directory names is vanishingly rare; accepted.
- [Bun-specific APIs creeping into shared code erodes the Electron seam] → Hono everywhere, runtime-specifics quarantined to the server entry point, code review against it.
- [Shared overlay canvas must track tile position during scroll/resize] → overlay is dismissed on scroll/resize rather than repositioned (simplest correct behavior).

## Migration Plan

Greenfield — no migration. Rollback = don't ship. Electron port is future work enabled by D1's seams, not part of this change.

## Open Questions

- None blocking. Deferred decisions (Electron shell, chat backend, decimation) are recorded as non-goals.
