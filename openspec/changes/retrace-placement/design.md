## Context

Three facts fix the shape of this change.

The grid scrolls inside `<main ref={mainRef} className="… overflow-auto">` in `App`, and
`Grid` already receives that element as `scrollRoot` for its band observer. The window
never scrolls, so `history.scrollRestoration` is inert here; whatever restores position is
this app's.

Back is one dispatch, `{ type: 'restore', view }` from `onPop`, and the reducer's
`restore` branch has two outcomes. When the entry asks the same question as the answer on
screen (`sameQuestion`), it *patches* — the grid never re-renders and the scroll position
survives untouched; this is why closing the lightbox does not lose your place. When the
question differs, `askCommitted` re-fetches, `showSkeleton` replaces the grid, and the tiles
that land start at the top. That second path is the loss.

The reveal (`entry-actions`) already solves the timing half. `App` holds `pendingReveal`,
and an effect applies it only on a settled answer — `state.result !== null`, no `inflight`,
no `failure` — honouring it when the entry is in the listing that landed and dropping it
silently otherwise (the *honor-or-drop* pattern, its own comment's words). The tile then
scrolls itself into view, centred, in `Tile`'s `useEffect` on `marked`. Tile boxes are
declared aspect-square (Grid's `ThumbView` comment), so the grid's geometry is fixed the
moment entries render, before any image loads: a placement applied at that instant is
stable.

History state is already ours to stamp: `commitUrl(view, { replace, state })` writes what
it is given, `LIGHTBOX_ENTRY` marks a lightbox push, `SIMILAR_ENTRY(depth)` marks a
similarity excursion, and a dismissal is `history.go(-depth)` — a *pop*, not a navigation
of its own. What the browser will not do is let a page read any entry but the current one.

## Goals / Non-Goals

**Goals:**
- Back, Forward and a dismissal land where that history entry was left, to the pixel when
  nothing changed and to the tile when something did.
- ↑ lands where the parent looked when the user went into the child, found by the
  history that led here, and falls back to centring the child folder, then the top.
- Every other arrival lands at the top: a tile click, a typed path, a deep link, a new
  search or similarity view (save the reveal, which centres the located entry as today).
- One placement mechanism, so the reveal and the restore cannot drift apart.

**Non-Goals:**
- Remembering a folder's position across sessions or by path. The user rejected a
  per-listing memory as myopic: the same folder has different right answers at different
  points in history, and only history knows which visit led here.
- Restoring anything history does not carry: the narrow-by-name filter, the reveal mark,
  the lightbox's own state. Each stays ephemeral for the reasons its owner recorded.
- Changing what ↑ does to the view beyond the path. It keeps `flat` (the reveal's rule:
  "that choice belongs to the user, and an action that rewrote it would make the setting
  untrustworthy").

## Decisions

### D1: A placement is an anchor tile and an offset, not a scroll offset

`{ anchor: <library path>, offset: <px> }`: the first tile whose box crosses the
scrollport's top edge, and `tile.top − scrollport.top` (zero or negative). Applying it
sets the scroller so that tile's top sits at that offset again. Reveal is the same record
with `align: 'center'`, offset ignored.

Why not `scrollTop`: it is right only in the window it was measured in. A resize between
leave and return changes the column count and every row's height; a listing that grew or
shrank shifts everything below the change. The anchor survives both, and the offset makes
it exact when nothing moved. The measurement is one `getBoundingClientRect` per tile until
the first crossing, at scroll-settle time, off `mainRef`; the apply is one arithmetic line
against the found tile's rect.

### D2: Recorded continuously, into a session mirror of the history stack

The placement of the *current* entry is written on every scroll settle (throttled), not
"on leave". Leaving by Back is a `popstate`, which fires after the browser has already
moved; there is no hook that runs before it. Recording as the user scrolls means whatever
leave happens, the latest placement is already filed.

Where it is filed: the browser exposes only the current entry's `state`, so ↑'s walk needs
a mirror. `commitUrl` stamps `{ idx }` into every entry's state, merged with the markers it
already writes; a session-scoped store (`sessionStorage`, key `mb:trail`) holds one row per
index — `{ idx, listing, placement }` where `listing` is the entry's view minus its model,
serialized as `sameListing` compares. A push at index *i* prunes every row above *i*, as
the browser prunes Forward, and appends *i+1*. A boot with no `idx` on the state is index 0,
written with `replaceState`. An entry whose index the mirror does not know is treated as
having no placement — fresh, top, never wrong.

`sessionStorage` because history state itself survives reload and the mirror should match
it; a tab is a session, and a new tab starts clean. Capped at a few hundred rows.

### D3: ↑ walks the mirror back to the nearest entry whose listing is the parent

From the current index downward, the first row whose `listing` equals the parent's — the
parent path with the *current* flat state and no subject. That is the visit that led here:
after `parent → child → search → dismiss → child → ↑`, the parent's row is three back and
still found; after `parent → child → grandchild → ↑ → child → ↑`, the second ↑ finds the
parent's original row, not the child's. The parent's most recent visit on some other branch
is exactly what is *not* wanted, and the mirror's pruning on push is what guarantees the
walk never sees a branch the user left.

The "sly" alternative — make ↑ a `history.back()` when the parent is the entry behind —
was weighed and declined: it is only sometimes the adjacent entry, and `history.go(-n)`
would discard the Forward entries in between, so ↑ would silently rewrite Forward.

### D4: One fallback chain, decided by the tile lookup, not by comparing views

```
  ↑ lands the parent, in the CURRENT flat state
    1. the parent row's anchor tile is in the listing that landed → it, at its offset
    2. the child folder tile is in the listing → it, centred   (never in flat)
    3. otherwise                                               → top
  Back / Forward / dismiss
    1. this entry's anchor tile is in the listing → it, at its offset
    2. otherwise                                  → top
  everything else → top
```

The anchor's presence is the arrangement test. An anchor that is a model survives a flat
toggle and places correctly; one that is a folder does not exist in flat and falls through.
No flat comparison, no special case: `entries.some(e => e.path === anchor)` is the whole
test, which is the check `pendingReveal` already makes.

### D5: Applied at the settled landing, once — the reveal's honor-or-drop shape

A pending placement request is set by whichever navigation raised it (`onPop` reads the
mirror; `goUp` walks it; the reveal centres; every other landing requests the top), and one
effect applies it when the answer is settled, then clears it. It replaces the tile-level
`scrollIntoView` in `Tile`: the grid is handed the placement and the scroller, and the
arithmetic happens in one place against `scrollRoot`. `marked` stays what it is — the
highlight — and no longer scrolls.

Applied once: a listing that lands twice (the stale follow-up, a peek) may shift rows after
the user has been placed. Accepted; re-applying would fight a user who has already started
scrolling, and the shift is rare and small.

"Arriving lands at the top" is made explicit rather than inherited. Today a fast landing
with no skeleton keeps the old `scrollTop`, clamped; a fresh entry's request is `top`, so the
scroller is set to 0 on that landing.

### D6: The band observer needs nothing

`Grid`'s band observer is an `IntersectionObserver` on `scrollRoot`; a programmatic scroll
fires it exactly as a user's does, so thumbnail priorities follow the placement with no
call from here.

## Risks / Trade-offs

- [The mirror and the browser's stack disagree] → Every push goes through `commitUrl`
  today; the index on `history.state` is the integrity check, and an unknown index means
  "no placement", which is the top — the behaviour before this change.
- [Recording on scroll costs work on a 2,000-tile flat listing] → One rect read per tile
  up to the first crossing, throttled to scroll settle; the tiles above the fold are the
  few the scroller has passed, so the walk is short in practice.
- [The user resized between leave and return] → the anchor lands, the offset is applied
  within the new row height; neighbours differ, which is the degradation D1 accepts.
- [A listing that re-lands shifts rows after placement] → accepted in D5.
- [A tile click into a folder visited earlier does not restore] → by decision: "retracing
  restores, arriving does not". Restoring on arrival surprised in the exploration (open a
  kit from a search and land halfway down it).
- [Closing the lightbox loses position] → it does not today, since that restore patches
  rather than re-fetches; a task confirms it live so the claim is measured, not read.

## Migration Plan

No data, no server, no configuration. Entries pushed before this change carry no index and
therefore no placement: they land at the top, as they do today. Rollback is a revert.

## Open Questions

None. The four decisions taken in the exploration (2026-09-09, Masa): anchor plus offset
over a scroll offset; history over a per-listing memory; ↑ keeps the current flat state
and falls back to the child, then the top; a tile click lands at the top.
