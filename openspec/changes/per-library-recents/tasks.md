## 0. Ordering

- [ ] 0.1 This change and `hover-prefetch-listings` both edit the fetch-layer effect's `land` in `App.tsx`, and this one changes `pushRecent`'s signature at that call. Land this change **first**; if `hover-prefetch-listings` lands first, its "`pushRecent` … unchanged because the landing is the same call with the same arguments" line in its design and its warm-does-not-record assertion (its task 4.4) both have to be re-read against the new signature before this one is applied.

## 1. The store

- [ ] 1.1 `client/src/lib/recents.ts`: key both entries by library id — `getRecents(libraryId: string | null)` returns `[]` for `null`, `pushRecent(libraryId: string | null, path: string)` drops the write for `null` (D1/D2). Keys become `model-browser:recents:v2:<id>` and `model-browser:last-path:v2:<id>`.
- [ ] 1.2 Wrap `pushRecent`'s `setItem` calls so a refused store drops the record instead of throwing into the landing — where, under `.then(land, fail)`, a throw dispatches neither a landing nor a failure and strands the request (D5).
- [ ] 1.3 Update the module header: what the id is doing in the key, that the unkeyed keys are dead and are neither migrated nor swept and why (D3), and keep the existing `:v2` note.

## 2. The call sites

- [ ] 2.1 `client/src/App.tsx`: in the landing (`land`, in the fetch-layer effect), read the id through **`readLibraryId()`**, not the `libraryId` state — that effect's deps are `[requestId]` alone with `exhaustive-deps` disabled, so a closure over the state is stale and lint will not say so. This is the mechanism `withLocalFramings` is already given.
- [ ] 2.2 `client/src/App.tsx`: when `readLibraryId()` answers `null`, hold the path in a one-slot ref and flush it with `pushRecent` from an effect on `libraryId` — the framing overlay's "fire when the last of the two arrives" shape (D2). A flush with no id does nothing and keeps holding; the slot is overwritten, never queued.
- [ ] 2.3 `client/src/components/PathBar.tsx`: add a **required** `libraryId: string | null` prop (D4 — the type system stating the dependency is the point) and pass it to both `getRecents` calls: `onFocus` and `refreshSuggestions`' empty-input branch.
- [ ] 2.4 `client/src/App.tsx`: pass `libraryId` where `PathBar` is rendered.

## 3. Tests

- [ ] 3.1 `client/test/pathBarDebounce.test.tsx` renders `PathBar` directly — give it the new prop, or `bun run typecheck` fails (the client tsconfig includes `test`).
- [ ] 3.2 `client/test/chromeLayers.test.tsx`: the suggestion-layer cell seeds `model-browser:recents:v2` — re-key its seed to the harness library's id (`model-browser:recents:v2:test`, the `library` mock answering `id: 'test'`) so it still opens a list.
- [ ] 3.3 New coverage: a list stored under one library id is not offered while another id is the ready library, and a landing under the second id records into the second key only.
- [ ] 3.4 New coverage: a landing that arrives before `/api/library` answers is recorded once the id lands, under that id's key — the D2 flush. Drive it by holding the `library` mock unresolved past the listing.
- [ ] 3.5 New coverage: with the library never becoming `ready`, focusing the bar offers nothing and no key is written.
- [ ] 3.6 New coverage for 1.2: a `setItem` that throws leaves `pushRecent` silent and the caller unharmed.
- [ ] 3.7 Falsify 3.3–3.6 against the pre-change store (restore the flat key, drop the flush, unwrap the write) and confirm each fails before checking it off — a green cell here may only mean the seed never reached the read.

## 4. Verification

- [ ] 4.1 `cd client && bunx vitest run` and `bun run typecheck` clean.
- [ ] 4.2 Manually: browse two directories, point the server at a second library (`MODEL_BROWSER_ROOT`, restart), **reload the tab** — nothing re-probes a library that is already `ready`, so without the reload the tab keeps the first library's id (D6) and the check proves nothing. Then focus the path bar: the first library's paths are absent and the new library's accumulate; repoint back, reload, and the originals return.
- [ ] 4.3 Manually: deep-link straight into a subdirectory on a cold load (`/?path=…`) and confirm it is in the recents list afterwards — the D2 flush, in the browser where the race is real rather than mocked.
