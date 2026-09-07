## 1. Render and store WebP

- [x] 1.1 `renderThumbnail` encodes `toBlob('image/webp', THUMB_QUALITY)` with
      `THUMB_SIZE = 256` and `THUMB_QUALITY = 0.8`, and the chain docstrings stop
      naming 512² (`client/src/three/renderer.ts`)
- [x] 1.2 `RIG_VERSION` 6 → 7, with the version list saying what 7 is (D3)
- [x] 1.3 The client revives a base64 render as an `image/webp` blob
      (`base64ToBlobUrl`, `client/src/api/client.ts`)
- [x] 1.4 The store names renders `<key>.webp` / `<key>.noao.webp` (`ThumbCache`'s
      `renderFile`, `server/src/cache.ts` — named `pngFile` when this task was written)
- [x] 1.4a Renamed to `renderFile` (19 call sites), so the store's own name stops saying
      PNG while the wire field keeps that legacy name deliberately (D4)
- [x] 1.5 The image route types its answer `image/webp` (`server/src/app.ts`)

## 2. Reclaim what the bump strands

- [x] 2.1 Delete any stored render whose name is in a superseded encoding (`<key>.png`,
      `<key>.noao.png`) at **every** place the store already visits an entry: a write
      (the `png: null` deletion included), a stale re-render, `maintain`'s source-vanished
      sweep, and both halves of `migrate` — its duplicate drop and its **rename** (D5).
      The write path alone leaves a deleted model's render leaking forever; the rename is
      worse than a leak, since it moves pixels by the current name and so strands a legacy
      flat cache's `.png` files while migrating their sidecars, quietly breaking
      *Server-side thumbnail persistence*'s "images intact". There is no `clear` method —
      an earlier draft of this task invented one
- [x] 2.2 Resolved by 2.1 rather than as written: `maintain`'s per-render pass now
      removes a superseded file before it stats the current one, so the orphan is gone by
      the end of the pass that would otherwise have had to weigh it. Nothing outside the
      size cap survives a maintenance run, which is a stronger property than counting it
- [x] 2.3 Tests (`cache.test.ts`, "a superseded encoding leaves no stored bytes behind"):
      a write reclaims the render it replaces and the maintenance pass reclaims the sibling;
      a sidecar left under the old recipe with only superseded pixels comes back `stale`
      with nothing stranded
- [x] 2.4 Tests: a deleted model takes its superseded render with it, and re-filing a
      flat entry leaves no `.png` behind while its camera and axis arrive

## 3. Verify the encoder, not just the constant

- [x] 3.1 **Verified on a real model render, live** (2026-09-07, a browser-encoded 256²
      WebP fetched back from the demo box's image route and decoded): 54,061 fully
      transparent pixels, 6,858 fully opaque, 4,617 partial — the anti-aliased edge
      survived the encoder — and all four corners transparent. With the parallel session's
      synthetic-disc run (0 alpha mismatches over 631 partial-alpha pixels), Chrome's
      alpha handling is settled on both a contrived worst case and a real render
- [x] 3.1b Chosen: **a probe script**, `scripts/encoder-probe.mjs` — one command, no CI
      weight, its last run in its own docstring. It checks the encoder alone (an alpha ramp
      and an anti-aliased disc through `toBlob`, so a silent PNG fallback or lossy alpha
      fails there) and, given a running app, the render the pipeline actually stored. The
      two alternatives, and why not:
      - **A harness** (declined for now). Vitest browser mode with a Playwright provider, as a second project
        beside the 60 happy-dom files. The cell renders through `renderThumbnail` with a
        real `WebGLRenderer`, encodes, decodes and censuses alpha. Cost: browser binaries
        in CI, software rendering, and a suite that runs in two places. It only pays for
        itself if the two `model-viewer` occlusion transparency scenarios and future
        `RIG_VERSION` bumps come along, since **nothing in this repo has ever asserted a
        real pixel** — `composer.test.ts` and `thumbnailTeardown.test.ts` mock
        `WebGLRenderer` away, so those occlusion scenarios were verified by hand too.
      - **A recorded manual check** (declined): what the occlusion scenarios have today,
        and the thing a script this small makes unnecessary.
      Whichever is chosen, nothing about WebKit or Gecko is measured either way — 3.1a
      drops their renders rather than trusting them — the `model-viewer` scenario this change
      adds. `canvas.toBlob('image/webp', q)` is the encoder under test; happy-dom does
      not encode, so this belongs where a real canvas exists (Playwright), and the
      existing occlusion transparency check is the model to follow
- [x] 3.1a **`canvas.toBlob` falls back to PNG when the type is unsupported** (the HTML
      spec's behaviour; WebKit has shipped it). A Safari client would upload 256² *PNG*
      bytes, which this store would file as `<key>.webp` and serve as `image/webp` —
      tiles still draw, since browsers sniff, but the bytes are several times the budget
      and the spec's encoding requirement is violated with nothing detecting it.
      Decided and implemented as **drop the render, keep the rest of the write** (D6): `putThumb` drops a write whose blob is
      not `THUMB_MIME`, which is now the single shared constant the encoder request, the
      refusal and the image route's content type all read
- [x] 3.2 Browser-encoded sizes measured on the corpus (2026-09-07, demo box, headless
      Chromium, 40 native 256² renders): **avg 5.6 KB, median 5.5, range 2.2–7.6**, against
      the cwebp proxy's 4.5 KB — +24%, inside the bar this task set, so D1's figures stand
      with the real numbers recorded beside them

## 4. Sweep the assertions and the prose

- [x] 4.1 Server tests asserting `.png` names and `image/png` updated
      (`server/test/api.test.ts`, `server/test/cache.test.ts`)
- [x] 4.2 The deliberate rig-version guard updated to 7 (`client/test/rig.test.ts`)
- [x] 4.3 `CLAUDE.md`'s thumbnail constraint says `THUMB_SIZE`² WebP, notes the store
      and wire still say `png`, and the `.noao` example names the current extension
- [x] 4.4a `LIVE_SUPERSAMPLE` keeps its value and loses its old justification. The premise
      was 512² in a ~176 px tile — 1.45 samples per device pixel at DPR 2, so the tile was
      supersampled and the live view was the more aliased surface. At 256² it is 0.80 at
      DPR 2, so matching the tile would mean supersampling *below* device resolution. The
      factor stands on the shading-aliasing argument that never depended on thumbnails,
      and the handoff mismatch now runs the safe way round: a model sharpens when the user
      takes hold of it
- [x] 4.4 Grep both workspaces for surviving "PNG"/"512" in comments and docstrings that
      now describe pixels this app does not produce — **with `grep -a`**, since
      `server/src/app.ts` holds NUL bytes and plain grep silently reports nothing there.
      Swept 2026-09-07: `thumbImageUrl`'s docstring, `ThumbCache`'s header comment,
      `session.ts`'s rest-state comment and `Grid.tsx`'s box comment. `renderSize.ts` and
      `ViewerLayer`'s `renderNow` comment were left deliberately — their 512² is a
      premise, not a label, and 4.4a is where it gets judged

## 5. Judge it in the app, then freeze

- [x] 5.1 Judged (2026-09-07, headless Chromium at both ratios against the demo box, and
      Masa on the live app at DPR 1). DPR 1 clean. DPR 2 is a **1.41x upscale** in the
      181 px tile measured — soft on fine detail, sound on silhouette and material —
      and **accepted**: the tile is a browsing affordance, the lightbox is a live render,
      and 320² would not fix it anyway in a grid whose tiles stretch (D2) — tiles, a folder contact
      sheet, and the handoff from tile to live view — accepting or overturning D2's
      choice of 256 over 320. Not done when the code lands; done when the pixels are
      judged
- [x] 5.2 Cold screen re-measured with browser-encoded renders and its **tile count
      stated**: 39 tiles of one kit, served `image/webp` from the image route, **216 KB in
      1.39 s** from the US. Not the 114-tile root screen the 2026-09-05 figures used — that
      one still holds cwebp-converted renders, and mixing encoders in one total is the
      error those figures already made once against the figures in `docs/web-demo-notes.md`
      (baked-PNG 9.62 MB / 4.4 s over the ocean) and record the WebP numbers beside them

## 6. Land it

- [x] 6.1 `bun run typecheck` and both suites green (810 client, 638 server)
- [x] 6.2 `openspec validate webp-thumbnails --strict` passes and the archive dry run on a
      fresh copy applies cleanly (+1 added, ~5 modified). The archive itself is 6.3's
- [ ] 6.3 After archiving, read `openspec/specs/model-thumbnails/spec.md` and check no
      change-scoped prose landed in the capability's own description
