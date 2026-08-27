## MODIFIED Requirements

### Requirement: Meaning search is a mode of the search input
The client SHALL offer meaning search as a mode the search input runs in, selected by an option carried with the other search options, so that submitting from the input runs whichever search is in force. The option SHALL be sticky per browser profile and carried in the URL under the same rules as the other options that determine which results exist, and changing it while a query is committed SHALL re-run that query in the newly selected mode without the user retyping it. Which mode is in force SHALL be visible without opening the panel, since it is what explains the grid.

The client SHALL also offer the parameters that shape a meaning query: whether the phrase is read as written or expanded into the index's templates, how a model's views are reduced to a single score, and which bounds stop the result set — a minimum score, a number of results, or both together, where the floor applies first and the count caps what survives it. Each SHALL be sticky per profile and carried in the URL under the presence rule the bounds requirement records. A count in force SHALL be presented as showing the strongest matches rather than as truncation: a relevance ranking has no horizon it can run out at, and capping a floor-bounded set is a choice about grid size, not a horizon being reached. Where a count caps a floor-bounded set, the client SHALL say how many models cleared the floor, so a capped view states its own size against the set it was drawn from rather than presenting the cap as the whole answer. That figure SHALL be the index's own count of what passed the floor before the count applied, since the client receives only what survived the count and can neither observe nor estimate it; where the index does not report it, the client SHALL say nothing about it rather than guess. The count SHALL be clamped so that no user-chosen count exceeds the ceiling the index itself returns at — a count that asks for what the index would truncate anyway is not a setting this app presents. Options that do not apply to the mode in force SHALL be hidden rather than shown inert — but the controls that explain the current view SHALL NOT be hidden with them. Where meaning mode is in force and the index cannot answer it, the client SHALL still show which mode is in force, a way to leave it, why it cannot run, and the options that govern the search a submit would actually perform. A mode a user can neither see nor leave is a trap, and a link can put this app in one on a machine that has no index.

Meaning results SHALL replace the grid and SHALL render as an ordinary listing — thumbnails, orbit, lightbox, and camera persistence behave identically, and the in-flight skeleton and latest-wins supersession apply. Results SHALL be presented in the order the index returned them, which is by relevance and is never re-sorted by name. Navigating, toggling flat, or committing another search SHALL supersede them, and clearing the query SHALL restore the ordinary listing for the current path.

The UI SHALL make clear that the grid holds meaning matches for the committed phrase and that they came from the index rather than from the directory listing. Where the index reports that its own ceiling stopped it returning what was asked for, the client SHALL say so, since that bound was not the user's choice and their control is what met it.

#### Scenario: A phrase finds models whose names do not contain it
- **WHEN** the user commits a search in meaning mode for a phrase describing a subject
- **THEN** models matching that description are shown, ranked by relevance, including models whose file names and folders contain none of the words

#### Scenario: A parameter changes the result set
- **WHEN** the user changes how the phrase is read, or how views are pooled, and the query is re-run
- **THEN** the results reflect that setting, and the setting is what a later search in this profile uses

#### Scenario: A count and a floor are one choice
- **WHEN** the user sets both a minimum score and a count
- **THEN** the result set is the strongest models at or above the floor, capped at the count — the two composing rather than one replacing the other, and neither presented as having silently disabled its partner

<!-- The title is deliberately the one this scenario retired under, not a new one
     describing its new body. A MODIFIED block replaces a requirement's prose AND
     its scenarios, and archive refuses to drop a scenario the block does not
     carry, so renaming reads as a deletion and aborts. RENAMED/REMOVED exist for
     requirements, never for scenarios (project CLAUDE.md).

     Tested rather than assumed (2026-08-27, temp-copy dry runs). Retitling this
     scenario inside the MODIFIED block aborts with `semantic-search MODIFIED
     failed for header "### Requirement: Meaning search is a mode of the search
     input" - current spec contains scenario(s) not present in the modified
     block: "A count and a floor are one choice"`, and no files are written.

     There IS an escape hatch, and this comment used to imply there was none: a
     REMOVED requirement takes its scenario titles with it, so REMOVE + ADD at
     the *requirement* level frees every title underneath — which is exactly what
     this delta does to "The score floor is the default bound". It was tested
     here too, and it does not work for this requirement: archive rejects
     `Requirement present in both ADDED and REMOVED: "Meaning search is a mode of
     the search input"`, so the hatch is only open if the re-added requirement
     takes a *different* name.

     Renaming is therefore possible and is declined, for a stated reason rather
     than an imagined constraint. The reason is proportionality, NOT that
     archived documents cite the title — four do (`2026-08-22-semantic-search`,
     `-semantic-search-tuning` in both its proposal and its delta, and
     `-search-view-reducer`'s proposal), but breaking such a citation is not
     disqualifying and this very delta does it deliberately: it REMOVEs "The
     score floor is the default bound", which `2026-08-27-score-floor-by-default`
     names. What makes that acceptable is the REMOVED stanza's Reason and
     Migration lines, which are the forwarding address the format exists to
     provide; RENAMED offers the same for a rename. So the cost was never
     unrecoverable, and a rule of "never break an archived citation" would be
     wrong in both directions — it would block the removal above, which this
     change exists to make.

     The discriminator is what the change buys. Removing the floor requirement is
     load-bearing: its core claim is false, and correcting it is the point of
     this change, so it earns a dangling citation plus a migration note.
     Retitling a scenario is cosmetic — it retires a heading — and cosmetic
     changes do not earn that cost when a comment can tell the next reader
     everything the heading fails to. This comment is that forwarding address.

     What it costs, plainly: a scenario heading in the main spec that contradicts
     its own body, which any sweep for the replace rule will keep finding. The
     body is what the requirement asserts, and it composes. -->

#### Scenario: The index's ceiling is reported, the ranking's horizon is not
- **WHEN** a result set is bounded by the user's count, and again when the index's own cap stopped it short
- **THEN** the first is described as the strongest matches and the second says the index returned fewer than was asked for

#### Scenario: A capped view says what it was drawn from
- **WHEN** a meaning search is bounded by both a floor and a count, and more models clear the floor than the count admits
- **THEN** the view says how many cleared the floor alongside the results it shows, rather than presenting the capped set as everything above the floor

#### Scenario: A count past the ceiling is not offered
- **WHEN** the user enters a count greater than the index's own return cap
- **THEN** the field holds the clamped value rather than the typed one, since a count above the ceiling names a result set the index cannot answer

#### Scenario: A tuned result set reproduces from its URL
- **WHEN** a user shares the URL of a meaning search run under non-default parameters
- **THEN** the recipient sees the same result set, under the sender's parameters rather than their own

#### Scenario: Flipping the mode re-runs the same text
- **WHEN** a name search returns nothing and the user switches to meaning mode
- **THEN** the same text is run against the index without being retyped, and the results replace the grid

#### Scenario: Meaning results are an ordinary grid
- **WHEN** meaning results are on screen
- **THEN** tiles render thumbnails, orbit, and the lightbox as in any listing

#### Scenario: Relevance order survives
- **WHEN** the index returns hits ordered by score
- **THEN** the grid presents them in that order rather than in name order

#### Scenario: The mode is visible from the grid
- **WHEN** meaning results are on screen and the side panel is collapsed
- **THEN** the user can still tell that the grid holds meaning matches rather than a name search's results

#### Scenario: Name search still answers the input's submit
- **WHEN** the user submits while name mode is in force
- **THEN** a recursive name search runs as before, unaffected by the presence of the index

#### Scenario: An unrunnable mode still explains itself
- **WHEN** meaning mode is in force on a machine where the index is not running
- **THEN** the search controls show that mode, why it cannot run, a way back to name search, and the options governing the search a submit would perform — rather than hiding everything that does not apply to a mode that cannot run

#### Scenario: Inapplicable options are absent
- **WHEN** meaning mode is in force
- **THEN** options that only govern name matching are not shown, rather than shown with no effect

#### Scenario: Leaving the results restores browsing
- **WHEN** meaning results are shown and the user clears the query or navigates
- **THEN** the ordinary listing for the current path is requested and rendered

## REMOVED Requirements

### Requirement: The score floor is the default bound
**Reason**: Its core claim — a count and a floor are one choice and never both — is false as
of the index composing the two, and its record rule (absence reads as the floor; the count
is named even at its default) is a special case of the presence rule that replaces it.

**Migration**: Replaced by "Which bounds are in force is recorded by presence", below,
which carries over the floor's default level, the profile-migration protections, and the
wall-notice behaviour, and adds the composed default and the clamp.

## ADDED Requirements

### Requirement: Which bounds are in force is recorded by presence
A meaning search SHALL be bounded by a minimum score, a count, or both together, the floor applying first and the count capping what survives it. Both SHALL be in force when the user has chosen neither: the floor at the level the index's own published measurement puts text-query scores at, the count at the default the grid has always been sized for — the resting state of the controls and the meaning of an unadorned link being one and the same. Each bound SHALL be settable independently, and turning one off SHALL NOT change the other's value.

Every record of a view — a link, a stored profile — SHALL name each bound that is in force and omit each bound that is not, including where a named bound's value is its own default: a bound's absence in a record SHALL mean the bound is not in force, never that it sits at its default, so one rule governs the URL, the stored profile, and the live state alike. A record naming neither bound SHALL be read as both bounds at their defaults.

A stored profile SHALL be read under the presence rule regardless of what its writer meant: a profile whose floor is recorded as absent names a count-only choice whether it was written as one or inherited from before the floor existed, and a profile carrying both bounds reads as both — the reading of last resort where old bytes cannot say which of the two their owner saw, being the state the defaults now name.

Where the index's own ceiling stops a bounded set short, the client SHALL say so, as it does for any bound the index's ceiling stops short.

#### Scenario: An unadorned meaning search is floored and capped
- **WHEN** a user who has set no bound of their own commits a meaning search
- **THEN** the results are the strongest models at or above the default floor, capped at the default count, rather than an unbounded floor set or a count carrying weak matches

#### Scenario: One bound can be sent away without the other
- **WHEN** the user switches from both bounds to the floor alone
- **THEN** the result set grows to everything above the floor and the count field's value is remembered rather than discarded, so returning to both restores the count that was set

#### Scenario: A record carries each bound it is under
- **WHEN** a meaning search is bounded by the floor alone, the count alone, or both, and its URL is shared or its parameters are stored
- **THEN** the record names exactly the bounds in force — a floor-only view's link names no count, and a count-only view's link names no floor — and the recipient's or the returning user's view is bounded as the sender's was

#### Scenario: A link that names no bound reads as the defaults
- **WHEN** a link names a meaning option that is not a bound — how the phrase is read, or how its views are pooled — and the app rewrites that URL in place, as it does when a lightbox closes over it
- **THEN** the rewritten link still names no bound, and the search it names stays bounded by both at their defaults rather than acquiring a bound nobody chose

#### Scenario: A profile written before the bounds composed is not promoted to a choice
- **WHEN** a profile stored under the one-bound encoding is read back
- **THEN** its recorded bounds are read by presence — an absent floor meaning no floor, a chosen count staying a count — rather than being reinterpreted by rules about what the profile's writer probably meant

#### Scenario: The floor's default reaches the index's own ceiling
- **WHEN** a floor-only search matches more models than the index will return
- **THEN** the client says the index returned fewer than was asked for, rather than presenting the set as complete
