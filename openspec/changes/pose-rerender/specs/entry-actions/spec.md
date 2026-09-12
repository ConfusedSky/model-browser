## MODIFIED Requirements

### Requirement: Refreshing a model's thumbnail and its framing
The client SHALL offer, on a model, an action that renders its thumbnail again under the thumbnail settings in force at that moment and replaces the cached image with the result. It SHALL render from the orientation that model would be rendered from on an ordinary visit — the camera stored for it where there is one, otherwise an orientation source's where the model has neither a camera nor an axis of its own, otherwise the default about whichever axis it has — and SHALL leave that orientation as it found it, storing pixels rather than a viewpoint. Where it renders under an orientation source, it SHALL record which recipe produced those pixels, exactly as an ordinary visit does, so that the image is not mistaken for one rendered without a source and is not re-rendered on the next visit for want of a label. It SHALL be offered whether or not the cached image is considered current, since the settings a thumbnail was rendered under can change without the view it is shown in being rebuilt, and since an image can be wrong for reasons no staleness test detects.

The client SHALL also offer, on a model, a distinct action that gives up the orientation stored for that model, returning it to however it would be shown had the user never set one. It SHALL **discard** that orientation rather than store a default in its place, and render the thumbnail at whatever the model then resolves to — an orientation the view's own answer supplies for it, the default otherwise. Discarding rather than overwriting is the whole of the action: a stored default is an orientation of the user's own, and would suppress the very source that would otherwise frame the model well. The action is needed because a thumbnail is rendered *from* the stored orientation, so rendering again without discarding it reproduces the same image. Giving up the orientation SHALL also govern where the model opens in the expanded viewer, since a model has one stored orientation rather than one per surface, and SHALL take effect there within the session rather than only after the next load.

The action SHALL discard the stored axis along with the camera, whatever is available to replace them: an up axis together with the angles measured about it are one thing and cannot be taken apart, since angles measured about one axis do not describe a view about another, and a model with nothing of its own is what "had the user never set one" means. What the model then resolves to is the orientation the view's own answer supplies where there is one and the client can express it, and otherwise the default about the file's own axis. An axis kept back by a reset would be a framing the model still holds: not counted while no orientation could replace it, counted and withholding that orientation the moment one could — a reset that has to be run twice.

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
- **THEN** the axis is discarded with the camera and the model is framed by that orientation entire, rather than by the default about the axis it used to have

#### Scenario: With nothing to replace it, the axis stays
- **WHEN** the user gives up the orientation of a model the index supplies none for, whose orbit axis they had chosen
- **THEN** the camera and the axis are both discarded and the model is framed by default about the file's own axis; when the index later supplies an orientation for it, that orientation applies without a second reset, and the model is not counted as holding a framing in between

#### Scenario: Re-rendering never moves the axis
- **WHEN** the user re-renders the thumbnail of a model whose orbit axis they had chosen, whether or not the index supplies an orientation for it
- **THEN** the model keeps that axis and is drawn about it

#### Scenario: Offered on a tile that has no image
- **WHEN** the user raises the menu on a model whose thumbnail failed to render
- **THEN** both actions are offered, since a failed image is one of the things re-rendering exists to fix

#### Scenario: Not offered on containers
- **WHEN** the user raises the menu on a directory or an archive
- **THEN** neither action is listed
