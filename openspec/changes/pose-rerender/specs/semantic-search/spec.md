## ADDED Requirements

### Requirement: The index becoming ready reaches a landed listing
A listing on screen when the index becomes ready SHALL have its poses asked for once, exactly as a listing landed under a ready index is, so that un-posed renders on screen re-render posed without the user navigating away and back; the same SHALL hold for the previews a listing's folder tiles show. The client SHALL notice the index becoming ready without a navigation: while the index reports itself warming, availability is re-read every few seconds as today; while it reports itself absent, availability SHALL be re-read at a slow cadence — on the order of the server's own absent memo — so an index started after the page landed is seen within that interval, at the cost of one cheap read per interval and nothing while the index is ready. A re-read that reports the same state SHALL ask nothing and render nothing.

#### Scenario: The index comes up under a listing
- **WHEN** a directory is listed while the index is absent or warming, and the index becomes ready with the listing still on screen
- **THEN** the listing's poses are asked for once, and each unowned model whose render was drawn without a pose re-renders posed, keeping its image until the replacement lands

#### Scenario: An absent index started later is noticed
- **WHEN** the index is absent when the page lands and is started afterwards, and the user neither navigates nor reloads
- **THEN** within the slow re-read interval the client reads it ready and the listing's poses are asked for

#### Scenario: A same-state re-read is inert
- **WHEN** a re-read of availability reports the state already held
- **THEN** no poses are asked for and no tile re-renders

#### Scenario: Away and back still works
- **WHEN** the user navigates away and back after the index became ready
- **THEN** the new landing's own wave asks for poses as it always has, and the tiles that already re-rendered are hits
