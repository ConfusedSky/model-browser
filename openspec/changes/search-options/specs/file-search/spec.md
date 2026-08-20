# file-search Delta

## ADDED Requirements

### Requirement: Search options are sticky and shareable
The client SHALL offer two options governing a deep search: whether matching considers a model's containing folders and archives or only its own file name, and whether results present containers, models, or both. Folder matching SHALL default to on, and the kind option SHALL default to both.

Each option SHALL be persisted per browser profile, so a subsequent search in that profile uses the last settings the user chose, and each SHALL also be carried in the URL alongside the query, so a copied or bookmarked search reproduces the results its sender saw rather than the recipient's stored settings. Options carried in a URL SHALL govern searches made from it without being written to the recipient's stored settings; only the user operating a control SHALL change what is stored. Where a URL names a committed search, an option it does not carry SHALL be taken as that option's default rather than as the viewer's stored preference — otherwise a link written under default options would reproduce the recipient's settings instead of the sender's view. Restoring such a view from history SHALL restore the options it ran under, and two views differing only by their options SHALL be treated as different views.

While a query is committed, changing an option SHALL take effect immediately rather than at the next search: an option that determines what the server returns SHALL re-issue the search, under the same latest-wins supersession, loading feedback, and history behavior as any other committed view change; an option that only selects among returned entries SHALL apply without a request. The truncation and empty-state reporting SHALL keep describing what the user is actually looking at under the options in force.

#### Scenario: Options persist across searches and sessions
- **WHEN** the user turns folder matching off, searches, navigates away, and later searches again in the same browser profile
- **THEN** the later search still has folder matching off, without the user setting it again

#### Scenario: A shared search reproduces the sender's results
- **WHEN** a user copies the URL of a search made with particular options and another profile opens it
- **THEN** that profile sees the same results the sender saw, under the sender's options rather than its own stored ones

#### Scenario: A link written under default options still reproduces
- **WHEN** a user whose options are the defaults shares a search URL, and a recipient whose stored options differ opens it
- **THEN** the recipient sees the sender's results, because the options the URL omits are the defaults rather than the recipient's settings

#### Scenario: History restores the options a view ran under
- **WHEN** the user changes an option with a query committed and then goes back
- **THEN** the earlier results return under the options they ran under, rather than the URL changing while the grid stays as it is

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
