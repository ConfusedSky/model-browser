# Tasks — entry-context-menu

> **Ordering: hard dependency on `semantic-search`**, which owns the index client, the
> results-replace-the-grid path, and the dismiss affordance a similarity view reuses. That
> chain in turn runs behind `search-matches-folder-names` → {`find-in-listing`,
> `search-options`}. Both spec MODIFYs here are written against the text those changes leave
> behind — re-check them against main before applying. Sections 1–3 depend on nothing but
> each other and could be split out first if the index slips; section 4 cannot.

## 1. The shared action module

- [ ] 1.1 An entry-actions module owning one definition per command — open, reveal, copy
      path, find similar, re-render thumbnail, reset framing — each taking an entry and the
      app callbacks it needs, with the per-kind availability table from D6 in one place
      rather than at each call site
- [ ] 1.2 `copyPath` becomes a command over the entry: it takes the row and reads
      `entry.path`, the virtual path, unchanged (D2). It does **not** carry
      `selectPathText` (`ViewerLayer.tsx:331-342`) with it — that fallback ranges over
      `pathRef.current`, the panel's rendered `<p>` (`:519`), which a menu does not have,
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
- [ ] 2.2 Wire it to tiles in `Grid.tsx`. `App.tsx:349` already returns on `e.button !== 0`,
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
- [ ] 3.2 Locate on arrival, extending the `pendingModel` pattern (`App.tsx:60-63`): held
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

## 4b. Thumbnail actions  *(independent of the index — can land with §1–3)*

- [ ] 4b.1 Re-render: render the tile through the existing queue and `putThumb` the result
      with the model's stored `camera` and `axis` and the current `lighting` / `RIG_VERSION`
      (D7). No new server route — `putThumb` already writes all five together
- [ ] 4b.2 Reset framing: `putThumb` `DEFAULT_CAMERA` in place of the stored camera and
      render there. Test that the *viewer* subsequently opens the model at the default too —
      camera is keyed by path and shared with the lightbox (architecture D4), so this is
      stated behavior rather than a leak
- [ ] 4b.3 Neither touches `axis`. Test with a non-`y` spindle stored: it survives both
      actions and the re-render is drawn about it, since a reset that silently laid a Z-up
      model on its side is the failure D7 refuses
- [ ] 4b.4 Both go through the render queue like any other thumbnail work, so they suspend
      under an active orbit or lightbox rather than competing for the single renderer
      (architecture D2/D3). Neither bumps `RIG_VERSION` — they consume the current recipe
- [ ] 4b.5 Absent on dir and zip tiles (D6): container tiles are glyphs, not renders

## 5. Verification

- [ ] 5.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 5.2 Component tests: the menu opens on secondary click without orbiting; each item
      appears only for the kinds D6 lists; copy path works from both surfaces with one
      implementation; reveal navigates, marks, pushes history, and leaves the flat toggle
      alone; the mark does not survive a reload; re-render re-renders under the current
      settings from the stored camera, and reset framing renders at the default and moves
      where the viewer opens the model
- [ ] 5.3 Manual E2E via Playwright MCP on the real library — note tiles respond only to
      PointerEvents, so the secondary press needs `button: 'right'`, and clipboard reads
      need permissions granted upfront or the call hangs on a prompt. Reveal a model from a
      deep-search result, confirm Back returns to the results; reveal a zip-resident model
      and confirm it lands inside the archive
