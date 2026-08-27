## ADDED Requirements

### Requirement: The score floor is the default bound
A meaning search the user has not bounded for themselves SHALL be bounded by a minimum score rather than by a count. The floor SHALL be the level the index's own published measurement puts text-query scores at, rather than a round number chosen here, since a default floor is a statement about where the interesting part of that distribution starts and only the index has measured it. Where the user turns the floor on having been under a count, it SHALL start at that same default rather than at some other value, so that the control has one resting place instead of a default and an unrelated starting point.

The count SHALL therefore be the bound a view opts into, and every surface that records a view SHALL be able to say which bound was in force. A shared link SHALL reproduce the sender's bound whichever one it was — so a link written under a count names it, including where that count is its own default value, since a link naming neither bound would be read back as the floor and the count it exists to carry is precisely the field the index ignores under one. A stored profile SHALL read an absent floor as the count being in force rather than as a field nobody has set, since a profile records a complete set of choices where a link records only a difference from the defaults.

This SHALL NOT introduce a second bound, a control, or a parameter: a count and a floor remain one choice and never both, and what changes is only which of them applies when nothing has been chosen.

#### Scenario: An unbounded meaning search stops at a score
- **WHEN** a user who has set no bound of their own commits a meaning search
- **THEN** the results are every model at or above the default floor rather than a fixed number of them, and a phrase that nothing matches well returns little rather than returning a full grid of weak matches

#### Scenario: A link written under a count comes back under a count
- **WHEN** a user bounds a meaning search by a count and shares the URL, including where that count is its own default value
- **THEN** the recipient sees the same result set under a count, rather than the default floor with the sender's count ignored

#### Scenario: A profile that chose the count keeps it
- **WHEN** a user who has previously turned the floor off returns to the app
- **THEN** their search is still bounded by their count rather than reverting to the floor, and turning the floor back on starts it at the default

#### Scenario: The floor's default reaches the index's own ceiling
- **WHEN** a default-bounded search matches more models than the index will return
- **THEN** the client says the index returned fewer than was asked for, as it does for any bound the index's ceiling stops short, rather than presenting the set as complete
