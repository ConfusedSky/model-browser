## 1. ViewerLayer Error State

- [x] 1.1 Replace the silent `onDismiss()` in the session-load catch with an `error: string | null` state (message from the thrown `HttpError`/`Error`); keep the spinner only while loading with no error
- [x] 1.2 Render the error: compact indicator in orbit mode, file name + reason panel in lightbox mode; close paths unchanged and settle/persist skipped when `session === null` (verify existing guards cover it)
- [x] 1.3 Keep promote working on an errored overlay (click opens the errored lightbox)

## 2. Grid Tile Marking

- [x] 2.1 Add an `onLoadError` callback prop to ViewerLayer; App implements it as `setThumb(path, { status: 'error' })`

## 3. Verification

- [x] 3.1 Client tests: load-failure renders the error (both modes), close from errored lightbox does not call persist, promote from errored overlay works, App marks the tile errored
- [x] 3.2 Manual pass: delete a model file after its thumbnail is cached, then orbit and click it — explicit error in overlay and lightbox, tile flips to error state, re-entering the directory recovers a restored file
