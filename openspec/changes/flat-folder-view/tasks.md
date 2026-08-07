# Tasks — flat-folder-view

## 1. Server flat listing

- [ ] 1.1 Add optional `truncated?: boolean` to `DirListing` in `shared/types.ts`
- [ ] 1.2 Implement `listFlat(vpath)` in `server/src/listing.ts`: depth-first alphabetical walk reusing the per-level listers; models only; relative-path `name`s; skip dot-dirs, unreadable subdirs, and nested zips; realpath visited-set for cycle safety; 500-model cap with `truncated` flag (design D3)
- [ ] 1.3 Wire `flat` query param in `server/src/app.ts` `GET /api/dir` (D1)
- [ ] 1.4 Server tests (loopback `host` header, fflate zip fixtures, per-test cache dir): nested models with relative names, zip descent + nested-zip skip, symlink cycle terminates, cap sets `truncated`, unreadable subdir skipped, flat of a zip vpath root

## 2. Client flat view

- [ ] 2.1 `ApiClient.listDir(path, { flat })` in `client/src/api/client.ts` + client test
- [ ] 2.2 Flat toggle in `client/src/App.tsx` beside the path bar: state threads through `navigate`, toggling re-fetches the current path, sticky across navigation (D4)
- [ ] 2.3 Truncation notice above the grid when `truncated` is set
- [ ] 2.4 Confirm no changes needed in `Grid`/`useThumbnails`/viewer (labels ride `entry.name`, paths unchanged) — adjust only if tests say otherwise

## 3. Verification

- [ ] 3.1 `bun run typecheck` and `bun run test` pass across workspaces
- [ ] 3.2 Manual E2E via Playwright MCP: toggle flat on a nested folder — all models appear with relative labels and thumbnails fill progressively; orbit one, toggle back to nested, browse to its folder and confirm the saved orientation
- [ ] 3.3 Manual E2E: flat view of a folder containing a zip shows the zip's models; navigation while flat stays flat; toggle off restores folder tiles
