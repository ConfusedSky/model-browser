# public-deployment Delta

## ADDED Requirements

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
request is never answered with a page and a success status. Because the built client is
content-hashed, its assets SHALL be served as immutable for a long lifetime while its
entry document SHALL NOT be cached, so that a visitor far from the server fetches each
asset once and still sees a new deployment on their next visit.
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
