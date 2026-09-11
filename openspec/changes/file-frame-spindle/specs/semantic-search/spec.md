## MODIFIED Requirements

### Requirement: A pose orients the model without becoming its stored camera
Where the index supplies an orientation for a model, the client SHALL use it to open that model the right way up: its up axis SHALL correspond to one of the app's six orbit spindles and SHALL be that spindle, literally — the index measures in the file's coordinates and so does the spindle, so an up axis of `[0,0,1]` is spindle `+Z` with no coordinate mapping between them — and any front-view angles SHALL be applied as the live view's orientation, leaving framing distance and target to the viewer. An up axis that does not correspond to one of the six, or an orientation that is internally inconsistent, SHALL be treated as a fault in the index — the orientation ignored and the model opened as though none were supplied — and SHALL NOT be rounded to the nearest spindle, since rounding would conceal an upstream defect behind a plausible result and then persist it if the user orbited. The orientation presented SHALL be the one the index describes for every up axis it reports, not only for models already modelled about the app's default frame. Where the index supplies an up axis but no front view for it, the client SHALL present the model upright at the index's own stated default starting angle rather than discarding the orientation entirely. An orientation from the index SHALL NOT override an axis the user has already established for that model, and applying one SHALL NOT persist a camera or re-render a stored thumbnail — only the user's own manipulation of the view SHALL do that.

#### Scenario: Opening a model the right way up
- **WHEN** the user opens a model the index has an orientation for and no axis of their own
- **THEN** the model is presented upright at the index's front angles, framed by the viewer as usual

#### Scenario: The index's axis is the spindle shown
- **WHEN** the index reports an up axis of `+Z` for a model with no axis of the user's own
- **THEN** the lightbox's axis control marks Z, and an up axis of `+Y` marks Y

#### Scenario: Every up axis reproduces the same view
- **WHEN** models sharing a front view but modelled about different up axes are opened at the index's orientation
- **THEN** each is presented from the same side of the model, since the index measures its angles about a common up direction and this app measures them about the model's own spindle

#### Scenario: An orientation outside the enumeration is a fault, not a rounding
- **WHEN** the index supplies an up axis that is not one of the six spindles
- **THEN** the model opens without an index orientation and the condition is reported as an index fault, rather than being rounded to the nearest spindle

#### Scenario: The user's own choice wins
- **WHEN** the user has previously established an orbit axis for a model
- **THEN** opening it again uses that axis, not the index's

#### Scenario: An orientation is not a saved camera
- **WHEN** a model is opened at an index-supplied orientation and closed without the user orbiting
- **THEN** no camera is persisted for it and its thumbnail is unchanged
