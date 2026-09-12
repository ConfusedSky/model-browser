## MODIFIED Requirements

### Requirement: Bulk jobs are derived, scoped, and re-derivable
The client SHALL offer bulk thumbnail work as jobs of two operations over a scope — a
subtree or the whole library. *Generate* SHALL render and store a thumbnail for each
model in scope whose thumbnail is missing or stale, touching no current entry. *Reset*
SHALL apply the same give-up-the-orientation semantics the per-model action defines
(`entry-actions`) to each model in scope holding a stored orientation — a camera, an
axis, or both — and SHALL count exactly those models, so that a count never offers a
reset that resets nothing and a reset never leaves a model that a later count would
offer again; the derivation and the counts SHALL share that one definition.
Reset SHALL delete each such model's cached renders rather than redraw them, so no image
remains that was rendered from a discarded camera and the job renders nothing —
redrawing is *generate*'s work, or the next visit's. A reset MAY leave an on-screen tile in its scope
without an image until the ordinary sweep redraws it: a scope cannot be redrawn in place
the way one tile can. A job's work list SHALL be derived at launch from per-entry state —
obtained by enumerating the scope's models together with their cached thumbnail facts
(`listing-cache`'s enumeration), never by walking the filesystem from the client and
never cut to a listing's cap; a scope whose enumeration reports itself incomplete SHALL
still run over what was found and SHALL say so on the progress affordance — and progress
SHALL be tracked by nothing but that state: a completed entry drops out of any later
derivation, so launching the same job again continues where the last run stopped,
whatever ended it. Per-entry work SHALL be atomic. There SHALL be no persisted job
record.

#### Scenario: Resume is a relaunch
- **WHEN** a generate job over a folder is cancelled halfway and launched again
- **THEN** the second run's work list is the un-generated remainder, and nothing already generated is re-rendered

#### Scenario: Reset leaves no lying pixels
- **WHEN** a reset job processes a model with a stored camera
- **THEN** the orientation is given up exactly as the per-model action would, its cached renders are deleted, nothing is rendered, and the next visit or generate job draws it at what it then resolves to

#### Scenario: Generate is incremental by nature
- **WHEN** a generate job runs over a folder where most thumbnails are current
- **THEN** only the missing and stale entries are rendered
