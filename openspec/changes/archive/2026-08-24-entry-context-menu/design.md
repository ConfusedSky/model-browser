# Design — entry-context-menu

Line citations in sections 1–5 and D1–D9's original text are against `baa7010` (post
`search-view-reducer`); the follow-up (6.x) passages added after implementation cite the
tree as of their own landing — where the two disagree inside one decision, that is why.
This change was first written against the pre-reducer App and has been rebased onto the
state layer: every citation below was re-checked against that commit, and the ones that
named `useState` cells or refs the reducer deleted are gone rather than renumbered.

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

*Revised 2026-08-22 (6.7): the spindle turned out to sit on **both** sides of this line.*
Rotating a live view is a control and stays in the lightbox; *which spindle a model is
stored about* is a fact about the model, and setting it from its tile is one-shot and leaves
no mode behind. The tile menu offers the six axes, both viewer surfaces withhold them, and
the picker is untouched. D7 carries the whole argument.

### D8: A command that changes the view dispatches; nothing builds a URL

*(Numbered last so D2–D7's references stay stable; placed here because D3 and D4 both rest
on it.)*

Two of the six commands move the view — reveal navigates, find similar replaces the grid
with a result set. Under the reducer both are **dispatched actions and nothing else**. A
command never calls `pushState`, never assembles a query string, never touches
`window.history`. That sentence is the *commands'*, not the whole app's: the one exit that
does walk history — the dismissal's `history.go(-similarDepth())` (follow-up 6.3, D9's
depth rule) — is App's own `leaveSubject`, not a command, and goes backward through entries
the projection wrote rather than minting any. The rule is R3's: one effect
(`App.tsx:278-287`) serializes `state.view` through `serializeView` and commits it, fenced
by a `urlIntent` the dispatching site leaves behind and by an advancement test against what
the view was at the previous state change.
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

**Where that report is rendered (task 1.1a, decided at apply).** Nothing in `client/src`
renders a toast, and inventing one would be a third transient surface beside the two that
already exist. So the split is: the *sentence* is shared — `COPY_FAILED` in the action
module, which is what makes "reported the same way from either surface" true — and *where
it appears* is the invoking surface's own business. The info panel keeps its own line,
beside the button that already says "copied". The menu's goes to the path bar's transient
line, as a **component-local override at that one call site in `App`** — deliberately not a
new reducer failure kind. `state.failure` belongs to a *question*: it carries the `forView`
it was asked for, and the next answer clears it. A clipboard refusal belongs to no
question, so routing it there would mean minting a `forView` for something that never had
one, and would let the next landing silently clear a message about an unrelated act. One
sentence, two places to put it, and no third surface for anyone to build.

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

~~`k` is a module constant: not a view field, not a URL param.~~ **It became user-settable
(task 6.2), and this paragraph's own prediction is what happened.** What it said was: "Nothing
on screen sets it — the side panel's controls are meaning-query controls — so a URL field for
it would name a distinction no view makes. **If it ever becomes user-settable it becomes a view
field then and the gate carries it like tuning.**" The side panel now has a similarity block,
so `k` is a field and the gate carries it. The prediction is recorded as kept rather than
deleted, because the *reason* it gave is the reason the new shape is right: a URL param earns
its place by naming a distinction some view actually makes, and the day something on screen
makes that distinction is the day it earns it. Nothing about the gate loosened.

The same paragraph left the index's `pool` at the server's own default on the same grounds, and
the same thing happened to it — with one difference worth keeping. `k` has a default *this app*
chose (`SIMILAR_K`, below), so its absence from a URL means 16. `pool`'s default belongs to the
index — whatever `serve_api.py --pool` was started with — so its absence means **that**, and
this app must not name a value on the index's behalf to represent it. Hence: `pool` is written
only when set, sent only when set, and the panel's trio renders with none of the three pressed
until somebody presses one. Task 4.2's "there is no code for it beyond the absence" is now
"the absence is the code": one `undefined` carried from the subject through `requestOf`, the
`ApiClient` call, the route, and `similar()`, each layer dropping the field rather than
substituting for it.

**Where they live: on the subject, not beside it.** `Subject`'s `similar` arm carries
`{ model, k, pool? }` rather than `View` gaining sibling fields. A sibling would re-mint exactly
the reset list the union abolishes — every transition that leaves a similarity view would have
to remember to clear it — and would make "a query subject with neighbour parameters" a
representable state with no meaning. This is the union's own argument, applied a second time;
that it applies again is the evidence it was the right shape.

**They are not sticky, and that is deliberate.** The four search options are stored per profile
because they describe how *you* search. These describe one neighbourhood: a count that suited
this model's says nothing about another's, and a stored one would silently shape every later
find-similar from a decision made about an unrelated model. So the URL carries them — a
neighbourhood worth showing someone reproduces for them — and the next find-similar starts from
the defaults. A view worth keeping is kept by keeping its link, which is the same answer this
app gives for every other view.

*Where they render, revised 2026-08-22 (user-requested).* They were a "Neighbours" block inside
the search tab; they are now the whole of a **Similar** tab of their own. The search tab keeps no
similarity content — its four options answer "how do I search", and a neighbour count answers
something else, so sharing a pane made one tab mean two things. The tab is the heading, so the
block dropped the one it carried. Three lifecycle rules, because a tab that depends on a subject
is not the same object as a tab that is always there: it is **listed only while there is a
similarity view** (the applicability idiom the options inside it already follow, one level up —
absent, never greyed); **arriving at a similarity view selects it only from the search tab**,
never from chat, because the tab in force is the only evidence of what the user was doing with
this panel and a half-typed message must not lose its pane to a menu item clicked out in the
grid; and **leaving the view falls back to the search tab**, since a tab about to stop existing
cannot stay selected. The **store never records it** — `StoredTab` is `Exclude<Tab, 'similar'>`,
so writing it does not compile — because a profile restored onto a Similar tab with no similarity
view would open on a tab that is not there. Old profiles need no migration: the parse already
reads anything that is not `search` as `chat`. Presentation only; no reducer, URL, or server
surface moved.

**The re-ask is a re-ask, not a patch.** `sameQuestion`'s similar arm compares `k` and `pool`
alongside `path` and `model`, which is what the `Request` type's "closed list of what
*identifies* the question" was written to make true the day these became variables. Left out,
a Back across a parameter change takes `restore`'s patch branch: the old answer kept on screen
while the URL, and the panel's own spinner, claim a count the index was never asked for.

**No record-only phase.** `setTuning` has one — a value the reducer records without running,
so a typed number does not mint a history entry per keystroke — and the similarity parameters
deliberately do not. There is nothing for the reducer to hold: a parameter here either re-asks
or has not happened yet. So the debounce lives in the control that types the digits
(`SidePanel`'s `countText` draft, the `topText`/`scoreText` pattern with a timer beside it),
and the transition always asks. It goes through `askCommitted`, so a re-parameterisation while
the index is warming defers exactly as a fresh find-similar would rather than firing at an
index that cannot answer.

*Verified against the index's source while implementing 4.1* (`docs/api/surface.md`
§`POST /similar` and `src/api.py:404-441`, read with the service down). Every claim in this
section holds. Two facts the surface doc states less prominently, recorded so the next reader
inherits them rather than rediscovering them:

- **The 404 is not the only refusal.** `/similar` also answers **422** for a virtual (`!/`)
  path and for a `path` naming more than one model. Both are refusals to fix rather than
  "this model is not embedded", which is why the server maps 404 alone through as a 404 and
  leaves every other 4xx on 400 — reading a 422 as the fixable kind would tell the user to run
  the classifier over a path it can never hold.
- **An empty answer is an answer.** A scope containing only the query model returns
  `{results: []}` rather than an error, because a model is excluded from its own ranking (it
  scores 1.0 and skews the z). So "no neighbours" is an ordinary landing, which is what
  4.6b's empty-result sentence is for.

*The default is 16* (`SIMILAR_K`, `state/view.ts`, landed with the subject; the *default* rather
than *the value* since 6.2). Chosen rather
than inherited from either end: the index's own default is 10 and this app's text-query
bound is 60. Above the index's, because a grid of ten leaves most of a row empty at the
`minmax(11rem,1fr)` track width; well under the text bound, because neighbour quality falls
off faster than text-match quality does — a phrase's 40th hit can still be the one you meant,
while a model's 40th neighbour is noise. It was compared in `sameQuestion`'s similar arm while
it was still constant, so that the "closed list of what identifies the question" would stay
literally true the day it became a variable. *That day is 6.2, and the arm needed no change
beyond adding `pool` beside it* — which is the payoff for having compared a constant.

`parseUrl` keeps its deliberate leniency (`urlState.ts:37-45`): a hand-edited URL carrying
both `q` and `similar` resolves as the similarity view — the parameter naming a subject is
the more specific one — and the stray `q` rides along harmlessly, read by nothing. `k` reads
by the same rule: a value the index would refuse (non-integer, `< 1`, `> 1000` — the server's
own bounds) reads as *absence*, which resolves to `SIMILAR_K`, rather than as an error over a
link that names a perfectly good view.

One shape worth stating, because it looks like duplication and is not: `pool` is **one** URL
param with **two** possible readers — a meaning view's tuning, and a similarity view's own —
and they can never both be in force, because the subject decides which reading applies and a
view has one subject. So `parseUrl` reports it twice (into `tuning.pool` and into `UrlView.pool`),
`resolveView` assigns whichever the subject reads, and `serializeView` writes it from whichever
gate is open. The parser reports; the resolver assigns. Giving the similarity reading its own
slot rather than borrowing `tuning.pool` keeps `UrlView.tuning` honestly meaning *the view's
tuning* — under a similarity subject it is not that, and a `pool` smuggled through it would be
a lie in the type that exists to be the one honest report of a URL.

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

*Extended at 6.3, and the one-rule requirement is what shapes the extension.* The exit above
always returns the location's listing, which is right for a link and wrong for the case the
live run exposed: a similarity view raised **from inside the app** replaced a view the user
was looking at — often a search result that cost ~32s on a cold spinning volume — and
dismissing threw it away and re-walked the folder instead. That is D3's own argument for
reveal pushing a history entry ("an action that discards it irreversibly would be one people
learn not to press"), arriving at the exit rather than at the entrance.

So the dismissal branches on **provenance**, and the branch is inside the one function:

```
leaveSubject(otherwise):  isSimilarEntry() ? history.go(-similarDepth()) : commit(otherwise)
```

Two call sites — the ✕ passes `clearSubject`, the empty-input path passes its `queryText` —
and zero copies. D9's requirement is *one rule*, not *one destination*: two implementations
that both branched would be the two-that-resemble-each-other it refuses, while one function
with a branch is one rule that knows two things. Query-subject dismissal is untouched, which
is not a special case but a consequence: a query landing never marks its entry, so the branch
is never taken there.

**How the provenance is known.** Through the projection's existing `state` channel, exactly as
`LIGHTBOX_ENTRY` (R7 bridge 1): the fetch effect's `land()` stamps `SIMILAR_ENTRY` when
`request.kind === 'similar' && requestSource === 'user'`. The browser keeps state per entry, so
it survives reload and forward/back — an in-memory flag would not, and a forward-restored
similarity view would then dismiss down the deep-link path, which is the bug the lightbox
marker was introduced to avoid.

**How far back, revised after live verification 2026-08-22.** One hop was wrong, and the run
that found it is the same shape as the one that motivated the branch: tune a view twice — `k`,
then the pool — and press ✕, and it took three presses to leave, the first two landing on
intermediate parameter sets the user had already moved on from. The cause is not a bug in the
tuning: each re-tune *must* push its own marked entry, because a different parameter is a
different question and Back must reach the neighbours actually shown (R4's own rule). So a
similarity excursion is a **run** of marked entries, not one, and "the view it was raised from"
is the entry before the run — not the entry before the top of it.

The marker therefore carries a **depth**: `SIMILAR_ENTRY` becomes a factory stamping
`{ similar: true, depth: n }`, `land()` computes `n` as `similarDepth() + 1` read from the entry
still current at stamp time, and the exit is `history.go(-similarDepth())`. A landing from a
non-similarity entry stamps 1; a re-tune and a chained find-similar each stamp one deeper, so
chained find-similars still need no special case — they were the case that already worked by
accident, and the depth is what makes tuning work by the same rule rather than by a second one.
Dismiss exits the whole excursion in one press; Back is untouched and still walks the steps
individually, which is the division the two gestures should have had all along: Back retraces
questions, Dismiss leaves the subject. This revises the landed "each press unwinds one hop"
behavior and the test that pinned it. `similarDepth()` reads the *current* entry, which the
browser restores, so a Dismiss from an entry reached by Back goes back by that entry's own depth
and is right for free.

**Why a restore landing cannot gain or lose the marker, verified rather than assumed.** Gaining
is closed by the `user` gate. *Losing* is the one that needed checking, because the restore
intent is `{ replace: true }` with no `state`, and `commitUrl` would write `null` over an
entry's state if it wrote at all. It does not: a Back onto a marked similarity entry has already
had its URL rewound by the browser, so the landing's serialization matches the address bar and
`commitUrl` declines the write entirely — marker and depth included. The dedupe *is* the
preservation. The only restore landings that do advance the URL are ones whose entry never
matched the resolved view (a hand-edited link with a stray param), which carry no marker to
preserve and must not gain one. Pinned twice: as a unit case over `commitUrl` directly, and as
an App case that Backs onto a *tuned* in-app similarity view and dismisses again — the depth
has to survive the restore for that press to leave the excursion rather than a step of it.

*Revised while implementing 4.1–4.6, and it reverses a sub-ruling taken at Stage A.* Stage A
decided the `similar` transition should leave `drafts.queryText` alone, on the grounds that
the draft is the user's text and no transition should throw it away unasked. That is wrong
here, and the reason is this section's own rule. Text left in the input under a similarity
view relates to nothing on screen — it was typed at a search the view is no longer about —
and erasing it is the natural gesture for a stale box. But erasing it runs `leaveSubject`,
because the empty-input path delegates there. So the tidying gesture silently destroys the
view, and the delegation that makes "one dismissal" true is what makes the trap possible.
`similar` therefore clears the draft on entry, exactly as `navigate` does: the input then says
what is true — nothing textual is committed — and typing-then-erasing still dismisses by the
one rule, so the delegation keeps a user-visible instance rather than becoming unreachable
machinery. One line in the reducer, one case in the unit suite.

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
axis X Y Z | flip    —               —
Open                 Open            Open
Reveal in app        Reveal in app   Reveal in app
Copy path            Copy path       Copy path
Find similar         —               —
Re-render thumbnail  —               —
Reset framing        —               —
```

The first row is the axis group (follow-up 6.7, reshaped by 6.8's second look, and D7's
revision below): the picker's four buttons — three letter pills and a flip — above the
commands on a **model tile**, the letter in force marked. It is model-only for the thumbnail
items' structural reason — a container tile is a glyph with no spindle — and it is a group
rather than a seventh command, with no row in `ENTRY_COMMANDS`: `orbitAxisApplies` answers
for it, under the same per-kind rule and the same per-surface filter.

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

**The lightbox gets a shorter menu — and the table did not change.** *(Added 2026-08-22,
with the fix for a user-reported right-click that reached nothing: both overlays swallowed
`contextmenu` before the tile beneath could see it, and the orbit overlay keeps sitting
over that tile invisibly through the persist hold after a release. Narrowed from "either
viewer surface" to the lightbox on the same day — see the margin below.)* A menu raised on
the lightbox offers three items — *reveal*, *copy path*, *find similar* — the ones that do
not care which surface asked. Three are withheld, for reasons about the **surface**, not
the entry:

- *Open* would re-open the model that is already open.
- *Re-render thumbnail* and *reset framing* cannot honestly run from an open lightbox. Both
  wait on `queue.whenResumed()` before touching the renderer (4b.6) and the view holds
  that suspension (architecture D2/D3), so they would sit for as long as the user leaves it
  open — and then the closing persist races them, writing the orbited camera straight back
  over the discard *reset framing* was pressed for. Offering an item that quietly loses a
  coin-flip against the gesture that dismisses it is worse than not offering it.
- The **orbit-axis group** goes for a third reason, its own (6.7): the lightbox already
  carries the live picker, which sets the same thing and shows the spindle rotating as it
  does it. A menu duplicate over it would be a second affordance for one choice — and the
  worse of the two, since its write would then race the same closing persist.

That is a **per-surface filter at the call site** — `commandsFor`'s third argument, from
the `LIGHTBOX_MENU_EXCLUDES` list — rather than a seventh column in the table above. The
table stays the one answer to "what does this *entry* offer"; a row that also had to know
where it was being rendered is how the two would come to disagree about the same model.

**The orbit overlay is not one of the surfaces that filters, and the reason is that it is
not a view the user opened.** *(Added 2026-08-22, follow-up 6.8, from a user's screenshot:
right-clicking a tile a second after orbiting it produced the three-item menu, because the
overlay lingers over that tile invisibly through the persist hold and this filter was
keyed on "a viewer is mounted".)* Read the three reasons above and every one of them is
about an **open** view: it holds the renderer for as long as the user leaves it open, it
carries the live picker a few pixels away, and it ends in a close that persists what is on
screen. A transient overlay over a tile is none of those. It carries no picker at all (the
`left-3 top-3` row is drawn in the lightbox branch only), and it is gone within
`PERSIST_HOLD_MS` of the release. So the overlay gets the **whole tile menu**, group
included: as far as the menu is concerned, a lingering overlay over a tile *is* that tile.

The one thing worth stating rather than assuming is the **ordering against the overlay's
own closing PUT**, since the three items just restored are the ones that write. The
`whenResumed()` gate that made them dishonest under a lightbox is what *sequences* them
here. `dismissAfterPersist` awaits the settle→persist chain before `onDismiss`, the queue
resumes when the overlay unmounts, and only then does the queued body run — so it reads
(`getThumb`) the orientation the persist has just written and acts on that, rather than
racing it. The axis group needs no read at all and writes `axis` + `camera: null` after the
same gate; the mark it shows is the thumbs map's axis, which an orbit drag never moves
(a drag persists a camera, never a spindle), so a persist in flight cannot make the mark
wrong. *Open* is the promote path by another name — a newer `viewer` replaces the held
dismissal's, which `dismissAfterPersist` already stands down for (D4's "a held dismissal
yields to any newer interaction").

The one gap: `dismissAfterPersist` races the chain against `PERSIST_HOLD_MS`, so a persist
slower than 1.5s unmounts the overlay and resumes the queue while it is still in flight,
and the two writes then interleave. That window is not new and is not this filter's —
the background sweep's own queued renders resume into it identically — and the cost is a
command that has to be pressed again, on an overlay that is by then gone.

**The lightbox's info panel is a third surface, and its list is deliberately not the
menu's.** *(Added 2026-08-22, follow-up 6.6: the actions were reachable only by right-click,
which is not an affordance.)* The panel offers *reveal in app*, *find similar* (under the
same availability rule) and *reset framing*, and the asymmetry with the list above is about
the **body**, not the surface:

- *Reset framing* is withheld from the menu and offered here because the panel's press runs
  a different body. `resetFramingLive` does the store half now — a png-less PUT discarding
  the camera, and the axis with it exactly when a usable pose replaces it — and the live
  half now: it re-frames the open session to what the model resolves to (`cameraForPose`,
  else the default about the spindle it keeps) and clears the session's claim on the
  orientation, so the closing persist writes pixels and no camera. Without that last step
  the close resurrects what the user just discarded, which is precisely why the queued
  body cannot be offered from here.
- **Re-render thumbnail stays out of both**, and not for the queue's reason alone: the
  lightbox's closing persist already snapshots the live view under the lighting mode and
  `RIG_VERSION` in force now — it **is** the re-render, arriving on the way out. An item
  for it would be a button asking for what closing the view does anyway.
- *Open* is out for the menu's reason, and *copy path* because the panel already carries it
  beside the path it copies, with its own confirmation. Two affordances for one command in
  one panel is a duplicate, not an accelerator.

`LIGHTBOX_MENU_EXCLUDES` is therefore unchanged by 6.6, and `LIGHTBOX_PANEL_EXCLUDES` sits
beside it with the asymmetry recorded where both are defined. Same mechanism as above — a
per-surface filter at the call site, never a column in the table. Both lists name the
lightbox and only the lightbox, which is the shape to read them in: **one surface, two
affordance sets.** The orbit overlay filters nothing and has no panel at all.

**Escape while that menu is up.** The menu is the thing on top and owns Escape, so the
lightbox's own handler stands down for exactly as long as it is raised, and the next press
closes the lightbox as before. This is 2.3's idiom reaching a second contender: a ref read
live (`menuOpenRef`, already held for the find control), not `stopPropagation` and not
listener order — the ref is still true for the whole of the dispatch that closes the menu,
so the outcome does not depend on which window listener ran first.

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

**A discarded orientation resolves the way an untouched model resolves, as far as the view
can know it** — the pose when the view's own landed answer carries one (`host.poses`, populated
by a meaning or similarity landing; a plain listing carries none) and the default otherwise —
and that is why reset framing discards the axis too exactly when a usable pose is there to
replace it, and leaves it standing when the view cannot know of one. The command's reach is
the view's knowledge (review ruling, 2026-08-22): a kept axis on a plain listing is the user's
own choice winning, not a gap.

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

**The axis is not a third item**, by D1 — *revised 2026-08-22 (follow-up 6.7, reshaped by
6.8's second look): it is the picker's four buttons — letters and a flip — at the top of the
menu, on model tiles.* The argument that stood here said the orbit-axis picker is a
control, bound to a live view and showing the spindle rotating to screen-up as it changes,
so a menu item setting a persisted spindle would be a spindle change made outside the view
that shows what one means — and on a Z-up model it would lay the model on its side, the
outcome the animated rotation exists to make legible. (An earlier form had said a menu item
would show *nothing* of the result; the two thumbnail items falsified that, since the tile
re-renders in place and the axis does change tile pixels — `stageModel` (`renderer.ts:309`)
and `applyState` (`camera.ts:81-85`) both take it.)

**What was wrong with it: it read one sentence as two claims.** Rotating a live view to a
new spindle is a control, and stays one. *Which spindle this model is stored about* is a
fact about the model, and setting it is one-shot, completes on its own and leaves no mode
behind — a command by D1's own test, exactly as *reset framing* is one, which already moves
the axis (above). The Z-up worry does not survive the answer either: the tile re-renders
about the chosen spindle, so the model laid on its side is *on screen* rather than hidden
until the next open, and it was the user who named that spindle rather than a command
guessing at one on their behalf. That leaves "the menu cannot show it", which was already
retired.

So a **model tile's** menu offers the axis as the picker offers it — `axis  X  Y  Z | flip`
(`AXIS_LETTERS`, `axisWithLetter`, `negatedAxis`, `setOrbitAxis`) — with the model's current
spindle stated the picker's way, its letter marked and `flip` pressed when it is negated,
read from the thumbs map and defaulting to `y` where nothing is stored. The **lightbox
withholds the group**
(`'orbitAxis'` in `LIGHTBOX_MENU_EXCLUDES` and `LIGHTBOX_PANEL_EXCLUDES`): the picker is
right there, live, and a menu duplicate would race the closing persist. The orbit overlay
offers it, exactly as the tile under it does — it carries no picker of its own (6.8).

It is drawn as a **compact pill row at the top of the menu**, not six full-width rows at
the bottom *(user feedback 2026-08-22, 6.8)*. Six of a twelve-row menu spent on the axis
read as the menu's subject rather than as one property of the model; and pills are the
vocabulary the lightbox's picker already taught, down to the mark — the spindle in force is
the *filled* pill on both surfaces rather than a tick on one and a fill on the other, with
`aria-checked` carrying it either way. The keyboard model is unchanged: `focused` is still
one index over the menu's buttons, the group is still entered at the spindle in force, and
moving it above the commands only moves which crossings that rule catches (Up off the first
command, and the wrap off the last). The menu opens on its first *command*, which is what
the menu is for.

And the row is the picker's **four** buttons rather than six pills *(second look at 6.8,
same feedback thread, from a screenshot of the picker)*: `axis  X  Y  Z | flip` — three
letter pills, a divider, and a flip pill that is amber when the spindle is negated. Six
pills had borrowed the picker's *look* while contradicting what it taught, which is that a
spindle is a letter and a sign; so the behaviour is mirrored with the shape. A letter keeps
the sign in force (`−Z` then `X` is `−X` — the sign is `flip`'s to say, and pressing a
letter is not pressing it), `flip` negates. One command still runs underneath: every press
is a `setOrbitAxis(entry, host, chosen, current)`, whose no-op guard now catches the active
letter, while `flip` names a spindle the model is not about either way and is never a no-op.
The rules and the four class strings live in `entryActions` — the module both surfaces
already import, and the only home that does not close a cycle, since `ViewerLayer`, where
the look belongs, already imports `EntryMenu` — and `ViewerLayer`'s picker draws from them,
so there is one copy rather than a copy and a transcription. The keyboard rule survives in
its own shape: the group is four focusables walked letter-letter-letter-flip, and entering
it lands on the **letter** in force. Roles are split, since the halves ask different
questions — the letters are `menuitemradio`, `flip` is `menuitemcheckbox` — which the
button-counting `step` never notices.

**A pick writes the axis and discards the camera**, in one PUT (`axis: <picked>`,
`camera: null`). This is D7's own rule read the other way round: angles measured about one
axis do not describe a view about another — the reason `cameraForPose` derives camera and
axis together and the azimuth offset comes out of `frameFor(axis)` — so a camera recorded
about the old spindle is not a worse view about the new one, it is a meaningless one. The
thumbnail is then redrawn at the default about the new spindle, which is what an ordinary
visit resolves to for a model with an axis and no camera (`useThumbnails.ts:222-223`), so
the tile and the next sweep agree. `lighting` and `rig` ride along, since `cache.ts:108-110`
clears every label a PNG-bearing PUT omits and an unlabelled write re-renders this tile for
ever; **`posed` deliberately does not**. The pose path needs both a missing camera and a
missing axis, so a stored axis takes the model out of pose framing for good — which is what
choosing an axis *means*: the user has said which way up this model stands, and an index
that disagrees no longer reframes it. Picking the spindle already in force does nothing at
all: no PUT, no render, not even a mesh load.

The picker itself stays in the lightbox, with its flip toggle and its tween. The index
still supplies the axis wherever it has a pose and the user has chosen none.

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
