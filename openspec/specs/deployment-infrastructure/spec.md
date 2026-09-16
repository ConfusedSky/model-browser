# deployment-infrastructure Specification

## Purpose
How the public deployment is built, exposed, kept running and fed: one entry point that
terminates TLS, three services on one loopback, images built from the checkout, state in
mounts and volumes, the configuration mounted from the repository, and a local rehearsal
that runs the same files. What the application accepts and serves once it is running is
`public-deployment`'s. The files are under `deploy/demo/`, the operator's steps in its
README; the reasoning is in the archived change `2026-09-09-demo-infrastructure`.

## Requirements

### Requirement: One public entry point
The public deployment SHALL expose exactly one process to the network — a reverse proxy
that terminates TLS — publishing only the HTTP and HTTPS ports, and the host's firewall
SHALL admit only those and administrative SSH. The proxy SHALL obtain and renew its
certificate automatically, SHALL redirect plain HTTP to HTTPS, and SHALL serve HTTP/2, so
that a first screen of many small requests is multiplexed rather than paid one round trip
at a time. The proxy SHALL pass the request's `Host` through unchanged, so that the
application's own origin rules decide what it answers.

#### Scenario: The certificate is the proxy's business
- **WHEN** the stack is started on a host whose name resolves to it and whose ports 80 and 443 are open
- **THEN** a browser reaches the site over HTTPS with a certificate issued for its name, a plain HTTP request is redirected, and no operator step issued or installed the certificate

#### Scenario: Only the proxy answers
- **WHEN** a request is made from outside the host to the application's or the index's own port
- **THEN** nothing answers, because neither port is published and the firewall does not admit it

#### Scenario: The application's origin rule is not bypassed by the proxy
- **WHEN** the application refuses a request because of its `Host` or `Origin`
- **THEN** the proxy has not rewritten either, and the refusal is what the client receives

### Requirement: The services share one loopback
The proxy, the application and the semantic index SHALL run in one network namespace,
sharing a loopback interface, so that each reaches the others at the loopback addresses
their defaults already name and none of them listens on an interface reachable from
outside that namespace. The application and the index SHALL need no address
configuration to find each other.

#### Scenario: Defaults suffice
- **WHEN** the stack is started with no address configured for the index or the application
- **THEN** the proxy reaches the application, and the application reaches the index, at their default loopback addresses

#### Scenario: A stray wide bind is still not public
- **WHEN** a service in the namespace binds every interface instead of loopback
- **THEN** it is still reachable only from within the namespace, since no port of its is published

### Requirement: Reproducible from the checkout
The deployment SHALL be built and started from a checkout of this repository by one
command, from images built on pinned base images, with every runtime dependency declared
in the repository rather than installed by hand on the host. The same command SHALL bring
the stack up on a developer machine against a local corpus, under a locally trusted
certificate, so that the deployment is exercised before it is exercised on the host.

#### Scenario: One command on the host
- **WHEN** an operator runs the deployment command in a checkout on a prepared host
- **THEN** the images build, the services start, and the stack restarts by itself after a reboot

#### Scenario: The same command here
- **WHEN** a developer runs the deployment command with the local profile and a local corpus
- **THEN** the same images build, the same namespace wiring holds, and the application answers over HTTPS on localhost

#### Scenario: A dependency is declared or it is not there
- **WHEN** a runtime dependency of either server is needed
- **THEN** it is declared in an image definition in the repository, and the host carries nothing but the container engine

### Requirement: State outlives the containers
The corpus, the application's caches, the index's embeddings, the model checkpoint and
the proxy's certificates SHALL live outside the images, in mounts or volumes, so that a
rebuild, a redeploy or a rollback keeps every one of them. The checkpoint SHALL be fetched
on the host once rather than carried in an image or uploaded from a developer machine.

#### Scenario: A rebuild keeps everything expensive
- **WHEN** the images are rebuilt and the stack restarted
- **THEN** the corpus, the caches, the embeddings, the checkpoint and the certificate are exactly as they were, and no certificate is re-issued

#### Scenario: A rollback is a checkout
- **WHEN** an operator checks out an earlier revision and runs the deployment command
- **THEN** the earlier images serve against the same state, and the certificate is not re-issued

### Requirement: The deployment's configuration comes from the repository
The application's configuration file for the public deployment SHALL be committed to the
repository and SHALL reach the container by being mounted from the checkout at the path
the application is told to read, so that a configuration change is a commit and is applied
by the same redeploy as a code change. The file SHALL be mounted read-only.

#### Scenario: A configuration change is a deploy
- **WHEN** the committed configuration file changes and the stack is redeployed
- **THEN** the application starts with the new configuration, and no file on the host was edited by hand

#### Scenario: The container cannot rewrite its configuration
- **WHEN** anything inside the application container attempts to write the configuration file
- **THEN** the write fails, because the mount is read-only

### Requirement: The library is writable only where the application writes it
The corpus SHALL be mounted into the application read-write, so that the library marker
and the override store can be written beside the models, and the same corpus SHALL be
mounted into the index read-only at the same path, so that the two resolve the same files
and only the application can change anything under the library.

#### Scenario: The marker names the library on first start
- **WHEN** the application starts for the first time against the mounted corpus
- **THEN** it writes its marker under the library and names the cache directory by that id, so a later bake and a later remount agree on the name

#### Scenario: The index cannot write the corpus
- **WHEN** the index container attempts to write under the corpus
- **THEN** the write fails, because its mount is read-only

### Requirement: The corpus is baked with the shipping recipe
The deployment's thumbnail store SHALL be filled by a repeatable, scripted bake run on a
developer machine against a copy of the corpus whose relative paths and file times are
those of the deployed corpus, under the client build of the commit the deployment will
build from. The bake SHALL start and own its own server instance with writes and
maintenance on and SHALL stop it on every exit, normal or not, so that no instance is
left running; it SHALL NOT start the semantic index and SHALL NOT touch any other
running instance. Before rendering anything the bake SHALL confirm that the index is
ready and that the collection it covers maps to the top of the bake library, and SHALL
refuse to proceed otherwise, since a bake made without the index's orientations would
be unposed for every model — and since a bake library rooted above the corpus reports
its collection elsewhere than the top, the same check refuses a store keyed under the
wrong paths. The bake SHALL also confirm, from the index's own report of itself, that
the cache directory the index serves from is the one the pose fingerprint will be taken
from, and SHALL refuse otherwise. The bake SHALL render every model under both
occlusion settings at the one producible lighting, driving the application's own bulk
generate job; a pass under one setting is complete only when the job has settled and a
further launch under that setting derives no work, and the other setting SHALL NOT be
selected before that, since a render in flight is filed under the setting in force
when it lands. The bake SHALL then verify the store on disk — one sidecar per
enumerated model, both renders present, every render labelled with the model's file
time, the shipping rig version, the shipping lighting label and, where an orientation
framed it, the shipping pose mapping version and the orientation key — and SHALL refuse
to write a manifest when any model fails that check or when no model was posed. For
every render that carries no orientation the bake SHALL ask the index, through the
application's own pose route, and SHALL require a settled absence for each — a path
the index was asked about and holds no orientation for; a path whose ask did not settle,
or for which the index holds an orientation, SHALL refuse the manifest with the path
named, since such a render would be re-rendered on every visit of the deployment and
the disk cannot distinguish it from a settled one. The manifest SHALL record the
client commit, the recipe versions, the model and render counts, the render rate, the
index's cache directory and view configuration, the fingerprint of the index's
orientations and of the view configuration that keys them, and the date; SHALL be
written in one fixed formatting the deployment's check reads by line; and SHALL be
kept where the store's own maintenance never reads it as an entry.

#### Scenario: A bake completes and is verified
- **WHEN** the bake is run against the corpus with the index ready on the library's top
- **THEN** every model has both renders labelled with the shipping recipe, the manifest records the counts, the versions, the commit and the rate, and the server the bake started is gone when the bake ends

#### Scenario: The index covers somewhere else
- **WHEN** the index is ready but its collection root maps to a location other than the top of the bake library, or outside it
- **THEN** the bake refuses before rendering, naming the root the index reported and the one required, and writes no manifest

#### Scenario: The index serves another cache than the fingerprint names
- **WHEN** the index is ready on the library's top but reports a cache directory other than the one the bake was told to fingerprint
- **THEN** the bake refuses before rendering, naming both directories, and writes no manifest

#### Scenario: A model is missing a render
- **WHEN** the on-disk verification finds a model without one of its two renders, or a render whose labels are not the shipping recipe
- **THEN** the bake lists every such model, writes no manifest, and exits non-zero

#### Scenario: An unlabelled render whose orientation never settled
- **WHEN** the on-disk verification passes and the index, asked about the renders that carry no orientation, leaves one unanswered or answers an orientation for it
- **THEN** the bake lists every such model, writes no manifest, and exits non-zero

#### Scenario: Every unlabelled render is a settled absence
- **WHEN** the index answers, for every render that carries no orientation, that it was asked and holds none
- **THEN** the audit passes and the bake proceeds to the manifest

#### Scenario: Interrupted at the keyboard
- **WHEN** the bake is interrupted while a generate pass is running
- **THEN** its server instance is stopped and the scratch port is free, and running the bake again continues from what was already rendered

#### Scenario: The manifest survives a restart of the store's owner
- **WHEN** the deployment's application starts against a cache directory holding the bake manifest
- **THEN** the startup sweep leaves the manifest in place and completes, because the manifest lives where the sweep does not read entries

### Requirement: The baked store ships whole into the deployment's own store
Shipping the bake SHALL copy the bake's sidecars, renders and manifest into the
directory the deployment's application names for its own library identity — which
differs from the bake machine's — and SHALL NOT copy the deployment's listing snapshots
over, since those are the deployment's own and carry its root. Shipping SHALL delete
nothing on the deployment. Contact sheets SHALL NOT be shipped, since the application
derives them in memory from a listing; orientations SHALL NOT be shipped, since they
are the index's and are already deployed with it. After the copy the application SHALL
be restarted, so that its startup sweep indexes the shipped store and, once that sweep
has completed, the first listing of every folder carries each tile as a hit rather than
provoking one lookup per tile. The bake SHALL print the exact copy and restart commands,
filling in every identity it knows — the bake machine's library identity always, the
deployment's and the host's when it was told them — and MAY run them on request.

When the bake runs them, it SHALL verify the deployment afterwards and SHALL NOT report
success unless that verification passed: a run that has copied the store and restarted
the application has changed what visitors see, and reporting success without checking
leaves a broken deployment looking like a finished one. The verification SHALL wait for
the application to answer as ready, SHALL confirm that the application's library identity
is the one the store was copied into, SHALL read back several models under both occlusion
settings as hits carrying the shipping recipe, and SHALL exercise whatever queries the
deployment offers a first-time visitor. A verification that cannot be aimed at the
deployment it copied to SHALL be refused before anything is copied, rather than aimed
somewhere else.

#### Scenario: A ship that cannot be verified is refused before it copies anything
- **WHEN** a ship is asked for against a deployment whose address the bake cannot turn into
  an origin to verify, and none is given
- **THEN** the bake refuses before copying anything, naming the address and what to pass,
  rather than copying the store and leaving the verification undone

#### Scenario: A deployment that never becomes ready fails the ship
- **WHEN** the bake has copied the store and restarted the application, and the application
  does not answer as ready within the bake's own bound
- **THEN** the bake reports the failure with the commands to finish the verification by
  hand, and does not report success

#### Scenario: The verification refuses a deployment it did not ship to
- **WHEN** the bake is pointed at an origin whose library identity is not the one the store
  was copied into
- **THEN** the bake refuses, naming both identities, rather than passing on another
  deployment's store

#### Scenario: The store answers from the first visit
- **WHEN** the bake has been shipped, the application restarted and its startup sweep has completed, and a visitor opens the library's top and one kit for the first time
- **THEN** every tile is served from the image route under both occlusion settings, no tile is looked up individually, no mesh is fetched and no tile is rendered in the visitor's browser

#### Scenario: A thumbnail read hits for both variants
- **WHEN** a thumbnail is asked for by a model's library path and file time on the deployment, for each occlusion setting
- **THEN** each answer is a hit carrying the shipping recipe labels

#### Scenario: The deployment's snapshots are its own
- **WHEN** the bake is shipped
- **THEN** the deployment's listing snapshots are as they were before the copy

### Requirement: A redeploy is refused when the recipe has moved past the bake
Before the deployment is rebuilt from a checkout — a pull forward or a rollback to an
earlier revision alike — the rig version and the pose mapping version that checkout
would build into the client, and the fingerprints of the index's orientations and of
the view configuration that keys them, as deployed, SHALL be compared with the bake
manifest on the deployment; when any of them differs, or when there is no manifest,
the rebuild SHALL NOT start and the running deployment SHALL keep serving, with the
disagreement named. The check SHALL run on the deployment host using nothing beyond a
POSIX shell and its standard tools, since the host carries no other runtime. The check
SHALL refuse rather than pass when it cannot find exactly one definition of either
version in the source, or exactly one line for any value it reads from the manifest.
A differing client commit at equal versions SHALL be reported and SHALL NOT refuse,
since the versions are the recipe's own statement that the pixels are unchanged. The
first deploy of a fresh host, which precedes any bake, is not subject to the check.

#### Scenario: The recipe matches
- **WHEN** the checkout's versions and the deployed orientations agree with the manifest
- **THEN** the check passes silently and the rebuild proceeds

#### Scenario: The rig has moved
- **WHEN** the checkout's rig version differs from the manifest's
- **THEN** the check names both values, the rebuild does not start, and the running deployment is untouched

#### Scenario: The index was re-embedded
- **WHEN** the deployed orientations' fingerprint differs from the manifest's
- **THEN** the check names the difference and the rebuild does not start

#### Scenario: The index's view configuration changed
- **WHEN** the deployed orientations are unchanged but the fingerprint of the view configuration that keys them differs from the manifest's
- **THEN** the check names the difference and the rebuild does not start, since every orientation key the client derives has moved

#### Scenario: A rollback across a bump
- **WHEN** the checkout is an earlier revision whose versions differ from the manifest's
- **THEN** the check refuses exactly as for a pull forward, and the rollback needs that revision's bake

#### Scenario: A manifest the check cannot read by line
- **WHEN** the manifest does not carry exactly one line for a value the check reads
- **THEN** the check refuses and says which read matched how many lines, rather than comparing against nothing

#### Scenario: No bake on the deployment
- **WHEN** the deployment's cache holds no bake manifest
- **THEN** the check says so and the rebuild does not start

#### Scenario: A constant the check cannot find
- **WHEN** the source no longer carries exactly one definition of a version the check reads
- **THEN** the check refuses and says which pattern matched how many lines, rather than comparing against nothing
