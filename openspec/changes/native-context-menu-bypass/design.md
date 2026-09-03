# Design — native-context-menu-bypass

## Context

Three handlers call `preventDefault` on `contextmenu` unconditionally, which
is what suppresses the platform's menu: the folder/zip tile's and the model
tile's `onContextMenu` in `Grid.tsx`, and `raiseEntryMenu` in
`ViewerLayer.tsx`, which both the orbit overlay and the lightbox attach. The
tiles call App's `onEntryMenu`; the viewer calls App's `onViewerEntryMenu`
(which adds the surface and the live framing view); both converge on App's
one `menu` state that mounts `EntryMenu`.

The keyboard reaches the menu through `onMenuKey` in `Grid.tsx`, the tile's
`onKeyDown`: on the context-menu key or Shift+F10 it calls `preventDefault`
on the *keydown* and raises the menu itself, anchored to the tile by
`menuAt`'s `(0, 0)` branch. What the browser does after that was measured
for this change (opus review, Chrome 150, Linux/X11, re-runnable with the
snippet in D3): a prevented keydown suppresses the `contextmenu` event that
would have followed, so the tile's `onContextMenu` never sees a
keyboard-originated event in Chrome; and when one *is* dispatched (keydown
not prevented) it arrives at the centre of the focused element with `button:
-1`, never at `(0, 0)`. The first draft of this design assumed `(0, 0)`; it
was wrong (D8 F1).

`EntryMenu` dismisses itself on window-level **capturing** listeners for
`pointerdown`, `contextmenu` and `wheel` when the target is outside the menu.
React 19 delegates `onContextMenu` at the root in the bubble phase, so a
window capture listener runs before any tile handler.

The viewer's gesture lives on window listeners installed by a
`useLayoutEffect`: `onMove` orbits while `pointer.current.down`, and `onUp`
ends the gesture — promoting to the lightbox on a press without drag,
otherwise settling and persisting the view. `onUp` checks
`pointer.current.down` and nothing else: the release of *any* button ends
the primary's gesture.

Firefox already implements this gesture below the page: with Shift held it
does not dispatch `contextmenu` at all (`dom.event.contextmenu.shift_suppresses_event`,
default true; a pref to disable it arrived in Firefox 117), so the platform
menu appears whatever the page would have done. Chrome dispatches the event
with `shiftKey` set and leaves the decision to the page.

## Goals / Non-Goals

**Goals:**

- One gesture, on every surface that raises the entry menu, that reaches the
  platform's context menu — the viewer surfaces included, for Inspect and
  extension items (Masa, 2026-09-02).
- The gesture reads the same in Chrome as it already does in Firefox.
- Keyboard raising is untouched.
- A gesture the bypass interrupts ends as a release would, never in a state
  the user cannot leave.

**Non-Goals:**

- A preference, a toggle, or a second modifier. One gesture.
- Changing what the app's menu offers, or where.
- Touch and pen: a long-press `contextmenu` arrives without Shift and is
  unchanged; no touch-side bypass is designed.

## Decisions

### D1: The modifier is Shift, not Ctrl

Two reasons, either sufficient.

Ctrl+primary-click **is** the secondary press on macOS: it arrives as a
`contextmenu` event with `ctrlKey` true (confirmed in review). A Ctrl bypass
would disable the app's menu for every macOS trackpad user, who has no
second button to hold instead. Only Linux is implemented
(`docs/platform-surface.md`), but a gesture that is wrong on a sketched
platform is a trap laid for the port.

Shift is the convention that exists: Firefox's Shift+secondary-click shows
the platform menu regardless of the page. Choosing Shift makes Chrome behave
as Firefox already does instead of adding a third gesture.

Shift's existing uses nearby are keys, not presses, and do not collide:
Shift+F10 in `onMenuKey`, and Shift+Tab in the lightbox's focus trap
(`ViewerLayer`'s lightbox `keydown` effect). No common platform assigns
Shift+secondary-press a meaning of its own.

*Alternative — Ctrl (as first suggested):* rejected for the macOS reason.
*Alternative — Alt:* free on every platform but conventional nowhere; on
Linux desktops Alt+press is commonly grabbed by the window manager for
window moves and never reaches the page.

### D2: The predicate is Shift plus the secondary button, exported from `lib/gesture.ts`

`nativeMenuRequested(e)` is `e.shiftKey && e.button === 2`, typed on
`{ shiftKey: boolean; button: number }` so React's and the DOM's events both
fit. It lives in `client/src/lib/gesture.ts` beside `GestureTracker`, the
module that already reads presses. No new module (D8 F8).

Why the button clause, given that `shiftKey` alone would work in Chrome
today (D3 explains why the keyboard never reaches these handlers there): the
spec promises that the keyboard raises the client's menu "whether or not
Shift is held", and `shiftKey` alone cannot honour that promise in a browser
that *does* dispatch a shifted keyboard `contextmenu` after a prevented
keydown — the guard would decline it, and `EntryMenu`'s capturing listener
would already have closed the menu the keydown raised, leaving nothing. The
secondary button is the discriminator that is true by construction: a
keyboard-dispatched `contextmenu` reports `button: -1` (Chrome, measured)
or `0`, never `2`. The predicate then says what the spec says — a *pointer*
gesture — rather than relying on a browser-specific suppression to make a
weaker predicate safe.

What the clause costs: on macOS, Ctrl+Shift+click arrives with `button: 0`
(it is physically the primary button) and is not the bypass; a two-finger
tap or a real secondary button is. Recorded in `docs/platform-surface.md`
(task 3.1). Unverified there, like everything macOS.

Each of the three handlers becomes: if `nativeMenuRequested(e)` return
(after D6's gesture end, in the viewer), else what it does today. No
cancellation, no `onEntryMenu`; the browser's default action follows.

*Alternative — `shiftKey` alone:* works in Chrome by D3's measurement,
fails the spec's keyboard promise anywhere that measurement does not hold.
*Alternative — the `(0, 0)` convention (first draft):* false in Chrome
(Context). *Alternative — three inline `if (e.shiftKey) return`:* the
reviewer's suggestion once the predicate was one term; it is two terms with
a reason each, so it gets a name, in the module that already exists.

### D3: Pointer only — the keyboard still raises the app's menu, by two independent facts

Asked for explicitly (Masa, 2026-09-02).

Fact one, Chrome, measured in review: `onMenuKey` calls `preventDefault` on
the keydown for both the context-menu key and Shift+F10, and a prevented
keydown suppresses the `contextmenu` that would follow — the tile's
`onContextMenu` never runs for a keyboard raise. Shift held with the
context-menu key dispatches no `contextmenu` at all.

Fact two, everywhere: D2's button clause. A keyboard-dispatched
`contextmenu` never carries `button: 2`, so even a browser that delivers
one, shifted, after a prevented keydown is not bypassed — the tile handler
raises the menu as it does today.

The reproduction, for the next reader who wants to re-measure:

```js
b.addEventListener('contextmenu', e => console.log({
  x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey,
  ctor: e.constructor.name }))
// then: press ContextMenu; press Shift+F10; right-press the mouse
```

Chrome 150: keys → centre of the element, `button: -1`, `shiftKey: false`;
mouse → the pointer, `button: 2`, `shiftKey` as held. `contextmenu` is a
`PointerEvent` in current Chrome.

`menuAt`'s `(0, 0)` branch is reached only by `onMenuKey`'s literal
argument; it is left exactly as it is.

### D4: A raised menu yields, through the listener that already exists

`EntryMenu`'s capturing window `contextmenu` listener closes the menu on any
secondary press outside it, before the tile's handler runs. With the tile
handler declining a shifted press, the sequence on Shift+secondary over a
tile while a menu is open is: menu closes, tile declines, platform menu
appears. No change to `EntryMenu`.

The cell that pins this must dispatch the `contextmenu` **without** a
preceding `pointerdown`: `EntryMenu` also closes on capturing `pointerdown`,
so a full press closes the menu before the `contextmenu` listener is ever
exercised, and removing that listener would leave the cell green (D8 F6).
A second cell keeps the full press for the outcome as a user sees it.

A shifted secondary press *on* the open menu itself is unchanged: the menu
element has no `contextmenu` handler, so today an unshifted secondary press
there already shows the platform menu over it. Not worth spec text.

### D5: Nothing beneath is disturbed — the press side holds, the release side did not

Press side, verified: `onModelPointerDown` returns on `e.button !== 0` before
any overlay is set; `startGesture` checks the primary button; the lightbox
backdrop's `onPointerDown` closes only on button 0. A shifted secondary press
begins no orbit, opens nothing and closes nothing.

Release side, found in review (D8 F2): `onUp` accepts any button's release.
While the overlay is held (`pointer.current.down` is initialised true in
orbit mode), the *secondary* button's release ends the primary's gesture —
on a press without drag it calls `onPromote()` and the lightbox opens. That
is today's behaviour on a plain secondary click mid-hold, under the menu it
raises, and it would violate the new scenario's "no expanded view opens"
outright. `onUp` gains `if (e.button !== 0) return`, part of this change;
a cell dispatches a secondary press *and release* mid-hold and asserts no
lightbox, falsified by removing the guard.

### D6: Declining mid-gesture ends the gesture, without promoting

With D5's guard alone, a shifted secondary press mid-orbit leaves
`pointer.current.down` true and the primary still held — and the browser's
menu then takes the input. The primary's release goes to the menu, not the
page (D8 F2's second branch), so `onUp` never runs: the model would orbit
with no button held, and `onPointerLeave` would refuse to dismiss the
overlay (`if (!pointer.current.down)`).

So `raiseEntryMenu`'s bypass branch, when `pointer.current.down`, ends the
gesture as a release at that point would: `onUp`'s body is extracted into
`endGesture(e, { promote })`, called by `onUp` with `promote: true` and by the
bypass with `promote: false`. A drag settles and persists as before; a
press-without-drag simply ends, since opening the lightbox is exactly what
the scenario forbids. The overlay then stands as after any release, and the
persist hold applies as it does after any release.

`endGesture` lives in the component body and is reached by both callers
through a ref (`endGestureRef`), not directly. The implementation review
(D9 R1) measured why: the window listeners are installed once — the effect
runs on `tracker`, which App holds for its lifetime — so a direct call from
`onUp` kept the *mount render's* function, whose `onPersist` closed over the
mount render's `viewer`. A viewer swapped in during a held dismissal (the
path `orbitHandoff.test.tsx`'s "replaced during a hold" cell exercises) then
had its pixels persisted under the old tile's path. Pre-existing, but the
bypass — re-created per render — was the first caller to see the props in
force, which made the two paths disagree. The ref closes both.

What happens to that overlay under the browser's menu is the browser's:
if Chrome delivers `pointerleave` when its menu opens, `dismissAfterPersist`
runs and the overlay goes as it would on any leave. Observed in 4.2, not
designed around.

*Alternative — leave the gesture running and rely on `pointercancel`:*
Chrome does not fire it for a context menu. *Alternative — forbid the
bypass mid-orbit (decline only when `!pointer.current.down`):* leaves one
surface where the gesture silently does nothing; worse than ending cleanly.

### D7: Test helpers dispatch what the browser dispatches

Both `secondaryPress` helpers dispatch `pointerdown` with `button: 2` and
then a `contextmenu` with **no button** — happy-dom defaults it to `0`, so
D2's predicate would never fire in a cell. Both helpers gain `button: 2` on
the `contextmenu` (which is what Chrome sends), a `shift` option, and the
`pointerup` (`button: 2`, on window) so D5's release path is exercised.
`entryMenu.test.tsx`'s helper returns whether the app took the event, the
`!dispatchEvent(...)` reading `viewerMenu.test.tsx`'s already has.

The added release silently strengthens one *pre-existing* cell: with
`onUp`'s button guard removed, `viewerMenu.test.tsx`'s "a secondary press on
the orbiting model raises the tile's whole menu" now fails beside the new
release-guard cell, because its press ends in a secondary release that used
to be invisible. Recorded (D9 R6) so a later edit to the helper is not taken
as free.

### D8: Review findings, 2026-09-02 (opus), and their disposition

| # | Finding | Disposition |
|---|---|---|
| F1 | **Blocker.** The `(0, 0)` keyboard convention is false in Chrome: keys dispatch at the element's centre with `button: -1`; a prevented keydown suppresses the event; Shift+key dispatches nothing | **Design changed** (Context, D2, D3): predicate is Shift + `button === 2`; `keyboardRaised` dropped; measurements recorded with the reproduction |
| F2 | **Blocker.** `onUp` has no button check — a secondary release mid-hold promotes to the lightbox; and under a native menu the primary's release is lost, leaving a phantom orbit | **Design changed** (D5, D6): `onUp` guards on the primary button; the bypass ends the gesture without promoting; cells dispatch the release |
| F3 | Two carried scenarios are falsified by the new gesture | **Adopted**: rewritten under the same titles to say "without Shift" |
| F4 | Proposal claimed both test helpers report "taken"; only the viewer's does | **Fixed** (proposal Impact, D7) |
| F5 | D1 cited a `shiftKey` read on a wheel gesture that does not exist | **Fixed**: the lightbox focus trap's Shift+Tab |
| F6 | Task 2.4 could not pin D4's ordering — the capturing `pointerdown` closes the menu first | **Adopted** (D4): the cell dispatches `contextmenu` alone |
| F7 | Two of 2.1's assertions cannot fail under its falsification | **Adopted**: labelled as D5 anchors; the falsifiable release assertions moved to 2.5 |
| F8 | A new `lib/contextMenu.ts` for one term is over-engineering | **Adopted in part**: no new module — `lib/gesture.ts`; the predicate stayed two terms for D2's reason, so it keeps a name |
| F9 | Task 1.1's type shape would break `onMenuKey`'s literal call to `menuAt` | Moot: `menuAt` untouched |
| F10 | The overlay's `onPointerLeave` hold under a native menu unexamined; 4.2 silent on it | **Adopted** (D6 last paragraph, 4.2) |
| F11 | Tasks header attributed `ViewerLayer.tsx` to `thumbnail-image-serving` 2.6 | **Fixed**: that task is Grid/App |
| F12 | "App's one entry point" — there are two callbacks | **Fixed** (Context) |
| F13 | The Why's "Save image as…" holds only on tiles; grid-only was the simpler scope | **Declined on scope** (Masa: every surface, for Inspect and extension items); the Why now says which items each surface yields |
| F14 | 4.2 records Chrome but Firefox cannot exercise the app path | **Adopted**: 4.2 gains the Firefox line |

### D9: Implementation review, 2026-09-02 (opus, on `d84a59b`), and its disposition

| # | Finding | Disposition |
|---|---|---|
| R1 | `onUp` (installed once) held the mount render's `endGesture` while the bypass called the current one — non-uniform staleness, and a measured pre-existing wrong-entry persist after a viewer swap during a hold | **Adopted** (D6): `endGestureRef`, both callers read it; a cell in `orbitHandoff.test.tsx` pins the fresh `onPersist` |
| R2 | The spec's carried "no thumbnail work is started" clause contradicted "settled and kept" for an ended drag | **Fixed**: the clause carries the exception |
| R3 | "Settled and kept" over-claimed for a press before the drag threshold | **Fixed**: "where one was moved" |
| R4 | Code took a boolean where D6 and the tasks specified `{ promote }` | **Fixed** in code: the object, as specified |
| R5 | Task 1.3 was ticked against a placement it did not take | **Fixed**: the line records the body-plus-ref placement |
| R6 | The viewer helper's added release strengthened an old cell unrecorded; the grid helper sent no release | **Adopted**: D7 records it; the grid helper sends the release too |
| R7 | Task 4.1 read as if every `pointerup` in the suite were now explicit | **Fixed**: the line says one cell |
| R8 | Do not archive with 4.2b open | 4.2b done — Firefox verified by Masa, 2026-09-02 |
| R9 | `dismissAfterPersist` can run twice for one gesture (outside-rect branch, then `onPointerLeave`) — pre-existing, unchanged | **Noted**, not this change's. After R1 both callers reach the current closure, so a repeat `onDismiss` reads the already-closed state rather than a stale viewer; whether App's `closeViewer` is harmless twice (it re-dispatches `modelClose` and re-patches the URL) is not verified here and no cell is added |

## Risks / Trade-offs

- [Firefox never delivers the shifted event, so the predicate is exercised
  only in Chromium there] → intended: the gesture is the same on both, and
  the app's code is what makes Chrome match. The tests exercise the app path;
  4.2 confirms in Firefox that a plain secondary press still raises the app's
  menu, so the path is untouched there.
- [macOS Ctrl+Shift+click is not the bypass (`button: 0`)] → D2's trade,
  recorded in `docs/platform-surface.md`; a two-finger tap or a second button
  is. Unverified, like every macOS row there.
- [A user who has learned Shift+secondary in Firefox for *every* page gets
  the same in this app; one who has not may never find it] → no discovery
  surface is added; this is a power-user escape hatch, asked for as one.
- [`onUp`'s new guard changes existing behaviour: a secondary release
  mid-hold no longer ends the gesture] → it ended the *primary's* gesture by
  mistake; the primary's own release still ends it. The cell in 2.5 pins the
  new behaviour and the old one is not one anyone asked for.
- [A Linux window manager that grabs Shift+secondary] → none of the common
  ones do by default; Alt is the grabbed modifier, which is why Alt was
  rejected.

## Migration Plan

Client-only; ships with the bundle, reverts with it.

## Open Questions

None.
