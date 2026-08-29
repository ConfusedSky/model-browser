# Occlusion Refreshes Thumbnails

> Formerly `lighting-refreshes-thumbnails`. Re-targeted 2026-08-28 (`docs/web-demo-notes.md`):
> the lighting mode it was written for is removed by `remove-axis-lighting`, and the
> ambient-occlusion preference — which thumbnails follow after `ao-as-recipe-dimension` —
> is the toggle that now needs exactly this mechanism. Sections 2 and 2b of the original
> are kept as they were; only the trigger changed.

## Why

Pressing the occlusion pill leaves the grid you are looking at drawn under the other
setting.

This is not a bug against the spec — it is the spec. After `ao-as-recipe-dimension`,
thumbnails are looked up and rendered under the occlusion preference, and the client's
load effect does exactly that (`useThumbnails`' cache lookup). But the effect that performs
the sweep takes `[entries, api, lru, queue, setThumb]`, so a preference change does not
re-run it: the tiles on screen keep their old render until the user navigates away and
back, which is a thing users learn rather than guess.

Lazy-on-visit was the right call for the case it was written against — a rig version
bumped between releases, upgrading a library as the user wanders through it, with no
moment where they are watching for the change. A toggle is the opposite case: the user
pressed a control that says what it does, is looking at the thing it applies to, and gets
no response from it. The rule is right and its trigger is missing one entry point. And
after `adaptive-ao-default`, the app presses that control itself on weak GPUs — with no
refresh, an automatic decision would leave every visible tile mismatched with the overlay
that opens over it, which is the handoff jump the whole sequence exists to remove.

## What Changes

- **An occlusion-preference change refreshes the thumbnails on screen**, through the same
  lookup, the same staleness rule and the same render queue that a visit uses. A render
  already cached under the new setting is shown at once (`ao-as-recipe-dimension` keeps
  both); one that is not is rendered. Nothing about *what* is looked up changes; only
  *when* the check runs.
- **The sweep keeps each tile's image while its replacement resolves.** It does not today —
  it resets every tile to a spinner on each run, which is invisible while runs only follow
  a listing change. Making a toggle re-run it would blank the grid, so preserving
  displayed images is part of this change rather than a property it inherits.
- **Camera state and axis are preserved**, exactly as on a visit — this replaces pixels.
- **The applied-only staleness rule is stated in the spec and proven to survive the second
  trigger** (§2b). The original of this change described `poseStale` as a bug to fix — a
  model orbited *and* posed re-rendering on every meaning-grid visit. That was fixed on
  main in `28289d1` (2026-08-21, "Stops posed thumbnails re-rendering forever"), with the
  test the original asked for already in `semanticSearch.test.tsx`. What remains is to
  write the rule down — nothing in `openspec/specs/` describes the orientation-source label
  or the applied-only predicate — and to assert it holds when the sweep gains a trigger.
- **The rig-version path stays lazy.** A new rig version arrives with a new build, where
  there is no gesture to respond to and nothing on screen waiting for an answer.
- Unchanged: the cache, its keys, its sidecars, the queue's ordering, and what either
  render looks like. No `RIG_VERSION` bump.

## Capabilities

### Modified Capabilities

- `model-thumbnails`: **MODIFIED** *Recipe-labelled thumbnails* (the title
  `remove-axis-lighting` gives it) — the orientation-source label and the applied-only
  staleness rule are stated, and the lookup gains a second trigger: a change in the
  occlusion preference re-checks the thumbnails already displayed. `thumbnail-sweep-priority`
  modifies *Client-side thumbnail rendering*; `ao-as-recipe-dimension` ADDs *A thumbnail
  exists per occlusion recipe*; neither collides.

## Impact

- `client/src/hooks/useThumbnails.ts` — the sweep effect re-runs when the effective
  occlusion preference changes; it carries displayed images across the re-run and owns
  their object URLs; `poseStale` narrows to "a pose that would be applied".
- `client/src/viewer/aoToggle.ts` — the preference is read through `aoEnabled()` inside the
  effect; making it a dependency means it has to be observable rather than only readable.
  `App.tsx` already holds it in state for the pill.
- Interacts with `entry-context-menu`: its per-tile re-render (D7) stays useful afterwards —
  it covers a tile that is wrong for a reason no sweep can detect. Neither depends on the
  other.
- Cost: a toggle over a large listing queues at most one lookup per visible model and a
  render per model whose other variant is not cached. That is the intent of the toggle,
  and the queue already bounds concurrency.

**Ordering (hard):** after `remove-axis-lighting` (this MODIFIES the requirement under
the name that change gives it, and carries its scenarios) and after
`ao-as-recipe-dimension` (the preference must reach thumbnails before a toggle can refresh
them); before `adaptive-ao-default`.
