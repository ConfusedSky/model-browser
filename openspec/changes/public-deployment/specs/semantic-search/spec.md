# semantic-search Delta

## ADDED Requirements

### Requirement: Where the index is not the viewer's to operate, its states collapse
Where a deployment declares that operating the semantic index is not the viewer's
concern (see `feature-report`), the distinctions *The index's absence costs nothing*
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

#### Scenario: The operator still sees the difference
- **WHEN** the server determines the index's condition on such a deployment
- **THEN** it distinguishes the conditions internally as it does today, and only the viewer-facing account collapses

#### Scenario: An ordinary deployment is unchanged
- **WHEN** a deployment does not declare this
- **THEN** every index condition is reported to the user exactly as it is today
