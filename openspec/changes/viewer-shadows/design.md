# Design — viewer-shadows

## Context

`makeScene` (client/src/three/renderer.ts) builds `{ scene, rig }`: a hemisphere (1.4), a key `DirectionalLight` at (1, 2, 1.5) intensity 1.6, and a fill at (−1.5, −0.5, −1) — plus, once rim-lights lands, the red/blue accents. Both consumers add the model at whatever world coordinates its geometry carries — `boundsOf` (client/src/three/camera.ts:9) measures a `Box3` and returns only `{ center, radius }`, and every camera quantity is bounds-relative (recorded D4). The shared renderer (`getRenderer`, alpha-transparent clear) renders the live view directly and thumbnails into a 512² MSAA render target; no post-processing anywhere. Meshes get `MeshStandardMaterial` in `makeMaterial` (client/src/three/models.ts:14) with no shadow flags. Rim-lights D2 introduces `RIG_VERSION` naming the pixel recipe, and commits future pixel-changing render revisions to bumping that constant.

This change depends on rim-lights being implemented first: it bumps `RIG_VERSION`, and it edits the same `makeScene` and renderer-mock files.

## Goals / Non-Goals

**Goals:**
- The model shadows itself and casts a soft contact shadow on an invisible floor, identically in the orbit overlay, the lightbox, and thumbnails.
- Shadow direction inherits the lighting-mode semantics: spindle-fixed in `axis` mode, following the viewer in `camera` mode — with no new orientation code.
- The fit scales with `bounds.radius` so a 5 mm miniature and a 300 mm bust shadow equally well.
- Cached thumbnails refresh lazily through the rim-lights `RIG_VERSION` mechanism.

**Non-Goals:**
- Screen-space ambient occlusion or any post-processing (separate change).
- Shadows from the hemisphere, fill, or rim lights in the shipped recipe — one caster only. (The D5 scaffolding can temporarily enable rim casting in the live view, for the comparison only.)
- A user toggle for shadows; shadows are part of the rig recipe like the rim accents. (The temporary rim toggle in D5 is verification scaffolding, removed before archive — not a shipped toggle.)
- Rebalancing existing light colors/intensities.

## Decisions

### D1: Scenes are origin-centered by a per-scene pivot group

A `pivot` group is added to the scene; the model is parented to it, raw bounds are measured, and `pivot.position` is set to `−center`, so the effective bounds used by all subsequent math are `{ center: origin, radius }` (the measured `Box3` translated likewise). Camera state is bounds-relative az/el/distR plus a center-relative target (`stateTarget`, camera.ts:75), so centering is invisible to persisted state and to rendered pixels — `statePosition`/`applyState` produce the same image around the new center.

This exists because a `DirectionalLight`'s shadow camera sits at the light's world position and must physically cover the model. The rig rotates about the scene origin (session.ts sets `rig.quaternion`; positions inside the rig orbit the origin), so a model whose STL coordinates put it at, say, (1000, 0, 1000) can never be covered by a frustum attached to a rig-space light — rotation swings the frustum off the model. With the model centered on the origin, the key's world position under any rig rotation stays on a sphere of radius `|key.position|` around the model, and a static frustum sized to `bounds.radius` always covers it. Depth precision for far-from-origin exports improves as a side effect.

*Alternative — translate the rig to `bounds.center`:* breaks the hemisphere light: three.js derives a `HemisphereLight`'s sky direction from its raw world position, so `center + R·(0,1,0)` normalizes to "toward wherever the model happens to sit" instead of rig-up. *Alternative — split the key into a separately-translated shadow rig:* forfeits the "rig quaternion is the single orientation authority" property rim-lights D1 relies on; every mode/tween/snap site would orient two objects.

Reparenting contract: `renderThumbnail` already borrows a possibly-live object and restores `originalParent` after (renderer.ts:55–58, 78–79); with the pivot, restoration stays `originalParent?.add(object)` (three's `add` reparents), with `pivot.remove(object)` for the parentless case. `ViewerSession.close()`'s `scene.remove(object)` becomes the pivot equivalent.

### D2: One shadow caster — the key light, fit to bounds per scene

`getRenderer` enables `shadowMap` (PCFSoft) once on the shared renderer; shadow maps work identically into the visible canvas and the thumbnail render target, so the handoff guarantee is untouched. In `makeScene`-consumer setup (a shared `stageModel` step, see D4) the key gets `castShadow`, a ~2048 map, and a bounds-proportional fit: `key.position.setLength(k·radius)` (direction — hence lighting — unchanged; only shadow-camera placement moves), ortho frustum half-extents ≈ 2·radius (model sphere plus the floor area its shadow sweeps), near/far spanning the sphere from the light distance, and `normalBias` proportional to radius (acne scales with world units; a constant bias would speckle miniatures and detach busts). Exact constants are cosmetic, tuned at apply time, then frozen in the unit test. Meshes created in models.ts set `castShadow`/`receiveShadow` so the model self-shadows.

The key stays a child of the rig, so shadow direction inherits every mode semantic for free: spindle-fixed in `axis` mode, camera-locked in `camera` mode (the shadow sweeps the floor as the viewer orbits — intended, it is the same light that moves the shading), slerped through the axis tween, snapped on drag-cancel. Hemisphere/fill/rims don't cast: one depth pass per frame, and accent lights casting colored-edge shadows would read as artifacts.

*Alternative — all directional lights cast:* three depth passes for strictly muddier output.

### D3: Contact floor: a spindle-fixed ShadowMaterial plane

A `PlaneGeometry` with `ShadowMaterial` (transparent, low opacity — invisible except where shadow falls, so it composes over the alpha-clear background in thumbnails and live views alike) is added to the scene — never to the rig (in `camera` mode a rig-parented floor would face the camera) and never to the pivot's measured object (it must not affect `boundsOf`; it is added after measurement). It lies perpendicular to the spindle `s = frameFor(axis).s` at the model's lowest extent along `s` — the box face minimizing `dot(p, s)`, which for the axis-aligned spindle set is a single `box.min`/`box.max` component — nudged a small ε·radius below to avoid z-fighting with flat print beds, sized ≈ 8·radius so camera-mode shadow sweeps stay on it. `receiveShadow` only; it never casts.

`boundsOf` grows the measured `Box3` in its return value (it already computes one and throws it away) so floor placement needs no second traversal. On `setAxis` the floor snaps to the new spindle's face immediately — the tween animates camera and rig, and an eased floor would imply the model's resting face is interpolating, which means nothing physically. `ViewerSession.close()` disposes the floor's geometry and material (D5 spirit: the floor is per-session, unlike the LRU-owned model).

*Alternative — floor at the bounding-sphere bottom (`center − s·radius`):* floats the floor well below flat, wide prints — the sphere radius exceeds the half-height — visibly detaching the contact shadow.

### D4: A shared `stageModel` step; `RIG_VERSION` bumps to 3

Scene population currently happens twice with subtle duplication (session.ts constructor, renderThumbnail). Both move to one exported `stageModel(lit, object, axis)`: parent to pivot, measure, center, fit the key's shadow, build/place the floor — returning the centered bounds and a floor handle (for `setAxis` re-placement and `close()` disposal). One code path guarantees thumbnails and live views shadow identically.

Shadows change every model's pixels; per rim-lights D2 this bumps the shared `RIG_VERSION` (2 → 3) and rides the existing lazy invalidation — no new cache fields, no server or API changes. Renderer-mock factories in client tests must gain the new export (`stageModel`) — the full-factory mocks throw on missing exports, the same sweep rim-lights task 2.3 does.

### D5: A live-view rim-shadow toggle — verification scaffolding only

To judge whether rim-cast shadows earn their keep on top of the key's, the viewer gains a visible toggle that turns shadow casting by the red/blue rims on and off in the live view — the rims themselves stay lit in both states; only their casting changes. Default OFF: the shipped recipe (D2's single caster) is the resting state, and the toggle temporarily adds the rims as casters. Mechanism follows the lighting-mode precedent (viewer/lighting.ts plus its corner pill): a module-level flag consulted by `ViewerSession` on each render — `castShadow = flag` on the two accent lights, nothing removed from the rig. To make enabled rim shadows well-formed at any model size, `stageModel` applies the same bounds-proportional fit to the rims' shadow cameras as to the key's — configuration only; three.js allocates a rim's shadow map only while it actually casts, and toggling casting changes the renderer's lights hash so materials recompile automatically. The existing render-on-toggle effect makes the change visible without a drag. NOT persisted (in-memory): a comparison instrument, not a preference.

Scope guard: only `ViewerSession` consults the flag; `renderThumbnail` always renders the shipped recipe (key-only casting), so thumbnails, `RIG_VERSION`, and the cache are untouched. While rim casting is on, the live view intentionally diverges from the cached thumbnail and from the spec's "only the key light casts" — both knowingly suspended in the live view for the comparison; the shipped/thumbnail truth is unchanged. Session teardown disposes every fitted casting light's shadow map (VRAM hygiene). The toggle is scaffolding: a final task records the verdict and removes the control before archive, which is why it carries no spec delta. If rim casting wins, making the rims real casters is a follow-up change (it MODIFYs this change's shadowed-display requirement and bumps `RIG_VERSION` again); if not, the toggle is simply removed.

## Risks / Trade-offs

- [Depth pre-pass doubles per-frame geometry cost on million-triangle STLs] → one caster only, 2048 map, and the existing render-queue suspension during interaction already bounds contention; map size is a single tunable if weak GPUs struggle.
- [Shadow acne vs. peter-panning on flat-bottomed prints] → `normalBias` scaled by `bounds.radius`, tuned at apply against small and large fixtures, then frozen in the unit test; the ε floor offset absorbs residual bed-contact fighting.
- [In `camera` mode at low or negative elevation the key sits near or below the floor plane and the contact shadow shrinks or vanishes] → accepted: the light legitimately is where the shading says it is; the floor never darkens without cause.
- [Both this change and rim-lights edit `makeScene`, `RIG_VERSION`, and the same mock factories] → hard ordering: implement after rim-lights lands (its tasks are unchecked as of writing; a parallel session is on it). If rim-lights is abandoned, this change first adopts its D2 cache plumbing verbatim.
- [Origin-centering perturbs anything that secretly assumed world coordinates] → audit at apply: camera math is bounds-relative by design (D4); the only world-coordinate consumers are `boundsOf` itself and the reparenting sites listed in D1.
- [Two browsers on different app versions fight over `rig`] → same accepted churn as rim-lights D2.

- [The D5 rim toggle outlives the change if the removal task is skipped] → task 4.4 removes it before archive is reachable; if it is instead kept deliberately, that decision must become its own change with a spec delta.

## Open Questions

- Floor opacity and whether the contact shadow reads well on the dark app background at thumbnail size — judged visually at apply; if it reads as dirt rather than grounding, the floor can ship disabled-by-default behind the same constants without touching the self-shadowing.
- Key-only vs. key+rim shadow casting: which reads better? Judged via the D5 toggle on small and large fixtures in both lighting modes (task 4.3); the verdict is recorded here and drives a follow-up change (rims becoming real casters, or nothing) — it does not alter this change's scope.
