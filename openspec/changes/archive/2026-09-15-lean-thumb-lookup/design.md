## Context

`thumbnail-image-serving` split the pixels onto their own route so a tile could reference
a render by URL and let the browser cache it. It left the JSON lookup alone, deliberately
— "The lookup route SHALL be unchanged" — because the lookup was then the only way to
learn an entry's *labels*, and the tiles that needed labels needed pixels too.

`listing-tree-cache` and `thumbnail-image-serving` D2/D3 have since moved the tile's
common case out of the lookup entirely: an annotated listing draws from the image URL and
never asks. What is left asking are the callers that want facts, not pictures.

## Decisions

### D1: A parameter on the lookup, not a second route

A `pixels=off` parameter rather than a `/api/thumb/meta`. The key is already parsed once
for two routes (`thumbKeyOf`), and the cache tiers are applied once for two routes
(`thumbHitTiers`); a third route would be a third place for those to drift. The parameter
is read exactly as `ao` is — `on`/`off`/absent, unknown is a 400 — so the route has one
grammar rather than two.

`off` being a distinct URL is what makes it safe: a validator or an `immutable` answer is
per-URL in every cache that exists between the client and the server, so a pixel-less
body cannot be served to a caller that asked for pixels. The `ETag` stays the entry's
generation, which is correct for the same reason — it distinguishes *versions* of one
URL's answer, never two URLs' answers.

### D2: The file is still read

The first implementation `stat`ed the render instead of reading it, to save the I/O too.
It is the wrong trade: `stat` and `readFile` disagree — a mode-000 file, or a directory at
the render's path, answers one and throws on the other — so the lean lookup could report a
hit for pixels the reading lookup cannot get, and a bulk job would then skip the entry as
current forever. One verdict for both callers is worth a page-cache read. The render is
dropped from the *answer*, in `ThumbCache.get`, after `read` has decided what it is.

### D3: The client mints nothing under the flag

`HttpApiClient.getThumb` guards the object URL on `pixels`, not only on the body. The
server omits the render under `off`, so the guard covers only what that cannot: an older
server, or a cache that answers the lean URL with a full body. Without it the leak this
change closes would come back through a deployment mismatch rather than through the code,
which is the kind of leak nobody finds.

### D4: The staleness gate is the status, not the pixels

`renderEntryThumbnail` gated "already current" on `pngUrl !== undefined`. That was never a
second fact: the cache answers `hit` only after the read succeeded, so a hit always
carried pixels and `isCurrentRender` already requires `state === "hit"`. The gate is
dropped rather than rewritten against the new shape.
