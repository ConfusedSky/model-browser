# entry-actions Delta

## ADDED Requirements

### Requirement: A model entry offers its associated applications as open-in choices
The client SHALL offer, on every context-menu surface that hosts a model entry's
actions — its menus and the expanded viewer's information panel alike — the
applications the platform associates with the entry's model type, presented as an
inline group of choices — the default application first — rather than as a submenu,
matching the menu's existing inline-group treatment of the orbit axis. What the group
offers SHALL come from a session-held report, refreshed when the platform chooser
completes — never a probe issued when a menu opens — so the menu's contents are known
the moment it is raised. Choosing an application SHALL open the entry's file in that
application as a one-shot action: it completes on its own, loads no model, opens no
viewer, and leaves no mode behind. The group SHALL be reachable and operable from the
keyboard with the rest of the menu.

The group follows from what the entry is: it SHALL be absent on entries that are not
models, and absent when the entry's type maps to no applications — absent rather than
present and inert. Whether an application launch succeeded SHALL be reported the same
way other entry actions report their outcomes, where success means the platform's
launch command succeeded — the client makes no claim about what the launched
application did afterwards.

#### Scenario: The default application leads the group
- **WHEN** the user raises the menu on a model entry whose type has a default
  application and further associated applications
- **THEN** the group lists the default application first, followed by the other
  associated applications

#### Scenario: Choosing an application opens the file and nothing else
- **WHEN** the user chooses an application from the group
- **THEN** the entry's file opens in that application, no mesh is fetched for the
  action's sake, and no expanded view opens

#### Scenario: The expanded viewer offers the launch actions beside the model
- **WHEN** the user opens a model in the expanded viewer and reads its information
  panel
- **THEN** the panel offers that model's open-in choices and, where a chooser is
  configured, the chooser action — the same choices its menu offers, since the
  viewer is where the decision to send a model onward is made

#### Scenario: The group is absent where it does not apply
- **WHEN** the user raises the menu on a directory or zip-container entry, or on a
  model entry whose type the client cannot map to any application
- **THEN** the open-in group is not present, rather than present and inert

#### Scenario: A failed launch is reported
- **WHEN** the user chooses an application and the platform's launch command fails
- **THEN** the failure is reported the way other entry actions report theirs, and
  nothing else changes

### Requirement: Open with… hands a model entry to the platform's configured chooser
The client SHALL offer on model entries an "Open with…" action that invokes the
platform's configured application chooser with the entry's file — the machine's own
chooser, not a list of the client's making — so that opening in an application not
associated with the type, and anything else that chooser can do, happens in the one
chooser the user maintains. The action lives on every surface that hosts the entry's
actions, the expanded viewer's information panel included, and SHALL be offered
exactly when a chooser is configured, and absent otherwise — absent rather than present and inert — with the
open-in group still covering the associated applications. Whether a chooser is
configured is known from the same session-held report the open-in group reads, not
probed when a menu opens. Invoking the action is a
one-shot handoff: what the chooser then does, including changing the platform's
default or associations for the type, is platform behavior, and a menu raised
afterwards SHALL reflect the registry as it then stands. A chooser command that fails
SHALL be reported the way other entry actions report theirs; a chooser the user
dismissed without choosing is not a failure.

#### Scenario: Open with… hands off to the platform chooser
- **WHEN** a chooser is configured and the user invokes Open with… on a model entry
- **THEN** the platform chooser is invoked with the entry's file, and no chooser
  surface of the client's own appears

#### Scenario: Absent when no chooser is configured
- **WHEN** no chooser is configured and the user raises the menu on a model entry
- **THEN** Open with… is not offered, and the open-in group is unaffected

#### Scenario: A default set in the chooser reaches the next menu
- **WHEN** the user, inside the platform chooser, sets a different default for the
  entry's type, and later raises the menu on an entry of that type
- **THEN** the open-in group leads with the new default

#### Scenario: A failed chooser command is reported
- **WHEN** the chooser command fails to run
- **THEN** the failure is reported the way other entry actions report theirs
