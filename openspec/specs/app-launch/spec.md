# app-launch Specification

## Purpose
TBD - created by archiving change open-in-slicer. Update Purpose after archive.
## Requirements
### Requirement: The server reports the applications for the model types it handles
The server SHALL expose an endpoint, taking no entry path, that reports for each model
type the application handles: the platform's default application and the further
associated applications — each as an identifier plus a human-readable name resolved
from the platform's application entries, with the default distinguished — together
with whether a chooser is configured, so the client can offer or withhold its
chooser-dependent action. Associations SHALL include applications whose entries
declare the type even when the platform's cached index has missed them, by reading the
entries rather than trusting the cache; SHALL exclude entries the platform marks
not-for-display and applications the user's configuration explicitly removed from the
type; and the default is its own source — it need not appear among the associations. The endpoint SHALL reflect the registry as it
stands at the time of the request — no memoization across requests — since the
chooser can rewrite the registry mid-session. Model types SHALL be derived from the
same format detection the listing already uses to decide what a model is, so the two
cannot drift; types outside that set are not reported.

#### Scenario: Types report default first, with names
- **WHEN** the client requests the applications report on a platform whose registry
  has a default and further associations for `model/stl`
- **THEN** the response maps `model/stl` to its default application and associated
  applications, each carrying a human-readable name, the default distinguishable, and
  says whether a chooser is configured

#### Scenario: An entry the cached index missed still associates
- **WHEN** an application's entry declares a model type but the platform's cached
  index does not list it for that type
- **THEN** the report includes that application among the type's associations

#### Scenario: A registry change is visible on the next request
- **WHEN** the platform default for a type changes after the server has answered once,
  and the client requests the report again
- **THEN** the new default is reported

### Requirement: The server launches an application with an entry's file
The server SHALL expose an endpoint accepting an entry path and an application
identifier — never a command — that launches the identified application with the
entry's file. The path SHALL be validated as the file endpoint validates its paths,
nested-zip entries rejected as the file endpoint rejects them, and the launcher SHALL
always receive an absolute path, since a relative path breaks applications that
resolve it against another working directory (single-instance forwards). A zip virtual
path SHALL first be extracted to a temporary file — named from the full virtual path,
keeping the entry's extension, within a per-server-run temporary directory — so that
same-named entries in different archives never share a file. A repeat launch of the
same virtual path SHALL replace that file by writing aside and renaming over it —
never truncating in place — so an application still reading keeps the content it
opened; nothing is deleted while the server runs, since the launched application may
still be reading it. The endpoint SHALL report
success exactly when the platform's launch command succeeded, and SHALL report a
failed or unspawnable launch command as an error with its reason; it makes no claim
about the launched application's behavior past a successful handoff.

#### Scenario: A plain file launches with an absolute path
- **WHEN** the client requests a launch for a valid model file and an installed
  application
- **THEN** the launch command runs with the file's absolute path and the endpoint
  reports success

#### Scenario: Same-named entries in different archives get distinct files
- **WHEN** launches are requested for `a.zip!/part.stl` and then `b.zip!/part.stl`
- **THEN** each is extracted to its own temporary file, and the second launch does not
  overwrite what the first application may still be reading

#### Scenario: Relaunching a zip entry does not truncate an in-flight reader
- **WHEN** a zip entry is launched again while an application from the first launch
  may still be reading its temporary file
- **THEN** the new bytes arrive by rename over the name, and the earlier reader keeps
  the content it opened

#### Scenario: A missing file is an error, not a launch
- **WHEN** the client requests a launch for a path that does not exist
- **THEN** no launch command runs and the endpoint reports the error

#### Scenario: A nested zip is rejected
- **WHEN** the client requests a launch for a zip entry that is itself a zip
- **THEN** no launch command runs and the endpoint rejects it as the file endpoint does

#### Scenario: A failing launch command is reported
- **WHEN** the launch command exits nonzero or cannot be spawned
- **THEN** the endpoint reports failure with the reason

### Requirement: Platform operations are configurable command templates
The server SHALL perform its four platform operations — the default application for a
type, the associations for a type, launching an application with a file, and invoking
the chooser with a file — through configurable command templates from a local server
configuration file, with built-in implementations for all but the chooser, which has
no portable builtin and SHALL be treated as unavailable until configured. The built-in
default query SHALL use the platform's machine-readable default lookup; the built-in
association query and all display names SHALL come from reading the platform's
application entries directly — including entries in subdirectories — never from
parsing localized human-oriented command output. A template SHALL
be an argv array with `{mime}`, `{appId}`, and `{file}` placeholders substituted per
element and executed without a shell, so that no value — file names included — is
ever interpreted by one; an override of a query operation SHALL produce the documented
line-oriented output, names included. With no configuration file present the built-ins
SHALL serve unchanged. Configuration is read from the local machine only; nothing
received over the network SHALL reach a template except as a substituted placeholder
value.

#### Scenario: No configuration, built-in behavior
- **WHEN** the server starts with no launch configuration file
- **THEN** the query and launch operations run their built-ins and the chooser is
  unavailable

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
validation, nested-zip rejection, zip temp-extraction, and absolutization the launch
endpoint applies. With no chooser configured the endpoint SHALL report the operation
unavailable without running anything. The chooser spans a human decision: the request
SHALL complete when the chooser command does, however long that takes, and the
chooser's lifetime SHALL NOT be tied to the requesting connection — a client that
disconnects or aborts SHALL NOT terminate the chooser, so a dismissed chooser and a
killed one can never read the same. The chooser command completing SHALL read as
success — what the chooser did, a dismissal without a choice included, is not the
server's to judge — and a chooser command that fails or cannot be spawned SHALL be
reported as an error with its reason.

#### Scenario: A configured chooser receives the absolute path
- **WHEN** a chooser is configured and the client requests it for a valid model file
- **THEN** the chooser command runs with the file's absolute path and the endpoint
  reports success when the command completes

#### Scenario: Unconfigured is unavailable, not an error launch
- **WHEN** no chooser is configured and the client requests it
- **THEN** nothing is spawned and the endpoint reports the operation unavailable

#### Scenario: A dropped request does not kill the chooser
- **WHEN** the requesting connection aborts while the chooser is still open
- **THEN** the chooser stays up and the user's eventual pick still launches

#### Scenario: A zip entry reaches the chooser as a real file
- **WHEN** a chooser is configured and the client requests it for `archive.zip!/part.stl`
- **THEN** the entry is temp-extracted as the launch endpoint extracts, and the chooser
  command receives that file's absolute path

