# Tasks — link-previews-and-credit-focus

> **Ordering and collisions (checked 2026-09-18 against every active change's deltas).**
> This change ADDs one requirement to `public-deployment` and one to `model-viewer`, and
> MODIFIES one in `directory-browsing` (*Arrow-key focus movement across the grid*, §8),
> which no other active change carries a delta against. `entry-stat-revalidation` also carries a `public-deployment` delta, but
> it ADDs *The environment overrides single keys*; `adaptive-ao-default` carries a
> `model-viewer` delta, ADDing *Occlusion defaults by measurement*. No title is shared, so
> neither collides at archive. **Shared files:** `client/about.html` and
> `client/src/App.tsx`'s header are `landing-page`'s (D2) — land §4 after `landing-page`
> archives, or re-read `client/about.html` immediately before editing it, since the edit
> here is two invariant `<meta>` lines and nothing else. `server/src/static.ts` and
> `server/test/static.test.ts` have no active change against them; `client/src/viewer/
> ViewerLayer.tsx` likewise. Re-check all of this with `git status` and a re-read at apply —
> main moves under long-lived drafts.
>
> **Falsification convention (repo rule).** A cell is not trusted until the bug it claims to
> catch has been re-introduced and the cell seen to fail. Record it in the task line as
> `*(falsified by <the edit>: <n> cells failed)*`, naming the edit, not just "falsified".
> A tasks line claiming coverage is not coverage: grep the test file before checking it off.
> A cell that cannot be falsified is labelled a **guard** here and is not counted as
> coverage of anything.
>
> **Ordering within this change.** §1 is independent of §2–§5 and can land first. §2 must
> land before §3 (the hook's shape is what §3 fills). §5 depends on §2–§4.
>
> **Precondition.** `bun install` if `node_modules` is missing — a fresh worktree is
> gitignored-empty and `jean.json`'s setup script is non-fatal, so it can silently not have
> run. (It *is* present in the worktree this change was drafted in — `node_modules` at the
> root, `client/` and `server/` — so this is a precaution for wherever apply happens, not a
> known gap. Prettier comes from `bunx`, not from `node_modules`, so the pre-commit hook
> fires either way.)

## 1. The lightbox focus trap (issue #27)

- [x] 1.1 In `client/src/viewer/ViewerLayer.tsx`'s lightbox key effect (the `useEffect`
      gated on `viewer.mode !== "lightbox"`, in `onKey`'s `Tab` branch), change the
      `focusables` query from `"button:not([disabled])"` to
      `"button:not([disabled]), a[href]"`. Keep the comment above it accurate: it explains
      why `:not([disabled])` is there (the disabled end control, sibling-stepping D2) and now
      also has to say that an `<a>` carries no `disabled` attribute, so the one selector
      covers both kinds. Do **not** write that the query excludes href-less anchors as though
      the panel produced any — it does not (D9). Verify:
      `grep -n 'a\[href\]' client/src/viewer/ViewerLayer.tsx` matches exactly once, and
      `cd client && bunx vitest run test/lightboxPrevNext.test.tsx` is green before the new
      cell exists (the change must not disturb the ring that is already asserted).
- [x] 1.2 Add one cell to `client/test/lightboxPrevNext.test.tsx`, beside the existing
      *Tab is not dead-stopped by a disabled end control (first model)* cell (copy its
      idioms: `openModel`, the `window.dispatchEvent(new KeyboardEvent("keydown", {key:
      "Tab"}))` press, `document.activeElement`). Name it for the behaviour, e.g. *the
      attribution links sit in the Tab ring where the panel draws them*. Supply credits
      through `appHarness`'s `overrides` mock the way `client/test/viewerCredits.test.tsx`
      does — it holds the fixture shape to copy (`CREDITS`/`COMPLETE`, with `authorUrl`,
      `licenseUrl`, `sourceUrl`) and the `[data-credit="author"|"license"|"source"] a`
      accessors.
      **Assert the whole run, not just reachability.** The dialog's document order is
      Previous → Next → X/Y/Z → flip → *Copy path* → the `<dl>`'s author, license, source →
      the Open-in pills (only when the report grants `appLaunch` and apps resolve) → the
      `[data-command]` model-action buttons → Close. So Tab from the dialog until
      `button[aria-label="Copy path"]` is focused, then assert the **next four** presses land
      on, in order: the author anchor, the license anchor, the source anchor, and the first
      `<button>` that follows the `<dl>` in document order. Find that last one from the DOM
      rather than naming it (`Array.from(dialog.querySelectorAll("button")).find(b =>
      dl.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)`), so the cell does
      not silently depend on whether the Open-in group rendered. Cap the walk (the ring is
      finite) so a broken trap fails instead of hanging.
- [x] 1.3 Add the reverse cell: from the focused source link, `shiftKey: true` presses walk
      back through license then author then Copy path. Assert focus never leaves the dialog
      subtree (`dialog()!.contains(document.activeElement)`) at any step.
- [x] 1.4 **Guard, not coverage:** the same listing with **no** overrides answer, Tab all the
      way round, assert no anchor is ever focused and the ring is the one the existing cells
      describe. It passes both before and after 1.1 by construction — it exists to catch a
      *later* change that starts drawing something anchor-shaped for an uncredited model, and
      1.5 records that it is not falsifiable against this change's own bug.
- [x] 1.5 **Falsify 1.2 and 1.3.** (a) Revert the query in `ViewerLayer.tsx` to
      `"button:not([disabled])"` and re-run `cd client && bunx vitest run
      test/lightboxPrevNext.test.tsx`: 1.2 and 1.3 must fail; 1.4 must still pass (see its
      label). (b) Falsify the *placement* half separately — build `focusables` as
      `[dialog, ...buttons, ...anchors]` instead of one DOM-ordered `querySelectorAll`. All
      three links are still reachable, so a reachability-only cell would pass; 1.2 must fail
      on "Copy path is followed by the author anchor". 1.3 fails on its **third** step, not
      its first: the anchors keep their relative order in that ring, so source → license →
      author still pass and it is author → Copy path that breaks (Close comes back instead,
      the anchors having been appended after every button).
      Restore after each, re-run, and record both counts in this line.
      *(falsified 2026-09-18 — (a) query reverted to `button:not([disabled])`: 2 cells failed (1.2, 1.3; 1.4 passed); (b) `[dialog, ...buttons, ...anchors]`: 1.2 failed at Copy path → author (got the `reveal` command button), 1.3 failed at its third step, author → Copy path (got Close).)*
## 2. The injection seam in `static.ts` (no library knowledge)

- [x] 2.1 In `server/src/static.ts` add and export `interface Preview { title: string;
      description?: string; image?: string; imageType?: string; imageWidth?: number;
      imageHeight?: number; url?: string; card?: "summary" | "summary_large_image" }` and a
      pure `previewTags(p: Preview): string` that renders the `<meta>` block. Every attribute
      value goes through a local `escapeHtml` covering `&`, `<`, `>` and `"` (D7). Emit only
      the varying tags — `og:title`, `og:description`, `og:image` (+ `og:image:type`,
      `:width`, `:height` when given), `og:url`, `twitter:card` — and never `og:site_name` or
      `og:type`, which §4 puts in the built document.
- [x] 2.2 Add `describe?: (url: URL, headers: Headers) => Promise<Preview | null>` to
      `createStaticHandler`'s options object (which already carries `intro`), defaulting to
      `undefined`. Pass the `URL` the handler **already** built at the top of `handle`, not a
      fresh one: the host the origin fallback needs is `url.host`, already parsed, so this
      adds no new place for a malformed `Host` to throw (D3). `Headers` is passed for
      `X-Forwarded-Proto` alone and is a platform type, so this adds no import. Keep the
      header comment's rule intact and extend it in one sentence: the handler takes a
      function and never learns what a library is (D1).
- [x] 2.3 Thread the annotation through `send`: give it a third argument saying whether the
      file it is about to send is an **entry document**, set true only where `send` is called
      with `indexPath` (the SPA fallback) or where the resolved `candidate` equals `indexPath`
      or `aboutPath`. When true and `describe` is set, decode the bytes as UTF-8, call
      `describe(url, req.headers)`, and splice `previewTags(...)` before the first `</head>`.
      A `null` answer, a thrown `describe`, or a document with no `</head>` serves the bytes
      unchanged (D7) — wrap the call in a `try`/`catch` and let nothing a resolver does turn a
      document into a 500. Note that this catch is the **last** resort, not the resolver's
      own: §3.4/§3.5 must not rely on it, because reaching it means the document ships with
      no varying tags at all.
- [x] 2.4 Confirm the annotated response still carries `content-type: text/html; charset=utf-8`
      and `cache-control: no-cache` (`REVALIDATE`), and that the byte length is recomputed —
      no `content-length` is set by hand anywhere in this file, so check that it stays that way
      (`grep -n 'content-length' server/src/static.ts` → no match).
- [x] 2.5 **Fix the fixtures first.** `server/test/static.test.ts` builds its dist with
      `const INDEX = "<!doctype html><title>model browser</title>"` and `const ABOUT =
      "<!doctype html><title>about</title>"` — **neither has a `</head>`**, so under D7 every
      injection cell below would pass by serving the document unchanged and assert nothing.
      Rewrite `INDEX` and `ABOUT` to carry a real `<head>…</head>` (title inside it, as the
      build emits), and add one asset fixture whose bytes also contain `</head>` — e.g.
      `assets/doc-abc123.html`, or simply put `"</head>"` inside the existing
      `assets/main-abc123.js` string — so that "annotate everything" is an edit the asset
      cell can actually catch. Re-run the file's existing cells first: they compare against
      `INDEX`/`ABOUT` by value and must be updated in step, not left asserting old bytes.
- [x] 2.6 Then the cells, beside *caches the hashed assets immutably and revalidates the entry
      document* and *answers a path matching no file with the entry document*:
      (a) with no `describe`, the entry document is byte-identical to the file on disk;
      (b) with a `describe` returning a `Preview`, the fallback document for
      `/?path=/Kit&model=/Kit/x.stl` contains `og:title` and `og:image` and still contains the
      original `<title>`, and the injected block sits before `</head>`;
      (c) the `</head>`-carrying asset from 2.5 is byte-identical and keeps `IMMUTABLE`;
      (d) a `Preview` whose title is `A " > <script>alert(1)</script>` — assert the document
      **contains** `&lt;script&gt;` and `&quot;` and **does not contain** the raw substring
      `<script>alert(1)`, which is what makes "drop `escapeHtml`" a falsifiable edit (counting
      `</head>` occurrences does not);
      (e) a `describe` that rejects serves the document unchanged with a 200;
      (f) `about.html` is annotated when `intro` is on, and still 404s when `intro` is off
      (the existing *withholds the About page* cell must keep passing unchanged).
- [x] 2.7 **Falsify 2.6**: drop `escapeHtml` from `previewTags` — (d) must fail on the raw
      `<script>alert(1)` assertion; annotate every file rather than entry documents only —
      (c) must fail, which it can only do because 2.5 gave an asset a `</head>`; remove the
      `try`/`catch` from 2.3 — (e) fails. Restore between each; record the cell counts.
      *(falsified 2026-09-18 — drop `escapeHtml`: 1 failed (escapes every value); annotate every file: 1 failed (never annotates an asset); remove `annotate`'s try/catch: 1 failed (served unchanged when the resolver rejects).)*
## 3. The resolver (`server/src/preview.ts`)

- [x] 3.1 Export `isLoopbackOrigin(origin: string): boolean` from `server/src/guard.ts`,
      backed by the existing `LOOPBACK_ORIGIN` regex, and use it in `guard` where the regex is
      tested today so there is one spelling (D3). Verify `server/test/guard.test.ts` is green
      unchanged.
      *(Review follow-up: `isAllowedHost(host, allowed)` is exported beside it — `LOOPBACK_HOST`
      plus `normalize`'s host sets — and `guard` runs its own `Host` test through it. The
      entry document is served under no guard, so §3.2 applies the same rule itself, D6.)*
- [x] 3.2 New `server/src/preview.ts` — **no Bun APIs, no Hono** — exporting
      `createDescribe(deps: { library: Library; cache: ThumbCache; overrides: OverrideHolder;
      origins: readonly string[]; distDir: string }): (url: URL, headers: Headers) =>
      Promise<Preview>` — the hook's shape from 2.2. Origin resolution (D3): the first entry
      of `origins` for which `isLoopbackOrigin` is false, else `url.host` with the scheme from
      `headers.get("x-forwarded-proto")`, defaulting `http`. Site image (D5): stat the file under
      `distDir` **once**, at construction, with `statSync` from `node:fs` — `createDescribe`
      returns its function synchronously, so a top-level `await` is the wrong reach and a
      per-request `stat` pays on every document — and omit `image` from every answer when it is
      not there — a missing file would otherwise be advertised as an image and answered by the
      SPA fallback with a 200 `text/html` document.
      *(Review follow-ups: the site image's **shape** is declared beside its name — one
      `SITE_IMAGE = { file, type, width, height }` — so the PNG-or-JPEG choice stays one edit;
      the winning `origins` entry is restated as `new URL(entry).origin`, the spelling the
      guard normalises to; the thumbnail's square is `THUMB_SIZE`, moved to `shared/types.ts`
      beside `THUMB_MIME` and re-exported by `three/renderer.ts` rather than re-declared here;
      and a request whose `url.host` is neither loopback nor a configured origin's host takes
      the deployment strings with no library read, D6.)*
- [x] 3.3 View selection (D2): read `path` and `model` with `url.searchParams`. `model`
      present → the model branch; `path` present, no `model` → the directory branch;
      neither → the top. Never read `url.pathname` for this, except to answer `/about.html`
      with the About description.
- [x] 3.4 Model branch (D4/D8): `canonicalLibPath` the parameter, `await library.resolve(...)`,
      `stat(fsPath).mtimeMs`, then `cache.image(libPath, mtime)`. Emit
      `<origin>/api/thumb/image?path=…&mtime=…&gen=…` as `image` with `imageType` `THUMB_MIME`,
      256×256 and `card: "summary"` **only when `png !== undefined`**. Three rules the review
      caught, and the first fixes the order the other two are written in:
      **(a) the `stat` is the existence check, so the title comes after it, never before.**
      `library.resolve` does **not** throw for a merely absent path — it confines on the
      nearest existing ancestor and returns `join(anchorReal, ...missing)` (read `resolve` in
      `library.ts`) — so `?model=/Your%20account%20has%20been%20locked.stl` resolves fine and
      only `stat` says it is not there. Do **not** write
      `const title = lastSegment(libPath); try { stat; cache } catch {}`: that titles the
      fabricated path and defeats D8's rule. Compute the title
      (`displayNameOf(overrides.store(), libPath)`, falling back to the path's last segment)
      and the description (the kit's `author` + `license` via `resolveOverrides`, falling back
      to the containing folder's name) only on the branch where the `stat` returned.
      **(b) a `stat` throw and a cache miss are not the same answer.** A throw → §3.5's
      deployment strings, image and all. A miss → the title and attribution stay the model's
      and only the image falls back, which is what the *An unrendered model does not cause a
      render* scenario says.
      **(c) the `catch` is catch-all.** The failures here are three different types —
      `library.resolve` throws `LibraryError`, `requireReady` throws a plain `Error` when the
      library is not ready, and `canonicalLibPath` → `parseVPath` throws `VPathError` on a
      nested `!/` — plus `stat`'s `ErrnoException`. A `catch (e) { if (e instanceof
      LibraryError) … }` would let `?model=/a.zip!/b.zip!/c` escape to §2.3's guard and ship a
      document with no varying tags at all. Catch everything — `stat`'s `ErrnoException`
      included, per (a) — and fall through to §3.5's deployment strings.
      Write the mtime into the query **verbatim** — `mtimeMs` is a float and the cache
      compares it with `===`, so any `Math.floor`/`toFixed`/`| 0` turns every hit into a miss.
      No listing call, no walk, ever.
      *(Review follow-ups, both on the same `stat`: **(d)** it answers the **kind** too — a
      non-file (`?model=/Kit`) is the deployment, never a title from its last segment; and
      **(e)** for a **virtual path it proves the archive, not the entry**, so the entry's words
      are used only on a cache hit (either AO variant) and a fabricated entry inside a real
      archive is the deployment. D4's zip paragraph and D8 carry the argument.)*
- [x] 3.5 Directory / top / About branches (D5/D8). **The directory branch resolves before it
      uses the path's text**: `library.resolve` then one `stat(fsPath).isDirectory()`. Only
      then is the title the display name or the last path segment; anything that does not
      resolve, or resolves to a non-directory, is titled as the deployment. Without that
      check `?path=/Your%20account%20has%20been%20locked…` unfurls attacker-written text as
      `og:title` under the demo's own domain, beside its name and image. A zip view
      (`?path=/Kit/a.zip` or an interior) is a folder in the app but a file on disk, so it
      fails `isDirectory` and takes the deployment's title — a chosen consequence, argued in
      D8; do not special-case it here. `og:url` still restates the requested address in every
      one of these cases, fabricated paths included. The top, the About
      page and every fall-through take the fixed strings recorded in design D8 — copy them
      from there rather than inventing new ones. All of these take the shipped site image at
      `<origin>/og.png` (when 3.2 found it), `card: "summary_large_image"`, and `url` the
      absolute form of the request's own address.
- [x] 3.6 Wire it in `server/src/index.ts`: build `createDescribe({ library, cache, overrides,
      origins: config.origins ?? [], distDir: dist })` and pass it to `createStaticHandler`
      beside `intro`. Nothing else in `index.ts` changes; the config is already parsed once
      (public-deployment D2) and this reads the parsed value, not the file.
- [x] 3.7 New `server/test/preview.test.ts`. **Read `server/test/CLAUDE.md` first** — the
      cache dir and library are constructor arguments (`new ThumbCache(dir, cap,
      maintainEvery, libraryFor(top))`), never env vars, and `libraryFor` pins
      `MODEL_BROWSER_ROOT`/`HOME`/`XDG_CONFIG_HOME` at the fixture. Nothing here lists, so the
      index-stub rule does not bite; if a cell ever reaches `/api/dir` or `/api/peek` it must
      stub `fetch` and call `resetIndexStatus()`. Cells:
      the top; a directory that exists; **a directory that does not exist, whose path reads as
      a sentence — assert the `title` is the deployment's and that no distinctive word of the
      path appears in `title` or `description`, and assert positively that `url` still names
      the address as requested, query included.** Scope it to those two fields: `og:url`
      restates the request (§3.5, and the delta's own scenario says "as the title or the
      description"), so a cell asserting the path appears *nowhere* fails against the correct
      implementation and can only be greened by stripping the query from `og:url`; a model with a **written** cache entry (assert the
      `og:image` names `/api/thumb/image` with that entry's mtime and gen); **a zip entry**
      with a written cache entry (`library.resolve` answers the archive's `fsPath`, so the key
      is the archive's mtime — assert the emitted `path=` is the `foo.zip!/entry` virtual path
      and `mtime=` the archive's; build the fixture archive with a **fractional** mtime via
      `utimes` so a floor or `toFixed` in the URL builder fails the cell rather than passing by
      luck); a model with **no** cache entry (title and attribution still the model's, image
      falls back, and nothing was written to the cache dir); **a model that does not exist, whose path reads as a
      sentence — `resolve` succeeds for it (it confines rather than proves existence), so this
      is the cell that catches a title computed before the `stat`: assert the title is the
      deployment's, that no distinctive word of the path appears in `title` or `description`,
      and that `url` still names the address as requested**; a model path with a nested `!/`
      (falls through with no throw, and the title is **the deployment's** — assert the string,
      not merely that a title exists); a display name
      containing `"` and `<` (escaped once through `previewTags`); a `distDir` with **no**
      site image (no `og:image` at all in the answer); `origins:
      ["https://models.masamaeda.com"]` wins over a `url.host` of `evil.example`; `origins:
      []` falls back to the host with `X-Forwarded-Proto: https`; `origins:
      ["http://127.0.0.1:3177", "https://models.masamaeda.com"]` picks the **second**.
      *(14 cells, including one the design gained at apply: the resolver prefers the occluded variant and falls back to the `noao` one with `ao=off` on the URL — D4.)*
      *(Review follow-up, 5 cells more — 19: **a fabricated entry inside a real archive**
      (sentence path, same title/description/url assertions as the other fabricated-path
      cells, plus a real-but-unrendered entry); **a `model` naming something that is not a
      file** (`/Kit`, `/Plain` → the deployment; `/Kit/notes.txt` is still a file and keeps its
      name); **the hosts the deployment does serve** (the declared name and loopback describe a
      model; any other host takes the deployment strings for every address) — and the existing
      `evil.example` cell now asserts those strings too; **the declared origin's spelling**
      (`HTTPS://Models.Masamaeda.COM` reaches `og:url` as `https://models.masamaeda.com`); and
      **a library that cannot answer** (`libraryFor` at an absent root, with its own cache and
      holder: the top, `?path=`, `?model=` and the About page all answer without throwing).
      The site-image cells assert its `imageType`/`imageWidth`/`imageHeight`, and the model
      cell asserts the square through `THUMB_SIZE`.)*
- [x] 3.8 **Falsify 3.7**: read `url.pathname` instead of the `model` query param (every model
      cell falls back — D2's whole point); emit the thumbnail URL without the hit check (the
      no-cache-entry cell fails); **treat a `stat` throw as a cache miss — keep the last
      segment as the title and only fall the image back** (the nonexistent-model cell fails,
      and this is the mutation that proves §3.4(a) rather than §3.4(b)); `Math.floor` the mtime into the query (the fractional zip
      cell fails); title the directory from the path without resolving (the fabricated-path
      cell fails); narrow the model `catch` to `LibraryError` (the nested-`!/` cell fails);
      reverse the origin precedence to host-first (the `evil.example` cell fails); drop
      `isLoopbackOrigin` so the first `origins` entry always wins (the loopback-first cell
      fails); skip the site-image `stat` (the no-site-image cell fails). Restore between each;
      record the counts.
      *(falsified 2026-09-18, re-run against the file's final 19 cells — pathname instead of `model`: 9 failed; thumbnail URL without the hit check: 2; stat throw treated as a miss: 1 (fabricated model); `Math.floor` on the mtime: 2; directory without `isDirectory`: 2; host-first origin: 3; `isLoopbackOrigin` dropped: 1; site-image stat skipped: 1; `noao` fallback removed: 1. The `LibraryError` narrowing moved to the follow-up line below, where it now covers both `catch`es.)*
      *(Review follow-up, falsified 2026-09-18 against the 19 cells — drop the archive-entry
      hit gate: 1 failed (the fabricated entry); drop the host rule in `preview.ts`: 2; make
      `isAllowedHost` answer true for every host: 2 (the same two, from the other side); drop
      the `isFile` check: 1; declare the raw configuration string instead of `URL.origin`: 1;
      drop the site image's declared shape: 2; narrow **both** `catch`es to `LibraryError`: 4,
      the unready-library cell among them. Restored between each.)*
## 4. The site image and the invariant tags
      *(review round 2, 2026-09-18: the bare-archive gate — `?model=/Kit/models.zip` is a folder in the app — added to the not-a-file cell; drop the gate: 1 failed.)*
- [x] 4.1 Create `client/public/` (it does not exist yet) and add the site image, 1200×630.
      Produce it once, by hand: `bun run dev:demo`, then Playwright MCP —
      `browser_resize` to 1200×630, `browser_navigate` to the library top, and
      `browser_take_screenshot` to a path **under the repo root** (the MCP browser writes
      nowhere else), then move it to `client/public/`. Check the size: a grid of miniatures is
      a photographic image, and a 1–2 MB PNG is worth re-saving as `og.jpg` at q0.85 (D5); if
      you do, there is exactly **one** reference to change — the name in `preview.ts` — because
      §4.2's cell globs rather than naming the file. Say here which extension shipped. Verify Vite copies it:
      `cd client && bun run build && ls dist/og.*`. `client/vite.config.ts` sets no
      `publicDir` today, so the default `public/` → dist-root copy applies — confirm rather
      than assume.
      *(shipped 2026-09-18: `og.png`, 1200×630, ~190 KB — PNG, under the threshold; retaken with the intro dismissed and the side panel collapsed so the grid fills the frame.)*
- [x] 4.2 Add a cell asserting the file is present in the repo, beside
      `client/test/viteEntries.test.ts` (which exists for the same reason — a dropped build
      input whose only symptom on the box is a 404 the SPA fallback dresses up as the app).
      **Glob rather than name it** — `readdirSync` over `client/public/` filtered to `og.*`,
      asserting exactly one match and a non-zero size — so §4.1's PNG-or-JPEG choice does not
      have to be made twice, and two site images cannot sit there with the resolver naming
      one. Together with §3.2's `statSync`, a missing image then fails in CI instead of
      unfurling the app's HTML as a picture.
      *(`client/test/siteImage.test.ts`; falsified: a second `og.jpg` → 1 failed, image removed → 2 failed, truncated to 0 bytes → 1 failed.)*
- [x] 4.3 Record the recipe in `docs/web-demo-notes.md` — the URL, the viewport, the posture
      (`dev:demo`), the tool and the date — so the image can be retaken without guessing (D5).
      One short paragraph; the notes file is the home for demo-shaped decisions.
- [x] 4.4 Add the two invariant tags to `client/index.html`'s `<head>`: `og:site_name` and
      `og:type`. **Do not add `og:title`, `og:description`, `og:image`, `og:url` or
      `twitter:card` here** — those are injected, and a duplicate makes a consumer choose
      (D7). Verify `grep -c 'og:' client/index.html` is 2.
- [x] 4.5 Same two tags in `client/about.html` — **re-read the file first**, `landing-page`
      owns it (D2 of that change) and may have moved under this draft. Verify
      `cd client && bunx vitest run test/viteEntries.test.ts` is green.
- [x] 4.6 `.prettierignore` check: the site image is a binary and Prettier's glob is
      `**/*.{ts,tsx,css,json}`, so nothing to do — confirm with `bun run format:check` after
      the file lands rather than assuming.

## 5. Suite, types, and the note the next person needs

- [x] 5.1 `cd server && bunx vitest run` — green, with the new `preview.test.ts` and the
      extended `static.test.ts` included. Record the cell count.
      *(2026-09-18: 31 files, 914 tests)*
- [x] 5.2 `cd client && bunx vitest run` — green, with the new `lightboxPrevNext.test.tsx`
      cells and §4.2's. Record the cell count. (Run vitest from the workspace dir; from the
      repo root `bunx` fetches an unpinned vitest that cannot resolve workspace deps.)
      *(2026-09-18: 81 files, 1090 tests, 15 skipped)*
- [x] 5.3 `bun run typecheck` across workspaces — green. `bun run format` (it runs
      `--write` twice on purpose; Prettier is not idempotent here) then `bun run format:check`.
- [x] 5.4 Grep the test files named in §1, §2, §3 and §4 and confirm each cell listed there
      exists by name — a tasks line claiming coverage is not coverage.
- [x] 5.5 Extend CLAUDE.md's "3177 also serves `client/dist`" bullet with the other half this
      change creates: under `bun run dev` the entry document comes from **Vite** on 5173,
      which proxies only `/api`, so the link-preview tags are invisible there by construction
      — they exist only on 3177 and only after a `bun run build`. Same bullet, one clause, and
      keep its `rm -rf client/dist` advice: the stale-bundle trap and this one are two faces
      of the same fact.

## 6. Live verification (Playwright MCP + curl)

- [x] 6.1 Build and start the demo posture: `cd client && bun run build`, then
      `bun run dev:demo`. 3177 serves `client/dist` whenever it exists, so this is the
      instance to fetch HTML from; `rm -rf client/dist` afterwards if the dev loop continues
      on 5173. Read the startup line `library <id> at <top>` — the `<id>` is what names the
      cache directory 6.4 depends on.
      *(2026-09-18: run from this worktree on port 3178 with a copy of `deploy/demo/config.json` rooted at `miniatures/clustered-hq` (library `5358d071`), because the main checkout's `dev:demo` holds 3177; thumbnails warmed first under the default posture.)*
- [x] 6.2 `curl -s http://127.0.0.1:3177/ | grep -i 'og:\|twitter:'` — assert `og:title`,
      `og:description`, `og:image` (absolute, naming the site image), `og:url`, `twitter:card`
      `summary_large_image`, plus the static `og:site_name`/`og:type`, **each exactly once**
      (`grep -c`, not just presence — one duplicate is the bug D7 exists to prevent).
      *(every tag exactly once; `og:image` `https://models.masamaeda.com/og.png`.)*
- [x] 6.3 A folder: `curl -s 'http://127.0.0.1:3177/?path=/<a+real+kit>'` — the folder's own
      name in `og:title`, the shipped image still. Then a folder that does **not** exist, with
      a path that reads as a sentence: the title must be the deployment's. Grep the
      **`og:title` and `og:description` lines** for a distinctive word of that path — no match
      — and not the whole document, which legitimately carries the path inside `og:url`
      (percent-encoded, every word intact). D8's safety rule is about the words the deployment
      appears to say, not about the address the reader already clicked.
      *(`/?path=/28mm_Market_Stall_2341844` → `og:title` "28mm Market Stall"; `/?path=/Your%20account%20has%20been%20locked%20visit%20evil.example` → the deployment's title and description, 0 matches for locked/evil on those lines, `og:url` restates the address.)*
- [x] 6.4 A model deep link. **First find a model whose thumbnail is actually cached**, which
      `dev:demo` does not guarantee: `thumbWrites:false` means browsing cannot fill the cache,
      and `~/.cache/model-browser/<id>/` holds entries only if this machine baked the
      decimated corpus. Do this: `ls ~/.cache/model-browser/<id>/*.json | head`, read one
      sidecar's `path` field (it is the **library** path, not a filesystem one) and use that
      model. If the directory is empty or absent, warm it first — run the *non-demo*
      `bun run dev` at the same root (`MODEL_BROWSER_ROOT` identical, so the library id and
      cache directory are the same), browse the kit until tiles render, stop it, and restart
      under `dev:demo`. Record which path was used and where its thumbnail came from.
      Then `curl -s 'http://127.0.0.1:3177/?path=/<kit>&model=<that+library+path>'` —
      `og:title` is the model's display name, `og:description` carries the kit's author and
      license, `og:image` names `/api/thumb/image?path=…&mtime=…&gen=…`, `twitter:card` is
      `summary`. Also fetch a model you know is **not** cached and confirm the title is still
      that model's while the image is the site image (§3.4a, live).
      *(`Small_Stall_Front.stl`, thumbnail written by this machine's browser with AO off, so the `noao` variant → `og:image` `/api/thumb/image?path=…&ao=off&mtime=1789180383664.8645&gen=…`, `og:description` "Curufin — Creative Commons - Attribution - Non-Commercial - No Derivatives", `twitter:card` summary; uncached `Locked_Chest_3040102/case_meshmixed.stl` → its own title and credits, image `og.png`; fabricated `?model=/Your%20account%20is%20locked.stl` → the deployment's title.)*
- [x] 6.5 Fetch that `og:image` URL: `curl -sI '<the url>'` → `200` and
      `content-type: image/webp`. This is the fetch an unfurl service makes: it sends no
      `Origin`, and `guard` passes a request with none. Then repeat with
      `-H 'Origin: https://evil.example'` and record what comes back — the guard covers
      `/api/*`, so a 403 there is correct and says nothing about unfurling. Record what was
      observed, not what was expected.
      *(no Origin: 200, `Content-Type: image/webp`, immutable, CORP same-origin, bytes are a 256×256 WebP; `Origin: https://evil.example`: 403 `forbidden origin` — the guard, as expected.)*
- [x] 6.6 Spoofed-host check: `curl -s -H 'Host: evil.example' http://127.0.0.1:3177/ |
      grep og:image` against a configuration whose `origins` names the public origin — the
      image must still name the configured origin (D3).
      *(`Host: evil.example` → `og:image` still `https://models.masamaeda.com/og.png`.)*
      *(Review follow-up: such a request now also takes the deployment's **title and
      description**, the host being neither loopback nor a configured origin's (D6) — covered
      by §3.7's host cells; re-observe here if this manual pass is ever re-run.)*
- [x] 6.7 #27 in the real lightbox, via Playwright MCP: open a credited model's lightbox (model
      tiles respond only to PointerEvents — pointerdown on the tile, wait ~300 ms, pointerup on
      window), then press Tab repeatedly and read `document.activeElement` after each via
      `browser_evaluate`. Assert the run Copy path → author → license → source → the next
      button, and that focus never leaves the dialog. Measure, do not screenshot.
      *(Tab ring observed: Previous, Next, X, Y, Z, flip, Copy path, Curufin (author), the CC BY-NC-ND deed (license), thingiverse.com (source), Reveal in app, Reset framing, Close, dialog — focus never left the dialog.)*
- [x] 6.8 **#9 re-verification (the whole of this change's answer to that issue).** In the same
      live browser: in the lightbox, ArrowLeft/ArrowRight step to the previous/next *model* of
      the listing (dirs and zips skipped), the on-screen previous/next arrows do the same, the
      end controls are disabled at the ends, and the `model=` URL parameter follows without
      stacking history (one browser Back closes the lightbox onto the listing). Then in the
      grid: arrow keys move the selection across and down, and Enter opens. Note that a
      lightbox opened and closed **untouched** writes nothing, and that stepping after an orbit
      persists the leaving model — so wait ~5 s after any orbit before judging a tile's
      thumbnail. Record what was seen.
      *(ArrowLeft/Right and both arrow buttons step among the kit's 7 models with the dialog open and `model=` following; `history.length` constant at 3 across every step; Previous disabled at the first, Next at the last, no wrap; one Back closes the lightbox; grid: ArrowRight 0→1, ArrowDown 1→9 across an 8-column row, ArrowUp back, Enter opens the lightbox, Escape closes.)*
- [ ] 6.9 Optional, and only once a real deployment carries this: run the model deep link
      through Facebook's and LinkedIn's sharing debuggers to settle the relayed WebP claim in
      design's Risks (Discord/Slack/X are the three issue #11 names and do render it). Record
      the answer there — verified or retracted — rather than leaving the claim relayed.
- [ ] 6.10 Close issue #9 on 6.8's observation, citing
      `2026-09-15-lightbox-sibling-stepping` and `2026-09-15-grid-arrow-navigation`. Close #27
      on 6.7 and #11 on 6.2–6.6.

## 8. An arrow with nothing focused (found during 6.8)

- [x] 8.1 In `client/src/components/Grid.tsx`, add a `document` `keydown` listener in a
      `useEffect` beside the container `onKeyDown`: unmodified arrow, `document.activeElement`
      is `body` or null, no `[aria-modal="true"]` in the document, grid has a tile — then
      `preventDefault` and focus the first tile (D11). Share the arrow-key set between the two
      handlers rather than repeating the four-way compare.
- [x] 8.2 `client/test/gridArrowNav.test.tsx`: a cell that blurs everything and presses each
      arrow, expecting the first tile focused and the event prevented, and a modified arrow
      left alone; a cell that opens the lightbox, blurs, presses ArrowRight and expects the
      first tile's `focus` never called (a spy — the lightbox refocuses itself on every step,
      so `activeElement` alone is green with the guard removed) and the dialog stepped to the
      next model, so the body-targeted arrow is seen to reach the lightbox's window listener.
      *(falsified by commenting out the `addEventListener`: 1 cell failed; by removing the
      `preventDefault`: 1 cell failed; by removing the `aria-modal` guard: 1 cell failed —
      the lightbox cell, only once it asserted through the spy.)*
- [x] 8.3 Delta `specs/directory-browsing/spec.md`: MODIFIED *Arrow-key focus movement across
      the grid*, carrying all seven existing scenarios verbatim and adding two. Validate
      `--strict` and the fresh-copy archive dry run again (7.1, 7.2): both clean, `+2 ~1 -0`.
- [x] 8.4 Live, on the 3178 build: load the top listing, press ArrowRight with nothing
      focused, see the first tile take the focus ring; click empty grid space, press ArrowDown,
      same; open the lightbox, click its canvas, press ArrowRight, see it step and no tile
      focused behind it. Record what was seen.
      *(In `/28mm_Market_Stall_2341844`: `activeElement` was `body`, ArrowRight put it on tile
      0 with `:focus-visible` true and `scrollY` unchanged; a click on the grid's padding
      returned it to `body` and ArrowDown landed tile 0 again; ArrowRight then stepped to
      tile 1. Enter opened that model; a canvas click plus blur left `body` active;
      ArrowRight stepped the lightbox to `Small_Stall_Front.stl` with `model=` following and
      focus back inside the dialog, no grid tile focused; Escape closed it onto tile 2.)*

## 7. Spec gates

- [x] 7.1 `openspec validate link-previews-and-credit-focus --strict` — clean. (The change
      name is positional; `--change` works on `status`/`instructions`, not `validate`.)
- [x] 7.2 Archive dry run on a **fresh** copy: `T=$(mktemp -d); cp -r openspec $T/; (cd $T &&
      openspec archive link-previews-and-credit-focus --yes)`. One fresh copy per change — a
      successful archive mutates the copy.
- [x] 7.3 `scripts/spec-diff.sh link-previews-and-credit-focus` and read the deltas against
      the main specs one more time, with whitespace collapsed
      (`python3 -c "import re,sys;print(re.sub(r'\s+',' ',open(sys.argv[1]).read()))" FILE |
      grep …`), to confirm neither ADDED title already exists in its capability and the
      MODIFIED one exists exactly once.
- [ ] 7.4 After archiving, read `openspec/specs/public-deployment/spec.md` and
      `openspec/specs/model-viewer/spec.md`: a delta's HTML comments land verbatim, so confirm
      the applied requirements carry no change-scoped prose. (These deltas are written with no
      HTML comments on purpose — confirm that is still true at apply.)
- [x] 7.5 `docs/platform-surface.md` is unchanged: nothing here spawns, registers a file type,
      or adds a per-OS path. Confirm rather than assume before closing the change.
