# Design — semantic-search

## Context

`server/src/app.ts` makes no outbound request today and has no configuration mechanism
beyond `envLimit` (`listing.ts:265`). `guard.ts` refuses any non-loopback `Origin` or
`Host` on `/api/*` and never emits CORS headers, so the browser tab is not a candidate
caller of a second local service. `shared/types.ts` defines what a tile is (`DirEntry`:
kind, size, mtime, format) and what a camera is (`CameraState`: `az`, `el`, `distR`,
`target`, all four required, all bounds-relative) and what an up axis is (`OrbitAxis`:
six values, persisted per path in the thumbnail sidecar).

The index side is specified in `~/Documents/tests/mini-classify/docs/api/surface.md`
(proposal). Relevant shapes: `POST /query` returning `{scope, weak, best_z, truncated,
results: [hit]}`; `hit` = `{id, path, rel_path, name, score, z, pose}`; `pose` =
`{up, azimuth_zero, source, confidence, front: {view, azimuth_deg, elevation_deg} |
null}`; `scope` = `{path, status, n_indexed, n_scanned, covers}`; `GET /status` carrying
cache identity, `collection_root`, and a required `ready` flag.

Measurements this design leans on were taken 2026-08-18 against the real library and are
recorded in `listing-tree-cache`: 2.405 ms/entry cold on the spinning exfat volume, ~32s
for a complete walk, ~6.7s of zip-tail seeks surviving a warm filesystem.

## Goals / Non-Goals

**Goals:**
- A phrase finds models whose names never mention it.
- Neither server needs the other to be correct, and the absence of the index costs this
  app nothing at all.
- A user can always tell which index answered, and what that index cannot see.

**Non-Goals:**
- Embedding, classifying, or rendering anything here. This app queries an index; it does
  not build one.
- Indexing archive contents or non-STL formats. Both sides exclude them; this change
  reports the gap rather than closing it.
- A local cache of query results or embeddings. See D6.
- Packaging the index. It is a dev-machine dependency (architecture D1); the app degrades.

## Decisions

### D1: The Hono server is the only caller; the client goes through `ApiClient`

The client never talks to the index. Three reasons, in descending order of force: the
guard's design assumes exactly one local origin serving this app and CORS is deliberately
never emitted; all client I/O goes through `ApiClient` so the Electron port swaps HTTP for
IPC without touching callers (architecture D1); and the hit-to-tile join (D3) needs the
listing data that lives server-side anyway. The index's URL is an `envLimit`-style
setting, and `fetch` with `AbortSignal.timeout` keeps the Hono app runnable on Node
unchanged.

### D2: A search mode, not a second action

Meaning search is a **mode** the search input runs in, selected by an option that lives
with the other search options in the panel tab and is reflected where the grid can be
seen. Enter submits whichever search is in force.

The alternative this change carried until now — a separate action beside Enter — was
argued on two grounds and both were wrong. Specification: it avoided a `file-search`
MODIFY, which is worth something, but not the shape of the feature; and the ordering that
avoids the collision (behind `search-matches-folder-names`) is one this change needs
anyway. Behaviour: it claimed a distinct action keeps an empty grid attributable, when in
fact two buttons leave nothing on screen recording which one was pressed, while a mode is
persistent visible state. The attribution argument favours the mode and was stated
backwards.

A mode also inherits machinery this app is already building. `search-options` establishes
that an option which changes *which results exist* is sticky per profile, carried in the
URL, and re-issues a committed search when it changes. A corpus selector is that kind of
option in its strongest form, and the re-issue rule gives the feature its best affordance
for free: search a phrase by name, get nothing, flip the mode, and the same text runs
against the index without being retyped.

**An unavailable mode must not be a silent one.** Mode is persisted and shareable, so a
stored or linked `meaning` can arrive on a machine where the index is absent. The client
falls back to name search and says why. Silently answering a different question than the
one the URL names is the failure this whole change is trying to avoid.

**Options that do not apply to the mode in force are hidden rather than inert.** Folder
matching has no meaning against an embedding index, and the folders/models kind option
nearly none, since the index returns models only. A control that is visible but does
nothing is worse than one that is absent.

### D3: Hits are joined to this app's own listing data, never trusted for tile metadata

`hit` carries `path`, `rel_path`, and `name` — no `mtime`, no `size`, and tiles need both
(`DirEntry`), because thumbnails are keyed path+mtime. The join target is this server's
own view of the tree: one `stat` per returned hit, plus `listing-tree-cache`'s snapshot as
an opportunistic shortcut where one happens to cover the hit. Note which of those is the
common case — the snapshot is keyed by *walked root*, and a meaning search scoped at
`Kits/Baal` finds a snapshot under that key only if someone walked exactly there, so the
`stat` path is the expected path and the snapshot is the lucky one. That makes the result
bound (D8) the thing that governs cost: at the measured 2.405 ms/entry cold, 60 hits is
~0.15s and 500 would be ~1.2s.

The counts are reported with the attribution each one has earned. `n_indexed` is a pure
claim about the index and is always true. `n_scanned` is not: it is the last classify
run's walk *minus whatever had already vanished when the index loaded its file list*, so
it tracks the folder loosely, can shift across a `/reload`, and sits somewhere between an
index claim and a stale folder claim. Neither is combined with this app's own count into a
ratio — "41 of 55 here" is exactly the sentence the grid beside it can contradict, and
under two independent views of one removable volume it will. Which formats the index can
hold comes from its published `covers`, not from a constant here: this app's model set is
`.stl`/`.3mf`/`.obj` and the index's is narrower today, but hardcoding that difference
makes this app wrong on the day the classifier gains a format.

This is what keeps the two caches from having to agree. A hit that resolves to nothing is
dropped from the grid without an error: `id` is the stem plus 6 hex of the relative path,
so a moved file is simply a different model as far as the index is concerned, and drift
between two independently-cached views of one removable volume is the expected steady
state, not a fault.

The same rule governs counts. The index reports what *it* knows — how many models under a
scope it has embedded, and how many the last classify run saw. Those are claims about the
index and are always true; a claim about the folder ("41 of 55 here") can be contradicted
by the grid printed beside it, and would additionally be wrong for a `.3mf` folder, which
is fully browsable and wholly unindexable.

### D4: Availability is probed and cached, not discovered per query

The probe is `GET /status`, issued at server start, on failure, on explicit retry, and —
while the index reports itself warming — on a bounded backoff. Never per query. Two states
must be distinguished, and a probe that only checks for a response cannot: SigLIP takes
seconds to load, so a *warming* index looks exactly like an *absent* one, and the
affordance would flicker on every restart of that service. The index binds before it warms
and carries a required `ready` flag, so warming is observable rather than inferred, and
this side treats it as "not yet" rather than "not there".

Warming is the one state that must be re-checked without the user asking, which is why it
gets the backoff: an index that was loading when this server started would otherwise stay
unavailable until something else failed. The backoff is also why `/status` reporting
elapsed-since-start is worth having — not as an ETA, which would be a guess presented to a
user as a fact, but as the only cheap way to tell *warming* from *wedged* and to stop
re-probing a load that has plainly gone wrong. A query that races the probe and gets a 503
is folded back into the warming state, not surfaced as a failure.

`collection_root` from `/status` is the only scoping there is: this app has no configured
root — `/api/dir` accepts any absolute path and completion spans the filesystem — so
whether a browsed path is even addressable by the index is a question only `/status` can
answer. Compare realpaths, not strings: the library is on removable media and remounts
move the prefix (`/run/media/masa/STLLibrary` → `…STLLibrary1`) without changing the tree.

### D5: Pose is advisory — mapped exactly, non-destructive, unpersisted

The index's `up` is drawn from a fixed set of six unit axis vectors — pose resolution picks
a winner from that set and returns it unchanged — which is exactly the six `OrbitAxis`
spindles. So the mapping is a lookup, and **not** a nearest-axis snap. The distinction is
the whole decision: a defensive snap would silently absorb a defect on the index side,
rounding a vector that should never exist into a plausible-looking spindle and persisting
it. A value outside the six is a fault in the index, and this app surfaces it as one —
ignoring the orientation and opening the model as it would with no pose at all — rather
than rounding it away. There is nowhere in the client or the thumbnail sidecar to put an
arbitrary rotation anyway, so a snap would buy nothing but the concealment.
`confidence` accordingly reads as confidence in *which of six*.

Two non-destructive rules follow, and both matter because camera state is keyed by path
alone and shared with thumbnails. A stored `axis` — one the user established by orbiting —
wins over a pose. And applying a pose does not run the persist path: an orbit's pointerup
queues a full thumbnail re-render, so a pose that wrote through would silently re-render a
tile at an angle the user never chose. A pose sets up the live view; the user's own
subsequent orbit persists, exactly as it does now.

**The azimuth needs a per-axis offset, and this is the trap.** Two true statements compose
into a false one: `up` maps 1:1 onto `OrbitAxis`, and under spindle `'z'` this app's
azimuth convention already matches the index's (`stateDirection`,
`client/src/three/camera.ts:63`, puts `az = 0` at `b = +X` increasing toward `a = +Y` —
CCW about +Z from +X). It does not follow that setting the spindle to the model's up axis
and passing `azimuth_deg` through is correct. The index's angles are measured *after*
rotating the mesh so `up` points at +Z; this app never rotates a mesh — the spindle is how
it expresses a non-Z-up model — so the rotation the index assumes has to be paid for in
the azimuth instead:

**The offset is derived, not tabulated.** The pose carries `azimuth_zero`: the model-space
direction azimuth 0 is measured from. Since this app's `az = 0` points along the spindle
frame's `b`, the offset is the angle from `b` to that direction about the spindle —
`atan2(u₀·a, u₀·b)` for `u₀ = azimuth_zero`, `(s, a, b) = frameFor(axis)`. Nothing about
the index's rotation implementation is compiled in; a change there arrives as a different
value in a field already being read, rather than as a constant that silently stopped being
true.

It lands on these six values, which are the test expectations and *not* the contract:

| `up` | derived offset |
|---|---|
| `z`, `-y`, `-x` | 0° |
| `y`, `-z` | +90° |
| `x` | −90° |

Verified here two ways against a port of the index's `rotation_to_z_up` over a 24×5 az/el
grid: the constants and the derivation agree, each with residual ≤5e-16, while the
direction error from passing `azimuth_deg` through unmodified is 1.414 — a full quarter
turn, not a skew. Note the offset is not a function of `azimuth_zero` alone: four of the
six ups report the same `[1,0,0]` and split between 0° and +90°, because the spindle frame
is half the calculation.

The failure shape is what makes this a decision rather than a code comment, and it is
structural rather than a property of any one cache: the shortcut is wrong for three of the
six axes, and `y` — the most common up axis in the library — is one of them. Measured on
the primary cache (`embed-cache2`, 2,945 models): `y` 1118, `z` 1043, `-z` 226, `-y` 207,
`x` 176, `-x` 175, so passing `azimuth_deg` through is a quarter turn out for 1,520 of
2,945 — 52%. Cite the cache when citing that number; the smaller test cache
(`embed-cache4`, 133 models) is 106 `z`-up and gives 14%, which reads as a bug that hides
rather than one that announces itself. Both argue for the same decision, and all 2,945
poses being one of the six is the strongest evidence yet that the enumeration is real.

`azimuth_zero` is perpendicular to `up` by construction, which makes it self-checking: a
pose where it is not is malformed in the same way an `up` outside the six is, and gets the
same treatment (D5's fault rule) rather than a best-effort projection.

What the pose does *not* supply is `distR` and `target`; those stay the viewer's, which is
what "describing an orientation, not a shot" means in practice.

### D6: No new cache

The two things worth caching are already cached on the side that owns them: the tree here
(`listing-tree-cache`), the embeddings and the pose there. A query-result cache would key
on free text and serve the repeat query, which is not the case anyone waits on; an
embedding cache here would duplicate the index's reason to exist. The one thing this
change caches is the availability probe (D4), which is a boolean about a process, not data
about the library.

### D7: Virtual paths never leave this server

Zip entries are addressed here as `foo.zip!/entry` (architecture D6). The index rejects
any path containing `!/` as malformed, and rightly — no archive-resident model has an
embedding. Rather than rely on that rejection, the affordance is not offered while
browsing a zip or a directory inside one, so the failure is prevented rather than
reported.

### D8: The result bound is this app's, and it is not truncation

`top` and `cap` are not interchangeable on the index side: `cap` (500) bounds a
`min_score` query, while a top-N query is bounded only by `top`, which defaults to 10.
Ten tiles is not a grid, so this app chooses the bound rather than inheriting a default
meant for a REPL: **60**, tunable at apply. The reasoning is the thumbnail sweep — 500
cache misses is ~168s of pure I/O on this hardware, and relevance decays long before that
many results are worth rendering.

It follows that the index's `truncated` flag is the wrong affordance and is not reused. It
reports `cap` biting, which never happens in the mode this app uses, and more
fundamentally a ranking has no horizon: there is always an N+1th model, so "there are
more" is not news. The honest statement is that these are the strongest matches, which is
a different sentence from the name search's "the walk ran out".

### D9: The search input holds the query; filtering is not its job

An earlier version of this change cleared the search input at commit, because
`submitSearch` (`client/src/App.tsx:186`) leaves the committed text in the box and
`filteredListing` (`:325`) applies it to whatever is on screen. For name search those two
agree by design — `search-matches-folder-names` makes both match the relative path — so
filtering over results is a refinement. A meaning search returns models whose names do not
contain the phrase, which is its purpose, so the same text would render "The filter is
hiding everything below." (`:537`) over exactly the results the user asked for.

Clearing the input fixed the hiding and cost the phrase: refining a query meant retyping
it, in the workflow where getting the phrase right first try is least likely.

`find-in-listing` removes the cause instead. Once filtering is a summoned find control,
the search input holds the query and nothing else, and every symptom goes with it — no
clearing at commit, no suppressing the boot and popstate seedings (`:58`, `:263`), no
dismiss affordance invented to replace erase-to-exit, and narrowing still available over
meaning results. This change therefore states nothing about filtering beyond depending on
that separation having happened.

*Recorded because the reasoning is easy to lose:* the defect was never that the phrase was
in the box. It was that one box had two jobs and only one of them was ever going to be
right for a new corpus.

## Risks / Trade-offs

- [Index drift: hits pointing at moved or deleted files] → dropped quietly (D3), which is
  correct but silent; if a search returns 10 hits and 6 resolve, the user sees 6 with no
  explanation. Mitigation deferred deliberately — say something only if it proves common,
  since the honest message ("the index is out of date, re-run the classifier") is a
  workflow prompt, not an error.
- [Coverage gap reads as absence] → the empty states name the corpus (STL, outside
  archives). This is the one place the change spends UI words rather than saving them,
  because it is the failure mode `search-matches-folder-names` was written against.
- [Removable volume remounted elsewhere] → realpath comparison (D4); a genuinely different
  mount is a correctly unavailable affordance, not a wrong answer.
- [Electron seam] → a Python service on a 4060 does not package into an Electron sidecar.
  The degradation path (D4) is not a fallback for this target, it is the behaviour.
- [GPU contention with the index's other users] → bounded by construction: this app issues
  one query per explicit action, never per keystroke, because typing is already a
  client-side filter that issues no requests.
