## MODIFIED Requirements

### Requirement: The banner introduces the deployment at the library's top
Where a known feature report declares the introduction offered, the client SHALL draw
a slim banner between the header and the grid when the view is the library's top with
nothing committed — no query, no similarity subject, no flat toggle — and SHALL NOT
draw it on any other view, so a deep link into a folder or a search lands on what it
names. The banner SHALL carry one sentence saying what this is — inviting the visitor to
describe what they are looking for where the example queries are offered, and without that
invitation where they are withheld; a row of example queries, each of which runs as a click;
a line saying how a tile is used (see *The banner says how a tile is used*); and its dismiss
control. It SHALL carry no links and no surprise action: the About page and the surprise
action are the header's (see *Dismissal is per browser and About stays reachable*), and the
credits and the source repository are reached from the About page. It SHALL NOT be a page before
the grid: the grid renders beneath it from the first frame, and the banner SHALL NOT
scroll with the grid or change the grid's height between the listing's in-flight state
and its rendered one. The banner SHALL be withheld — absent rather than disabled —
while the report is unknown, failed, or declares the introduction off, as every gated
surface is withheld (see `feature-report`).

#### Scenario: A visitor arrives at the top
- **WHEN** a browser that has not dismissed the banner opens the deployment's root URL and the report declares the introduction offered
- **THEN** the banner is drawn over the kit tiles with its sentence, example queries and tile hint, and the header offers About and the surprise action

#### Scenario: A deep link lands on what it names
- **WHEN** the same browser opens a URL naming a folder, a query or a flat view
- **THEN** no banner is drawn, and the view is exactly the one the URL names

#### Scenario: The desktop build shows nothing
- **WHEN** the report declares the introduction off, or has not resolved, or the read failed
- **THEN** no banner, no header affordance and no other trace of the introduction is drawn

#### Scenario: The grid does not jump
- **WHEN** the banner is drawn and the top listing is still in flight
- **THEN** the grid's skeleton sits where the rendered grid will sit, the banner's height already taken

### Requirement: Example queries run as a meaning search from a click
An example query SHALL run exactly as the same text typed into the search input and
submitted in meaning mode would: the text SHALL appear in the input, meaning mode SHALL
be put in force and stored as the browser's choice as the mode control stores it, and
the results SHALL replace the grid, be named in the URL and enter history as any
committed search does (see `semantic-search`, `url-navigation`). The surprise action
SHALL run one of the example queries chosen at random. The example queries SHALL be
withheld — the row absent from the banner and the surprise action absent from the header,
the sentence remaining without its invitation to describe — while meaning search cannot run here: the index not ready, or not covering
the library's top. An example query SHALL NOT be withheld because the report is unknown
about anything other than the introduction: the index's state alone decides.

#### Scenario: A chip is a submitted query
- **WHEN** a visitor clicks an example query
- **THEN** the grid shows the meaning results for that text, the input holds the text, the URL names the query under meaning mode, and going back returns to the top

#### Scenario: Surprise me
- **WHEN** a visitor activates the surprise action
- **THEN** one of the example queries runs, and activating it again may run a different one

#### Scenario: No index, no chips
- **WHEN** the index is absent, warming, wedged or covers somewhere other than the top
- **THEN** the banner is drawn without its example queries, the header without the surprise action, and the sentence stands

#### Scenario: The index arrives
- **WHEN** the index becomes ready while the banner is drawn
- **THEN** the example queries and the surprise action appear without a reload

### Requirement: The About page carries what the banner cannot
The deployment SHALL serve an About page as a document of the built client, reachable
from the header's persistent link, with a way back to the models.
The page is a surface of the introduction like any other: where the introduction is not
offered the deployment SHALL NOT serve it (see `feature-report`), so a build that
carries the document does not publish it.
It SHALL carry, as sections: what this is; licence and provenance — that the models are
not the operator's, that every model is credited where it is shown, under which
licences; how the corpus was altered — deduplication, non-model files dropped,
decimation, display names from the store — and that what is served is a display copy
rather than the designer's file, to be printed from the source a model's credits link
to, said of the copies themselves and never as a description of a download action,
which this deployment does not offer; what differs from the desktop app, listed as *The
About page follows the deployment it is served by* states — read from the deployment's
report rather than written as a promise, so that a change to those actions (a Download
action, a Copy link label) is a change to this copy; a how-to
of at most five lines that names the find bindings the page takes from the browser — Ctrl+F, and `/` where
the browser binds it to quick find — and notes that Shift+right-click reaches the browser's menu; links — the public source
repository, where to report a problem, contact, and the page's own credits section,
each of them a link the reader can follow; the corpus repository SHALL be named where
the alterations are described and SHALL NOT be linked while it is private, so the page
never offers an address a reader cannot open; a privacy line — no accounts,
this browser's storage only; a note on WebGL and the desktop build; a technical section
for a reader who builds things — the stack, meaning search, and how models are posed,
described as three tiers with the front chosen in the same embedding space and the pose
kept as data an orbit overrides without discarding; and a Limitations section that gives
what meaning search does badly as examples rather than as a disclaimer. The page SHALL
state no accuracy figure for posing or for search, and SHALL name no location on the
machine the deployment runs on (see `feature-report`). Every example the page gives —
each limitation and each example query — SHALL have been run against the deployed index
before it became copy, and an example that stops reproducing SHALL be removed rather
than kept.

#### Scenario: The page is reachable and returns
- **WHEN** a visitor follows the About link in the header
- **THEN** the About page opens with every section above, and its way back lands on the models

#### Scenario: The page is withheld where the introduction is not offered
- **WHEN** a deployment whose configuration declares the introduction off is asked for the About page's address
- **THEN** it is not served, however the address is spelled, and the build still carrying the document changes nothing

#### Scenario: No figure, no host
- **WHEN** the About page is read in full
- **THEN** it quotes no accuracy percentage and names no filesystem path, cache directory or service location

#### Scenario: A limitation is an example
- **WHEN** a visitor reads the Limitations section
- **THEN** each limitation is shown through a query and what it brings back, verified on this deployment, not as a general caveat

### Requirement: The credits list is every kit the store credits
The About page SHALL carry a credits section listing every kit the deployment's
override store holds credits for, one line per kit — the display name, the author
linked to the author URL where one is stored, the licence linked to its deed where one
is stored, the source linked, and the modification phrase where the served copy is not
the author's file — drawn from the same store the lightbox draws a single kit's credits
from (see `library-overrides`), so the list and the lightbox cannot disagree. The
About page's index SHALL lead to this section, as SHALL the page's address naming it. The section SHALL say that the
lightbox credits each model where it is shown, and that this list is the whole corpus
in one place. Where the store holds no credits, the section SHALL say so rather than
render empty.

#### Scenario: The list matches the lightbox
- **WHEN** a kit's credits are read in the lightbox and again in the credits list
- **THEN** the author, licence, source and modification phrase are the same, linked the same way

#### Scenario: The credits link
- **WHEN** a visitor follows the About page index's credits entry, or opens the page's address naming the credits section
- **THEN** the About page shows the credits section

### Requirement: Dismissal is per browser and About stays reachable
The banner SHALL carry a dismiss affordance. Dismissing it SHALL record the choice in
this browser's own storage, so the banner is not drawn again in this browser on any
later visit, and SHALL NOT be recorded anywhere shared. Running an example query or the
surprise action SHALL NOT count as dismissal: nothing about it is recorded, and
the next page load draws the banner again. Once any search has run on the page — an
example query, the surprise action, or a phrase the visitor submitted — the banner SHALL NOT
be drawn again for the rest of that page, returning to the top included: a visitor who has
searched has met the app, and a banner that came back each time they left the results would
bury the grid they came back to. Wherever the introduction is offered — dismissed or not —
the header SHALL carry a persistent About link and, while meaning search can run and the
layout is wider than a phone's, the surprise action, so that what the banner offered stays
one click away after it is gone; a phone-width header, which keeps its room for the search
field, SHALL carry the About link alone. Storage that cannot be written SHALL leave the
banner dismissed for the page's lifetime and drawn again on the next load, never an error.

#### Scenario: Dismissed once
- **WHEN** a visitor dismisses the banner, then reloads or returns to the top later in the same browser
- **THEN** the banner is not drawn, and the header still offers About and, on a wider screen, the surprise action

#### Scenario: Another browser
- **WHEN** the same deployment is opened in a browser that has not dismissed the banner
- **THEN** the banner is drawn

#### Scenario: A chip is not a dismissal
- **WHEN** a visitor runs an example query, navigates back to the top, and later reloads the page
- **THEN** the banner is not drawn on returning to the top, since the visitor has searched on this page, and is drawn again after the reload, since nothing was recorded, until dismissed

#### Scenario: A typed search counts as meeting the app
- **WHEN** a visitor submits a phrase of their own and then dismisses the results at the top
- **THEN** the banner is not drawn again on that page

## ADDED Requirements

### Requirement: The banner says how a tile is used
The banner SHALL carry one line saying how a tile is used — that a model turns under a drag,
opens on activation, and offers more through its actions control — worded for the pointer in
hand: "tap" wherever the pointer is a finger or the layout is a phone's, and, for a mouse on a
wider screen, "click" with the secondary-click route named beside the actions control. The line
SHALL be withheld with the banner and SHALL NOT depend on whether meaning search can run.

#### Scenario: A phone reads tap
- **WHEN** the banner is drawn on a touch screen, or on a phone-width layout
- **THEN** the line says to drag a model to turn it, tap it to open it, and use ⋯ for more

#### Scenario: A mouse reads click
- **WHEN** the banner is drawn for a mouse on a wide screen
- **THEN** the line says to click a model to open it and to right-click or use ⋯ for more

### Requirement: The About page follows the deployment it is served by
The About page SHALL read the deployment's feature report and describe the deployment it is
served by, reading an unknown or failed report as every capability off — the public demo's
posture, which is what the copy was written for. Its list of what differs from the desktop
app SHALL name only what the report withholds — opening in an application, a copied path
being a library path, thumbnails baked and read-only, orbits not kept, host details hidden —
so that a capability a deployment offers is not described as missing. Where the report says
the reader operates the server — host details or the application launcher offered — the page
SHALL present itself as about the application rather than about the demo, and SHALL say that
what it says of the demo's corpus is about the demo rather than about this library. The page
SHALL open with an index of its sections whose entries follow the sections' own titles, and
SHALL index the credits by the first letter of each kit's name, a link naming a letter taking
the reader to that letter once the list has drawn.

#### Scenario: The demo reads as the demo
- **WHEN** the About page is opened on a deployment whose report declares every capability off, or whose report is unknown
- **THEN** it presents itself as about the demo and lists every difference from the desktop app

#### Scenario: An owner's machine drops the demo's claims
- **WHEN** the About page is opened on a deployment that offers host details or the application launcher
- **THEN** it presents itself as about Model Browser, says the corpus sections describe the demo, and lists only the differences that deployment still withholds

#### Scenario: A letter of the credits
- **WHEN** the reader follows the index's link for a letter of the credits
- **THEN** the page scrolls to the kits whose names start with that letter, once the credits list has drawn
