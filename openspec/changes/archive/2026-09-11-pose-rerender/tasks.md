## 1. The index becoming ready — rejected

- [x] 1.1 *(rejected 2026-09-11 — Masa: no polling for the index; a navigation is the
      trigger, and his tiles had not updated even on a navigation, so this was not the
      bug. The worker's readiness/timer commit (30bfbda in its worktree) was left off
      main; `poseRerender.test.tsx` keeps the three not-a-hole cells and the navigation
      control, nothing about readiness)*

## 2. A posed render records the pose it was drawn under (D2)

- [x] 2.1 `shared/types.ts`: `poseKey?: string` on `ThumbSave`, `ThumbRenderInfo`,
      `ThumbResult`, documented as D2 says (what the pixels depended on).
      `client/src/three/pose.ts`: `poseKeyOf(resolved)` → `${axis}:${az.toFixed(4)}:${el.toFixed(4)}`
      — the wire types in `shared/types.ts` are `ThumbRenderInfo`, `ThumbGetResponse` and
      `ThumbPutRequest`; `ThumbSave` and `ThumbResult` are the client's own in
      `client/src/api/client.ts`, so all five carry it, and `HttpApiClient` maps it on
      GET, sends it on PUT, and `withoutUnusableRender` strips it with the other pixel
      labels
      *(Corrected 2026-09-11 after the whole-work review: three of the five sites'
      comments — `ThumbRenderInfo.poseKey`, `ThumbPutRequest.poseKey`, `ThumbResult.poseKey`
      — still said "compared only when present", the rule Masa rejected; rewritten to the
      shipped rule in the record commit that follows b612de0)*
- [x] 2.2 `server/src/cache.ts`: `RenderLabels.poseKey`, carried by `renderLabels`,
      `hasLabels`, `renderInfo`, `put`'s label carry-over (cleared with the other labels
      when pixels are replaced undeclared), and the sibling-invalidation compare; `app.ts`
      PUT passthrough. Cells (server): stored and echoed on hit and stale reads; cleared
      when pixels are replaced without it; a sibling whose key differs is invalidated
      — `app.ts` also refuses a non-string `poseKey` (400, the `rig` shape). Two
      `cache.test.ts` cells: the round-trip (kept across a no-move camera put, echoed on
      both stale branches, cleared by an unlabelled png put — a camera that *moves*
      clears it with the rest, the rig's rule) and the sibling compare (same key stands,
      a different key invalidates, an unposed pair is untouched as before)
- [x] 2.3 `useThumbnails.ts`: `usable`'s `poseStale` adds `labels.poseKey !==
      poseKeyFor(pose)` — compared always, so a posed render with no key is stale like
      one missing its rig label (Masa, 2026-09-11); the posed render's PUT sends `poseKey`.
      Cells: the failing (ii) cell goes green (pose A → pose B re-renders and records B's
      key); a sidecar with the current `posed` and no key is re-rendered once and gains
      its key, then is a hit; `thumbnailQueue`'s two by-value cells stay green with their
      posed fixtures carrying the key. Falsify: compare only when present → the once-cell
      fails; drop the compare → the (ii) cell fails
      — `poseKeyFor(pose)` wraps `cameraForPose` (a pose that resolves to nothing has no
      key). `entryActions.ts` is the second posed writer (re-render / reset framing):
      its PUT sends the key and its `isCurrentRender` labels carry it, or the hole stayed
      open by that road. `client/test/poseKey.test.tsx`, 4 cells. Falsified 2026-09-11
      (second pass, after the rule change): restoring compare-when-present fails the
      once-cell and `renderCurrent`'s keyless assertion (`expected "spy" to be called 1
      times, but got 0 times`; `expected true to be false`); dropping the compare fails
      the A→B cell and the once-cell alike. Fixtures that meant "already drawn at this
      pose" gained the key: `thumbnailQueue` (three posed cells), `poseWave` (`fresh`),
      `semanticSearch` (the toggle cell), `renderCurrent`, `bulkJobs` (`current`),
      `orbitAxisMenu` (the ignored-pose cell); `thumbnailCommands`' fake cache stores and
      echoes `poseKey` like the server

- [x] 2.4 *(reverted 2026-09-11 — the key's absence is stale, so the version stays 2:
      554bf6a bumped it to 3, 7e182a1 reverted that)*

## 3. Land it

- [x] 3.0 Records: CLAUDE.md's thumbnail-cache bullet lists `poseKey` beside `posed` and
      says what it is *(2026-09-11, in the record commit after b612de0)*

- [x] 3.1 `bun run typecheck` and both suites green on merged main
      *(2026-09-11 on 7e182a1: both typechecks exit 0; client 67 files / 952; server 23 files /
      737 — the index server was up, so `indexContract` ran)*
- [x] 3.2 Live, read-only: with the dev instance up and the index ready, load the root
      and watch the posed tiles — each keyless `posed: 2` sidecar re-renders once (a `blob:`
      image, then a PUT carrying `posed: 2` and a `poseKey`), a second load is all hits;
      record a before/after sidecar here
      *(2026-09-11, coordinator, headless against the dev instance with the index ready. The
      root had already been swept by Masa's live tab (19 keyed posed renders; 75 keyless
      left in other folders), so the sequence was driven in `/Nautilus_Gears/files`:
      `connector_bar_v2.STL`'s AO-off render read `{hit, posed: 2, rig: 7}` with no key;
      first load → the tile went to a `blob:` image at 3.8 s (re-rendered locally) and the
      sidecar then read `{hit, posed: 2, poseKey: "z:6.2832:0.3491"}`; second load → the
      tile was served as `/api/thumb` (a hit), nothing rendered. The remaining keyless
      renders sweep the same way, one folder per visit)*
- [x] 3.3 `openspec validate pose-rerender --strict`; archive dry run on a fresh copy
      *(re-run as 5.3 after §4 — done there)*

## 4. The untouched close and the settled absence (D4–D6, 2026-09-11)

- [x] 4.1 `viewer/ViewerLayer.tsx` `closeLightbox`: settle and persist only when
      `s.everManipulated`; otherwise dismiss and write nothing. `openedFromPoseRef` and
      `framingDiscardedRef` lose their readers in the close (keep `framingDiscardedRef`
      only if something else reads it — check). `App.tsx` `persist` loses its `posed`
      option (D6): it writes a camera with the pixels, or is not called. Cells
      (`viewerPanelActions` / `persistPut` neighbourhood, or a new `lightboxClose.test.tsx`):
      open → Escape with no manipulation → zero PUTs, thumb state unchanged, for each of
      the three openings (stored camera, pose in hand, nothing in hand); open → orbit →
      Escape → one PUT carrying the camera (unchanged behaviour, the control); open from a
      pose → Escape → zero PUTs (was: pixels with `posed` and no key). Falsify: restore
      `decided = everManipulated || !unowned` → the nothing-in-hand cell fails
      *(2026-09-11, fable worker 8bf83fe + 30aff15, opus-reviewed: `closeLightbox` persists only when `everManipulated`; `openedFromPoseRef`/`framingDiscardedRef` deleted; `persist(session)` lost both options. `lightboxClose.test.tsx` 4 cells; `urlLightbox`'s four cells orbit first and assert the camera write after the close (they passed with the persist stubbed out before that). Falsified: close always persists → `expected "spy" to not be called at all, but actually been called 1 times`; persist stubbed → urlLightbox `4 failed`, `expected 0 to be greater than 0`)*
- [x] 4.2 The wire: `PosesResponse.poses` becomes `Record<string, IndexPose | null>`
      (`shared/types.ts`, documented: `null` is a settled absence). Server
      `POST /api/semantic/poses`: every asked path the index did not name is `null` when
      `posesListingAsked` reports `answered`, or when `memoisedStatus()` says `absent`,
      `wedged` or `volume-gone`; omitted (unsettled) when warming or the status is
      unknown. `layers.recordPoses` keeps receiving the positive map. Cells
      (`server/test/poses.test.ts`): ready index, two paths asked, one posed → the other
      is `null`; index absent (fetch refused) → both `null`; index warming (503 status)
      → both omitted; the GET route unchanged. Falsify: drop the absent branch → the
      absent cell fails
      *(2026-09-11: `PosesResponse.poses: Record<string, IndexPose | null>`; the POST route files `null` for every canonical path not named when `answered` or the memo is absent/wedged/volume-gone, omits on warming or a cold memo — memo read once per request; `POSES_MAX` is both the route bound and the chunk size so one request is one chunk. Unresolvable-but-canonical paths `null`, unspellable omitted, both asserted. Five cells in `poses.test.ts`. Falsified: absent branch dropped → `expected {} to deeply equal { '/mixed/c.stl': null, …(1) }`)*
- [x] 4.3 Client map: `App.tsx` `carriedPoses` files `null` (it currently skips `== null`
      — the comment there says why it skipped; rewrite it); the wave effect files every
      answer, empty included, and `poseWave.test.tsx`'s "does not file an empty answer at
      all" cell is rewritten as semantics-is-the-point (an all-`null` answer is filed;
      a wave that fails still says nothing); `state/reducer.ts` and the `poses` memo
      chain carry `IndexPose | null`; `cameraForPose`, `poseKeyFor`, `resettable`, the
      viewer's `pose` prop and `bulkJobs`' `pose: entry.pose ?? wave[path]` accept
      `null` (check each `??` — `null ?? x` is `x`, which for the bulk generate path
      means a settled `null` on the entry falls to the wave's `null`: fine, but say so).
      `wavePaths`' `=== undefined` filter unchanged
      *(2026-09-11: `carriedPoses` skips only `undefined`; the listing wave files every answer (the empty-answer guard is gone, `poseWave`'s cell rewritten); the preview wave keeps its guard and files nulls when carried (`folderSheets` cell); `samePose` `a == null || b == null → a === b`; `bulkJobs` `entry.pose !== undefined ? entry.pose : wave[path]`; `cameraForPose`/`poseKeyFor`/`framingAfterDiscard`/viewer prop accept `null`. Falsified: guard restored → `expected [ 'restore', 'index', 'landing' ] to include 'listingPoses'`; `== null` skip → `expected undefined to be null`; bulk `??` → `expected [] to deeply equal [ '/kit/settled-none.stl' ]`)*
- [x] 4.4 `useThumbnails.ts` `usable`: `pose === null` and `camera === undefined` and
      `axis === undefined` and (`labels.posed !== undefined` or `labels.poseKey !==
      undefined`) → stale; `pose === undefined` → the render stands (as today). The
      re-render site writes no `posed` and no `poseKey` when `cameraForPose` answers
      nothing (already the case — assert it). Cells (`poseRerender.test.tsx` or
      `poseKey.test.tsx`): posed hit + wave answers `null` → one render, PUT without
      `posed`/`poseKey`, then a hit; posed hit + no wave answer (undefined) → hit, zero
      renders; unlabelled hit + `null` → hit; the default render + pose arrives later →
      re-rendered posed (the existing mechanism, as the control). Falsify: drop the
      `null` branch → the first cell fails; treat `undefined` as `null` → the second fails
      *(2026-09-11: `usable` — `null` over `posed`/`poseKey` is stale, `undefined` stands; the settled-none render writes no `posed`/`poseKey`, asserted. `poseKey.test.tsx` gained five cells incl. the carried-road one (a listing `pose: null` over a posed render). Falsified: null branch dropped → `expected "spy" to be called 1 times, but got 0 times`; undefined-as-null → `expected "spy" to not be called at all, but actually been called 1 times`)*
- [x] 4.6 The reset gives up the axis (D7): `framingAfterDiscard` returns the pose's
      camera and axis where usable, else `DEFAULT_CAMERA` about `defaultAxisFor(format)`
      — its `keptAxis` parameter goes; `resettable(camera, axis)` is `camera !== undefined
      || axis !== undefined` (the `pose` parameter goes, and every caller with it);
      `renderEntryThumbnail`'s discard branch, `resetFramingLive`'s discard PUT and
      `bulkJobs`' reset PUT send `axis: null` unconditionally; the bulk reset's wave no
      longer needs poses for `reset` (`needsPose` for reset becomes false — the count and
      the derivation read the wire's `framed`); the hand delta (`noteFramingChanged`)
      follows `resettable`'s new arity. Cells: a model with axis only and no pose is
      counted and reset (was: neither); reset with no pose in hand → PUT `camera: null,
      axis: null`, the tile re-renders about the file's default axis; reset with a pose
      → as before; the lightbox panel reset re-frames to the default axis when no pose.
      Existing cells whose subject was "the axis stays" are rewritten
      (semantics-is-the-point) — `entryActions`/`viewerPanelActions`/`bulkJobs` cells
      named "With nothing to replace it, the axis stays" or asserting a kept axis.
      Falsify: restore `axis: dropAxis ? null : undefined` → the no-pose reset cell fails;
      restore the pose gate in `resettable` → the axis-only count cell fails
      *(2026-09-11: `resettable(camera, axis)`; `framingAfterDiscard(pose, format)`; every discard sends `axis: null`; bulk `needsPose` true only for generate; the panel reset is an immediate png-less discard plus a queued re-render pinned by `pinToLookup` (ifGen = the gen it read; a refused pin is `skipped`) — the unpinned shape lost an orbit made before the render landed. Falsified: `axis: framing.posed ? null : undefined` restored → `expected undefined to be null`; pose gate in `resettable` → `expected [ Array(2) ] to deeply equal [ '/kit/framed.stl', …(3) ]`; pin dropped → `expected undefined to be 4`)*
- [x] 4.5 Records: `client/src/three/pose.ts`'s `POSE_VERSION` history comment gains the
      settled-absence sentence; `useThumbnails`' `usable` doc says the three pose states;
      CLAUDE.md's cache bullet unchanged (no new label)
      *(2026-09-11: `POSE_VERSION` comment and `usable`'s doc updated in 8bf83fe; CLAUDE.md's cache bullet unchanged)*
## 5. Land §4

- [x] 5.1 `bun run typecheck` and both suites green on merged main
      *(2026-09-11 on 30aff15, merged main: client 68 files / 964 passed; server 23 files / 742 passed; `bun run typecheck` both Done, exit 0; the index was up so `indexContract` ran)*
- [x] 5.2 Live, read-only apart from what the app itself writes: with the dev instance up
      and the index **stopped by Masa** (never by a worker or this session), load the root
      → posed tiles re-render at the default once (PUTs without `posed`), a second load is
      hits; open a model and close untouched → no PUT; with the index back (Masa) and a
      navigation → the tiles re-render posed. Record the sidecar before/after here
      *(2026-09-11, Masa, live on 2a5ec10: the seven-step sequence — index off, server
      restarted, three lightboxes opened and closed untouched, framings reset, index on,
      server restarted, app reloaded — and "the framings stayed reset". The coordinator's
      watcher had captured the pre-fix sequence at 18:14:59–18:15:04 (three closes writing
      camera + axis z, then the reset keeping the axis); the post-fix run left nothing
      stored and nothing counted)*
- [x] 5.3 `openspec validate pose-rerender --strict`; archive dry run on a fresh copy;
      collision check against `credits-completion` and `adaptive-ao-default`'s
      `model-viewer` deltas (different requirements — verified 2026-09-11 at drafting)
      *(2026-09-11 after the cold review's fixes: valid under --strict; the dry run applies
      four MODIFIED blocks (~4) and `unjudged-framing-recount` archives after it on the same
      fresh copy; the reviewer ran the six pairings with the other active changes in both
      orders, all clean; the applied text carries no change-scoped prose and no comments)*
