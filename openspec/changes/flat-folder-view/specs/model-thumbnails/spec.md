# model-thumbnails Delta

## MODIFIED Requirements

### Requirement: Client-side thumbnail rendering
The client SHALL render a static PNG thumbnail for each model file (STL, 3MF, OBJ — plain or zip entry) using the same three.js scene setup (loaders, materials, lighting) AND the same output color pipeline (color-space encoding, tone mapping) as the live viewer, so a thumbnail is pixel-comparable with a live frame of the same camera — offscreen render-target output SHALL NOT differ in brightness or color from the visible canvas. Rendering SHALL go through a limited-concurrency queue using the app's single shared WebGL renderer (see `model-viewer`), suspending while an orbit overlay or lightbox is active. The queue SHALL gate only work that touches the shared renderer — mesh load, parse, render, and upload of the result; looking up an already-cached thumbnail SHALL NOT occupy the queue, and SHALL run under its own concurrency limit, so a directory whose thumbnails are all cached fills at the speed of the cache rather than at the speed of renderer concurrency. Mesh geometry SHALL be disposed after snapshot — freeing its GPU buffers, not merely dropping the reference — unless retained by the mesh LRU. Thumbnails SHALL be 512×512 PNGs with a transparent background, independent of tile size and device pixel ratio.

#### Scenario: Fresh directory fills in progressively
- **WHEN** the user opens a directory containing model files with no cached thumbnails
- **THEN** tiles appear immediately as placeholders and thumbnails pop in as the render queue completes each file

#### Scenario: Thumbnail matches live view color
- **WHEN** a freshly rendered thumbnail is compared with the live view of the same model at the same camera
- **THEN** brightness and color are visually indistinguishable

#### Scenario: Unparseable model file
- **WHEN** a model file fails to load or parse
- **THEN** its tile shows an error/broken state and the queue continues with remaining files

#### Scenario: Fully cached directory is not paced by render concurrency
- **WHEN** the user opens a directory of many models whose thumbnails are all cached
- **THEN** the cached thumbnails are fetched concurrently under their own limit and none of them waits on a render-queue slot

#### Scenario: Interaction still suspends rendering, not lookups
- **WHEN** an orbit overlay or lightbox is active while a directory's thumbnails are still resolving
- **THEN** cache lookups continue, while any model that needs loading, parsing, or rendering waits until the interaction ends
