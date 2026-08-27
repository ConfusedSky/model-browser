## ADDED Requirements

### Requirement: The score floor is the default bound
A meaning search the user has not bounded for themselves SHALL be bounded by a minimum score rather than by a count. The floor SHALL be the level the index's own published measurement puts text-query scores at, rather than a round number chosen here, since a default floor is a statement about where the interesting part of that distribution starts and only the index has measured it. Where the user turns the floor on having been under a count, it SHALL start at that same default rather than at some other value, so that the control has one resting place instead of a default and an unrelated starting point.

The count SHALL therefore be the bound a view opts into, and any record of a view — a link, a stored profile — SHALL say which bound was in force. Where the count is in force it SHALL be named even where its own value is the default one. This is the existing rule that an option is carried when it is not its default, not an exception to it: where the result set stops is one option, its value is either a count or a floor, and the count is the value that is not the default — the number rides along as part of naming the choice. A record naming neither bound SHALL be read as the floor, which is why a count cannot be left implicit: the field it would fall back to is precisely the one the index ignores beneath a floor.

A record that predates this default SHALL NOT be read as a choice. A stored profile written before the floor became the default bound names no bound at all, and SHALL be resolved to the floor like any profile that set nothing, rather than to a count its owner was never asked about — so a chosen count SHALL be recorded in a form that a profile older than the question cannot be mistaken for.

This SHALL NOT introduce a second bound, a control, or a parameter: a count and a floor remain one choice and never both, and what changes is only which of them applies when nothing has been chosen.

#### Scenario: An unbounded meaning search stops at a score
- **WHEN** a user who has set no bound of their own commits a meaning search
- **THEN** the results are every model at or above the default floor rather than a fixed number of them, and a phrase that nothing matches well returns little rather than returning a full grid of weak matches

#### Scenario: A link written under a count comes back under a count
- **WHEN** a user bounds a meaning search by a count and shares the URL, including where that count is its own default value
- **THEN** the recipient sees the same result set under a count, rather than the default floor with the sender's count ignored

#### Scenario: A link that names no bound acquires none
- **WHEN** a link names a meaning option that is not the bound — how the phrase is read, or how its views are pooled — and the app rewrites that URL in place, as it does when a lightbox closes over it
- **THEN** the rewritten link still names no bound and the search stays under the floor, rather than acquiring a count nobody chose and carrying it onward to whoever the link is shared with

#### Scenario: A profile written before the default moved is not read as a choice
- **WHEN** a profile stored before the floor became the default bound is read back
- **THEN** its searches are bounded by the floor, like any profile that set nothing, rather than by a count its owner was never asked about

#### Scenario: A profile that chose the count keeps it
- **WHEN** a user who has previously turned the floor off returns to the app
- **THEN** their search is still bounded by their count rather than reverting to the floor, and turning the floor back on starts it at the default

#### Scenario: The floor's default reaches the index's own ceiling
- **WHEN** a default-bounded search matches more models than the index will return
- **THEN** the client says the index returned fewer than was asked for, as it does for any bound the index's ceiling stops short, rather than presenting the set as complete
