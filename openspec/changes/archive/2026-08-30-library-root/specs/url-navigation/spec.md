## MODIFIED Requirements

### Requirement: The URL names the committed view
The client SHALL reflect the committed view in the page URL as query parameters on its single route: the current directory or zip path, whether the flat view is active, what the view is *about* — a committed search query or the model a similarity view was derived from — the options under which a committed query was run, including which search mode produced it, and the open lightbox's model path. Every path the URL carries SHALL be library-relative (see `library`); the library's top is the default view and SHALL be named by omitting the path parameter. The mode SHALL be carried whenever a query is committed, since the same query text under a different mode names a different view over a different corpus. An option SHALL appear only when the view's subject actually reads it: a plain listing names no search options, a name search names no meaning tuning, a meaning search names no kind restriction, and a similarity view — whose subject is a model rather than a phrase — names none of the options a phrase is read under, since none of them selects anything within it. What such a view SHALL name beyond the model is what its own subject reads: the parameters the neighbours were computed under, each carried only when it is not the default, so a view that adjusted nothing is named exactly as it was before they could be adjusted. The URL SHALL describe only views that actually rendered — in-flight navigation targets, failed requests, and superseded responses SHALL NOT reach it. Ephemeral and preference state (the live filter text, the orbit overlay, lighting mode, the ambient-occlusion preference) SHALL stay out of the URL. A stored preference SHALL nonetheless appear in the URL when it determines *which* entries a view contains rather than how they are drawn: search options qualify and are carried, because a shared search that omitted them would reproduce different results for the recipient than the sender saw, whereas the lighting mode and the ambient-occlusion preference change only a model's appearance and stay out. Options carried this way SHALL govern the view named by the URL without overwriting the viewer's own stored preferences.

#### Scenario: The URL tracks navigation
- **WHEN** the user navigates to a directory, toggles flat, or commits a search, and the listing renders
- **THEN** the URL updates to name that exact view, and copying it reproduces the view in another tab

#### Scenario: The library's top has the shortest URL
- **WHEN** the view is at the library's top with nothing else committed
- **THEN** the URL carries no path parameter, and a URL without one names the library's top

#### Scenario: A similarity view names the model it came from
- **WHEN** the user asks for models similar to one on screen and the results render
- **THEN** the URL names that model as the view's subject, and opening it elsewhere reproduces the same neighbours

#### Scenario: A similarity URL carries nothing it does not read
- **WHEN** a similarity view is committed while the search options hold non-default values, and its own neighbour parameters are left alone
- **THEN** its URL names the source model, the location, and the flat toggle and nothing else — no query, no mode, no kind restriction, no tuning — because none of them select anything within it, and its own parameters are at their defaults, which the URL states by omitting them

#### Scenario: A similarity URL carries the parameters it does read
- **WHEN** the user changes how many neighbours a similarity view shows, or how the index scores a model's views, and the results render
- **THEN** the URL names that parameter beside the source model, opening it elsewhere reproduces the same neighbours, and the view before the change and the view after it are two different URLs, so going back reaches the neighbours that were shown

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

### Requirement: Deep links restore the view
Loading a URL that carries navigation parameters SHALL restore that view: the named directory (nested, flat, or as search results per the parameters), and the named lightbox model once it is present in the loaded listing. Because every path is library-relative, a link SHALL restore the same view on any machine and mount point holding the same library. A model parameter naming an entry absent from its listing SHALL be dropped silently from the URL rather than surfacing an error. A URL without navigation parameters SHALL open the library's top, and the resolved view SHALL then be recorded into the URL without creating a history entry. A link carrying a path from before paths were library-relative SHALL fail as an ordinary invalid path.

#### Scenario: A shared search link
- **WHEN** a URL naming a directory, flat mode, and a committed query is opened fresh
- **THEN** the app boots directly into those search results, label and all, without passing through any other view

#### Scenario: A link works on another machine
- **WHEN** a URL naming a directory and a lightbox model is opened on a machine that holds the same library at a different filesystem location
- **THEN** the same directory and model are shown

#### Scenario: A stale model link degrades gracefully
- **WHEN** a URL names a lightbox model that no longer exists in the directory it points into
- **THEN** the directory view renders normally and the dangling model parameter disappears from the URL

#### Scenario: A pre-library link fails plainly
- **WHEN** a URL carries a path that is a filesystem location rather than a library path
- **THEN** the app shows the ordinary invalid-path error and the library's top
