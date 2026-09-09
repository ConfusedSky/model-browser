## MODIFIED Requirements

### Requirement: The panel credits the model's source
When the viewed entry resolves credits from the library's override store, the
lightbox side panel SHALL show an attribution block: the author (linked to the
author URL when one is stored), the license (linked to the license URL when
one is stored, plain text otherwise), a link to the source, and — when the
store holds a modified phrase — a modified row carrying that phrase verbatim,
which is the notice that the served copy is not the author's file. The
block SHALL sit among the model's metadata, before the panel's actions — the
existing "describes before it offers" rule, which appending after the action
strip would break. Because credits arrive from a read rather than from the
directory entry, the block MAY appear after the panel is first shown; no
placeholder and no loading state SHALL stand in for it meanwhile. When the
entry resolves no credits — no store, no covering key, or the overrides read
failed — the panel SHALL show no attribution block and no placeholder for it;
and a kit without a modified phrase SHALL draw no modified row: attribution is
displayed where it exists, never advertised as missing, and a copy served
unchanged is not labelled. The
overrides read SHALL follow the viewer subject — asked when it changes,
its answer ignored once the subject has moved on.

#### Scenario: A credited model
- **WHEN** the lightbox opens on a model beneath a kit whose key holds credits
- **THEN** the panel shows the author, license and source link for that kit, among the metadata and before the actions

#### Scenario: A license with a stored URL
- **WHEN** the resolved credits hold a license URL
- **THEN** the license label is a link to that URL, opening in a new tab like the author and source links

#### Scenario: A license without a URL
- **WHEN** the resolved credits hold a license and no license URL
- **THEN** the license label draws as plain text, as it did before the URL was stored

#### Scenario: A modified copy
- **WHEN** the resolved credits hold a modified phrase
- **THEN** the panel shows a modified row carrying the phrase, within the attribution block

#### Scenario: A copy served unchanged
- **WHEN** the resolved credits hold no modified phrase
- **THEN** the panel shows no modified row and nothing in its place

#### Scenario: An uncredited model
- **WHEN** the lightbox opens on a model no key covers
- **THEN** the panel shows no attribution block

#### Scenario: A failed read is silent
- **WHEN** the overrides request fails while the lightbox is open
- **THEN** the panel renders as it does for an uncredited model, and nothing else in the viewer is affected

#### Scenario: The subject moves on
- **WHEN** the viewer subject changes before the previous subject's overrides answer arrives
- **THEN** the late answer is not rendered for the new subject
