## Context

`ViewerLayer` builds a `ViewerSession` from `Promise.all([lru.acquire(path), savedPromise])`. When `acquire` rejects — the server 404s a deleted file, 422s a bad zip entry, or the parser throws — the catch handler just calls `onDismiss()`: spinner, then silently back to the (cached, now-stale) thumbnail. The saved-camera fetch already swallows its own errors separately, so the only rejection reaching that catch is a mesh-load failure. The grid's `ThumbState` already has an `'error'` status with broken-tile rendering, but nothing sets it from this path; `MeshLru.warm` intentionally swallows errors ("the real use surfaces them" — which it currently doesn't).

## Goals / Non-Goals

**Goals:**
- A mesh-load failure in the orbit overlay or lightbox is visibly reported where the user is looking, with the server's reason.
- The grid tile flips to its existing error rendering so the stale thumbnail stops advertising a live model.
- An errored viewer never persists camera/axis/thumbnail state.

**Non-Goals:**
- Detecting deletion proactively (polling, fs-watching) — the error surfaces on interaction only.
- Removing the dead entry from the server cache (the existence sweep already owns that).
- Retry affordances; dismissing and re-clicking is retry enough for a local-files app.

## Decisions

### D1: Error state lives in ViewerLayer, not the session
The failure happens before a `ViewerSession` exists, so `ViewerLayer` replaces its `session: ViewerSession | null` spinner-vs-ready dichotomy with a third state: `error: string | null` (the `HttpError`/`Error` message). No session API changes. Alternative — a sentinel "errored session" object — rejected: it would need stub orbit/zoom/settle behavior for no benefit.

### D2: Same surface, error panel instead of dismissal
Both modes render the message in place of the canvas: the orbit overlay shows a compact "⚠ file missing" line in the tile box (it is small); the lightbox shows the file name, the server message, and keeps its ✕/Esc/outside-click close paths. Dismissal semantics are unchanged from today's non-error flows — the overlay still dies on pointer-leave/scroll, the lightbox on explicit close — except that close skips settle/persist when there is no session. Alternative — auto-dismiss the overlay after a toast — rejected: a transient toast is exactly the "explicit error" complaint restated.

### D3: Tile marked errored via the existing ThumbState
`ViewerLayer` gets an `onLoadError(message)` callback; `App` implements it as `setThumb(path, { status: 'error' })`, reusing the grid's broken-tile rendering. The cached PNG url is dropped with it — the tile visibly changes from "healthy model" to "broken", which is the point. Alternative — keep showing the stale PNG with an overlay badge — rejected as scope creep on Grid; the error tile already exists.

### D4: Pointer/focus edge cases follow the no-session paths
`closeLightbox` and the pointer-up settle already guard on `session !== null`; the error state keeps `session` null so those guards are the implementation. Promote (orbit→lightbox on click) stays allowed while errored: clicking an errored overlay opens the lightbox showing the full message — the overlay line is small, the lightbox is where the reason is readable.

## Risks / Trade-offs

- [Transient failures (server restart mid-fetch) mark the tile errored] → acceptable: re-entering the directory re-runs the thumbnail pipeline, which resets the tile; the error state is per-render, not persisted.
- [Zip-entry errors surface the zip's message (e.g. "no such entry"), which may read technically] → pass the server message through verbatim; it is already user-worded ("no such file: …") for the common deletion case.
- [Marking the tile errored drops a valid cached thumbnail on a transient failure] → navigation refresh restores it from the server cache; nothing server-side is deleted.

## Migration Plan

None — client-only rendering change, no data or API surface touched.

## Open Questions

- None blocking.
