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
      shipped rule in the record commit that follows a61a484)*
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
      b4f8ab3 bumped it to 3, c583695 reverted that)*

## 3. Land it

- [x] 3.0 Records: CLAUDE.md's thumbnail-cache bullet lists `poseKey` beside `posed` and
      says what it is *(2026-09-11, in the record commit after a61a484)*

- [x] 3.1 `bun run typecheck` and both suites green on merged main
      *(2026-09-11 on c583695: both typechecks exit 0; client 67 files / 952; server 23 files /
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
- [ ] 3.3 `openspec validate pose-rerender --strict`; archive dry run on a fresh copy
      *(re-run as 5.3 after §4)*

## 4. The untouched close and the settled absence (D4–D6, 2026-09-11)

- [ ] 4.1 `viewer/ViewerLayer.tsx` `closeLightbox`: settle and persist only when
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
- [ ] 4.2 The wire: `PosesResponse.poses` becomes `Record<string, IndexPose | null>`
      (`shared/types.ts`, documented: `null` is a settled absence). Server
      `POST /api/semantic/poses`: every asked path the index did not name is `null` when
      `posesListingAsked` reports `answered`, or when `memoisedStatus()` says `absent`,
      `wedged` or `volume-gone`; omitted (unsettled) when warming or the status is
      unknown. `layers.recordPoses` keeps receiving the positive map. Cells
      (`server/test/poses.test.ts`): ready index, two paths asked, one posed → the other
      is `null`; index absent (fetch refused) → both `null`; index warming (503 status)
      → both omitted; the GET route unchanged. Falsify: drop the absent branch → the
      absent cell fails
- [ ] 4.3 Client map: `App.tsx` `carriedPoses` files `null` (it currently skips `== null`
      — the comment there says why it skipped; rewrite it); the wave effect files every
      answer, empty included, and `poseWave.test.tsx`'s "does not file an empty answer at
      all" cell is rewritten as semantics-is-the-point (an all-`null` answer is filed;
      a wave that fails still says nothing); `state/reducer.ts` and the `poses` memo
      chain carry `IndexPose | null`; `cameraForPose`, `poseKeyFor`, `resettable`, the
      viewer's `pose` prop and `bulkJobs`' `pose: entry.pose ?? wave[path]` accept
      `null` (check each `??` — `null ?? x` is `x`, which for the bulk generate path
      means a settled `null` on the entry falls to the wave's `null`: fine, but say so).
      `wavePaths`' `=== undefined` filter unchanged
- [ ] 4.4 `useThumbnails.ts` `usable`: `pose === null` and `camera === undefined` and
      `axis === undefined` and (`labels.posed !== undefined` or `labels.poseKey !==
      undefined`) → stale; `pose === undefined` → the render stands (as today). The
      re-render site writes no `posed` and no `poseKey` when `cameraForPose` answers
      nothing (already the case — assert it). Cells (`poseRerender.test.tsx` or
      `poseKey.test.tsx`): posed hit + wave answers `null` → one render, PUT without
      `posed`/`poseKey`, then a hit; posed hit + no wave answer (undefined) → hit, zero
      renders; unlabelled hit + `null` → hit; the default render + pose arrives later →
      re-rendered posed (the existing mechanism, as the control). Falsify: drop the
      `null` branch → the first cell fails; treat `undefined` as `null` → the second fails
- [ ] 4.5 Records: `client/src/three/pose.ts`'s `POSE_VERSION` history comment gains the
      settled-absence sentence; `useThumbnails`' `usable` doc says the three pose states;
      CLAUDE.md's cache bullet unchanged (no new label)

## 5. Land §4

- [ ] 5.1 `bun run typecheck` and both suites green on merged main
- [ ] 5.2 Live, read-only apart from what the app itself writes: with the dev instance up
      and the index **stopped by Masa** (never by a worker or this session), load the root
      → posed tiles re-render at the default once (PUTs without `posed`), a second load is
      hits; open a model and close untouched → no PUT; with the index back (Masa) and a
      navigation → the tiles re-render posed. Record the sidecar before/after here
- [ ] 5.3 `openspec validate pose-rerender --strict`; archive dry run on a fresh copy;
      collision check against `credits-completion` and `adaptive-ao-default`'s
      `model-viewer` deltas (different requirements — verified 2026-09-11 at drafting)
