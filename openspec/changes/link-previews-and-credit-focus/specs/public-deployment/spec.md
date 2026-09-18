## ADDED Requirements

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
