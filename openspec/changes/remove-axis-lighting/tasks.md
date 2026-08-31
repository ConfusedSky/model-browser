# Tasks — remove-axis-lighting

> Ordering (hard): apply and archive **after `library-root`** (the `url-navigation` delta
> here is written against its text — re-derive if that text changed), **before
> `ao-refreshes-thumbnails` (formerly `lighting-refreshes-thumbnails`)** is updated or applied (its `model-thumbnails` delta
> targets the title this change renames; it is re-targeted to the AO toggle on top of
> this), and **before `ao-as-recipe-dimension`**. Re-read `session.ts`, `renderer.ts`,
> `useThumbnails.ts`, `entryActions.ts`, `App.tsx` against main before starting — other
> sessions edit them.

> No `RIG_VERSION` bump: camera-mode pixels are byte-identical to today's. A test that
> asserts the version's value must spread the real module, never restate it (CLAUDE.md).

## 1. One rig orientation (D1)

- [x] 1.1 `viewer/session.ts`: `render` copies `camera.quaternion` into the rig every frame,
      unconditionally; remove the `rigQuaternion(axis)` initial copy, the tween's
      `fromRigQ`/`toRigQ` and their slerp, and the drag-cancel rig snap; keep the
      camera-side tween untouched
      <br>2026-08-31 (RAL-C): `ViewerSession.render` copies unconditionally; the
      constructor's rig copy, `AxisTween`'s `fromRigQ`/`toRigQ`, `advance`'s rig slerp,
      `tweenTo`'s two endpoint fields and *both* drag-cancel snaps (`orbit`, `zoom`) are
      gone — the camera-side tween is untouched. Covered by `sessionLighting.test.ts`
      ("rig equals the camera quaternion after render, whatever the spindle";
      "follows the camera through an axis tween, with no lighting snap")
- [x] 1.2 `three/renderer.ts` `renderThumbnail`: rig copies the rest camera's quaternion,
      unconditionally; delete the `getLightingMode` import. The contact floor's
      spindle-perpendicular placement (`frameFor(axis).s`) is unchanged
      <br>2026-08-31 (RAL-C): `renderThumbnail` copies unconditionally; the
      `getLightingMode` import is gone and `frameFor` stays imported for `placeFloor`,
      which is untouched. `RIG_VERSION` is unchanged at 6
- [x] 1.3 `three/camera.ts`: delete `rigQuaternion` if 1.1 and 1.2 were its only callers
      (grep first); keep `frameFor`
      <br>2026-08-31 (RAL-C): grep after 1.1/1.2 left only the definition plus
      `camera.test.ts`/`session.test.ts`/`sessionLighting.test.ts` cases, so it went with
      them. `frameFor` kept. `grep -rn "rigQuaternion" client/src` now returns nothing
- [x] 1.4 Client tests: `sessionLighting.test.ts` — keep "rig equals camera quaternion after
      render" and "rig equals camera quaternion mid-tween"; delete the axis-frame and
      slerp cases. `camera.test.ts` — drop `rigQuaternion` cases. `orbitHandoff` /
      `viewerLayer` — any case that sets a mode is deleted, not made to pass
      <br>2026-08-31 (RAL-C): `sessionLighting.test.ts` rewritten to the two keepers; the
      axis-frame case, the mode-toggle case and both frame-slerp cases deleted. The
      mid-tween keeper asserts the spec's continuity directly (rig strictly between the two
      rest-camera orientations mid-tween, landing on the new one exactly) — `ViewerSession`'s
      camera is private, so the endpoints are rebuilt with `applyState`. `camera.test.ts`'s
      whole `rigQuaternion` describe dropped; `session.test.ts`'s `ViewerSession light rig`
      describe dropped whole (all four cases were axis-rig behaviour; its camera-side
      cancel coverage is already duplicated by "a drag mid-tween cancels it…" and "zoom
      mid-tween cancels the animation…"). `orbitHandoff`/`viewerLayer` set no mode — they
      only passed the deleted `lighting` prop, which was removed from both prop fixtures

## 2. The label, with one producible value (D2)

- [x] 2.1 `viewer/lighting.ts` deleted. A single exported constant names the label every
      render writes (`THUMB_LIGHTING = 'camera'`), living beside `RIG_VERSION` in
      `three/renderer.ts` — the other recipe label lives there already
      <br>2026-08-31 (RAL-C): `viewer/lighting.ts` `git rm`'d. `THUMB_LIGHTING` is declared
      `= 'camera' satisfies LightingMode` immediately after `RIG_VERSION`, so its type stays
      the literal `'camera'` rather than widening to the union, with a doc comment saying
      `LightingMode` is a legacy label type with one producible value
- [x] 2.2 `hooks/useThumbnails.ts`: the hit test compares `cached.lighting` to the constant;
      the PUT writes it. `lib/entryActions.ts`: both re-render commands write the constant.
      `App.tsx` `persist` (the orbit-release / lightbox-close snapshot PUT) writes it too —
      the fifth read site, the one a grep for `getLightingMode` finds last
      <br>2026-08-31 (RAL-C): all five sites converted — `useThumbnails`' load effect (hit
      test + render PUT), `entryActions`' `rerenderThumbnail` and `setOrbitAxis` PUTs, and
      `App`'s `persist` PUT. `grep -rn "getLightingMode\|setLightingMode\|LIGHTING_MODES\|lighting-mode" client/src`
      returns nothing. Covered by `thumbnailQueue`, `persistPut` ("carries the png, the
      settled camera and axis, and the pixel labels"), `thumbnailCommands`,
      `thumbnailActions`, `orbitAxisMenu`, `viewerPanelActions`
- [x] 2.3 `shared/types.ts`: `LightingMode` documented as a legacy label type — `'axis'` is
      readable from old entries, never written. `server/src/app.ts`: `LIGHTING_MODES`
      becomes the single producible value; a PUT declaring `axis` is a 400
      — done 2026-08-31 (RAL-S): `LightingMode` keeps `'axis' | 'camera'` with the doc
      comment naming this change; `LIGHTING_MODES` is now the scalar `PRODUCIBLE_LIGHTING`
      (`'camera'`) and the PUT compares against it. Covered by `api.test.ts` "refuses a put
      declaring the retired axis lighting label" (400 + `{error:'invalid lighting: axis'}`),
      "put stores the lighting mode and get serves it back" (the accepted side), and
      "echoes a stored axis label on hits and on stale reads". Falsified by reverting the
      narrowing: the refusal test failed `expected 200 to be 400`
- [x] 2.4 Tests: server `api.test.ts` — PUT with `axis` refused, PUT with `camera`
      accepted, a stored `axis` entry is still echoed on GET. Client
      `thumbnailQueue`/`persistPut`/`thumbnailCommands`/`thumbnailActions` — the label
      written is the constant; a cached `axis` label is stale and re-renders with camera
      and axis preserved; a cached `camera` label at the current rig is a hit with no
      render and no PUT (the "camera-lit cache needs nothing" scenario — assert the render
      count). **Mocks that chose `'axis'` as "the current mode" switch to the constant, or
      their meaning inverts**: `semanticSearch.test.tsx` ("a thumbnail the user already
      aimed is left alone, pose or no pose" mocks `lighting: 'axis'` and asserts a hit),
      `orbitAxisMenu.test.tsx`, `apiClient.test.ts`, `server/test/cache.test.ts` — and
      `client/test/CLAUDE.md`'s lighting note
      — server half done 2026-08-31 (RAL-S): `api.test.ts` gained the axis refusal (status
      and error body) and the stored-`axis` echo on both a hit and a stale read, camera and
      axis preserved. `server/test/cache.test.ts` needed no edit: it has **no** `'axis'`
      lighting occurrence — both of its lighting fixtures already use `'camera'`, and
      neither is a "current mode" stand-in that this change would invert. Box left open for
      the client half (RAL-C)
      <br>**client half done 2026-08-31 (RAL-C)** (box left for the coordinator — the server
      half is RAL-S's): `thumbnailQueue.test.tsx` carries both behavioural keepers — "a hit
      carrying the retired axis label re-renders, preserving camera and axis" (asserts the
      PUT's `lighting` is `THUMB_LIGHTING` and that `camera`/`axis` are omitted) and "a
      camera-lit cache at the current rig needs nothing: no render, no PUT" (asserts
      `renderThumbnail`, `lru.acquire` and `putThumb` are all uncalled over four entries).
      Both falsified — see the report. Its hand-listed renderer mock was converted to the
      `importOriginal` spread per client/test/CLAUDE.md so both recipe labels stay real, and
      its `afterEach` now clears the shared `renderThumbnail` spy (its calls accumulate
      file-wide, so a render *count* otherwise reads the whole file's history).
      `persistPut`/`thumbnailCommands`/`thumbnailActions`/`orbitAxisMenu`/`viewerPanelActions`
      retargeted to the constant. `semanticSearch.test.tsx`'s pose-loop mock switched off
      `'axis'` — verified load-bearing: reverting just that mock fails "a thumbnail the user
      already aimed is left alone, pose or no pose" with `renderThumbnail` called 2 times.
      `apiClient.test.ts` needed no change — its wire fixtures already say `'camera'`, and
      they deliberately stay literals because they pin the HTTP round-trip, not the app
      constant. `client/test/CLAUDE.md`'s preference-module bullet drops `lighting.ts` and
      gains a note naming `THUMB_LIGHTING` and the `'axis'`-mock inversion trap
      <br>Box closed 2026-08-31 (coordinator): both halves merged (`4b1a7d4`, RAL-C's commit)

## 3. The pill and the prop (D1, D4)

- [x] 3.1 `App.tsx`: remove the lighting buttons from the corner pill and the `lighting`
      state; the container stays only if the AO pill lives in it (check before deleting
      the wrapper). `viewer/ViewerLayer.tsx`: drop the `lighting` prop and its effect
      dependency
      <br>2026-08-31 (RAL-C): checked — the ssao button *does* live in the same
      `fixed bottom-3 left-3` div, so the wrapper stays; removed the `light` caption, the
      `LIGHTING_MODES` button map and the now-leading `h-4 w-px` divider that had separated
      the two groups. `lighting` state, the `viewer/lighting` import and the unused
      `LightingMode` type import are gone from `App.tsx`; the pill comment no longer names
      the retired experiment as pending. `ViewerLayer`: `lighting` prop, its `LightingMode`
      type import, its destructure and its effect dependency dropped, and the canvas
      effect's comment now says "on an AO toggle". `aoToggle.ts`'s header comment lost its
      two references to the lighting mode as a precedent (the module it cited is deleted)
- [x] 3.2 `lighting.test.ts` deleted (its subject no longer exists); `aoToggle.test.ts`
      and `viewerPanelActions.test.tsx` lose only the lines that set a lighting mode
      <br>2026-08-31 (RAL-C): `client/test/lighting.test.ts` `git rm`'d whole. Neither
      `aoToggle.test.ts` nor `viewerPanelActions.test.tsx` actually *set* a mode: aoToggle
      only named it in a title ("persists the preference per profile, like the lighting
      mode" → "persists the preference per profile"), and viewerPanelActions only labelled
      a cache-hit mock with `getLightingMode()`, retargeted to `THUMB_LIGHTING` under 2.4.
      `thumbnailCommands.test.ts` did set one (`setLightingMode('axis')` in `beforeEach`) —
      that line is deleted
- [x] 3.3 `lib/urlState.ts` and `client/test/urlState*`: nothing to change in code — the
      mode never reached the URL — but delete any test that toggles lighting to prove
      the URL is unchanged, keeping the AO one
      <br>2026-08-31 (RAL-C): nothing to delete — verified by grep, neither
      `urlState.test.ts` nor `urlNavigation.test.tsx` mentions lighting at all, and
      `lib/urlState.ts` never referenced it. The appearance-preference coverage that
      remains lives in `aoToggle.test.ts`, untouched apart from the title above

## 4. Specs, docs, verification

- [x] 4.1 Archive dry run per CLAUDE.md on a fresh copy, **after** `library-root` has
      archived on that copy: the two RENAMED + MODIFIED pairs (`model-thumbnails`,
      `model-viewer`), the *Shadowed model display* MODIFIED (five scenario titles) and the
      `url-navigation` MODIFIED must apply cleanly
      — done 2026-08-31 (coordinator), on main *after* library-root's real archive
      (`7a872c7`): `openspec archive remove-axis-lighting --yes` on a fresh copy reports
      `+ 0, ~ 4, - 0, → 2` and archives cleanly; the `url-navigation` delta's anchors were
      re-checked against the archived requirement whitespace-collapsed — the only phrase
      absent from the delta is "lighting mode", which is what it deletes, so no
      re-derivation was needed
- [ ] 4.1a `adaptive-ao-default` edits the same corner-pill block in `App.tsx` — whichever
      lands second re-reads it (shared-file ordering, CLAUDE.md)
- [ ] 4.2 `ao-refreshes-thumbnails`: open an `opsx:update` on it (separate session or
      after this) re-targeting its trigger to the AO toggle and rewriting its
      `model-thumbnails` delta under *Recipe-labelled thumbnails*; until then it must not
      be applied
- [x] 4.3 `docs/web-demo-notes.md` item 9 points here as decided-and-drafted; the "hide the
      lighting menu" row is closed
      — done 2026-08-31 (coordinator): item 9's heading and the Decided-table row both name
      `remove-axis-lighting` as implemented/closed
- [x] 4.4 `bun run test` / `bun run typecheck` clean across workspaces; `rg
      "getLightingMode|LIGHTING_MODES|lighting-mode"` over `client/src` returns nothing
      — done 2026-08-31 (coordinator) on merged main `5475f23`: client 511 passed (49
      files), server 282 passed / 3 skipped (the index-contract gate), both typechecks
      clean; the lighting grep (with `setLightingMode` added) and a `rigQuaternion` grep
      over `client/src` both return nothing
- [ ] 4.5 Live verification: open the app on a directory whose cache is fully camera-lit
      (this machine) and confirm zero PUTs on visit (network panel); plant one sidecar
      with `"lighting":"axis"` and confirm exactly that tile re-renders and re-uploads
      once, keeping its camera; orbit an ±X-spindle model in the lightbox and change its
      axis — no lighting snap
