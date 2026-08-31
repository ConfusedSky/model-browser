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
- [ ] 1.5 `CAMERA_EPSILON` lives in `shared/` (both workspaces import `shared/types`; the server cannot import `client/src/three/camera.ts`, which needs `three`), with the probe in `client/test/camera.test.ts`: `applyState` → `captureState` round trip, y-frame, bounds pivoted to the origin, 200k random states at each of radius 0.01, 1 and 137 with `target` drawn within the bounding sphere, asserting the maximum per-component drift is at least four orders below the constant (design D2's measurement, made re-runnable)
      <br>2026-08-31 (AOD-A): **shared constant done, probe is the client half's — left
      unticked deliberately.** `CAMERA_EPSILON = 1e-9` is exported from `shared/types.ts`
      beside `CameraState`, carrying the D2 measurement (the fourth reviewer's re-run,
      2026-08-28) in its doc comment and naming `client/test/camera.test.ts` as the probe
      that re-runs it. That file does not exist yet — the comment says the probe is added
      by the client half, so the pointer is not read as a dangling citation. Tick this
      line when the probe lands
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

- [ ] 2.1 `three/renderer.ts` `renderThumbnail(object, state, axis, ao = true)` passes `ao`
      to `getThumbChain().render(...)`
- [ ] 2.2 `api/client.ts`: `getThumb(path, mtime, ao)` sends `&ao=on|off`; `putThumb`
      carries `ao`; `ThumbResult`/`ThumbSave` gain the field
- [ ] 2.3 `hooks/useThumbnails.ts`: read `aoEnabled()` once per entry's load (superseded by
      `ao-refreshes-thumbnails` 1.1, which passes the value from `App.tsx` instead — do not
      restore the internal read when re-reading this line later); request,
      render and PUT under it. The hit test is unchanged — the server answered for the
      requested render. `lib/entryActions.ts`: both re-render commands do the same.
      `App.tsx` `persist` reads `aoEnabled()` **once, before its await** (beside the `state`
      and label it already captures there), passes it into `viewer/session.ts`
      `snapshot(ao)` — which hands it to `renderThumbnail`, not the live chain, the site a
      grep for `aoEnabled` misses — and declares the same value on its PUT; `resetFramingLive` (the fifth `putThumb` site: `null` discard, no PNG) declares `ao` as well
- [ ] 2.3a Copy that asserts the old contract goes: the pill's `title` in `App.tsx`
      ("thumbnails keep the shipped recipe") and `viewer/aoToggle.ts`'s module docstring
      ("thumbnails always render the shipped recipe … never see the preference")
- [ ] 2.4 Client tests: with the preference off, the request carries `ao=off`, the render
      is called with `ao=false`, and the PUT declares `ao:false`; with it on, all three say
      on and the request is byte-identical to before this change; a miss carrying a
      camera renders under that camera; the orbit overlay opened over an unoccluded
      thumbnail renders unoccluded (handoff parity — assert the chain's `ao` on both
      paths); an orbit released with the preference off snapshots through `renderThumbnail`
      with `ao=false` and PUTs `ao:false`; after that PUT the other render reads as a hit with cleared labels

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
