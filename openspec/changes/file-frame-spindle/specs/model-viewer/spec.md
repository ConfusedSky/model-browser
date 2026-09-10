## MODIFIED Requirements

### Requirement: Upright model display
Models SHALL be displayed in their file's own coordinates: no conversion SHALL be applied to geometry at parse time for any format. A model stands upright because its spindle defaults to its format's up convention — +Z for STL and 3MF, +Y for OBJ — as *Per-model orbit spindle* defines, and that default applies everywhere a model is rendered: thumbnails, orbit overlay, and lightbox.

#### Scenario: STL stands upright
- **WHEN** an STL exported from a slicer (Z-up) is thumbnailed or opened
- **THEN** the model appears standing on its print bed in the default three-quarter view, not lying on its back, with its spindle at +Z

### Requirement: Per-model orbit spindle
Every model SHALL orbit as a clamped turntable around its spindle axis: horizontal drag rotates around the spindle, vertical drag tilts toward/away from it clamped short of the poles, and the camera's up vector is locked to the spindle. The spindle SHALL be one of ±X/±Y/±Z **in the model file's own coordinates**: a model is rendered as its file describes it, with no rotation applied on load, so the spindle a user chooses, the axis a thumbnail stores and the up axis an index reports all name the same direction. The default spindle SHALL be the file format's up convention — +Z for STL and 3MF, +Y for OBJ — and every surface that draws a model with no stored axis SHALL draw it about that default, from one definition. Drag direction SHALL feel consistent across all six spindles (a rightward drag spins the same visual direction). The in-grid orbit overlay and the lightbox SHALL both honor the model's stored spindle, and the axis controls in the lightbox and on a model tile's menu SHALL name the spindle in those same file coordinates.

#### Scenario: Default spindle
- **WHEN** a model with no stored axis is orbited
- **THEN** it turns around its format's up axis — +Z for an STL or 3MF, +Y for an OBJ — and the lightbox's axis control marks that axis

#### Scenario: A print-bed model reads as Z-up
- **WHEN** an STL whose height runs along its file's Z axis is opened with no stored axis
- **THEN** it stands upright, the axis control marks Z, and the axis agrees with what an external tool reports for the file

#### Scenario: Overridden spindle honored everywhere
- **WHEN** a model's axis has been overridden and the user orbits it from the grid overlay
- **THEN** the turntable spins around the overridden spindle, same as in the lightbox
