## 1. The index becoming ready — rejected

- [x] 1.1 *(rejected 2026-09-11 — Masa: no polling for the index; a navigation is the
      trigger, and his tiles had not updated even on a navigation, so this was not the
      bug. The worker's readiness/timer commit (30bfbda in its worktree) was left off
      main; `poseRerender.test.tsx` keeps the three not-a-hole cells and the navigation
      control, nothing about readiness)*

## 2. A posed render records the pose it was drawn under (D3)

- [x] 2.1 `shared/types.ts`: `poseKey?: string` on `ThumbSave`, `ThumbRenderInfo`,
      `ThumbResult`, documented as D3 says (what the pixels depended on; compared only when
      present). `client/src/three/pose.ts`: `poseKeyOf(resolved)` →
      `${axis}:${az.toFixed(4)}:${el.toFixed(4)}`
      — the wire types in `shared/types.ts` are `ThumbRenderInfo`, `ThumbGetResponse` and
      `ThumbPutRequest`; `ThumbSave` and `ThumbResult` are the client's own in
      `client/src/api/client.ts`, so all five carry it, and `HttpApiClient` maps it on
      GET, sends it on PUT, and `withoutUnusableRender` strips it with the other pixel
      labels
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
- [x] 2.3 `useThumbnails.ts`: `usable`'s `poseStale` adds `labels.poseKey !== undefined &&
      labels.poseKey !== poseKeyOf(pose)`; the posed render's PUT sends `poseKey`. Cells:
      the failing (ii) cell goes green (pose A → pose B re-renders and records B's key); a
      sidecar with the current `posed` and no key under an unchanged pose is a hit;
      `thumbnailQueue`'s "changed by value … keeping its image" cell stays green. Falsify:
      compare the key when absent → that cell fails; drop the compare → the (ii) cell fails
      — `poseKeyFor(pose)` wraps `cameraForPose` (a pose that resolves to nothing has no
      key). `entryActions.ts` is the second posed writer (re-render / reset framing):
      its PUT sends the key and its `isCurrentRender` labels carry it, or the hole stayed
      open by that road. `client/test/poseKey.test.tsx`, 4 cells. Falsified 2026-09-11:
      comparing when absent fails the pre-key cell and `thumbnailQueue`'s two by-value
      cells; dropping the compare fails the A→B cell (`expected "spy" to be called 1
      times, but got 0 times`)

- [x] 2.4 `POSE_VERSION` 2 → 3 (D3), with the version's history in its comment: the
      keyless posed renders re-render once on their next visit and gain a key
      *(2026-09-11: client 952/952 after the bump — no fixture hard-codes the client's
      version; the server's `posed: 2` fixtures are opaque labels it never interprets)*

## 3. Land it

- [ ] 3.1 `bun run typecheck` and both suites green on merged main
- [ ] 3.2 Live, read-only: with the dev instance up and the index ready, load the root
      and watch the posed tiles — each `posed: 2` sidecar re-renders once (a `blob:` image,
      then a PUT carrying `posed: 3` and a `poseKey`), a second load is all hits; record a
      before/after sidecar here
- [ ] 3.3 `openspec validate pose-rerender --strict`; archive dry run on a fresh copy
