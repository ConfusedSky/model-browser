# Tasks — flat-folder-view

## 1. Server flat listing

- [x] 1.1 Add optional `truncated?: boolean` to `DirListing` in `shared/types.ts`
- [x] 1.2 Implement `listFlat(vpath)` in `server/src/listing.ts`: top-level `dir`/`zip` entries as-is, then a depth-first walk reusing the per-level listers for models with relative-path `name`s; skip dot-dirs, unreadable subdirs, and nested zip *file* entries (a directory named `*.zip` inside an archive is walked); realpath visited-set so each real directory is entered once — cycle-safe and alias-deduplicating (D3)
- [x] 1.3 Bounding and ordering (D2/D3): one walk-step budget charged per directory entry examined (every dirent and every zip entry, before classification — charging per model kept would leave the `stat` behind each entry unbounded); collect model metadata until it runs out, sort models by basename with the full relative path as tiebreak, return the first cap's worth; set `truncated` when the cap **or** the budget dropped anything. Both limits read env overrides through a validating helper (missing/malformed/non-positive → default) so tests reach them with small fixtures: `MODEL_BROWSER_FLAT_BUDGET` (default 20000) and `MODEL_BROWSER_FLAT_CAP` (default 500). Do NOT pass the combined array through `sortEntries` — its model comparison is `localeCompare` on `name`, which for flat entries is the relative path
- [x] 1.4 Flat rooted inside a zip (D5): immediate **directories** under the prefix as container entries — an archived `*.zip` file is not enterable, so it must not be offered as a tile — every model under the prefix with names relative to the prefix, no further descent; build containers and models from one `listZipEntries` call rather than a filtered `listZipDir` plus a second parse
- [x] 1.5 Wire the `flat` query param in `server/src/app.ts` `GET /api/dir` — enabled only by the literal `flat=true`; absent/`false`/`0`/empty all mean nested (D1)
- [x] 1.6 Server tests (loopback `host` header, fflate zip fixtures, per-test cache dir): top-level dir/zip tiles precede models and deeper dirs emit no tiles; nested models with relative names; basename ordering across folders; zip descent, nested-zip-file skip, `*.zip` directory walked; flat of a zip root and of a zip subdir; symlink cycle terminates; aliased directory listed once; cap sets `truncated` and returns the sorted prefix (small fixture via `MODEL_BROWSER_FLAT_CAP`); model-sparse tree stops at the walk budget with `truncated` (small fixture via `MODEL_BROWSER_FLAT_BUDGET`); unreadable subdir skipped; `flat=false` returns the nested listing

## 2. Client flat view

- [x] 2.1 `ApiClient.listDir(path, { flat })` in `client/src/api/client.ts` (emits `flat=true`) + client test
- [x] 2.2 Flat toggle in `client/src/App.tsx` beside the path bar: state threads through `navigate`, toggling re-fetches the current path, sticky across navigation (D4). `navigate` is a `useCallback` with `[api]` deps — add `flat` to the deps or read it from a ref, or the toggle will fetch with a stale flag
- [x] 2.5 Request-generation guard on every listing fetch, and revert the toggle when its own request fails (D4) — flat walks make listing latency variable, so responses can land out of order
- [x] 2.3 Truncation notice above the grid when `truncated` is set, worded off the returned model count and avoiding "the first N" — never a hardcoded 500, since budget truncation can return fewer and is a prefix of what was scanned, not of the tree (D3/D4)
- [x] 2.4 Confirm no changes needed in `Grid`/viewer (labels ride `entry.name`, paths unchanged) — adjust only if tests say otherwise

## 3. Thumbnail cache lookup off the render queue (D6)

- [x] 3.1 In `client/src/hooks/useThumbnails.ts`, run `api.getThumb` outside `queue.push` under its own concurrency limit; push only the miss/stale tail (`lru.acquire` → `renderThumbnail` → `putThumb`) to the render queue, still gated by `whenResumed()`. The effect's `alive` flag remains the guard for every `setThumb`
- [x] 3.4 The limiter must carry the render queue's cancellation, not just its concurrency (D6): job/cancel shape, cleanup cancels lookups too, `active` incremented synchronously with the slot test, and a hit that resolves after cleanup revokes the object URL `getThumb` minted
- [x] 3.2 Component test: a listing whose thumbnails are all cache hits resolves without being paced by render-queue concurrency, and an orbit-suspended queue still blocks the miss path
- [x] 3.3 Verify against the `model-thumbnails` delta (MODIFIED `Client-side thumbnail rendering`): the queue gates renderer-touching work only, and interaction suspension still blocks the miss path while lookups continue

## 4. Verification

- [x] 4.1 `bun run typecheck` and `bun run test` pass across workspaces
- [x] 4.2 Manual E2E via Playwright MCP: toggle flat on a nested folder — top-level folder tiles appear first, all models follow with basename ordering, relative labels, and thumbnails fill progressively; orbit one, toggle back to nested, browse to its folder and confirm the saved orientation
- [x] 4.3 Manual E2E: flat view of a folder containing a zip shows the zip tile and its models; clicking the zip tile shows the archive flat; clicking a top-level folder tile navigates down still-flat; toggle off restores the nested view
- [x] 4.4 Manual: revisit a fully cached flat folder and confirm tiles paint in one wave rather than two at a time (D6)
