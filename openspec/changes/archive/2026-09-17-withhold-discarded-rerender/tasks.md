## 1. The predicate

- [x] 1.1 Give the `reRenderThumbnail` row in `ENTRY_COMMANDS` the D1 predicate —
      `entry.kind === "model" && ctx.features?.thumbWrites === true` — leaving `resetFraming`'s
      unchanged, and rewrite the row's comment so it states both halves: offered on a current
      image because a failed one is what it exists to fix, withheld where the pixels would be
      dropped. Verify `cd client && bunx vitest run test/entryActions.test.ts` fails only the
      per-kind table's case, which 2.1 then rewrites.

## 2. Tests

- [x] 2.1 In `entryActions.test.ts`, split the per-kind table's *offers both thumbnail commands
      on a model and on nothing else* case: keep `resetFraming` asserted with the file's default
      unknown report, assert `reRenderThumbnail` under `OFFERED`, and update the exact-list
      assertion that today expects both rows from `ids(model(...), null)`. Both container
      assertions stay as they are. Verify the file passes.
- [x] 2.2 Add to `entryActions.test.ts` the three cases the delta names, alongside the existing
      *splits the two when maintenance and thumbnail writes disagree*: under
      `{...OFFERED, thumbWrites: false}` a model offers `resetFraming` and not
      `reRenderThumbnail`; under a `null` report it offers neither the re-render nor the
      `beneath` rows, and still offers open, reveal and copy path; under `OFFERED` it offers the
      re-render. Verify each new case by reverting 1.1's predicate to `entry.kind === "model"`
      and confirming the first two fail — a case that stays green under the old predicate is
      asserting nothing.
- [x] 2.3 Assert the rule's other half, in `entryActions.test.ts` beside 2.2: under
      `{...OFFERED, thumbWrites: false}` a model still offers `resetFraming`, and
      `orbitAxisApplies` still answers for the axis group. These are the rows the added
      requirement must **not** condemn — each writes an orientation beside its pixels — and an
      assertion is cheaper than re-deriving that from the requirement's wording later. Falsify
      them separately: the `resetFraming` cell fails when that row is given the re-render row's
      predicate, while `orbitAxisApplies` never reads the report at all, so its cell is a guard
      against a future gate on the group and is falsified by adding one, not by that mutation.
- [x] 2.4 Assert the panel surface too: with a report refusing thumbnail writes, the lightbox
      panel's command list still carries *Reset framing*, whose body is `resetFramingLive`. Put
      it where the panel's list is already exercised (`viewerMenu.test.tsx` raises the whole
      table; `featureReport.test.tsx` and `bulkJobSurfaces.test.tsx` hold the report-shaped
      cases — pick the one whose harness already varies the report rather than adding a mock).

## 3. Whole-suite and demo posture

- [x] 3.1 Run `bun run test` and `bun run typecheck` at the repo root and verify both pass.
- [x] 3.2 Check the demo posture by hand: `bun run dev:demo`, secondary-press a model tile, and
      verify the menu carries *Reset framing* and no *Re-render thumbnail*, while an ordinary
      `bun run dev` on the same corpus carries both. Record in this file which library root each
      run used — a dev instance's root is repointed by other sessions, so the two runs must name
      the same one for the comparison to mean anything.
- [x] 3.3 In the demo run, and **without reloading**: orbit a model, close the lightbox, then
      give up its framing from the tile menu. Verify the tile redraws at what the model resolves
      to with no orientation of its own and that reopening it shows the same, which is the
      delta's *Giving up a framing is offered where pixels are not kept* and is what justifies
      keeping that row where the other one goes. A reload bringing the deployment's framing back
      is expected, not a failure of this change: the browser-held store is off
      (`FRAMINGS_KEPT_LOCALLY`) pending issues
      [#23](https://github.com/ConfusedSky/model-browser/issues/23) and
      [#28](https://github.com/ConfusedSky/model-browser/issues/28). Do not close either, and do
      not verify this step across a reload **or a navigation away and back** — both re-seed the
      tile from the deployment's annotation, and the orbit itself does not survive either, so
      the step would pass with the reset never pressed.
- [x] 3.4 Verify the panel body separately, and expect a different answer. Pick a model whose
      cache sidecar carries a non-null `camera`, open it, and press *Reset framing* in the
      lightbox panel. Expect the live view to reframe at once and the tile to return to the
      deployment's framing shortly after the close: `resetFramingLive`'s trailing
      `refreshThumbnail` is non-discarding, and on a refusing deployment its lookup still
      answers the camera the route declined to give up. Record it under
      [#23](https://github.com/ConfusedSky/model-browser/issues/23) and do not treat it as a
      regression of this change — confirm only that the row is still offered and still reframes
      the live view.

## 4. Archive

- [x] 4.1 Dry-run the archive on a fresh copy — `T=$(mktemp -d); cp -r openspec $T/; (cd $T &&
      openspec archive withhold-discarded-rerender --yes)` — and verify it reports
      `entry-actions: update` and `feature-report: update` with no collision.
- [x] 4.2 After archiving for real, read `openspec/specs/feature-report/spec.md` and
      `openspec/specs/entry-actions/spec.md` and verify the applied text reads as the
      capability's own, with nothing left in it that only made sense while this was a change in
      flight.

## Verification record

Run on 2026-09-17, against a server started from this checkout on port **3178** so that the
instance another session already had on 3177 was left alone. That instance turned out to be
serving a *different* checkout — its Vite on 5173 still served the ungated
`applies: (entry) => entry.kind === "model"` — which is why the ports below are not the usual
ones. Both postures used one library: id `70b60f0d-b563-4167-860c-43826ceba61b`, root
`~/Documents/tests/test-models/miniatures/decimated`, 454 entries at the top, and one client
build shared between them.

**3.2, the A/B.** Same build, same corpus, one model
(`/28mm_Banana_Knight_v2_3327431/BananaKnightV2.stl`), the server restarted between the two:

| posture | `thumbWrites` | tile menu |
|---|---|---|
| demo | false | open, reveal, copyPath, findSimilar, resetFraming |
| default | true | open, reveal, copyPath, findSimilar, reRenderThumbnail, resetFraming, openWith |

The axis group answered on both (three `menuitemradio` rows under the demo posture), which is
2.3's live counterpart.

**3.3, the tile body, no reload.** A camera was first stored for that model under the accepting
posture, then the server was restarted refusing writes, so the deployment held
`{az: 1.2, el: 0.6, distR: 2.4}`. *Reset framing* from the tile menu redrew the tile: the
image hashed 1856994916 against the deployment framing's 3716556960, so the discard took
effect on the tile in-session. The sidecar still held `az: 1.2` afterwards, the write having
been refused — which is the scenario's "where nothing recorded the discard".

The reopen half of this step — that the expanded viewer agrees with the tile — was **not**
re-observed in the browser: the live renderer is built without `preserveDrawingBuffer`, so its
canvas cannot be read back after the frame, and only the thumbnail path copies pixels out at
draw time. It is asserted instead by `thumbnailActions.test.tsx`' *takes effect in this
session, not only after the next load*, which opens the model at its stored camera, gives the
framing up, and reopens to `camera: undefined`. That case predates this change and runs the
same in-session path: a refusing deployment changes only where the PUT ends up, while
`framingChanged`, `discardThumbFraming` and `setThumb` run either way.

**3.4, the panel body, and it answers differently.** From a freshly loaded grid the tile hashed
3716556960 (the deployment's framing). *Reset framing* in the lightbox panel, then close: a new
render landed (a new object URL) and hashed **3716556960 again** — byte-identical to the
deployment's framing. `resetFramingLive`'s trailing non-discarding `refreshThumbnail` read the
camera the route had declined to delete and drew at it. That is
[#23](https://github.com/ConfusedSky/model-browser/issues/23) reproduced, not a regression
here, and it is why the delta's prose says the tile may be redrawn from what the deployment
still holds.

**Cleanup.** The server was stopped, the temporary configuration files removed, the camera
seeded for the test deleted from the shared thumbnail cache (which was empty before and is
empty again), and `client/dist` removed — it is rebuilt from this checkout during the run, and
a stale one there is what makes port 3177 serve an old bundle.
