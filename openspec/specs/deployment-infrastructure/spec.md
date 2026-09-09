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

