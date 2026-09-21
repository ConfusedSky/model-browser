# public-deployment Specification

## Purpose
How a deployment of this server is described and served: the one configuration file
that names its library, its capabilities, the origins it answers and where it listens;
the rule that the built-in defaults are the maintained configuration and an authored one
is the exceptional, committed and tested path; and the serving of the built client from
the same process as the API. What a deployment *refuses* when it withholds a capability
lives with the capability that owns the surface (`feature-report`, `model-thumbnails`,
`app-launch`, `semantic-search`); the origin rule lives in `directory-browsing`; the
root's own configuration in `library`. The reasoning is in the archived change
`2026-09-08-public-deployment` (design D1–D11).

## Requirements

### Requirement: One configuration file describes the deployment
The server SHALL read a single configuration file describing the deployment it is part
of — which library it opens, which capabilities it offers, which origins it answers, and
where it listens — from the location the `library` capability already names for the
root, so that a deployment is described in one place rather than assembled from several.
The file SHALL be read once at server start, as every configuration in this app is. It
SHALL be read whether or not the environment supplies a root: an environment variable
naming the root SHALL override that key alone and SHALL NOT suppress the rest of the
file. An absent file SHALL mean the built-in defaults and SHALL be silent, since running
with no configuration is the ordinary case. A file that is present but cannot be parsed
SHALL be reported as a startup failure naming the file, and the server SHALL NOT fall
back to the defaults: a deployment whose configuration was authored and misread would
otherwise serve under a security posture nobody chose.

#### Scenario: No file at all
- **WHEN** the server starts with no configuration file present
- **THEN** it runs on the built-in defaults and says nothing about the file

#### Scenario: The environment names the root and the file carries the rest
- **WHEN** the root comes from the environment and the file declares capabilities and an origin
- **THEN** the environment's root is used and the file's other settings take effect

#### Scenario: A malformed file stops the server
- **WHEN** the configuration file is present and cannot be parsed
- **THEN** the failure is reported naming that file, and the server does not start on the defaults

#### Scenario: The file's location is still selectable
- **WHEN** an environment variable names a different configuration file
- **THEN** that file is the one read, under all the rules above

### Requirement: The defaults are the maintained configuration
The built-in configuration SHALL be the one this project maintains and tests as its
primary case — the configuration a distributed desktop build runs — and SHALL NOT be
merely the values a field takes when unset. Each capability SHALL carry its own default
rather than every capability defaulting on, so that a surface which is not ready for use
can be absent from the maintained configuration while remaining declarable. An authored
configuration SHALL be the exceptional path; a deployment this project ships SHALL have
its configuration committed to the repository and SHALL be tested as a named
configuration of its own, so that what is deployed cannot diverge from what is proven.

#### Scenario: An unconfigured server is the maintained one
- **WHEN** the server starts with no configuration file
- **THEN** it runs the configuration this project tests as its primary case, not an arbitrary all-on set

#### Scenario: A shipped deployment is tested
- **WHEN** this project ships a deployment with an authored configuration
- **THEN** that configuration is committed and exercised by the suite as a second named configuration

### Requirement: The server listens where it is configured to
The server's listening address SHALL come from its configuration rather than being
fixed in the program, and SHALL default to loopback. Runtime-specific serving concerns
SHALL remain confined to the runtime entry point, so that the application itself stays
portable to another host runtime.

#### Scenario: Default is loopback
- **WHEN** no listening address is configured
- **THEN** the server listens on loopback, as it does today

#### Scenario: A deployment listens elsewhere
- **WHEN** a deployment configures a different address or port
- **THEN** the server listens there

### Requirement: The server serves the built client
The server SHALL be able to serve the built client application alongside its API, so
that a deployment is one process rather than requiring a separate static host, and so
that the client and the API share an origin. Requests that do not name an API route
SHALL be answered from the built client, with a request for no particular document
answered by the client's entry document so that a deep link opened directly resolves. The
API's own prefix SHALL be reserved: a request under it that names no route SHALL answer as
a missing route and SHALL NOT fall through to the entry document, so that a client's bad
request is never answered with a page and a success status. Because the built client is content-hashed, its assets SHALL be served as immutable for a
long lifetime while its entry document SHALL NOT be cached, so that a visitor far from the
server fetches each asset once and still sees a new deployment on their next visit. 
Serving the built client SHALL NOT be required: a server started without one SHALL
continue to answer its API.

#### Scenario: The app loads from the server
- **WHEN** a browser opens the server's own address with a built client present
- **THEN** the client application is served and reaches its API on the same origin

#### Scenario: A deep link opened cold
- **WHEN** a URL naming a path inside the app is opened directly
- **THEN** the client's entry document is served and the client resolves the location itself

#### Scenario: A bad API request is not answered with a page
- **WHEN** a request names no route under the API's prefix
- **THEN** it is answered as a missing route rather than with the client's entry document

#### Scenario: The bundle is fetched once
- **WHEN** a visitor returns to a deployment whose build has not changed
- **THEN** the hashed assets are served from their own cache without being re-fetched, while the entry document is revalidated so a new build is picked up

#### Scenario: No built client present
- **WHEN** the server runs with no built client available
- **THEN** its API answers exactly as before and only the client's own routes are unavailable

### Requirement: The entry document carries link-preview metadata

The server SHALL annotate the client's entry document with link-preview metadata — a title,
a description, an image and the address itself — describing the view the requested URL names,
so that an address shared into a service that reads such metadata unfurls as that view rather
than as bare text. Because a shareable address names its view in the URL's query rather than
in its path, the metadata SHALL be derived from the whole requested URL, query included, and
an address naming no view SHALL be described as the library's top.

An address naming a single model SHALL be described by that model's displayed name, by the
attribution the library holds for it where it holds any, and by that model's own thumbnail,
served at the address the client already fetches thumbnails from. That image SHALL be named
only when the thumbnail is already held: answering a preview SHALL NOT cause a model to be
rendered, and SHALL NOT cost a directory listing or a walk, whatever path the address names.
Where the thumbnail is not held the model SHALL still be described by its own name and
attribution; only the image SHALL fall back. An address naming an entry *inside* an archive
SHALL be described by that entry only where its thumbnail is held: the archive being present
does not show that the entry within it is, and reading the archive to find out is the listing
this forbids. An address naming something that is not a single model — a directory, or an
archive the app browses as a folder — SHALL NOT be described as a model.

Every address that does not name a model SHALL take the single image shipped with the built
client. An address naming a directory on disk that the library resolves SHALL be titled by that
directory — an archive the app browses as a folder is a file on disk and is not one;
every other such address — the library's top, a search, a similarity view, the deployment's
own pages — SHALL be titled by the deployment itself. Because the text of an address is
chosen by whoever composed the link, a path the library does not resolve SHALL be described
as the deployment and never by its own text, so that a fabricated link cannot make the
deployment appear to say something. This governs the title and the description alone: the
address the metadata states is the address that was requested, restated as it was given, and
it SHALL continue to name that address whether or not the path within it resolved.

The image and the address stated in the metadata SHALL be absolute. They SHALL be built from
the origin the deployment's configuration declares for itself where it declares one, and only
where it declares none SHALL they be built from the requesting client's stated host and
forwarded scheme, so that a deployment behind a proxy cannot have the image it advertises
moved to another host by a request's own headers.

Because the entry document is served without the guard the API is served under, the metadata
SHALL describe the library only for a request whose stated host the deployment answers to —
the host it declares for itself, or loopback. A request stating any other host SHALL be
described as the deployment, with nothing read from the library, so that a page pointed at
this server under a name of its own cannot learn from the document what the API would refuse
it.

Every value taken from the library and placed in the document SHALL be escaped, so that a
name or a path held in a library cannot alter the document's markup or the addresses within
it. Annotation SHALL apply only to the documents the build emits as entry documents and never
to its assets, which are served under a long immutable lifetime and would otherwise be cached
carrying one address's description. Each value that varies with the view SHALL be stated
exactly once, so that no consumer has to choose between two answers for it; values that do
not vary MAY be carried by the built document itself.

The metadata SHALL be present whatever capabilities the deployment enables, since it
describes the deployment rather than granting a visitor anything. When a described value
cannot be resolved — an unknown path, a library that is not ready, a thumbnail that is not
held — the document SHALL still be served, carrying what could be resolved, and SHALL NOT
answer with an error.

#### Scenario: The library's top unfurls as the deployment

- **WHEN** the deployment's bare address is fetched
- **THEN** the document names the deployment, describes it, and names the image shipped with
  the built client, each as an absolute address

#### Scenario: A model deep link unfurls as that model

- **WHEN** an address naming a model whose thumbnail is held is fetched
- **THEN** the document names that model, carries the attribution the library holds for it,
  and names that model's own thumbnail as the preview image

#### Scenario: An unrendered model does not cause a render

- **WHEN** an address naming a model whose thumbnail is not held is fetched
- **THEN** the document still names that model and the attribution the library holds for it,
  names the image shipped with the client in place of a thumbnail, and no thumbnail is
  rendered or written as a result of the fetch

#### Scenario: A directory link unfurls without listing the directory

- **WHEN** an address naming a directory is fetched
- **THEN** the document names that directory and the shipped image, and the directory is
  neither listed nor walked to answer it

#### Scenario: The advertised addresses are the deployment's own

- **WHEN** a deployment that declares a public origin is fetched through a request stating a
  different host
- **THEN** the image and the address in the metadata name the declared origin, not the host
  the request stated

#### Scenario: An installation that declares no origin describes itself

- **WHEN** a deployment with no declared origin is fetched over loopback
- **THEN** the image and the address in the metadata are absolute and name the host and
  scheme the request arrived under

#### Scenario: Library text cannot alter the document

- **WHEN** the described model's displayed name or attribution contains markup or quotation
  characters
- **THEN** the document's markup is unchanged in shape and the characters appear escaped
  within the metadata

#### Scenario: Assets are served unannotated

- **WHEN** one of the build's hashed assets is fetched
- **THEN** its bytes are served exactly as built, with no metadata inserted, under the
  immutable lifetime assets are served with

#### Scenario: An unresolvable address still serves the app

- **WHEN** an address naming a path the library cannot answer for is fetched — a directory or
  a model that is not there, a path outside the library, or a virtual path the library refuses
- **THEN** the entry document is served as it is for any deep link, described as the
  deployment rather than as a missing model or directory, and the client resolves the
  location itself

#### Scenario: A fabricated entry inside a real archive cannot speak for the deployment

- **WHEN** an address names an entry inside an archive that is really there, whose own path
  reads as a sentence, and no thumbnail is held for that entry
- **THEN** the preview is titled by the deployment, no part of that path appears as the title
  or the description, and the archive is not read to answer it

#### Scenario: A request under a host the deployment does not answer to learns nothing

- **WHEN** the deployment is fetched through a request stating a host it neither declares for
  itself nor answers to over loopback
- **THEN** the document is served and described as the deployment, and no name, attribution
  or path from the library appears in it

#### Scenario: A fabricated address cannot speak for the deployment

- **WHEN** an address is composed naming a directory or a model that does not exist, whose
  path reads as a sentence a reader would take for the deployment's own words
- **THEN** the preview is titled by the deployment, and no part of that path appears as the
  title or the description

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

A response that carries the bytes SHALL be declared in one of three ways, and wherever the
source's version is known all three SHALL carry the same strong validator derived from it —
one representation, one validator — so that what the three ways differ in is what a cache
may do without asking, and nothing else. When the request
names the version the source currently has, the answer SHALL be publicly cacheable for a
long lifetime and immutable, because a source that changes moves every subsequent request
for it to a different version and therefore a different URL; the validator is what lets a
reader resuming a partial download of a pinned answer make its resumption conditional.
When the request names any
other version, the answer SHALL carry the source's current bytes and SHALL be declared
uncacheable without revalidation, so that the reader re-keys from a fresh listing rather
than settling on a URL it should stop using, and it SHALL carry the validator all the
same, so that a reader naming a version the source no longer has — which it may keep doing
for as long as its listing stays stale — pays a revalidation rather than a whole payload on
every request it makes meanwhile. When the
request names no version at all, the answer SHALL likewise be declared uncacheable without
revalidation, and a request offering that validator back SHALL be answered as not-modified
with no body.

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
- **THEN** the source's current bytes are returned, declared uncacheable without revalidation, and carrying the same validator every other byte-carrying answer for that source carries, so that a reader that keeps naming the stale version is answered not-modified rather than re-sent the bytes

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
