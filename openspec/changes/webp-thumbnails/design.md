## Context

`renderThumbnail` has produced 512² PNGs since the first version of the app, when a
thumbnail was only ever read from the disk that wrote it. Two things changed. The
public demo (`docs/web-demo-notes.md`) put the same renders across an ocean, where a
first screen of ~114 tiles cost 9.6 MB and dominated everything else on the page —
ten times the JS bundle. And `thumbnail-image-serving` made the pixels a URL a browser
fetches directly, so their size is now a network cost on every cold visit rather than
a disk cost paid once.

## Goals / Non-Goals

- **Goal**: cut the bytes a thumbnail costs by an order of magnitude, without changing
  what a thumbnail looks like at the size it is drawn.
- **Goal**: leave no unreachable files behind on the caches that already exist.
- **Non-goal**: per-display or per-tile variants (a `srcset` of sizes). One render per
  recipe is what the cache key, the render queue and the jobs in `thumbnail-jobs` are
  built on; a size dimension would touch all three.
- **Non-goal**: re-encoding stored PNGs in place. They are re-rendered, which is the
  mechanism the recipe version already provides.

## Decisions

### D1: WebP at quality 0.8, alpha lossless

Measured on the demo corpus, 60 renders, `cwebp -q 80 -alpha_q 100`:

| encoding | average |
|---|---|
| 512² PNG (today) | 87 KB |
| 512² WebP q0.8 | 10 KB |
| **256² WebP q0.8** | **4 KB** |

The format is worth 8.6× on its own; the size adds ~2.4× on top. Quality 0.8 is the
knee: q0.9 at 256² measured 6 KB for no difference a tile shows. Alpha is kept
lossless because the silhouette against a transparent background *is* the thumbnail's
shape — `model-viewer`'s occlusion requirement asserts exactly that edge, and a lossy
alpha would fringe it.

**Every figure in that table is a proxy, and no number in this change was produced by
the code it justifies.** They are `cwebp`'s encoder over *downscaled 512² renders*, not
`canvas.toBlob('image/webp', 0.8)` over native 256² ones — two differences, each pointing
the same way: a resampled image carries less high-frequency detail than a native render of
the same size, and libwebp through Skia is not libwebp through the CLI. The population
figure from the demo box (2,254 files, 4.5 KB average, 208 MB → 9.9 MB) is that same proxy
at scale, not independent confirmation. Treat the order of magnitude as established and the
digits as provisional until task 3.2 measures the real encoder; the transparency scenario
added to `model-viewer` pins the alpha half of it.

The measurement that is *not* a proxy: the tile sizes in D2, and that a browser fetching
these bytes over a transatlantic link received 5 KB per thumbnail where it had received
86 KB (2026-09-05, `docs/web-demo-notes.md`).

### D2: 256², with the high-density case declined rather than missed

A model tile draws at ~161 CSS px and a contact-sheet cell at ~79 (measured in the
running app, 2026-09-05). At device-pixel-ratio 1 a 256² render is more than enough;
at 2 a tile wants 322, so 256 is visibly soft on a retina display. 320² was the
obvious answer and is declined: it costs ~50% more bytes on every visit from every
display to sharpen one class of display, and the alternative — two stored sizes — is
the size dimension this change lists as a non-goal. If high-density sharpness later
outranks bytes, the change is one constant and a recipe bump, which is cheap precisely
because this change makes size part of the recipe version.

### D3: A recipe bump, not a new key dimension

`ao-as-recipe-dimension` added `.noao` renders as a *dimension* — a new key beside the
old one — because it changed no existing render's pixels. This does: every stored
render is a different image from what the app now produces, at a different size. So it
is a `RIG_VERSION` bump (6 → 7), and the existing staleness path re-renders each entry
on the visit that finds it, keeping camera and axis. Cache keys are untouched.

### D4: The wire field stays `png`

The PUT and GET bodies carry the render base64 under a field named `png`, and it now
carries WebP. Renaming it would touch `shared/types`, both sides of the API, every
test that builds a body, and the drafted changes that reference it, to say something
the `Content-Type` already says. The name is legacy for "the pixels", and is
documented as such where it is declared. A rename belongs with a wire change that has
its own reason.

### D5: Reclaim the superseded file wherever the store already visits the entry

The reason a superseded render cannot simply be left is the bounded cache: `maintain`
builds its list of renders from the current extension, so it measures and evicts only
files it can name. A `<key>.png` beside a `<key>.webp` is outside the size cap, is never
an eviction candidate, and — the part a write-path-only rule misses — is not taken by the
sweep that removes a render whose model has been deleted either. It would outlive the
model it depicts. On the corpus measured that is 208 MB per library, and it would never
come back.

So removal happens at every point the store already has the entry in hand: a write, a
stale re-render, `maintain`'s source-vanished sweep, `migrate`'s duplicate drop, and
`clear`. What is deliberately *not* added is a startup migration pass over libraries
nothing has asked for — every one of those call sites is already reading that entry for
its own reasons.

## Risks / Trade-offs

- **One-time re-render on first visit after upgrade.** Unavoidable with a recipe bump,
  and paced by the existing queue. A large library browsed once will spend renderer
  time it did not expect; `thumbnail-jobs` is the tool for doing it deliberately.
- **Softness at DPR 2**, accepted in D2 and visible to a retina user.
- **`canvas.toBlob` silently falls back to PNG on an unsupported type** — the HTML
  spec's own rule, and WebKit has shipped exactly that. A client whose browser will not
  encode WebP uploads PNG bytes, which this store files under `<key>.webp` and the image
  route types `image/webp`. Tiles still draw, because browsers sniff images rather than
  trusting the declared type, so the failure is silent: the entry costs several times its
  byte budget and this change's encoding requirement is violated with nothing detecting
  it. `renderThumbnail` does not inspect `blob.type` today. Task 3.1a decides between
  refusing such a write, recording the encoding per entry, and accepting it knowingly —
  the store's one-name-per-recipe shape is what makes "record it" more than a one-liner.
- **Browser encoder variance** even where WebP is produced: Chrome, Firefox and Safari
  differ in method, chroma handling and alpha defaults. The stored bytes are whatever the
  writing browser produced, which was already true of PNG but mattered less when the
  format was lossless.
- **Old clients against a new server**: a client from before this change would receive
  WebP bytes under a field named `png` and an `image/webp` content type. Browsers
  decode by sniffing and content type, not by field name, so a tile still draws; a
  hypothetical non-browser consumer would not.
