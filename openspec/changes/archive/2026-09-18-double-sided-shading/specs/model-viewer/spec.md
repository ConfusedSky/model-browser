## ADDED Requirements

### Requirement: Models shade double-sided
The client SHALL render every parsed model with both triangle sides visible, and SHALL light, occlude, and shadow the side that faces the camera, including when triangle winding points the stored front face away from the viewer. This SHALL apply identically in thumbnails, the orbit overlay, and the lightbox, and SHALL apply to every format the viewer parses. A model whose winding is inward on some or all facets SHALL read as a solid surface rather than a hollow shell showing the interior of the far side. A model whose winding is outward SHALL remain a solid surface. The pixel-recipe version SHALL bump so cached thumbnails re-render.

#### Scenario: An inverted-winding model looks solid
- **WHEN** a model whose triangles wind inward is thumbnailed or opened in the overlay or lightbox
- **THEN** the near surface is shaded and lit as a solid object, not as a hollow shell showing the interior of the far side

#### Scenario: Mixed-winding patches look solid
- **WHEN** a model that is mostly outward-wound but carries inward-wound patches is viewed
- **THEN** those patches shade as part of the near surface rather than punching holes that show the interior

#### Scenario: A well-wound model stays solid
- **WHEN** a model whose triangles wind outward is thumbnailed or viewed
- **THEN** it still reads as a solid surface, grounded by its contact shadow, with no new holes or inverted lighting

#### Scenario: Occlusion follows the visible surface
- **WHEN** an inverted-winding model is viewed with ambient occlusion on
- **THEN** occlusion darkens crevices on the surface the viewer sees, and SHALL NOT fill the silhouette with the far interior's occlusion

#### Scenario: Cached thumbnails refresh
- **WHEN** a model was thumbnailed under the previous recipe and its tile is next displayed
- **THEN** the thumbnail re-renders once under the bumped pixel-recipe version and is cached thereafter

## MODIFIED Requirements

### Requirement: STL shading normals derive from winding
When parsing an STL model, the client SHALL derive shading normals from triangle winding and SHALL NOT use the file's stored facet normals, so an exporter that wrote its normal field in a different axis convention than its vertices — or wrote zero-length, inverted, or otherwise inconsistent normals — cannot corrupt lighting. Recomputed normals SHALL be flat facet normals — no smoothing is introduced — so a file whose stored normals agree with its winding produces the same normal attribute, up to the precision the file itself stored them at. This applies identically to thumbnails, the orbit overlay, and the lightbox; other model formats keep their format-native vertex normals.

#### Scenario: A convention-mismatched STL shades correctly
- **WHEN** a binary STL whose stored facet normals disagree with its triangle winding (e.g. rotated 90° about X by a Z-up/Y-up export mismatch) is thumbnailed or viewed
- **THEN** lighting, self-shadowing detail, and ambient occlusion read against the geometry's true orientation, indistinguishable in character from a well-formed export of the same mesh

#### Scenario: A well-formed STL is unchanged
- **WHEN** an STL whose stored normals agree with its winding is parsed
- **THEN** the derived normals reproduce the stored ones to within the precision they were stored at

#### Scenario: Isolated bad facets in an otherwise healthy file
- **WHEN** a file whose normal field is broadly correct carries a few facets whose stored normals disagree with their winding (an inverted or stale facet normal)
- **THEN** those facets shade from their winding like every other facet, correcting them rather than preserving the file's claim

#### Scenario: Zero-length stored normals
- **WHEN** an STL stores `0 0 0` as a facet's normal, as some exporters do
- **THEN** the facet shades from its winding rather than rendering unlit

#### Scenario: Cached thumbnails refresh to the corrected shading
- **WHEN** a model was thumbnailed under the previous recipe and its tile is next displayed
- **THEN** the thumbnail re-renders once under the bumped pixel-recipe version and is cached thereafter
