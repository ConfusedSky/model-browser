## Context

A list, not a design. The design work lives in the changes this one enumerates; what
this file records is the ordering they inherit and the decisions the notes already made
that a drafter must not reopen.

## Decisions

### D1: Order

After the drafted main-app sequence (`library-root` → `remove-axis-lighting` →
`ao-as-recipe-dimension` → `ao-refreshes-thumbnails` → `adaptive-ao-default` →
`folder-contact-sheets`):

1. `library-overrides` (the store — credits, display names, poses field)
2. pose-for-every-model (reads the store's pose field; must land before any bake — see
   the notes' "Bake … after pose-for-every-model", verified: today `useThumbnails` poses
   a tile only when the last search carried a pose)
3. the demo mode itself (confinement is free after `library-root`; guard, read-only
   thumbs, launcher off, chat tab hidden, static serving, bake, credits page)

The decisions (visitor orbits, landing, names, domain) are needed by 3 and can be made
any time before it is drafted.

### D2: Already decided — draft from these, do not reopen

- Store: one `<library>/.model-browser/overrides.json`, keyed by library path,
  directory keys applying to their subtree by longest prefix, files overriding; loaded at
  start, written atomically; poses are a field in it; credits generated into it from
  `metadata/miniatures.json`. sqlite only if a library outgrows load-at-start.
- Thumbnails on the demo are pre-baked and read-only; anonymous `PUT` is refused. A
  persisted orbit is a global edit under D4 (camera keyed by path), so "crowd-warmed"
  is closed.
- Demo is an env-selected mode of this repo, not a fork; hidden controls come from a
  `features` value resolved once in `main.tsx`.
- Index on CPU, fp32, always-on US VM, 4–8 GB (measurements in the notes).

## Risks / Trade-offs

- [The list rots as changes land] → each line names the change it became; the archive
  rule is that every line does.
- [A decision is made in chat and not here] → the task line for a decision is done only
  when the notes' item carries the answer and the date.
