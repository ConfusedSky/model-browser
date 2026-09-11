## 1. The index becoming ready reaches a landed listing (D1, D2)

- [ ] 1.1 `App.tsx`: `indexReady` (`state.index?.state === 'ready'`) as a dependency of the
      listing-wave effect and of the preview wave; `askedPreviewPoses` cleared on the ready
      edge. The availability read gains a 10 s timer while the index reports `absent`,
      beside the 2 s timer while `warming`; nothing while ready. Comments say why on both
      (the live sequence: index off at landing, on 20 s later, no re-ask through 80 s)
- [ ] 1.2 Cells (`client/test/poseRerender.test.tsx`, the investigating worker's file): the
      two failing (i) cells go green — warming→ready under a landed listing asks once and
      re-renders the un-posed tile; absent→ready through the 10 s timer (fake timers) is
      noticed and asks once; a same-state re-read asks nothing and renders nothing; the
      away-and-back control stays green; `poseWave.test.tsx` and `thumbnailQueue.test.tsx`
      byte-unchanged. Falsify: drop `indexReady` from the deps → the first cell fails; drop
      the absent timer → the second fails

## 2. A posed render records the pose it was drawn under (D3)

- [ ] 2.1 `shared/types.ts`: `poseKey?: string` on `ThumbSave`, `ThumbRenderInfo`,
      `ThumbResult`, documented as D3 says (what the pixels depended on; compared only when
      present). `client/src/three/pose.ts`: `poseKeyOf(resolved)` →
      `${axis}:${az.toFixed(4)}:${el.toFixed(4)}`
- [ ] 2.2 `server/src/cache.ts`: `RenderLabels.poseKey`, carried by `renderLabels`,
      `hasLabels`, `renderInfo`, `put`'s label carry-over (cleared with the other labels
      when pixels are replaced undeclared), and the sibling-invalidation compare; `app.ts`
      PUT passthrough. Cells (server): stored and echoed on hit and stale reads; cleared
      when pixels are replaced without it; a sibling whose key differs is invalidated
- [ ] 2.3 `useThumbnails.ts`: `usable`'s `poseStale` adds `labels.poseKey !== undefined &&
      labels.poseKey !== poseKeyOf(pose)`; the posed render's PUT sends `poseKey`. Cells:
      the failing (ii) cell goes green (pose A → pose B re-renders and records B's key); a
      sidecar with the current `posed` and no key under an unchanged pose is a hit;
      `thumbnailQueue`'s "changed by value … keeping its image" cell stays green. Falsify:
      compare the key when absent → that cell fails; drop the compare → the (ii) cell fails

## 3. Land it

- [ ] 3.1 `bun run typecheck` and both suites green on merged main
- [ ] 3.2 Live, read-only where possible: with the dev instance up, stop the index, load
      the root, start the index, and watch — within 10 s the client reads it ready, one
      poses POST fires, and un-posed tiles re-render (a `blob:` image and a PUT with
      `posed` and `poseKey`); record the timings here
- [ ] 3.3 `openspec validate pose-rerender --strict`; archive dry run on a fresh copy
