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

The client SHALL also offer, on a model, a distinct action that gives up the orientation stored for that model, returning it to however it would be shown had the user never set one. It SHALL **discard** that orientation rather than store a default in its place, and render the thumbnail at whatever the model then resolves to — an orientation the view's own answer supplies for it, the default otherwise. Discarding rather than overwriting is the whole of the action: a stored default is an orientation of the user's own, and would suppress the very source that would otherwise frame the model well. The action is needed because a thumbnail is rendered *from* the stored orientation, so rendering again without discarding it reproduces the same image. Giving up the orientation SHALL also govern where the model opens in the expanded viewer, since a model has one stored orientation rather than one per surface, and SHALL take effect there within the session rather than only after the next load.

What that action discards SHALL follow from what is available to replace it. Where the view's answer supplies an orientation for the model and the client can express it, it SHALL discard the stored axis along with the camera, so that orientation applies entire — an up axis together with the angles measured about it, which are one thing and cannot be taken apart, since angles measured about one axis do not describe a view about another. Where the view supplies none, or the one offered is not usable, it SHALL discard the camera alone and leave the axis, which then frames the model by default about the axis the user established.

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
- **WHEN** the user gives up the orientation of a model — including one whose axis they had chosen — where the view's own answer supplies that model's orientation and the client can express it
- **THEN** the axis is discarded with the camera and the model is framed by that orientation entire, rather than by the default about the axis it used to have; where the view supplies none, the axis stands, so the command reaches further from a grid that carries orientations than from a plain listing, which carries none

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
Where a semantic index is available, the client SHALL offer an action on a model that requests its nearest neighbours from that index and presents them as a set of results in place of the listing, ordered by similarity, with the model itself excluded. Neighbours SHALL be drawn from the whole indexed collection rather than from the folder the model is browsed in, since a model's nearest neighbours are a question about the collection and the folder's own answer is already on screen.

The result SHALL be a view like any other: it is what the view is *about*, in the same sense a committed query is, and SHALL be named in the URL by the model the neighbours were derived from, participate in history, and reproduce for anyone who opens that URL. A view SHALL be about at most one thing — asking for neighbours SHALL leave any committed query behind, and committing a query SHALL leave a similarity view behind — and the URL SHALL name only what the view's subject reads: the source model, and the parameters below, but no query text, search mode, or kind restriction, since none of those selects anything within it.

The parameters the neighbours were computed under SHALL be adjustable while the results are on screen — how many neighbours to return, and how the index reduces a model's several views to one score — offered with the results as the search options are, and only where they can apply, since a view that is not about a model has no neighbours to shape. Changing one SHALL ask the question again rather than reshape the answer already there, because a different parameter is a different question: the view it produces SHALL be a distinct view, named distinctly in the URL, so that going back across a change returns to the neighbours that were actually shown.

These parameters SHALL belong to the view rather than to the profile: they SHALL travel in the URL so a neighbourhood worth showing someone reproduces for them, and SHALL NOT be remembered as a preference for the next model, whose neighbourhood a count chosen for this one says nothing about. Each SHALL have a default that the URL states by omitting it, so a view that adjusted nothing is named exactly as it was before they could be adjusted; where the default belongs to the index rather than to this client, omission SHALL leave the index's own in force rather than this client naming a value on its behalf.

A similarity view SHALL be leaveable. Since it holds no typed text to clear, the client SHALL offer an explicit dismissal with the results — **one** control, shown wherever the view is about something, whether that is a committed query or a model — so that leaving a similarity view and leaving a search are the same act rather than two that resemble each other, and emptying the search input SHALL do what that control does rather than carry its own copy of the rule.

Where the dismissal leads SHALL follow from where the view was entered. A similarity view raised from within the app SHALL return to the view it was raised from, entire — the search that was on screen, with its own results, or the listing — since that view is what the user was looking at and it may have cost minutes to produce, and an exit that discarded it is one people learn not to press. A similarity view opened from a link, with none of this app's history behind it, SHALL return the location's ordinary listing instead. This SHALL be one rule with one branch inside it rather than two dismissals, and dismissing a committed query SHALL be unchanged by it.

The action SHALL be offered only where it could apply — on a model, within the collection the index covers, and outside an archive — and SHALL distinguish a model the index has not yet embedded from one it can never embed, since only the first is fixed by indexing again. Where the index is unavailable the action SHALL be absent. A similarity view SHALL wait for an index that is not ready exactly as a deferred meaning search does: nothing is fetched while the index has not yet answered whether it can serve at all, the location's ordinary nested listing stands in once it has, the view keeps its name meanwhile and the UI says what it is waiting for — naming the model rather than offering to search names, since a similarity view has no phrase to search names with — and the wait is cancelled completely, banner and URL included, when the user navigates away, commits a query, or dismisses the view.

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
- **WHEN** similarity results raised from within the app are on screen and the user activates the dismissal offered with them — or empties the search input, which is the same act
- **THEN** the view they were raised from returns entire, with its own results, rather than the location's listing being asked for again; and a similarity view opened from a link, with nothing of this app's behind it, returns the location's ordinary listing — by the same control, and the same rule beneath it, that leaves a committed search

#### Scenario: Asking for more neighbours, or fewer
- **WHEN** the user changes how many neighbours a similarity view shows, or how the index scores a model's several views
- **THEN** the neighbours are computed again under the new parameter and the URL names it, so the view can be shared and returned to as it was — and going back reaches the neighbours shown before the change rather than the same ones relabelled

#### Scenario: The parameters belong to the view, not to the profile
- **WHEN** the user adjusts a similarity view's parameters, leaves it, and asks for another model's neighbours
- **THEN** the new view starts from the defaults, and its URL names neither parameter, since a count chosen for one model's neighbourhood says nothing about another's

#### Scenario: The parameters are offered only where they apply
- **WHEN** the view is a listing or a committed search rather than a set of neighbours
- **THEN** the neighbour parameters are not offered, since there are no neighbours to shape

#### Scenario: A view is about one thing at a time
- **WHEN** the user asks for neighbours while a search is committed, and later commits a search while similarity results are on screen
- **THEN** each replaces the other as what the view is about, and the URL never names both

#### Scenario: A similarity view waits for a warming index
- **WHEN** a URL naming similarity results is opened while the index is still starting up
- **THEN** nothing is fetched until the index says whether it can serve, the location's nested listing then stands in, the view goes on naming the model it is about, and the wait is explained by naming that model

#### Scenario: Nothing similar enough to show
- **WHEN** a similarity request returns no neighbours
- **THEN** the view says so in terms of the model it was derived from, rather than presenting a grid that reads as an empty folder

#### Scenario: The model compared against is on screen
- **WHEN** a similarity view renders
- **THEN** the source model appears first, visibly marked as the subject rather than as one of the results, and is not counted among the neighbours — an anchor with no neighbours still reads as nothing similar

#### Scenario: No index, no action
- **WHEN** the semantic index is unavailable
- **THEN** the action is not offered, and every other entry action still works
