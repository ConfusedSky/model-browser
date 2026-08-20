# Tasks — entry-context-menu

> **Ordering: hard dependency on `semantic-search`**, which owns the index client, the
> results-replace-the-grid path, and the dismiss affordance a similarity view reuses. That
> chain in turn runs behind `search-matches-folder-names` → {`find-in-listing`,
> `search-options`}. Both spec MODIFYs here are written against the text those changes leave
> behind — re-check them against main before applying. Sections 1–3 depend on nothing but
> each other and could be split out first if the index slips; section 4 cannot.

## 1. The shared action module

- [ ] 1.0 The action module needs `poses` (`App.tsx`'s state, today passed only to
      `useThumbnails` and `ViewerLayer`) to resolve an orientation. Plumb it, and note the
      consequence: `setPoses` is called only for meaning results, so outside a meaning view
      every model takes the no-pose branch and reset framing gives the default. That is
      correct — there is no pose to hand back — but it means 4b.3a's posed cases are only
      reachable from a meaning grid, which is where its tests belong
- [ ] 1.1 An entry-actions module owning one definition per command — open, reveal, copy
      path, find similar, re-render thumbnail, reset framing — each taking an entry and the
      app callbacks it needs, with the per-kind availability table from D6 in one place
      rather than at each call site
- [ ] 1.1a Build the brief-failure affordance the copy command reports through, or adopt one.
      Nothing in `client/src` renders a toast today; the two existing surfaces are
      `ViewerLayer`'s inline `copied` state, which is per-panel, and `PathBar`'s `error` prop
      (`App.tsx:1022`), which is the app's one place for transient failure text. Prefer
      extending the latter to inventing a second transient surface — decide at apply and say
      which, so nobody builds a third
- [ ] 1.2 `copyPath` becomes a command over the entry: it takes the row and reads
      `entry.path`, the virtual path, unchanged (D2). It does **not** carry
      `selectPathText` (`ViewerLayer.tsx:367-378`) with it — that fallback ranges over
      `pathRef.current`, the panel's rendered `<p>` (`:555`), which a menu does not have,
      and it defends a non-secure context this app does not target. A failed write shows a
      brief toast instead, from whichever surface invoked it
- [ ] 1.3 The lightbox's copy affordance calls the shared command. `selectPathText`,
      `pathRef`, and the panel's bespoke try/catch go with it; the `copied` confirmation is
      presentation and stays per surface. Its existing tests need updating for the new
      failure path — that is the one behavior this move deliberately changes
- [ ] 1.4 Land the `model-viewer` MODIFY with it: *Lightbox expanded view* currently
      requires the panel to select the path text on failure, so the shipped spec is false
      the moment the toast replaces it. Every other scenario of that requirement is carried
      forward in the delta

## 2. The menu

- [ ] 2.1 A context-menu component: raised at the pointer, kept inside the viewport, closed
      by choosing an item, Escape, or an outside interaction
- [ ] 2.2 Wire it to tiles in `Grid.tsx`. `App.tsx:846` already returns on `e.button !== 0`,
      so nothing more is needed to keep a secondary press from orbiting — assert that in a
      test rather than trusting it, since it is one early return away from regressing
- [ ] 2.3 Keyboard access: the platform's context-menu key on a focused tile, arrow keys
      within the menu, Escape to close, focus returned to the tile
- [ ] 2.4 Raising or dismissing the menu starts and cancels no thumbnail work and does not
      suspend the render queue — it is not a viewer

## 3. Reveal

- [ ] 3.1 Navigate to the containing folder, deriving it from the entry's vpath — for an
      archive entry, the directory inside the archive (`foo.zip!/parts`). One history entry,
      through the ordinary navigation path so latest-wins and the skeleton apply (D3)
- [ ] 3.2 Locate on arrival, extending the `pendingModel` pattern (`App.tsx:135-138`): held
      until the listing lands, honored if the entry is there, dropped silently if not
- [ ] 3.3 Scroll the entry into view and mark it for a second or two, then fade. Nothing in
      `client/src` calls `scrollIntoView` today, so pick the block/inline behavior
      deliberately — a tile landing under a sticky header is not located
- [ ] 3.4 The flat toggle is untouched (D3). Test both: revealing from flat lists the
      destination flat, revealing from nested lists it nested
- [ ] 3.5 The mark is ephemeral — absent from the URL, not restored by Back or reload, and a
      no-op when the entry is missing from the listing that arrives

## 4. Find similar  *(after `semantic-search`)*

- [ ] 4.1 `ApiClient` gains the similar call, beside the semantic query; the server proxies
      it and joins hits to listing data through the same path `semantic-search` builds
- [ ] 4.1a Send no scope: neighbours come from the whole indexed collection (D4). State it
      rather than inheriting the index's default, and note that this differs from meaning
      search, which is rooted at the browsed directory — a reviewer seeing two sibling
      result views scoped differently should find the reason written down
- [ ] 4.2 Choose `k` deliberately rather than inheriting either default: the index's is 10,
      this app's text-query bound is 60. Neighbours degrade faster than text matches, and
      D8's thumbnail-sweep argument barely applies at this size
- [ ] 4.3 The view goes in the URL, named by the source model's path, and into history;
      opening that URL reproduces it. Re-check `semantic-search`'s URL delta before writing
      this one — both modify the same requirement
- [ ] 4.4 Availability is optimistic (D4): offered on models inside the indexed collection
      and outside archives, with no per-tile round trip to the index
- [ ] 4.5 Two distinct failures: not yet embedded (404 from the index — fixable by running
      the classifier) versus inside an archive (outside the corpus by construction, knowable
      client-side without asking). Different sentences
- [ ] 4.6 Reuse `semantic-search`'s dismiss affordance rather than adding a second one — a
      similarity view has no typed text to clear, which is the case that affordance exists
      for
- [ ] 4.7 No per-result score or z on the tile (`semantic-search` D10): order carries
      strength. Similarity cosines run 0.85–0.99 against text queries' ~0.1, and the index
      reports no `weak` flag here for that reason

## 4b. Thumbnail actions  *(the actions land with §1–3; their posed cases need the index)*

- [ ] 4b.1 Re-render: resolve the orientation exactly as the sweep does
      (`useThumbnails.ts:183-187` — stored camera/axis, else the pose when *both* are absent,
      else the default), render through the queue, and `putThumb` **pixels only**. Do not
      persist a pose: `semantic-search`'s *A pose orients the model without becoming its
      stored camera* forbids it, and the sweep's own comment says the same. Test a posed
      model: after re-render it still has no stored camera or axis, so a re-classification
      still governs it — and it declares `POSE_VERSION`, so the next visit is a hit rather
      than another re-render (4b.6)
- [ ] 4b.2 The orientation store gains *discard* (`model-thumbnails` MODIFY), for the axis as
      well as the camera. `cache.ts:104-105` is `camera: opts.camera ?? prev?.camera` /
      `axis: opts.axis ?? prev?.axis`, so silence means keep and there is no way to clear —
      add an explicit discard to `ThumbPutRequest`/`ThumbCache.put`, keeping silence meaning
      keep. Server test all three states per field: set, silent, discarded
- [ ] 4b.3 Reset framing discards rather than writes `DEFAULT_CAMERA`. The distinction is the
      task, not a nicety: a stored default makes `cached.camera !== undefined`, which at
      `useThumbnails.ts:183-184` permanently disqualifies the model from the pose path — the
      fix for a badly framed thumbnail would guarantee one. Test that a posed model, after
      reset framing, renders at the pose and not at the default
- [ ] 4b.3a Reset framing discards the **axis too when a usable pose exists** for that model,
      so the pose applies entire (D7). Gate on `cameraForPose(...) !== null`, not on the raw
      presence of a pose: a malformed one (off-axis `up`, non-perpendicular `azimuth_zero`)
      returns null, and trading a real axis for `'y'` there would be worse than keeping it.
      Use that predicate and no other — in particular do **not** add a `front === null`
      exception: `pose.ts:110-112` keeps such a pose deliberately ("the orientation is still
      worth keeping — only the angles are missing"), the sweep applies it to any untouched
      model, and reset framing's whole promise is to return the model to what an untouched
      one gets. A second opinion about what counts as usable is the drift `lighting-refreshes-
      thumbnails` D1 warns about.
      With no usable pose, discard the camera alone. Test all three: posed + stored axis →
      both discarded and the pose applies; malformed pose → axis kept; no pose → axis kept
- [ ] 4b.4 Reset framing also updates the in-memory thumb state, not just the server:
      `App.tsx:1228` sources the lightbox's camera from `thumbs.get(path)?.camera`, so a
      server-only write leaves the viewer opening at the old camera for the rest of the
      session. Test the viewer within one session, not only after a reload
- [ ] 4b.5 Re-render never touches `axis`. Test with a non-`y` spindle stored: it survives
      re-render whether or not a pose exists, and the render is drawn about it. Reset framing
      is the only path that moves the axis, and only under 4b.3a's gate — a discard that left
      a Z-up model laid on its side with nothing to replace the axis is the failure D7 refuses
- [ ] 4b.6 Both `await queue.whenResumed()` before touching the renderer, as the sweep does
      at `useThumbnails.ts:165,169` — `queue.push` alone is not enough, since `queue.ts:41-46`
      documents that `suspend()` cannot stop a job that has started, and this is the single
      shared `WebGLRenderer` (architecture D2/D3). Neither bumps `RIG_VERSION` — they consume
      the current recipe. But a render made under a pose MUST declare `POSE_VERSION`
      (`three/pose.ts:39`, a third pixel-recipe label beside lighting and rig): `cache.ts:110`
      clears `posed` on any PUT carrying a PNG, so a "pixels only" write drops the label and
      the next meaning-grid sweep sees `poseStale` and renders the tile again. It self-heals
      — that sweep writes the label back (`useThumbnails.ts:196`) — so the cost is one wasted
      render rather than a loop, and only where poses exist at all. Declare it anyway: a
      thumbnail that lies about which recipe drew it is the thing `posed` was added to stop
- [ ] 4b.7 Offered on every model tile including one whose thumbnail is missing or errored
      (`useThumbnails.ts:218,226` → `Grid.tsx:88-89`) — a failed image is a case re-render exists
      for. Absent on dir and zip tiles (D6): container tiles are glyphs, not renders

## 5. Verification

- [ ] 5.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 5.2 Component tests: the menu opens on secondary click without orbiting; each item
      appears only for the kinds D6 lists; copy path works from both surfaces with one
      implementation; reveal navigates, marks, pushes history, and leaves the flat toggle
      alone; the mark does not survive a reload; re-render re-renders under the current
      settings from the stored camera, and reset framing discards the stored orientation,
      renders at what the model then resolves to, and moves where the viewer opens it
- [ ] 5.3 Manual E2E via Playwright MCP on the real library — note tiles respond only to
      PointerEvents, so the secondary press needs `button: 'right'`, and clipboard reads
      need permissions granted upfront or the call hangs on a prompt. Reveal a model from a
      deep-search result, confirm Back returns to the results; reveal a zip-resident model
      and confirm it lands inside the archive
