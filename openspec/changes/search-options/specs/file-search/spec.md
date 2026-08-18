# file-search Delta

## ADDED Requirements

### Requirement: Search options are sticky and shareable
The client SHALL offer two options governing a deep search: whether matching considers a model's containing folders and archives or only its own file name, and whether results present containers, models, or both. Folder matching SHALL default to on, and the kind option SHALL default to both.

Each option SHALL be persisted per browser profile, so a subsequent search in that profile uses the last settings the user chose, and each SHALL also be carried in the URL alongside the query, so a copied or bookmarked search reproduces the results its sender saw rather than the recipient's stored settings. Options carried in a URL SHALL govern searches made from it without being written to the recipient's stored settings; only the user operating a control SHALL change what is stored.

While a query is committed, changing an option SHALL take effect immediately rather than at the next search: an option that determines what the server returns SHALL re-issue the search, under the same latest-wins supersession, loading feedback, and history behavior as any other committed view change; an option that only selects among returned entries SHALL apply without a request. The truncation and empty-state reporting SHALL keep describing what the user is actually looking at under the options in force.

#### Scenario: Options persist across searches and sessions
- **WHEN** the user turns folder matching off, searches, navigates away, and later searches again in the same browser profile
- **THEN** the later search still has folder matching off, without the user setting it again

#### Scenario: A shared search reproduces the sender's results
- **WHEN** a user copies the URL of a search made with particular options and another profile opens it
- **THEN** that profile sees the same results the sender saw, under the sender's options rather than its own stored ones

#### Scenario: A shared link does not reconfigure the recipient
- **WHEN** a profile opens a search link carrying options different from its stored ones, then navigates away and starts a fresh search
- **THEN** the fresh search uses that profile's own stored options — the link governed only the view it named

#### Scenario: Changing an option acts on the results on screen
- **WHEN** the user changes an option while search results are displayed
- **THEN** the grid reflects the new option immediately — re-searching if the option changes what the server returns, and re-presenting the existing results if it only selects among them

#### Scenario: Narrowing to one kind
- **WHEN** a search matches both folders and models and the user restricts results to folders
- **THEN** only the matching folders are presented, and the empty-state and truncation wording describe that view rather than the unrestricted one

#### Scenario: File-name-only matching still finds parts
- **WHEN** the user turns folder matching off and searches a fragment that appears in folder names but not in any file name
- **THEN** no models are returned on the strength of their folders, and the empty state says nothing matched rather than implying the search was incomplete
