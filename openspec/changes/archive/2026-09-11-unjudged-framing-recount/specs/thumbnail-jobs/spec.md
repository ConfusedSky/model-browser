## MODIFIED Requirements

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
every bulk-job surface are maintenance affordances — operations on the server's own
derived state — offered only where the server's feature report (`feature-report`)
declares that capability on; which deployments withhold it is the report's business,
not this capability's.

#### Scenario: The count follows the user's own hand
- **WHEN** the library tab is open and the user orbits a model, chooses its axis, or gives its framing up from its tile or the viewer
- **THEN** the reset count moves accordingly at once, by the change that hand made — not by re-deriving the scope, which happens when the tab opens, when a job that wrote something ends, or when this session cannot judge the hand's change (the tile's own thumbnail had not landed, so its before-state is unknown), in which case the scope is re-derived once after the write lands rather than the change going uncounted

#### Scenario: The button is honest
- **WHEN** the user opens the library tab
- **THEN** the generate and reset buttons state how many entries each would touch, from the cached tree where one exists — walking only a root that has never been walked, as a first listing of it would — and say that they are counting until then

#### Scenario: Reset asks first
- **WHEN** the user invokes a reset over a scope holding stored framings
- **THEN** a confirmation states the count before anything is discarded, and cancelling it discards nothing

#### Scenario: A held job says so
- **WHEN** a generate job's next entry has waited more than a moment behind what is on screen — nearer renders, pending lookups, or an open viewer
- **THEN** the chip says it is waiting behind what the user is looking at, and stops saying so the moment the entry runs

#### Scenario: The chip outlives the folder that launched it
- **WHEN** the user launches a subtree job from a context menu and navigates elsewhere
- **THEN** the job continues, and the chip still shows its progress and offers cancel
