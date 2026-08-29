# Tasks — ao-as-recipe-dimension

> Ordering (hard): after `library-root` (its cache migration moves every file of a key —
> `<key>.*` — which covers the sibling this adds; confirm its 3.2 does so before applying)
> and after `remove-axis-lighting` (sibling requirement in `model-viewer`, and the
> lighting mode this delta stops mentioning). Before `ao-refreshes-thumbnails` (formerly `lighting-refreshes-thumbnails`) is
> re-targeted (this is the dimension it will refresh) and before `adaptive-ao-default`.
> Re-read `cache.ts`, `app.ts`, `renderer.ts`, `useThumbnails.ts`, `entryActions.ts`
> against main before starting.

> No `RIG_VERSION` bump (design D5). A test asserting the version spreads the real
> module.

## 1. Server: the sibling render (D1, D2, D3)

- [ ] 1.1 `ThumbCache`: `get(path, mtime, ao)` — `ao` selects `<key>.png` + top-level
      labels or `<key>.noao.png` + the sidecar's `noao` labels; status is for that render;
      `camera`/`axis` returned on every status. `put(path, { ao, png, … })` writes the
      selected render and its labels, and **clears the other render's `mtime` label whenever
      the PUT carries a PNG, a camera, or an axis** (D2: one camera, two renders); a
      label-only PUT touches neither render
- [ ] 1.2 `maintain`: list both PNG files per sidecar as separate LRU candidates; evicting
      `<key>.png` clears the top-level `mtime`, evicting `<key>.noao.png` clears `noao`;
      the existence sweep removes the sidecar and both PNGs
- [ ] 1.3 `app.ts`: `GET /api/thumb` reads `ao` (`on`/`off`, absent = `on`, anything else
      400); `PUT /api/thumb` reads `body.ao` (boolean, absent = `true`, non-boolean 400)
- [ ] 1.4 Server tests (`cache.test.ts`, `api.test.ts`): a pre-existing entry reads as the
      occluded render with `ao` absent and with `ao=on`; `ao=off` on it is a miss carrying
      camera and axis; a PUT with `ao:false` writes the sibling and leaves the occluded
      labels untouched; both hit afterwards; eviction takes the older-read sibling first
      and leaves the other a hit; the existence sweep removes all three files; a
      camera-only PUT marks the *other* render stale and leaves the written render's labels
      alone; a label-only PUT changes nothing; after an orbit-release PUT under `off`, a GET
      under `on` is `stale` carrying the new camera

## 2. Client: render and look up under the preference (D4)

- [ ] 2.1 `three/renderer.ts` `renderThumbnail(object, state, axis, ao = true)` passes `ao`
      to `getThumbChain().render(...)`
- [ ] 2.2 `api/client.ts`: `getThumb(path, mtime, ao)` sends `&ao=on|off`; `putThumb`
      carries `ao`; `ThumbResult`/`ThumbSave` gain the field
- [ ] 2.3 `hooks/useThumbnails.ts`: read `aoEnabled()` once per entry's load; request,
      render and PUT under it. The hit test is unchanged — the server answered for the
      requested render. `lib/entryActions.ts`: both re-render commands do the same.
      `viewer/session.ts` `snapshot()` passes `aoEnabled()` to `renderThumbnail` (it does
      not use the live chain — the site a grep for `aoEnabled` misses), and `App.tsx`
      `persist` declares `ao` on its PUT
- [ ] 2.3a Copy that asserts the old contract goes: the pill's `title` in `App.tsx`
      ("thumbnails keep the shipped recipe") and `viewer/aoToggle.ts`'s module docstring
      ("thumbnails always render the shipped recipe … never see the preference")
- [ ] 2.4 Client tests: with the preference off, the request carries `ao=off`, the render
      is called with `ao=false`, and the PUT declares `ao:false`; with it on, all three say
      on and the request is byte-identical to before this change; a miss carrying a
      camera renders under that camera; the orbit overlay opened over an unoccluded
      thumbnail renders unoccluded (handoff parity — assert the chain's `ao` on both
      paths); an orbit released with the preference off snapshots through `renderThumbnail`
      with `ao=false` and PUTs `ao:false`; after that PUT the other render reads `stale`

## 3. Docs and verification

- [ ] 3.1 `CLAUDE.md` architecture line "Any change that alters thumbnail pixel output …
      must bump RIG_VERSION" gains: a new recipe *dimension* is a new key, not a bump
- [ ] 3.2 `docs/web-demo-notes.md` item 8: mark the two-variant cache as drafted here; the
      demo bake runs the sweep under each preference (deployment change)
- [ ] 3.3 Archive dry run on a fresh copy in order: `library-root`, `remove-axis-lighting`,
      this — the `model-viewer` MODIFIED must carry all seven scenario titles
- [ ] 3.4 `bun run test` / `bun run typecheck` clean; live: with the pill off, visit a
      directory — every tile renders once and PUTs `ao:false`; toggle on — hits, no PUTs;
      toggle off again — hits, no PUTs; press a tile in each state — no shading change at
      handoff; `ls ~/.cache/model-browser/<id>/` shows `<key>.png` and `<key>.noao.png`
      pairs
