# Tasks — byte-route-cache-headers

> Server only. Nothing under `client/` or `shared/` is touched; `client/src/api/client.ts`
> keeps today's URLs (proposal, Out of Scope).
>
> Ordering against active changes: none is blocking. `entry-stat-revalidation` edits
> `server/src/app.ts` (`/api/models`, `/api/reload`) and adds `describe` blocks to
> `server/test/api.test.ts` — different symbols, different blocks. Re-read both files and
> `git status` before editing rather than planning against an earlier read. The one symbol
> this change touches that is not its own is `app.onError` (task 1.4): no active change
> edits it today — checked — but it is the line to re-read before editing, since a
> conflict there is a conflict with every route.

## 1. The tier helper (`server/src/app.ts`)

- [x] 1.1 Add `byteEtag(version: number, size: number): string` returning the strong tag
      `"<version>-<size>"` (D7), placed beside `thumbHitTiers` so the two tier
      vocabularies sit together. Verify by a unit assertion that the tag is quoted and
      carries both components.
- [x] 1.2 Add `byteTiers(c: Context, version: number | null, size: number): { headers: Record<string, string>; etag: string | null; notModified: boolean }`
      beside `byteEtag`, implementing D3's three tiers over the optional `mtime` query
      parameter: read `c.req.query("mtime")`; an absent value, an empty string, or one
      `Number(...)` does not turn into a finite number counts as **not named** (D2 — note
      `Number("")` is `0`, so the empty case needs its own arm or it lands in the wrong
      tier). Named and `=== version` → `headers` of `cache-control: public, max-age=31536000,
      immutable` **and the `etag`** (D3's first row — it carries the tag where `thumbHitTiers`
      does not, because `/api/file` serves 206s). Named and different → `cache-control:
      no-cache` alone, no `etag` in `headers`. Not named → `cache-control: no-cache` plus the
      `etag`. `version === null` (unknown) → the not-named tier, `headers` of `no-cache`
      alone, `etag: null`, `notModified: false`.
- [x] 1.2a **`byteTiers` writes nothing** (D8): no `c.header`, no touching `c.res`. It reads
      the request and returns the header object for the call site to spread into the
      `c.body(...)` / `c.json(...)` it is already building. This is the one place the change
      departs from `thumbHitTiers`, deliberately: the helper has to run early on both routes
      (before `extractEntry`, before `meshCache.read`), and a helper that staged headers on
      the context would leave a `cache-control` **and an `etag`** on every failure reached
      after it — the 416, `extractEntry`'s `ZipError` 422 through `onError`, and
      `/api/model.glb`'s `GlbError` 422. `c.header` is `Headers.set`, so a later `no-store`
      replaces the directive and the stale `etag` survives beside it: a failure that says
      "do not store me" while handing out a validator, which the spec forbids. Purity makes
      "headers are written on the byte-carrying answer and on its 304, nowhere else" a rule
      with no exceptions rather than three deletions each needing its own cell.
- [x] 1.3 `byteTiers`' `notModified` is **one rule across all three tiers**, not a property of
      the not-named arm: it is true whenever `version` is non-null and
      `c.req.header("if-none-match")` equals the current tag, whatever the request named
      (D7). Compute the tag first, then the tier. This is what stops the two routes
      diverging — without it a named-and-current request carrying a matching
      `if-none-match` is a 304 on whichever route asked the helper and a full body on the
      other. The returned `etag` is likewise the current tag whenever `version` is non-null,
      **whether or not `headers` carries it**, because `/api/file` evaluates `If-Range`
      against it. Neither call site re-derives either answer; 4.15's four cells are what
      pin it.
- [x] 1.4 `app.onError`: give every thrown failure `cache-control: no-store` —
      `ListingError` 404 (a missing or unreadable archive), `ZipError` 422 (corrupt, or entry
      not found), `LibraryError` 400/404 (outside the root, over-long, hidden component),
      `VPathError` 400, and the 500 fall-through. **This is the change's one cross-route
      edit** (D3): it reaches every route's errors, deliberately, and no route in this server
      has a cacheable error. It is what closes the actual hole — the byte handlers produce
      only three or four of their own failure statuses; the rest never reach handler code at
      all, and a 404 with no directive is heuristically cacheable (RFC 9111 §4.2.2).
      Placement inside `onError` does not matter (`c.header` is `Headers.set`, so it replaces
      whatever was staged wherever it sits) and with 1.2a nothing is staged at throw time
      anyway. **Not in scope: `server/src/guard.ts`.** Its three 403s are returned from
      middleware, before any route runs and never through `onError`; a 403 is not
      heuristically cacheable and touching the guard would be a second cross-route edit.
      4.14 is the cell that pins `onError`.
- [x] 1.5 Do **not** modify `thumbHitTiers`, `thumbKeyOf`, `/api/thumb` or `/api/thumb/image`
      (D8). Verify by `git diff` that no line inside those four symbols changed. (`app.onError`
      in 1.4 is the one deliberate exception to "byte routes only", and it touches none of
      these four.)

## 2. `/api/file` (`server/src/app.ts`, the `app.get("/api/file")` handler)

- [x] 2.1 Zip branch: `stat(fsPath)` (the archive that `library.resolve` returned) with
      `.catch(() => null)`, **before** `extractEntry` (D5). A `null` is *version unknown*,
      never a 404 — the existing `ZipError`/`ListingError` path keeps producing that status
      unchanged.
- [x] 2.2 Zip branch: call `byteTiers` with the archive's `mtimeMs`/`size` (or `null`)
      **between the stat and `extractEntry`**, and answer `c.body(null, 304, tiers.headers)`
      when it reports `notModified` — a 304 must not decompress a body it then discards,
      which is the whole reason 2.1 puts the stat first. Spread `tiers.headers` into the
      200's existing header object; `content-type`/`nosniff` are unchanged and `Range` stays
      ignored on this branch (D6). Because the helper writes nothing (1.2a), an
      `extractEntry` that throws between this call and the 200 reaches `onError` with a clean
      context — that is the case 4.14's corrupt-archive cell proves.
- [x] 2.3 Give `cache-control: no-store` to every failure this handler returns itself (D3,
      fourth row): the `path is required` 400, the `nested zips are unsupported` 400, the
      non-model 404 and the missing/non-file-source 404. The failures it *throws* — a
      missing, unreadable or corrupt archive, an entry that is not in the archive, anything
      `library.resolve` raises — are covered by 1.4 and need nothing here; confirm by review
      that no fifth in-handler failure return exists.
- [x] 2.4 Loose branch: take the tier decision from `byteTiers` (1.3) **before** the range is
      parsed, and return `c.body(null, 304, tiers.headers)` on `notModified`, so a
      not-modified check outranks `Range` (RFC 9110 §13.2.2, *Precedence of Preconditions*,
      D7). Do not compare `if-none-match` at the call site — that duplicate comparison is
      exactly how the two routes were about to disagree. Deciding early costs nothing here
      precisely because deciding is not declaring (1.2a).
- [x] 2.5 Loose branch: when `if-range` is present *with* a `Range` and does not equal the
      `etag` `byteTiers` returned — the current tag, emitted or not (1.3) — drop the range and
      serve the whole representation 200 (D7). An `if-range` with no `Range` is ignored. A
      `null` `etag` needs no special case: it compares unequal, so the range is dropped, and
      the only branch that can have a null version is the zip one, which ignores `Range`
      regardless (2.2).
- [x] 2.6 Loose branch: the 416 adds `cache-control: no-store` to the header object it already
      passes, and simply never spreads `tiers.headers`, keeping its `content-range: bytes
      */<size>` and empty body exactly as today (D6). There is nothing to override and
      nothing to strip — that dance existed only while the helper wrote to the context
      (1.2a). 4.6 still asserts `etag` is *null* rather than merely absent from the literal,
      because null is what a leak would falsify.
- [x] 2.7 Loose branch: the 206 and the 200 both spread the same `tiers.headers` from 2.4's
      single call, so they carry the same declaration by construction (D6); `accept-ranges`,
      `content-range` and `content-length` are untouched.

## 3. `/api/model.glb` (`server/src/app.ts`, the `app.get("/api/model.glb")` handler)

- [x] 3.1 Reuse the `mtime`/`s.size` the handler already has from its `stat(fsPath)` — no new
      syscall (D9) — calling `byteTiers` once, after the `stat` and ahead of
      `meshCache.read`, and spreading `tiers.headers` into both byte-carrying returns: the
      cache hit and the converted miss. Answer `c.body(null, 304, tiers.headers)` when it
      reports `notModified`, ahead of the conversion, so a revalidation never reconverts.
- [x] 3.2 Give `cache-control: no-store` to every failure this handler returns itself: the
      `path is required` 400, the non-STL 404, the missing-source 404 and the `GlbError` 422
      (D3, fourth row). The 422 is the one worth looking at twice: it is reached *after* 3.1's
      `byteTiers` call, so it is the GLB route's version of the 416 — it must carry
      `no-store` and **no `etag`**, which 1.2a gives for free (nothing was staged) as long as
      the failure return does not spread `tiers.headers`. 4.11 asserts the null `etag`, not
      just the directive. Its thrown failures — the `ListingError` 404 for an unreadable
      archive, `ZipError`, `library.resolve`'s `LibraryError` — are 1.4's, not this task's.
- [x] 3.3 Confirm the zip path needs nothing extra: `library.resolve` returns the archive as
      `fsPath`, so the existing `stat` is already the archive's (D4). Verify by review and by
      the test in 4.7.

## 4. Tests (`server/test/api.test.ts`, `server/test/modelGlb.test.ts`)

> `server/test/CLAUDE.md`: every `app.request` needs a loopback `host` header, and the cache
> and library are constructor arguments (`libraryFor`, `makeFixtures`). New cells go in a new
> `describe("model byte cacheability")` beside `GET /api/file byte ranges` rather than inside
> it.

- [x] 4.1 `api.test.ts`: the three tiers on `/api/file` for a loose model — the current
      `mtime` from `statSync` gives `public, max-age=31536000, immutable` **and the quoted
      `etag`** (D3's first row); a wrong `mtime` gives `no-cache`, no `etag`, and the same
      bytes as the whole file; no `mtime` gives `no-cache` plus the same quoted `etag`.
      Assert the bytes in the first two cells, not only the headers, and assert that the tag
      the pinned tier emits is byte-identical to the version-less tier's — one representation,
      one validator.
- [x] 4.2 `api.test.ts`: the version round-trips from the listing — read an entry's `mtime`
      from `/api/dir`, put `String(entry.mtime)` straight into `/api/file?path=…&mtime=…`,
      and assert `immutable` (D1/D2). This is the cell that fails if anything ever rounds
      `DirEntry.mtime`; use a fixture whose `mtimeMs` has a fraction, set with
      `utimesSync(f, seconds, seconds)` where `seconds` is a **number** carrying a fractional
      part (`1789446597.1234567`). The numeric form is what keeps the fraction — Node stores
      `…123.456`, Bun `…123.4568`; a `Date` argument truncates to integer milliseconds on both
      (Node even reports `…122.999`), which is the round trip `meshCache.ts`'s
      `MTIME_TOLERANCE_MS` comment describes. A `Date` fixture here would make the cell skip
      forever and assert nothing. Skip the cell if the filesystem itself truncated the
      fraction, so a coarse filesystem reports rather than fails — and log which it was, or
      a skip for the wrong reason looks the same.
- [x] 4.3 `api.test.ts`: a malformed version is treated as absent, not refused — `mtime=`,
      `mtime=abc` and `mtime=NaN` each answer 200 with the bytes, `no-cache` and an `etag`
      (D2).
- [x] 4.4 `api.test.ts`: `if-none-match` with the tag from a version-less `/api/file` answers
      304 with an empty body, the same `etag` and `no-cache`; a non-matching tag answers 200
      with the bytes.
- [x] 4.5 `api.test.ts`: a 206 carries the declaration its 200 would — the same request with
      the current `mtime` and `range: bytes=0-9` is 206, `immutable`, and its bytes equal the
      whole file's first ten (D6). Add the version-less variant asserting `no-cache`.
- [x] 4.6 `api.test.ts`: the 416 cells keep their status, `content-range: bytes */<size>` and
      empty body, and now assert `cache-control: no-store` and a null `etag` (D6). Extend the
      existing *answers a range naming nothing in the file with 416 and the size* cell rather
      than adding a parallel one.
- [x] 4.7 `api.test.ts`: `/api/file` on a zip entry — the version that matches is the
      **archive's** `mtimeMs` (the entry's own timestamp does not), it answers `immutable`,
      and a `range` header still returns the whole entry 200 (D4/D6). Pair it with a cell
      taking the entry's `mtime` from `/api/dir` on the archive's virtual folder, so the
      listing and the route are pinned to agree.
- [x] 4.8 `api.test.ts`: `if-range` — with the current tag plus `bytes=0-9` → 206; with a
      stale tag plus `bytes=0-9` → 200 and the whole file; `if-range` with no `range` → 200
      (D7).
- [x] 4.9 `api.test.ts`: `if-none-match` matching **and** a `range` present answers 304, not
      206 (D7's precedence rule).
- [x] 4.10 `api.test.ts`: the 404s `/api/file` returns itself — a non-model path and a missing
      model — answer `no-store` and carry no `etag`. The failures that leave by `throw` are
      4.14's.
- [x] 4.11 `modelGlb.test.ts`: the three tiers on `/api/model.glb` keyed by the **source
      STL's** mtime, including the zip-entry case keyed by the archive's; the non-STL 404,
      the missing-source 404 and the `bad.stl` 422 answer `no-store` **and a null `etag`**.
      Request the 422 with `mtime=<the current one>` because that is the tier whose `headers`
      carries the tag. Only the `etag` can leak: under 4.13's mutation the handler's own
      `no-store` still replaces a staged `cache-control` by `Headers.set` (1.4), so the
      directive is never wrong on a failure and the stray validator is the whole of what the
      cell has to catch (3.2).
- [x] 4.12 `modelGlb.test.ts`: a 304 on `/api/model.glb` does not reconvert. Spy on
      **`mc.write`**, which is what the existing *serves an STL as GLB and converts only on
      the miss* cell spies on — `stlToGlb` is a named ESM import in `app.ts` and is not
      spy-able without `vi.mock`. The first version-less request is a *miss*, so it converts
      and writes once; assert one call after it and still one after the `if-none-match`
      revalidation returns 304. Delete the mesh-cache file between the two requests, so the
      cell is falsifiable (4.13): with the 304 removed the second request is a miss again and
      writes a second time, which a live cache entry would have hidden.
- [x] 4.13 Falsify 4.1, 4.6, 4.7, 4.9, 4.11, 4.12, 4.14 and 4.15 before trusting them: revert
      the tier call at each call site in turn — for 4.14 the `onError` line, and for the
      null-`etag` assertions in 4.6, 4.11 and 4.14 a `byteTiers` rewritten to stage its
      headers on the context the way `thumbHitTiers` does, which is the exact regression 1.2a
      exists to prevent — and confirm the matching cell goes red. A green cell under a reverted call site means the cell is
      asserting nothing.
- [x] 4.14 `api.test.ts`: the failures that never reach handler code answer `no-store` and
      carry no `etag` (1.4) — `/api/file?path=` (empty, the in-handler 400),
      `/api/file?path=/a.zip!/b.zip` (nested zip, the in-handler 400),
      `/api/file?path=/missing.zip!/x.stl` (`ListingError` 404 by way of `listZipEntries`'
      ENOENT), and an entry request against a fixture that is not a valid archive (`ZipError`
      422). Each cell asserts the status it answers today *and* the two new facts, so a
      status that moves is caught too. The corrupt-archive cell is the load-bearing one for
      1.2a and needs `mtime=<that file's current mtime>`: its stat *succeeds*, so a tier is
      decided, and only then does `extractEntry` throw — Hono hands `onError` the same
      context the handler had, so a helper that staged headers would ship the tier's `etag`
      on that 422. (The missing-archive cell cannot show this: its stat returns null, the
      version is unknown and there is no tag to leak. Add an *entry not in the archive* cell
      beside it, which leaks by the same route as the corrupt one: `extractEntry` finds the
      central directory but no such name and throws `ZipError("entry not found")`. Assert
      its status is **422** explicitly — that is today's answer, nothing else in the suite
      pins it, and 404 is the number an implementer would expect.)
- [x] 4.15 `if-none-match` in the **named** tiers, one cell per route, since 1.3's rule is
      "every tier" and 4.4 covers only the version-less one. Offer the tag from a version-less
      answer back with `mtime=<current>` → 304 with an empty body, and again with
      `mtime=<a stale value>` → 304 as well: the tag matches the source's current version,
      which is what the rule turns on, whatever the request claimed. Both spellings on
      `/api/file` *and* on `/api/model.glb` — four cells, which is what makes the two routes
      agreeing an assertion rather than a hope. (Each cell fails on its own if its route
      regresses; the point of writing all four is coverage of the scenario's three cases
      across both call sites, not a cross-route comparison.)

## 5. Verification

- [x] 5.1 `cd server && bunx vitest run` green, and `bun run typecheck` clean.
- [x] 5.2 `bun run format` (twice, per the script) and `bun run format:check`.
- [x] 5.3 Manual against a real library (`bun run dev`, browse a leaf kit): open a model in
      the lightbox and confirm in the network panel that `/api/model.glb` and `/api/file`
      answer `cache-control: no-cache` with an `ETag`, that a reload revalidates with 304s
      rather than re-downloading, and that the bytes, statuses and every other header are
      unchanged from `main`. Then hand-request one of the same URLs with `&mtime=<the
      listing's value>` and confirm `immutable` *and* the `ETag` alongside it. Finally
      request a path that does not exist and one inside a `.zip` that does not exist, and
      confirm both 404s carry `no-store` — the second is `onError`'s (1.4), and is the one an
      edge would otherwise be free to store.
      **Verified 2026-09-18** in Chromium against a server on 127.0.0.1:3277 serving the built
      client over the decimated corpus: the lightbox's `/api/model.glb` answered `no-cache`
      with `ETag: "1789446597239.1736-2500084"`; a reload re-requested it and the browser
      transferred 300 bytes against a 593,140-byte body — a 304, not a re-download. The same
      URL with `&mtime=1789446597239.1736` (the listing's own value, fraction and all)
      answered `public, max-age=31536000, immutable` on both routes, and `/api/file` for a
      path that does not exist answered 404 `no-store` with no `etag`.
- [x] 5.4 Confirm the desktop story by the same run: no configuration was added, nothing in
      `deploy/demo/config.json` or `DEFAULT_FEATURES` changed, and the local server's headers
      are the ones 5.3 observed (D10).
      **Confirmed**: the diff is `server/src/app.ts`, the two test files and `.ai/todo.md` —
      no configuration file, no `DEFAULT_FEATURES` and nothing in `deploy/demo/config.json`
      changed, and the headers above came from a loopback server with nothing in front of it.
- [x] 5.5 `docs/platform-surface.md` — no change expected (response headers and a query
      parameter are not an OS-specific surface). Record "no change" here after review. **Reviewed: no change** — response headers and a query parameter are not an OS-specific surface.
- [x] 5.6 Note in `.ai/todo.md` that the origin now declares both byte routes, so the
      `/api/model.glb` *ignore cache-control, TTL 1 day* rule and the `/api/file` bypass can
      become "eligible for cache, respect origin" — **after** the follow-up client change
      lands, since until then every request is version-less and an edge rule that respects
      the origin will revalidate rather than hit.
- [x] 5.7 Open the follow-up client change (append `mtime` to `fetchModel` and
      `fetchModelGlb` from the listing entry the caller already holds) as its own change or
      issue, and name it here. It is deliberately not created by this change. **Opened as issue #42**, and `.ai/todo.md` names it as the gate on flipping the edge rules.
