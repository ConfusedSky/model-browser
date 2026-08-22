# url-navigation Delta

> Written against the text `search-options` leaves behind — that change is a hard
> prerequisite (tasks.md §5), and it is the only other active change holding this
> requirement.

## MODIFIED Requirements

### Requirement: The URL names the committed view
The client SHALL reflect the committed view in the page URL as query parameters on its single route: the current directory or zip path, whether the flat view is active, the committed search query, the options under which that query was run — including which search mode produced it — and the open lightbox's model path. The mode SHALL be carried whenever it is not the default, since the same query text under a different mode names a different view over a different corpus. The URL SHALL describe only views that actually rendered — in-flight navigation targets, failed requests, and superseded responses SHALL NOT reach it. Ephemeral and preference state (the live filter text, the orbit overlay, lighting mode, the ambient-occlusion preference) SHALL stay out of the URL. A stored preference SHALL nonetheless appear in the URL when it determines *which* entries a view contains rather than how they are drawn: search options qualify and are carried, because a shared search that omitted them would reproduce different results for the recipient than the sender saw, whereas the lighting mode and the ambient-occlusion preference change only a model's appearance and stay out. Options carried this way SHALL govern the view named by the URL without overwriting the viewer's own stored preferences.

#### Scenario: The URL tracks navigation
- **WHEN** the user navigates to a directory, toggles flat, or commits a search, and the listing renders
- **THEN** the URL updates to name that exact view, and copying it reproduces the view in another tab

#### Scenario: The same text under two modes is two views
- **WHEN** the user commits the same text once in each search mode
- **THEN** the two views produce different URLs, each reproducing the search that was actually run

#### Scenario: A preference that selects content travels with the view
- **WHEN** a search is committed under options that differ from another profile's stored options, and its URL is opened there
- **THEN** the results match the sender's, while that profile's own stored options are left unchanged and govern its next fresh search

#### Scenario: Appearance preferences still stay out
- **WHEN** the user changes the lighting mode or the ambient-occlusion preference
- **THEN** the URL is unchanged, because neither alters which entries the view contains

#### Scenario: Optimistic and failed navigation leave no trace
- **WHEN** a navigation is still in flight, or fails, or is superseded by a newer request
- **THEN** the URL continues to name the view actually on screen
