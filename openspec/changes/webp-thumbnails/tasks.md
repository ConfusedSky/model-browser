## 1. Render and store WebP

- [x] 1.1 `renderThumbnail` encodes `toBlob('image/webp', THUMB_QUALITY)` with
      `THUMB_SIZE = 256` and `THUMB_QUALITY = 0.8`, and the chain docstrings stop
      naming 512² (`client/src/three/renderer.ts`)
- [x] 1.2 `RIG_VERSION` 6 → 7, with the version list saying what 7 is (D3)
- [x] 1.3 The client revives a base64 render as an `image/webp` blob
      (`base64ToBlobUrl`, `client/src/api/client.ts`)
- [x] 1.4 The store names renders `<key>.webp` / `<key>.noao.webp` (`ThumbCache`'s
      `pngFile`, `server/src/cache.ts`)
- [ ] 1.4a Rename that method to say `render`, not `png`, since the wire field keeps the
      legacy name and the two should not read alike (D4) — **not done**: the extension
      flipped, the name did not
- [x] 1.5 The image route types its answer `image/webp` (`server/src/app.ts`)

## 2. Reclaim what the bump strands

- [ ] 2.1 Delete any stored render whose name is in a superseded encoding (`<key>.png`,
      `<key>.noao.png`) at **every** place the store already visits an entry: a write
      (the `png: null` deletion included), a stale re-render, `maintain`'s source-vanished
      sweep, and both halves of `migrate` — its duplicate drop and its **rename** (D5).
      The write path alone leaves a deleted model's render leaking forever; the rename is
      worse than a leak, since it moves pixels by the current name and so strands a legacy
      flat cache's `.png` files while migrating their sidecars, quietly breaking
      *Server-side thumbnail persistence*'s "images intact". There is no `clear` method —
      an earlier draft of this task invented one
- [ ] 2.2 The bounded cache's size accounting counts a superseded render as evictable
      weight rather than ignoring it — today `maintain` builds its metas from the current
      extension only, so the orphan is outside the size cap and can never be an eviction
      candidate
- [ ] 2.3 Test: an entry holding a superseded file is re-rendered, the old file is gone,
      and the measured cache size drops by its bytes
- [ ] 2.4 Test: a model whose file is gone takes its superseded render with it through
      `maintain`'s sweep, not just its current one

## 3. Verify the encoder, not just the constant

- [ ] 3.1 Test that a browser-encoded thumbnail keeps full transparency outside the
      silhouette and full opacity inside it. **Chrome is already measured** (a parallel
      session, 2026-09-07: 0 alpha mismatches over 631 partial-alpha pixels at q0.8 —
      D1), on a synthetic disc; what is left is the same assertion on a real model render,
      and any statement at all about WebKit and Gecko — the `model-viewer` scenario this change
      adds. `canvas.toBlob('image/webp', q)` is the encoder under test; happy-dom does
      not encode, so this belongs where a real canvas exists (Playwright), and the
      existing occlusion transparency check is the model to follow
- [ ] 3.1a **`canvas.toBlob` falls back to PNG when the type is unsupported** (the HTML
      spec's behaviour; WebKit has shipped it). A Safari client would upload 256² *PNG*
      bytes, which this store would file as `<key>.webp` and serve as `image/webp` —
      tiles still draw, since browsers sniff, but the bytes are several times the budget
      and the spec's encoding requirement is violated with nothing detecting it.
      `renderThumbnail` never inspects `blob.type`. Decide and implement: refuse, record
      the encoding, or accept knowingly — and say which in design
- [ ] 3.2 Record the *browser*-encoded average size against the `cwebp` figures in D1,
      on the same corpus, and correct D1 if they diverge by more than ~25% — the design
      names cwebp's numbers and says so, and a spec should not rest on a proxy encoder
      once the real one can be measured

## 4. Sweep the assertions and the prose

- [x] 4.1 Server tests asserting `.png` names and `image/png` updated
      (`server/test/api.test.ts`, `server/test/cache.test.ts`)
- [x] 4.2 The deliberate rig-version guard updated to 7 (`client/test/rig.test.ts`)
- [x] 4.3 `CLAUDE.md`'s thumbnail constraint says `THUMB_SIZE`² WebP, notes the store
      and wire still say `png`, and the `.noao` example names the current extension
- [ ] 4.4a `LIVE_SUPERSAMPLE` in `client/src/viewer/renderSize.ts` is justified by a
      premise this change inverts — it matches the live view's sample density to "a 512²
      thumbnail in a ~176 px tile, supersampled for free". At 256² the thumbnail is the
      softer of the two, so the comment is not merely stale but backwards, and the
      handoff it tunes needs judging at DPR 2 (5.1)
- [x] 4.4 Grep both workspaces for surviving "PNG"/"512" in comments and docstrings that
      now describe pixels this app does not produce — **with `grep -a`**, since
      `server/src/app.ts` holds NUL bytes and plain grep silently reports nothing there.
      Swept 2026-09-07: `thumbImageUrl`'s docstring, `ThumbCache`'s header comment,
      `session.ts`'s rest-state comment and `Grid.tsx`'s box comment. `renderSize.ts` and
      `ViewerLayer`'s `renderNow` comment were left deliberately — their 512² is a
      premise, not a label, and 4.4a is where it gets judged

## 5. Judge it in the app, then freeze

- [ ] 5.1 Visual pass at DPR 1 and DPR 2 on a real listing — **DPR 1 reported clean by
      Masa** (live view against thumbnail, no visible colour difference, 2026-09-07),
      which leaves DPR 2, the case D2 accepts rather than fixes — tiles, a folder contact
      sheet, and the handoff from tile to live view — accepting or overturning D2's
      choice of 256 over 320. Not done when the code lands; done when the pixels are
      judged
- [ ] 5.2 Re-measure a cold first screen — **stating the tile count**, since the
      2026-09-05 pair in the notes compared a 62-tile screen with a 114-tile one against the figures in `docs/web-demo-notes.md`
      (baked-PNG 9.62 MB / 4.4 s over the ocean) and record the WebP numbers beside them

## 6. Land it

- [ ] 6.1 `bun run typecheck` and both suites green
- [ ] 6.2 `openspec validate webp-thumbnails --strict`, then archive with a dry run first
      (`T=$(mktemp -d); cp -r openspec $T/; (cd $T && openspec archive webp-thumbnails --yes)`)
- [ ] 6.3 After archiving, read `openspec/specs/model-thumbnails/spec.md` and check no
      change-scoped prose landed in the capability's own description
