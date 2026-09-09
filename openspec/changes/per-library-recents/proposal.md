## Why

Recents are held under one key per browser profile (`model-browser:recents:v2`), so an
installation repointed between libraries offers the previous library's paths in the path
bar's focus suggestions. The paths look right — they are library-relative, they are the
grammar this library speaks — and they are not there, so choosing one lands on a
not-found. The same argument `framingKey` already made about a repointed installation (the same kit
copied to a second drive, a backup mounted beside the original — `public-deployment` D6)
applies here, and recents were left global when it was made.

## What Changes

- Recents and the recorded last path are keyed by the **library id** the server reports
  (`LibraryState.id`), so each library has its own list and no library reads another's.
- A library that is not `ready` has no key at all: a read answers empty. This follows
  `framingKey`'s null rule rather than inventing a shared bucket for the window before the
  id is known. A landing that beats the library probe — the boot listing races it — is
  held and recorded when the id arrives, so a deep-linked boot directory keeps being
  recorded as it is today.
- Entries under the existing unkeyed keys are abandoned where they stand, not migrated
  into any library — the same call `recents.ts` made when it re-keyed to `:v2`. They
  belong to whichever library was open when they were written and nothing records which.
- Not a breaking change on the wire or the API: this is browser-local storage only.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `directory-browsing`: the *Recent directories* requirement gains the scope rule — the
  persisted list is per library, and one library's recents are never offered while
  another is open. Its two scenarios are kept and a third is added for the repoint.

## Impact

- `client/src/lib/recents.ts` — `getRecents`/`pushRecent` take the library id; the keys
  gain it.
- `client/src/App.tsx` — the `pushRecent` call at the landing reads the id through
  `readLibraryId`, holds a landing that beats the probe, and flushes it on `libraryId`;
  `PathBar` gains the id as a prop.
- `client/src/components/PathBar.tsx` — the two `getRecents()` calls (focus, and the
  empty-input branch of `refreshSuggestions`) pass the prop.
- `client/test/pathBarDebounce.test.tsx` renders `PathBar` directly and so takes the new
  prop.
- Tests that seed the flat key: `client/test/chromeLayers.test.tsx` (seeds
  `model-browser:recents:v2`), and the pre-library-key documentation lines in
  `client/test/libraryState.test.tsx` and `client/test/urlNavigation.test.tsx`.
- No server change, no wire change, no cache change.
