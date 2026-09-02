# chat-panel Delta

## ADDED Requirements

### Requirement: The chat tab is offered only where the deployment declares it
The chat tab SHALL be present only where the deployment declares it offered (see
`feature-report`), and SHALL be absent rather than disabled otherwise — the panel keeps
its remaining tabs and the space the chat tab held is not left behind. Because the chat
has no backend, the maintained configuration SHALL declare it off, so a placeholder is
not the first thing a new profile meets. Where the tab is withheld, the panel's recorded
selection SHALL resolve to a tab that exists: a profile that recorded the chat tab, and a
profile that recorded nothing at all, SHALL both open on the search tab rather than on a
tab that is not there. Recording SHALL be unchanged for a deployment that offers the tab,
so a profile carried between them is not rewritten by having visited one.

#### Scenario: Withheld where not declared
- **WHEN** the panel is opened on a deployment that does not offer the chat tab
- **THEN** the tab is absent, and the panel's other tabs are unchanged

#### Scenario: A profile that never chose a tab
- **WHEN** a profile with no recorded tab opens a panel whose chat tab is withheld
- **THEN** it opens on the search tab rather than on the missing chat tab

#### Scenario: A profile that recorded chat
- **WHEN** a profile that recorded the chat tab opens a panel whose chat tab is withheld
- **THEN** it opens on the search tab, and its recorded value is not rewritten

#### Scenario: Offered where declared
- **WHEN** a deployment declares the chat tab offered
- **THEN** the panel behaves exactly as it does today, including which tab a profile opens on
