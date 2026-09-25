## MODIFIED Requirements

### Requirement: Entry actions are defined once and offered on every surface that hosts them
The client SHALL define each action available on a listing entry once, and every surface offering that action SHALL invoke that definition rather than reimplementing it. The surfaces are a context menu — raised on a grid tile, or on the orbit overlay while it covers a tile — and the expanded viewer's information panel, which carries the expanded view's commands in place of a menu of its own. An action SHALL behave identically whichever surface invoked it.

Shared actions are one-shot commands: each completes on its own and leaves no mode behind. Most need no rendered model at all and SHALL NOT load one; the exceptions are the actions whose whole purpose is to produce a rendering, which SHALL obtain the model the same way the listing does rather than by opening the expanded viewer. Controls that operate on a live view — those that change how the model is currently displayed and show the result as they do it — SHALL remain with that view rather than being offered as menu items.

Which actions an entry offers SHALL follow from what the entry is, and an action that cannot apply to an entry SHALL be absent rather than present and inert. Wherever a surface lists several actions, the everyday ones — opening, launching, revealing, copying, finding similar — SHALL come first, and the ones that tend the library's thumbnails and framings SHALL follow a divider, so an everyday action is never the neighbour of a destructive one.

#### Scenario: The same action, two ways in
- **WHEN** the user copies an entry's path from the context menu, and again from the expanded viewer
- **THEN** the same text is placed on the clipboard by the same implementation, and a write that fails is reported the same way from either surface

#### Scenario: Actions that need no model do not load one
- **WHEN** the user raises the context menu on a model tile and invokes an action that does not produce a rendering
- **THEN** the model's mesh is not fetched or rendered for that action's sake, and the expanded viewer does not open

#### Scenario: An action that renders does not open the viewer
- **WHEN** the user invokes an action whose purpose is to produce a rendering
- **THEN** the model is obtained and drawn as the listing draws it, without the expanded view opening or taking over the window

#### Scenario: Live-view controls stay with the live view
- **WHEN** the user raises the context menu on a model tile
- **THEN** controls bound to a displayed model — those that change how it is being shown and animate the result as they do it — are not offered there, since there is no such display to operate on; a one-shot choice that redraws the tile in place is not one of them

#### Scenario: Inapplicable actions are absent
- **WHEN** the user raises the context menu on an entry that is not a model
- **THEN** actions that only apply to models are not listed, rather than listed and disabled

#### Scenario: Maintenance follows a divider
- **WHEN** a model's menu or the expanded viewer's panel offers both everyday actions and thumbnail maintenance
- **THEN** the everyday actions come first and the maintenance ones after a divider

### Requirement: A context menu on grid tiles
The client SHALL raise a context menu on any grid tile, and on the orbit overlay while it covers a model's tile, in response to the platform's secondary-click gesture, positioned at the pointer and kept within the viewport, with the platform's own menu suppressed — except that a secondary press made with Shift held SHALL be left to the platform: the client SHALL neither raise its menu nor suppress the platform's, so the platform's own menu appears as it would on any page. That exception is a property of the pointer gesture only, recognised by the secondary button: the keyboard's ways of raising the menu SHALL raise the client's menu whether or not Shift is held. Every tile SHALL also carry an actions control that raises the same menu with an ordinary press, shown while the tile is hovered or holds focus and always where the device has no hover; it SHALL stay out of the tab order, the tile itself taking the keyboard's ways of raising the menu, and a press on it SHALL NOT begin an orbit. The menu SHALL be dismissible by choosing an action, by pressing Escape, and by interacting outside it, and SHALL be reachable and operable from the keyboard. A menu raised from the keyboard SHALL show its first row as focused at once; a menu raised by the pointer SHALL hold focus on its first row without marking it, and the first arrow key SHALL mark that row rather than step past it, as the grid's first arrow lands on its first tile. Raising or dismissing the menu SHALL NOT disturb what it was raised over: no orbit begins, no expanded view opens, no open view closes, and no thumbnail work is started or cancelled — and neither does a shifted press that is left to the platform, except where it ends an orbit in progress (below), nor the release of a secondary button while a primary-button gesture is in progress. Where a shifted press lands on a model mid-orbit, the orbit SHALL end as a release at that point would end it — the view settled and kept where one was moved — and SHALL NOT open the expanded view, since the platform's menu then holds the pointer and the client would not see the release. A surface SHALL offer only the actions it can perform there, and while the menu is raised it SHALL own Escape, so that one press dismisses one thing.

The expanded view SHALL raise no menu of its own: its information panel carries every command the view can perform (see `model-viewer`, *Lightbox expanded view*), and a secondary press on it SHALL be left to the platform, neither raising the client's menu nor closing the view. A surface that merely covers an entry momentarily on the way to somewhere else SHALL offer whatever that entry offers: what withholds is a view the user has opened and holds, not a transient overlay.

A menu raised on a model's **tile** SHALL additionally offer that model's orbit axis as a choice among the axes the client can express, naming them as the expanded view's own control names them and marking the one the model is framed about. The expanded view SHALL NOT offer that choice anywhere but its live control. The choice SHALL be presented compactly and **last**, after the actions and a divider, since it re-frames the model's thumbnail and is a tending action rather than a way to use the model — and it SHALL be marked as the live control marks it, so that one spindle-in-force reads the same way on either surface. The choice SHALL be reachable and operable from the keyboard with the rest of the menu, entered at the axis in force from whichever side the arrow keys reach it.

#### Scenario: Secondary click opens the menu without orbiting
- **WHEN** the user secondary-clicks a model tile without Shift held
- **THEN** the menu opens and the model does not begin to orbit, nor does the expanded view open

#### Scenario: The menu reaches the model being viewed
- **WHEN** the user secondary-clicks, without Shift held, a model that is being orbited, or one open in the expanded view
- **THEN** over the orbit overlay the menu opens, offering everything the tile beneath it offers, and releasing the secondary button ends nothing — the orbit, if one is in progress, continues to the primary's own release; over the expanded view no menu of the client's opens, the press is left to the platform, and the view stays open

#### Scenario: Actions a surface cannot perform are absent from it
- **WHEN** the user looks for a model's commands while it is open in the expanded view
- **THEN** they are in the view's information panel, which omits opening the model, since it is already open, and the actions that redraw its thumbnail, which cannot be drawn for as long as that view holds the renderer and would be overwritten by the view's own closing save

#### Scenario: A momentary overlay is the tile it covers
- **WHEN** the user orbits a model, releases, and secondary-clicks it again while the overlay is still settling over its tile
- **THEN** the whole of the tile's menu is offered, orbit axis included, since nothing about that overlay makes any of it dishonest — it holds the renderer only until it goes, it carries no live control of its own, and each action takes effect after the settling save rather than racing it

#### Scenario: Escape closes the menu before the view
- **WHEN** the user raises the menu over the orbit overlay and presses Escape, and separately secondary-clicks the expanded view and presses Escape
- **THEN** the first press closes the menu and leaves the overlay as it was; over the expanded view, where the secondary press raised nothing of the client's, Escape closes the view

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

#### Scenario: The actions control raises the same menu
- **WHEN** the user presses a tile's actions control, on a device with or without hover
- **THEN** the tile's menu opens beneath the control with the same rows a secondary click raises, and the model does not begin to orbit

#### Scenario: A pointer-raised menu marks nothing until asked
- **WHEN** the user raises the menu with a secondary click and then presses ArrowDown
- **THEN** no row is marked as focused until the key, and the key marks the first row rather than moving to the second; a menu raised with Shift+F10 marks its first row at once

#### Scenario: The axis picker comes last
- **WHEN** the user raises the menu on a model tile
- **THEN** the orbit-axis choice follows the actions and the maintenance rows after a divider, and arrowing into it from either end lands on the axis in force

### Requirement: Refreshing a model's thumbnail and its framing
The client SHALL offer, on a model, an action that renders its thumbnail again under the thumbnail settings in force at that moment and replaces the cached image with the result. It SHALL render from the orientation that model would be rendered from on an ordinary visit — the camera stored for it where there is one, otherwise an orientation source's where the model has neither a camera nor an axis of its own, otherwise the default about whichever axis it has — and SHALL leave that orientation as it found it, storing pixels rather than a viewpoint. Where it renders under an orientation source, it SHALL record which recipe produced those pixels, exactly as an ordinary visit does, so that the image is not mistaken for one rendered without a source and is not re-rendered on the next visit for want of a label. It SHALL be offered whether or not the cached image is considered current, since the settings a thumbnail was rendered under can change without the view it is shown in being rebuilt, and since an image can be wrong for reasons no staleness test detects.

The client SHALL also offer, on a model, a distinct action that gives up the orientation stored for that model, returning it to however it would be shown had the user never set one. It SHALL **discard** that orientation rather than store a default in its place, and render the thumbnail at whatever the model then resolves to — an orientation the view's own answer supplies for it, the default otherwise. Discarding rather than overwriting is the whole of the action: a stored default is an orientation of the user's own, and would suppress the very source that would otherwise frame the model well. The action is needed because a thumbnail is rendered *from* the stored orientation, so rendering again without discarding it reproduces the same image. Giving up the orientation SHALL also govern where the model opens in the expanded viewer, since a model has one stored orientation rather than one per surface, and SHALL take effect there within the session rather than only after the next load.

The action SHALL discard the stored axis along with the camera, whatever is available to replace them: an up axis together with the angles measured about it are one thing and cannot be taken apart, since angles measured about one axis do not describe a view about another, and a model with nothing of its own is what "had the user never set one" means. What the model then resolves to is the orientation the view's own answer supplies where there is one and the client can express it, and otherwise the default about the file's own axis. An axis kept back by a reset would be a framing the model still holds: not counted while no orientation could replace it, counted and withholding that orientation the moment one could — a reset that has to be run twice.

The re-render action SHALL never change the model's orbit axis.

The re-render action's whole product is pixels, and it leaves the model's orientation exactly as it found it by design. Where the deployment would not store those pixels, the action SHALL be withheld rather than offered and left to draw what it cannot keep — the rule stated once under `feature-report`, of which this is a case. It SHALL be offered on every model where the deployment accepts thumbnail writes, including one whose thumbnail is currently missing or failed, since a failed image is one of the things it exists to fix.

Giving up a framing SHALL be offered on every model where the deployment accepts thumbnail writes, and SHALL be withheld — absent rather than inert — where it does not, including while the deployment has not yet said what it accepts. The gate is the deployment's acceptance of the write, the same one the re-render reads; what a deployment that refuses the write keeps of a viewer's framing, and where, is `model-thumbnails`' question (*A client whose writes are refused keeps its framings locally*), and this offer does not read its answer. Withholding it SHALL NOT withhold the orbit-axis choice, which establishes an orientation rather than giving one up, nor the container's bulk reset, which the deployment's maintenance declaration governs (see *Container entries offer their subtree's bulk actions*).

Taken from the surface **showing** the model, the action reframes that view at once. A deployment that still holds an orientation it declined to give up may then redraw the tile from it, since the render that follows the close reads what the deployment holds rather than what was asked of it; that is the deployment's image reasserting itself, not a failure of the action. Neither action SHALL be offered on entries that are not models. Both SHALL leave the entry's file untouched: they replace a cached rendering, never the model.

#### Scenario: Refreshing after the thumbnail settings changed
- **WHEN** the user changes a setting that alters how thumbnails are drawn and then re-renders a tile whose image predates the change
- **THEN** the tile is drawn again under the new setting, from the same viewpoint as before

#### Scenario: Re-rendering keeps the viewpoint
- **WHEN** the user re-renders the thumbnail of a model whose camera they had set by orbiting
- **THEN** the new image is from that same camera, and opening the model still opens it there

#### Scenario: Re-rendering does not adopt a borrowed orientation
- **WHEN** the user re-renders the thumbnail of a model that has no stored camera and is being shown at an index-supplied orientation
- **THEN** the new image is from that orientation and the model still has no orientation of its own afterwards, so a later re-classification still governs it

#### Scenario: A badly framed thumbnail is recoverable
- **WHEN** the user gives up the framing of a model whose stored camera frames it poorly
- **THEN** its thumbnail is rendered at the orientation the model resolves to with none of its own, and opening the model opens it there too

#### Scenario: Giving up an orientation hands the model back to the index
- **WHEN** the user gives up the orientation of a model — including one whose axis they had chosen — where the view's own answer supplies that model's orientation and the client can express it
- **THEN** the axis is discarded with the camera and the model is framed by that orientation entire, rather than by the default about the axis it used to have

#### Scenario: With nothing to replace it, the axis stays
- **WHEN** the user gives up the orientation of a model whose axis they had chosen and for which nothing could replace it
- **THEN** the axis is not kept back: it is discarded with the camera, as *With nothing to replace it, the axis goes too* states

#### Scenario: With nothing to replace it, the axis goes too
- **WHEN** the user gives up the orientation of a model the index supplies none for, whose orbit axis they had chosen
- **THEN** the camera and the axis are both discarded and the model is framed by default about the file's own axis; when the index later supplies an orientation for it, that orientation applies without a second reset, and the model is not counted as holding a framing in between

#### Scenario: Re-rendering never moves the axis
- **WHEN** the user re-renders the thumbnail of a model whose orbit axis they had chosen, whether or not the index supplies an orientation for it
- **THEN** the model keeps that axis and is drawn about it

#### Scenario: Offered on a tile that has no image
- **WHEN** the user raises the menu on a model whose thumbnail failed to render, on a deployment that accepts thumbnail writes
- **THEN** both actions are offered, since a failed image is one of the things re-rendering exists to fix

#### Scenario: A tile that has no image where the pixels would be dropped
- **WHEN** the user raises the menu on a model whose thumbnail failed to render, on a deployment that refuses thumbnail writes
- **THEN** neither action is offered — re-rendering because the image it produced would last only until the view was rebuilt, giving up the framing because the deployment does not accept the write

#### Scenario: Giving up a framing is offered where pixels are not kept
- **WHEN** a viewer raises a model's menu, or opens it in the expanded viewer, on a deployment that refuses thumbnail writes or has not yet said whether it accepts them
- **THEN** giving up the framing is not offered on either surface, while the orbit-axis choice on the tile's menu still is

#### Scenario: Not offered on containers
- **WHEN** the user raises the menu on a directory or an archive
- **THEN** neither action is listed

### Requirement: A model entry offers its associated applications as open-in choices
The client SHALL offer, on every surface that hosts a model entry's actions — its
menus and the expanded viewer's information panel alike — the
applications the platform associates with the entry's model type, the default
application first, rather than as a submenu. In a menu each application SHALL be a row of
its own, naming the application it opens the model in, following directly after the row that
opens the model in the viewer, so that opening it here and opening it in an application are
read together; the platform chooser's command stays among the other commands. In the
expanded viewer's panel the default application SHALL be the panel's one primary action,
drawn above the model's metadata and naming that application, with the further
applications beside it as plain choices, since the viewer is where the decision to send a
model onward is made. What is offered SHALL come from a session-held report, refreshed when
the platform chooser completes — never a probe issued when a menu opens — so the menu's
contents are known the moment it is raised. Choosing an application SHALL open the entry's
file in that application as a one-shot action: it completes on its own, loads no model,
opens no viewer, and leaves no mode behind. The choices SHALL be reachable and operable
from the keyboard with the rest of the menu, in the order they are drawn, and SHALL be
distinguishable from the command rows by what they carry, so a surface reading the commands
does not read them as commands.

The choices follow from what the entry is: they SHALL be absent on entries that are not
models, and absent when the entry's type maps to no applications — absent rather than
present and inert. Whether an application launch succeeded SHALL be reported the same
way other entry actions report their outcomes, where success means the platform's
launch command succeeded — the client makes no claim about what the launched
application did afterwards.

#### Scenario: The default application leads the group
- **WHEN** the user raises the menu on a model entry whose type has a default
  application and further associated applications
- **THEN** the menu lists "Open in \<default\>" first among the application rows,
  followed by the other associated applications, all directly after the row that opens
  the model in the viewer

#### Scenario: Choosing an application opens the file and nothing else
- **WHEN** the user chooses an application from the menu or the panel
- **THEN** the entry's file opens in that application, no mesh is fetched for the
  action's sake, and no expanded view opens

#### Scenario: The expanded viewer offers the launch actions beside the model
- **WHEN** the user opens a model in the expanded viewer and reads its information
  panel
- **THEN** the panel leads, above the metadata, with "Open in \<default\>" as its primary
  action and the other associated applications beside it, and offers the chooser action
  among its commands where a chooser is configured — the same choices its menu offers

#### Scenario: The group is absent where it does not apply
- **WHEN** the user raises the menu on a directory or zip-container entry, or on a
  model entry whose type the client cannot map to any application
- **THEN** no application rows are present, rather than present and inert

#### Scenario: A failed launch is reported
- **WHEN** the user chooses an application and the platform's launch command fails
- **THEN** the failure is reported the way other entry actions report theirs, and
  nothing else changes
