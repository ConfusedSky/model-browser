## Context

See proposal.md — Why.

What the press does today on a deployment that refuses writes, in order:
`refreshThumbnail` queues a body; `renderEntryThumbnail` waits on `queue.whenResumed()`,
looks the entry up, acquires the mesh through the LRU — which fetches the model, because a
tile drawn from a served image never loaded one — renders, encodes, and calls `putThumb`. The
client's `LocalFramings` decorator intercepts that call: `keepsFramingsLocally` is true, so it
hands the save to `writeLocalFraming` and answers `{dropped: true}` without reaching the
server. `writeLocalFraming` writes nothing, for two reasons stacked: `FRAMINGS_KEPT_LOCALLY`
is `false` — the browser-held store is off until issue
[#28](https://github.com/ConfusedSky/model-browser/issues/28) gives it a pixel cache to agree
with — and behind that flag a re-render sends `camera` and `axis` as `undefined`, which the
guard keeping a pixel-only save off a stored orientation drops anyway. So the write is
discarded today and stays discarded when the flag comes back.
`renderEntryThumbnail` still calls `setThumb` with a fresh blob URL, so the tile shows the new
image, and returns `"skipped"`, which the command path ignores. No failure is reported,
because nothing failed.

Note what that flag does **not** change. `model-thumbnails` normatively requires the local keep
(*A client whose writes are refused keeps its framings locally*); the code has it switched off
while #28 is open. This change is written to be correct either way, which is why nothing below
turns on whether the keep is live.

The row's availability is `entry.kind === "model"` and nothing else. Both menus are built by
`commandsFor` from `ENTRY_COMMANDS`, and both call sites in `App` already pass the feature
report in the `AvailabilityContext`.

## Goals / Non-Goals

**Goals:**

- One predicate, read by every surface, so no surface learns about deployments.
- The rule stated where the other render-and-discard withholding is stated, so the two are one
  rule rather than two coincidences.

**Non-Goals:**

- Offering the command conditionally on the tile's own state — "only where the image failed".
  That needs thumbnail state in `AvailabilityContext`, which holds a deployment report, an
  index report and an apps report, none of them per-tile.
- Any change to what the deployment accepts. `deploy/demo/config.json` already declares
  `thumbWrites: false`.
- Any change to the shared render body. `renderEntryThumbnail` is also the bulk generate job's
  body, and a job that reaches it is already gated.

## Decisions

### D1: Gate on `thumbWrites`, in the row's own `applies`

```ts
applies: (entry, ctx) => entry.kind === "model" && ctx.features?.thumbWrites === true,
```

The same shape `generateBeneath` uses, and the same field, because it is the same write that
would be refused. Reading the capability rather than a deployment kind is `feature-report`'s
founding rule: the client never learns it is "the demo".

Alternative considered and rejected: a per-surface exclusion list, beside
`LIGHTBOX_MENU_EXCLUDES` and `LIGHTBOX_PANEL_EXCLUDES`. Those lists answer "can this surface
honestly run this command", which is a question about the surface and is settled at build time.
This is a question about the deployment and is settled at run time, so it belongs where the
other deployment-conditioned rows already read it.

### D2: Withheld while the report is not known

`ctx.features?.thumbWrites === true` withholds on `null` as well as on `false`. `null` is *not
known* — in flight, or the read failed — and the established reading is that an offer is
withheld either way, so nothing renders and then vanishes a round trip later. The `beneath`
rows and *Open with…* are already written this way.

The cost is a window at startup on an ordinary installation where a right-click shows one row
fewer. The report is resolved once and early, and the same window already applies to four
other rows.

### D3: *Reset framing* stays offered, unconditionally

Not because it persists — with `FRAMINGS_KEPT_LOCALLY` off it does not, and issues
[#23](https://github.com/ConfusedSky/model-browser/issues/23) and
[#28](https://github.com/ConfusedSky/model-browser/issues/28) are that gap — but because its
product is not reducible to pixels. It gives up an orientation, and a given-up orientation
governs where the model is shown from as soon as it runs. What becomes of that discard once
the view is rebuilt is `model-thumbnails`' *A client whose writes are refused keeps its
framings locally*, a requirement the code is presently short of. Whether this row is offered
must not hang on that, or the row appears and disappears with a flag in a different capability.

The two bodies do not reach equally far, and the difference is worth knowing before anyone
verifies it. From the tile, `renderEntryThumbnail` draws at the discarded framing and calls
`setThumb` even on a dropped write, so tile and viewer agree until the listing is rebuilt.
From the panel, `resetFramingLive` reframes the live view, clears the map through
`discardThumbFraming`, and then queues a **non-discarding** `refreshThumbnail` pinned to its
own lookup. On a refusing deployment that lookup still answers the orientation the route
declined to give up, so where the deployment holds a camera for the model the tile returns to
it moments after the close. That is the shape of
[#23](https://github.com/ConfusedSky/model-browser/issues/23) and follows from
`pose-rerender` D4's deliberate design; it is not this change's to fix, and nothing here
asserts otherwise.

The honest asymmetry is therefore narrower than "one persists and one does not". It is that
re-render's every product is an image, so where the image is dropped the press did nothing at
all, while a discard changes the model's resolved orientation the moment it runs.

Two consequences worth stating, because both look like inconsistencies otherwise:

- Keeping this row keeps one render-and-discard on a refusing deployment, since
  `resetFramingLive` ends by queueing `refreshThumbnail` to redraw at the new framing. That is
  the cost of an action that does something, not of one that does nothing.
- The gate is on the menu row's `applies`, not on the shared body. `resetFramingLive` and
  `BulkJobs` call `renderEntryThumbnail` directly and are unaffected.

This split is the whole reason the new `feature-report` requirement talks about an offer's
*product* rather than about which route it calls: both actions call `PUT /api/thumb`, and only
one of them loses everything when that route refuses.

### D4: ADD a requirement in `feature-report` rather than widen the maintenance one

The clause that today says bulk work filling the thumbnail cache is not offered where writes
are refused lives inside *A deployment may withhold maintenance operations*. The re-render
command is neither bulk nor maintenance, so widening that requirement would make its subject
two things. The project's own rule for a new concern is to ADD rather than MODIFY, which also
keeps this change off a requirement another active change might touch.

The delta leaves the bulk clause where it is. It is now a case of the added requirement as
well as a clause of its own, which is a duplicate statement rather than a conflicting one.

The added requirement's **subject is pixels, not refused writes**, and that choice is load
bearing. Worded as "any offer whose work the deployment refuses", it condemns three things
that are offered today and should stay offered on a deployment refusing writes: the orbit-axis
picker (`setOrbitAxis` renders and PUTs pixels *and* an axis), *Reset framing* in both its
bodies, and the bulk *Reset framings beneath*, which the main spec explicitly keeps under
`maintenance` with `thumbWrites` off. Each of those writes an orientation beside its pixels, so
naming pixels as the subject leaves them compliant by what they are rather than by an exemption
that has to be argued. It also keeps the requirement independent of `FRAMINGS_KEPT_LOCALLY`:
where the orientation ends up is `model-thumbnails`' subject, not this one's.

### D5: No server change

`PUT /api/thumb` already answers `403` with `refused: "thumbWrites"` before reading the body.
Withholding a client offer is not what makes a declaration true, and the delta says so.

### D6: What a demo visitor loses, and why that is acceptable

Only the retry of a tile whose render threw. Three things cover the rest:

- A cache miss already renders client-side, in `useThumbnails`' per-tile pipeline, with no
  command involved. That is how the demo draws anything its bake does not answer for.
- A render that threw is deterministic in its input, so pressing again renders the same throw.
- Leaving the listing and coming back re-runs that pipeline on a new slot, which is the retry
  a press was standing in for.
- A reload re-asks the server, which is where the demo's images come from.

## Risks / Trade-offs

- **A personal installation whose feature read fails loses the row until it is retried.** →
  Already true of *Open with…* and both `beneath` rows; the report resolves once, early, and a
  failed read is a broken installation rather than a state to degrade gracefully into.
- **The command's tests overwhelmingly pass `features: null`.** Green after the gate would mean
  the assertions stopped covering the row rather than that the row still works. → Update them
  to a report that offers writes, and falsify each changed cell by reverting the predicate to
  `entry.kind === "model"` and seeing it fail.
- **Someone later reads the two statements of the render-and-discard rule as disagreeing.** →
  The added requirement names scale explicitly as *not* the reason, and carries a scenario
  asserting the bulk case and the single case are withheld alike.
- **The added requirement is read as covering any refused write, and the axis picker or a
  reset is withheld under it.** → Its subject is named as pixels in the first sentence and a
  scenario states the orientation case positively, rather than leaving it to be inferred from
  an exemption. Anyone applying it to a new row should ask what the row leaves behind, not
  which route it calls.
