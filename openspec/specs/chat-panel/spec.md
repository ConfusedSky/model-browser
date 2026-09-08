# chat-panel Specification

## Purpose
TBD - created by archiving change model-browser-v1. Update Purpose after archive.
## Requirements
### Requirement: Collapsible chat side panel
The UI SHALL show a collapsible panel on the right edge hosting **tabs**: a search tab holding the search options and a read-back of the committed search, and — where the deployment declares the chat tab offered (see `feature-report`) — the placeholder chat interface (message list area and input box). Because the chat has no backend, the maintained configuration SHALL NOT declare it, so a placeholder is not the first thing a new profile meets; the tab remains declarable, and a deployment that offers it gets exactly the panel described here. Where the tab is not offered it SHALL be absent rather than disabled, leaving no gap where it stood. The panel SHALL have no backend behavior of its own in this change; submitted chat input MAY be ignored or echoed locally, and the search tab SHALL issue no requests that operating its controls does not already cause. Collapse state SHALL persist in localStorage, as SHALL which tab is selected; neither belongs in the URL, since neither changes which entries a view contains. The recorded selection SHALL resolve to a tab that exists: where the chat tab is not offered, a profile that recorded it and a profile that recorded nothing SHALL both open on the search tab, and the recorded value SHALL NOT be rewritten, so a profile carried between deployments is not edited by having visited one. The search tab SHALL mirror the committed search rather than own it: the search input and the results label SHALL remain with the grid they describe, so that a collapsed panel never prevents searching or hides what the grid is.

#### Scenario: Collapsing and expanding
- **WHEN** the user clicks the panel's collapse control
- **THEN** the panel collapses to the edge and the grid reclaims the space; clicking again restores it

#### Scenario: Collapse state persists
- **WHEN** the user collapses the panel and reloads the app
- **THEN** the panel remains collapsed

#### Scenario: The selected tab persists
- **WHEN** the user selects the search tab and reloads the app
- **THEN** the search tab is still selected

#### Scenario: No backend calls
- **WHEN** the chat tab is offered and the user types into the chat input and submits
- **THEN** no network request is made to any chat/AI endpoint

#### Scenario: A collapsed panel does not block searching
- **WHEN** the panel is collapsed
- **THEN** the user can still type a query, submit it, and read its results label, because those live with the grid

#### Scenario: Withheld where not declared
- **WHEN** the panel is opened on a deployment that does not offer the chat tab
- **THEN** the tab is absent, and the panel's other tabs are unchanged

#### Scenario: A profile that never chose a tab
- **WHEN** a profile with no recorded tab opens a panel whose chat tab is not offered
- **THEN** it opens on the search tab rather than on the missing chat tab

#### Scenario: A profile that recorded chat
- **WHEN** a profile that recorded the chat tab opens a panel whose chat tab is not offered
- **THEN** it opens on the search tab, and its recorded value is not rewritten

#### Scenario: Offered where declared
- **WHEN** a deployment declares the chat tab offered and the report is known
- **THEN** the panel behaves exactly as it did before this capability was declarable, including which tab a profile opens on

#### Scenario: Before the report arrives
- **WHEN** the report has not yet resolved
- **THEN** the chat tab is withheld as any gated surface is, so a profile that recorded it opens on the search tab until the report says the tab is offered

