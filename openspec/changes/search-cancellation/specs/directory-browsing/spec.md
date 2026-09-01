# directory-browsing Delta

> ADDED only, rederived 2026-09-01. No title overlap with the other active deltas on this
> capability: `library-overrides` ADDs *Entries display their stored name*,
> `pose-for-every-model` MODIFIEs *Folder tiles preview their contents*. That last
> requirement is what exempts the folder-tile peek from the rule below, and its exemption
> sentence survives that change's MODIFIED block, so the exemption holds whichever lands
> first.

## ADDED Requirements

### Requirement: Concurrent and abandoned listing work
Overlapping requests that require the same recursive traversal SHALL be served by a single traversal rather than one per request: a request arriving while an equivalent traversal is in flight SHALL await that traversal and derive its own response from it. Traversals SHALL be considered equivalent when they would examine the same tree under the same server-side options, irrespective of any query applied to the result, since filtering happens after the tree is gathered.

A traversal that no request is awaiting — every request that was joined to it having disconnected — SHALL be stopped rather than run to completion. A stopped traversal SHALL yield no listing at all: it SHALL NOT return a shortened one, and its partial results SHALL NOT be persisted, cached, or served to any request. A request arriving after a traversal was stopped SHALL begin a fresh traversal rather than inherit partial state.

Where a traversal's results are persisted or reused, the test SHALL be whether that traversal ran to completion — that it finished and was not cut short by its step budget — and SHALL NOT be the truncation reported on the wire, which a response shortened by an entry cap also carries although its traversal saw the whole tree. Stopping SHALL likewise be distinguishable from truncation reporting: a stopped traversal has no reader and SHALL NOT surface as a partial result to anyone.

Stopping SHALL be distinguishable from failure in the server's own records, so an abandoned traversal is not diagnosed as an error and an error is not dismissed as an abandonment.

A traversal that fails SHALL fail every request joined to it, as it would have failed each of them individually.

A bounded preview walk is not a recursive traversal for the purposes of this requirement and SHALL be unaffected by it, as the folder-preview requirement states.

#### Scenario: Rapid successive searches cost one traversal
- **WHEN** the user submits several searches against the same directory in quick succession
- **THEN** the server traverses that tree once and derives each response from it, rather than traversing once per search

#### Scenario: An abandoned search stops working
- **WHEN** a listing request's client disconnects and no other request is awaiting the same traversal
- **THEN** the traversal stops promptly instead of running to completion, freeing the disk for work that is still wanted

#### Scenario: A joined request keeps the work alive
- **WHEN** one of several requests sharing a traversal disconnects while others remain
- **THEN** the traversal continues and still serves the remaining requests, none of which is told the traversal was stopped

#### Scenario: A stopped traversal leaves nothing behind
- **WHEN** a traversal is stopped partway and the same directory is requested again afterwards
- **THEN** the new request performs a complete traversal and its results reflect the whole tree, never the abandoned traversal's partial view

#### Scenario: Stopping is not truncation
- **WHEN** a traversal is stopped because nobody is awaiting it
- **THEN** no response reports a truncated listing on account of that stop — truncation continues to mean that results were dropped from an answer someone actually received

#### Scenario: A capped answer from a complete traversal is still complete
- **WHEN** a traversal examines the whole tree and the response is then shortened by an entry cap
- **THEN** that traversal counts as having run to completion, and its results remain eligible to be reused, even though the response reports truncation

#### Scenario: A preview is not stopped
- **WHEN** a folder tile's bounded preview walk is abandoned because the tile has scrolled away
- **THEN** it runs to completion as its own requirement provides, unaffected by the rule that stops abandoned recursive traversals
