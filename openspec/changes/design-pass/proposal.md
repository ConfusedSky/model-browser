# Design pass

## Why

The `design-pass` branch (`8f743d3`…`ee75941`) rebuilt the client's chrome around the models
and landed ahead of its specs. Several main requirements now describe behaviour the code no
longer has (scores always visible, a lightbox context menu, open-in pills, the axis picker
first, an expanded side panel, containers before models, *Reset framing* where no framing is
kept, the banner's links, the introduction returning after a search), and much of the new
behaviour is specified nowhere. This change brings the specs in line with the branch, plus
three small code fixes a spec review found.

## What Changes

- **Scores**: a result's raw cosine and z are drawn only under a per-profile *Show match
  scores* option, off by default, at the foot of the tile. By default a result carries a
  relevance bar and a strength word (Strong / Good / Fair / Weak) in its tooltip, its
  accessible name and the lightbox's `match` row. A set whose best is middling uses no word
  above Fair. **BREAKING** for the requirement that both numbers are visible without a
  setting.
- **Weak meaning sets change the page's shape**: flagged by the index *or* topped by a low
  z, the count says "No strong matches", the grid shows one row of guesses with *Show all*,
  and the note gathers the ways out.
- **A query is asked of the corpus its words belong to**: a file-name-shaped query under
  Meaning runs as a name search, a description under Name runs by meaning where meaning can
  run, until its results are left, said on the results line with the other corpus one click away.
- **Leaving a search puts the profile's own options back** — dismissing, emptying the box,
  navigating or pressing Flat.
- **Names are counted beside every meaning search**, and the count is offered as a way to
  the names.
- **The results line** leads with the count, then the query, then the dismissal; notes go on
  the line below; one status slot says what a request is waiting for, a background refresh,
  or how many thumbnails are still rendering; a plain listing is summarised by kind.
- **Empty searches** name where they looked and offer the whole library and the other mode;
  a location that cannot be opened says so with a way back to the library.
- **Flat views and name searches list models before folders.**
- **The lightbox raises no context menu** — its panel carries every command — and the
  panel leads with an *Open in \<default app\>* button above the metadata; everyday actions
  come before a divider and maintenance after it. The whole stage turns and zooms the model;
  a gesture hint shows until the first turn; the stepping arrows are not drawn at the ends.
- **Menus**: open-in choices are rows following *View model* rather than an inline pill
  group; the orbit-axis picker comes last, after the maintenance commands; every tile has a
  `⋯` button raising the same menu; a pointer-raised menu highlights no row until an arrow
  key asks.
- ***Reset framing* is withheld where the deployment refuses thumbnail writes.**
- **The side panel** is closed for a fresh profile and opened from the toolbar's *Options*
  button, which carries a dot for any search option off its default; below a wide screen it
  floats (a sheet on a phone) and puts itself away on a press outside or Escape. The mode
  switch moved into the search field; a *Display* section holds *Show match scores* (and
  Occlusion on a phone).
- **Breadcrumbs** stand over the path bar and fold by measured overflow; the brand leads to
  the library's top.
- **Keyboard**: arrival focus after a navigation, `/` to search, ArrowDown from the search
  and Narrow fields into the grid, Escape from Narrow and the path bar returning focus,
  Ctrl-F from an empty search box, the Options panel taking and returning focus.
- **Touch**: on a model tile only the middle of the picture turns the model; the band
  around it scrolls, and a tap there opens it. A finger's release ends the orbit overlay,
  and any new view removes a leftover one.
- **The introduction**'s banner is specified as drawn — sentence, example queries, tile
  hint, dismiss; About and Surprise me live in the header. It stays hidden for the rest of the page once a search has run, and
  says how a tile is used, in tap wording on touch or a phone-width layout; the About page
  reads the deployment's report and carries an index.
- **Renders pause while a user's search is in flight.**
- **A lost WebGL context** raises an alert with a Reload button.
- **Result tiles name the folder they live in** on a second line.
- **Tile size** (small / medium / large) is a per-profile preference.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `directory-browsing`: breadcrumbs, the results line, arrival focus and keyboard entry to
  the grid, models-first flat view, parent-folder lines, tile size, the failed-location
  state.
- `entry-actions`: surfaces (no lightbox menu), the `⋯` button, menu order and keyboard
  highlight, open-in as rows, *Reset framing* gated on thumbnail writes.
- `feature-report`: the orientation carve-out no longer promises that giving one up is
  offered everywhere.
- `model-viewer`: touch orbit zone and finger release, the lightbox panel's order, the
  whole stage turning the model, the gesture hint, hidden end arrows, the lost-context alert.
- `semantic-search`: opt-in numbers and strength words, weak-set shape, routing a query to
  its corpus, the name count.
- `file-search`: Narrow in the toolbar, models-first presentation of name results, leaving
  a search restores the profile's options, empty searches offer a way onward, the search
  field names its corpus and scope.
- `visitor-intro`: the banner does not return after a search this page; the tile hint; the
  About page follows the report and indexes itself; the header's surprise action on wider
  screens only.
- `chat-panel`: the side panel is closed by default, opened from the toolbar, dismissible,
  and carries a Display section.
- `model-thumbnails`: renders yield to a search in flight.
- `url-navigation`: the URL names the corpus a search actually ran against; the new display
  preferences stay out of it.

## Impact

- The code is on the `design-pass` branch already, plus three review fixes (the flat toggle
  restoring the profile's options, the skeleton's results line, the failed-location state).
- No server, API or configuration change. No `RIG_VERSION` bump: no thumbnail pixel changes.
- Every other active change was checked for collisions: none of them MODIFIES a requirement
  this change modifies (see design.md, *Collisions*).
