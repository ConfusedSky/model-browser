# model-thumbnails Delta

## ADDED Requirements

### Requirement: A stored render can be deleted, and a write can be conditional
The server SHALL accept, on the thumbnail write, an explicit instruction to delete an
entry's cached renders — every occlusion variant's pixels and recipe labels — distinct
from omitting the pixels (which keeps them) and from replacing them. The instruction
SHALL be a third state of the pixel field, as the orientation fields already have one,
and the entry's stored orientation SHALL be governed by the same write's orientation
fields, never by the deletion. A deleted render SHALL carry no pixels thereafter, so the
next visit renders it; an entry whose camera the same write did not discard keeps
answering with that camera and no pixels. The write SHALL also accept the generation the
writer last saw: when given and no longer the entry's current generation, the server
SHALL refuse the write without changing anything and SHALL say so distinctly from a
malformed request, so a bulk job can skip an entry the user touched mid-job without a
client-side read-then-write. Every accepted write, a deletion included, SHALL move the
generation as any write does.

#### Scenario: A reset job empties a model's renders
- **WHEN** a write discards a model's camera and deletes its renders
- **THEN** both occlusion variants read as absent, the orientation is discarded exactly as the write's orientation fields say, and the generation has moved

#### Scenario: A stale writer is refused
- **WHEN** a write names a generation the entry has since moved past
- **THEN** nothing is written, the refusal is distinguishable from a malformed request, and the entry's generation is unchanged
