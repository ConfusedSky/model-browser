# entry-actions Delta

## ADDED Requirements

### Requirement: Container entries offer their subtree's bulk actions
The client SHALL offer, on a directory or archive entry, an action that generates the
missing and stale thumbnails beneath it, and a distinct action that resets the stored
framings beneath it — each launching the corresponding bulk job (`thumbnail-jobs`)
scoped to that entry's subtree, with the per-model semantics of the existing refresh
and give-up-the-orientation actions applied to each model. Each action SHALL state the
count of entries it would touch. These actions SHALL NOT be offered on model entries,
whose per-model actions remain as they are.

#### Scenario: A kit is warmed from its tile
- **WHEN** the user invokes the generate action on a folder whose models are partly unrendered
- **THEN** a bulk generate job runs over that subtree, and the folder's contact sheet and its models' tiles fill as it proceeds

#### Scenario: A subtree's framings are given up together
- **WHEN** the user invokes the reset action on a folder and confirms its count
- **THEN** every model beneath it with a stored orientation is given up exactly as the per-model action would, and re-rendered
