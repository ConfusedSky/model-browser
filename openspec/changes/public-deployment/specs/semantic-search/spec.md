# semantic-search Delta

## ADDED Requirements

### Requirement: Where the index is not the viewer's to operate, its states collapse
Where a deployment declares that the machine it runs on is not the viewer's concern (see
`feature-report`) — the same declaration that stops any surface naming a host location or
offering an operator's remedy, since an index condition is named by its remedy — the
distinctions *The index's absence costs nothing*
draws between index conditions SHALL be presented to the viewer as a single
unavailability. Those distinctions exist because each names a different repair — start
the service, plug the volume in, restart the wedged process — and a viewer of such a
deployment can make none of them, so naming them offers a remedy that is not theirs and
describes the operator's machine to a stranger. The states SHALL still be distinguished
*within* the server, since the operator's own diagnosis depends on them; only what the
viewer is told collapses.

A condition that resolves on its own SHALL NOT collapse: an index still loading SHALL
continue to be presented as not yet ready, and SHALL become available without the viewer
reloading, exactly as it does today. A deployment's own start is a real wait, and telling
a viewer to come back is honest where telling them to start a service is not.

The base requirement's rule that the client SHALL prefer an explanation the index itself
states to one composed here SHALL be suspended for the collapsed states, and any such
explanation SHALL be withheld rather than printed beside the collapsed sentence: that text
is the index's own, can name its cache directory or its collection root, and would restore
in a detail line exactly what the collapse removed from the sentence. It SHALL continue to
be preferred wherever a state is not collapsed. Likewise, guidance to run the classifier
over an unembedded model SHALL NOT be given, since running it is an operator's act.

Where the location is outside the collection the index covers, that SHALL continue to be
distinguished from the index being unavailable, since it is a fact about where the viewer
is browsing rather than about the operator's machine, and the viewer can act on it by
browsing elsewhere.

#### Scenario: A viewer is not sent to fix a machine they cannot reach
- **WHEN** the index is not running, or its storage is unavailable, or it is wedged, on such a deployment
- **THEN** the viewer is told meaning search is unavailable, without being told which of those it is or what to start

#### Scenario: Still loading is still said
- **WHEN** the index is loading on such a deployment
- **THEN** the viewer is told it is not yet ready, and meaning search becomes available once it is, without a reload

#### Scenario: Outside the collection still says so
- **WHEN** a viewer browses a location the index does not cover on such a deployment
- **THEN** they are told the index does not cover this location, as they are today

#### Scenario: The index's own words do not leak the collapse open
- **WHEN** the index supplies a reason or hint for a collapsed condition
- **THEN** it is withheld rather than shown beside the collapsed sentence, while an uncollapsed state still prefers the index's own words

#### Scenario: A viewer is not told to run the classifier
- **WHEN** a viewer asks for models similar to one the index has no embedding for
- **THEN** they are told it has none, without being told to run the classifier over it

#### Scenario: The operator still sees the difference
- **WHEN** the server determines the index's condition on such a deployment
- **THEN** it distinguishes the conditions internally as it does today, and only the viewer-facing account collapses

#### Scenario: An ordinary deployment is unchanged
- **WHEN** a deployment does not declare this
- **THEN** every index condition is reported to the user exactly as it is today
