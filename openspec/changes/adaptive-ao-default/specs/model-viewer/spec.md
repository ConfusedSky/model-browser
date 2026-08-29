# model-viewer Delta

> ADDED only. *Ambient-occlusion shading* is MODIFIED by `ao-as-recipe-dimension` and is
> not touched here; this requirement states how the default it names is chosen when
> nobody has chosen.

## ADDED Requirements

### Requirement: Occlusion defaults by measurement
The ambient-occlusion preference SHALL have three states per browser profile: a user's choice (on or off), an automatic decision, and unset. Unset SHALL behave as occlusion on until measured. While the preference is unset and the lightbox is open, the viewer SHALL measure the interval between consecutive animation-frame renders at the lightbox's render size — discarding a fixed number of warm-up frames on the first such run — and SHALL maintain a running median over a fixed window of recent frames. When that median exceeds a frame budget held as a single named constant beside the other live-view tuning constants, the preference SHALL become an automatic *off*, recorded with the median that caused it. An automatic decision SHALL persist across sessions and SHALL NOT be revisited by measurement. A user's choice SHALL never be changed by measurement, and pressing the toggle SHALL always record a choice. The toggle SHALL indicate when the current state was decided automatically. Measurement SHALL sample only lightbox frames; the orbit overlay's frames SHALL NOT contribute.

#### Scenario: A weak GPU turns occlusion off by itself
- **WHEN** a profile that has never pressed the toggle opens the lightbox on hardware whose median frame interval with occlusion exceeds the budget
- **THEN** occlusion is turned off for that profile, the toggle shows the state as automatic, and thumbnails and live views thereafter render unoccluded as if the toggle had been pressed

#### Scenario: A capable GPU is left alone
- **WHEN** a profile that has never pressed the toggle opens the lightbox on hardware whose median frame interval stays within the budget
- **THEN** occlusion stays on and nothing is stored as a decision, so a later heavier model is still measured

#### Scenario: A choice is never overridden
- **WHEN** the user has pressed the toggle to on, and later frames in the lightbox exceed the budget
- **THEN** occlusion stays on and no automatic decision is recorded

#### Scenario: The user overrides an automatic decision
- **WHEN** the toggle shows an automatic off and the user presses it
- **THEN** occlusion is on as the user's choice, the automatic marker is gone, and measurement does not run again for that profile

#### Scenario: A single hitch does not decide
- **WHEN** one frame in the lightbox takes far longer than the budget while the frames around it do not
- **THEN** the running median stays within the budget and no decision is made

#### Scenario: The overlay does not measure
- **WHEN** a profile that has never pressed the toggle orbits tiles in the overlay without opening the lightbox
- **THEN** no measurement is taken and occlusion stays on

#### Scenario: A legacy stored preference is a choice
- **WHEN** the app loads a profile whose stored preference predates the automatic state
- **THEN** it is read as the user's choice and is never measured
