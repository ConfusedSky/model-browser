# model-viewer Delta

> ADDED only, deliberately: `remove-axis-lighting`, `ao-as-recipe-dimension`
> and `adaptive-ao-default` MODIFY other `model-viewer` requirements while
> active — attribution is a new concern under a new title, so nothing collides
> at archive.

## ADDED Requirements

### Requirement: The panel credits the model's source
When the viewed entry resolves credits from the library's override store, the
lightbox side panel SHALL show an attribution block: the author (linked to the
author URL when one is stored), the license, and a link to the source. When the
entry resolves no credits — no store, no covering key, or the overrides read
failed — the panel SHALL show no attribution block and no placeholder for it:
attribution is displayed where it exists, never advertised as missing. The
overrides read SHALL follow the viewer subject — asked when it changes,
its answer ignored once the subject has moved on.

#### Scenario: A credited model
- **WHEN** the lightbox opens on a model beneath a kit whose key holds credits
- **THEN** the panel shows the author, license and source link for that kit

#### Scenario: An uncredited model
- **WHEN** the lightbox opens on a model no key covers
- **THEN** the panel shows no attribution block

#### Scenario: A failed read is silent
- **WHEN** the overrides request fails while the lightbox is open
- **THEN** the panel renders as it does for an uncredited model, and nothing else in the viewer is affected

#### Scenario: The subject moves on
- **WHEN** the viewer subject changes before the previous subject's overrides answer arrives
- **THEN** the late answer is not rendered for the new subject
