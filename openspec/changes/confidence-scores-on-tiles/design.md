## Context

The index answers a scored query with a `score` (pooled cosine) and a `z` (robust z,
median/MAD) per hit. Both cross the wire into this server — they are fields of `Hit` in
`server/src/semantic.ts` — and both die at the join: `hitsToEntries` returns `{entries,
poses}` and nothing else, and the two routes in `server/src/app.ts` that call it (the
semantic branch of the search route, and `/similar`) forward only that pair.

That was deliberate. `semantic-search` D10 recorded two reasons: a measurement, that
model-to-model cosines run 0.85–0.99 while text-query cosines run ~0.1 over 200 random query
models — which is also why the index publishes no `weak` flag for neighbours, its 2.0
threshold having been fitted to the other distribution — and a plumbing cost, that `DirEntry`
has no room for a per-result number, so carrying one meant widening a shared type or
threading a parallel map to the grid.

The measurement stands. This change disagrees only with the conclusion drawn from it: that
the fix for two incomparable scales is to print neither, rather than to say which one you
are looking at. The plumbing objection was void before the change that raised it had
finished shipping: D10's text was written into `semantic-search`'s design.md in `3b49bce`,
and `poses` — a per-path sidecar map beside the entries, which is exactly the parallel map
D10 named as the costly alternative — landed hours later in that same change's own
implementation, `3fd71a3`. So this is not a shape to invent, and not a precedent some later
change established either: it is what `hitsToEntries` has returned since the day it was
written.

## Goals / Non-Goals

**Goals:**

- Show the index's two numbers per scored result, on the tile and in the lightbox's info
  panel, without a hover or a setting.
- Make the scale legible on the badge itself, so a `/similar` cosine cannot be read against
  a `/query` cosine.
- Leave directory listings, flat searches, zip listings, and every cached thumbnail exactly
  as they are.

**Non-Goals:**

- Any derived confidence figure — a percentage, a band, a bar, a star rating. The index's
  thresholds are stated against its own numbers; a number computed here would not be one.
- Filtering or sorting by score. `minScore` already exists as a query control and belongs to
  the request, not to the display.
- Pose confidence. `IndexPose` carries a `confidence` and it is a third, unrelated number —
  how sure the index is about which way is up, not how well the model matched. Out of scope.
- Reversing the set-level `weak` marking, which stays as it is.

## Decisions

### D1: A sidecar map keyed by resolved path, not a widened `DirEntry`

`hitsToEntries` gains a third returned map alongside `entries` and `poses`, keyed by the same
resolved absolute path it already keys `poses` by, carrying `{score, z}` per hit. The wire
shapes `SemanticListing` and `SimilarListing` gain the matching optional field, and the
client threads it exactly where `poses` is threaded: `Landed` in `client/src/state/reducer.ts`
takes it as optional residue, the `landing` case copies it onto `Result`, and `App` reads it
off `state.result` the way it reads `poses`.

*Why not `DirEntry`:* `DirEntry` is the type every listing route returns. A score field on it
would be `undefined` for every directory, zip entry, and flat-search hit in the app, which
makes "no score" a state each of those code paths can now represent and get wrong. Keyed by
path in a map beside the entries, a listing that never carries scores cannot accidentally
carry a broken one — the map is simply absent.

*Why the same key as `poses`:* the resolution requirement already drops a hit that stats to
nothing. Keying scores by the entry's resolved path makes "no entry" and "no score" the same
fact rather than two facts that could disagree, and a stale hit falls out of both at once.

### D2: The label carries the scale — this supersedes D10

The cosine badge reads `k` in a meaning search and `sim` in a similarity view. This is the
whole of this change's answer to D10, and it is worth stating why a label is enough where
D10 judged it was not.

D10's worry is a *comparison*: 0.912 beside 0.107 reads as "eight times the match". That
misreading needs the two numbers to look like the same measurement. Two differently-named
quantities do not invite it — nobody compares a temperature in °C against one in °F by
subtracting them, because the unit is on the number. D10 reached for withholding because at
the time there was no tile decoration at all and no place to put a unit; adding the number
meant adding the *only* new tile decoration the change needed. That cost is now being paid
deliberately rather than avoided.

*Alternatives considered:*

- **Same label, different tint.** Rejected: the distinction then lives entirely in colour,
  which a screenshot, a colourblind user, or a copied value loses.
- **Rescale each route's band onto a common 0–100.** Rejected: it invents a number, and the
  invented number cannot be checked against the index's own `WEAK_Z = 2.0` or against
  anything printed by the index's REPL. It also directly contradicts showing raw values.
- **Meaning search only, no badges in the similarity view.** Rejected: it is D10 again for
  half the app, and the similarity view is where a number is arguably most useful — a
  neighbour set has no `weak` flag at all, so the ranking is *literally* all a user has there
  today.

### D3: Provenance is derived from the view, not stored per result

The label is not a field on the wire and not a field on the per-tile record. `Result.forView`
already names the question the result answers, and `Subject` in `client/src/state/view.ts`
has three arms — `none`, `query`, `similar` — of which exactly two name a scoring route. The
label is read off that.

*Why:* a provenance field on each record would be the same string repeated across sixty
tiles, derivable from state the client already holds, and capable of disagreeing with the
view it is rendered in. Deriving it means a result can only ever be labelled as the thing
that asked for it.

*Consequence to honour:* where the subject is neither arm — a name search, a plain listing, a
stand-in listing rendered while a meaning query is deferred — no label exists, so nothing is
drawn. That is the correct behaviour and it falls out rather than being special-cased. A
future third scoring route must extend the union to be rendered at all, which is the failure
mode we want: unlabelled is unrendered.

### D4: Raw values at fixed precision — cosine to 3 places, z to 2

Neither number is rounded to a common width. The cosine gets three decimals because
text-query values cluster near 0.1 and adjacent results differ in the third place — at two
decimals a run of genuinely distinguishable results all print `0.11`, which is worse than
printing nothing since it asserts a tie that does not exist. The z gets two because its one
meaningful landmark is `WEAK_Z = 2.0` and its useful range is roughly single digits; a third
decimal would imply a precision the MAD estimate behind it does not have.

### D5: Badges are DOM over the image, never pixels in it

The corners are absolutely-positioned elements inside `Tile`'s existing `data-tile-content`
element, which is already a positioned containing block, over the `<img>` rather than
composited into it. So `RIG_VERSION` does not move, no `.png` in the thumbnail cache is
invalidated, and the same cached image serves a model whether it is being browsed or being
scored. A badge painted into the render would have made the score part of the cache key,
which is how a thumbnail ends up re-rendering every time a query changes.

### D5b: The badge outranks the orbit overlay rather than being redrawn on it

*(Added 2026-08-27, after the badges were found to vanish on every press.)*

The orbit overlay is a `fixed z-30` layer with an opaque background, drawn over
the tile a press promotes. At the default z it simply covered the numbers, for
exactly as long as the user was looking at the model they describe. The badge
carries `z-[35]` instead: above the overlay, below the lightbox's `z-40` and the
entry menu's `z-50`, both of which are meant to cover a tile entirely.

*The premise was checked, not assumed.* A z-index only outranks a `fixed` layer
when the two resolve in the same stacking context. Walking a tile's ancestors in
the running app: every one is `position: static`, `z-index: auto`, with no
transform, filter, opacity, isolation or containment. So both resolve against
the root context and 35 wins. This is the one fact the decision rests on, and it
is the one a future change could silently break — an ancestor that gains a
`transform` or an `isolate` would trap the badge below the overlay again.

*Rejected: drawing a second pair on the overlay itself.* Tried first, on the
assumption above being false. It fails on its own terms even setting that aside:
`overlayRectFor` measures the `<img>`, and a thumbnail is always square (512² at
aspect 1) while the tile's content box is wider — 183px inside 203px, measured.
So the overlay's corners are not the tile's corners, and the badges jumped ten
pixels inward on every press. Making them line up would have meant either
teaching the overlay the tile's content box, or suppressing the tile's own pair
while its overlay was up — two mechanisms, a shared component, and a `orbitingPath`
prop threaded through the grid, to reproduce what one CSS property already does.

### D6: Per-tile values, following the `marked`/`anchor` pattern

`Tile` is memoized specifically so that marking one tile does not re-render the other 499,
which is why it takes `marked` and `anchor` as per-tile booleans rather than taking the
marked path. Badge props follow: `Grid` looks the record up per entry and passes the value,
not the map. The map's values are stable references off the landed result, so the memo
compares them by identity and a re-render that changed nothing passes the same object.

### D7: The panel's rows are additions, not a spec change to the lightbox

`model-viewer`'s "Lightbox expanded view" requirement enumerates what the info panel
contains — name, path, format, size, modified time — but as a floor rather than a closed
list, since it goes on to require the action affordances and the copy affordance beside them.
Two more rows do not contradict it, so it is left alone. The rows are specified in
`semantic-search` instead, where the concern lives: they exist because the result was scored,
not because the lightbox exists. This also keeps this change off a requirement that is
already the longest in the repo and a collision risk for anything else touching the lightbox.

`ViewerLayer` receives the values the way it receives `pose` — `App` looks them up by
`viewer.entry.path` and passes them in — so nothing new is threaded to reach the panel.

### D8: The spoken form spells out what the corner abbreviates

A model tile states its accessible name — `Tile`'s button sets `aria-label` — so a number
drawn inside it is announced to nobody: an accessible name replaces the element's contents
rather than joining them. The badges therefore reach the label explicitly, the way `anchor`
already does rather than trusting its visible caption to be read.

In the label the numbers are named in full: the cosine as `cosine` in a meaning search and
`similarity` in a similarity view, the z as `z`, which is its whole name.

*Why not the badge's own text:* `k` is legible in a corner because sixty tiles carry the same
label and the view overhead says which search produced them; read aloud, on its own, it is a
letter. It is also a letter this app already spends — `SIMILAR_K` and the `k` in a similarity
URL are the neighbour *count*, not a score — and the spoken form is where that collision gets
settled, since it is the one surface with no reason to be terse. The corners stay short
because room there is the constraint; the label has no such constraint and should not imitate
one.

## Risks / Trade-offs

- **A weak set whose tiles show z under 2.0 looks like the UI contradicting itself.** →
  It is not a contradiction: z under 2.0 across the set is precisely what "weak" is measuring,
  so the number and the marking agree. The spec keeps the marking a statement about the set
  and says so explicitly, and the badge never restates it.
- **Badges obscure the model at the smallest grid width.** → Corner-anchored, small type,
  translucent backing; the grid's minimum tile is 11rem, so two short badges leave the centre
  clear. This is a pixel judgement, not a code one — see Open Questions.
- **A future reader finds D10 in the archive and re-reverses this.** → D10 is named and
  superseded here rather than contradicted silently, and the delta spec rewrites the retired
  scenario under its original title rather than deleting it, so the trail survives archive.
- **`k` on a tile is a letter that already means the neighbour count here.** → Recorded
  rather than resolved: the visible label stays short, and D8 settles the ambiguity in the
  accessible name, which is where a reader who does not already know the vocabulary meets it.
  The two never appear together — a similarity view's cosine is labelled `sim` — so the
  collision is between a badge and a URL parameter, not between two things on screen. Revisit
  if `k` misreads on real results; the label is one string in one derivation (D3).
- **Two changes in flight over `Grid.tsx`.** → `thumbnail-sweep-priority` adds an
  `IntersectionObserver` over the same tiles. Hard ordering is declared in `tasks.md`.
- **The wire grows a field two routes must both remember to send.** → Both call the same
  `hitsToEntries`, which returns the map; a route that forgets it drops badges silently rather
  than erroring. Covered by a server test per route.

## Migration Plan

Nothing to migrate. Every new field is additive and optional, so an older client against a
newer server ignores it and a newer client against an older server renders no badges. No
cache is invalidated and no thumbnail re-renders (D5). Rollback is removing the render;
the wire fields can stay.

## Open Questions

- **Badge legibility over a light model on a light background** needs judging on real
  fixtures at the smallest grid width, not asserted here. The `tasks.md` line covering the
  badge styling stays open until the pixels are looked at, per the repo's rule about
  visual-tuning clauses.
- **Whether the panel should spell the labels out** (`cosine` / `similarity` rather than `k` /
  `sim`) where there is room for words. Decided for now to match the tile exactly, so the two
  surfaces cannot be read as reporting different things; revisit only if the short labels
  prove opaque in the panel's context. D8 does not already settle this: it spells the scales
  out in the *tile's* accessible name, which the tile needs because it states its name rather
  than composing it from its contents. The panel has no such mechanism and needs none — its
  rows are a `<dl>`, so whatever the `<dt>` says is what is read — which means the panel's
  labels are one decision, visible and spoken together, and it is this open question.
