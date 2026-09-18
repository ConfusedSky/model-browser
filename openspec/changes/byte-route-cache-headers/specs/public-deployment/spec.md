## ADDED Requirements

### Requirement: Model byte responses are cacheable by the version they name
The routes that deliver a model's bytes — the source file and the derived mesh — SHALL
accept an optional parameter naming the version of the source the request believes it is
asking for, and SHALL declare the cacheability of every answer they give, so that a cache
between the server and the reader can be told to respect the origin rather than guess a
lifetime. The version SHALL be the source's modification time in milliseconds exactly as
the listing reports it for that entry, so that no new server state and no new listing
field is required; for an entry inside an archive it SHALL be the archive's modification
time, which is what the listing already reports and what the derived mesh already judges
staleness by (see `model-viewer`, *STL viewer meshes served as cached GLB*) — one rule for
both routes and both kinds of entry. The version SHALL be compared as a number rather
than as text, so that any spelling of the same value is the same version, and SHALL be
read before the bytes it describes, so that a version can never name a source newer than
the bytes sent with it.

A response that carries the bytes SHALL be declared in one of three ways. When the request
names the version the source currently has, the answer SHALL be publicly cacheable for a
long lifetime and immutable, because a source that changes moves every subsequent request
for it to a different version and therefore a different URL, and SHALL carry the same
strong validator a version-less answer for that source would carry, so that a reader
resuming a partial download of a pinned answer has something to make its resumption
conditional on. When the request names any
other version, the answer SHALL carry the source's current bytes and SHALL be declared
uncacheable without revalidation, and SHALL carry no validator, so that the reader
re-keys from a fresh listing rather than settling on a URL it should stop using. When the
request names no version at all, the answer SHALL be declared uncacheable without
revalidation and SHALL carry a strong validator derived from the source's version, and a
request offering that validator back SHALL be answered as not-modified with no body.

A validator a request offers back SHALL be evaluated against the source's current version
whenever that version is known, whichever of the three ways the answer would otherwise
have been declared and whichever of the two routes was asked, so that the same request
cannot be answered not-modified by one route and with a full body by the other.

The parameter SHALL remain optional, and an unconditional request that omits it — one
that offers no validator of its own back to the server — SHALL receive the same bytes, the
same status and every other header exactly as it does without this rule, the declaration
and the validator being the only difference, so that a reader that knows nothing of the
parameter keeps working unchanged. A request that omits the version but *does* offer a
validator back is answered by the rules above and below rather than by this one, since
those conditional answers are the point of issuing a validator at all. A parameter that is
present but is not a
finite number SHALL be treated as absent rather than refused, since it is an assertion
about cacheability and never a selector: the bytes served SHALL always be the source's
current bytes whatever the parameter says.

Any answer these routes give that is not the bytes — a request they reject, a source that
is missing or is not a model, an archive that cannot be read, an entry that is not in it, a
source that cannot be converted — SHALL be declared not to be stored at all and SHALL carry
no validator, so that a failure is never cached at any hop and a reader is never told that
its miss is still current. This SHALL hold whether the route produces the status itself or
raises it for the server's shared error handler to render, since the reader cannot tell the
two apart and a cache is free to store a not-found answer that says nothing.

None of this SHALL depend on the deployment. No configuration, no capability and no
network position SHALL change which declaration an answer receives, and nothing here SHALL
require a cache, a proxy or any network state to be present, so that a local or desktop
build behaves identically to a hosted one.

#### Scenario: A request naming the current version is pinned
- **WHEN** a model's bytes are requested with the version the listing reported and the source has not changed
- **THEN** the answer is the bytes, declared publicly cacheable for a long lifetime and immutable, carrying the same strong validator a version-less answer would carry, so a repeat request is served from the reader's own cache without reaching the server

#### Scenario: An edited source is a different URL, never a stale hit
- **WHEN** a source is modified so its modification time moves, and it is listed and requested again
- **THEN** the request names the new version, which is a different URL, and nothing previously pinned under the old version is served for it

#### Scenario: A version that is no longer current is answered, not pinned
- **WHEN** a request names a version the source no longer has
- **THEN** the source's current bytes are returned, declared uncacheable without revalidation and carrying no validator

#### Scenario: A version-less request costs a revalidation rather than a payload
- **WHEN** a request names no version, and the same reader repeats it offering back the validator it was given, with the source unchanged
- **THEN** the first answer carries the bytes and a strong validator, and the second is answered as not-modified with no body

#### Scenario: Omitting the version changes nothing else
- **WHEN** a request that names no version and offers no validator of its own is served
- **THEN** its bytes, its status and its other headers are exactly those it would have received before this rule existed, the declaration and the validator being the only additions

#### Scenario: An archive entry is versioned by its archive
- **WHEN** a model inside a zip archive is requested with the version the listing reported for it
- **THEN** that version is the archive's modification time, it is recognised as current, and the entry's bytes are pinned on the same terms a loose file's are

#### Scenario: A failure is never cached
- **WHEN** a request to one of these routes omits the path entirely, names a path that is not a servable model, names a path the route rejects, names an archive that is missing, unreadable or corrupt, names an entry the archive does not contain, or names a source that cannot be converted
- **THEN** the answer is declared not to be stored at all and carries no validator, whether the route produced that status itself or raised it for the shared error handler

#### Scenario: A not-modified check is honoured whatever version was named
- **WHEN** a request offers back the validator the source's current version yields, while also naming that same version, or a different one, or none
- **THEN** it is answered as not-modified with no body in each case, and both byte routes answer it the same way

#### Scenario: A desktop build behaves identically
- **WHEN** the server runs locally with no cache, proxy or public origin anywhere in front of it
- **THEN** every answer carries the same declaration it would carry on a hosted deployment, and no configuration exists that changes it

### Requirement: A ranged model read caches as consistently as a whole one
The route that serves a model's source bytes SHALL keep answering range requests as it
does, and a partial answer SHALL carry the same cacheability declaration that the whole
answer to that same request would have carried, so that a cache in front of the server is
not left guessing about a partial representation while it caches the whole one. A request
whose range names nothing within the source SHALL be declared not to be stored, since it
is an answer about the source's current size rather than about its bytes, and a source can
grow.

Where the server offers a validator it SHALL evaluate the conditional forms a reader may
offer back, rather than ignoring them. A request that offers a validator as the condition
for its range SHALL be answered with the whole current representation, not a partial one,
whenever that validator no longer matches, so that a reader cannot stitch a slice of new
bytes onto a stale prefix; when the validator still matches, the partial answer SHALL be
served as before. A request that offers a validator as a not-modified check SHALL be
answered as not-modified whether or not it also names a range.

#### Scenario: A partial answer declares what the whole one would
- **WHEN** a range of a model is requested with the version the listing reported
- **THEN** the partial answer carries the same cacheability declaration the whole answer for that version would have carried

#### Scenario: An unsatisfiable range is not stored
- **WHEN** a range names nothing within the source
- **THEN** the answer reports the source's size as it does today and is declared not to be stored

#### Scenario: A resumption across a changed source is refused a slice
- **WHEN** a reader asks for a range on the condition of a validator that no longer matches the source
- **THEN** the whole current representation is answered instead of a partial one

#### Scenario: A resumption against an unchanged source proceeds
- **WHEN** a reader asks for a range on the condition of a validator that still matches the source
- **THEN** the partial answer is served exactly as an unconditional range request's is

#### Scenario: A not-modified check outranks the range
- **WHEN** a request offers a matching validator as a not-modified check and also names a range
- **THEN** it is answered as not-modified with no body, rather than with a partial representation
