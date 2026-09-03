# app-launch Delta

## ADDED Requirements

### Requirement: A deployment may withhold the platform launcher
Where a deployment declares that it does not offer the platform launcher (see
`feature-report`), the applications report SHALL name no applications and no configured
chooser, and every route that launches an application or hands an entry to a chooser
SHALL refuse. Refusal SHALL be at the routes and SHALL NOT rely on the client having
withheld its surfaces: all three of these routes run commands on the machine hosting the server — the report route queries the platform registry per model type on every request, by design, since a chooser can rewrite it mid-session —
so a deployment reachable by anyone must not spawn anything on a stranger's request, and
the report is advisory by definition. An empty report SHALL be the whole of the client's
withholding, since the client's open-in choices and its chooser action are already built
from what the report names — a deployment that offers nothing therefore offers nothing on
every surface that hosts these actions, with no surface left behind.

#### Scenario: The report route runs nothing
- **WHEN** the applications report is requested on such a deployment
- **THEN** it answers without querying the platform registry, so no process is spawned and no application entry is read

#### Scenario: Nothing is reported
- **WHEN** the applications report is read from a deployment that withholds the launcher
- **THEN** it names no applications for any type and says no chooser is configured

#### Scenario: The actions are absent
- **WHEN** an entry's actions are offered on such a deployment
- **THEN** the open-in choices and the chooser action are absent rather than present and inert

#### Scenario: A launch request is refused
- **WHEN** a request to launch an application, or to hand an entry to a chooser, reaches such a deployment
- **THEN** it is refused and no process is spawned, whatever client sent it
