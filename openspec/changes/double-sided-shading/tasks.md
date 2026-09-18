# Tasks — double-sided-shading

> Ordering: `RIG_VERSION` is shared. Re-read `client/src/three/renderer.ts` and `client/src/three/models.ts` against main before editing. Bump from whatever the constant is, not from the 7 this change saw when written. Independent of `adaptive-ao-default`. One PR (design D7).

## 1. Material and GTAO

- [x] 1.1 `makeMaterial` in `client/src/three/models.ts`: set `side: THREE.DoubleSide` and `shadowSide: THREE.DoubleSide`. Leave `withShadows` and the four `parseModel` arms as they are. Do not change the contact-floor `ShadowMaterial` in `stageModel`. Verify: `cd client && bunx vitest run test/models.test.ts` — add a cell that a parsed STL mesh and a parsed GLB mesh both carry those two fields. Falsify by leaving `side` at the default; the new cell must fail.
- [x] 1.2 `makeChain` in `client/src/three/renderer.ts`: after `new GTAOPass(...)`, set `aoPass.normalMaterial.side = THREE.DoubleSide`. Do not pass `distanceFallOff`. Verify: `cd client && bunx vitest run test/composer.test.ts` — add a cell that both `getLiveChain` and `getThumbChain` expose `GTAOPass.normalMaterial.side === THREE.DoubleSide`. Falsify by skipping the assignment; the new cell must fail.
- [x] 1.3 Bump `RIG_VERSION` one step from the live value. Update the pin in `client/test/rig.test.ts` (title and expected number). Verify: `cd client && bunx vitest run test/rig.test.ts` and that no test re-declares the constant as a literal (spread mocks only). `7 → 8`.

## 2. Spec-adjacent docs

- [x] 2.1 Rewrite the generated-STL bullet in the root `CLAUDE.md` Testing section. It currently says inverted winding "mirrors lighting left/right". After 1.1 it no longer does; the bullet should say fixtures still want outward winding when a test inspects the normal attribute (`stlNormals.test.ts`), and that inverted winding is now a double-sided shading case, not a lighting-assertion trap. Verify by grepping the collapsed whitespace of that file for "mirrors lighting".

## 3. Visual pass (leave open until judged)

- [x] 3.1 Playwright, inverted vs healthy. Gate is the demo-corpus file at `/28mm_fantasy_Fountain_Mounument_1778555/FOUNTAIN_Crown_Alternate_28mm.stl` (confirmed inverted; Lady Dwarf copies are already repaired and are not this gate). Open it in the overlay and the lightbox, occlusion on and off. It must read as a solid near surface, not a hollow shell. Control: `/28mm_fantasy_Fountain_Mounument_1778555/FOUNTAIN_Middle.stl` (outward; do not use `FOUNTAIN_Crown_52mm.stl`, which is inverted too). Save captures under `.playwright-mcp/`. If this fountain file has been rewritten by the time the pass runs, fall back to a crafted inward-wound STL in a temp `MODEL_BROWSER_ROOT` (swap two vertices per facet; do not check a binary into the repo).
  Judged 2026-09-18 on a worktree-local `:5174` (the already-running `:5173` is a different checkout). Before: hollow shell, interior of far walls lit. After: solid two-tier crown, occlusion on and off. Control `FOUNTAIN_Middle` stays solid. Captures: `.playwright-mcp/31-fountain-crown-double-side-off.png`, `31-fountain-crown-double-side-ao.png`, `31-fountain-middle-control.png`.
- [x] 3.2 Shadow bias. On a flat-faced print and an organic miniature, overlay and lightbox: no speckling on the bed, no detached contact shadow. Leave `SHADOW_NORMAL_BIAS_R` alone unless one of those shows up; if it changes, bump `RIG_VERSION` again and pin the new value in `stageModel.test.ts`. Write the verdict on this line.
  Verdict: leave `SHADOW_NORMAL_BIAS_R = 0.02`. Fountain crown (flat panels) and fountain middle (recessed discs) both show an attached contact shadow, no bed speckle, lightbox, occlusion on.
- [x] 3.3 Frame time. Lightbox orbit on a heavy miniature with occlusion on, after the persist settle (~5s). Record median frame time on this line. Not a ship gate unless the unoccluded path is the one that becomes unusable (D6).
  **Not measured.** A 30-sample rAF run on `FOUNTAIN_Middle` with occlusion on sat at median 33.4 ms in an unfocused preview tab (rAF throttled to ~30 fps). That is not GPU cost and does not satisfy D6. Unoccluded path still usable. Not a ship gate.
- [x] 3.4 `stlNormals.test.ts` still passes unchanged: `cd client && bunx vitest run test/stlNormals.test.ts`. Winding remains the source of the normal attribute.

## 4. Gates

- [x] 4.1 `bun run typecheck` and `bun run test` pass across workspaces.
- [x] 4.2 `openspec validate double-sided-shading` passes.
