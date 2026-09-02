# Bulk Thumbnail Jobs

## Why

Warming a library's thumbnails today means scrolling every folder and waiting; fixing a
subtree of orbit-mangled framings means resetting models one context menu at a time.
Both needs surfaced in the trip-reduction thread (`docs/web-demo-notes.md`, 2026-09-02,
settled in discussion with Masa): a scoped, resumable way to *generate what is missing*
and *reset what was framed*, launched where the need is visible, without a background
warmer that grinds a spinning, sometimes-absent volume unasked (the always-on
alternative was weighed and declined there — one 500-tile listing is 20.21 GB of reads).

## What Changes

- **One job framework, two operations**, running through the render queue's lowest
  priority band so interactive work always preempts:
  - *Generate thumbnails*: for each model in scope, render and store its thumbnail if
    missing or stale; current entries are untouched.
  - *Reset framings*: for each model in scope with a stored orientation, apply the
    existing per-model give-up-the-orientation semantics (`entry-actions`: camera always
    discarded; axis discarded only where an index-supplied orientation replaces it),
    then re-render — a discard alone would leave pixels rendered from the discarded
    camera.
- **Jobs are re-derivable, so nothing tracks progress but the entries themselves**: the
  work list derives at launch from durable per-entry state (missing/stale for generate,
  has-a-stored-camera for reset), each completed entry drops out of the derivation, and
  resume-after-anything is "run it again". No job journal. Cancel plus re-run is pause.
- **Two launchers per operation, one job**: context-menu entries on directory and zip
  tiles ("beneath this folder"), and a new `library` side-panel tab for whole-library
  scope ("Generate all thumbnails", "Reset all framings") with honest counts from the
  cache indexes. A persistent, dismissible progress chip is the job's UI regardless of
  launcher; it survives navigation and reports per-entry failures without stopping.
- **The job never overwrites what the user did mid-job**: an entry whose write
  generation moved after launch is skipped (the generation is
  `immutable-thumbnail-serving`'s).
- Reset confirms with its count before running (it destroys curated framings); generate
  does not (additive).

## Capabilities

### New Capabilities

- `thumbnail-jobs`: the job framework — scope derivation, one-at-a-time, band placement,
  the progress chip, failure and mid-job-edit rules, the library-tab surface and its
  counts, confirmation asymmetry.

### Modified Capabilities

- `entry-actions`: one ADDED requirement — the two "beneath this folder" actions on
  container entries (directories and zips), each applying the corresponding per-model
  semantics to the models in that subtree. ADD-only; no active change holds an
  `entry-actions` delta (checked 2026-09-02).

## Impact

- Client: `EntryMenu` (container entries gain the two actions), `SidePanel` (a fourth
  `library` tab), the job runner beside `useThumbnails`' queue plumbing, the chip.
- Server: none beyond what other changes provide — the job PUTs through `/api/thumb` as
  ordinary renders do.
- Hard ordering, all three ahead of this change: `thumbnail-sweep-priority` (the bands
  and start gate the job drains through), `listing-tree-cache` §6 (the thumbnail-state
  index answering missing/stale/framed counts — the `framed` bit is added to its 6.2 by
  this drafting), `immutable-thumbnail-serving` (the write generation the mid-job skip
  reads).
- `SidePanel` is also touched by the future demo change's chat-tab hiding
  (`web-demo-backlog` 1.3) — additive on both sides, but declare the ordering when 1.3
  is drafted. On the demo both operations are write actions: the planned feature report
  (undrafted; notes' Defaults) empties the `library` tab and withholds the menu entries,
  the launcher's empty-report precedent.
