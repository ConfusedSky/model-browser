# entry-actions Delta

## ADDED Requirements

### Requirement: Entry actions are defined once and offered on every surface that hosts them
The client SHALL define each action available on a listing entry once, and every surface offering that action SHALL invoke that definition rather than reimplementing it. The surfaces are a context menu raised on a grid tile and the expanded viewer's information panel. An action SHALL behave identically whichever surface invoked it.

Shared actions are one-shot commands: each completes on its own and leaves no mode behind. Most need no rendered model at all and SHALL NOT load one; the exceptions are the actions whose whole purpose is to produce a rendering, which SHALL obtain the model the same way the listing does rather than by opening the expanded viewer. Controls that operate on a live view — those that change how the model is currently displayed and show the result as they do it — SHALL remain with that view rather than being offered as menu items.

Which actions an entry offers SHALL follow from what the entry is, and an action that cannot apply to an entry SHALL be absent rather than present and inert.

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
- **THEN** controls that change how a displayed model is drawn are not offered there, since the menu cannot show their effect

#### Scenario: Inapplicable actions are absent
- **WHEN** the user raises the context menu on an entry that is not a model
- **THEN** actions that only apply to models are not listed, rather than listed and disabled

### Requirement: A context menu on grid tiles
The client SHALL raise a context menu on a grid tile in response to the platform's secondary-click gesture, positioned at the pointer and kept within the viewport. It SHALL be dismissible by choosing an action, by pressing Escape, and by interacting outside it, and SHALL be reachable and operable from the keyboard. Raising or dismissing the menu SHALL NOT disturb the tile beneath it: no orbit begins, no expanded view opens, and no thumbnail work is started or cancelled.

#### Scenario: Secondary click opens the menu without orbiting
- **WHEN** the user secondary-clicks a model tile
- **THEN** the menu opens and the model does not begin to orbit, nor does the expanded view open

#### Scenario: Dismissal leaves nothing behind
- **WHEN** the user opens the menu and dismisses it with Escape or by clicking elsewhere
- **THEN** the menu closes and the grid is exactly as it was

#### Scenario: The menu stays on screen
- **WHEN** the menu is raised on a tile at the edge of the window
- **THEN** it is positioned so that all of its items are visible

### Requirement: Open and copy are offered on every entry
The client SHALL offer, on every listing entry whatever its kind, an action that opens it — doing exactly what activating the tile does, so that a directory or archive is browsed into and a model is presented in the expanded viewer — and an action that copies the entry's full virtual path, including the `zip!/entry` notation for archive contents, to the clipboard. A copy that succeeds SHALL confirm briefly; a write that fails SHALL report the failure briefly instead, on whichever surface invoked it.

#### Scenario: Opening from the menu matches opening the tile
- **WHEN** the user opens an entry from the context menu
- **THEN** the same thing happens as activating the tile directly — a container is browsed into, a model is presented in the expanded viewer

#### Scenario: Copying the path of any entry
- **WHEN** the user copies the path of a model, a directory, and an archive entry
- **THEN** each entry's full virtual path is placed on the clipboard, with archive contents carrying their `zip!/entry` notation

### Requirement: Reveal an entry in its containing folder
The client SHALL offer an action that navigates to the entry's containing folder, brings the entry into view, and marks it briefly so that it can be found among its siblings — the marking fading on its own shortly after arrival. For an entry inside an archive the containing folder is the directory within that archive.

The action SHALL create a history entry, so returning goes back to the view it was invoked from, including a set of search results. It SHALL NOT change whether the user is browsing flat or nested: that choice belongs to the user, and an action that rewrote it would make the setting untrustworthy.

The marking SHALL be ephemeral: it SHALL NOT appear in the URL, SHALL NOT be restored by history navigation or reload, and SHALL be dropped silently if the entry is not present in the listing that arrives.

#### Scenario: Finding where a search result lives
- **WHEN** the user reveals a model from a set of search results
- **THEN** the containing folder is listed, the model is scrolled into view and briefly marked, and going back returns to the search results

#### Scenario: Revealing an entry inside an archive
- **WHEN** the user reveals a model held in an archive
- **THEN** the directory within that archive is listed and the model is located there

#### Scenario: The view mode is the user's
- **WHEN** the user reveals an entry while browsing flat
- **THEN** the destination is listed flat, and revealing while browsing nested lists it nested

#### Scenario: The mark does not outlive the arrival
- **WHEN** an entry has been revealed and marked, and the user reloads the page or navigates back to that folder later
- **THEN** the folder is listed with nothing marked

#### Scenario: Revealing an entry that is no longer there
- **WHEN** the revealed entry is absent from the listing that arrives
- **THEN** the folder is presented normally, with no error and nothing marked

### Requirement: Refreshing a model's thumbnail and its framing
The client SHALL offer, on a model, an action that renders its thumbnail again under the thumbnail settings in force at that moment and replaces the cached image with the result. It SHALL render from the orientation that model would be rendered from on an ordinary visit — the camera stored for it where there is one, otherwise an orientation source's where the model has neither a camera nor an axis of its own, otherwise the default about whichever axis it has — and SHALL leave that orientation as it found it, storing pixels rather than a viewpoint. Where it renders under an orientation source, it SHALL record which recipe produced those pixels, exactly as an ordinary visit does, so that the image is not mistaken for one rendered without a source and is not re-rendered on the next visit for want of a label. It SHALL be offered whether or not the cached image is considered current, since the settings a thumbnail was rendered under can change without the view it is shown in being rebuilt, and since an image can be wrong for reasons no staleness test detects.

The client SHALL also offer, on a model, a distinct action that gives up the orientation stored for that model, returning it to however it would be shown had the user never set one. It SHALL **discard** that orientation rather than store a default in its place, and render the thumbnail at whatever the model then resolves to — an index-supplied orientation where one exists for it, the default otherwise. Discarding rather than overwriting is the whole of the action: a stored default is an orientation of the user's own, and would suppress the very source that would otherwise frame the model well. The action is needed because a thumbnail is rendered *from* the stored orientation, so rendering again without discarding it reproduces the same image. Giving up the orientation SHALL also govern where the model opens in the expanded viewer, since a model has one stored orientation rather than one per surface, and SHALL take effect there within the session rather than only after the next load.

What that action discards SHALL follow from what is available to replace it. Where an orientation source supplies an orientation for the model, it SHALL discard the stored axis along with the camera, so that orientation applies entire — an up axis together with the angles measured about it, which are one thing and cannot be taken apart, since angles measured about one axis do not describe a view about another. Where no such orientation is available, or where the one offered is not usable, it SHALL discard the camera alone and leave the axis, which then frames the model by default about the axis the user established.

Re-rendering SHALL never change the model's orbit axis.

Both actions SHALL be offered on every model, including one whose thumbnail is currently missing or failed, and SHALL NOT be offered on entries that are not models. Both SHALL leave the entry's file untouched: they replace a cached rendering, never the model.

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
- **WHEN** the user gives up the orientation of a model the index supplies one for, including one whose axis the user had chosen
- **THEN** the axis is discarded with the camera and the model is framed by the index's orientation entire, rather than by the default about the axis it used to have

#### Scenario: With nothing to replace it, the axis stays
- **WHEN** the user gives up the orientation of a model the index supplies none for, whose orbit axis they had chosen
- **THEN** the camera is discarded and the axis is kept, and the model is framed by default about that axis rather than about the default one

#### Scenario: Re-rendering never moves the axis
- **WHEN** the user re-renders the thumbnail of a model whose orbit axis they had chosen, whether or not the index supplies an orientation for it
- **THEN** the model keeps that axis and is drawn about it

#### Scenario: Offered on a tile that has no image
- **WHEN** the user raises the menu on a model whose thumbnail failed to render
- **THEN** both actions are offered, since a failed image is one of the things re-rendering exists to fix

#### Scenario: Not offered on containers
- **WHEN** the user raises the menu on a directory or an archive
- **THEN** neither action is listed

### Requirement: Find models similar to this one
Where a semantic index is available, the client SHALL offer an action on a model that requests its nearest neighbours from that index and presents them as a set of results in place of the listing, ordered by similarity, with the model itself excluded. Neighbours SHALL be drawn from the whole indexed collection rather than from the folder the model is browsed in, since a model's nearest neighbours are a question about the collection and the folder's own answer is already on screen. The result SHALL be a view like any other: named in the URL by the model the neighbours were derived from, participating in history, and reproducing for anyone who opens that URL. It SHALL be left through the same explicit dismissal that other result sets offer, since there is no typed text to clear.

The action SHALL be offered only where it could apply — on a model, within the collection the index covers, and outside an archive — and SHALL distinguish a model the index has not yet embedded from one it can never embed, since only the first is fixed by indexing again. Where the index is unavailable the action SHALL be absent, and opening a URL naming such a view SHALL present the location's ordinary listing with an explanation rather than an empty grid.

#### Scenario: More like this one
- **WHEN** the user asks for models similar to one on screen
- **THEN** its nearest neighbours replace the grid, ordered by similarity, without the model itself among them

#### Scenario: Neighbours come from the whole collection
- **WHEN** the user asks for models similar to one held in a deeply nested folder
- **THEN** matches from anywhere in the indexed collection are returned, not only from that folder

#### Scenario: A similarity view is shareable
- **WHEN** the user copies the URL of a similarity result and opens it elsewhere
- **THEN** the same neighbours are presented, derived from the same model

#### Scenario: Not indexed yet versus never indexable
- **WHEN** the action is invoked on a model the index has not embedded, and on one inside an archive
- **THEN** the first is explained as not yet indexed and the second as outside what the index covers

#### Scenario: Leaving a similarity view
- **WHEN** similarity results are on screen
- **THEN** the same dismissal that leaves any other result set returns to the ordinary listing

#### Scenario: No index, no action
- **WHEN** the semantic index is unavailable
- **THEN** the action is not offered, and every other entry action still works
