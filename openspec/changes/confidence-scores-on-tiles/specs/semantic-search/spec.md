## MODIFIED Requirements

### Requirement: Weak matches are shown and marked
When the index reports a result set as weak — its best match not standing out from the collection — the client SHALL still present the results, visibly marked as weak, rather than suppressing them. The marking SHALL apply to the **set**, and SHALL remain a statement about the set even where per-result numbers are shown beside the tiles: a weak set stays marked weak whatever any single tile reports, since the verdict is read off the best result before any cut and no per-tile number restates it. The ranking SHALL continue to express relative strength within a set, so that a set is judgeable with every number ignored. The client's earlier prohibition on presenting a per-result score or z value is lifted: the objection it rested on is that scores from different routes come from different distributions, and that is answered by naming the scale on the badge rather than by withholding the number — the requirement below states how.

#### Scenario: A weak query still shows its guesses
- **WHEN** a phrase produces no result that stands out from the collection
- **THEN** the matches are shown, marked as weak, and the user can judge them rather than being told nothing matched

#### Scenario: Strength is the order, not a number on the tile
- **WHEN** results of any kind are presented
- **THEN** their order expresses their relative strength on its own, and any per-result numbers drawn beside them add to that order rather than replace it — removing every number would leave the set still readable, and the numbers never reorder it

## ADDED Requirements

### Requirement: A scored result shows its two numbers under the scale they came from
Where results came from a scored query, the client SHALL present the index's two per-result numbers — the pooled cosine and the robust z — on each result's tile and in the lightbox's info panel for a model opened from that result. Both SHALL be the index's own values, presented as the index reports them: they SHALL NOT be rescaled, normalised, banded, or otherwise recomputed here, since a number this app derived would not be the number the index's own thresholds are stated against.

The cosine SHALL be labelled by the route that produced it — as `k` for a meaning search and as `sim` for a similarity view — because cosines from the two routes come from measurably different distributions (model-to-model 0.85–0.99 against text-query ~0.1) and an unlabelled number invites a comparison across them that neither supports. The z SHALL be labelled `z` in both, being comparable across queries by construction. The cosine SHALL be shown to three decimal places and the z to two.

On a tile the cosine SHALL occupy the top-left corner over the thumbnail and the z the top-right, and both SHALL be visible without hover, selection, or a setting to enable them. They SHALL be drawn over the rendered image and SHALL NOT be rendered into it, so that no cached thumbnail is invalidated by their presence or absence.

Where a surface is drawn *over* a scored tile — the orbit overlay a press promotes to — the numbers SHALL remain visible on top of it, since a press is not a request to stop seeing them and the thing being turned is the very model they describe. Exactly one pair SHALL be visible at a time: the covering surface and the tile beneath it are separately positioned, so a tile SHALL yield its own badges while its overlay draws them rather than both drawing a pair that cannot align.

Both numbers SHALL also be carried by the tile's accessible name, since a tile states its accessible name rather than composing it from what it contains, and a number drawn inside it would otherwise be presented to everyone except a user who cannot see it. There the scale SHALL be named in full rather than by the short label the corner carries — a single letter being legible in a grid whose view says what produced it, and not legible read aloud on its own.

Tiles that did not come from a scored query SHALL show neither number and SHALL reserve no space for them, an ordinary directory listing being unchanged by this requirement. A similarity view's anchor — the model its neighbours were computed from — SHALL show neither number, the index having excluded it from its own ranking rather than scored it. A result the server could not resolve on disk contributes neither a tile nor a number, the two being keyed alike.

#### Scenario: A meaning result carries its numbers
- **WHEN** a meaning search returns results
- **THEN** each tile shows the pooled cosine labelled `k` in its top-left corner to three decimals and the robust z labelled `z` in its top-right to two, both visible without hovering the tile

#### Scenario: A neighbour's number is labelled as a neighbour's
- **WHEN** a similarity view's results are shown, whose cosines run far higher than a meaning search's
- **THEN** the cosine is labelled `sim` rather than `k`, at its own unaltered value, so it does not read as a stronger match than a meaning result's lower number

#### Scenario: The numbers are announced, not only drawn
- **WHEN** a scored result's tile is reached without seeing it
- **THEN** its accessible name carries both numbers with their scales named in full, rather than naming the model alone and leaving the corners unread

#### Scenario: Turning a model does not hide what it scored
- **WHEN** the user presses a scored tile and orbits it in place
- **THEN** the numbers stay visible above the model being turned, and exactly one pair is on screen for it rather than a second pair emerging from the tile underneath

#### Scenario: Ordinary browsing shows no numbers
- **WHEN** the user browses a directory, a flat search, or a zip's contents
- **THEN** no tile shows either number and no space is held for them, the tiles being identical to what they were before this change

#### Scenario: The anchor is the question, not an answer
- **WHEN** a similarity view is shown with its anchor model beside the neighbours
- **THEN** the neighbours carry their numbers and the anchor carries none

#### Scenario: The panel says what the tile said
- **WHEN** the user opens a scored result in the lightbox
- **THEN** the info panel presents the same two values under the same labels as that result's tile, and a model opened from an unscored listing shows neither row

#### Scenario: A number is never baked into a thumbnail
- **WHEN** a model appears first in a meaning search and later in a plain directory listing
- **THEN** its thumbnail is the same cached image in both, carrying no trace of the badges, and re-rendering was not triggered by the difference

#### Scenario: A stale hit takes its number with it
- **WHEN** the index returns a model that no longer exists on disk
- **THEN** the hit produces no tile and no number, exactly as the tree-resolution requirement already drops it, and the remaining results keep the numbers the index gave them
