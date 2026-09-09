# Tasks — hover-prefetch-thumbnails

> Gated twice, deliberately. **After `hover-prefetch-listings`** has landed and its task
> 5.2 has an after-number, and **after** the CDN question in `docs/web-demo-notes.md` is
> decided: if a CDN fronts the origin, the fan-out this change removes is already an edge
> hop and the right move is to drop this change, not to build it.

## 1. Decide whether to build it at all

- [ ] 1.1 Read `hover-prefetch-listings` 5.2's after-number: with the listing trip gone,
      is the residual click-to-populated gap still the image fan-out? Record the answer
      here with its date and origin
- [ ] 1.2 Take the image budget from that same measurement — how many images a first
      screen actually draws at the demo's default viewport (D3). Not a guess

## 2. The warm

- [ ] 2.1 `App.tsx`: supply the `warmImages(entries)` hook `ListingPrefetch` already calls
      — walk entries in listing order, taking each entry that names a drawable render and
      then the entries it carries in `preview`, stopping at the budget (D2)
- [ ] 2.2 Use `isCurrentRender` (already exported from `useThumbnails`), passed
      `entry.pose ?? undefined` and the current `aoEnabled()`, so the warm fetches exactly
      what the tile will draw
- [ ] 2.3 `new Image()` per URL with `fetchPriority = 'low'` (D1); hold them on the store
      entry so they are not collected mid-flight, drop them when the entry is taken or
      expires

## 3. Tests

- [ ] 3.1 A listing of folders carrying preview cells warms the cells' images, not zero
      (the *folder of folders* scenario) — this is the case the original draft got wrong
- [ ] 3.2 Entries naming no drawable render start no fetch and no lookup
- [ ] 3.3 With the unoccluded variant in force, the unoccluded URLs are the ones fetched
- [ ] 3.4 The budget is respected, counted in images
- [ ] 3.5 Falsify each cell once against the behaviour it forbids before trusting it

## 4. Prove it on the origin

- [ ] 4.1 Under the same conditions as `hover-prefetch-listings` 5.1, hover then click and
      count the image requests the click makes — zero for the warmed screen. Count
      requests rather than reading `transferSize`: Chrome reports memory-cache hits there,
      Safari does not
- [ ] 4.2 Re-run the click-to-populated measurement; the number moves or the change is
      reverted

## 5. Close

- [ ] 5.1 `openspec validate hover-prefetch-thumbnails --strict`, archive with a dry run
      first, then read the applied capability for change-scoped prose
