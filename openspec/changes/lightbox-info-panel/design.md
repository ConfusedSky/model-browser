# Design — lightbox-info-panel

## Context

The lightbox dialog is a single square (`h/w = min(80vh,80vw)`) hosting the shared canvas, a close button, and a bottom-center name pill; focus is trapped by cycling `[dialog, ...dialog.querySelectorAll('button')]`. `ViewerLayer` already receives the full `DirEntry` (`viewer.entry`), which carries path, name, format, size, and mtime — everything the panel shows.

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

The dialog keeps its square canvas host at `min(80vh,80vw)` and becomes a horizontal flex container with a fixed-width (~18rem) panel on the right. The canvas host stays square, so `renderNow`'s host-size measurement and the thumbnail handoff geometry are untouched. The name pill is removed; the panel leads with the name.

*Alternative — overlay panel on the square:* obscures the model and fights the drag surface; a sibling column costs nothing.

### D2: Path is displayed as the app's virtual path, with wrap + copy

One canonical string — exactly what the path bar and API use, including `zip!/entry` notation — breaking anywhere (`break-all`) rather than truncating, with a copy-to-clipboard button (`navigator.clipboard.writeText`, brief "copied" feedback). No pretty-printing into segments; the copyable string is the feature.

### D3: Focus trap and dismissal need no changes

The trap collects `button`s at keydown time, so the copy button participates automatically. Clicks inside the panel are inside the dialog, so outside-click close is unaffected; the panel is not a drag surface only insofar as it sits outside the canvas host, and `startGesture` binds to the dialog — so pointer-down on the panel must not start a gesture: bind `onPointerDown={startGesture}` to the canvas host instead of the dialog (drag behavior on the canvas is unchanged).

## Risks / Trade-offs

- [Dialog is wider; on small windows `min(80vh,80vw)` + 18rem could overflow] → cap the dialog at `max-w-[95vw]` and let the panel shrink; cosmetic tuning at apply time.
- [`navigator.clipboard` requires a secure context] → localhost is a secure context in every target browser; fall back to selecting the text on failure.
- [Moving `startGesture` off the dialog] → covered by an explicit spec scenario (panel interaction never orbits) and existing orbit tests.

## Open Questions

None.
