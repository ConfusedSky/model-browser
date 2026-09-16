## ADDED Requirements

### Requirement: The maintenance sweep survives a file that is not an entry
The existence-and-cap sweep over a library's cache directory SHALL treat a JSON file
whose content carries no string path as a stranger, not an entry: it SHALL be left in
place, reported once by name, and excluded from the existence test and the size cap,
and the sweep SHALL go on to every remaining entry. The sweep SHALL NOT resolve an
absent path through the library, since that fails with an error no caller observes and
leaves every entry listed after the stranger unremembered for as long as the process
runs.

#### Scenario: A stranger between two entries
- **WHEN** the library's cache directory holds an entry, then a JSON file with no path, then another entry, and the sweep runs
- **THEN** both entries are known to the listing annotation afterwards, the file is still on disk, and the sweep reported it once

#### Scenario: A stranger under the pre-library directory
- **WHEN** a JSON file with no path lies in the flat, pre-library cache directory
- **THEN** it is removed by that directory's own sweep, as any entry naming no file is
