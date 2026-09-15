## ADDED Requirements

### Requirement: Stepping updates the model parameter in place
When the user steps the open lightbox to a sibling model (the *Lightbox steps between
sibling models* behaviour), the client SHALL update the model URL parameter to name the
model now on screen, so the address names the model shown and a reload or a shared URL
reproduces it. The client SHALL make this update in place — replacing the current history
entry, not pushing a new one — so that a run of steps leaves a single history entry and the
browser back action still closes the lightbox onto the listing it opened from, rather than
retracing the steps one model at a time. The update SHALL carry the current history entry's
state forward, so that the lightbox-as-modal history behaviour (back closes it, forward
re-opens it) is unaffected by having stepped. The model parameter and the model the lightbox
displays SHALL never disagree while stepping: the parameter SHALL move with the view in the
same update, so no step is seen as the model leaving the view.

#### Scenario: The parameter follows the step
- **WHEN** the user opens a model's lightbox and steps to the next model
- **THEN** the model URL parameter names the next model, and reloading or sharing that URL opens the lightbox on it

#### Scenario: Stepping adds no history entries
- **WHEN** the user opens a lightbox and steps through several siblings
- **THEN** no history entries are added for the steps, and one browser back action closes the lightbox onto the listing it was opened from

#### Scenario: Back still closes a stepped lightbox
- **WHEN** the user opens a lightbox, steps forward some models, and presses the browser back button
- **THEN** the lightbox closes onto the unchanged listing and forward re-opens the model that was on screen
