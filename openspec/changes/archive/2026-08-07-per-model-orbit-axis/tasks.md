## 1. Shared Types & Camera Math

- [x] 1.1 Add `OrbitAxis` type (`'x' | '-x' | 'y' | '-y' | 'z' | '-z'`) to shared/types.ts; document `CameraState` as spindle-relative; add axis to thumb API payloads (GET response, PUT request)
- [x] 1.2 Generalize camera.ts state math to a spindle frame: per-axis `(s, a, b)` frames with `a×b = −s`, spindle-relative `applyState`/`captureState`/default-view, used by both session and `renderThumbnail`

## 2. Server: Axis in the Cache Entry

- [x] 2.1 Store axis in the cache meta beside camera (path-keyed); serve it on GET, accept it on PUT; missing axis reads as `'y'`
- [x] 2.2 Maintenance: axis survives size-cap eviction with camera state; existence sweep removes it with the entry (extend existing tests)

## 3. Client: Session & Viewer

- [x] 3.1 Session takes the model's axis at construction; orbit/render/settle all operate in the spindle frame; settle derives exact spindle-relative state (no world-Y approximation)
- [x] 3.2 ViewerLayer/App thread the axis from the thumb response into the session (default `'y'` on miss); persist writes axis + camera + png in one PUT
- [x] 3.3 Thumbnail pipeline renders from stored axis + camera (spindle default view on camera miss)
- [x] 3.4 Lightbox axis control: X/Y/Z buttons + flip toggle showing the current spindle; changing it smoothly animates (brief eased rotation) to the new spindle's default view — drag cancels the animation, a further axis change retargets it — and persists axis + end-state camera + re-rendered thumbnail immediately (not gated on the animation)
- [x] 3.5 Tear down the experiment: delete orbitModes.ts global store, corner picker UI, and localStorage orbit-mode/flip keys

## 4. Verification

- [x] 4.1 Client tests: spindle-frame round-trip for all six axes (including a rescaled model), session orbit/clamp under each axis, axis-change transition (animates to the new default view, drag cancels it, persistence carries the end state regardless), persistence payload shape
- [x] 4.2 Server tests: axis stored/served/defaulted, eviction spares axis, sweep removes it
- [x] 4.3 Manual pass: override a model's axis in the lightbox, verify grid overlay honors it, thumbnail re-renders, and the override survives reload and a cleared-localStorage "other browser"
