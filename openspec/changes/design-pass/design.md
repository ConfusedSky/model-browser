# Design — design-pass

## Context

The branch's intent lives in the design pass's own brief (principles: content first, one
accent, global row vs local row, say where you are, power features on demand, recoverable
dead ends, a phone layout), revised after each of four review rounds. The code landed
first; this change writes down what the code does. Every decision below is **already
implemented** — the section records why, so a later edit to the spec does not undo a
choice by accident. Code is cited by symbol.

## Goals / Non-goals

- Goal: every main-spec requirement the branch contradicts is modified, and every new
  observable behaviour a later change could break is pinned.
- Non-goal: pixel styling (tokens, radii, the accent, icons). The specs pin what a user
  can observe and act on, not how it is drawn.
- Non-goal: server behaviour. Flat's 500 cap, the walk budgets and the render rate are
  unchanged; so is the thumbnail recipe (no `RIG_VERSION` bump).

## Decisions

### D1. Scores are opt-in; a word and a bar stand in by default

`semantic-search` required both raw numbers on every scored tile, "visible without hover,
selection, or a setting". A visitor has no legend for a cosine of 0.112, so the numbers now
sit behind `showScoresStore` (`lib/scoreScale.ts`), off unless a profile turns it on, drawn at
the picture's foot (`BADGE_CLASS` in `components/Grid.tsx`) so the top-right corner is free for
the `⋯` control. By default a tile carries a relevance bar (`relevanceWidth`) and a strength
word (`strengthOf`). The requirement's ban on banding the index's numbers is kept for the
numbers themselves; the word is stated as this app's reading against fixed bands, never as a
number or the index's verdict.

Bands (`strengthOf`): Strong ≥ 4, Good ≥ 3, Fair ≥ 2, Weak below. Pinned in the spec because
they are observable in the tooltip, the accessible name and the panel's `match` row.

### D2. Weak and modest sets change the page, not only a note

The index's `weak` flag never fired on the 3,070-model cache during the review rounds (read
from the round notes, not re-measured here), while nonsense phrases topped out below real
ones. `WEAK_TOP_Z` (2.5) makes a set weak on its best z as well; `STRONG_TOP_Z` (3.6) makes a
set *modest*, capping its words at Fair. A weak set shows `WEAK_SHOWN` (12) guesses until
"Show all", with the ways out gathered in one note (`weakWaysOut` in `App.tsx`). The
thresholds come from the round-2 measurements of top z on both indexes; the ranges overlap,
so no threshold separates nonsense from vague phrases, and the design says "guesses" rather
than "no".

### D3. A query is asked of the corpus its shape belongs to, until its results are left

`looksLikeFileName` / `looksLikeDescription` (`lib/searchOptions.ts`) decide in
`submitSearch`; the reducer's `submit` action takes an optional `mode` and patches it into the
view before committing, so the URL names the corpus that ran. The patch is the live view's, not
the commit's: until the results are left, the input's mode control shows the routed corpus and
a further submit over those results is read under it (then routed again by its own shape). The
profile's stored mode is never touched (`switchModeOnce` commits `setMode` without
`setSearchMode`); leaving the results restores it (D4). A description is routed to meaning only
where `meaningRunnableAt` holds; a file name is routed to names always, since names can always
run — which is also why it is exempt from `semantic-search`'s deferral rule: it was never a
meaning search. Basing the routing on the stored mode instead (so every submit re-decided from
the profile) was considered and not taken: the switch in the field would then disagree with
what a second submit runs.

### D4. Leaving a search restores the profile's options

Found in code review: a routed search left the view in Name mode after dismissal, so the next
phrase ran against the names. `clearSubject`, an emptied `queryText` and `toggleFlat` now carry `prefs`
(`ownPrefs()` in `App.tsx`), exactly as `navigate` always did; `toggleFlat` applies them only
when it leaves a committed subject. This also closes the older gap
where a link's options outlived the link's search until the next navigation. Dismissal also
empties the search box.

### D5. The name count beside a meaning search

`ApiClient.nameMatchCount` is a flat name search whose entry count is the answer; it is
optional on the interface, and `withLocalFramings` rejects when the inner client lacks it, which
App treats as "no count". The answer is keyed on path, folder matching and words (`hitsKey`) and
cleared while the next is asked. At `NAME_COUNT_CAP` (500) the count reads "500+".

### D6. The lightbox raises no menu

The panel already carried every command the lightbox can perform, so the lightbox's own menu
(`LIGHTBOX_MENU_EXCLUDES`, and the menu's own routing of *Reset framing* to the live session)
only duplicated it, in a second look. Removed; `resetFramingLive` itself stays, as the panel's
route for the same command (`onViewerCommand`). The orbit
overlay keeps raising the tile's menu, since it *is* the tile for the moment it stands.
`LIGHTBOX_PANEL_EXCLUDES` still states what the panel omits.

### D7. Menu order and the open-in rows

`MAINTENANCE_COMMANDS` names the tending commands; both the menu and the panel draw everyday
commands, a divider, then maintenance. The open-in pill group became one "Open in \<app\>" row
per application directly after *View model*, so every way of opening sits together; the axis
picker moved last, after a divider, because it re-frames the thumbnail. In the panel the
default application is the one filled button, above the metadata — the "describes before it
offers" rule keeps holding for every other action.

### D8. *Reset framing* is withheld where thumbnail writes are refused

`FRAMINGS_KEPT_LOCALLY` is `false` (issue #28), so today, on a `thumbWrites:false`
deployment, nothing a visitor turns outlives the view, and `resetFramingLive`'s closing refresh
redraws the deployment's own framing anyway (issue #23). A reset there promised a persistence
the tile does not have. `resetFraming.applies` now requires `thumbWrites === true`, as the
re-render does; the axis picker and the bulk reset are unaffected. The spec states the gate
(the deployment's acceptance of the write) and not the reason, because the reason is a fact
`model-thumbnails` owns and currently states the other way (*A client whose writes are refused
keeps its framings locally*); when #28 turns the local keep back on, this gate is the thing to
revisit. `feature-report`'s orientation carve-out is reworded so it no longer asserts that
giving an orientation up is offered everywhere; it defers to `entry-actions`.

### D9. The side panel is closed until asked for

`collapseStore` reads collapsed unless a profile stored "open", so fresh profiles start
closed; a profile that had opened it keeps its choice. The toolbar's Options button owns the
toggle and the dot (`optionsOffDefault`, plus a similarity view's pool); the panel docks only
at the `xl` breakpoint and floats below it. The mode switch moved from the panel into the
search field, which is where the "mode visible without opening the panel" rule wanted it.

### D10. Models before folders in flat and name results

A flat view or name search is asked for to find models; the server's order (containers first)
is unchanged, and `App.tsx`'s `kept` memo re-orders on the client for flat-plain and name-query
views only. Meaning results keep the index's ranking.

### D11. Focus follows the user's place

`arrivalFocusRef` focuses the folder just left (going up) or the first tile after a landing,
but only when focus fell to `<body>` with the unmounted listing — never stealing it, and with
`preventScroll`, so the retrace placement is untouched. `/`, ArrowDown from the search and
Narrow inputs, Narrow's Escape (`findFromRef`), the path bar's Escape (`cameFrom` in
`PathBar`), Ctrl-F from an empty search box, and the panel's focus-in and focus-back follow the
same idea. The grid's arrow-key requirement is modified for the ArrowDown exception only.

### D12. Breadcrumbs fold by measurement

`foldCrumbs` / `crumbsOf` (`components/PathBar.tsx`) and a layout effect step the fold while
the row overflows, resetting on path or width change. The current name may shrink to
`READABLE_PX` before the top folds. The input stays underneath (transparent text), so a press
between crumbs edits the path, and every existing path-bar behaviour is unchanged.

### D13. Touch

Only `[data-orbit-zone]` (the middle of the picture, 17.5% inset) starts an orbit under a finger;
the band scrolls (`touch-pan-y`) and a tap there opens the lightbox via the tile's click. A
finger's release ends the overlay (`pointerType === "touch"` in the release handler), and an
effect in `App.tsx` removes an orbit overlay on any change of path, flat or subject.

### D14. Renders pause while a search is in flight

`searchInFlight` in `App.tsx` joins `viewer` as a queue suspension, for user-asked requests
whose subject is a query or a model; follow-ups (background revalidations) and plain
navigations do not suspend. It narrows contention; it does not stop renders already started
(read from the code, not measured).

### D15. Everything else pinned

The results line (count, chip, dismiss; one status slot with `RENDERING_DELAY_MS`), the
failed-location empty state, parent-folder lines (`ParentLine`), the lightbox title's
`nearestFolders` with `GENERIC_FOLDER`, the stage-wide orbit (`STAGE_CONTROLS`), the gesture
hint, hidden end arrows, the lost-context alert (`onContextLost` in `three/renderer.ts`), tile
size (`tileSizeStore`), the banner's tile hint and `searchedOnce`, the header's surprise action
on wider screens only, and the About page's posture (`has`, `operator` in `AboutPage`).

## Collisions

Other active changes' deltas, read before writing:

| change | MODIFIES | ADDS |
|---|---|---|
| adaptive-ao-default | — | model-viewer *Occlusion defaults by measurement* |
| entry-stat-revalidation | listing-cache ×3 | listing-cache ×2, public-deployment ×1 |
| hover-prefetch-listings | — | directory-browsing *Hover-warmed listings* |
| hover-prefetch-thumbnails | — | directory-browsing *A warmed listing warms…* |
| per-library-recents | directory-browsing *Recent directories* | — |
| pose-layer-removal | directory-browsing *Folder tiles preview their contents*; listing-cache ×2; semantic-search *The index's orientations reach every listing* | — |
| search-cancellation | — | directory-browsing *Concurrent and abandoned listing work* |
| web-demo-backlog | — (no `specs/`) | — |

None of the requirements this change modifies is modified by another active change, and no
title this change adds exists in another delta. Where the branch touches a requirement another
change owns — the folder sheet's quiet cells (*Folder tiles preview their contents*) and
in-flight feedback — this change adds a separate requirement (the results line) rather than
modifying it.

## Review fixes (spec review 1)

Three code fixes came out of the review, each with a cell that fails with the fix reverted:

- `toggleFlat` passes `ownPrefs()` like `clearSubject` does, so pressing Flat over a routed
  search no longer leaves the next phrase in the routed corpus
  (`semanticSearch.test.tsx`, *a file name asked of the names, left by the flat toggle*).
- `noticeBar` draws no results head over the skeleton (`status` off), so the departed
  search's count and chip no longer stand over a new wait, and the wait label takes the
  summary's place (`listingSkeleton.test.tsx`, *the results line over the skeleton*).
- `failedPath` requires `state.result === null` rather than an empty `kept`, so a failed path
  over an empty folder that did land keeps the folder (`failedLocation.test.tsx`).

Review 2 added a fourth: finding similar from a routed result carries `ownPrefs()` too (App's
`actionHost.dispatch` adds them to the `similar` action; the reducer applies them when a subject
is superseded), with a cell *a file name asked of the names, left by finding similar*. The About
page's how-to now names both find bindings it takes (Ctrl+F, and `/` where it is Firefox's quick
find), and *What the index covers is stated, not implied* now allows the "N of M models here are
indexed" copy, both counts being the index's.

The visitor-intro banner requirements were rewritten to what `IntroBanner` draws (sentence,
example queries, tile hint, dismiss control; About and the surprise action in the header),
retiring the links `368c581` removed.

## Known divergences left alone

- `model-thumbnails` *A client whose writes are refused keeps its framings locally* vs
  `FRAMINGS_KEPT_LOCALLY = false` (issue #28), as the repo's CLAUDE.md records.

## Risks

- The strength bands and the weak/modest thresholds were tuned on two indexes' top-z
  distributions; a re-embedded index could move them. They live in two constants and one
  function, and the spec names their values, so a retune is a spec edit too.
- The file-name heuristic routes any single token with a digit (`d20`, `28mm`) to names. That
  is the intended reading — such tokens name files — and the results line offers meaning one
  click away.
