# Design — entry-context-menu

## Context

`App.tsx:349` opens `onModelPointerDown` with `if (e.button !== 0) return`, so a secondary
press already starts no orbit and mounts no overlay — the collision a context menu would
otherwise have with the drag-to-orbit gesture does not exist.

`ViewerLayer.tsx:344-357` holds `copyPath`, the one entry action that ships today. Its
fallback is load-bearing and easy to lose in a rewrite: outside a secure context
`navigator.clipboard` is `undefined` and the call throws **synchronously**, which a bare
`.catch()` misses, so it selects the path text for manual copying instead.

`App.tsx:60-63` holds `pendingModel`: a URL param "honored once the entry exists in a
landed listing, silently dropped after a successful listing that lacks it (url-navigation
D3)". Reveal is that pattern with a different payload.

The grid is `grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]` (`Grid.tsx:20`) on a scrolling
page, so a folder at the 500-model flat cap is roughly 62 rows. Nothing in `client/src`
calls `scrollIntoView`.

## Goals / Non-Goals

**Goals:**
- Reach an entry's actions without loading its mesh.
- One implementation per action, whichever surface invokes it.
- Make "where does this live?" answerable from a search result.

**Non-Goals:**
- OS integration of any kind (D5).
- Multi-select or bulk actions. Every action here takes one entry.
- Moving, renaming, deleting, or otherwise writing to the library. This app reads.
- Replacing the lightbox's stateful controls (D2).

## Decisions

### D1: Commands are shared; the lightbox keeps its controls

The shared module holds **commands**: one-shot, stateless, identical wherever invoked — open,
reveal, copy path, find similar. The lightbox's orbit-axis picker and spindle flip are
**controls**: stateful, bound to the live camera, meaningless without a rendered model. They
stay where they are.

The line matters because "show the same actions in both places" reads, at a glance, as
"move the axis buttons into the menu too". A menu item that mutates the model's persisted
spindle without showing the result is a worse affordance than the one it copies.

### D2: Copy path copies what the lightbox copies

`entry.path` — the virtual path, `foo.zip!/parts/lid.stl` for archive entries. That is an
identity only this app understands, and it is the right one: it is what the lightbox's info
panel shows and copies today, what the path bar accepts, and what a shared link uses. An
absolute-fs-path variant is a reasonable future addition and is not worth a second menu item
now.

The implementation moves out of `ViewerLayer` intact, including the synchronous-throw
fallback, and the lightbox calls it.

### D3: Reveal navigates, locates, and does not editorialize

Three parts, and the middle one is the point:

1. **Navigate** to the entry's containing folder — for a zip entry, the directory inside the
   archive (`foo.zip!/parts`), which the vpath grammar already addresses.
2. **Locate**: scroll the entry into view and mark it briefly — a highlight that fades after
   a second or two. Without this, reveal drops the user at the top of a grid that can be ten
   screens tall and asks them to hunt for the tile they were just looking at, which is most
   of the action's value gone. Scrolling alone is not enough: in a grid of identical squares
   the eye needs somewhere to land.
3. **Push history**, so Back returns to where reveal was invoked from. This is what makes it
   safe to use on a search result: on a cold spinning volume that result set cost ~32s to
   produce, and an action that discards it irreversibly would be one people learn not to
   press.

**The flat toggle is not touched.** Revealing from a flat view lands in a flat listing of the
containing folder, which shows that folder's whole subtree rather than its immediate
children. That is a worse view for "see its siblings" and it is still the right call: which
view the user browses in is their setting, and an action that silently rewrites it teaches
them not to trust their own controls.

The highlight is ephemeral by construction — not in the URL, not restored by history, gone
on reload. It describes an event, not a view.

### D4: A find-similar result is a view, not a popup

It goes in the URL, in history, and reproduces for whoever opens the link, like every other
view in this app. The URL names the model the neighbours came from rather than a query
string, since there is no text to carry.

Two consequences worth stating. There is no typed text to clear, so it needs the same
explicit dismiss affordance `semantic-search` introduces for meaning results — one
affordance, two entry points, not two. And a model can fail to be a valid subject: the index
404s a path it has never embedded, and a zip-resident model can never be embedded at all
(`classify_stls.py` walks real `.stl` files; archives are outside the corpus on both sides).
Those are different sentences and the UI owes the user the difference.

Availability is decided optimistically rather than by pre-checking every tile: the menu
offers the action wherever it could plausibly work — a model, inside the indexed collection,
not in an archive — and explains the failure when it comes. Asking the index about every
tile in a 500-tile grid to grey out a menu item nobody has opened is not a trade worth
making.

### D5: No OS integration

"Open containing folder" in the file-manager sense is deliberately not built. It would mean
the Hono server spawning a process, and this server has no side effects today beyond writing
a thumbnail cache entry. `guard.ts` allows requests with an absent `Origin` (curl, tests) —
adequate for an API that reads files as the user, thin for one that executes things. The
natural home is Electron's `shell.showItemInFolder`, behind the seam D1 of the architecture
keeps open, and it can arrive there without this change having guessed at it.

Reveal-in-app also covers more ground: it works for zip entries, which have no containing
folder on disk, and it works when the browser is not on the machine holding the library.

### D6: The menu is per-kind, and it is not a dumping ground

```
model tile        dir tile        zip tile
──────────        ────────        ────────
Open              Open            Open
Reveal in app     Reveal in app   Reveal in app
Copy path         Copy path       Copy path
Find similar      —               —
```

Find similar is model-only because the index embeds models. Everything else applies to every
kind, which keeps the menu predictable: three items always, four on the tiles where the
fourth means something.

Rejected: re-rendering a thumbnail (a real gap — a badly framed thumbnail has no manual
invalidation — but not this change's), and "search in this folder" (reveal followed by a
search, with less control than doing both).

## Risks / Trade-offs

- [A menu is a place features accumulate] → D6's per-kind table is the budget. Additions
  should have to argue against it.
- [Reveal from a search discards an expensive result set] → history entry (D3); the cost is
  one Back press rather than a re-walk.
- [Right-click is an unusual affordance in a web app] → every action in the menu is also
  reachable another way (the lightbox, or navigation), so the menu is an accelerator rather
  than the only path. Keyboard access should follow the platform's context-menu key.
- [Find similar on an unindexed model looks broken] → two distinct messages (D4); the
  can-never-be-indexed case is knowable client-side from the path, so only the
  not-yet-indexed case needs the round trip.
