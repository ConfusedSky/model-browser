# model-viewer Delta

## ADDED Requirements

### Requirement: Ambient-occlusion shading
Models SHALL be rendered with screen-space ambient occlusion that darkens crevices, recesses, and contact regions, applied identically in the orbit overlay, the lightbox, and thumbnails. The effect SHALL run as a post-process chain on the app's single shared renderer — introducing no additional WebGL context — and the thumbnail path SHALL produce its PNG from the post-processed output, under the color-pipeline parity and transparency that `model-thumbnails` already requires of it. Occlusion parameters SHALL scale with the model's bounds so models of any physical size receive equivalent depth-cueing. Occlusion SHALL affect only model pixels, in coverage as well as in color: silhouette edges over the transparent background SHALL NOT acquire dark halos, background pixels SHALL stay fully transparent, and model-interior pixels SHALL stay fully opaque. The effect is always on in both lighting modes and is not user-toggleable.

#### Scenario: Crevices read at thumbnail size
- **WHEN** a model with recesses or fine surface detail is thumbnailed
- **THEN** its cavities and seams are visibly darkened relative to a flat-shaded render, at both thumbnail and lightbox scale

#### Scenario: Still exactly one WebGL context
- **WHEN** the user orbits tiles while the render queue produces AO thumbnails
- **THEN** at most one WebGL context exists, shared by the post-process chain, the overlay, and the queue

#### Scenario: Handoff stays seamless
- **WHEN** an orbit overlay opens over a tile whose thumbnail was rendered with ambient occlusion
- **THEN** the live view's occlusion and brightness are indistinguishable from the static thumbnail at the moment of handoff

#### Scenario: Clean silhouettes over the transparent background
- **WHEN** a thumbnail PNG rendered with ambient occlusion is composited over the app background
- **THEN** pixels just outside the model's silhouette show no occlusion darkening relative to an occlusion-free render

#### Scenario: Occlusion does not disturb transparency
- **WHEN** a thumbnail PNG rendered with ambient occlusion is inspected pixel by pixel
- **THEN** background pixels are still fully transparent and pixels inside the model are still fully opaque, so the model composites over the app background exactly as an occlusion-free thumbnail does

#### Scenario: Size-independent occlusion
- **WHEN** a very small and a very large model with similar shapes are each rendered
- **THEN** both show equivalent occlusion strength and reach, scaled to their own proportions
