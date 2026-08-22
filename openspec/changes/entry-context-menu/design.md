# Design — entry-context-menu

Line citations are against `baa7010` (post `search-view-reducer`). This change was first
written against the pre-reducer App and has been rebased onto the state layer: every
citation below was re-checked against that commit, and the ones that named `useState` cells
or refs the reducer deleted are gone rather than renumbered.

## Context

`App.tsx:770-772` opens `onModelPointerDown` with `if (e.button !== 0) return`, so a
secondary press already starts no orbit and mounts no overlay — the collision a context menu
would otherwise have with the drag-to-orbit gesture does not exist.

`ViewerLayer.tsx:380-392` holds `copyPath`, the one entry action that ships today. Its
fallback is load-bearing and easy to lose in a rewrite: outside a secure context
`navigator.clipboard` is `undefined` and the call throws **synchronously**, which a bare
`.catch()` misses, so it selects the path text for manual copying instead.

The app's view state is one pure reducer (`client/src/state/{view,reducer,selectors}.ts`);
`App.tsx` is a dispatch-and-render shell over it. Two of this change's actions move the
view, so both are dispatches rather than anything of their own — see D8, which D3 and D4
both rest on.

The URL param a deep-linked lightbox is honored from is now a field of the view
(`View.model`), consumed by the effect at `App.tsx:645-660`: honored once its entry is in a
landed listing, and dropped by rewriting that one field of the live URL after a successful
listing that lacks it. Reveal's locate step is that shape with a different payload, minus
the URL — see D3.

The grid is `grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]` (`Grid.tsx:27`) on a scrolling
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
- Reshaping the reducer beyond the one field the similarity view needs (D4). The subject
  union replaces `View.q`; nothing else about R1–R9 is revisited.

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

### D8: A command that changes the view dispatches; nothing builds a URL

*(Numbered last so D2–D7's references stay stable; placed here because D3 and D4 both rest
on it.)*

Two of the six commands move the view — reveal navigates, find similar replaces the grid
with a result set. Under the reducer both are **dispatched actions and nothing else**. A
command never calls `pushState`, never assembles a query string, never touches
`window.history`. The rule is R3's: one effect (`App.tsx:278-287`) serializes `state.view`
through `serializeView` and commits it, fenced by a `urlIntent` the dispatching site leaves
behind and by an advancement test against what the view was at the previous state change.
Four hand-built view literals are what that fence exists to abolish; a menu adding a fifth
would re-open exactly the class of bug — a URL naming a view minus whichever fields the
author forgot — that the reducer change was written to close.

The consequences are mostly that this change gets things for free rather than building them:

- **Reveal is `commit({ type: 'navigate', path, prefs: ownPrefs() })`.** The history push
  D3 wants comes from the landing, which sets the intent by provenance
  (`App.tsx:310` — `{ replace: requestSource === 'restore' }`), so a user-initiated reveal
  pushes. The "flat toggle untouched" promise is the reducer's own behavior: the `navigate`
  case builds its view with `flat: liveView(state).flat` (`reducer.ts:294`). Clearing the
  search that reveal was invoked from is the same case's `q: null`. All three become
  assertions to test rather than machinery to write.
- **Find similar is one new action** asserting a similarity subject, routed to the index by
  the same `askCommitted`/`corpusOf` path a meaning search takes (D4).
- **The other four commands dispatch nothing at all.** Open is the existing tile handler;
  copy path touches the clipboard; re-render and reset framing touch the thumbnail cache and
  `useThumbnails`' own `thumbs` map. None of them changes which entries the view contains,
  so none of them belongs in the view — the same boundary R7 draws around the viewer
  session.
- **The reveal mark is component-local state**, not a view field and not a draft. The
  reducer design's own Open Question decided this shape for `findText`: `drafts` holds only
  text the reducer reads, and nothing in the reducer reads a highlight. It is reset beside
  the `navigate` dispatch and beside the `restore` dispatch — `App.tsx:370-371` and
  `:633-634` — which is where the two existing ephemeral resets already sit.

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
(`ViewerLayer.tsx:366-378`) takes a `Range` over `pathRef.current`, the `<p>` at `:555`
that renders the path inside the info panel: manual copying needs the text rendered and
selectable, which is a fact about the panel rather than about the path. A context menu has
nothing on screen to select, so the fallback has no target there.

It is also defending a case this app does not have. `navigator.clipboard` is undefined only
outside a secure context; the app is served over loopback and headed for Electron, and both
are secure contexts. There is no plan for it to be reachable over plain HTTP. So the copy
succeeds, and the failure path is a brief report that it did not — one sentence of
behavior, identical on both surfaces because it is built from the entry rather than from
whatever happens to be rendered.

This changes shipped behavior, so it costs a `model-viewer` MODIFY: *Lightbox expanded
view* currently requires the panel to select the path text on failure. No other active
change touches that capability, so the modification is free.

**What this rests on, now that the app is meant to run on other machines.** "Loopback and
Electron are both secure contexts" is true because `guard.ts` enforces it: a request whose
`Host` is not `localhost`/`127.0.0.1`/`[::1]` is refused 403 (`guard.ts:4`, `:26`), so the
app cannot be reached by LAN IP over plain HTTP in the first place. The clipboard decision
is therefore downstream of the security design rather than an independent bet — and if that
guard is ever relaxed to allow LAN access, copy silently stops working before anyone notices
the connection. Whoever relaxes it owns this decision too.

*Alternative — `document.execCommand('copy')` over a temporary off-screen textarea:* this
is the standard trick for copying without a secure context or a rendered element, and it
would let the fallback be genuinely shared. Rejected: it is machinery for a deployment
this app does not have, on a deprecated API, and the case it rescues (loopback served over
plain HTTP, or reached by LAN IP) is one nothing in the roadmap creates. Recorded because
it is the obvious clever answer and would otherwise be proposed again as an easy win.

### D3: Reveal navigates, locates, and does not editorialize

Three parts, and the middle one is the point:

1. **Navigate** to the entry's containing folder — for a zip entry, the directory inside the
   archive (`foo.zip!/parts`), which the vpath grammar already addresses. One `navigate`
   dispatch, per D8.
2. **Locate**: scroll the entry into view and mark it briefly — a highlight that fades after
   a second or two. Without this, reveal drops the user at the top of a grid that can be ten
   screens tall and asks them to hunt for the tile they were just looking at, which is most
   of the action's value gone. Scrolling alone is not enough: in a grid of identical squares
   the eye needs somewhere to land.
3. **Push history**, so Back returns to where reveal was invoked from. This is what makes it
   safe to use on a search result: on a cold spinning volume that result set cost ~32s to
   produce, and an action that discards it irreversibly would be one people learn not to
   press.

**Locating waits for the answer, not the request.** The mark is held until a listing lands
and then honored or dropped, which is the shape the deep-linked model already has: the
effect at `App.tsx:645-660` acts only when `state.result !== null && state.inflight === null
&& state.failure === null`, and drops its payload after a successful listing that does not
contain it. Reveal reads the same three-way guard against the same `state.result.entries`.
The one difference is that the model param is a *view field* and reveal's mark is not: a
highlight describes an event, so it is neither in the URL, nor restored by history, nor
carried by a reload (D8's last bullet).

**The flat toggle is not touched.** Revealing from a flat view lands in a flat listing of the
containing folder, which shows that folder's whole subtree rather than its immediate
children. That is a worse view for "see its siblings" and it is still the right call: which
view the user browses in is their setting, and an action that silently rewrites it teaches
them not to trust their own controls. Under the reducer this is not a rule this change
enforces but one it inherits — `reducer.ts:294` carries `flat` across a `navigate` — so the
work is a test, not a guard.

### D4: A find-similar result is a view, and the view has a subject

It goes in the URL, in history, and reproduces for whoever opens the link, like every other
view in this app. The URL names the model the neighbours came from rather than a query
string, since there is no text to carry.

**The view gains a subject, and `q` stops being a field.** `View` today carries
`q: string | null` — "the committed query, null when none is committed" — and a similarity
view is a third thing: committed, but not text. It becomes:

```ts
type Subject =
  | { kind: 'none' }                    // an ordinary listing
  | { kind: 'query'; text: string }     // committed text, read under `View.mode`
  | { kind: 'similar'; model: string }  // neighbours of this model
```

with `View.q` replaced by `View.subject` and every `view.q === null` becoming
`view.subject.kind === 'none'`.

*Why a union and not a second nullable field beside `q`.* R1's thesis is that the shape
should be such that no transition has to remember a list of fields to reset. Two nullable
subject slots re-mint that list at eight sites — `navigate`, `submit`, `toggleFlat`,
`setMode`, `setFolderMatching`, `queryText`, `deferredToName`, plus `endDeferral` and
`standInOf` — each of which would have to remember to clear the *other* slot, and "text and
model both set" would be a representable state with no meaning. Assigning a union member
replaces it; there is no second field to forget. The cheaper diff was considered and
rejected on exactly the grounds the reducer change was written on.

*Why `mode` is not extended to a third value.* `mode` is the corpus a **typed phrase** goes
to. It is a sticky preference (`searchOptions`), re-seeded from `ownPrefs()` on every
`navigate` (`reducer.ts:290-296`), and rendered by the side panel as a two-way toggle over
the search input. A `mode: 'similar'` would put a third button in a control that governs
typing, would be written into a profile's storage as the corpus for their *next* typed
search, and would be able to disagree with the subject. The subject says what the view is
about; the mode says how a phrase is read. They are not the same question.

**Which corpus answers it: one more case in the one function.** `corpusOf(view, index)`
(`view.ts:155-160`) gains `'similar'` and shares `defer`/`wait` with meaning:

```
subject 'similar' → index === null ? 'wait' : index.state === 'ready' ? 'similar' : 'defer'
subject 'none'    → 'listing'
subject 'query'   → the mode gate, exactly as today
```

That single line is the whole of the deferral behavior. A similarity deep link opened while
SigLIP warms goes through R6 unchanged: nothing is fetched in the `wait` window, the `defer`
branch stands in with the location's own nested listing (`standInOf` sets the subject to
`none` and `flat` to false), the phase holds its own provenance so a *restored* deferral
replaces its entry rather than pushing a second one over the link, and the index-ready
branch re-asks `known.view`. `endDeferral` clears the subject rather than nulling `q`.

The banner is where this shows: it must name the subject it is waiting on, which for a
similarity view is a model rather than a phrase, and it must not offer "search names
instead" — there is no phrase to search names with. Its only offer is the dismiss (D9).

**What the request is.** `requestOf` gains
`{ kind: 'similar'; path: string; model: string; k: number }`. No scope is sent to the
index — neighbours are collection-wide, below — so `path` is carried for *identity* rather
than for the server: `sameQuestion` is enumerated over the `Request`, and without `path` two
similarity views of the same model anchored at different folders would compare equal and
take `restore`'s patch branch, which by `patch`'s own rule cannot patch `path` — leaving the
path bar and the dismiss target pointing at the folder the user just left. The `Request` doc
comment (`view.ts:79-87`) says today that the type is "the closed list of what the server is
told"; it must be rephrased as the closed list of what **identifies** the question, with the
anchor's exception named, or the comment is false the day this lands and the field reads as
dead weight to be removed. `sameQuestion` is *not* widened to compare `path` generally.

**What the URL says.** `serializeView`'s gate has two dimensions today — a query is
committed, and the mode that query ran under reads the option. It generalizes to one: **an
option is written only when the subject reads it.**

```
?path=…&similar=<vpath>[&flat=1][&model=…]
```

Under a `similar` subject the serializer writes no `q`, no `mode`, no `nofolders`, no
`kinds`, and no tuning: the index answers with models and nothing else (the same reason a
meaning search carries no `kinds`), and there is no phrase to tune. `path`, the `flat`
toggle (R4 — it survives the search and governs the listing left behind) and `model` are
written exactly as before. So the source model really is the complete description of the
view, which is what naming it by model alone claims — and two similarity views differing
only in options neither of them reads serialize alike, so they are one view under `sameView`
and mint no history entries that go nowhere. That is the mode gate's own property, inherited
rather than re-argued.

`k` is a module constant: not a view field, not a URL param. Nothing on screen sets it — the
side panel's controls are meaning-query controls — so a URL field for it would name a
distinction no view makes. If it ever becomes user-settable it becomes a view field then and
the gate carries it like tuning. The index's `pool` parameter is left at the server's own
default for the same reason.

*The value is 16* (`SIMILAR_K`, `state/view.ts`, landed with the subject). Chosen rather
than inherited from either end: the index's own default is 10 and this app's text-query
bound is 60. Above the index's, because a grid of ten leaves most of a row empty at the
`minmax(11rem,1fr)` track width; well under the text bound, because neighbour quality falls
off faster than text-match quality does — a phrase's 40th hit can still be the one you meant,
while a model's 40th neighbour is noise. It is compared in `sameQuestion`'s similar arm even
though it is constant, so the "closed list of what identifies the question" stays literally
true the day it becomes a variable.

`parseUrl` keeps its deliberate leniency (`urlState.ts:37-45`): a hand-edited URL carrying
both `q` and `similar` resolves as the similarity view — the parameter naming a subject is
the more specific one — and the stray `q` rides along harmlessly, read by nothing.

*Corrected while implementing this:* that comment claimed the stray is scrubbed by "the
first commit", and it is not. `commitUrl` declines a write whose serialization already
matches the address bar's, and a param both sides drop cannot make them differ — so the
stray stays visible until the view genuinely advances and the whole URL is rewritten. That
was already true of a `pool` beside `mode=name` and is inherited rather than introduced;
the comment is now amended to say what the code does. Nothing reads the stray meanwhile,
which is why it is tolerable rather than a bug this change fixes.

`optionsOf` is untouched: a similarity link commits no *query*, so the
recipient's own four preferences govern, which is right twice over — the similarity view
reads none of them, and they are what governs the plain listing the dismiss returns to.

**Neighbours are drawn from the whole collection, not the browsed folder.** The index's
`/similar` takes an optional `scope` and defaults to the whole collection; this change states
that default as a decision rather than inheriting it, the same way it refuses to inherit `k`
(the index's default is 10). Meaning search is rooted at the browsed directory because a
phrase is a question about a place — "dragons in this kit". "More like this one" is not:
scoped to the folder the model sits in, it would mostly return that kit's other parts, which
is the one answer the user already has on screen.

Two consequences worth stating. A similarity view has no typed text to clear, so it needs an
explicit way out — which turns out not to exist yet (D9). And a model can fail to be a valid
subject: the index 404s a path it has never embedded, and a zip-resident model can never be
embedded at all (`classify_stls.py` walks real `.stl` files on disk — its own failure message
is "no STL files found under …" — and archives are unpacked before classification, so a
`zip!/` vpath is never a key on either side). Those are different sentences and the UI owes
the user the difference.

Availability is decided optimistically rather than by pre-checking every tile: the menu
offers the action wherever it could plausibly work — a model, inside the indexed collection,
not in an archive — and explains the failure when it comes. Asking the index about every
tile in a 500-tile grid to grey out a menu item nobody has opened is not a trade worth
making.

**What the render has to be taught.** Two selectors read the subject through `q` today and
would go quietly wrong rather than fail:

- `labelInputs` (`selectors.ts:106-121`) builds the results label from `forView.q`. Under a
  similarity result that is `null`, so the label renders blank *and* `searchHasNoMatches`
  (`App.tsx:749`, `label.query !== null && entries.length === 0`) never fires — which is the
  gate in front of every "nothing matched" sentence, so an empty similarity result would
  fall through to Grid's bare "Nothing to show here."
- The deferred banner reads `state.view.q` (`App.tsx:252`), so a deferred similarity view
  would show no banner at all — the one state whose whole purpose is to explain itself.

Both are named work in tasks.md rather than left to be discovered.

### D9: Leaving a similarity view — the exit this change turns out to have to build

The original draft said to reuse the dismissal `semantic-search` introduces for meaning
results: "one affordance, two entry points, not two". The rebase found there is no such
affordance. The only way to leave a committed search today is emptying the search input
(`reducer.ts:350-358`), and `FindBar`'s ✕ (`FindBar.tsx:70`) dismisses the *filter*, not the
search. Worse, that exit is structurally inert for a similarity view: the `queryText` case
returns early when the live view has no committed query of its own, and there is no text in
the input to empty in the first place.

So a similarity view would have no way out but navigating or Back. That is a trap, and
shipping it while deferring the exit to a later change ships the trap — so the affordance is
built here:

- **One transition, `clearSubject`**: the subject becomes `none`, any deferral ends on the
  way through, and the location's ordinary listing is re-asked. It asserts at landing like
  any other fetch.
- **The empty-input path delegates to it** rather than keeping its own copy of the rule, so
  "the same dismissal" is one implementation and not a resemblance.
- **One visible control**, rendered for any committed subject — text or model — beside the
  results label. That is what makes the entry-actions scenario literally true rather than
  aspirationally true.

This is scope the change always had; the rebase only discovered that the thing it planned to
reuse was never built.

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
degradation `semantic-search` designs for, arriving here. The availability the menu reads is
`state.index` — the reducer's own cell, kept by identity when a poll says nothing new
(`reducer.ts:442-445`) — not a fresh probe per menu.

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
mechanical: `useThumbnails.ts:139-144` already treats a cached hit whose `lighting` or
`rig` differs from the current values as stale, but that check only runs when the effect
re-runs, and its deps are `[entries, api, lru, queue, setThumb]` (`:247`) — lighting is not
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
wrong: `server/src/cache.ts:104-105` merges with `camera: opts.camera ?? prev?.camera` (and
the same for the axis), so an omitted camera means *keep* and there is no way to clear one —
and a written default is not a discard. `useThumbnails.ts:194-196` offers a model the index's
pose only when it has neither a stored camera nor a stored axis, so storing a default would
permanently disqualify that model from being posed. Reset framing would leave a model
strictly worse off than one nobody had ever touched: the action for a badly framed thumbnail
would be the action that guarantees one.

So this change carries a `model-thumbnails` MODIFY adding *discard* as a third thing a write
can say about the camera, alongside *set* and *say nothing*. That is a small protocol
addition rather than a new route — `putThumb` still writes png, camera, axis, lighting and
rig together, and re-render still writes back what it read. The **read** half of that
requirement's rebased prose — that a read reports a missing axis rather than substituting
+Y — is already shipped behavior (`server/src/cache.ts:72-78`, comment and all); it is
carried in the delta because main's text still says the old thing, not because it is work.

**A discarded orientation resolves the way an untouched model resolves**, which is the pose
when the index has one and the default otherwise — and that is why reset framing discards the
axis too whenever a pose is there to replace it.

The axis is not separable from the pose's angles. `cameraForPose` (`client/src/three/pose.ts`,
`:80-110`) derives camera *and* axis together, because the azimuth offset is computed in
`frameFor(axis)`: a pose's angles describe a view about the pose's own up axis and mean
something else about another. And `useThumbnails.ts:194-196` offers the pose only when *both*
stored values are absent, precisely because half a pose is not a pose. So "hand the model back
to the index" has to hand back both or neither.

Hence the rule: reset framing always discards the camera, and discards the stored axis as
well **when a usable pose exists for that model** — usable meaning `cameraForPose` returns
non-null, so a malformed pose (an off-axis `up`, an `azimuth_zero` that is not perpendicular
— `pose.ts:85-92`) leaves the axis alone rather than trading a real axis for a default one.
With no pose available there is nothing better to fall back to, so the axis stays and the
model is framed by default about it.

**"Usable" is `cameraForPose`'s answer and nothing else.** A pose with no cached front view
is a tempting exception — its angles default to 0, so it orients the model without framing
it — and taking it would be wrong twice. `pose.ts:97-101` keeps that pose on purpose ("the
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
the tile re-renders in place, and the axis does change tile pixels, since `stageModel`
(`renderer.ts:309`) and `applyState` (`camera.ts:81-85`) both take it. The command/control
line and the Z-up outcome carry the decision; "nothing shows it" no longer does.)
It stays in the lightbox, which already has the picker and its flip toggle. The index
supplies the axis anyway wherever it has a pose.

*Refreshing the visible grid on a mode change is a separate change, and it is now an active
one:* `lighting-refreshes-thumbnails` makes the mode an input to the sweep. Note this was
never a defect being worked around — `model-thumbnails`' *Lighting-mode-aware thumbnails*
specifies the upgrade as lazy, and three of its four scenarios time it to a visit ("revisits
a directory", "a directory is visited", "a directory is visited"; the fourth is about
lighting matching at handoff and says nothing about when) — so the code matched its spec, and
changing it is a change to that requirement rather than something a menu should have done.
Until it lands, navigating away and back is the bulk answer and these items are the per-tile
one; afterwards they still are, because a tile can be wrong for reasons a sweep cannot see.
The two changes MODIFY different requirements of that capability and collide only in the
file, which tasks.md declares.

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
- [Replacing `View.q` touches the state layer three weeks after it landed] → the change is
  mechanical (one field becomes a union, every `=== null` becomes a `.kind` test) and the
  reducer's unit suite is what judges it; the alternative kept an impossible state
  representable (D4). tasks.md declares hard ordering against the other changes editing
  these files.
