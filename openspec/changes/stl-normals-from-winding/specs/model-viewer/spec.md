# model-viewer Delta

## ADDED Requirements

### Requirement: STL shading normals derive from winding
When parsing an STL model, the client SHALL derive shading normals from triangle winding and SHALL NOT use the file's stored facet normals, so an exporter that wrote its normal field in a different axis convention than its vertices — or wrote zero-length, inverted, or otherwise inconsistent normals — cannot corrupt lighting. Recomputed normals SHALL be flat facet normals — no smoothing is introduced — so a file whose stored normals agree with its winding renders as before, up to the precision the file itself stored them at. This applies identically to thumbnails, the orbit overlay, and the lightbox; other model formats keep their format-native vertex normals.

#### Scenario: A convention-mismatched STL shades correctly
- **WHEN** a binary STL whose stored facet normals disagree with its triangle winding (e.g. rotated 90° about X by a Z-up/Y-up export mismatch) is thumbnailed or viewed
- **THEN** lighting, self-shadowing detail, and ambient occlusion read against the geometry's true orientation, indistinguishable in character from a well-formed export of the same mesh

#### Scenario: A well-formed STL is unchanged
- **WHEN** an STL whose stored normals agree with its winding is parsed
- **THEN** the derived normals reproduce the stored ones to within the precision they were stored at, and the rendered output is unchanged

#### Scenario: Isolated bad facets in an otherwise healthy file
- **WHEN** a file whose normal field is broadly correct carries a few facets whose stored normals disagree with their winding (an inverted or stale facet normal)
- **THEN** those facets shade from their winding like every other facet, correcting them rather than preserving the file's claim

#### Scenario: Zero-length stored normals
- **WHEN** an STL stores `0 0 0` as a facet's normal, as some exporters do
- **THEN** the facet shades from its winding rather than rendering unlit

#### Scenario: Cached thumbnails refresh to the corrected shading
- **WHEN** a model was thumbnailed under the previous recipe and its tile is next displayed
- **THEN** the thumbnail re-renders once under the bumped pixel-recipe version and is cached thereafter
