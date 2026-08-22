# url-navigation Delta

> Rebased against main at `baa7010`. The requirement below is main's current text — which
> gained *The same text under two modes is two views* when `semantic-search` archived, and
> whose remaining scenarios `search-options` established — with this change's own additions
> on top. A MODIFIED requirement replaces prose *and* scenarios at archive, so every scenario
> main carries is carried here.
>
> No other active change modifies this requirement (`search-view-reducer`, which added
> *Every history write names the whole view* as a separate requirement, is archived). That
> sibling requirement is untouched and satisfied by construction: a similarity URL is
> produced by serializing the whole view through the one writer, never assembled by the menu
> that asked for it.
>
> One sentence is corrected rather than carried: main says the mode is carried "whenever it
> is not the default", while the shipped serializer writes it whenever a query is committed,
> default included, on purpose (`urlState.ts:120-125` — leaving it implicit makes the link
> depend on the reader's default). The rebase could not leave it: the generalized
> subject-reads-the-option sentence added beside it would have contradicted it. Flagged here
> rather than slipped in.

## MODIFIED Requirements

### Requirement: The URL names the committed view
The client SHALL reflect the committed view in the page URL as query parameters on its single route: the current directory or zip path, whether the flat view is active, what the view is *about* — a committed search query or the model a similarity view was derived from — the options under which a committed query was run, including which search mode produced it, and the open lightbox's model path. The mode SHALL be carried whenever a query is committed, since the same query text under a different mode names a different view over a different corpus. An option SHALL appear only when the view's subject actually reads it: a plain listing names no search options, a name search names no meaning tuning, a meaning search names no kind restriction, and a similarity view — whose subject is a model rather than a phrase — names none of them, since the model it came from is the whole of what the view contains. The URL SHALL describe only views that actually rendered — in-flight navigation targets, failed requests, and superseded responses SHALL NOT reach it. Ephemeral and preference state (the live filter text, the orbit overlay, lighting mode, the ambient-occlusion preference) SHALL stay out of the URL. A stored preference SHALL nonetheless appear in the URL when it determines *which* entries a view contains rather than how they are drawn: search options qualify and are carried, because a shared search that omitted them would reproduce different results for the recipient than the sender saw, whereas the lighting mode and the ambient-occlusion preference change only a model's appearance and stay out. Options carried this way SHALL govern the view named by the URL without overwriting the viewer's own stored preferences.

#### Scenario: The URL tracks navigation
- **WHEN** the user navigates to a directory, toggles flat, or commits a search, and the listing renders
- **THEN** the URL updates to name that exact view, and copying it reproduces the view in another tab

#### Scenario: A similarity view names the model it came from
- **WHEN** the user asks for models similar to one on screen and the results render
- **THEN** the URL names that model as the view's subject, and opening it elsewhere reproduces the same neighbours

#### Scenario: A similarity URL carries nothing it does not read
- **WHEN** a similarity view is committed while the search options hold non-default values
- **THEN** its URL names the source model, the location, and the flat toggle and nothing else — no query, no mode, no kind restriction, no tuning — because none of them select anything within it

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
