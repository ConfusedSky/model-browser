## 1. Shared Types & Camera Math

- [ ] 1.1 Add `OrbitAxis` type (`'x' | '-x' | 'y' | '-y' | 'z' | '-z'`) to shared/types.ts; document `CameraState` as spindle-relative; add axis to thumb API payloads (GET response, PUT request)
- [ ] 1.2 Generalize camera.ts state math to a spindle frame: per-axis `(s, a, b)` frames with `a×b = −s`, spindle-relative `applyState`/`captureState`/default-view, used by both session and `renderThumbnail`

## 2. Server: Axis in the Cache Entry

- [ ] 2.1 Store axis in the cache meta beside camera (path-keyed); serve it on GET, accept it on PUT; missing axis reads as `'y'`
- [ ] 2.2 Maintenance: axis survives size-cap eviction with camera state; existence sweep removes it with the entry (extend existing tests)

## 3. Client: Session & Viewer

- [ ] 3.1 Session takes the model's axis at construction; orbit/render/settle all operate in the spindle frame; settle derives exact spindle-relative state (no world-Y approximation)
- [ ] 3.2 ViewerLayer/App thread the axis from the thumb response into the session (default `'y'` on miss); persist writes axis + camera + png in one PUT
- [ ] 3.3 Thumbnail pipeline renders from stored axis + camera (spindle default view on camera miss)
- [ ] 3.4 Lightbox axis control: X/Y/Z buttons + flip toggle showing the current spindle; changing it re-frames to the new spindle's default view and persists axis + camera + re-rendered thumbnail immediately
- [ ] 3.5 Tear down the experiment: delete orbitModes.ts global store, corner picker UI, and localStorage orbit-mode/flip keys

## 4. Verification

- [ ] 4.1 Client tests: spindle-frame round-trip for all six axes (including a rescaled model), session orbit/clamp under each axis, axis-change re-frame behavior, persistence payload shape
- [ ] 4.2 Server tests: axis stored/served/defaulted, eviction spares axis, sweep removes it
- [ ] 4.3 Manual pass: override a model's axis in the lightbox, verify grid overlay honors it, thumbnail re-renders, and the override survives reload and a cleared-localStorage "other browser"
