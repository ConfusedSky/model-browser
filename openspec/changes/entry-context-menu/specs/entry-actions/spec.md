# entry-actions Delta

## ADDED Requirements

### Requirement: Entry actions are defined once and offered on every surface that hosts them
The client SHALL define each action available on a listing entry once, and every surface offering that action SHALL invoke that definition rather than reimplementing it. The surfaces are a context menu raised on a grid tile and the expanded viewer's information panel. An action SHALL behave identically whichever surface invoked it.

Shared actions are one-shot commands that need no rendered model. Controls that operate on a live view — those that change how the model is currently displayed and show the result as they do it — SHALL remain with that view rather than being offered as menu items.

Which actions an entry offers SHALL follow from what the entry is, and an action that cannot apply to an entry SHALL be absent rather than present and inert.

#### Scenario: The same action, two ways in
- **WHEN** the user copies an entry's path from the context menu, and again from the expanded viewer
- **THEN** the same text is placed on the clipboard by the same implementation, with the same behavior when the clipboard is unavailable

#### Scenario: Actions that need no model do not load one
- **WHEN** the user raises the context menu on a model tile and invokes an action
- **THEN** the model's mesh is not fetched or rendered for that action's sake

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

### Requirement: Find models similar to this one
Where a semantic index is available, the client SHALL offer an action on a model that requests its nearest neighbours from that index and presents them as a set of results in place of the listing, ordered by similarity, with the model itself excluded. The result SHALL be a view like any other: named in the URL by the model the neighbours were derived from, participating in history, and reproducing for anyone who opens that URL. It SHALL be left through the same explicit dismissal that other result sets offer, since there is no typed text to clear.

The action SHALL be offered only where it could apply — on a model, within the collection the index covers, and outside an archive — and SHALL distinguish a model the index has not yet embedded from one it can never embed, since only the first is fixed by indexing again. Where the index is unavailable the action SHALL be absent, and opening a URL naming such a view SHALL present the location's ordinary listing with an explanation rather than an empty grid.

#### Scenario: More like this one
- **WHEN** the user asks for models similar to one on screen
- **THEN** its nearest neighbours replace the grid, ordered by similarity, without the model itself among them

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
