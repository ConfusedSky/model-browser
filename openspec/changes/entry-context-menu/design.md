# Design — entry-context-menu

## Context

`App.tsx:846` opens `onModelPointerDown` with `if (e.button !== 0) return`, so a secondary
press already starts no orbit and mounts no overlay — the collision a context menu would
otherwise have with the drag-to-orbit gesture does not exist.

`ViewerLayer.tsx:380-393` holds `copyPath`, the one entry action that ships today. Its
fallback is load-bearing and easy to lose in a rewrite: outside a secure context
`navigator.clipboard` is `undefined` and the call throws **synchronously**, which a bare
`.catch()` misses, so it selects the path text for manual copying instead.

`App.tsx:135-138` holds `pendingModel`: a URL param "honored once the entry exists in a
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

The shared module holds **commands**: one-shot, stateless, identical wherever invoked —
open, reveal, copy path, find similar, re-render thumbnail, reset framing. The lightbox's
orbit-axis picker and spindle flip are **controls**: stateful, bound to the live camera,
meaningless without a rendered model. They stay where they are.

The line matters because "show the same actions in both places" reads, at a glance, as
"move the axis buttons into the menu too". A spindle is the case that defines the line: the
picker changes one *and animates the model rotating to it*, which is how a user learns what
the choice means. A menu item mutating the same persisted value is the same write without
the thing that made it legible. D7 applies this to the two thumbnail commands, which are on
the command side of it.

### D2: Copy path copies what the lightbox copies

`entry.path` — the virtual path, `foo.zip!/parts/lid.stl` for archive entries. That is an
identity only this app understands, and it is the right one: it is what the lightbox's info
panel shows and copies today, what the path bar accepts, and what a shared link uses. An
absolute-fs-path variant is a reasonable future addition and is not worth a second menu item
now.

**The command takes the entry, not a DOM node.** It needs `entry.path` and nothing else,
and the tile already holds the row the server returned — `Grid.tsx` renders `DirEntry`
objects — so the menu hands the same object to the same function the panel does.

That is why the existing fallback does not move with it. `selectPathText`
(`ViewerLayer.tsx:367-378`) takes a `Range` over `pathRef.current`, the `<p>` at `:555`
that renders the path inside the info panel: manual copying needs the text rendered and
selectable, which is a fact about the panel rather than about the path. A context menu has
nothing on screen to select, so the fallback has no target there.

It is also defending a case this app does not have. `navigator.clipboard` is undefined only
outside a secure context; the app is served over loopback and headed for Electron, and both
are secure contexts. There is no plan for it to be reachable over plain HTTP. So the copy
succeeds, and the failure path is a brief toast reporting that it did not — one sentence of
behavior, identical on both surfaces because it is built from the entry rather than from
whatever happens to be rendered.

This changes shipped behavior, so it costs a `model-viewer` MODIFY: *Lightbox expanded
view* currently requires the panel to select the path text on failure. No other active
change touches that capability, so the modification is free.

**What this rests on, now that the app is meant to run on other machines.** "Loopback and
Electron are both secure contexts" is true because `guard.ts` enforces it: a request whose
`Host` is not `localhost`/`127.0.0.1`/`[::1]` is refused 403, so the app cannot be reached
by LAN IP over plain HTTP in the first place. The clipboard decision is therefore downstream
of the security design rather than an independent bet — and if that guard is ever relaxed to
allow LAN access, copy silently stops working before anyone notices the connection. Whoever
relaxes it owns this decision too.

*Alternative — `document.execCommand('copy')` over a temporary off-screen textarea:* this
is the standard trick for copying without a secure context or a rendered element, and it
would let the fallback be genuinely shared. Rejected: it is machinery for a deployment
this app does not have, on a deprecated API, and the case it rescues (loopback served over
plain HTTP, or reached by LAN IP) is one nothing in the roadmap creates. Recorded because
it is the obvious clever answer and would otherwise be proposed again as an easy win.

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

**Neighbours are drawn from the whole collection, not the browsed folder.** The index's
`/similar` takes an optional scope and defaults to the collection; this change states that
default as a decision rather than inheriting it, the same way it refuses to inherit `k`.
Meaning search is rooted at the browsed directory because a phrase is a question about a
place — "dragons in this kit". "More like this one" is not: scoped to the folder the model
sits in, it would mostly return that kit's other parts, which is the one answer the user
already has on screen. Collection-wide also keeps the URL honest — the source model is then
the complete description of the view, which is what naming it by model alone claims.

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
model tile           dir tile        zip tile
──────────           ────────        ────────
Open                 Open            Open
Reveal in app        Reveal in app   Reveal in app
Copy path            Copy path       Copy path
Find similar         —               —
Re-render thumbnail  —               —
Reset framing        —               —
```

Find similar is model-only because the index embeds models — and it carries a second
condition the table cannot show: the index is a separate service that may not be running,
and the requirement says the action is absent when it is unavailable. So the honest reading
of the table is **three items on a container, five on a model, and a sixth on a model when
the index is answering**. A model tile without *find similar* is not a bug; it is the
degradation `semantic-search` designs for, arriving here.

The two thumbnail items are model-only for the same structural reason: container tiles are
drawn as glyphs, not renders, so there is no thumbnail to act on.

Everything else applies to every kind, which is what keeps the menu predictable.

Rejected: "search in this folder" (reveal followed by a search, with less control than
doing both), and resetting the orbit axis — see D7.

### D7: Re-render and reset framing are two actions, and the axis is neither

An earlier draft rejected thumbnail re-rendering as "a real gap, but not this change's".
That was wrong on the second half: the gap is reached from a tile, the menu is the thing
reached from a tile, and there is nowhere else for it to live.

**They are two actions because they answer two different questions.**

*Re-render thumbnail* re-renders from the model's stored camera and axis, under the
lighting mode and `RIG_VERSION` in force now. It is not a no-op, and the reason is
mechanical: `useThumbnails.ts:130-131` already treats a cached hit whose `lighting` or
`rig` differs from the current values as stale, but that check only runs when the effect
re-runs, and its deps are `[entries, api, lru, queue, setThumb]` (`:235`) — lighting is not
among them. So changing the mode leaves the grid in front of you rendered under the old
one until the listing changes. Re-render is the manual trigger for that, and it also covers
a tile whose PNG came out of a mesh that loaded badly.

*Reset framing* discards the orientation stored for that path and re-renders at whatever the
model then resolves to. This is the badly-framed case, and it needs its own item because the
thumbnail is rendered *from* that stored camera — re-rendering without dropping it
reproduces the same picture. Note the scope: camera state is keyed by path and shared with
the viewer (architecture D4), so this also resets where the lightbox opens that model. That
is the honest behavior rather than a side effect, and it is why the item says *framing*
rather than *thumbnail*.

**Reset framing has to discard the camera, and the store cannot express that yet.** The
obvious implementation is to `putThumb` `DEFAULT_CAMERA` in place of the stored one. It is
wrong, and the reason only shows up next to `semantic-search`: `cache.ts:104` merges with
`camera: opts.camera ?? prev?.camera`, so an omitted camera means *keep* and there is no way
to clear one — and a written default is not a discard. `useThumbnails.ts:183-184` offers a
model the index's pose only when it has neither a stored camera nor a stored axis, so
storing a default would permanently disqualify that model from being posed. Reset framing
would leave a model strictly worse off than one nobody had ever touched: the action for a
badly framed thumbnail would be the action that guarantees one.

So this change carries a `model-thumbnails` MODIFY adding *discard* as a third thing a write
can say about the camera, alongside *set* and *say nothing*. That is a small protocol
addition rather than a new route — `putThumb` still writes png, camera, axis, lighting and
rig together, and re-render still writes back what it read.

**A discarded orientation resolves the way an untouched model resolves**, which is the pose
when the index has one and the default otherwise — and that is why reset framing discards the
axis too whenever a pose is there to replace it.

The axis is not separable from the pose's angles. `cameraForPose`
(`client/src/three/pose.ts:93-105`) derives camera *and* axis together, because the azimuth
offset is computed in `frameFor(axis)`: a pose's angles describe a view about the pose's own
up axis and mean something else about another. And `useThumbnails.ts:183-184` offers the pose
only when *both* stored values are absent, precisely because half a pose is not a pose. So
"hand the model back to the index" has to hand back both or neither.

Hence the rule: reset framing always discards the camera, and discards the stored axis as
well **when a usable pose exists for that model** — usable meaning `cameraForPose` returns
non-null, so a malformed pose (an off-axis `up`, an `azimuth_zero` that is not perpendicular)
leaves the axis alone rather than trading a real axis for a default one. With no pose
available there is nothing better to fall back to, so the axis stays and the model is framed
by default about it.

**"Usable" is `cameraForPose`'s answer and nothing else.** A pose with no cached front view
is a tempting exception — its angles default to 0, so it orients the model without framing
it — and taking it would be wrong twice. `pose.ts:110-112` keeps that pose on purpose ("the
orientation is still worth keeping — only the angles are missing"), and the sweep already
applies it to every model that has no orientation of its own. Reset framing's promise is that
the model ends up where an untouched one would be; a second opinion about what counts as
usable would break that promise and split one rule across two call sites, which is the drift
`lighting-refreshes-thumbnails` D1 exists to prevent.

This is the one place the axis moves, and it is not the affordance D1 rules out: the tile
re-renders in place at the new orientation, so the result is visible, and the user asked for
the stored orientation to be given up rather than for a particular spindle to be set.
Re-render still never touches the axis.

**The axis is not a third item**, by D1. The orbit-axis picker is a control: it is bound to
a live view and shows the spindle rotating to screen-up as it changes. A menu item that
reset a persisted spindle is a spindle change made outside the view that shows what a
spindle change means — and on a Z-up model it would lay the model on its side, which is the
outcome the picker's animated rotation exists to make legible. (The earlier form of this
argument said a menu item would show *nothing* of the result. These two items falsify that:
the tile re-renders in place, and the axis does change tile pixels, since `stageModel` and
`applyState` both take it. The command/control line and the Z-up outcome carry the decision;
"nothing shows it" no longer does.)
It stays in the lightbox, which already has the picker and its flip toggle. Once
`semantic-search` lands, the index supplies the axis anyway.

*Refreshing the visible grid on a mode change is a separate change.* Note this is not a
defect being worked around: `model-thumbnails`' *Lighting-mode-aware thumbnails* specifies
the upgrade as lazy, and three of its four scenarios time it to a visit — "revisits a
directory", "a directory is visited" (the fourth is about lighting matching at handoff and
says nothing about when). The code matches its spec. Making the grid you are looking at
refresh is a change to that requirement, which belongs to that capability rather than to a
menu. Until it lands, navigating away and back is the bulk answer and these items are the
per-tile one; afterwards they still are, because a tile can be wrong for reasons a sweep
cannot see.

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
