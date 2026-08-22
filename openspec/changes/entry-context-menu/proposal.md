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
fallback (`ViewerLayer.tsx:380-392` — outside a secure context `navigator.clipboard` is
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
  in the URL, in history, reproducible by whoever opens the link. It is what the view is
  *about*, the way a committed query is, so the view's subject becomes one of three things
  rather than a nullable query string (design D4) — and since a similarity view has no typed
  text to clear, the change also builds the explicit way out of a result set that nothing
  else ever built (D9).
- **Re-render thumbnail** — render this model's tile again under the lighting mode and rig
  version in force now, keeping its camera and axis. The staleness check for those already
  exists (`useThumbnails.ts:139-144`); what is missing is any way to ask for it on the grid
  you are looking at, since the sweep does not re-run when the mode changes (D7).
- **Reset framing** — *discard* the orientation stored for the model and re-render at
  whatever it then resolves to: the semantic index's pose where there is one for it, the
  default otherwise. This is the answer to a badly framed thumbnail, which re-rendering alone
  cannot fix, since the thumbnail is rendered *from* that stored orientation. Two things are
  load-bearing (D7): discarding rather than writing a default, since a stored default is an
  orientation of the user's own and would lock the model out of being posed; and discarding
  the stored *axis* too when a pose is available, since a pose's angles are measured about
  its own up axis and half a pose is not a pose. With no pose to fall back to, the axis
  stays.
- Deliberately not included: opening the OS file manager (a process spawn this server has no
  business doing — see design D5), resetting the orbit axis (a control, not a command — D7),
  and "search in this folder" (reveal plus a search, with less control).

## Capabilities

### New Capabilities

- `entry-actions`: the actions available on a listing entry, their availability per kind,
  and the two surfaces that offer them — a context menu on tiles and the lightbox's panel.

### Modified Capabilities

- `url-navigation`: **MODIFIED** *The URL names the committed view* — a find-similar result
  set is a view, named by the model it was derived from, and the "which options belong in a
  URL" gate generalizes from the query's mode to the view's subject. Written against main's
  current text (post-`semantic-search`, post-`search-view-reducer`); one stale sentence about
  the mode is corrected in passing and flagged in the delta's header.
- `model-thumbnails`: **MODIFIED** *Camera state stored alongside thumbnails* — a write gains
  a third thing it can say about a model's stored camera and axis: *discard*, alongside *set*
  and *say nothing*. The store merges with `opts.camera ?? prev?.camera` (and the same for
  the axis) today, so there is no way to clear either, and writing a default is not
  equivalent (D7). The block also brings main's text into line with shipped behavior on the
  read side (a missing axis is reported, not defaulted to +Y) — already true in code, false
  in main. No other active change modifies this requirement.
- `model-viewer`: **MODIFIED** *Lightbox expanded view* — the panel's copy affordance becomes
  a call into the shared action module, and its failure path changes with the move: a brief
  report instead of selecting the path text. The selection fallback existed for non-secure
  contexts, which this app does not target — loopback and Electron are both secure — and it
  cannot be shared with a menu that has no rendered path to select (D2). No other active
  change touches this capability.

## Impact

- `client/src/components/Grid.tsx` — the context-menu trigger. `App.tsx:770-772` already
  returns early on `e.button !== 0`, so a secondary press starts no orbit and mounts no
  overlay. `Grid` and its tiles are memoized on their handlers, so the new one is held by
  identity like the rest.
- `client/src/state/view.ts`, `state/reducer.ts`, `state/selectors.ts` — the view's subject
  becomes a three-way union in place of `q: string | null`, `corpusOf`/`requestOf`/
  `sameQuestion` gain the similarity arm, and one `clearSubject` transition becomes the one
  way out of a result set (design D4/D9). This is the largest single piece of the change and
  lands as its own commit.
- `client/src/lib/urlState.ts` — the `similar` parameter, and the option gate generalized
  from "the mode that reads it" to "the subject that reads it".
- `client/src/App.tsx` — reveal's navigate-then-locate (one `navigate` dispatch plus a
  component-local mark, following the deep-linked-model effect at `:645-660`), the deferred
  banner and results label taught about a subject that is not text, and the dismiss control.
- `client/src/viewer/ViewerLayer.tsx` — copy-path moves out to the shared action module.
- `client/src/api/client.ts` — the similar call, alongside `semantic-search`'s.
- `client/src/hooks/useThumbnails.ts`, `server/src/cache.ts` — re-render and reset framing,
  and the *discard* the orientation store cannot express today.
- Ordering: every change this one was written behind is archived, `search-view-reducer`
  included, and this is the rebase onto it. What remains is file-level: `§4b` shares
  `useThumbnails.ts` with `lighting-refreshes-thumbnails` and `thumbnail-sweep-priority`, and
  `§4` shares the state layer with `search-cancellation`. Declared in tasks.md.
