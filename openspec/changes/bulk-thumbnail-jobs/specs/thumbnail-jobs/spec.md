# thumbnail-jobs Delta

## ADDED Requirements

### Requirement: Bulk jobs are derived, scoped, and re-derivable
The client SHALL offer bulk thumbnail work as jobs of two operations over a scope — a
subtree or the whole library. *Generate* SHALL render and store a thumbnail for each
model in scope whose thumbnail is missing or stale, touching no current entry. *Reset*
SHALL apply, to each model in scope with a stored orientation — a stored camera or a
stored axis, one definition shared by the derivation and the counts — the same
give-up-the-orientation semantics the per-model action defines (`entry-actions`), and
SHALL delete that model's cached renders rather than redraw them, so no image remains
that was rendered from a discarded camera and the job renders nothing — redrawing is
*generate*'s work, or the next visit's. A reset MAY leave an on-screen tile in its scope
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

### Requirement: One job at a time, always preemptible, never overwriting the user
At most one bulk job SHALL run at a time; launching while one runs SHALL surface the
running job rather than starting a second. Job work SHALL rank no better than deferred
far work — the render queue's lowest existing rank, with which it may tie — so
on-screen, near, and unreported work always renders first. (No rank below `far`
exists; adding one would be a `model-thumbnails` change of its own, deferred until tying
with far tiles proves insufficient — see the archived `bulk-thumbnail-jobs` change.) An
entry whose stored state changed after the job's launch — detected by its write
generation having moved — SHALL be skipped and counted, never overwritten. A per-entry
failure SHALL be counted and reported without stopping the job; the job fails as a
whole only when nothing in it could proceed.

#### Scenario: Browsing during a job stays fast
- **WHEN** the user scrolls a folder of unrendered tiles while a whole-library job runs
- **THEN** the visible tiles render ahead of the job's remaining work

#### Scenario: A mid-job orbit survives
- **WHEN** a reset job covers a model the user orbits after the job launched
- **THEN** the job skips that model, and the user's new framing stands

#### Scenario: One bad model does not end the job
- **WHEN** a model in scope fails to load or render
- **THEN** the job continues, the failure is counted and visible at completion, and a relaunch retries it

### Requirement: Jobs are launched with their cost stated, and watched from one chip
A launcher's cost SHALL be stated where it can be delivered without re-shaping the
surface that offers it: the `library` tab's buttons carry their counts (the tab renders
asynchronously already); a context-menu entry is uncounted — the menu is measured,
clamped and focus-seeded from its command list at mount, and a late-arriving count
would move it — and states its count at the next step instead. A reset
SHALL require confirmation carrying the derived count, since it discards user-authored
framings; a generate SHALL run without confirmation, its count appearing on the
progress affordance as the job starts. A launched job SHALL be
represented by one persistent, dismissible progress affordance, the same whichever
launcher started it, surviving navigation, showing operation, scope, progress, and
failures, and offering cancellation at any time. Dismissing it SHALL NOT cancel the
job. Whole-library scope SHALL be offered from a `library` side-panel tab; that tab and
every bulk-job surface are write affordances, expected to be withheld wholesale where
the server does not accept thumbnail writes (the planned feature report's business, not
this capability's).

#### Scenario: The button is honest
- **WHEN** the user opens the library tab
- **THEN** the generate and reset buttons state how many entries each would touch, from the cached tree where one exists — walking only a root that has never been walked, as a first listing of it would — and say that they are counting until then

#### Scenario: Reset asks first
- **WHEN** the user invokes a reset over a scope holding stored framings
- **THEN** a confirmation states the count before anything is discarded, and cancelling it discards nothing

#### Scenario: The chip outlives the folder that launched it
- **WHEN** the user launches a subtree job from a context menu and navigates elsewhere
- **THEN** the job continues, and the chip still shows its progress and offers cancel
