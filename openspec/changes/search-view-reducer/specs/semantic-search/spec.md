# semantic-search Delta

## ADDED Requirements

### Requirement: A deferred meaning search belongs to its view

A meaning query held for a warming or absent index SHALL remain bound to the view that deferred it: it SHALL run when the index becomes ready only if that view is still the one on screen, and it SHALL be cancelled — silently and completely, banner and URL included — when the user moves on by navigating, emptying the search input, or searching by name. Flipping the search mode to meaning while the index is not ready SHALL defer the committed query exactly as submitting it would, never substitute a name search for it. While a deferral waits, the stand-in listing shown in its place SHALL be the ordinary nested listing for the current path, whatever flat shape the deferred search's URL names.

#### Scenario: Navigation cancels the deferral

- **WHEN** a meaning query is deferred and the user navigates to another folder
- **THEN** the deferral is cancelled — when the index later becomes ready, no query fires, no view is replaced, and no URL is rewritten

#### Scenario: Emptying the input cancels the deferral

- **WHEN** a meaning query is deferred and the user clears the search input
- **THEN** the deferred-search banner disappears, the URL stops naming the search, and the index becoming ready runs nothing

#### Scenario: A name search cancels the deferral

- **WHEN** a meaning query is deferred and the user submits a name search
- **THEN** the name results stand and the index becoming ready does not replace them

#### Scenario: The deferral fires only for the view that made it

- **WHEN** the index becomes ready while the view that deferred a meaning query is still on screen
- **THEN** the query runs for that view's path and options — and only then

#### Scenario: Mode flip while unready defers like submit

- **WHEN** a query is committed and the user flips the mode to meaning while the index is not ready
- **THEN** the query is deferred under the meaning mode — the URL names a meaning search and the banner explains the wait — rather than a name search running in its place

#### Scenario: Nothing is fetched while the index is being asked

- **WHEN** a meaning URL is opened and the index has not yet answered the availability probe
- **THEN** no listing is requested in the meantime and the view reads as loading — the probe's answer decides whether the query runs or defers behind a stand-in

#### Scenario: The stand-in listing is nested

- **WHEN** a deferred meaning view is restored from history or a link and a stand-in listing is fetched while the index warms
- **THEN** the stand-in is the nested listing for the path, not a flat walk of it — the URL's flat shape belongs to the search being deferred, not to the placeholder
