## 1. Server — the ask at emission, the peek attaching, the layer's pose half deleted

- [ ] 1.1 `semantic.ts`: thread a caller's timeout through `posesAsked` → `askPoses` →
      `askIndex` (default stays `POSES_TIMEOUT_MS`, so the POST route is unchanged); export
      `POSE_ASK_TIMEOUT_MS = 150` from `app.ts` beside `ANNOTATION_BUDGET_MS` with D1's
      justification and the measured numbers on the constant. Verify: a `semantic.test.ts`
      cell where `/poses` answers after the timeout — `posesAsked` resolves
      `{poses: {}, answered: false}` no later than the timeout, and `memoisedStatus()` is
      `undefined` afterwards (the reset); falsify by passing no timeout and watching the
      cell wait for `POSES_TIMEOUT_MS`.
- [ ] 1.2 `app.ts`: `fillOnce` builds one asked set — the listing's `kind === 'model'` paths
      plus every cell path of each carried sheet (`layers.previewFor(dir, PEEK_DEFAULT)`) —
      asks once through `posesAsked` with `POSE_ASK_TIMEOUT_MS`, and `fillAnnotations`
      resolves to `{poses, asked}` (`asked` empty when `answered` is false). `annotate`
      takes that answer and attaches: named → pose; in `asked` and unnamed → `null`; else
      absent — for listing models and carried sheet cells alike. The single-flight join
      returns the same answer to both requests. `fillPoses`, `rootUnmoved`'s pose caller and
      the `layers.poseFor` read in `annotate` go. Verify: `layers.test.ts` §6.9 cells
      rewritten per 1.6 pass; falsify by dropping the carried-cell half of the asked set —
      the "carried sheet cells arrive posed" cell must go red.
- [ ] 1.3 `app.ts`: `fillPreviews` attaches `learned` to the cells it derives (poses named,
      `null` for `learned.asked` unnamed) instead of `layers.recordPoses`; `/api/peek`
      attaches `learned` the same way instead of dropping it, and its "wire change to a
      shape another capability owns" comment is replaced by the rule (a preview cell carries
      what a listing entry may). Verify: new `poses.test.ts` cell "a peek's cells carry the
      poses its ask answered, and null for what it asked and got nothing" beside the
      existing "an unindexed answer is the walk's own sheet, byte for byte" (which must stay
      green: no ask, no field); falsify by reverting the attach.
- [ ] 1.4 `layers.ts`: delete `recordPoses`, `poseKnown`, `poseFor`, `held`, `HeldPose`,
      `POSE_ANNOTATION_TTL_MS`, the `poses` map, the `now` constructor seam, the pose half of
      `dropAll`/`size`; rewrite the module header (no "nothing here ever asks", no "a
      recorded none is an answer" — those were the pose half's) and `reroot`'s doc to say it
      guards sheets only. `GET`/`POST /api/semantic/poses` lose their `recordPoses` calls and
      the comments about closing the negative loop; `collectionRoot()` is deleted if
      `fillPreviews`' path through `posedFirstPeek` is its last user. Verify:
      `grep -a -n -E 'recordPoses|poseKnown|poseFor|POSE_ANNOTATION' server/src` is empty and
      `bun run typecheck` passes.
- [ ] 1.5 `app.ts`: `FILL_PREVIEW_MAX` 12 → 32; rewrite its doc with D3's numbers (26/31
      folders, 19 first-paint peeks measured 2026-09-11, 3–12 ms warm peek, the 24–96 ms
      projection at concurrency 4) so the next reader can re-derive the number. Verify:
      the existing "starts at most FILL_PREVIEW_MAX derivations" cell still passes with the
      new constant read from the module (never a literal in the test).
- [ ] 1.6 `server/test/layers.test.ts`, the cells that assert the memo, by title:
      "carries a pose the proxy already answered, without asking the index again" → rewrite
      as "carries the pose the index answers at emission, one ask per listing" (count the
      `/poses` calls: one per `/api/dir`, not zero on the second);
      "drops both layers when the index answers from another collection root" and "a
      restart drops the layers while the tree keeps serving" → previews only;
      "stops being emitted once it is older than the annotation TTL" (the whole "a recorded
      pose converges rather than sticking" block) → delete, and add "a changed index
      opinion is on the next listing" (change the mock's answer between two `/api/dir`
      calls; the second carries the new pose);
      "ships within the budget without the slow answer, and the next listing carries it" →
      "ships within the bound without the slow answer, and the next listing asks again";
      "asks once per horizon about a model the index has no pose for, not once per listing"
      → "asks once per listing, and a model the index has none for rides as null from the
      same answer";
      "joins a concurrent fill for the same listing rather than repeating it" → assert both
      responses carry the same poses from one `/poses` call;
      "records the poses its preview derivations learn, so sheet cells arrive posed" →
      "attaches the poses its preview derivations learn, so sheet cells arrive posed", plus
      a sibling "carried sheet cells are in the ask, so a revisit's sheet arrives posed";
      "fills nothing through a layers instance that is not live" → derives no sheet through
      it, but still asks and attaches poses;
      "drops a late answer whose collection root moved under it" → previews only;
      "does not stamp a negative when nothing about the index was learned" → "emits absent,
      not null, when the ask failed or timed out";
      "restamps a negative when the wave re-confirms it" → delete.
      Keep unchanged: the wedged cell, "carries pose and preview on the first sight, with no
      wave and no peek", "makes no call at all … while the probe says not ready", "fills on a
      stale-but-ready memo, and still takes no probe of its own", "declines after a failed
      ask, which is what limits a wedge now", "derives an empty folder's sheet once".
      Verify: `cd server && bunx vitest run test/layers.test.ts test/poses.test.ts
      test/semantic.test.ts test/peek.test.ts` green, and each rewritten cell falsified
      once against the prior code path (restore the memo read in `annotate` for one run
      and confirm the "changed opinion" cell goes red).

## 2. Client — no behaviour change; records that name the layer

- [ ] 2.1 Confirm `client/test/listingRefresh.test.tsx` "a listing whose models all carry
      poses asks nothing at all" and "names the unposed models only" cover a landing with
      poses attached issuing no wave (they exist as of 85a145d — grep them before ticking),
      and that `poseRerender.test.tsx` "a pose carried at emission over an un-annotated
      entry re-renders the tile with `posed`" covers the fresh-pose re-render. Verify:
      `cd client && bunx vitest run test/listingRefresh.test.tsx test/poseRerender.test.tsx`
      green with no edit.
- [ ] 2.2 Reword the comments that describe the pose layer: `ApiClient`'s two pose methods
      ("a plain listing carries no poses and waits for none" → carries what the index
      answered within the bound, and the wave asks for the rest), `DirEntry.pose` in
      `shared/types.ts` ("when the pose layer holds an answer" → when the index answered
      this emission or peek; `null` is "asked on this request, none"), `App.tsx`'s
      `carriedPoses` ("the server's pose layer already held them") and the two waves'
      `§6.4` remarks. Verify: `grep -rn -i 'pose layer' client/src shared` is empty.

## 3. Live — the measured folder, both index states

- [ ] 3.1 Index ready (`/status` on :8077 says `ready`, note which cache and root it
      loaded): restart the dev server, open a cold `/Loot Studios` in Playwright with the
      network log on. Expect: **0** `POST /api/semantic/poses` from the client (the
      2026-09-11 baseline was 5, naming 76 paths); every `GET /api/peek` answer carries
      `pose` or `null` on its cells; `/api/dir` carries `pose` on its models and on the
      carried sheets' cells on a revisit. Record the counts and the `/api/dir` timing beside
      the baseline in this task; record the `/api/library` top and root count beside the
      numbers (the dev root gets repointed by other sessions).
- [ ] 3.2 Index not started: the same navigation. Expect the listing unposed with no added
      latency (compare `/api/dir` timing against 3.1's), and the client's wave firing exactly
      as at 85a145d — one `POST /api/semantic/poses` per landing with models, answered `{}`.
- [ ] 3.3 Index stopped mid-session after 3.1 (kill :8077 with the `ready` memo warm):
      navigate once. Expect one emission that takes at most `POSE_ASK_TIMEOUT_MS` longer
      and emits unposed, the memo reset (`/api/semantic/status` answers `absent` on the
      next navigation without waiting the memo's TTL), and no further ask until the index
      is back. If the timeout fires on a *warm* index during 3.1, raise the constant and
      record the measured latency that forced it (design's second risk).

## 4. Records

- [ ] 4.1 `docs/web-demo-notes.md`, the "What is now the cost is round trips, not bytes"
      bullet under Measurements: add a dated line that the pose round trips after a listing
      and after each peek are gone when the index is ready (this change), and that the
      remaining waterfall is listing → peek → thumb. Verify: the line names this change and
      the 3.1 counts.
- [ ] 4.2 If `pose-rerender` is still active when this lands, add a dated line to its
      design D1 that "the server's five-minute pose memo is the bound" is superseded — the
      bound is the next emission; if it has archived, the archived text stands as history
      and this change's D5 is the record. Verify: one of the two, stated in this task.
- [ ] 4.3 `CLAUDE.md` does not name the layer (checked 2026-09-11); after archive, read
      `openspec/specs/listing-cache/spec.md` and `openspec/specs/directory-browsing/spec.md`
      and trim any change-scoped prose the deltas carried across (the CLAUDE.md rule on
      delta comments). Verify: the Purpose paragraph of `listing-cache` still reads true
      ("poses … attached at emission and, when the index is ready, filled there" — it does,
      the filling is now the ask).

## 5. Validate

- [ ] 5.1 `openspec validate pose-layer-removal --strict` clean, and an archive dry run on a
      fresh copy: `T=$(mktemp -d); cp -r openspec $T/; (cd $T && openspec archive
      pose-layer-removal --yes)` succeeds. Verify: both outputs pasted into this task at
      apply time; `bun run test` and `bun run typecheck` green.
