# Semantic Search

## Why

Deep name search answers "what is this file called". `search-matches-folder-names`
establishes why that is weak here — a library is organised by artist and set, and the
files inside are `body.stl`, `base.stl`, `supports.stl` — and fixes half of it by
letting the containing folders match. The other half does not have a textual answer at
all: nothing in the tree says a model is a dragon, a bookcase, or a wizard holding a
staff. That information is in the geometry, and no amount of widening a string
predicate reaches it.

A separate service already has it. `mini-classify` (`~/Documents/tests/mini-classify`)
holds SigLIP embeddings and a per-model pose for the same library this app browses, and
proposes a loopback HTTP surface for querying them (`docs/api/surface.md` there). It
needs nothing from this app — it renders its own views and walks its own tree — and this
app needs two things from it that it cannot compute: **which models match a phrase**, and
**which way up a model is**.

Two constraints govern every decision below.

**The two servers are independent.** Either may be down and the other is whole: with the
index absent, this app browses, searches by name, and renders thumbnails exactly as it
does today, and the semantic affordance is simply not offered. This is not politeness —
the index runs on a specific machine's GPU and cannot follow this app through the
Electron seam (architecture D1), so "absent" is a permanent supported state on some
targets, not a transient failure.

**The index sees less than the grid does.** `MODEL_EXT` here is
`/\.(stl|3mf|obj)$/i` (`server/src/listing.ts:17`); the classifier walks `.stl` only, and
neither side indexes models inside archives. A folder of `.3mf` files is fully browsable
and entirely unsearchable by meaning. Left unsaid, that reproduces the exact failure
`search-matches-folder-names` was written against: a silent miss whose message is
indistinguishable from a real one.

## What Changes

- **A semantic search action, distinct from Enter.** Enter keeps meaning name search, per
  the shipped `file-search` requirement. Meaning-search is its own control beside the
  input, because it queries a different index with different coverage and a user is owed
  the ability to tell which question they asked. (D2 — this also keeps the change free of
  a `file-search` MODIFY while two changes are in flight against that capability.)
- **Results replace the grid**, ranked by score, rendered as an ordinary listing:
  thumbnails, orbit, lightbox, and camera persistence behave identically, and the
  in-flight skeleton and latest-wins supersession apply. Score order is the server's and
  is never re-sorted — the client sorts nothing today and must keep not doing so.
- **Committing clears the live filter input**, which today keeps the submitted phrase and
  applies it to whatever is on screen. That is coherent for name search, where the filter
  and the search match the same string, and catastrophic for a search whose entire purpose
  is returning models the phrase does not name (D9). The filter stays available over the
  results; a dismiss affordance replaces erase-to-exit.
- **Availability is a first-class state, not an error path.** The Hono server probes the
  index's `/status`, caches the answer, and distinguishes *loading* (SigLIP takes real
  seconds) from *absent*. The affordance appears only where it can work: inside the
  index's collection root, and never over a zip listing.
- **Scope answers are claims about the index, never about the folder.** "41 models
  classified here" is true whatever this app's own walk believes; "41 of 55" is a claim
  the grid beside it can contradict, and two independently-cached views of one removable
  volume will drift by design.
- **Hits are assembled from this app's own view of the tree.** A hit carries no `mtime`
  or `size`, and tiles need both (thumbnails are keyed path+mtime). The join is against
  data this server already has; a hit that no longer resolves is dropped quietly, because
  under two independent caches a moved file is an expected outcome and not an error.
- **Pose orients a model without becoming its stored camera.** The index's up axis is one
  of six unit axis vectors, which are exactly the six `OrbitAxis` spindles, so it maps by
  lookup and never by a nearest-axis snap — anything outside the six is a fault to surface,
  not a value to round. It never overwrites an axis the user chose by orbiting, and
  applying it does not persist a thumbnail.
- Unchanged: every existing listing, search, thumbnail, and viewer behaviour; the walk;
  the caches. Nothing here alters thumbnail pixel output, so no `RIG_VERSION` bump.

## Capabilities

### New Capabilities

- `semantic-search`: the meaning-search affordance and its results — the distinct action,
  availability and degradation, result assembly from local listing data, stated coverage
  and its three empty states, weak-match presentation, pose application, and the view's
  URL representation.

### Modified Capabilities

- `url-navigation`: **MODIFIED** — "The URL names the committed view" enumerates its
  parameters as a closed list, so a meaning-search parameter has to join it or the shipped
  spec is false once this lands. The delta is written against the post-`search-options`
  text and the ordering is declared in tasks.md; `search-options` is the only other change
  holding that requirement, and the URL work is already gated behind it, so the two never
  need to be resolved together.

`file-search` is deliberately **not** modified. Its "Deep name search" requirement stays
literally true because Enter still routes to the name walk, and its live-filter
requirement stays true because the filter still applies to whatever listing is on screen —
this change only stops pre-populating it (D9). Two active changes already carry
`file-search` deltas (`search-matches-folder-names`, `search-options`), and a third MODIFY
of the same requirement would collide at archive for no gain.
