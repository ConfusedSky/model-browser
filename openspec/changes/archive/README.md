# Archived changes — read the citations as history

These 23 changes are an immutable record. Eight of them cite code the way the repo
no longer does — `App.tsx:1070`, `useThumbnails.ts:194`, 144 such citations in all.
**Those line numbers describe a past tree, not this one.** Some were accurate against
the commit that archived their change; some had already drifted by then (`App.tsx:1184`
was a blank line at `92eb081`, the commit that archived `entry-context-menu`) — the
usual cause being that a change's prose is written before the code it cites and the
code moves during implementation.

Either way, do not sweep them. The live convention (cite by symbol name, `CLAUDE.md`)
exists because line numbers rot as code is inserted above them — all sixteen of
`open-in-slicer`'s rotted within two weeks. Rewriting these to today's symbol positions
would not repair them: it would attach a statement about the current tree to a record
of a past decision, so a reader could no longer tell which tree any line ever meant.
A number that was wrong then stays informative as evidence of when it was written; the
same number silently updated is worse than either.

To follow a citation here, read it against the commit that archived the change —
`git log --diff-filter=A -- openspec/changes/archive/<change>/` — and expect to search
nearby rather than land exactly. The symbol names in the surrounding prose are the
reliable half; that is the whole reason the live convention leads with them.
