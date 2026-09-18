# Design — byte-route-cache-headers

## Context

`/api/file` and `/api/model.glb` (both in `server/src/app.ts`) set exactly two headers
today — `content-type: application/octet-stream` and `x-content-type-options: nosniff`,
plus `accept-ranges`/`content-range`/`content-length` on the streaming branch. No
`Cache-Control`, no validator, and the URL is `path` and nothing else.

The shape to copy is two archived changes' work, and it is already proven in this file:

- `thumbKeyOf` parses the thumbnail key once so the JSON route and the image route cannot
  key differently. Its `mtime` is `Number(c.req.query("mtime"))` — a **number**, compared
  numerically downstream against the sidecar's stored `mtime`.
- `thumbHitTiers` is the three-tier declaration: the request names the current generation
  → `public, max-age=31536000, immutable`; names another → `no-cache`; names none →
  `no-cache` plus `ETag: "<gen>"`, with a matching `if-none-match` answered 304. Anything
  that is not a hit is `no-store` at the call site.

Three facts about the byte routes shape the decisions below.

- **There is no generation to key on**, because there is no store the server writes. The
  source file *is* the state, so its mtime is the only version available — which is
  convenient, since the listing already reports exactly that.
- **`/api/file` streams ranges**, which `/api/thumb/image` does not, so `Range`,
  `If-Range` and status 416 have to be reasoned about rather than inherited.
- **`/api/file`'s zip branch never stats anything.** It hands `fsPath` (the archive) and
  `entry` straight to `extractEntry` and returns the bytes. It has no version in hand at
  all today.

## Goals / Non-Goals

**Goals:**
- Every answer from both routes declares its own cacheability, truthfully, so a cache
  rule at the edge can be "eligible for cache, respect origin" on both.
- A re-derived mesh or an edited source is a **different URL**, not a stale hit.
- The parameter is optional and its omission changes nothing but the declaration, so this
  lands with no client change and no coordination.
- Identical behaviour on desktop, in Electron and behind a CDN.

**Non-Goals:**
- Any client change (see the proposal's Out of Scope).
- Touching `thumbHitTiers` or any thumbnail behaviour.
- Making the *body* of a response depend on the new parameter. It is an assertion about
  the version, never a selector: the bytes served are always the source's current bytes.

## Decisions

### D1: The parameter is `mtime`, and its canonical form is the listing's own number

The parameter is named **`mtime`** and carries the source's modification time in
milliseconds — `DirEntry.mtime` verbatim. Rejected alternatives: `v` or `gen` (a new name
for a value the wire already has a name for, and `gen` means something else two routes
away), and a content hash (a full read of every model to answer a header).

The canonical string form is **the JavaScript decimal of that number**, i.e. what
`String(entry.mtime)` produces — `1789446597239.1736`, fraction included, no rounding, no
padding. It round-trips because JSON's number literal and JS's number-to-string are both
shortest-round-trip forms over the same IEEE-754 double: the server's `stat` produces
`mtimeMs`, `JSON.stringify` writes it, `JSON.parse` recovers the identical double,
`String` writes it again, and `Number` recovers it once more. Nothing is lost at any step.

**Rounding to an integer at the source was rejected.** `DirEntry.mtime` is already the
thumbnail key: `/api/thumb`'s `mtime` is compared against the mtime stored in every
sidecar on disk. Rounding it in the listing would move that key for every entry whose
mtime has a fraction and invalidate the cached thumbnail of every model in the library, to
save four characters in a URL.

### D2: The comparison is numeric, exact, and fails only towards *less* cacheable

The server parses the parameter with `Number(...)` and compares it to the source's
`mtimeMs` with `===`. Numeric, not textual, so `1789446597239.1736` and
`1789446597239.17360` are the same version; the `thumbHitTiers` precedent compares
`named === String(gen)` textually, which is safe there only because a generation is an
integer. Exponent form is not worth citing as the motivating case: `String(entry.mtime)`
never produces one at millisecond scale, and a hand-written `1.7894465972391736e+12`
would have to spell its `+` as `%2B` — Hono's query decoding turns a literal `+` into a
space, which `Number` maps to `NaN`, which this decision's own rule then treats as absent.

Exact equality is safe because **both sides of the comparison are `stat().mtimeMs` from
the same process against the same file** — the listing that produced the value and the
byte route that checks it run in one server. (`MeshCache`'s `MTIME_TOLERANCE_MS` exists
for a different comparison: a mtime that survived a round trip through `utimes`, which
truncates to integer milliseconds. No tolerance is wanted in *this* comparison, and a
tolerance would widen the window in which an `immutable` pin can be wrong — but note that
the tolerance still governs which GLB *body* is selected, which the Risks section records.) Cross-runtime float
differences — vitest on Node against the server on Bun — cannot arise, because no
comparison ever spans two processes.

A present parameter that is empty or does not parse as a finite number is treated as
**absent**, not as a bad request: this is a cache hint, and refusing bytes over a
malformed hint would make the parameter unsafe to add to a URL. Note that `Number("")` is
`0`, not `NaN`, so the empty case must be excluded explicitly or it lands in the
wrong tier.

Every way the comparison can fail — a stale listing, a rounded value, a proxy that
rewrote the query, a clock — yields a *less* cacheable answer with the current bytes.
There is no input that makes the server pin the wrong bytes.

### D3: Three tiers, the same three, on both routes

| the request | `Cache-Control` | validator | body |
|---|---|---|---|
| names the source's current version | `public, max-age=31536000, immutable` | `ETag: "<mtime>-<size>"` | the bytes |
| names some other version | `no-cache` | none | the current bytes |
| names no version | `no-cache` | `ETag: "<mtime>-<size>"` | the bytes, or 304 on a matching `if-none-match` |
| 400 / 404 / 422 / 416 | `no-store` | none | the error, or empty |

`immutable` is sound on the first row for the reason it is sound for a thumbnail: a source
that changes moves its mtime, so every later request for it is a different URL. `public`
is emitted unconditionally — on loopback it is just the browser's own cache, and
conditioning it on posture would be the configuration dependence D9 rules out.

The first row **does** carry the ETag, where `thumbHitTiers` emits none on its equivalent
row. The difference is ranges: `/api/thumb/image` never serves a 206, and RFC 9111 §3.3–3.4
let a cache complete or combine a partial representation only under a matching strong
validator. A download resuming a pinned URL has nothing to put in `If-Range` unless the
answer that started it carried a tag, and both components are already in hand from the
same `stat` (D9). Emitting it weakens nothing: `immutable` still says the representation
cannot change, and the tag merely lets a cache prove that cheaply for a slice.

The second row deliberately carries **no** validator, matching `thumbHitTiers`: the caller
named a version the server does not have, so it is mis-keyed and should re-read the
listing, not settle into revalidating a URL it should stop using. It is a transient state
that ends at the caller's next listing.

The fourth row is the issue's rule and the `thumbnail cacheability` suite's rule: a
failure is never stored at any hop, and carries no ETag either — an ETag on a 404 invites
a 304 that means "your miss is still current".

**Most of the fourth row is not written by these handlers at all, and that is where a
first pass at this change left a hole.** Only three of the failures are in-handler `c.json`
returns (`path is required` 400, `nested zips are unsupported` 400, `no such file` 404, plus
`/api/model.glb`'s `GlbError` 422). The rest leave by `throw` and are turned into responses
by `app.onError`: a missing or unreadable archive is `listZipEntries`' ENOENT, recaught as
`ListingError(404)`; a corrupt archive or an absent entry is a `ZipError` → 422;
`library.resolve` raises `LibraryError` 400 (outside the root, over-long) and 404 (a hidden
component). 404 is heuristically cacheable with no explicit directive (RFC 9111 §4.2.2), so
an edge rule that respects the origin would be free to store `/api/file?path=/missing.zip!/x.stl`
— precisely the case issue #36's "anything not found stays `no-store`" is about.

So the `no-store` goes on **`app.onError`**, covering every typed branch and the 500
fall-through alike. This is a **cross-route change**: every route's thrown error gains the
header, not just the two byte routes. That is the right blast radius — no route in this
server has a cacheable error, the thumb routes already set `no-store` by hand on their
in-handler misses, and one statement is both the smaller diff and the one a later route
cannot forget. Rejected: a `try`/`catch` per handler, which duplicates the statement,
leaves `library.resolve`'s throws to be caught before the handler's own body, and still
misses the 500.

Placement within `onError` is not what makes it win. `c.header` is `Headers.set`, so a
`Cache-Control` the handler had already staged is *replaced* wherever the statement sits;
it needs no head-of-function position. (The same `set` semantics is what the `ETag` problem
turns on, and why D8's helper writes nothing: a replaced directive beside a surviving
validator is the worst of both. With a pure helper the question does not arise — at throw
time nothing is staged at all.)

**The guard's refusals are not in scope, and the requirement is worded to match.**
`server/src/guard.ts` returns its three 403s directly, as middleware, before any route runs
and never through `onError`; nothing here touches it. A 403 is not heuristically cacheable
(RFC 9111 §4.2.2 lists no such status), so it is not the hole either. The spec's failure
rule is therefore about what a byte route or the shared error handler produces, not about
every refusal anywhere in the stack — widening it would be a second cross-route edit
bought with nothing.

### D4: A zip entry's version is the archive's mtime, and all three sides already agree

`shared/types.ts` documents `DirEntry.mtime` as "For zip entries this is the containing
zip's mtime", and `listing.ts` fills it from `zipStat.mtimeMs` at every zip emission site.
`/api/model.glb` stats `fsPath`, which `library.resolve` returns as the **archive** path
for a virtual path, so its staleness is already the archive's mtime, and `model-viewer`'s
*STL viewer meshes served as cached GLB* already states the rule in prose. So there is no
second rule to invent and no new one to write: what the listing hands the client is what
the byte route compares against, for a loose file and an archive entry alike.

### D5: `/api/file`'s zip branch stats the archive, and does it *before* extracting

The zip branch has no version today. It gains one `stat(fsPath)` — the archive, the same
file `library.resolve` resolved — and that stat must run **before** `extractEntry`, not
after. Ordering matters for exactly one race: an archive rewritten between the stat and
the read.

- Stat first: the version names the pre-write archive and the bytes may be post-write. The
  answer can be pinned `immutable` under a version no later listing will ever report
  again, so it is a pin at a URL nobody requests a second time. Benign.
- Stat last: the version names the post-write archive and the bytes may be pre-write. That
  pins **old bytes under the new version**, which is the URL the next listing hands every
  client. Harmful.

The same reasoning already holds, accidentally, on the other two branches — `/api/file`'s
loose branch and `/api/model.glb` both stat before they read — so the rule is uniform:
**the version is read before the bytes.**

The stat is `stat(fsPath).catch(() => null)`, and a `null` means *version unknown* → the
version-less tier with no ETag. It must not become a 404: today a missing or unreadable
archive reaches its 404 through `extractEntry`'s `ZipError` catch, and changing which
statement produces that status would change behaviour the suite pins. This is a header,
and it fails silently by design.

### D6: A 206 carries the same declaration the 200 would; a 416 is `no-store`

`Cache-Control` on a 206 is correct and wanted. A partial representation of a URL whose
version is named is as immutable as the whole one — the URL names the version, the range
names the slice, and neither can change under the other. Leaving the 206 undeclared would
reintroduce exactly the bug this change fixes, one status code down, and is how a range
request ends up bypassing a cache that the 200 populates.

A **416** is `no-store`. It is not an answer about the source's bytes but about the
request's range against the source's current *size*, and the source can grow. It keeps
`content-range: bytes */<size>` and gains nothing else.

`/api/file`'s zip branch reads the entry into memory and ignores `Range` entirely
(pinned by *ignores a range on an archive entry*). Nothing about ranges changes for it;
it gets D3's tiers on its 200 and that is all.

### D7: The ETag is strong, and the conditional forms are honoured rather than ignored

`ETag: "<mtime>-<size>"`, strong. Strong is required for `If-Range` to be usable at all,
and both components come from the `stat` D5 already makes mandatory. For `/api/model.glb`
the mtime and size are the **source STL's**, which is precisely what its GLB is keyed by,
so the tag moves exactly when the cached GLB goes stale.

The ETag is emitted on the byte-carrying answers of the first and third tiers (D3), and
never on the second. But the *evaluation* of a conditional a client offers back is
unconditional, and this is the rule both call sites obey, with no per-tier variation:

> **`if-none-match` is compared against the current tag whenever the source's version is
> known — in every tier, including the one whose answer emits no tag.**

The helper *reports* this; the call site acts on it. Nothing is written to the response
until the call site returns the bytes or the 304 (D8), so "evaluated unconditionally" and
"declared only on a byte-carrying answer" are two separate statements and neither implies
the other.

A single rule is the point. Deciding it per tier is how the two routes silently diverge:
a named-and-current request carrying a matching `If-None-Match` would be a 304 on one
route and a 200 with a full body on the other, depending only on which of them consulted
the helper. The helper answers `notModified`, both call sites use it, and neither
re-derives the question. When the version is *unknown* (the archive's `stat` failed, D5)
there is no tag to compare and `notModified` is false.

The comparison itself is `===` against the raw header, inherited verbatim from
`thumbHitTiers` — so `W/"…"`, a comma-separated list and `*` never match, and each costs
a full body rather than a 304. That is the shipped precedent's behaviour, not a decision
taken here; widening it would be a change to both helpers and belongs with whatever needs it.

- **`If-None-Match`** matching the current tag → 304 with the same `Cache-Control` and
  `ETag` and no body, **whether or not the request also names a range**. RFC 9110 §13.2.2
  (*Precedence of Preconditions*) puts `If-None-Match` ahead of `Range`.
- **`If-Range`** present with a `Range`: evaluated against the current tag. Matching →
  the 206 as today. Not matching → the `Range` is **ignored** and the whole current
  representation is answered 200, which is what RFC 9110 §13.1.5 requires and what stops a
  client stitching a slice of new bytes onto a stale prefix. `If-Range` with no `Range` is
  ignored.

This is the one place the change adds behaviour rather than headers, and it is added
*because* of the headers: ignoring `If-Range` is defensible only while the server hands
out no validator to condition on. Once it does, ignoring it is a corruption path.

### D8: A new helper for the two byte routes; it is *pure*; `thumbHitTiers` is not touched

Recommendation: extract **one new helper** used by both byte routes, and leave
`thumbHitTiers` exactly as it is.

**The helper writes no headers.** It reads the request and returns
`{ headers, etag, notModified }` — `headers` being the object literal the call site spreads
into the `c.body(...)`/`c.json(...)` it was already building, `etag` the current tag for
`If-Range` to compare against whether or not `headers` carries it, `notModified` the
verdict of D7's one rule. It does not call `c.header`.

This is the one place the change departs from `thumbHitTiers`, which sets headers on the
context and returns a boolean, and it is not a style preference. `c.header` writes into
`Hono`'s prepared headers, and *every* later response on that context inherits them —
including the ones the handler never meant to decorate. The helper has to run early on
both routes (before `extractEntry`, so a 304 does not decompress a body it discards;
before `meshCache.read` and the conversion, so a revalidation does not reconvert), and
after it every failure downstream is reached with a `Cache-Control` and an `ETag` already
staged: the 416, `extractEntry`'s `ZipError` 422 by way of `onError`, and
`/api/model.glb`'s `GlbError` 422. A context-writing helper makes each of those a leak to
be remembered and individually stripped — and `c.header` is `Headers.set`, so `no-store`
replaces the directive while the stale `ETag` survives beside it, which is a failure that
answers "not to be stored" and hands out a validator in the same breath. The spec says
those answers carry no validator; purity is what makes that true by construction instead
of by three separate deletions, each of which needs its own test to prove it happened.

The cost is one destructuring per call site. What it buys is that the rule "headers are
written on the answer that carries the bytes, and on its 304" has no exceptions to
enumerate.

Generalising `thumbHitTiers` to cover all three routes would have to parameterise the
query name (`gen` vs `mtime`), the comparison (textual vs numeric, D2), the tag's shape
(`"<gen>"` vs `"<mtime>-<size>"`) and, for `/api/file`, an `If-Range` evaluation the thumb
route has no use for. What is left in common is about six lines, and the thumb route's
contract — which is shipped, load-bearing and covered by the `thumbnail cacheability`
suite — would then be readable only through a parameter list. The duplication worth
avoiding is between the two *byte* routes, which are genuinely identical here: same
parameter, same comparison, same tag, same tiers. One helper, two call sites, and a
shipped behaviour left alone.

The two helpers stay recognisable as siblings by sitting beside each other with the tier
strings spelled the same way, so a future change to the tier vocabulary is one grep.

### D9: Each route's version, and the cost of getting it

- **`/api/model.glb` already has it.** Its handler stats `fsPath` before the `meshCache`
  read, for both a loose file and an archive entry, and holds `s.mtimeMs` in `mtime`. The
  version and the ETag cost zero additional syscalls; the route only has to declare.
- **`/api/file`'s loose branch already has it**, from the `stat` that decides the 404 and
  supplies `s.size` to `content-length`.
- **`/api/file`'s zip branch** pays one `stat` (D5) that is strictly a *duplicate*:
  `listZipEntries`, reached through `extractEntry`, already stats the archive to build its
  `ArchiveId`. The new one exists because the handler needs the numbers in its own hand and
  needs them *before* the extract (D5, and 304 without decompressing — see the tasks), not
  because they were unobtainable. On a path that already opens the archive twice — the
  central directory and the entry's bytes — a second `stat` is noise, and threading the one
  `listZipEntries` takes out through `extractEntry`'s signature would be a change to a
  shared helper for a header.

Nothing is conditional on the parameter being present: the stat happens either way,
because the version-less tier needs the same numbers for its ETag.

### D10: No configuration, no `Vary`, no posture

No configuration key, no capability flag, no `features` field. The declaration is a
property of the answer, not of the deployment, and a build that behaves differently by
posture would be a build whose desktop path is untested by the demo and vice versa.
Electron and a local `bun run dev` get bytes, statuses and headers identical to the
hosted deployment's; nothing requires a CDN, a proxy or network state to exist.

No `Vary` either — but not because the answer is a function of the URL alone, which is
false twice over: `guard` (server/src/guard.ts) answers 403 by `Origin`, and the body
varies by `Range`. `Range` needs no `Vary` because `Range`/`If-Range`/`If-None-Match` are
conditional-request machinery caches already understand, and naming them would fragment an
edge cache for no gain. `Origin` is the one that would be a real omission, and the reason
it is not is that the exposure it creates already exists and is already accepted: a
`public` edge hit can serve bytes to a request whose `Origin` the guard would have refused,
exactly as `/api/thumb/image` has accepted since it started declaring `public`. The
response carries no `Access-Control-Allow-Origin`, so a foreign origin still cannot *read*
it; the guard stops other sites, never a visitor, and confinement is `library`'s job.
Adding `Vary: Origin` would fragment the cache per requesting site to protect nothing.

No `Cross-Origin-Resource-Policy` either, where `/api/thumb/image` sets it. That header is
there because an `<img src>` is a no-cors embed that sends no `Origin` and so passes the
guard, making a guessed URL an existence oracle through `onload`/`onerror`. The byte routes
already close that with `content-type: application/octet-stream` plus `nosniff`, which makes
ORB block a no-cors embed outright — the handler's own comment says so. Adding it anyway
would also break the *Omitting the version changes nothing else* scenario, which admits the
declaration and the validator and no other new header.

## Risks / Trade-offs

- **No converter version in the GLB's key.** `MeshCache` keys on the source mtime only, so
  a future change to `stlToGlb`'s output would need the mesh cache cleared — and with
  `immutable` in play it would also need browsers to move on, which they will not until
  the source's mtime moves. Pre-existing (the server already serves a cached GLB across a
  converter change), made more expensive by a year-long pin. Out of scope; the mitigation
  if `stlToGlb` ever changes shape is a version dimension in `MeshCache`'s file name, and
  that is the change that should carry it.
- **The win is deferred.** Until the follow-up client change appends `mtime`, every
  request lands in the version-less tier and the edge gets a revalidation, not a hit. That
  is the deliberate cost of a server-only change, and the revalidation is itself an
  improvement on today's unconditional re-download.
- **An `immutable` pin is a year long.** The safety rests entirely on D2's comparison never
  yielding a false *current*. It cannot: both sides read the same file's `mtimeMs` in the
  same process, and every other outcome degrades to `no-cache`.
- **A filesystem that does not move mtime on write** — a rewrite within the same
  millisecond on a coarse-resolution filesystem — would pin stale bytes. This is already
  the thumbnail cache's and `MeshCache`'s exposure on this app's only supported platform,
  and this change does not widen the rule, only the consequence's lifetime. `MeshCache`
  brings a millisecond of its own: `read` accepts an entry within `MTIME_TOLERANCE_MS = 1`
  of the source's mtime, because `utimes` cannot reproduce a fractional mtime exactly. D2's
  "no tolerance" is about the *version comparison* only — the GLB body pinned under version
  V may still be one converted from a source up to 1 ms either side of V. The same
  sub-millisecond rewrite that defeats the mtime key defeats this too; it adds no new
  failure, only a second millimetre to the same window.
