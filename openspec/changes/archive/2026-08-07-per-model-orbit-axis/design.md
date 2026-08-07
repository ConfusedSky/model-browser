## Context

The orbit-feel experiment (post-v1) established: the v1 "wrongness" was axis convention, not orbit math — STL/3MF are print-bed Z-up while the scene is Y-up, so the turntable spindle passed through the model's side. With the Z-up conversion in place, clamped turntables won; free-tumble/arcball variants lost. The user wants the spindle to be per-model: +Y default, overridable to any of ±X/±Y/±Z from the lightbox. The experiment's global picker, and the world-Y-only camera persistence, must be replaced by the real feature.

## Goals / Non-Goals

**Goals:**
- Per-model spindle axis (±X/±Y/±Z, default +Y), set in the lightbox, persisted server-side with the camera.
- Camera persistence exactly faithful for every axis (spindle-relative storage).
- Specs catch up with the already-landed Z-up display conversion.
- Remove the global experiment picker and its localStorage settings.

**Non-Goals:**
- Other orbit models (tumble, arcball, pivot — evaluated and rejected in the experiment).
- Arbitrary (non-axis-aligned) spindles.
- Per-model rotation-speed or zoom settings.

## Decisions

### D1: Orbit model — clamped turntable around a per-model spindle
Each model orbits as the v1 turntable, generalized: yaw rotates around the spindle `s`; pitch tilts toward/away from `s`, clamped at ±(90°−0.6°); camera up is locked to `s`. The spindle is one of ±X/±Y/±Z — flip is part of the axis value (six values, four controls: three axis buttons + a flip toggle), not a separate per-model bit. Plane bases are chosen with `a×b = −s` per axis so a rightward drag spins the same visual direction under every spindle. Default is +Y: after the Z-up conversion this is the model's natural up, which the experiment confirmed as the correct default feel.

### D2: Spindle-relative camera state
`CameraState` az/el are measured in the model's spindle frame `(a, b, s)`, not world-Y. Under the default +Y spindle the two representations are numerically identical, so every existing cache entry (all +Y today) remains valid with no migration. This is what makes persistence exact for X/Z/flipped spindles — the experiment stored a nearest-world-Y approximation, which visibly mis-rendered thumbnails for non-default spindles. Bounds-relativity (distance in radii, target relative to bbox) is unchanged.

### D3: Axis lives in the cache entry, keyed by path only
The axis is stored server-side in the same `{png, cameraState}` entry, beside the camera: same cross-browser argument (localStorage would strand it per-browser), same keying (path only — a re-export keeps its axis), same maintenance rules (survives size-cap eviction — it is bytes-sized and user-set; removed whole-entry by the existence sweep). The thumb API (`GET`/`PUT /api/thumb`) carries it. A camera state without its axis is ambiguous, so the two are read and written together.

### D4: Override control in the lightbox
The lightbox gains a compact control: three axis buttons (X/Y/Z) plus a flip toggle, showing the model's current spindle. Changing it smoothly animates the camera (brief eased rotation, not a snap) to the default three-quarter view *for that spindle*, so the chosen axis visibly rotates to screen-up. The end pose is the new spindle's default view — the old camera state is meaningless in the new frame — and since that end state is known upfront, axis + camera + re-snapshotted thumbnail persist on the spot, without waiting for the animation. A drag during the transition cancels the animation and orbits from the current pose; a further axis change retargets the animation. The in-grid orbit overlay has no control — it reads the model's stored axis; the lightbox is where deliberate per-model configuration happens.

### D5: Upright display convention (specs catch up with landed code)
STL geometry is rotated −90° about X at parse (baked into positions/normals), converting print-bed Z-up to scene Y-up. 3MF is converted by three's loader already; OBJ is conventionally Y-up and left alone. This is load-time and universal — thumbnails, overlay, and lightbox all see upright models — and is why +Y is the correct default spindle.

### D6: Experiment teardown
`orbitModes.ts`'s global mode/flip store, the corner picker UI, and their localStorage keys are removed. The session reads the spindle from the per-model state passed at open (axis from the thumb response, default +Y on miss).

## Risks / Trade-offs

- [Axis change invalidates the saved orientation] → by design: the old camera is meaningless in the new frame; reset to the new spindle's default view and persist immediately so all stores stay coherent.
- [Old non-Y experiment persists left some approximated cameras/thumbnails] → they self-heal: next orbit release overwrites them; all were written under +Y interpretation, which remains readable.
- [Six axis values in the UI could confuse] → four controls (X/Y/Z + flip) with the current value highlighted; default +Y means most users never touch it.

## Migration Plan

None needed for data: existing entries are all +Y, whose spindle-relative representation equals the current one, and a missing axis field reads as +Y. Code migration is the teardown in D6.

## Open Questions

- None blocking.
