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

- [ ] 1.1 `viewer/session.ts`: `render` copies `camera.quaternion` into the rig every frame,
      unconditionally; remove the `rigQuaternion(axis)` initial copy, the tween's
      `fromRigQ`/`toRigQ` and their slerp, and the drag-cancel rig snap; keep the
      camera-side tween untouched
- [ ] 1.2 `three/renderer.ts` `renderThumbnail`: rig copies the rest camera's quaternion,
      unconditionally; delete the `getLightingMode` import. The contact floor's
      spindle-perpendicular placement (`frameFor(axis).s`) is unchanged
- [ ] 1.3 `three/camera.ts`: delete `rigQuaternion` if 1.1 and 1.2 were its only callers
      (grep first); keep `frameFor`
- [ ] 1.4 Client tests: `sessionLighting.test.ts` — keep "rig equals camera quaternion after
      render" and "rig equals camera quaternion mid-tween"; delete the axis-frame and
      slerp cases. `camera.test.ts` — drop `rigQuaternion` cases. `orbitHandoff` /
      `viewerLayer` — any case that sets a mode is deleted, not made to pass

## 2. The label, with one producible value (D2)

- [ ] 2.1 `viewer/lighting.ts` deleted. A single exported constant names the label every
      render writes (`THUMB_LIGHTING = 'camera'`), living beside `RIG_VERSION` in
      `three/renderer.ts` — the other recipe label lives there already
- [ ] 2.2 `hooks/useThumbnails.ts`: the hit test compares `cached.lighting` to the constant;
      the PUT writes it. `lib/entryActions.ts`: both re-render commands write the constant.
      `App.tsx` `persist` (the orbit-release / lightbox-close snapshot PUT) writes it too —
      the fifth read site, the one a grep for `getLightingMode` finds last
- [ ] 2.3 `shared/types.ts`: `LightingMode` documented as a legacy label type — `'axis'` is
      readable from old entries, never written. `server/src/app.ts`: `LIGHTING_MODES`
      becomes the single producible value; a PUT declaring `axis` is a 400
- [ ] 2.4 Tests: server `api.test.ts` — PUT with `axis` refused, PUT with `camera`
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

## 3. The pill and the prop (D1, D4)

- [ ] 3.1 `App.tsx`: remove the lighting buttons from the corner pill and the `lighting`
      state; the container stays only if the AO pill lives in it (check before deleting
      the wrapper). `viewer/ViewerLayer.tsx`: drop the `lighting` prop and its effect
      dependency
- [ ] 3.2 `lighting.test.ts` deleted (its subject no longer exists); `aoToggle.test.ts`
      and `viewerPanelActions.test.tsx` lose only the lines that set a lighting mode
- [ ] 3.3 `lib/urlState.ts` and `client/test/urlState*`: nothing to change in code — the
      mode never reached the URL — but delete any test that toggles lighting to prove
      the URL is unchanged, keeping the AO one

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
- [ ] 4.4 `bun run test` / `bun run typecheck` clean across workspaces; `rg
      "getLightingMode|LIGHTING_MODES|lighting-mode"` over `client/src` returns nothing
- [ ] 4.5 Live verification: open the app on a directory whose cache is fully camera-lit
      (this machine) and confirm zero PUTs on visit (network panel); plant one sidecar
      with `"lighting":"axis"` and confirm exactly that tile re-renders and re-uploads
      once, keeping its camera; orbit an ±X-spindle model in the lightbox and change its
      axis — no lighting snap
