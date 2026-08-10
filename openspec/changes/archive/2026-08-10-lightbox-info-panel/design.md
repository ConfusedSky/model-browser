# Design — lightbox-info-panel

## Context

The lightbox dialog is a single square (`h/w = min(80vh,80vw)`) hosting the shared canvas, a close button, and a bottom-center name pill; focus is trapped by cycling `[dialog, ...dialog.querySelectorAll('button')]`. `ViewerLayer` already receives the full `DirEntry` (`viewer.entry`), which carries path, name, format, size, and mtime — everything the panel shows. Two caveats: for zip entries `mtime` is the containing zip's mtime (`shared/types.ts`), not the entry's own; and `format` is optional on the type (`format?`, set only when `kind === 'model'`), so the panel needs an undefined branch to typecheck even though the lightbox only ever opens models. The dialog is also the positioning context for several absolutely-positioned children — the loading spinner, the load-error display (`inset-0`), the axis control (`left-3 top-3`), and the close button (`right-3 top-3`) — and carries the `cursor-grab`/`touch-none` drag styling.

## Goals / Non-Goals

**Goals:**
- Full virtual path visible (and copyable) while inspecting a model, plus the entry's free metadata.
- No disturbance to canvas sizing/handoff, orbit, or the axis control.

**Non-Goals:**
- New metadata (triangle counts, print estimates) — nothing that requires parsing or server calls.
- Responsive/mobile layouts — desktop browser app; the panel is a fixed-width column.
- Editing/renaming or revealing the file in the OS file manager.

## Decisions

### D1: Panel is a flex sibling of the viewer square inside the dialog

The dialog keeps its square canvas host at `min(80vh,80vw)` and becomes a horizontal flex container with a fixed-width (~18rem) panel on the right. The name pill is removed; the panel leads with the name.

The square is load-bearing, and not for the reason it looks like: `snapshot()` always renders 512×512 through a camera at `aspect = 1` (`three/renderer.ts`), independent of host size, so a non-square live host does not break the capture — it makes the capture disagree with it. The user would orbit to a framing in a wide viewport and get a thumbnail cropped differently, both on the tile and on the next open. So the `min(80vh,80vw)` sizing moves off the dialog onto the square wrapper together with `shrink-0`: flex may never squeeze it. The canvas host inside fills that wrapper (it is `h-full w-full` today, which only works while the dialog *is* the square).

The dialog stops being the square, so everything positioned against it moves with the square: a `relative` square wrapper holds the canvas host plus the loading spinner, the load-error display (its `inset-0` now spans only the square), and the axis control. The close button is the exception — it stays anchored to the dialog's top-right (now the panel's corner, the standard modal ✕ position), the panel reserves that corner space, and the DOM order is square wrapper → panel → close so the focus trap's DOM-order walk yields the specced Tab cycle (viewer → axis → panel → close).

Everything the panel shows comes from `viewer.entry`, never from the mesh, so the panel renders as soon as the lightbox opens and stays up while the mesh loads and after it fails — the path is copyable for a model that will not open at all, which is when you most want it. The in-square error display keeps its own name line; the small duplication is cheaper than re-specifying the missing-model error requirement. The panel itself scrolls (`overflow-y-auto`): a long `break-all` path can outrun the square's height, and with the wheel handler moved to the canvas host (D3) nothing else would scroll it.

*Alternative — overlay panel on the square:* obscures the model and fights the drag surface; a sibling column costs nothing. *Alternative — close button inside the square wrapper:* keeps it over the viewer, but DOM order then puts close before the panel's copy button and the specced Tab cycle is unreachable without focus-trap changes.

### D2: Path is displayed as the app's virtual path, with wrap + copy

One canonical string — exactly what the path bar and API use, including `zip!/entry` notation — breaking anywhere (`break-all`) rather than truncating, with a copy-to-clipboard button (`navigator.clipboard.writeText`, brief "copied" feedback). No pretty-printing into segments; the copyable string is the feature. If the copy does not go through, the panel selects the path text for manual copy and shows no "copied" feedback — a false confirmation is worse than none. Note the failure is not always a rejected promise: outside a secure context `navigator.clipboard` is `undefined` and `navigator.clipboard.writeText(…)` throws a `TypeError` synchronously, so a bare `.catch()` on the promise never runs. Guard on the API existing and wrap the call, or the fallback is missing in exactly the case it was written for. For zip entries the modified time is labeled as the archive's (e.g. "Modified (zip)") since that's what `DirEntry.mtime` actually is.

### D3: Focus trap and dismissal need no changes

The trap collects `button`s at keydown time, so the copy button participates automatically, and the D1 DOM order makes the cycle come out right with no trap changes. Clicks inside the panel are inside the dialog, so outside-click close is unaffected; the panel is not a drag surface only insofar as it sits outside the canvas host, and the dialog currently owns all gesture affordances — so they all move to the canvas host: `onPointerDown={startGesture}`, the wheel-zoom handler, and the `cursor-grab`/`active:cursor-grabbing`/`touch-none` classes. Otherwise a scroll over the panel would zoom the model, the panel would show a grab cursor, and `touch-none` — `touch-action: none`, which governs touch panning and pinch, not selection — would block touch-scrolling the panel. (Selection is `user-select`; `Grid.tsx` pairs `touch-none select-none` precisely because they are different properties, so the D2 selection fallback does not depend on this move.) Drag behavior on the canvas is unchanged.

### D4: Size and date formatting lives in `client/src/lib/format.ts`, unit-tested

The panel is the first place in the client to render a byte count or a date — nothing in `client/src` formats either today. Rather than inline the arithmetic in JSX, it goes in `client/src/lib/format.ts` alongside `lib/gesture.ts` and gets `client/test/format.test.ts`. It is the only pure logic this change adds, and the only part testable without mounting a renderer.

## Risks / Trade-offs

- [Dialog is wider; on small windows `min(80vh,80vw)` + 18rem could overflow] → cap the dialog at `max-w-[95vw]`; the *panel* absorbs the cap (`min-w-0`), never the square, which carries `shrink-0` and must stay 1:1 (D1). Squeezing the square is the one adjustment here that is not cosmetic.
- [`navigator.clipboard` requires a secure context] → localhost qualifies, but a home model library is plausibly reached over LAN by IP, which does not — and there the API is absent rather than failing (D2). Guard on existence, fall back to selecting the text.
- [Moving `startGesture` off the dialog] → no existing test dispatches pointerdown on the dialog or canvas host (orbitHandoff.test.tsx exercises only the orbit-mode overlay), so add a component test: pointerdown on the canvas host starts a gesture, pointerdown on the panel does not.

## Open Questions

None.
