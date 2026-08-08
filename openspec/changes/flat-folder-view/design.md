# Design — flat-folder-view

## Context

`listDir` resolves a virtual path to either a filesystem directory (`listFsDir`) or a zip subtree (`listZipDir`) and returns one level of `DirEntry`s; the client's `useThumbnails` pipeline and viewer operate purely on `DirEntry.path` (virtual path) + `mtime`, and `Grid` renders `entry.name` as the tile label. Thumbnails and camera state are keyed by virtual path server-side, independent of how a listing was produced. `listFsDir` deliberately follows symlinked directories (stat, not dirent), which a recursive walk must make cycle-safe.

## Goals / Non-Goals

**Goals:**
- One request returns the folder's immediate container tiles plus every model under it (through subfolders and zips) as ordinary `DirEntry`s, so the entire existing tile/orbit/thumbnail/navigation machinery works untouched.
- Distinguishable labels for same-named models in different subfolders.
- Bounded work on huge trees, with truncation visible to the user.

**Non-Goals:**
- Flat view *inside* the results of another zip's flat view or any nested-zip descent — nested zips stay rejected by design (D6 of the v1 design).
- Grouping/section headers, search/filtering, or sort options — flat is one grid ordered by file name; refinements are future changes.
- Persisting the toggle across reloads or per-folder — session-sticky UI state only, promotable later if the view proves out.

## Decisions

### D1: `flat` is a query flag on `GET /api/dir`, not a new endpoint

Same path/vpath semantics, same error taxonomy, same guard; the response stays a `DirListing`. `ApiClient.listDir` gains an options argument. A separate endpoint would duplicate vpath resolution and error handling for no isolation benefit.

The flag is pinned to the literal `flat=true`. Any other value — absent, `flat=false`, `flat=0`, `flat=` — yields the ordinary nested listing, so a query string can never enable a recursive walk by accident, and the client emits exactly `flat=true`.

### D2: Flat entries are plain `DirEntry`s with `name` = root-relative path, ordered by file name

A flat listing is the root's immediate `dir`/`zip` entries (exactly as the nested listing reports them — top level only, no recursive folder tiles) followed by `kind: 'model'` entries for every model under the root. Model `path`s are the same virtual paths a nested browse would produce (so thumbnail PNGs and camera state are shared between views); model `name`s are relative to the requested root — `printers/voron/part.stl`, or `kit.zip!/arms/left.stl` for zip contents. `Grid` already renders `name` and routes dir/zip tiles through `onEnter`, so navigation and labels need no client change; `DirEntry`'s shape is untouched, so `useThumbnails`, hover-warm, and the viewer consume flat listings blindly. A zip's tile and its extracted models both appear — the tile is the way down, the models are the flat content; same for folders.

Models are ordered by **file name** (basename), ties broken by the full relative path, so `a/bracket.stl` and `z/bracket.stl` sit next to each other rather than a whole folder away — the point of a flat view is to see the parts, not to re-impose the folder tree the user just flattened.

`listFlat` therefore sorts the two groups itself and concatenates them; the combined array is **not** passed through `sortEntries`, whose model comparison is `localeCompare` on `name` — for flat entries that is the relative path, which is exactly the ordering this decision rejects. The existing rank (dir < zip < model) still describes the result, it just isn't the mechanism.

*Alternative — client-side recursion (N requests):* thundering-herd of `/api/dir` calls, client-side cycle/caps logic, and interleaved partial state; the server walk is one bounded request.

### D3: Walk = existing per-level listers + realpath visited-set + hard budget

`listFlat` walks depth-first alphabetically, reusing the module's per-level logic: filesystem levels via `readdir`+`stat` (skipping dot-entries, as today), zips flattened via `listZipEntries` in one step (zip name lists are already flat — every model entry under the prefix). Nested zip *file entries* are skipped rather than erroring, as a walk has no user to report to; a directory inside an archive whose name merely ends in `.zip` is walked normally, since `vpath.ts` is explicit that a name alone cannot tell the two apart. Unreadable subdirectories are skipped rather than failing the whole walk; only an unreadable *root* is a 404, matching `listDir` today.

Each *directory* is entered at most once, keyed by `realpath`. This terminates symlink cycles, and it also de-duplicates: a directory reachable by several routes contributes its models once, under the first route walked. That is the intended semantic — a flat view is a view of the *files*, and the same file listed under two aliases is noise. The consequence is stated rather than incidental: `/root/b -> /root/a` shows `b` as a top-level tile whose contents do not appear in `/root`'s flat model list (they appear once, under `a/…`); entering `b` flat lists them under `b`'s own root.

*Alternative — ancestor-chain guard instead of a global visited-set:* terminates cycles equally well but lists aliased files once per route, which is the duplication this decision deliberately avoids.

**Bounding.** The 500-model return cap bounds the *response*, not the *work*: a tree of 100k model-free directories never reaches it. The walk therefore also carries a hard budget on **walk steps**, charged once per *directory entry examined* — every fs dirent and every zip entry under the prefix, before it is classified. Charging per model emitted and per directory entered instead would leave the real cost unbounded: the `stat` behind each dirent is the expense, so a folder of a million `.gcode` files would cost one step while issuing a million syscalls, and a folder of 100k symlinks to one target would cost none at all (the visited-set skip returns before charging). One counter rather than separate directory and model limits: every unit of work is an entry examined, so a single number bounds the whole thing. Both the cap and the budget set `truncated: true` on `DirListing` (optional field — nested listings never set it), so the flag means "some models are missing", whichever limit produced it.

The walk root's own level is *not* charged: it is the listing a nested browse would do anyway, so flat mode is bounded relative to the work the request already implies.

Both limits are deliberately test-reachable, following `cache.ts`'s one-var-per-knob pattern: `MODEL_BROWSER_FLAT_BUDGET` (default 20000 steps) and `MODEL_BROWSER_FLAT_CAP` (default 500 models). Without the second, exercising cap truncation would need a 501-model fixture — the same reason the budget needs the first. Both are read through a validating helper rather than bare `Number(process.env.X ?? DEFAULT)`: `Number('20k')` is `NaN`, and `NaN <= 0` and `length > NaN` are both false, so a single typo would silently remove *both* bounds and let one request walk a filesystem into memory. A missing, malformed, or non-positive value falls back to the default.

Ordering by file name (D2) means emission order is not sort order, so truncation cannot be a running cut: the walk collects model metadata until the budget runs out, sorts, then returns the cap's worth. Truncation is therefore defined against the sorted order — as long as the walk completed within budget, the user sees a true alphabetical prefix of the folder's models, not an arbitrary subset. Scanning past the cap is cheap (name, path, size, mtime per model); only the response is capped.

### D4: Toggle lives in App state beside the path bar, sticky within the session

A single `flat` boolean in `App`; `navigate` passes it through, and toggling re-fetches the current path. Flat mode renders the same `Grid` — top-level container tiles first, then models, falling out of the listing order with no Grid changes. A small notice renders when `truncated` is set, worded off the count actually returned ("Showing 173 models; some were omitted") rather than a hardcoded cap: a budget-truncated walk (D3) can return fewer than 500, so the notice must not claim a number the response doesn't carry. It also avoids "the first N" — under budget truncation the returned models are the sorted prefix of what was *scanned*, not of the whole tree. Entering a folder from the path bar (or `↑`) stays in flat mode until toggled off — consistent with "I'm browsing this collection flat right now".

Flat mode makes listing latency *variable* for the first time — a recursive walk takes seconds where a nested listing takes milliseconds — so responses can now land out of order. Every fetch therefore carries a request generation and only the newest may write `path`/`listing`/`truncated`; otherwise an abandoned walk repaints the grid over the listing that replaced it, leaving the path bar and the toggle describing a view that is no longer on screen. The toggle itself flips immediately (so a second click reads as "turn it back off" rather than as a second request for flat), but a *failed* flat request reverts it: leaving the button lit over an unchanged nested grid would also silently send `flat=true` on every later navigation.

### D5: A root inside a zip is flat too

Flat mode is sticky (D4) and top-level zip tiles stay navigable, so clicking a zip tile in flat view issues `flat=true` against `kit.zip` — and then against `kit.zip!/sub`. This is a normal path, not an edge case, so it gets defined rather than special-cased: the archive's immediate directories under the prefix are the container tiles, every model under the prefix is listed with `name` relative to that prefix, and there is no further descent (nested zips remain rejected).

"Immediate **directories**" is load-bearing: `listZipDir` reports an archived `*.zip` file as a `kind: 'zip'` entry because at the filesystem level zips *are* enterable, but inside an archive that entry is exactly what the nested-zip rule rejects. Reusing the nested listing's "everything that isn't a model" filter here would put a tile on screen that 400s when clicked. So the zip-rooted branches build their containers from the directory names in the entry list, not from a filtered `listZipDir` — which also means one `listZipEntries` call serves both the containers and the models, instead of parsing the central directory twice per request.

### D6: Cache lookups leave the render queue

`useThumbnails` wraps each tile's entire job in `queue.push` — including the `api.getThumb` cache lookup, which is pure I/O and touches no renderer. The render queue exists to serialize work against the single shared `WebGLRenderer` (`model-viewer`), so a cache *hit* occupying one of its two slots for a full HTTP round trip is accidental coupling, not policy. Nested directories are small enough to hide it; a 500-tile flat view is not.

The lookup moves out under its own concurrency limit, and only the miss/stale tail — `lru.acquire` → `renderThumbnail` → `putThumb` — is pushed to the queue, still behind `whenResumed()`. The single-renderer and orbit-suspension invariants are unchanged; what changes is that a fully cached view is no longer paced by renderer concurrency.

The queue was also the *cancellation* mechanism, so the limiter has to carry that too — it takes the same job/cancel shape as `RenderQueue`, and the effect's cleanup cancels lookups as well as render jobs. The `alive` flag is not a substitute: it guards the `setThumb` *write*, not the *request*. Without a cancel handle a superseded listing's 500 queued lookups would still run, and because the limiter is deliberately shared with the successor listing they would head-of-line block the very tiles this decision exists to speed up. Two consequences follow and are handled explicitly: a lookup that resolves after cleanup must revoke the object URL `getThumb` minted for it (nothing else will), and the limiter must increment its active count synchronously with the slot test, or a caller arriving mid-drain claims a slot a woken job already owns and the ceiling drifts upward with every navigation.

This is a fix to a pre-existing property rather than something flat view introduces, but flat view is what makes it matter, and the change is small and local.

## Risks / Trade-offs

- [Huge trees make one slow request] → hard walk-step budget + 500-model return cap + skip-on-error keeps the walk bounded whether or not the tree contains models; truncation is explicit, never silent.
- [500 fresh thumbnails hammer the render queue on first flat view] → unavoidable for genuinely uncached models, and the existing limited-concurrency queue and orbit-suspension already govern it; tiles fill progressively. The *cached* case is the one that was needlessly slow, and D6 fixes it.
- [Relative-path labels can be long] → tile labels already truncate with ellipsis; the full name remains in `alt`/hover.
- [A file reachable by two symlinked routes is listed once, under the first route walked] → intended (D3), but it means a flat listing is not always the union of what nested browsing shows under the same root: a symlinked sibling folder's models are absent from the parent's flat list even though the nested view shows them under both names. Accepted — the alternative is duplicate tiles for one file.
- [Scanning past the return cap to sort by file name] → bounded by the walk budget, and only metadata is collected; the cost is proportional to the tree already being read, not to the models returned.

## Open Questions

None.
