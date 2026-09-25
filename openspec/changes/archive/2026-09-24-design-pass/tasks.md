# Tasks — design-pass

> The code landed on the `design-pass` branch (`8f743d3`…`ee75941`) before this change was
> written; the change records it. Every task is done. Test files are named only where the
> branch added or rewrote cells for the behaviour; a named file is where to look, not a claim
> that every clause is covered.

## 1. Search and results

- [x] 1.1 Opt-in match scores (`showScoresStore`), strength words (`strengthOf`) and the
      relevance bar — `designPassHelpers.test.ts` (bands), `semanticSearch.test.tsx` (*what a
      scored tile draws by default*: bar and word by default, numbers once asked). Gap: no
      cell asserts the numbers sit at the picture's foot
- [x] 1.2 Weak sets by flag or best z (`WEAK_TOP_Z`), one row of guesses (`WEAK_SHOWN`) with
      Show all, modest sets (`STRONG_TOP_Z`) — `semanticSearch.test.tsx`
- [x] 1.3 Route a file-name-shaped query to names and a description to meaning, until the
      results are left (`looksLikeFileName`, `looksLikeDescription`, the reducer's
      `submit.mode`) — `designPassHelpers.test.ts`, `semanticSearch.test.tsx`. Gap: no cell
      for a second submit over routed results staying in the routed corpus, nor for a file
      name under Meaning with no index not being deferred
- [x] 1.4 Leaving a search restores the profile's options (`clearSubject.prefs`,
      `queryText.prefs`, `toggleFlat.prefs`) and empties the box — `semanticSearch.test.tsx`
      (dismissal, emptied box, and *left by the flat toggle*)
- [x] 1.5 Name count beside a meaning search (`ApiClient.nameMatchCount`), keyed on the whole
      question, "500+" at the cap — `semanticSearch.test.tsx` covers the count; the "500+"
      reading has no cell
- [x] 1.6 Results line: count first, chip, dismiss, notes line, one status slot, listing
      summary, dimmed grid while a request is out; over the skeleton, the wait and nothing of
      the view that left — `listingSkeleton.test.tsx` covers the skeleton case. Gap: the
      status-slot precedence, the render count and the dimming have no cell
- [x] 1.7 Empty searches name the folder and offer the whole library and the other corpus;
      the failed-location state, shown only where no listing landed — `failedLocation.test.tsx`
      covers the failed-location state. Gap: the empty-search offers have no cell
- [x] 1.8 Models before folders in flat views and name results
- [x] 1.9 Search field: mode switch inside it, placeholder naming scope and corpus, accessible
      name following the mode — `semanticSearch.test.tsx` (*the search field names what and
      where it searches*), `introPlaceholder.test.tsx` (the example placeholder)

## 2. Menus and actions

- [x] 2.1 The lightbox raises no menu; its panel carries the commands — `viewerMenu.test.tsx`
- [x] 2.2 Everyday commands, divider, maintenance (`MAINTENANCE_COMMANDS`); axis picker last;
      open-in as rows after View model — `orbitAxisMenu.test.tsx` (axis last),
      `openInApps.test.tsx` (rows after View model, and the everyday/maintenance divider)
- [x] 2.3 Pointer-raised menus mark no row until an arrow key — `entryMenu.test.tsx`
- [x] 2.4 Tile `⋯` actions control
- [x] 2.5 *Reset framing* withheld unless the deployment accepts thumbnail writes —
      `entryActions.test.ts`, `viewerPanelActions.test.tsx`

## 3. Viewer

- [x] 3.1 Lightbox panel: file-name title with its kit's folders, Open in \<default\> as the
      primary action above the metadata — `viewerPanelActions.test.tsx`, `openInApps.test.tsx`
      cover the launch actions. Gap: the title's kit folders (`nearestFolders`) have no cell
- [x] 3.2 The whole stage turns and zooms (`orbitHandoff.test.tsx`); gesture hint until the
      first turn; end arrows not drawn (neither has a cell)
- [x] 3.3 Touch orbit zone, a finger's release ends the overlay, a new view removes a leftover
      overlay — `touchOrbitZone.test.tsx`, `orbitHandoff.test.tsx` (finger release). Gap: a
      new view removing a leftover overlay has no cell
- [x] 3.4 Lost-context alert with Reload — `renderFailures.test.tsx`

## 4. Browsing chrome

- [x] 4.1 Breadcrumbs over the path bar, folded by measurement (`foldCrumbs`) —
      `designPassHelpers.test.ts`
- [x] 4.2 Side panel closed by default, opened from Options with the dot, floating below `xl`,
      Escape and focus handling, Display section
- [x] 4.3 Tile size preference; parent-folder lines on result tiles
- [x] 4.4 Focus rules: arrival focus, `/`, ArrowDown into the grid, Narrow and path-bar Escape,
      Ctrl-F from an empty search box — `fileNameSearch.test.tsx` covers Narrow's Escape and
      ArrowDown
- [x] 4.5 Renders pause while a user's search is in flight (`searchInFlight`)

## 5. Introduction

- [x] 5.1 Banner hidden for the rest of the page once a search has run (`searchedOnce`) —
      `introBanner.test.tsx`; the banner requirements rewritten to what `IntroBanner` draws
- [x] 5.2 Tile-usage hint in tap or click wording
- [x] 5.3 About page follows the report, with an index and lettered credits —
      `aboutPage.test.tsx`

## 6. Specs

- [x] 6.1 Read every other active change's deltas; modify no requirement another change
      modifies (design.md, *Collisions*)
- [x] 6.2 Deltas for directory-browsing, entry-actions, feature-report, model-viewer,
      semantic-search, file-search, visitor-intro, chat-panel, model-thumbnails,
      url-navigation
- [x] 6.3 `openspec validate design-pass` passes, and an archive dry run applies cleanly, with
      each other active change dry-run after it in a fresh copy

## 7. Spec review 1

- [x] 7.1 `toggleFlat` restores the profile's options when it leaves a committed subject —
      `semanticSearch.test.tsx`, falsified by reverting the reducer line
- [x] 7.2 No results head over the skeleton; the wait label takes its place —
      `listingSkeleton.test.tsx`, falsified by drawing `resultsHead` there again
- [x] 7.3 The failed-location state only where no listing landed — `failedLocation.test.tsx`,
      falsified by restoring the `kept.length === 0` test
- [x] 7.4 Spec text: routing until results are left, the deferral and submit exceptions, the
      unrunnable-mode reason in the panel, weak sets and the floor count, the banner
      requirements, the About page's differences list, the framing gate's wording, carried
      change-scoped prose, copy strings moved to scenarios
- [x] 7.5 Finding similar from a routed result restores the profile's options —
      `semanticSearch.test.tsx` (*left by finding similar*), falsified by dropping the
      reducer's `prefs` spread on `similar`
- [x] 7.6 The About how-to names both find bindings (`aboutPage.test.tsx`, regex retargeted);
      *What the index covers* allows the index's own "N of M" ratio; the introBanner cell
      retitled to what it asserts
