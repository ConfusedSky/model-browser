## ADDED Requirements

### Requirement: STL viewer meshes served as cached GLB
An STL model's geometry SHALL be delivered to the viewer as an indexed binary GLB derived from the source STL, not as the raw STL bytes. The server SHALL convert on demand and cache the result per library, keyed by the model's library path and mtime, using the same staleness contract as thumbnails: a cached GLB SHALL be served only when its stored mtime matches the source file's current mtime, otherwise it SHALL be regenerated. On a cache miss the server SHALL convert the STL and return the GLB in the same response; the whole STL SHALL NOT be streamed to the browser for viewing.

The source STL file SHALL remain untouched on disk and SHALL stay the file that the search index, the directory listing, `MODEL_EXT`, and slicer/app association all operate on — the GLB SHALL exist only on the delivery path from server to viewer, never as a listed entry, an openable file, or a stored sibling of the model. This delivery SHALL apply to the STL format only; `obj` and `3mf` SHALL continue to be delivered and parsed as their own bytes.

The GLB's vertex coordinates SHALL be byte-identical to the source STL's, so the model displays in its file's own coordinates exactly as before (see *Upright model display*): conversion indexes and welds vertices but SHALL NOT move, rotate, or rescale them.

When conversion fails because the source cannot be read or parsed, the delivery SHALL surface as a model-load failure the viewer already handles (see *Missing-model error feedback*), not as a silent empty result.

#### Scenario: STL delivered as GLB, source untouched
- **WHEN** an STL model is opened in the orbit overlay or lightbox
- **THEN** the viewer downloads an indexed GLB derived from that STL, the source `.stl` file on disk is unchanged, and it is still the entry the listing shows and the slicer opens

#### Scenario: Miss converts, hit is served from cache
- **WHEN** a model's GLB is requested and no fresh cached GLB exists
- **THEN** the server converts the STL and returns the GLB in that response, and a subsequent request for the same unchanged file is served the cached GLB without reconverting

#### Scenario: Edited source invalidates the cached GLB
- **WHEN** the source STL is modified so its mtime changes and its GLB is requested again
- **THEN** the previously cached GLB is not served and the GLB is regenerated from the new bytes

#### Scenario: Whole STL is never sent for viewing
- **WHEN** the viewer loads an STL model, whether the GLB is a hit or a miss
- **THEN** the browser receives GLB bytes, never the raw STL file

#### Scenario: Other formats are unaffected
- **WHEN** an `obj` or `3mf` model is opened
- **THEN** it is delivered and parsed as its own format's bytes, with no GLB conversion

#### Scenario: Coordinates preserved through conversion
- **WHEN** an STL and its derived GLB are compared vertex for vertex
- **THEN** the GLB's positions equal the STL's, so the model stands upright and its spindle axis names the same direction in both

#### Scenario: Unreadable source surfaces as a load error
- **WHEN** the GLB for a model whose source file no longer exists or cannot be parsed is requested
- **THEN** the viewer shows its normal missing-model error rather than an empty or silently missing mesh

## MODIFIED Requirements

### Requirement: STL shading normals derive from winding
The shading normals for an STL model SHALL be derived from triangle winding and SHALL NOT use the file's stored facet normals, so an exporter that wrote its normal field in a different axis convention than its vertices — or wrote zero-length, inverted, or otherwise inconsistent normals — cannot corrupt lighting. This derivation MAY occur during the server-side GLB bake (see *STL viewer meshes served as cached GLB*) rather than in the client, but the guarantee SHALL hold end to end regardless of where it runs. Recomputed normals SHALL be flat facet normals — no smoothing is introduced, and vertices SHALL be welded only where both position and winding-derived normal are identical, so no shared normal is averaged across a facet edge — so a file whose stored normals agree with its winding renders as before, up to the precision the file itself stored them at, and the rendered pixels SHALL be unchanged from parsing the STL directly on the client. This applies identically to thumbnails, the orbit overlay, and the lightbox; other model formats keep their format-native vertex normals.

#### Scenario: A convention-mismatched STL shades correctly
- **WHEN** a binary STL whose stored facet normals disagree with its triangle winding (e.g. rotated 90° about X by a Z-up/Y-up export mismatch) is thumbnailed or viewed
- **THEN** lighting, self-shadowing detail, and ambient occlusion read against the geometry's true orientation, indistinguishable in character from a well-formed export of the same mesh

#### Scenario: A well-formed STL is unchanged
- **WHEN** an STL whose stored normals agree with its winding is delivered to the viewer as GLB
- **THEN** the derived normals reproduce the stored ones to within the precision they were stored at, and the rendered output is identical to parsing the STL directly on the client

#### Scenario: Isolated bad facets in an otherwise healthy file
- **WHEN** a file whose normal field is broadly correct carries a few facets whose stored normals disagree with their winding (an inverted or stale facet normal)
- **THEN** those facets shade from their winding like every other facet, correcting them rather than preserving the file's claim

#### Scenario: Zero-length stored normals
- **WHEN** an STL stores `0 0 0` as a facet's normal, as some exporters do
- **THEN** the facet shades from its winding rather than rendering unlit

#### Scenario: Welding preserves faceted shading
- **WHEN** an STL with large flat faces spanning many coplanar triangles is delivered as an indexed GLB
- **THEN** the flat faces read flat, hard edges stay hard, and no facet edge is softened by an averaged normal, exactly as the unindexed client parse rendered them

#### Scenario: Cached thumbnails are not disturbed
- **WHEN** a model already thumbnailed under the current pixel recipe is displayed after this change ships
- **THEN** its thumbnail is a cache hit and is not re-rendered, because the delivered GLB produces the same pixels as the previous STL parse

#### Scenario: Cached thumbnails refresh to the corrected shading
- **WHEN** a model was thumbnailed under the previous recipe and its tile is next displayed
- **THEN** the thumbnail re-renders once under the bumped pixel-recipe version and is cached thereafter
