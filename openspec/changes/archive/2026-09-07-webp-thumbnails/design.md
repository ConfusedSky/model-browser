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

**The real encoder is now measured, and the table survives it** (this session, 2026-09-07,
on the demo box: one kit's 43 cache entries deleted, the listing opened in headless
Chromium so the client re-rendered and uploaded them, then the stored files measured).
Forty native 256² renders through `canvas.toBlob('image/webp', 0.8)`: **average 5.6 KB,
median 5.5, range 2.2–7.6**, all with `RIFF`/`WEBP` magic. That is ~24% above the 4.5 KB
the cwebp proxy predicted for the same corpus — inside the ~25% bar task 3.2 set for
leaving D1's figures alone, and in the direction the design expected, since a native
render carries detail a downscale threw away. Read against 87 KB of PNG the ratio is
~16x rather than ~19x. Fetched back over the ocean, 39 tiles of that kit cost **216 KB,
5.5 KB each, in 1.39 s**.

**The alpha half is now measured on the real encoder** (a parallel session's run,
2026-09-07, headless Chromium 149 via playwright-core, synthetic 256² anti-aliased grey
disc with a 3 px saturated red stroke on transparency, round-tripped through
`canvas.toBlob('image/webp', q)` and decoded back): at q0.8, **0 alpha mismatches across
631 partial-alpha pixels** and no transparent pixel became non-zero — so Chrome's default
alpha handling is lossless, as this decision assumed. Bytes were 3,956 at q0.8 and 4,830
at q0.9 against 10,552 for the same canvas as PNG. Maximum RGB error on opaque pixels was
51, which is 4:2:0 chroma subsampling meeting a worst case — a thin saturated stroke — and
Masa reports no visible colour difference between live view and thumbnail in the app at
DPR 1. A real model render was then checked the same way (this session, 2026-09-07, a stored
render fetched back through the image route and decoded): 54,061 fully transparent pixels,
6,858 fully opaque, 4,617 partial, four transparent corners — the silhouette's
anti-aliased edge survives the encoder on real geometry, not just on a contrived disc.
Chrome is settled. WebKit and Gecko are not measured at all; D6 refuses their writes
rather than trusting them.

### D2: 256², with the high-density case declined rather than missed

A model tile draws at ~161 CSS px in the layout measured, and a contact-sheet cell at
~79. At device-pixel-ratio 1 a 256² render covers both outright. At 2 it does not: the
tile was measured again at 181 CSS px in a wider viewport, which is 362 device pixels
against a 256 px source — a **1.41x upscale**, visible as softness on fine detail
(a sculpt's spine ridges, a tail's taper) while the silhouette, the shading and the
material still read.

320² was the obvious answer and is declined, for two reasons rather than the one this
decision first gave. It costs ~50% more bytes on every visit from every display to
sharpen one class of display. And it does not actually fix the case: the grid is
`minmax(11rem, 1fr)`, so tiles stretch with the viewport — 320 covers a 161 px tile at
DPR 2 exactly and the 181 px tile measured here not at all (0.88x). No fixed size covers
every layout, so the choice is between accepting some upscaling and storing several
sizes, and storing several sizes is the size dimension this change lists as a non-goal.

The judgment (2026-09-07, headless Chromium at both ratios, a real listing): accepted.
The tile is a browsing affordance and the lightbox is a live render, so the surface a
user studies is never the upscaled one. If that is overturned later, it is one constant
and a recipe bump — cheap precisely because this change makes size part of the recipe
version.

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

So removal happens at every point the store already has the entry in hand: a write
(including the pixel deletion a `png: null` write performs, which the reset job uses),
a stale re-render, the legacy flat sweep, and both halves of `migrate` — its duplicate
drop *and* its rename. The rename is the one a write-path rule misses entirely and the
one with a second failure of its own: it moves pixels by the current name, so a legacy
flat cache migrates its sidecars while its `.png` files stay flat forever, and
*Server-side thumbnail persistence*'s promise about migration silently stops holding.

`maintain` is the sweep that reaches everything else, and it takes the superseded names
from the directory listing it already reads rather than by removing blindly per entry:
once a cache is clean that costs nothing, where two `rm` calls per sidecar would cost two
syscalls per entry forever, and reading names also reaches an orphan whose sidecar is
gone — the shape an interrupted upgrade leaves, which no per-entry loop visits. Since
`index.ts` runs `maintain()` at startup, the first run after this ships is what actually
reclaims an existing library; the per-site removals above are for what happens between
those runs. What is deliberately *not* added is a migration pass of its own.

One gap is accepted: that name filter runs over the per-library directory, so an orphan
with no sidecar left in the *flat* legacy top is unreachable. Reaching it needs an
interrupted pre-library migration underneath an interrupted upgrade, and the flat
directory is on its way out; the cost of walking it on every start is not worth that.

(There is no `clear` method on `ThumbCache`; an earlier draft of this decision cited
one. `clearRecipe` is a label helper, not a cache-wide delete.)

### D6: A render the browser encoded as something else is dropped; the write around it is not

`canvas.toBlob(type, q)` answers PNG when it cannot encode `type` — silently, by the
HTML spec's own rule, and WebKit ships exactly that. Three options were open: refuse the
write, record each entry's encoding so the store can serve what it actually holds, or
accept it knowingly. Refusing wins on the same argument D5 rests on — the store's ability
to name what it holds. Recording the encoding per entry means a second name per render,
a sidecar field, and an image route that types bytes from data rather than from a
constant; that is a real feature, and it would exist to support browsers that cannot
produce the format this app has chosen. Accepting silently is the status quo the review
found: bytes several times the budget, under a name and a content type that both lie,
which nothing would ever surface because browsers sniff images and the tile draws.

So the check is client-side, in `putThumb` — the one place every upload passes through
(D1's ApiClient seam is what makes that true). What it drops is the *render*, not the
request: three callers move a camera or an axis in the same write as the pixels — the
orbit release, the axis set, the reframe — so refusing the whole request would lose the
orientation the user had just chosen, on one family of browsers, silently, while
reporting success. The pixels leave and the three labels that describe pixels leave with
them, because `lighting`, `rig` or `posed` arriving without a render would relabel the
*stored* render as current, which is worse than dropping the write. Everything else
travels, and `ThumbCache.put` already treats an orientation write without pixels the way
this needs: the stored render's recipe labels are cleared, so it reads as needing
re-render and a capable browser fills it. A write that carried nothing but pixels is
skipped outright rather than sent empty, which would bump a generation for no reason.

A dropped render is also *reported*, not just performed: `ThumbPutResult` carries
`dropped`, and `renderEntryThumbnail` turns it into the `skipped` outcome it already has
for work it did not do. Without that the generate job would count a cache filling while
nothing was written to it — the count is the whole of that job's output, so an honest
write with a dishonest tally would have been no better than the mislabelled file this
decision exists to prevent.

The cost is that such a browser never warms a shared cache — for the demo, a Safari
visitor re-renders each tile per visit — and that is visible in the requirement rather
than hidden in a mislabelled file.

The format itself now lives in one place, `THUMB_MIME` in `shared/types.ts`: the client
asks the encoder for it, the client refuses anything else, and the image route types the
bytes with it. Three sites had to agree and a disagreement between them is silent.

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
  The cheapest of the three, and the one a reviewing session recommends, is client-side:
  reject a blob whose `type` is not `image/webp` before it is uploaded, so a browser that
  cannot produce the format writes nothing rather than writing something mislabelled.
- **Browser encoder variance** even where WebP is produced: Chrome, Firefox and Safari
  differ in method, chroma handling and alpha defaults. The stored bytes are whatever the
  writing browser produced, which was already true of PNG but mattered less when the
  format was lossless.
- **Old clients against a new server**: a client from before this change would receive
  WebP bytes under a field named `png` and an `image/webp` content type. Browsers
  decode by sniffing and content type, not by field name, so a tile still draws; a
  hypothetical non-browser consumer would not.
