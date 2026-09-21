## ADDED Requirements

### Requirement: The viewer names the version of the model it fetches
When the client requests a model's bytes — the source file and the derived mesh alike — and
it holds the listing entry the request is raised from, it SHALL name in that request the
version that entry reports: the entry's modification time, sent exactly as the listing
reported it, with no rounding, truncation or reformatting of any kind, so that the answer
can be pinned by the reader's own cache rather than revalidated on every visit (see
`public-deployment`, *Model byte responses are cacheable by the version they name*). For an
entry inside an archive this is the archive's modification time, because that is what the
listing reports for such an entry and what the server judges the entry's staleness by —
one rule for both routes and both kinds of entry, with no case of its own in the client.

The same version SHALL be named by every request the client raises for that entry's bytes,
including the one a hover warm raises ahead of a press (see *Hover-warmed mesh LRU*), so
that the warm and the interaction it is warming for name one URL and the warm cannot
populate a cache entry the press is unable to use.

Naming the version SHALL remain optional in the client's own interface as well as on the
wire. A request raised where no such entry is in hand SHALL omit the version rather than
guess one, and SHALL then receive and handle the answer exactly as it does with no version
named — same bytes, same status handling, same errors — so that a caller that has only a
path keeps working unchanged.

Naming the version SHALL NOT change the answer the server gives. The bytes served are the
source's current bytes whatever version is named, so the version is an assertion about
cacheability and never a selector; it SHALL NOT change how a failed fetch is surfaced,
which stays the model-load failure the viewer already renders (see *Missing-model error
feedback*); and it SHALL NOT change how the client stores a loaded mesh for the session,
which stays keyed by the model's library path alone, so that a mesh already resident is
reused whatever version a later caller names.

What a reader's own cache does with a pin it has already earned is part of naming a
version, not an exception to it, and SHALL be read as such. A request naming a version the
reader holds pinned is answered from that cache without reaching the server at all, so
where a source is rewritten in place and the listing keeps reporting the version it had
before — which a listing served from a cached tree can do indefinitely, since a child's
rewrite moves no directory's modification time — the model SHALL be displayed from those
pinned bytes wherever that listing is what named it, and, once they are the session's
resident mesh for that path, wherever else in that session the model is drawn: the client's
own store is keyed by path alone, so a view whose listing names the current version is
served the resident mesh too until it is evicted.

This is the exposure the thumbnail key already carries for the same entry under the same
modification time: both keys are the modification time the listing reports, so wherever a
listing is stale, the render and the geometry are stale together. It SHALL NOT be read as a
guarantee that the two are never seen to disagree. A render persisted from a resident but
superseded mesh is labelled with whatever version the persisting view named, so a session
that meets the stale listing first can leave a stored render of the superseded geometry
under the *current* version, which a later session is served as a current render beside
geometry that has since been corrected. Nothing here SHALL be taken to prevent that; the
client SHALL NOT be required to detect it, and correcting the listing (see `listing-cache`)
is what removes it.

None of this SHALL require a cache, a proxy or any network position to be present, and no
configuration, capability or deployment posture SHALL decide whether the version is named,
so that a desktop or Electron build issues exactly the requests a hosted one issues.

#### Scenario: A tile's mesh is fetched under the version the listing gave it
- **WHEN** a model tile's mesh is fetched, having come from a listing entry
- **THEN** the request names that entry's modification time, and the answer is pinned by the browser's own cache, so a later visit to the same unchanged model reaches the server for nothing

#### Scenario: The version is sent exactly as the listing reported it
- **WHEN** a listing reports a modification time with a fractional part
- **THEN** the request carries that value in full, fraction included, and is recognised as naming the source's current version

#### Scenario: A warm and the press it precedes name one URL
- **WHEN** a model tile is hovered long enough to warm its mesh and is then pressed
- **THEN** both requests name the same version, so the press cannot be a second download of what the warm already fetched

#### Scenario: A model inside an archive is named by its archive
- **WHEN** a model inside a zip archive is fetched
- **THEN** the version named is the one the listing reports for that entry, which is the archive's modification time, and the client applies no separate rule for archive entries

#### Scenario: A fetch with no entry in hand still works
- **WHEN** a model's bytes are fetched by a caller that holds no listing entry for it
- **THEN** the request names no version, is issued exactly as it would have been before this rule existed, and its bytes and failures are handled identically

#### Scenario: A failed fetch surfaces the same error whatever version was named
- **WHEN** a fetch for a model's bytes fails, having named the source's current version, an older one the client still holds, or none at all
- **THEN** the viewer shows the model-load error it already shows, identically in all three cases, the client branching on the status and never on the version it named (what is answered when the fetch succeeds is `public-deployment`'s, *Model byte responses are cacheable by the version they name*: the source's current bytes in every case)

#### Scenario: A pin earned under a version is served while the listing still names that version
- **WHEN** a model fetched and pinned under the version its listing reported is rewritten in place, and a listing that cannot see the rewrite keeps reporting the version it had before
- **THEN** the client keeps naming that version, the reader serves the pinned bytes without reaching the server, and the model displays as it was — the same staleness that entry's thumbnail shows, under the same key, for the same reason

#### Scenario: A superseded mesh made resident is what the session draws and persists
- **WHEN** a session is served pinned bytes for a model through a stale listing, and then draws that model from a view whose listing names the current version
- **THEN** it draws the resident mesh rather than fetching again, and a render it stores for that model from that view is stored under the current version, so a later session can be served that render beside geometry that has since been corrected

#### Scenario: A resident mesh is reused whatever version is named
- **WHEN** a mesh already loaded for a path is acquired again under a different version
- **THEN** the resident mesh is reused with no second fetch, exactly as it is when the same version is named twice

#### Scenario: A desktop build issues the same requests
- **WHEN** the client runs against a local server with no cache, proxy or public origin anywhere in front of it
- **THEN** it names the version on the same requests it would name it on when hosted, and no setting exists that stops it
