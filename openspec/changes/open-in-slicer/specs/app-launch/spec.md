# app-launch Specification

## ADDED Requirements

### Requirement: The server reports the applications for a model entry's type
The server SHALL expose an endpoint that, given a listing entry's path (virtual zip
paths included), resolves the entry's model type and returns the platform's default
application for it and the further associated applications — each application as an
identifier plus a human-readable name, with the default distinguished — together with
whether a chooser is configured, so the client can offer or withhold its
chooser-dependent action. The type SHALL be resolved from the entry's file extension
against a fixed table of the model formats the application handles — never by content
sniffing, which misreads binary STL and cannot see inside archives. A path whose
extension is outside the table SHALL yield empty default and associations; the
chooser-configured indication does not depend on the type. The path SHALL be validated
as the file endpoint validates its paths.

#### Scenario: An STL entry's applications, default first
- **WHEN** the client requests applications for an entry ending in `.stl` on a platform
  whose registry has a default and further associations for `model/stl`
- **THEN** the response identifies the default application and the associated
  applications, the default is distinguishable, and the response says whether a
  chooser is configured

#### Scenario: A zip entry resolves by its inner name
- **WHEN** the client requests applications for `archive.zip!/part.stl`
- **THEN** the type resolves from `part.stl`'s extension, exactly as for a plain file

#### Scenario: An unmapped extension yields no associations
- **WHEN** the client requests applications for an entry whose extension is not in the
  format table
- **THEN** the response carries no default and no associations, and still says whether
  a chooser is configured

### Requirement: The server launches an application with an entry's file
The server SHALL expose an endpoint accepting an entry path and an application
identifier — never a command — that launches the identified application with the
entry's file. The path SHALL be validated as the file endpoint validates its paths,
and the launcher SHALL always receive an absolute path, since a relative path breaks
applications that resolve it against another working directory (single-instance
forwards). A zip virtual path SHALL first be extracted to a temporary file — one
stable name per entry within a per-server-run temporary directory, overwritten on each
launch and not deleted while the server runs, since the launched application may still
be reading it. The endpoint SHALL report success exactly when the platform's launch
command succeeded, and SHALL report a failed or unspawnable launch command as an
error with its reason; it makes no claim about the launched application's behavior
past a successful handoff.

#### Scenario: A plain file launches with an absolute path
- **WHEN** the client requests a launch for a valid model file and an installed
  application
- **THEN** the launch command runs with the file's absolute path and the endpoint
  reports success

#### Scenario: A zip entry is extracted, then launched
- **WHEN** the client requests a launch for `archive.zip!/part.stl`
- **THEN** the entry's bytes are extracted to the run's temporary directory and the
  launch command receives that file's absolute path

#### Scenario: A missing file is an error, not a launch
- **WHEN** the client requests a launch for a path that does not exist
- **THEN** no launch command runs and the endpoint reports the error

#### Scenario: A failing launch command is reported
- **WHEN** the launch command exits nonzero or cannot be spawned
- **THEN** the endpoint reports failure with the reason

### Requirement: Platform operations are configurable command templates
The server SHALL perform its four platform operations — the default application for a
type, the associations for a type, launching an application with a file, and invoking
the chooser with a file — through configurable command templates from a local server
configuration file, with built-in implementations backed by the freedesktop machinery
for all but the chooser, which has no portable builtin and SHALL be treated as
unavailable until configured. A template SHALL be an argv array with `{mime}`,
`{appId}`, and `{file}` placeholders substituted per element and executed without a
shell, so that no value — file names included — is ever interpreted by one; an
override of a query operation SHALL follow the same documented line-oriented output
contract the built-ins satisfy. With no configuration file present the built-ins SHALL
serve unchanged. Configuration is read from the local machine only; nothing received
over the network SHALL reach a template except as a substituted placeholder value.

#### Scenario: No configuration, built-in behavior
- **WHEN** the server starts with no launch configuration file
- **THEN** all four operations run their built-in freedesktop implementations

#### Scenario: An overridden operation runs the configured argv
- **WHEN** the configuration overrides the launch operation with an argv template and
  the client requests a launch
- **THEN** the configured argv runs with placeholders substituted per element, in
  place of the built-in

#### Scenario: Shell metacharacters in a file name stay inert
- **WHEN** a launch is requested for a file whose name contains shell metacharacters
- **THEN** the launcher receives the name as a single argument, uninterpreted

### Requirement: The server invokes the configured chooser with an entry's file
The server SHALL expose an endpoint accepting an entry path — nothing else — that
invokes the configured chooser operation with the entry's file, behind the same path
validation, zip temp-extraction, and absolutization the launch endpoint applies. With
no chooser configured the endpoint SHALL report the operation unavailable without
running anything. The chooser command completing SHALL read as success — what the
chooser did, a dismissal without a choice included, is not the server's to judge — and
a chooser command that fails or cannot be spawned SHALL be reported as an error with
its reason.

#### Scenario: A configured chooser receives the absolute path
- **WHEN** a chooser is configured and the client requests it for a valid model file
- **THEN** the chooser command runs with the file's absolute path and the endpoint
  reports success when the command completes

#### Scenario: Unconfigured is unavailable, not an error launch
- **WHEN** no chooser is configured and the client requests it
- **THEN** nothing is spawned and the endpoint reports the operation unavailable

#### Scenario: A zip entry reaches the chooser as a real file
- **WHEN** a chooser is configured and the client requests it for `archive.zip!/part.stl`
- **THEN** the entry is temp-extracted as the launch endpoint extracts, and the chooser
  command receives that file's absolute path
