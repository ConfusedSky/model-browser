# entry-actions Delta

## MODIFIED Requirements

### Requirement: A context menu on grid tiles
The client SHALL raise a context menu on any surface presenting a listing entry — a grid tile, and the live view of a model while it is being orbited or shown expanded — in response to the platform's secondary-click gesture, positioned at the pointer and kept within the viewport, with the platform's own menu suppressed — except that a secondary press made with Shift held SHALL be left to the platform: the client SHALL neither raise its menu nor suppress the platform's, so the platform's own menu appears as it would on any page. That exception is a property of the pointer gesture only, recognised by the secondary button: the keyboard's ways of raising the menu SHALL raise the client's menu whether or not Shift is held. The menu SHALL be dismissible by choosing an action, by pressing Escape, and by interacting outside it, and SHALL be reachable and operable from the keyboard. Raising or dismissing the menu SHALL NOT disturb what it was raised over: no orbit begins, no expanded view opens, no open view closes, and no thumbnail work is started or cancelled — and neither does a shifted press that is left to the platform, nor the release of a secondary button while a primary-button gesture is in progress. Where a shifted press lands on a model mid-orbit, the orbit SHALL end as a release at that point would end it — the view settled and kept — and SHALL NOT open the expanded view, since the platform's menu then holds the pointer and the client would not see the release. A surface SHALL offer only the actions it can perform there, and while the menu is raised it SHALL own Escape, so that one press dismisses one thing.

A surface withholds an action only where it could not honestly perform it, and a surface that merely covers an entry momentarily on the way to somewhere else SHALL offer whatever that entry offers: what withholds is a view the user has opened and holds, not a transient overlay.

A menu raised on a model's **tile** SHALL additionally offer that model's orbit axis as a choice among the axes the client can express, naming them as the expanded view's own control names them and marking the one the model is framed about. The expanded view SHALL NOT offer that choice, already carrying a live control for it. The choice SHALL be presented compactly and before the actions rather than as a list of its own beneath them, since it is one property of the model among the things that can be done to it — and it SHALL be marked as the live control marks it, so that one spindle-in-force reads the same way on either surface. The choice SHALL be reachable and operable from the keyboard with the rest of the menu, entered at the axis in force.

#### Scenario: Secondary click opens the menu without orbiting
- **WHEN** the user secondary-clicks a model tile without Shift held
- **THEN** the menu opens and the model does not begin to orbit, nor does the expanded view open

#### Scenario: The menu reaches the model being viewed
- **WHEN** the user secondary-clicks, without Shift held, a model that is being orbited, or one open in the expanded view
- **THEN** the menu opens over it and the platform's own menu does not appear — offering, on the expanded view, the actions that do not depend on the surface, and on the momentary overlay everything the tile beneath it offers — and releasing the secondary button ends nothing: the orbit, if one is in progress, continues to the primary's own release, and the expanded view does not open

#### Scenario: Actions a surface cannot perform are absent from it
- **WHEN** the user raises the menu on a model open in the expanded view
- **THEN** opening it is not offered, since it is already open, and neither are the actions that redraw its thumbnail, which cannot be drawn for as long as that view holds the renderer and would be overwritten by the view's own closing save

#### Scenario: A momentary overlay is the tile it covers
- **WHEN** the user orbits a model, releases, and secondary-clicks it again while the overlay is still settling over its tile
- **THEN** the whole of the tile's menu is offered, orbit axis included, since nothing about that overlay makes any of it dishonest — it holds the renderer only until it goes, it carries no live control of its own, and each action takes effect after the settling save rather than racing it

#### Scenario: Escape closes the menu before the view
- **WHEN** the user raises the menu over the expanded view and presses Escape
- **THEN** the menu closes and the expanded view stays open, and a second press closes the view

#### Scenario: Dismissal leaves nothing behind
- **WHEN** the user opens the menu and dismisses it with Escape or by clicking elsewhere
- **THEN** the menu closes and the grid is exactly as it was

#### Scenario: Choosing an axis from the tile
- **WHEN** the user chooses an orbit axis from a model tile's menu
- **THEN** the model is stored about that axis, the viewpoint stored for it is given up rather than kept — angles measured about one axis do not describe a view about another — and its thumbnail is drawn again about the axis chosen, framed by default about it; the pixels are not recorded as an orientation source's, since a model whose axis its owner has chosen is no longer framed by a source; and choosing the axis the model is already about does nothing at all, neither storing nor drawing

#### Scenario: The menu stays on screen
- **WHEN** the menu is raised on a tile at the edge of the window
- **THEN** it is positioned so that all of its items are visible

#### Scenario: A shifted secondary press reaches the platform's menu
- **WHEN** the user secondary-clicks with Shift held on a grid tile, on a model being orbited, or on one open in the expanded view
- **THEN** the client's menu does not open, the platform's own menu is not suppressed, and what was pressed is undisturbed — no orbit begins, no expanded view opens, no open view closes, and an orbit already in progress ends as a release would end it

#### Scenario: The keyboard raises the client's menu whatever Shift is doing
- **WHEN** the user raises the menu from the keyboard — the context-menu key, or Shift+F10 — with Shift held
- **THEN** the client's menu opens on the focused tile, exactly as it does without Shift

#### Scenario: A raised menu yields to the platform's
- **WHEN** the client's menu is open and the user secondary-clicks with Shift held elsewhere
- **THEN** the open menu closes, no menu of the client's is raised in its place, and the platform's own menu is not suppressed
