## ADDED Requirements

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
be unposed for every model. The bake SHALL render every model under both occlusion
settings at the one producible lighting, driving the application's own bulk generate
job until the application's own count of missing thumbnails reads zero under each
setting. The bake SHALL then verify the store on disk — one sidecar per enumerated
model, both renders present, every render labelled with the model's file time, the
shipping rig version, the shipping lighting label and, where an orientation framed
it, the shipping pose mapping version and the orientation key — and SHALL refuse to
write a manifest when any model fails that check or when no model was posed. The
manifest SHALL record the client commit, the recipe versions, the model and render
counts, the render rate, the index's pose fingerprint and the date, and SHALL be kept
where the store's own maintenance never reads it as an entry.

#### Scenario: A bake completes and is verified
- **WHEN** the bake is run against the corpus with the index ready on the library's top
- **THEN** every model has both renders labelled with the shipping recipe, the manifest records the counts, the versions, the commit and the rate, and the server the bake started is gone when the bake ends

#### Scenario: The index covers somewhere else
- **WHEN** the index is ready but its collection root maps to a location other than the top of the bake library, or outside it
- **THEN** the bake refuses before rendering, naming the root the index reported and the one required, and writes no manifest

#### Scenario: A model is missing a render
- **WHEN** the on-disk verification finds a model without one of its two renders, or a render whose labels are not the shipping recipe
- **THEN** the bake lists every such model, writes no manifest, and exits non-zero

#### Scenario: Interrupted at the keyboard
- **WHEN** the bake is interrupted while a generate pass is running
- **THEN** its server instance is stopped and the scratch port is free, and running the bake again continues from what was already rendered

#### Scenario: The manifest survives a restart of the store's owner
- **WHEN** the deployment's application starts against a cache directory holding the bake manifest
- **THEN** the startup sweep leaves the manifest in place, because it lives where the sweep does not read entries

### Requirement: The baked store ships whole into the deployment's own store
Shipping the bake SHALL copy the bake's sidecars, renders and manifest into the
directory the deployment's application names for its own library identity — which
differs from the bake machine's — and SHALL NOT copy the deployment's listing snapshots
over, since those are the deployment's own and carry its root. Shipping SHALL delete
nothing on the deployment. Contact sheets SHALL NOT be shipped, since the application
derives them in memory from a listing; orientations SHALL NOT be shipped, since they
are the index's and are already deployed with it. After the copy the application SHALL
be restarted, so that its startup sweep indexes the shipped store and the first listing
of every folder carries each tile as a hit rather than provoking one lookup per tile.
The bake SHALL print the exact copy and restart commands with both library identities
filled in, and MAY run them on request.

#### Scenario: The store answers from the first visit
- **WHEN** the bake has been shipped and the application restarted, and a visitor opens the library's top and one kit for the first time
- **THEN** every tile is served from the image route under both occlusion settings, no tile is rendered in the visitor's browser, and no thumbnail write is attempted

#### Scenario: A thumbnail read hits for both variants
- **WHEN** a thumbnail is asked for by a model's library path and file time on the deployment, for each occlusion setting
- **THEN** each answer is a hit carrying the shipping recipe labels

#### Scenario: The deployment's snapshots are its own
- **WHEN** the bake is shipped
- **THEN** the deployment's listing snapshots are as they were before the copy

### Requirement: A redeploy is refused when the recipe has moved past the bake
Before the deployment is rebuilt from a checkout, the rig version and the pose mapping
version that checkout would build into the client, and the fingerprint of the index's
orientations as deployed, SHALL be compared with the bake manifest on the deployment;
when any of the three differs, or when there is no manifest, the rebuild SHALL NOT
start and the running deployment SHALL keep serving, with the disagreement named. The
check SHALL run on the deployment host using nothing beyond a POSIX shell and its
standard tools, since the host carries no other runtime. The check SHALL refuse rather
than pass when it cannot find exactly one definition of either version in the source.
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

#### Scenario: No bake on the deployment
- **WHEN** the deployment's cache holds no bake manifest
- **THEN** the check says so and the rebuild does not start

#### Scenario: A constant the check cannot find
- **WHEN** the source no longer carries exactly one definition of a version the check reads
- **THEN** the check refuses and says which pattern matched how many lines, rather than comparing against nothing
