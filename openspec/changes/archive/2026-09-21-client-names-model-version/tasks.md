# Tasks — client-names-model-version

> **Client only.** Nothing under `server/`, nothing in `shared/`, no new route, no new
> listing field, no configuration. The one server-side property this change leans on — a
> stale version answered with a validator — belongs to `byte-route-cache-headers`; §0.1
> checks it is there and §4.5 keeps checking.
>
> **Archive after `byte-route-cache-headers`.** No requirement is shared with it — the only
> delta here is `model-viewer`'s ADD — but that requirement's prose cites
> *Model byte responses are cacheable by the version they name*, which is in that change's
> delta and not yet in `openspec/specs/public-deployment/spec.md`; archived first, this
> change's applied spec would point at a title that does not exist. Implementation is not
> blocked by it: that code is committed (`253f228`).
>
> Read design D1's inventory before touching anything: it is the list of every place a
> version has to reach, and it was taken by grep rather than inferred.

## 0. Preconditions

- [x] 0.1 Confirm, read-only, that `byteTiers` (`server/src/app.ts`) returns the strong tag
      on its *named but not current* arm — `byte-route-cache-headers`' amendment. This change
      is safe only while that holds (design D8): without it, a model the listing cannot
      correct (#34) is a full download on every visit where today it is a 304. If it is
      missing, stop and raise it against that change rather than editing `server/` here.
- [x] 0.2 Re-read `client/src/App.tsx` and `client/src/components/Grid.tsx` and run
      `git status` before editing: parallel sessions work this tree, and
      `hover-prefetch-listings` / `hover-prefetch-thumbnails` extend the same hover seam
      §2.7 widens (neither is implemented today — check again rather than trusting this line).

## 1. The API seam (`client/src/api/client.ts`)

- [x] 1.1 `ApiClient.fetchModel`: declare `fetchModel(path: string, mtime?: number): Promise<ArrayBuffer>`.
      Give it a JSDoc block saying what the version is (the listing entry's `mtime`, the
      archive's for a zip entry), what omitting it means (the version-less tier — a
      revalidation, not a pin, and otherwise identical), and that it must never be rounded
      (design D2/D5). One block: only the last of several consecutive JSDoc comments reaches
      a hover, as `getThumb`'s comment already notes.
- [x] 1.2 `ApiClient.fetchModelGlb`: the same optional trailing `mtime`, same doc, keeping
      the existing sentence about `stl` versus `obj`/`3mf`.
- [x] 1.3 `HttpApiClient.fetchModel`: append `&mtime=${mtime}` to the `/api/file` URL **only
      when `mtime !== undefined`**, the way `getThumb` appends `gen`. Interpolating is how
      `String(mtime)` is obtained here — no separate call, and no `toFixed`, `Math.round` or
      `| 0` anywhere on this path (design D5). `path` keeps its `encodeURIComponent`; the
      version needs none **at millisecond scale**, where `Number.prototype.toString` emits
      digits and at most a `.`: exponent form, whose `+` would have to be encoded or it
      decodes as a space, begins above 1e21 and a millisecond timestamp is ~1.8e12.
- [x] 1.4 `HttpApiClient.fetchModelGlb`: the same append on the `/api/model.glb` URL. Leave
      `if (!res.ok) throw await errorOf(res)` untouched in both — failure handling does not
      move (design D9).
- [x] 1.5 `client/src/api/localFramings.ts`: confirm **no edit is needed** —
      `LocalFramingClient.fetchModel` and `fetchModelGlb` forward
      `...args: Parameters<ApiClient["fetchModel"]>`. Confirmed by **reading** those two
      forwarders, because typecheck cannot confirm it: a method declared
      `fetchModel(path: string)` is assignable to an interface member
      `(path: string, mtime?: number) => …` — fewer parameters are compatible — so a
      decorator spelling the old arity typechecks and silently drops the version. It happens
      not to bite here (`LocalFramingClient` is the only decorator, and `HttpApiClient` the
      only other `implements ApiClient`), but a future decorator author gets no guard from
      `tsc`; a cell like 3.1, asserting the URL a call actually builds, is the guard.

## 2. The thread from the entry to the request

- [x] 2.1 `client/src/three/lru.ts`: `MeshLru`'s constructor parameter `load` becomes
      `(path: string, mtime?: number) => Promise<LoadedModel<T>>`; `acquire(path, mtime?)`
      passes it to `load` **on the miss path only**; `warm(path, mtime?)` forwards to
      `acquire`. The resident map, the in-flight map and `has(path)` keep their key: the
      version is not part of it (design D4) — if a `path + mtime` key appears anywhere in
      this file, the change has gone wrong.
- [x] 2.2 `client/src/three/meshLoader.ts`: the returned loader takes `(path, mtime?)` and
      passes `mtime` to `api.fetchModelGlb` for `stl` and to `api.fetchModel` for
      `obj`/`3mf`. Nothing else in it moves — the 3MF placeholder, `parseModel` and
      `geometryBytes` are untouched.
- [x] 2.3 `client/src/hooks/useThumbnails.ts`: in the load effect's render job, the
      `lru.acquire(entry.path)` before `renderThumbnail` becomes
      `lru.acquire(entry.path, entry.mtime)` — the same `entry.mtime` the `putThumb` a few
      lines below already sends.
- [x] 2.4 `client/src/lib/entryActions.ts`, `renderEntryThumbnail`: `deps.lru.acquire(entry.path, entry.mtime)`.
- [x] 2.5 `client/src/lib/entryActions.ts`, `setOrbitAxis`: `host.lru.acquire(entry.path, entry.mtime)`.
- [x] 2.6 `client/src/viewer/ViewerLayer.tsx`: the session effect's
      `Promise.all([lru.acquire(viewer.entry.path), savedPromise])` passes
      `viewer.entry.mtime`. Leave the effect's dependency array as it is — it keys on
      `viewer.entry.path` deliberately, and adding the mtime would re-open the session on a
      listing refresh that changed nothing else.
- [x] 2.7 The hover seam, three files, one shape: `client/src/lib/hover.ts`
      (`createHoverWarmer`'s `warm` and the returned `enter` take `(path: string, mtime?: number)`;
      the linger debounce, `leave` and `HOVER_LINGER_MS` are untouched),
      `client/src/components/Grid.tsx` (both `onModelHover` prop declarations become
      `(path: string | null, mtime?: number) => void`, and the tile's `onPointerEnter` passes
      `entry.path, entry.mtime`; `onPointerLeave` still passes `null` alone), and
      `client/src/App.tsx` (`onModelHover` forwards the pair to `hover.enter`, and the
      warmer is built as `createHoverWarmer((p, m) => lru.warm(p, m))`). Design D6 is why
      this is worth a prop: a version-less warm and a versioned press are two URLs.
- [x] 2.8 `client/src/jobs/bulkJobs.ts`: confirm **no edit** — its `lru: Pick<MeshLru<THREE.Object3D>, "acquire">`
      is a declared dependency it never calls, and every mesh it needs comes through
      `renderEntryThumbnail` (2.4). Confirm by grep for `.acquire(` in that file, and by
      typecheck.

## 3. Tests

- [x] 3.1 `client/test/apiClient.test.ts`, beside the existing *fetchModel returns raw bytes*
      and *fetchModelGlb requests /api/model.glb and returns its bytes*: assert the URL both
      fetchers build **with** a version — `/api/file?path=%2Fm.stl&mtime=1789446597239.1736`
      and the `/api/model.glb` equivalent — using a fractional mtime, so the cell fails if
      anyone rounds (design D5). Assert `fetchFn.mock.calls[0]![0]` exactly, as the existing
      GLB cell does. Two more assertions in the same cell or beside it, so three delta
      scenarios are observed rather than assumed: a **zip entry** path
      (`/kit/pack.zip!/x.stl`, whose `mtime` is the archive's — *A model inside an archive is
      named by its archive*), asserting the encoded virtual path and the version together;
      and a **failure with a version named** — the existing *fetchModelGlb throws on a non-2xx
      status* covers only the version-less form, so add `await expect(api.fetchModelGlb("/m.stl", 1789446597239.1736)).rejects.toThrow()`
      against a 422 (*A failed fetch surfaces the same error whatever version was named*).
- [x] 3.2 `client/test/apiClient.test.ts`: assert the version-less URLs are **byte-identical
      to today's** when the second argument is omitted (`/api/file?path=%2Fm.stl`,
      `/api/model.glb?path=%2Fm.stl`) — no trailing `&mtime=`, no `undefined` in the query.
      This is the cell that keeps D7's optional path real.
- [x] 3.3 `client/test/meshLoader.test.ts`: extend the two existing cells
      (*loads an STL through fetchModelGlb and never fetchModel*, *loads a 3MF through
      fetchModel*) to `toHaveBeenCalledWith("/kit/part.stl", 1789446597239.1736)` and the
      3MF equivalent, and add one cell asserting that a loader invoked with no version reaches
      the fetcher naming none — spelled `(path, undefined)`, since the version is forwarded
      rather than dropped and the fetcher's own builder is what decides the URL (design D7).
- [x] 3.4 `client/test/lru.test.ts`: one cell that `acquire(path, mtime)` hands the version to
      `load`, and one that pins design D4 — `acquire("a", 1)` then `acquire("a", 2)` loads
      **once** and returns the resident object, and `has("a")` is true with no version in
      hand. Use the file's existing `makeLru` fake.
- [x] 3.5 `client/test/interaction.test.ts`, *hover warmer (linger debounce)*: assert the warm
      is called with the pair (`expect(warm).toHaveBeenCalledWith("/a.stl", 1789446597239.1736)`)
      and that a warm entered with no version reaches it naming none, spelled `(path, undefined)` (design D7). The existing cells'
      `enter("/a.stl")` calls stay as they are — they are the no-version case.
- [x] 3.6 **A cell per `acquire` seam** — without one, a seam left as `acquire(entry.path)`
      compiles and stays green, because the parameter is optional and nothing else observes
      it (this is the failure mode an optional argument buys). Each asserts the spy was
      called with the pair:
      - `client/test/thumbnailCommands.test.ts` — its fake host already carries an
        `acquire` spy: `expect(h.acquire).toHaveBeenCalledWith(entry.path, entry.mtime)`
        for `renderEntryThumbnail` (2.4).
      - `client/test/orbitAxisMenu.test.tsx` or `thumbnailCommands.test.ts`, whichever
        already drives `setOrbitAxis` with a fake host — same assertion, for 2.5.
      - `client/test/viewerLayer.test.tsx` — its `lru` fake's `acquire`, for the session
        effect (2.6), asserted against `viewer.entry.mtime`.
      Use a **fractional** mtime in each, so a rounding creeping in later fails here too.
      Landed: both `entryActions` cells in `thumbnailCommands.test.ts` (`orbitAxisMenu.test.tsx`
      exercises the menu, never `setOrbitAxis` against a host), the session effect's in
      `viewerLayer.test.tsx`; all three titled *acquires the mesh under the version its entry
      reports, fraction and all*.
      The same rule applies to the **`warm` seam** (2.7), and it was the one gap left: 3.5
      covers `createHoverWarmer` alone, and with the `Grid.tsx` and `App.tsx` hops both
      reverted the whole suite stayed green. Closed by a second cell in
      `modelVersionThread.test.tsx` — *warms a hovered tile's mesh under that entry's mtime,
      fraction and all* — which drives the hover through the mounted app, tile to fetcher.
- [x] 3.7 One app-mount cell (`client/test/thumbnailQueue.test.tsx` or a new file beside it,
      whichever reads better against `appHarness`) proving the version survives the whole
      thread in the mounted app through `useThumbnails`' render job (2.3): a listing whose
      entry carries a fractional mtime, and the harness's `fetchModelGlb` mock asserted to
      have received that exact number. Read `client/test/CLAUDE.md` first — import
      `./appHarness` before any `../src/...` module, and call `resetLookupQueueForTests()`
      in `beforeEach` if the file mounts App.
      Landed as `client/test/modelVersionThread.test.tsx`: `thumbnailQueue.test.tsx` drives the
      hook against a loader-less `fakeLru`, so the two hops this cell is about — the real
      `MeshLru` and `meshLoader` — are exactly what it does not have.
- [x] 3.8 **Falsify every new cell, 3.1 through 3.7, with no exceptions.** For 3.1/3.3/3.5
      and each of 3.6's three, drop the argument at the seam that cell covers and confirm it
      fails; for 3.2, append `&mtime=undefined` unconditionally and confirm it fails; for
      3.4, key the LRU by `path + mtime` and confirm the second cell fails; for 3.7, drop
      `entry.mtime` from `useThumbnails`' `lru.acquire` and confirm it goes red. Restore
      each mutation verbatim afterwards, and record in this line which cells were falsified
      — a cell green under its own mutation is testing something else, and a seam with no
      cell of its own is why 3.6 exists.
      Done, one live mutation at a time against a `/tmp` copy of `client/src`, each restored
      and re-run green before the next; `git diff client/src | sha256sum` is the same before
      and after, and the suite is back at 81 files / 1101 passed / 15 skipped. Every cell
      3.1–3.7 is load-bearing. What went red:
      - **3.1** — URL builders stripped of the append: *fetchModel and fetchModelGlb name the
        version they are given*, *names an archive entry's version on its virtual path*.
        *fetchModelGlb throws on a non-2xx status with a version named* stayed green, and
        correctly: that cell's claim is that failure handling is version-**in**dependent, so
        no URL mutation can reach it. Falsified instead by dropping
        `if (!res.ok) throw await errorOf(res)` from `fetchModelGlb`, which reddens it and its
        version-less sibling — it asserts, just not about the URL.
      - **3.2** — `&mtime=${mtime}` appended unconditionally: *omits the version entirely when
        none is given*, and the pre-existing *fetchModelGlb requests /api/model.glb and returns
        its bytes*.
      - **3.3** — `meshLoader` calling the fetchers with the path alone: all three cells,
        including *loads with no version, naming none to the fetcher* — the `(path, undefined)`
        spelling is an arity assertion, so dropping the forward reddens it too.
      - **3.4** — `acquire` keyed `` `${path}@${mtime}` ``: *keys by path alone — a second version
        reuses the resident mesh*, plus the two pre-existing eviction cells. The other 3.4 cell
        is about the forward, not the key, so it was falsified separately by `this.load(path)`.
      - **3.5** — `warm(path)` in `createHoverWarmer`: *carries the version across the linger to
        the warm* and the amended *fires only after the linger threshold*.
      - **3.6** — one seam at a time: `deps.lru.acquire(entry.path)` reddens the
        `renderEntryThumbnail` cell, `host.lru.acquire(entry.path)` the `setOrbitAxis` one
        (each alone, the other staying green — the two cells are independent), and
        `lru.acquire(viewer.entry.path)` the `viewerLayer.test.tsx` session cell. This is the
        line's own claim confirmed: nothing else in those suites notices.
      - **3.7** — `lru.acquire(entry.path)` in `useThumbnails`' load effect: *fetches a tile's
        mesh under that entry's mtime, fraction and all*.
      - **The hover seam (2.7)**, added after review, falsified the same way and one hop at a
        time against `modelVersionThread.test.tsx`'s *warms a hovered tile's mesh under that
        entry's mtime, fraction and all*. All three hops redden it **separately**: the tile's
        `onPointerEnter={() => onModelHover(entry.path)}`, App's
        `createHoverWarmer((p) => lru.warm(p))`, and App's `onModelHover` forwarder narrowed
        back to `(p: string | null) => …`. Each fails as `[path, undefined]` against
        `[path, 1789446597239.1736]`; `git diff client/src | sha256sum` is the same before and
        after the three. What the cell does **not** catch is the linger itself — a warmer that
        fired immediately would still pass it, which is 3.5's cell, not this one.

## 4. Verification

- [x] 4.1 `cd client && bunx vitest run` — from the workspace directory, never the repo root.
      Run the server suite too (`cd server && bunx vitest run`): this change edits nothing
      there, so a red cell means someone else's work in flight, not this.
      **Done 2026-09-18.** `cd client && bunx vitest run` → 81 files, 1101 passed, 15 skipped.
      `cd server && bunx vitest run` → 30 files, 920 passed.
- [x] 4.2 `bun run typecheck` across workspaces (this is what proves 2.8; 1.5 is a reading,
      for the reason that line gives), then `bun run format`.
      **Done.** `bun run --filter '*' typecheck` → server and client both exit 0 (which is
      what proves 2.8). `bun run format` then `format:check` → clean.
- [x] 4.3 Browser verification against a live `bun run dev` on **5173** (3177 serves
      `client/dist` if that directory exists — `rm -rf client/dist` first if it does).
      With the network panel recording **and its "Disable cache" box unticked** — the panel's
      common state when opened turns every cache hit into a miss and makes (c) read as a
      regression; `browser_network_requests` leaves the cache on and is the safer instrument:
      open a kit, press a model tile, and confirm
      (a) the `/api/model.glb` request carries `&mtime=` with the fraction the listing
      reported for that entry, (b) its response is
      `cache-control: public, max-age=31536000, immutable` with an `etag`, (c) re-opening
      the same model after a reload is served from the browser's cache with no request to
      the server, and (d) an `obj` or `3mf` model's `/api/file` request carries the same
      parameter. Measure through the network panel or `browser_network_requests`, not a
      screenshot.
      **Done 2026-09-18**, Chromium over a scratch library, against a server running this
      worktree's code with the client built fresh (a private port rather than 5173, so the
      other session's dev instance was left alone; `client/dist` removed afterwards).
      Measured through `performance.getEntriesByType('resource')`, not a screenshot.
      (a) The listing reported `mtime: 1789768639915.448` and the app requested
      `/api/model.glb?path=/KitA/model.stl&mtime=1789768639915.448` — the fraction intact.
      (b) That URL answered `cache-control: public, max-age=31536000, immutable` with
      `etag: "1789768639915.448-2500084"`.
      (c) After a reload, pressing the same model reported `transferSize: 0` against an
      `encodedBodySize` of 593,140 — served wholly from the browser's cache, no request to
      the server. (Before the client half, the same reload cost a 304: 300 bytes.)
      (d) An `obj` went out as `/api/file?path=/KitB/cube.obj&mtime=1789768930913.1116`.
- [x] 4.4 Browser verification of the hover seam (design D6). Hover a model tile past the
      linger without pressing and read the warm's own request: it must carry **the same
      `&mtime=` the listing reported for that entry** — that URL is what 2.7 changes, and it
      is the only part of this a single session can observe. Do **not** rest on "press it and
      see no second request": the press is served from the resident/in-flight `MeshLru`
      entry, which is keyed by path, so there is no second fetch whatever URL the warm used —
      that check passes with the hover widening reverted. The claim D6 actually makes is
      about a **cold** reader: hover the tile, reload the page (LRU gone, browser cache
      kept), press the same tile, and confirm the bytes come from the browser's cache rather
      than the network — again with the panel's cache **enabled**, or measured through
      `browser_network_requests`, or the observation is worthless. If the warm had named no version, the press's versioned URL would be
      a different entry and would be fetched again.
      **Done.** With the thumbnail already cached server-side, nothing fetched the mesh on
      load — zero `/api/model.glb` entries. A hover past the linger, *with no press*
      (`location.href` carried no `model=`), then produced exactly one:
      `/api/model.glb?path=/KitA/model.stl&mtime=1789768639915.448` — the warm names the
      same version the press uses, which is the claim. It reported `transferSize: 0`, so the
      cold-reader half holds too: the warm was answered by the pin the earlier session
      earned, which is only possible because both name one URL.
- [x] 4.5 **Pin the dependency this change rests on** (design D8). Against the running
      server, request a model naming a version it does not have —
      `curl -i '127.0.0.1:3177/api/model.glb?path=<a model>&mtime=1'` — and confirm the
      answer carries the current bytes, `cache-control: no-cache` **and an `etag`**; then
      repeat it with `-H 'if-none-match: <that tag>'` and confirm **304** with no body.
      Do the same for `/api/file` with an `obj` or `3mf`. A missing tag here is not a
      cosmetic difference: it is `byte-route-cache-headers`' stale-tier validator gone, and
      with it this change's guarantee that it can never leave a request costlier than it
      found it — the #34 path would silently become a full download per visit. Record the
      two header blocks in this line so a later reader can tell a regression from a memory,
      and re-run this check if the mesh routes are touched again.
      **Done.** `/api/model.glb?path=/KitA/model.stl&mtime=1` → `200`,
      `Cache-Control: no-cache`, `ETag: "1789768639915.448-2500084"`; the same request with
      `if-none-match` of that tag → `304 Not Modified`, `Cache-Control: no-cache`, no body.
      `/api/file?path=/KitB/cube.obj&mtime=1` → `200`, `no-cache`,
      `ETag: "1789768930913.1116-124"`; with the tag → `304`. The dependency holds on both
      routes.
- [x] 4.6 Confirm the desktop posture is unchanged (design D10): the same requests and the
      same declarations with no proxy in front, which 4.3–4.5 already exercise — this line
      is the reminder that nothing may be conditional on a deployment, so grep the diff for
      any `features`, posture or origin check before checking it off.
      **Confirmed.** The diff is nine `client/src` files, six `client/test` files and the
      change directory — no configuration, no `DEFAULT_FEATURES`, nothing in
      `deploy/demo/config.json`. Grepped the diff for `features`, posture and origin checks:
      none. Every observation above came from a loopback server with nothing in front of it.
- [x] 4.7 **Watch the accepted regression once** (design D8; the delta's *A pin earned under
      a version is served while the listing still names that version* and *A superseded mesh
      made resident is what the session draws and persists*). Against a scratch library:
      open a flat or search view containing a model, press it so the bytes are fetched and
      pinned, then **rewrite that file in place** with visibly different geometry (same name,
      same directory — an add or a rename moves the directory's mtime and heals the listing,
      which is not the case under test). Reload, open the same flat or search view, press the
      model again, and record what happened: the expected observation is **no network request
      for those bytes** (the browser answers from the pin — cache enabled in the panel, or
      `browser_network_requests`) and the **old** geometry on screen, while the model's own
      folder view, which walks, shows the new geometry. Then, in that same session, walk into
      the folder and let its tile render, and check whether the stored thumbnail it writes is
      of the old shape under the new version. Write what was actually seen into this line —
      including any step that did *not* reproduce. This is the one behaviour of this change
      that was accepted rather than prevented, and it should be watched once rather than only
      argued.

      **Watched 2026-09-18, and both halves reproduced.** Scratch library at
      `/tmp/mb-scratch-lib`, `KitA/model.stl` pinned by a press, then overwritten in place
      with different geometry (`cp` over it — same name, same directory, so the directory's
      own mtime never moved).
      *The stale listing.* The app's own spelling, `/api/dir?path=/KitA&flat=true`, kept
      reporting `mtime: 1789768639915.448` while the file on disk had moved to
      `1789768984786.683`. The folder listing (`/api/dir?path=/KitA`) reported the new value
      immediately. That is #34, and it is what keeps the client naming the old version.
      (Worth knowing for a re-run: `flat=on` is a *different* cache key and answers fresh —
      probing with a hand-written query can hide the very staleness under test.)
      *The pin.* After a full page reload, pressing the model from the flat view requested
      `&mtime=1789768639915.448` and reported `transferSize: 0` with a 593,140-byte body:
      the superseded geometry, drawn with no contact with the server. Fetching the two URLs
      side by side made the difference explicit — the old version answered 593,140 bytes
      (sha256 `cb063266…`) from cache, the new one 600,428 bytes (sha256 `de0a0f89…`) over
      the network. Different bytes, different geometry, one path.
      *The persisted-render inversion.* Walking into the folder view in that same session:
      its listing named the new version, `/api/thumb?…&mtime=1789768984786.683` missed, the
      render job acquired the path — and **no new `/api/model.glb` request was made**, so it
      drew the resident *old* mesh and `PUT` it. The sidecar on disk now reads
      `{"path":"/KitA/model.stl","gen":1789769014521,"noao":{"mtime":1789768984786.683,…}}`:
      a render of the superseded geometry, labelled with the current version, which
      `/api/thumb` will serve as a hit. Exactly what the delta's *A superseded mesh made
      resident is what the session draws and persists* describes.
      No step failed to reproduce.