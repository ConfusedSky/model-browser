# entry-actions Delta

## ADDED Requirements

### Requirement: A model entry offers its associated applications as open-in choices
The client SHALL offer, on every surface that hosts a model entry's actions, the
applications the platform associates with the entry's model type, presented as an
inline group of choices — the default application first — rather than as a submenu,
matching the menu's existing inline-group treatment of the orbit axis. Choosing an
application SHALL open the entry's file in that application as a one-shot action: it
completes on its own, loads no model, opens no viewer, and leaves no mode behind.
The group SHALL be reachable and operable from the keyboard with the rest of the menu.

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

#### Scenario: The group is absent where it does not apply
- **WHEN** the user raises the menu on a directory or zip-container entry, or on a
  model entry whose type the client cannot map to any application
- **THEN** the open-in group is not present, rather than present and inert

#### Scenario: A failed launch is reported
- **WHEN** the user chooses an application and the platform's launch command fails
- **THEN** the failure is reported the way other entry actions report theirs, and
  nothing else changes

### Requirement: Open with… opens a model entry in any installed application
The client SHALL offer on model entries an "Open with…" action that presents a chooser
listing every installed application — not only those associated with the entry's type —
with a text filter to narrow the list, operable from the keyboard, and dismissable with
Escape without disturbing what it was raised over. Choosing an application SHALL open
the entry's file in it once: the choice SHALL NOT be remembered, and SHALL NOT change
the platform's default or associations for the type — defaults are configured at the
platform level, not from this chooser.

#### Scenario: A one-off open changes no defaults
- **WHEN** the user opens a model via Open with… in an application that is not the
  type's default
- **THEN** the file opens in that application, and the open-in group on a later menu
  is unchanged — same default, same associations

#### Scenario: The filter narrows the list
- **WHEN** the user types in the chooser's filter
- **THEN** the list shows only applications whose names match, and the keyboard can
  select among what remains

#### Scenario: Escape dismisses only the chooser
- **WHEN** the user presses Escape with the chooser open
- **THEN** the chooser closes and the surface it was raised from is undisturbed

#### Scenario: A failed launch is reported from the chooser
- **WHEN** the chosen application's launch command fails
- **THEN** the failure is reported the way other entry actions report theirs
