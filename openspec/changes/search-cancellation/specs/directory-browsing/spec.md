# directory-browsing Delta

## ADDED Requirements

### Requirement: Concurrent and abandoned listing work
Overlapping requests that require the same recursive traversal SHALL be served by a single traversal rather than one per request: a request arriving while an equivalent traversal is in flight SHALL await that traversal and derive its own response from it. Traversals SHALL be considered equivalent when they would examine the same tree under the same server-side options, irrespective of any query applied to the result, since filtering happens after the tree is gathered.

A traversal that no request is awaiting — every request that was joined to it having disconnected — SHALL be stopped rather than run to completion. Stopping SHALL be distinguishable from the existing truncation reporting: a stopped traversal has no reader and SHALL NOT surface as a partial result to anyone.

Results from a traversal that did not run to completion SHALL NOT be persisted, cached, or served to any request. A request arriving after a traversal was stopped SHALL begin a fresh traversal rather than inherit partial state.

A traversal that fails SHALL fail every request joined to it, as it would have failed each of them individually.

#### Scenario: Rapid successive searches cost one traversal
- **WHEN** the user submits several searches against the same directory in quick succession
- **THEN** the server traverses that tree once and derives each response from it, rather than traversing once per search

#### Scenario: An abandoned search stops working
- **WHEN** a listing request's client disconnects and no other request is awaiting the same traversal
- **THEN** the traversal stops promptly instead of running to completion, freeing the disk for work that is still wanted

#### Scenario: A joined request keeps the work alive
- **WHEN** one of several requests sharing a traversal disconnects while others remain
- **THEN** the traversal continues and still serves the remaining requests

#### Scenario: A stopped traversal leaves nothing behind
- **WHEN** a traversal is stopped partway and the same directory is requested again afterwards
- **THEN** the new request performs a complete traversal and its results reflect the whole tree, never the abandoned traversal's partial view

#### Scenario: Stopping is not truncation
- **WHEN** a traversal is stopped because nobody is awaiting it
- **THEN** no response reports a truncated listing on account of that stop — truncation continues to mean that results were dropped from an answer someone actually received
