# Tasks — ao-as-recipe-dimension

> Ordering (hard): after `library-root` (its migration re-keys legacy entries, none of which
> can carry a `.noao.png` — the sibling is born after this change under a per-library key)
> and after `remove-axis-lighting` (sibling requirement in `model-viewer`, and the
> lighting mode this delta stops mentioning). Before `ao-refreshes-thumbnails` (formerly `lighting-refreshes-thumbnails`) is
> re-targeted (this is the dimension it will refresh) and before `adaptive-ao-default`.
> Re-read `cache.ts`, `app.ts`, `renderer.ts`, `useThumbnails.ts`, `entryActions.ts`
> against main before starting.

> No `RIG_VERSION` bump (design D5). A test asserting the version spreads the real
> module.

## 1. Server: the sibling render (D1, D2, D3)

- [x] 1.1 `ThumbCache`: `get(path, mtime, ao)` — `ao` selects `<key>.png` + top-level
      labels or `<key>.noao.png` + the sidecar's `noao` labels; status is for that render;
      `camera`/`axis` returned on every status. `put(path, { ao, png, … })` writes the
      selected render and its labels, and **invalidates the render it did not write — both renders when the PUT carries no
      pixels — only when the PUT changes the shared orientation**: a camera the entry did not hold, or one differing from the stored camera by more than `CAMERA_EPSILON` per component (a named constant; `persist` re-sends a re-captured camera on every close); an axis the entry did not hold or one that differs (equality — it is an enum); or a `null` discard. Invalidation clears that render's recipe labels (`rig`, `lighting`, `posed`)
      and keeps its PNG and `mtime`, so it reads as a hit the client must re-render (D2). A
      PUT carrying only a PNG and labels, or a camera within tolerance, leaves the other
      render alone. Per-render status: hit (pixels present at the requested mtime), stale
      (written before, or the entry holds an orientation), miss
      <br>2026-08-31 (AOD-A): `Meta` now extends a `RenderLabels` (`mtime`, `lighting`,
      `rig`, `posed`) it shares with a new optional `noao` field, so an entry that has
      never held an unoccluded render serialises to exactly the sidecar it did before —
      pinned by cache.test.ts "serves an entry written before the split as the occluded
      render…", which asserts `'noao' in sidecar` is false. `pngFile` takes the render;
      `get`/`put` take `ao` defaulting to true. `cameraMoved`/`axisMoved` decide the
      orientation question and `clearRecipe` is the invalidation. Statuses in `get` read
      the entry's `camera` beside the *render's* `mtime`, so an axis-only entry stays a
      miss. Tests: the twelve cells of cache.test.ts's "ThumbCache occlusion renders"
- [x] 1.2 `maintain`: list both PNG files per sidecar as separate LRU candidates; evicting
      `<key>.png` clears the top-level `mtime` and evicting `<key>.noao.png` clears
      `noao.mtime`, each keeping its own recipe labels to ride the stale read (D3);
      the existence sweep removes the sidecar and both PNGs
      <br>2026-08-31 (AOD-A): `maintain`'s candidate list is one row per *render* —
      `{key, ao, …}` — stat'ing both `pngFile(dir, key, ao)`s, so the two PNGs of a model
      sort into the LRU independently. The existing stat-based eviction guard (re-read the
      sidecar, re-stat the PNG, skip on any drift) is applied per file, unchanged in
      substance. Existence sweep and `sweepLegacy` `rm` both PNGs; `migrate` renames both.
      Tests: cache.test.ts "evicts the render nobody has looked at and leaves the other a
      hit" (real `maintain` at a 10-byte cap, not a hand unlink — asserts the evicted
      sibling is `stale` echoing `rig: 3` and `lighting: 'camera'`, the occluded render
      still a hit with `rig: 2`, one PNG left) and "sweeps sidecar and both renders
      together when the model is gone" (3 files before, 0 after)
- [x] 1.3 `app.ts`: `GET /api/thumb` reads `ao` (`on`/`off`, absent = `on`, anything else
      400); `PUT /api/thumb` reads `body.ao` (boolean, absent = `true`, non-boolean 400)
      <br>2026-08-31 (AOD-A): both refuse in the route's existing invalid-field shape
      (`{ error: 'invalid ao: …' }`, 400), beside the axis/lighting/rig validators. The
      PUT check is `typeof body.ao !== 'boolean'` rather than a truthiness read, because
      `false` is a value the route must act on — a string `'off'` read as truthy would
      file unoccluded pixels over the shipped render. Tests: api.test.ts "the occlusion
      dimension" — "rejects an `ao` query that is neither on nor off" and "rejects a
      non-boolean `ao` on a put", both asserting the error body verbatim
- [x] 1.4 Server tests (`cache.test.ts`, `api.test.ts`): a pre-existing entry reads as the
      occluded render with `ao` absent and with `ao=on`; `ao=off` on it is a miss with no camera stored and `stale` with one, carrying camera and axis either way; a PUT with `ao:false` writes the sibling and leaves the occluded
      labels untouched; both hit afterwards; eviction takes the older-read sibling first
      and leaves the other a hit; the existence sweep removes all three files; a
      PUT with a camera beyond tolerance clears the *other* render's labels and leaves the
      written render's alone; a PNG-only PUT, and a PUT re-sending the stored camera
      perturbed by 1e-12, leave the other render a hit with labels intact; a `null` discard with no PNG clears both renders' labels when the entry held a camera, and changes nothing when it held none; after an orbit-release PUT under `off`, a GET
      under `on` is a hit carrying the new camera, its pixels, and no `rig`; a first request of the unoccluded render with a camera stored is `stale` with the camera; a **first-ever** camera on an entry with both renders cached clears the other render's labels
      <br>2026-08-31 (AOD-A): twelve cells in cache.test.ts's "ThumbCache occlusion
      renders" and six in api.test.ts's "the occlusion dimension"; server suite 282 → 300
      passing, nothing pre-existing touched. Every enumerated case has a cell, plus two
      the list did not name: "treats a first-ever axis, and a different axis, as a change
      too" (the axis limb of the rule, including that re-sending the *same* axis moves
      nothing) and "serves the invalidated render its own old pixels and the new camera,
      so the tile never blanks" (why invalidation clears labels rather than `mtime` — it
      asserts the stale-render's own PNG still comes back beside the new camera). The
      eviction cell reads its labels back through a real `maintain` at a 10-byte cap, so
      it discriminates the ruling on 1.2 rather than passing under either reading.
      Falsified, one mutation at a time, each reverted and the suite re-run green:
      neutering the `if (moved)` invalidation fails 5 cells ("expected 2 to be
      undefined"); replacing the `CAMERA_EPSILON` comparisons with `!==` fails exactly
      the tolerance cell ("expected undefined to be 2"); dropping the supersede `rm`
      fails exactly 1.6's cell ("expected [ …(2) ] to deeply equal [ Array(1) ]");
      writing `noao: undefined` on eviction — reading (b) of the 1.2 ambiguity — fails
      exactly the eviction cell ("expected undefined to be 3")
- [x] 1.5 `CAMERA_EPSILON` lives in `shared/` (both workspaces import `shared/types`; the server cannot import `client/src/three/camera.ts`, which needs `three`), with the probe in `client/test/camera.test.ts`: `applyState` → `captureState` round trip, y-frame, bounds pivoted to the origin, 200k random states at each of radius 0.01, 1 and 137 with `target` drawn within the bounding sphere, asserting the maximum per-component drift is at least four orders below the constant (design D2's measurement, made re-runnable)
      <br>2026-08-31 (AOD-A): **shared constant done, probe is the client half's — left
      unticked deliberately.** `CAMERA_EPSILON = 1e-9` is exported from `shared/types.ts`
      beside `CameraState`, carrying the D2 measurement (the fourth reviewer's re-run,
      2026-08-28) in its doc comment and naming `client/test/camera.test.ts` as the probe
      that re-runs it. That file does not exist yet — the comment says the probe is added
      by the client half, so the pointer is not read as a dangling citation. Tick this
      line when the probe lands
      <br>2026-08-31 (AOD-B): probe landed, line ticked. `client/test/camera.test.ts`'s
      "camera round-trip drift (the measurement behind CAMERA_EPSILON)" — two cells: the
      600k-state sweep (200k each at radius 0.01, 1, 137; `applyState` → `captureState`,
      y-frame, bounds pivoted to the origin, `target` filled through the unit ball by
      cube-root radius, `distR` across `ViewerSession`'s own [1.1, 20] dolly clamp, `az`
      wrapped through the `atan2` branch cut) and `DEFAULT_CAMERA`'s own trip, the state
      every unmoved close re-sends. Seeded LCG (`0x5eed`), so the sweep is the same sweep
      every run — a moved number means the camera math moved. **Measured max per-component
      drift 2.1538e-14, worst at radius 1** (AOD-B's run, 2026-08-31, recorded in the
      cell's own comment); the assertion is `CAMERA_EPSILON / 1e4` = 1e-13, so ~4.6× over
      the measurement and ~46000× under the constant. Runs in 0.4 s. Two guards against a
      probe that stops probing: `worst > 0` (a collapsed generator or an identity
      `captureState` would read exactly zero and pass the bound) and the radius that
      produced the worst case being one of the three swept.
      <br>Two corrections to the note above, neither material to the constant: (a)
      `client/test/camera.test.ts` **already existed** — what did not exist was the probe
      in it; (b) this sweep measures **2.2e-14** where `CAMERA_EPSILON`'s doc comment
      quotes **7.1e-15** from the fourth reviewer's 2026-08-28 run. Same order, same
      conclusion, five orders of headroom either way; the gap is the sweeps differing
      (`applyState` rather than `statePosition`, the full dolly clamp, the ball-filled
      target). The test comment records both numbers and why they differ. Left for the
      coordinator: whether the doc comment in `shared/types.ts` should quote the probe's
      own figure — this worker was scoped out of `shared/`
- [x] 1.6 A PNG PUT at a newer mtime deletes the sibling's superseded PNG (and clears its labels' `mtime`), so no render holds pixels of a file that changed; test it
      <br>2026-08-31 (AOD-A): `put`'s `supersedes` — `opts.png !== undefined &&
      theirs.mtime !== undefined && opts.mtime > theirs.mtime` — `rm`s the sibling's PNG
      and empties its labels wholesale (mtime included), so the sibling reads as a miss
      rather than a hit on pixels of a file that is gone. Strictly newer, not merely
      different, and the comment beside it says why: an *equal* mtime is the ordinary
      case of drawing the second render of the same file, and a written mtime *older*
      than the sibling's makes this write the stale one — deleting the sibling's newer
      pixels there would be backwards. Test: cache.test.ts "deletes the sibling's pixels
      when a render is written at a newer mtime", which asserts both limbs (one PNG left
      after the newer write; two still there after re-writing at the same mtime)

## 2. Client: render and look up under the preference (D4)

- [x] 2.1 `three/renderer.ts` `renderThumbnail(object, state, axis, ao = true)` passes `ao`
      to `getThumbChain().render(...)`
      <br>2026-08-31 (AOD-B): the argument is the caller's reading, never a read of its
      own — `renderThumbnail` is called from four sites and each must file its pixels
      under the value it also sent to the cache, so the doc comment says the read belongs
      to the caller that PUTs. `RenderChain.render`'s own comment ("Only the live view
      ever passes false … the cache never sees the preference") asserted the retired
      contract and was rewritten with it. Test: composer.test.ts's "both paths render
      under the same occlusion preference", which reads the GTAO pass's `enabled` off the
      real chain rather than trusting a mocked `renderThumbnail`
- [x] 2.2 `api/client.ts`: `getThumb(path, mtime, ao)` sends `&ao=off` when off — and
      **nothing** when on, so the on-request stays byte-identical to every request this
      client sent before renders were keyed by occlusion; `putThumb` carries `ao`;
      `ThumbSave` gains the field. `ThumbResult` deliberately does **not**: the wire
      carries no echo — the answer is the requested render's (D2), and the merged server's
      `ThumbGetResponse` has no `ao` member. The line as first written said both types
      gained it; corrected here after a coordinator ruling, 2026-08-31 (AOD-B), so it does
      not read as unimplemented
      <br>2026-08-31 (AOD-B): `ThumbResult` carries a comment saying why the field is
      absent — an empty field invites a later reader to populate it from the wrong source,
      and echoing the caller's own argument back would make a second source of truth about
      which render an answer describes. Tests: apiClient.test.ts "getThumb names the
      unoccluded render, and only then" (the off URL verbatim; explicitly-on and
      defaulted-on both byte-identical to the pre-change URL) and "putThumb declares which
      render its pixels are" (`false` survives `JSON.stringify` as a value, not as an
      absent field — absence means occluded, so a dropped `false` would file unoccluded
      pixels over the shipped render)
- [x] 2.3 `hooks/useThumbnails.ts`: read `aoEnabled()` once per entry's load (superseded by
      `ao-refreshes-thumbnails` 1.1, which passes the value from `App.tsx` instead — do not
      restore the internal read when re-reading this line later); request,
      render and PUT under it. The hit test is unchanged — the server answered for the
      requested render. `lib/entryActions.ts`: both re-render commands do the same.
      `App.tsx` `persist` reads `aoEnabled()` **once, before its await** (beside the `state`
      and label it already captures there), passes it into `viewer/session.ts`
      `snapshot(ao)` — which hands it to `renderThumbnail`, not the live chain, the site a
      grep for `aoEnabled` misses — and declares the same value on its PUT; `resetFramingLive` (the fifth `putThumb` site: `null` discard, no PNG) declares `ao` as well
      <br>2026-08-31 (AOD-B): all five sites. `useThumbnails`' load effect reads once at
      the head of the lookup job and carries that one value through `getThumb`,
      `renderThumbnail` and the PUT; the hit test is untouched, since the server answered
      for the render that was asked for. The read carries the comment 2.3 asks for —
      `ao-refreshes-thumbnails` 1.1 replaces it with a value from `App.tsx`, not
      pre-implemented here. Both `entryActions` re-render commands read **after** the
      `queue.whenResumed()` gate, for the reason the cache lookup already sits there: the
      pill is in the corner and stays pressable while a lightbox holds the queue
      suspended, so a toggle made there is already in the value. `refreshThumbnail`'s
      lookup passes `ao` too, which also decides whose LRU clock the read bumps — the
      render about to be rewritten, not its sibling. `resetFramingLive` declares it with a
      comment saying it names the request and nothing else: with no PNG there is no
      written render, and a pixel-less orientation discard invalidates both anyway.
      `ViewerSession.snapshot(ao = true)` takes the value and never reads the store —
      the one place `render` and `snapshot` deliberately differ. `persist` captures it
      beside `state`/`axis` before the await and uses the same value for `snapshot(ao)`
      and the PUT; it reads the **store**, not the pill's React state of the same name,
      so it is not the one site whose recipe comes from a re-render's snapshot
- [x] 2.3a Copy that asserts the old contract goes: the pill's `title` in `App.tsx`
      ("thumbnails keep the shipped recipe") and `viewer/aoToggle.ts`'s module docstring
      ("thumbnails always render the shipped recipe … never see the preference")
      <br>2026-08-31 (AOD-B): both found verbatim and rewritten to the new truth rather
      than deleted — the title now says thumbnails follow the setting and are cached under
      each, and the docstring says every path that draws a model consults it, occlusion
      being a dimension of the key rather than a label on it (so the "no bump, no sweep"
      property the old sentence was defending is stated as still holding). The docstring
      was fixed, not rewritten, since `adaptive-ao-default` 1.2 cites it. Two further
      pieces of the same copy, both approved by the coordinator: `App.tsx`'s JSX comment
      one line above the pill ("Ambient occlusion on/off, **live view only**"), which
      would have contradicted the corrected title beside it, and `RenderChain.render`'s
      doc comment in `three/renderer.ts` (ticked under 2.1), which said in so many words
      that the cache never sees the preference
- [x] 2.4 Client tests: with the preference off, the request carries `ao=off`, the render
      is called with `ao=false`, and the PUT declares `ao:false`; with it on, all three say
      on and the request is byte-identical to before this change; a miss carrying a
      camera renders under that camera; the orbit overlay opened over an unoccluded
      thumbnail renders unoccluded (handoff parity — assert the chain's `ao` on both
      paths); an orbit released with the preference off snapshots through `renderThumbnail`
      with `ao=false` and PUTs `ao:false`; after that PUT the other render reads as a hit with cleared labels
      <br>2026-08-31 (AOD-B): eleven cells across four files; client suite 511 → 523
      passing, `bun run typecheck` clean.
      <br>`thumbnailQueue.test.tsx`, "the sweep follows the occlusion preference" —
      "with the preference off, the lookup, the render and the PUT all name the unoccluded
      render", "with the preference on, all three name the occluded render", and "a first
      look at the unoccluded render of an oriented model draws under the stored camera"
      (the enumerated *miss carrying a camera*, written as the `stale`-with-camera the
      server actually answers for a never-written render of an oriented entry — and it
      also pins that the PUT sends pixels only, which is what keeps it from invalidating
      the sibling just toggled away from).
      <br>`apiClient.test.ts` — the two cells named under 2.2. Byte-identity of the
      on-request lives here rather than in the hook's file: the hook can only say which
      render it asked for; the URL is the ApiClient's contract.
      <br>`composer.test.ts`, "both paths render under the same occlusion preference" —
      handoff parity asserted on the **chains**, not on the callers: over the file's
      existing fake `WebGLRenderer` the real chains are built, so the GTAO pass's own
      `enabled` answers "was this render occluded". Three cells: off (tile and overlay
      both unoccluded), on (both occluded — the shipped recipe unchanged), and "a
      session's snapshot draws under the value handed to it, never a read of its own",
      which is asserted with the store set the *other* way — the only way to tell a passed
      value from a fresh read.
      <br>`persistPut.test.tsx`, "the persist PUT names one occlusion render" — "an orbit
      released with the preference off snapshots and files the unoccluded render"
      (`snapshot` receives `false`, the PUT declares `ao:false`, **and carries the camera
      and axis**) and "reads the preference once: a toggle mid-snapshot cannot split the
      pixels from their slot", which moves the preference from inside the stubbed
      `snapshot` — i.e. during the await `persist` holds across — and requires the PUT to
      still carry the captured value.
      <br>**The enumerated "after that PUT the other render reads as a hit with cleared
      labels" is deliberately not faked here.** It is a server behaviour and is asserted
      in `server/test/cache.test.ts` (1.4's cells); a mocked `ApiClient` could only
      round-trip whatever this file told it to, so the client cell asserts the half the
      client is responsible for — the PUT carries the camera *and* `ao:false`, which is
      what makes the invalidation the server's to perform. Said in the cell's own comment,
      not only here.
      <br>Falsified one mutation at a time, each reverted and re-run green:
      `renderThumbnail` hardcoding `chain.render(…, true)` fails exactly the two
      composer cells that assert an unoccluded render ("expected true to be false"); a
      `persist` that reads `aoEnabled()` a second time for its PUT fails exactly the
      single-read cell ("expected true to be false"); dropping the `&ao=off` append fails
      exactly the apiClient off-cell ("expected 'spy' to be called with arguments: [
      Array(1) ]"); `useThumbnails` reading a hardcoded `true` instead of the preference
      fails both off-cells in the sweep's describe ("expected 'spy' to be called with
      arguments: [ '/models/m0.stl', 1, false ]").
      <br>Pre-existing cells updated, not rewritten, where the new field widened an
      exact-match assertion: nine `renderThumbnail` positional assertions and one
      `getThumb` assertion in `thumbnailCommands.test.ts`, and the two whole-body
      `putThumb` assertions in `viewerPanelActions.test.tsx` (`ao: true`, with the
      comment saying it only names the request there)

## 3. Docs and verification

- [x] 3.1 `CLAUDE.md` architecture line "Any change that alters thumbnail pixel output …
      must bump RIG_VERSION" gains: a new recipe *dimension* is a new key, not a bump
      — done 2026-08-31 (coordinator)
- [x] 3.2 `docs/web-demo-notes.md` item 8: mark the two-variant cache as drafted here; the
      demo bake runs the sweep under each preference (deployment change)
      — done 2026-08-31 (coordinator): the "Design that falls out" passage names this
      change and the per-preference bake sweep
- [x] 3.3 Archive dry run on a fresh copy in order: `library-root`, `remove-axis-lighting`,
      this — the `model-viewer` MODIFIED must carry all seven scenario titles
      — done 2026-08-31 (coordinator): `library-root` archived for real (`7a872c7`), so the
      fresh-copy run was `remove-axis-lighting` → this → `ao-refreshes-thumbnails`, all
      three archiving cleanly in order (the /opsx:update verification's run, same day)
- [ ] 3.4 `bun run test` / `bun run typecheck` clean; live: with the pill off, visit a
      directory — every tile renders once and PUTs `ao:false`; toggle on — hits, no PUTs;
      toggle off again — hits, no PUTs; press a tile in each state — no shading change at
      handoff; `ls ~/.cache/model-browser/<id>/` shows `<key>.png` and `<key>.noao.png`
      pairs
