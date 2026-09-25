## MODIFIED Requirements

### Requirement: Collapsible chat side panel
The UI SHALL offer a side panel hosting **tabs**: a search tab holding the search options and a read-back of the committed search, the tabs other capabilities place there, and — where the deployment declares the chat tab offered (see `feature-report`) — the placeholder chat interface (message list area and input box). The panel SHALL be opened and closed from an *Options* control in the toolbar above the grid, and SHALL be closed for a profile that has not opened it: the grid is what a visitor came for, and the options are a power feature asked for on demand. The *Options* control SHALL carry a mark whenever any search option — name matching, the kind restriction, meaning tuning, or a similarity view's pooling — is off its default, so a closed panel still answers why results look unusual; the panel's own search tab SHALL carry the same mark whenever one of the options it holds — every one of those but the similarity view's pooling, which lives on a tab of its own — is off its default. On a wide screen the panel SHALL dock beside the grid, which makes room for it; on a narrower one it SHALL float over the grid — as a sheet from the bottom edge on a phone — and a press outside it SHALL put it away. Opening the panel SHALL move focus to its selected tab; Escape within it, or its own close control, SHALL close it and return focus to the *Options* control; the arrow keys SHALL move between its tabs. The panel SHALL carry a *Display* section holding the preferences that change how results are drawn rather than which exist — whether match scores are shown (see `semantic-search`), and, on a phone-width layout whose toolbar has no room for it, the occlusion switch.

Because the chat has no backend, the maintained configuration SHALL NOT declare it, so a placeholder is not the first thing a new profile meets; the tab remains declarable, and a deployment that offers it gets exactly the panel described here. Where the tab is not offered it SHALL be absent rather than disabled, leaving no gap where it stood. The panel SHALL have no backend behavior of its own; submitted chat input MAY be ignored or echoed locally, and the search tab SHALL issue no requests that operating its controls does not already cause. Whether the panel is open SHALL persist in localStorage, as SHALL which tab is selected; neither belongs in the URL, since neither changes which entries a view contains. The recorded selection SHALL resolve to a tab that exists: where the chat tab is not offered, a profile that recorded it and a profile that recorded nothing SHALL both open on the search tab, and the recorded value SHALL NOT be rewritten, so a profile carried between deployments is not edited by having visited one. The search tab SHALL mirror the committed search rather than own it: the search input, its mode control and the results label SHALL remain with the grid they describe, so that a closed panel never prevents searching or hides what the grid is.

#### Scenario: Collapsing and expanding
- **WHEN** the user presses the toolbar's Options control, and presses it again
- **THEN** the panel opens — beside the grid on a wide screen, over it on a narrower one — with focus on its selected tab, and the second press closes it and the grid has its full width again

#### Scenario: Collapse state persists
- **WHEN** the user opens the panel and reloads the app, or closes it and reloads
- **THEN** the panel is as the user left it

#### Scenario: A fresh profile starts closed
- **WHEN** a profile that has never opened the panel loads the app
- **THEN** the panel is closed and the grid takes the width

#### Scenario: Escape puts it away
- **WHEN** the panel is open and the user presses Escape inside it
- **THEN** the panel closes and focus is on the Options control

#### Scenario: The mark answers while closed
- **WHEN** the panel is closed and a search option is off its default
- **THEN** the Options control carries its mark, and it is gone once every option is back at its default

#### Scenario: The selected tab persists
- **WHEN** the user selects the search tab and reloads the app
- **THEN** the search tab is still selected

#### Scenario: No backend calls
- **WHEN** the chat tab is offered and the user types into the chat input and submits
- **THEN** no network request is made to any chat/AI endpoint

#### Scenario: A collapsed panel does not block searching
- **WHEN** the panel is closed
- **THEN** the user can still type a query, choose its mode, submit it, and read its results label, because those live with the grid

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
- **THEN** the chat tab is present beside the others, and a profile that recorded it opens on it

#### Scenario: Before the report arrives
- **WHEN** the report has not yet resolved
- **THEN** the chat tab is withheld as any gated surface is, so a profile that recorded it opens on the search tab until the report says the tab is offered
