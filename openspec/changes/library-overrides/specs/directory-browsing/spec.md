# directory-browsing Delta

> ADDED only. `search-cancellation` ADDs *Concurrent and abandoned listing
> work* to this capability while active — no title overlap. Display names are
> display-only by decision (`web-demo-backlog` 2.3, 2026-08-31): matching is
> deliberately untouched, and the requirement says so.

## ADDED Requirements

### Requirement: Entries display their stored name
A listing entry whose exact library path holds a display name in the library's
override store SHALL carry that name, attached at listing emission from the
loaded store — an exact-key lookup, never the prefix resolution, so a kit's
name labels the kit's own tile and nothing beneath it. Tiles SHALL render the
display name in place of the file-derived label wherever one is carried, in
each listing shape the seam covers — a browse, a flat or deep-search listing,
and a folder tile's preview entries alike; semantic and similarity answers are
deliberately outside it (design D7: hits are models, generated names are
kit-level) — while the entry's real name SHALL remain in the
tile's own title and accessible name, and SHALL remain what find, deep search
and the flat filter match: display names are display only. A folder tile's
preview cell is the one exception by construction: it has no visible label, so
its title IS its label surface and SHALL carry the display name where one is
stored (falling back to the entry's real name, unchanged) — the enclosing
tile's title still carries the real name. An entry with no stored
name SHALL be labelled exactly as before, and a library with no store SHALL
list and label identically to today.

#### Scenario: A kit tile shows its title
- **WHEN** the store holds a name for a directory and its tile is listed
- **THEN** the tile's label is the stored name, and its title still carries the directory's real name

#### Scenario: A kit's models keep their own names
- **WHEN** the store holds a name for `/kit` and none for `/kit/x.stl`
- **THEN** `/kit/x.stl`'s tile is labelled from its file name, not the kit's stored name

#### Scenario: Matching is untouched
- **WHEN** a directory's stored name and real name differ and the user types a fragment of each into find
- **THEN** the real-name fragment matches the tile and the stored-name fragment does not

#### Scenario: No store, no change
- **WHEN** a library carries no override store
- **THEN** every listing and label is byte-identical to what it was before this capability existed
