## ADDED Requirements

### Requirement: STL viewer meshes served as cached GLB
An STL model's geometry SHALL be delivered to the viewer as an indexed binary GLB derived from the source STL, not as the raw STL bytes. The server SHALL convert on demand and cache the result per library, keyed by the model's library path, stale when the source's mtime changes — the same staleness contract as thumbnails: a cached GLB SHALL be served only while its recorded mtime matches the source's current mtime, otherwise it SHALL be regenerated. On a cache miss the server SHALL convert the STL and return the GLB in the same response; the whole STL SHALL NOT be streamed to the browser for viewing. This SHALL hold for an STL inside a zip archive as for a plain file, with the archive's mtime standing for the entry's.

The GLB SHALL carry vertex positions and triangle indices only, and SHALL NOT carry normals: shading normals stay derived on the client from winding (see *STL shading normals derive from winding*). Vertex coordinates SHALL be bit-identical to the source STL's and triangles SHALL keep the source's order and winding, so the geometry the client shades from is the same it would have parsed from the STL, and the model displays in its file's own coordinates exactly as before (see *Upright model display*): conversion welds vertices with identical coordinates but SHALL NOT move, rotate, or rescale them.

The source STL file SHALL remain untouched on disk and SHALL stay the file that the search index, the directory listing, `MODEL_EXT`, and slicer/app association all operate on — the GLB SHALL exist only on the delivery path from server to viewer, never as a listed entry, an openable file, or a stored sibling of the model. This delivery SHALL apply to the STL format only; `obj` and `3mf` SHALL continue to be delivered and parsed as their own bytes.

When the source cannot be read, the delivery SHALL answer as `/api/file` does for a missing model; when it exists but cannot be parsed as STL, the delivery SHALL answer with an error status. Either way the viewer SHALL show the model-load failure it already renders (see *Missing-model error feedback*), not a silent empty result. A cache directory that cannot be written SHALL NOT fail the request: the server SHALL convert and serve without persisting.

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

#### Scenario: STL inside a zip is delivered as GLB
- **WHEN** an STL entry of a zip archive is opened in the viewer
- **THEN** it is delivered as a GLB derived from the extracted entry, cached under the entry's virtual path, and a later open of the unchanged archive is served from the cache without opening the zip

#### Scenario: Other formats are unaffected
- **WHEN** an `obj` or `3mf` model is opened
- **THEN** it is delivered and parsed as its own format's bytes, with no GLB conversion

#### Scenario: Coordinates and winding preserved through conversion
- **WHEN** an STL and its derived GLB are compared triangle for triangle
- **THEN** every GLB vertex position is bit-identical to the STL's, the triangles come in the same order with the same winding, the GLB carries no normals, and the client's recomputed normals equal those it computes from the STL directly

#### Scenario: Unreadable source surfaces as a load error
- **WHEN** the GLB for a model whose source file no longer exists, or cannot be parsed as STL, is requested
- **THEN** the viewer shows its normal missing-model error rather than an empty or silently missing mesh

#### Scenario: Read-only cache still serves
- **WHEN** the cache directory cannot be written and a GLB is requested on a miss
- **THEN** the server converts and returns the GLB without persisting it, and the request does not fail

#### Scenario: Cached thumbnails are not disturbed
- **WHEN** a model already thumbnailed under the current pixel recipe is displayed after this change ships
- **THEN** its thumbnail is a cache hit and is not re-rendered, because the client shades the delivered GLB from the same vertices as it shaded the STL
