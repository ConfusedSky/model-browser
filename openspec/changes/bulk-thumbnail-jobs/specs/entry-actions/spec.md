# entry-actions Delta

## ADDED Requirements

### Requirement: Container entries offer their subtree's bulk actions
The client SHALL offer, on a directory or archive entry, an action that generates the
missing and stale thumbnails beneath it, and a distinct action that resets the stored
framings beneath it — each launching the corresponding bulk job (`thumbnail-jobs`)
scoped to that entry's subtree: the generate job renders what the existing refresh
action would, and the reset job discards exactly what the existing give-up action
discards and deletes each model's cached renders instead of redrawing them. The
per-model action keeps its redraw in place, under the same name; the two differ only in
what follows the discard. Each action SHALL state the count of entries it would touch
before it runs or as it starts. These actions SHALL NOT be offered on model entries,
whose per-model actions remain as they are.

#### Scenario: A kit is warmed from its tile
- **WHEN** the user invokes the generate action on a folder whose models are partly unrendered
- **THEN** a bulk generate job runs over that subtree, and the folder's contact sheet and its models' tiles fill as it proceeds

#### Scenario: A subtree's framings are given up together
- **WHEN** the user invokes the reset action on a folder and confirms its count
- **THEN** every model beneath it with a stored orientation is given up exactly as the per-model action would and its cached renders are deleted; nothing is rendered until a visit or a generate job
