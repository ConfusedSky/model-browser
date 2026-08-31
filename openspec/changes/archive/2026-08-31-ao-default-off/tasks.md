# Tasks — ao-default-off

> One-line behaviour change; ordered after the archived AO sequence (the flip is
> only cheap because thumbnails follow the preference). `adaptive-ao-default`
> must not be applied until re-derived (its premise is inverted here).

## 1. The flip

- [x] 1.1 `viewer/aoToggle.ts`: parse becomes `raw === 'on'` — absent or malformed
      reads off; stored choices keep their meaning. Docstring updated
      — done 2026-08-31: parse is `raw === 'on'` with the rationale comment
- [x] 1.2 Tests: unset is off; stored `'on'` is on; stored `'off'` is off; any test
      that relied on the implicit on-default states its preference explicitly
      (meaning-preserving edits only, each named)
      — done 2026-08-31: `aoToggle.test.ts` default cells flipped to fresh-module off assertions, its stale header fixed and the "thumbnails never consult the flag" cell retitled to the default-argument fact it actually pins; `thumbnailCommands` and `viewerPanelActions` pin `setAoEnabled(true)` in beforeEach with a comment — meaning-preserving, their subjects are orientation/labels
- [x] 1.3 `adaptive-ao-default/tasks.md` header gains the deferral note; notes item 8
      records the decision (default off now, adaptive later if at all)

      — done 2026-08-31: deferral header on `adaptive-ao-default`, notes Drafted item 5 marked deferred
## 2. Verification

- [x] 2.1 `bun run test` / `bun run typecheck` clean; `openspec validate ao-default-off`;
      archive dry run clean
      — done 2026-08-31: client 549 (49 files), server 305 + 3 skips, typecheck clean, validate clean
- [x] 2.2 Live: a fresh profile (cleared localStorage) opens unoccluded, pill off; one
      press turns it on and it persists
      — done 2026-08-31 (browser, dev instance): cleared localStorage → pill off, nothing stored; one press → on, stored 'on'; survives reload
