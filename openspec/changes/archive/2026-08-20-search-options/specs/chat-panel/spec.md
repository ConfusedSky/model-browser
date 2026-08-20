# chat-panel Delta

## MODIFIED Requirements

### Requirement: Collapsible chat side panel
The UI SHALL show a collapsible panel on the right edge hosting **tabs**: the placeholder chat interface (message list area and input box), and a search tab holding the search options and a read-back of the committed search. The panel SHALL have no backend behavior of its own in this change; submitted chat input MAY be ignored or echoed locally, and the search tab SHALL issue no requests that operating its controls does not already cause. Collapse state SHALL persist in localStorage, as SHALL which tab is selected; neither belongs in the URL, since neither changes which entries a view contains. The search tab SHALL mirror the committed search rather than own it: the search input and the results label SHALL remain with the grid they describe, so that a collapsed panel never prevents searching or hides what the grid is.

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
- **WHEN** the user types into the chat input and submits
- **THEN** no network request is made to any chat/AI endpoint

#### Scenario: A collapsed panel does not block searching
- **WHEN** the panel is collapsed
- **THEN** the user can still type a query, submit it, and read its results label, because those live with the grid
