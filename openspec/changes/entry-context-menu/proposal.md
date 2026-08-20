# Entry Context Menu

## Why

Everything you can do to a model requires opening it. Copy its path, see where it lives,
find others like it — each means committing to the lightbox, which loads the mesh, takes
the whole window, and suspends the render queue. For an action that does not need the model
drawn at all, that is a heavy way in.

The gap is widest exactly where the app is most useful. A deep search returns models named
by relative path from all over a 500-tile grid, and the natural next question — *where does
this one live?* — has no answer short of reading the tooltip and retyping the path into the
path bar. `semantic-search` makes that worse in the good way: results come back from
anywhere in the collection, so "where is this" stops being an occasional question.

The lightbox already answers one of these. It has a copy-path affordance with a careful
fallback (`ViewerLayer.tsx:344` — outside a secure context `navigator.clipboard` is
undefined and throws *synchronously*, so it selects the text instead). That behavior should
not be written twice.

## What Changes

- **A right-click menu on grid tiles**, offering the actions that apply to the entry's kind.
- **One definition per action, shown in two places.** The menu and the lightbox invoke the
  same commands; copy-path is the existing implementation, moved rather than reimplemented,
  and it keeps copying the same virtual path the lightbox copies.
- **Reveal in app** — navigate to the entry's containing folder, scroll the entry into view,
  and mark it briefly so the eye finds it. It pushes history, so Back returns to the search
  results it was invoked from. It does not change the flat toggle: which view you browse in
  is the user's choice, not something an action revises.
- **Find similar** — nearest neighbours from the semantic index, presented as a peer view:
  in the URL, in history, reproducible by whoever opens the link.
- **Re-render thumbnail** — render this model's tile again under the lighting mode and rig
  version in force now, keeping its camera and axis. The staleness check for those already
  exists (`useThumbnails.ts:123-124`); what is missing is any way to ask for it on the grid
  you are looking at, since the sweep does not re-run when the mode changes (D7).
- **Reset framing** — drop the camera stored for the model back to the default view and
  re-render there. This is the answer to a badly framed thumbnail, which re-rendering alone
  cannot fix: the thumbnail is rendered *from* that stored camera.
- Deliberately not included: opening the OS file manager (a process spawn this server has no
  business doing — see design D5), resetting the orbit axis (a control, not a command — D7),
  and "search in this folder" (reveal plus a search, with less control).

## Capabilities

### New Capabilities

- `entry-actions`: the actions available on a listing entry, their availability per kind,
  and the two surfaces that offer them — a context menu on tiles and the lightbox's panel.

### Modified Capabilities

- `url-navigation`: **MODIFIED** *The URL names the committed view* — a find-similar result
  set is a view, named by the model it was derived from. Written against the text
  `semantic-search` leaves behind.
- `model-viewer`: **MODIFIED** *Lightbox expanded view* — the panel's copy affordance becomes
  a call into the shared action module, and its failure path changes with the move: a brief
  report instead of selecting the path text. The selection fallback existed for non-secure
  contexts, which this app does not target — loopback and Electron are both secure — and it
  cannot be shared with a menu that has no rendered path to select (D2). No other active
  change touches this capability.

## Impact

- `client/src/components/Grid.tsx` — the context-menu trigger. `App.tsx:349` already returns
  early on `e.button !== 0`, so a secondary press starts no orbit and mounts no overlay.
- `client/src/App.tsx` — reveal's navigate-then-locate, which extends the `pendingModel`
  pattern (`:60`, "honored once the entry exists in a landed listing, silently dropped after
  a successful listing that lacks it").
- `client/src/viewer/ViewerLayer.tsx` — copy-path moves out to the shared action module.
- `client/src/api/client.ts` — the similar call, alongside `semantic-search`'s.
- Ordering: **after `semantic-search`**, which owns the index client, the results-replace-
  the-grid path, and the dismiss affordance a find-similar view also needs.
