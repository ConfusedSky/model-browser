# Native Context Menu Bypass

> Reviewed before implementation (2026-09-02, opus): fourteen findings, folded
> in and dispositioned in design D8. Two changed the design — the keyboard
> convention it leaned on is false in Chrome, and the viewer's release path
> was unexamined. Read the design as it stands, not as first drafted.

## Why

Every surface that presents an entry — grid tiles, the orbit overlay, the
lightbox — swallows the secondary press to raise the app's own menu, so the
browser's context menu is unreachable anywhere a model or folder is drawn:
no "Inspect", no extension items, and on tiles no "Save image as…". Asked
for 2026-09-02 (Masa): a modifier on the same press should let the
platform's menu through, on every surface — the orbit overlay and the
lightbox draw a `<canvas>`, so the browser offers no image items there, but
Inspect and the extension items are what is wanted and those are on every
page menu.

## What Changes

- **Shift with the secondary press yields to the platform.** On any surface
  that raises the entry menu, a secondary press with Shift held is left to the
  browser: the app's menu is not raised and the event is not cancelled, so the
  platform's own menu appears where it would in any page. Without Shift the
  gesture is exactly what it is today.
- **Pointer gesture only.** The keyboard paths — the context-menu key and
  Shift+F10 — keep raising the app's menu. The bypass is recognised by the
  secondary *button*, which a keyboard-dispatched event does not carry.
- **A raised menu gets out of the way.** A shifted secondary press elsewhere
  dismisses an open entry menu, as any press outside it does, and then lets the
  platform's menu through rather than raising the next one.
- **An orbit in progress ends cleanly.** A shifted secondary press on a model
  being orbited ends the orbit as a release at that point would — the view
  settles and is kept — without opening the expanded view. This also closes
  a latent hole the review found: the viewer's release handler accepted *any*
  button's release as the primary's, so a plain secondary click mid-hold
  already opened the lightbox under the menu it raised.
- Unchanged: which actions each surface offers, positioning, keyboard
  operation, Escape ownership, and every server route.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `entry-actions`: MODIFY *A context menu on grid tiles* — "with the
  platform's own menu suppressed" gains its one exception, the shifted press;
  three scenarios pin it (the bypass, its pointer-only scope, a raised menu
  yielding); and the two carried scenarios the exception would otherwise
  falsify — *Secondary click opens the menu without orbiting* and *The menu
  reaches the model being viewed* — are rewritten under their own titles to
  say "without Shift". The other six scenarios are carried byte-identical.
  Checked against every active delta: `bulk-thumbnail-jobs` ADDs *Container
  entries offer their subtree's bulk actions* to this capability and touches
  no existing requirement.

## Impact

- `client/src/lib/gesture.ts` — one exported predicate,
  `nativeMenuRequested(e)`: Shift held *and* the secondary button. Beside
  `GestureTracker`, which already owns the press-versus-drag reading.
- `client/src/components/Grid.tsx` — the folder/zip tile's and the model
  tile's `onContextMenu` consult the predicate before `preventDefault`.
- `client/src/viewer/ViewerLayer.tsx` — `raiseEntryMenu`, shared by the orbit
  overlay and the lightbox, does the same and ends an in-progress orbit; the
  window `pointerup` handler (`onUp`) gains the primary-button check it lacks;
  its release logic is extracted so both callers share it.
- `client/src/components/EntryMenu.tsx` — no change: its window-level
  capturing `contextmenu` listener already closes the menu on any secondary
  press outside it, which is the order the bypass needs.
- `docs/platform-surface.md` — a bullet under latent OS assumptions recording
  why the modifier is Shift and not Ctrl (Ctrl+click *is* the secondary press
  on macOS), and what requiring the secondary button costs there.
- Tests: `viewerMenu.test.tsx`'s press helper already reports whether the app
  cancelled the event; `entryMenu.test.tsx`'s helper gains that and both gain
  cells. Both helpers must dispatch the secondary button on the `contextmenu`
  event itself, which neither does today.
- No server change, no spec change outside `entry-actions`, no `RIG_VERSION`
  bump.
