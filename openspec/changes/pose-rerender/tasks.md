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

- [x] 2.4 *(reverted 2026-09-11 — the key's absence is stale, so the version stays 2)*

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
