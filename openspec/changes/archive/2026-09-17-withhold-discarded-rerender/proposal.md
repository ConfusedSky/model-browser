## Why

On a deployment that refuses thumbnail writes, *Re-render thumbnail* is an offer that does
nothing. Its whole product is an image, it leaves the model's orientation exactly as it found
it by design, and the image is dropped: the tile shows the new pixels until the view is next
rebuilt, and then shows the deployment's own image again. A user cannot tell that press from
one that worked, and the label promises a replaced thumbnail.

The waste is the second argument, not the first. The press downloads the whole model — 1.8 MB
at the median of the shipped demo corpus, 20.6 MB at the worst — because a tile drawn from a
served image never loaded a mesh, then renders and encodes it. But cost alone proves too much:
orbiting a model on that deployment spends the same bytes, and that gesture is the demo's
point. The distinction is what the work leaves behind, and re-render is the one offer that
leaves nothing.

The project already has this rule and already applies it one size up. `feature-report` states
that a launcher whose work would be refused anyway is not offered, and *Generate thumbnails
beneath* is absent where thumbnail writes are refused "since it would render and discard". The
single-model command is the same act without the loop, and it is still offered, because the
rule as written is about bulk work.

## What Changes

- Withhold *Re-render thumbnail* where the deployment does not accept thumbnail writes, and
  where the report is not known — the same two conditions the bulk generate launcher already
  reads. The tile menu is the one surface that offers it; both lightbox surfaces exclude it
  already, for their own reason.
- Keep *Reset framing* offered. It gives up an orientation, and a given-up orientation changes
  where the model is shown from as soon as it runs, whatever the deployment does with the
  pixels drawn behind it.
- Generalise the render-and-discard rule from bulk launchers to any offer whose only product is
  an unstored render, so the single-model command and the bulk one are withheld by one stated
  reason rather than by two. The rule's subject is deliberately **pixels** and not "a refused
  write": the orbit-axis picker, both reset-framing bodies and the bulk framing reset each
  write an orientation beside their pixels, are offered today on a refusing deployment, and
  must stay offered.

No **BREAKING** change: a deployment that accepts thumbnail writes — which is every default
installation — offers exactly what it offers today.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `entry-actions`: *Refreshing a model's thumbnail and its framing* currently requires both
  actions on every model, "including one whose thumbnail is currently missing or failed". The
  re-render half becomes conditional on the deployment accepting the write it makes; the
  framing half stays unconditional.
- `feature-report`: the render-and-discard rule, today a clause inside *A deployment may
  withhold maintenance operations* and scoped to bulk launchers, gains a requirement of its own
  covering any offer whose only product is an unstored render. Added rather than folded in,
  because the re-render command is neither bulk nor maintenance.

## Impact

- `client/src/lib/entryActions.ts` — one `applies` predicate on the `reRenderThumbnail` row.
  Both `commandsFor` call sites already pass the report, so no surface changes. The gate is on
  the menu row, not on the shared render body: `resetFramingLive` and the bulk jobs call
  `renderEntryThumbnail` directly and keep working.
- Client tests: **one** file moves. Measured by applying the predicate and running the six
  suites that name the command — `entryActions.test.ts` fails one case, the other five pass
  untouched, because they mount the app against a harness report that accepts writes. The
  failing case is the per-kind table's, which builds its list with no report at all.
- `deploy/demo/config.json` is unchanged: it already declares `thumbWrites: false`, which is
  what the new condition reads.
- No server change. `PUT /api/thumb` already refuses on the same field, and that refusal is
  what makes the declaration true whatever client asks.
