## ADDED Requirements

### Requirement: The panel's links are in the lightbox's focus ring

Every link the lightbox's side panel renders — the author, the license and the source of the
model's attribution — SHALL participate in the lightbox's focus trap alongside the panel's
controls, so that a visitor using the keyboard alone can reach one and follow it. The links
SHALL take their place in the ring in the order they are read on screen, among the controls
they sit between, rather than being appended after them: the attribution is part of what the
panel says about the model, and a ring that reordered it would not match what a screen reader
announces. Advancing SHALL step forward through that sequence and retreating SHALL step
backward through the same sequence, and both SHALL stay inside the lightbox, wrapping as the
trap already wraps.

Adding links to the ring SHALL NOT admit anything that cannot take focus: a disabled control
SHALL continue to be skipped. A model for which the library holds no attribution renders no
such links, and its ring SHALL be exactly the ring of controls it was.

#### Scenario: The attribution links are reachable

- **WHEN** the lightbox is open on a model whose library holds an author URL, a license URL
  and a source URL, and the visitor tabs forward through the dialog
- **THEN** each of the three links is focused in turn, in the order the panel draws them, and
  the dialog and its controls are focused in the same pass

#### Scenario: Retreating walks the same ring

- **WHEN** the visitor holds shift and tabs backward from a focused attribution link
- **THEN** focus moves to whatever precedes it in the forward order, and continuing backward
  reaches the same members in reverse without leaving the lightbox

#### Scenario: A disabled control is still skipped

- **WHEN** the lightbox is open on the first model of its listing, where the previous-model
  control is disabled, and the visitor tabs forward
- **THEN** focus advances past the disabled control to the next member of the ring rather
  than stopping on it

#### Scenario: An uncredited model's ring is unchanged

- **WHEN** the lightbox is open on a model the library holds no attribution for and the
  visitor tabs through it
- **THEN** the ring is the dialog and its controls, with no additional stops
